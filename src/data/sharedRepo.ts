/**
 * Couche d'écriture partagée (spec §3.3). Toute écriture des données d'un tabac passe par ici :
 * - `writeShared` applique la modification localement, horodate chaque champ partagé modifié (`_clock`)
 *   et, si le relais est configuré, met l'opération `{e, id, f, t}` dans la file `opsOut` ;
 * - `applyRemoteOps` applique les opérations venues des autres téléphones (le plus récent gagne).
 * Les champs non partagés (versions des listes publiques, état de sauvegarde, jeton…) sont écrits tels quels,
 * sans horodatage ni opération.
 */
import type { Table } from 'dexie';
import { applyFields, diffFields, type Clocked, type Op } from '../sync/merge';
import { observe, tick } from '../sync/clock';
import { relayUrl } from '../sync/relayConfig';
import { syncRegistryName } from '../tabacs/registry';
import { db, dbTabacId, DEFAULT_SETTINGS } from './db';

export type Entity = Op['e'];

/** Champs partagés par entité (contraintes globales). `user` est partagé champ par champ (`user.<champ>`). */
export const SHARED_KEYS: Record<Entity, readonly string[]> = {
  line: ['gameId', 'code', 'name', 'linearQty', 'stockQty', 'updatedAt', 'deleted'],
  // `source` et `base` seulement pour une fiche créée à la main (voir sharedKeysFor).
  product: ['user', 'outOfStock', 'pinnedSubstitutes', 'source', 'base'],
  settings: ['shopName', 'sortCount', 'hiddenGames'],
};

const MANUAL_ONLY = new Set(['source', 'base']);
const isManual = (r: unknown) => (r as { source?: unknown } | undefined)?.source === 'utilisateur';

/** Champs partagés d'un enregistrement donné : `source`/`base` d'un produit officiel ne le sont pas. */
export function sharedKeysFor(e: Entity, record: unknown): string[] {
  const keys = [...SHARED_KEYS[e]];
  return e === 'product' && !isManual(record) ? keys.filter((k) => !MANUAL_ONLY.has(k)) : keys;
}

export const OPS_QUEUED_EVENT = 'carotte:ops-queued';

type Row = Clocked<Record<string, unknown>>;

const tableFor = (e: Entity): Table<Row, string> =>
  (e === 'line' ? db.countLines : e === 'product' ? db.products : db.settings) as unknown as Table<Row, string>;

/** Valeurs implicites d'un enregistrement sans horodatage (les réglages par défaut ne sont jamais stockés seuls). */
const implicit = (e: Entity): Record<string, unknown> => (e === 'settings' ? { ...DEFAULT_SETTINGS } : {});

/** Enregistrement de départ quand une opération reçue vise un id inconnu ici (champs non horodatés : l'opération gagne). */
function blank(e: Entity, id: string): Row {
  if (e === 'line') return { id, code: '', name: '', linearQty: 0, stockQty: 0, updatedAt: 0 };
  if (e === 'product') return { id, base: {}, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: Date.now() };
  return { key: 'main', ...DEFAULT_SETTINGS };
}

function withoutClock<T extends object>(r: T): T {
  const { _clock: _c, ...rest } = r as T & { _clock?: unknown };
  return rest as T;
}

function notifyQueued() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPS_QUEUED_EVENT));
}

/**
 * Écrit `next` (enregistrement complet) pour `e`/`id`. Les champs partagés modifiés reçoivent un horodatage
 * `t = tick()` ; ils forment l'opération mise en file si le relais est configuré.
 * Une ligne jamais horodatée (ligne de jeu créée d'office, ancienne donnée) est partagée en entier à sa première
 * écriture, pour qu'un autre téléphone qui ne la connaît pas la reçoive complète.
 * Peut être appelée dans une transaction englobante, à condition qu'elle inclue la table de l'entité et `opsOut`.
 */
export async function writeShared(e: Entity, id: string, next: object): Promise<void> {
  const table = tableFor(e);
  const queued = await db.transaction('rw', table, db.opsOut, async () => {
    const current = await table.get(id);
    const clock = current?._clock ?? {};
    // L'horloge ne doit jamais être en retard sur un horodatage déjà stocké (stockage local effacé…).
    for (const c of Object.values(clock)) observe(c);
    const record: Record<string, unknown> = withoutClock(next as Row);
    if (e === 'settings') record.key = 'main';
    else record.id = id;

    const keys = sharedKeysFor(e, record);
    const before = { ...implicit(e), ...(current ? withoutClock(current) : {}) };
    const f = diffFields(before, record, keys);
    if (e === 'line' && current) {
      for (const k of keys) if (!Object.hasOwn(clock, k) && record[k] !== undefined && !(k in f)) f[k] = record[k];
    }

    if (Object.keys(f).length === 0) {
      await table.put(current?._clock ? { ...record, _clock: current._clock } : record);
      return false;
    }
    const t = tick();
    const applied = applyFields(current ? { _clock: clock } : undefined, f, t).record;
    await table.put({ ...record, _clock: applied._clock });
    if (!relayUrl()) return false;
    await db.opsOut.add({ op: { e, id, f, t } });
    return true;
  });
  if (queued) notifyQueued();
}

const ENTITIES = new Set<string>(['line', 'product', 'settings']);
const STAMP = /^(\d{13})-\d{4}-.+$/;
const MAX_AHEAD_MS = 24 * 3_600_000;

/** Garde les seules clés qu'un autre téléphone a le droit d'écrire (R16). */
function allowedFields(op: Op, local: Row | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set(SHARED_KEYS[op.e]);
  for (const [k, v] of Object.entries(op.f)) {
    if (op.e === 'product') {
      if (k.startsWith('user.')) out[k] = v;
      else if (k === 'source') {
        if (v === 'utilisateur' && (!local || isManual(local))) out[k] = v;
      } else if (k === 'base') {
        if (local ? isManual(local) : op.f.source === 'utilisateur') out[k] = v;
      } else if (keys.has(k) && k !== 'user') out[k] = v;
    } else if (keys.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

function wellFormed(op: unknown): op is Op {
  const o = op as Partial<Op> | null;
  return !!o && typeof o === 'object' && typeof o.e === 'string' && ENTITIES.has(o.e)
    && typeof o.id === 'string' && o.id !== '' && (o.e !== 'settings' || o.id === 'main')
    && typeof o.t === 'string' && STAMP.test(o.t)
    && !!o.f && typeof o.f === 'object' && !Array.isArray(o.f);
}

/**
 * Applique des opérations reçues (dans l'ordre) et renvoie le nombre d'opérations qui ont changé quelque chose.
 * Ignorées : opérations mal formées ou d'entité inconnue, réglages autres que `main`, horodatage à plus de 24 h
 * dans le futur (R15, non observé), produit inconnu ici sans fiche créée à la main. Les clés non partagées sont
 * retirées (R16). Rien n'est mis en file : ces opérations viennent déjà du canal.
 */
export async function applyRemoteOps(ops: Op[]): Promise<number> {
  const limit = Date.now() + MAX_AHEAD_MS;
  let future = 0;
  let orphans = 0;
  let renamed: string | undefined;
  const changes = await db.transaction('rw', db.countLines, db.products, db.settings, async () => {
    let n = 0;
    for (const op of ops) {
      if (!wellFormed(op)) continue;
      if (Number(STAMP.exec(op.t)![1]) > limit) {
        future++;
        continue;
      }
      observe(op.t);
      const table = tableFor(op.e);
      const local = await table.get(op.id);
      const f = allowedFields(op, local);
      const { record, changed } = applyFields(local ?? blank(op.e, op.id), f, op.t);
      if (!changed) continue;
      if (op.e === 'product' && !local && !isManual(record)) {
        orphans++;
        continue;
      }
      if (op.e === 'product' && local) record.updatedAt = Date.now();
      await table.put(record);
      if (op.e === 'settings' && 'shopName' in f && typeof record.shopName === 'string') renamed = record.shopName;
      n++;
    }
    return n;
  });
  if (future) console.warn(`Synchronisation : ${future} opération(s) ignorée(s), horodatée(s) à plus de 24 h dans le futur.`);
  if (orphans) console.warn(`Synchronisation : ${orphans} opération(s) ignorée(s) pour des produits inconnus sur ce téléphone.`);
  if (renamed !== undefined) syncRegistryName(dbTabacId, renamed);
  return changes;
}
