/**
 * Couche d'écriture partagée (spec §3.3). Toute écriture des données d'un tabac passe par ici :
 * - `writeShared` applique la modification localement, horodate chaque champ partagé modifié (`_clock`)
 *   et, si le relais est configuré (ou si ce tabac a déjà été synchronisé, R29), met l'opération `{e, id, f, t}` dans
 *   la file `opsOut` ;
 * - `applyRemoteOps` applique les opérations venues des autres téléphones (le plus récent gagne).
 * Les champs non partagés (versions des listes publiques, état de sauvegarde, jeton…) sont écrits tels quels,
 * sans horodatage ni opération.
 */
import type { Table } from 'dexie';
import { applyFields, diffFields, withoutClock, type Clocked, type Op } from '../sync/merge';
import { observe, tick } from '../sync/clock';
import { relayUrl } from '../sync/relayConfig';
import { syncRegistryName } from '../tabacs/registry';
import { gameKey } from '../domain/productId';
// Import circulaire voulu : db.ts appelle writeShared, et ce module utilise `db` ; des deux côtés, seulement
// dans des fonctions (jamais à l'évaluation du module), donc l'ordre de chargement est sans effet.
import { db, dbTabacId, DEFAULT_SETTINGS, type CarotteDB } from './db';

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

/** Clé de `syncState` écrite par le moteur de synchronisation à la première réception (numéro du dernier message). */
const SYNCED_KEY = 'lastN';

type Row = Clocked<Record<string, unknown>>;

const tableFor = (e: Entity, d: CarotteDB = db): Table<Row, string> =>
  (e === 'line' ? d.countLines : e === 'product' ? d.products : d.settings) as unknown as Table<Row, string>;

/** Valeurs implicites d'un enregistrement sans horodatage (les réglages par défaut ne sont jamais stockés seuls). */
const implicit = (e: Entity): Record<string, unknown> => (e === 'settings' ? { ...DEFAULT_SETTINGS } : {});

/** Enregistrement de départ quand une opération reçue vise un id inconnu ici (champs non horodatés : l'opération gagne). */
function blank(e: Entity, id: string): Row {
  if (e === 'line') return { id, code: '', name: '', linearQty: 0, stockQty: 0, updatedAt: 0 };
  if (e === 'product') return { id, base: {}, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: Date.now() };
  return { key: 'main', ...DEFAULT_SETTINGS };
}

function notifyQueued() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPS_QUEUED_EVENT));
}

/** Valeurs partagées de `before` (champs partagés seulement), puis `f` appliqué par-dessus. */
function sharedValues(before: Record<string, unknown>, keys: string[], f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k !== 'user' && before[k] !== undefined) out[k] = before[k];
  if (keys.includes('user')) out.user = { ...((before.user as Record<string, unknown> | undefined) ?? {}) };
  for (const [k, v] of Object.entries(f)) {
    const target = k.startsWith('user.') ? (out.user as Record<string, unknown>) : out;
    const field = k.startsWith('user.') ? k.slice('user.'.length) : k;
    if (v === null) delete target[field];
    else target[field] = v;
  }
  return out;
}

/**
 * Écrit `next` (enregistrement complet) pour `e`/`id` et renvoie l'enregistrement stocké (sans horodatages).
 * Les champs partagés modifiés reçoivent un horodatage `t = tick()` ; ils forment l'opération mise en file si le
 * relais est configuré. Les champs non partagés sont pris de `next` tels quels.
 *
 * `base` (R21) : l'état dont l'écran est parti (pavé, formulaire). S'il est donné, seuls les champs partagés où
 * `next` diffère de `base` sont écrits ; les autres gardent la valeur stockée, même si un autre téléphone l'a
 * changée entre-temps (une copie périmée ne défait pas sa modification). Sans `base` : différence avec le stocké.
 *
 * Une ligne jamais horodatée (ligne de jeu créée d'office, ancienne donnée) est partagée en entier à sa première
 * écriture, pour qu'un autre téléphone qui ne la connaît pas la reçoive complète.
 * Peut être appelée dans une transaction englobante, à condition qu'elle inclue la table de l'entité, `opsOut` et
 * `syncState`.
 */
export async function writeShared<T extends object>(e: Entity, id: string, next: T, base?: T): Promise<T> {
  const table = tableFor(e);
  const [stored, queued] = await db.transaction('rw', table, db.opsOut, db.syncState, async (): Promise<[Row, boolean]> => {
    const current = await table.get(id);
    const clock = current?._clock ?? {};
    // L'horloge ne doit jamais être en retard sur un horodatage déjà stocké (stockage local effacé…).
    for (const c of Object.values(clock)) observe(c);
    const record: Record<string, unknown> = withoutClock(next as Row);
    if (e === 'settings') record.key = 'main';
    else record.id = id;

    const keys = sharedKeysFor(e, record);
    const before = { ...implicit(e), ...(current ? withoutClock(current) : {}) };
    let f = diffFields(before, record, keys);
    if (base && current) {
      const fromBase = diffFields({ ...implicit(e), ...withoutClock(base as Row) }, record, keys);
      f = Object.fromEntries(Object.entries(f).filter(([k]) => Object.hasOwn(fromBase, k)));
    }
    const out = { ...record, ...sharedValues(before, keys, f) };
    for (const k of keys) if (k !== 'user' && before[k] === undefined && !(k in f)) delete out[k];
    if (e === 'line' && current) {
      for (const k of keys) if (!Object.hasOwn(clock, k) && out[k] !== undefined && !(k in f)) f[k] = out[k];
    }

    if (Object.keys(f).length === 0) {
      await table.put(current?._clock ? { ...out, _clock: current._clock } : out);
      return [out, false];
    }
    const t = tick();
    const applied = applyFields(current ? { _clock: clock } : undefined, f, t).record;
    await table.put({ ...out, _clock: applied._clock });
    // Sans relais dans cette version de l'app : rien en file, sauf si ce tabac a déjà été synchronisé (R29). Une
    // version construite sans l'adresse du relais ne doit rien perdre : la file partira quand l'adresse reviendra.
    if (!relayUrl() && (await db.syncState.get(SYNCED_KEY)) === undefined) return [out, false];
    await db.opsOut.add({ op: { e, id, f, t } });
    return [out, true];
  });
  if (queued) notifyQueued();
  const { key: _k, ...result } = stored;
  return (e === 'settings' ? result : stored) as T;
}

const ENTITIES = new Set<string>(['line', 'product', 'settings']);
const STAMP = /^(\d{13})-\d{4}-.+$/;
const MAX_AHEAD_MS = 24 * 3_600_000;

type Check = (v: unknown) => boolean;
const isNum: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr: Check = (v) => typeof v === 'string';
const isBool: Check = (v) => typeof v === 'boolean';
const isStrList: Check = (v) => Array.isArray(v) && v.every(isStr);
const isPlain: Check = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar: Check = (v) => isStr(v) || isNum(v) || isBool(v) || isStrList(v);

/** Type attendu de chaque champ partagé (`user.<champ>` : champs connus de ProductFields). */
const VALUE_TYPES: Record<string, Check> = {
  linearQty: isNum, stockQty: isNum, updatedAt: isNum,
  deleted: isBool, outOfStock: isBool,
  gameId: isStr, code: isStr, name: isStr, shopName: isStr, source: isStr,
  sortCount: (v) => v === 'name' || v === 'updatedAt',
  pinnedSubstitutes: isStrList, hiddenGames: isStrList,
  base: isPlain,
  'user.kind': isStr, 'user.name': isStr, 'user.brand': isStr, 'user.format': isStr, 'user.fdjPrefix': isStr,
  'user.origin': isStr, 'user.effectiveDate': isStr, 'user.status': isStr, 'user.gameType': isStr, 'user.notes': isStr,
  'user.nicotineMg': isNum, 'user.strength': isNum, 'user.price': isNum, 'user.previousPrice': isNum,
  'user.ticketPrice': isNum, 'user.maxPrize': isNum,
  'user.isNew': isBool,
  'user.barcodes': isStrList, 'user.tasteTags': isStrList,
};

/** Champs facultatifs : `null` (effacé) n'est accepté que pour eux, jamais pour un champ obligatoire (ligne, produit). */
const OPTIONAL = new Set(['gameId', 'hiddenGames']);

/** Un champ `user.<champ>` inconnu (version plus récente de l'app) n'accepte qu'une valeur simple. */
const validValue = (k: string, v: unknown) =>
  v === null ? OPTIONAL.has(k) || k.startsWith('user.') : (VALUE_TYPES[k] ?? (k.startsWith('user.') ? isScalar : () => false))(v);

/** Garde les seules clés qu'un autre téléphone a le droit d'écrire (R16), avec une valeur du bon type. */
function allowedFields(op: Op, local: Row | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set(SHARED_KEYS[op.e]);
  for (const [k, v] of Object.entries(op.f)) {
    if (!validValue(k, v)) continue;
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

const DEPART = 'depart:';
const FDJ = 'f:';

/**
 * Un jeu de l'ancienne liste de départ (`depart:<nom comparable>`) devient `f:<référence FDJ>` (par exemple
 * `f:fdj|ITGC9K`) quand la liste FDJ le reprend, pas forcément au même moment sur tous les téléphones. Les deux ids ne
 * se déduisent pas l'un de l'autre : seul le nom du jeu les relie (gameKey). Une opération qui vise l'un des deux,
 * absent ici, est réécrite vers la fiche présente : id du produit, ligne `game:<id>` et son `gameId`, remplaçants,
 * jeux enlevés.
 * - `depart:<clé>` absent : le jeu FDJ d'ici dont le nom donne la même clé ;
 * - `f:<référence>` absent : `depart:<clé du nom>` si l'opération donne le nom du jeu (ligne de comptage : `name`).
 *   Sans nom, l'opération attend la liste FDJ (opérations en attente).
 */
function idResolver(d: CarotteDB) {
  const known = new Map<string, boolean>();
  const exists = async (id: string) => {
    if (!known.has(id)) known.set(id, (await d.products.get(id)) !== undefined);
    return known.get(id)!;
  };
  let fdjByKey: Promise<Map<string, string>> | undefined;
  const fdjGame = async (key: string): Promise<string | undefined> => {
    fdjByKey ??= d.products.where('source').equals('fdj').toArray().then((list) => {
      const m = new Map<string, string>();
      for (const p of list) {
        const name = (p.base as { name?: unknown } | undefined)?.name;
        const k = typeof name === 'string' ? gameKey(name) : '';
        if (k && !m.has(k)) m.set(k, p.id);
      }
      return m;
    });
    return (await fdjByKey).get(key);
  };
  const product = async (id: unknown, name?: unknown): Promise<unknown> => {
    if (typeof id !== 'string' || (await exists(id))) return id;
    if (id.startsWith(DEPART)) return (await fdjGame(id.slice(DEPART.length))) ?? id;
    if (id.startsWith(FDJ) && typeof name === 'string' && gameKey(name)) {
      const alt = DEPART + gameKey(name);
      if (await exists(alt)) return alt;
    }
    return id;
  };
  const list = async (v: unknown): Promise<unknown> =>
    Array.isArray(v) ? [...new Set(await Promise.all(v.map((x) => product(x))))] : v;
  return async (op: Op): Promise<Op> => {
    if (op.e === 'settings') return Array.isArray(op.f.hiddenGames) ? { ...op, f: { ...op.f, hiddenGames: await list(op.f.hiddenGames) } } : op;
    if (op.e === 'product') {
      const f = Array.isArray(op.f.pinnedSubstitutes) ? { ...op.f, pinnedSubstitutes: await list(op.f.pinnedSubstitutes) } : op.f;
      return { ...op, id: (await product(op.id, op.f['user.name'])) as string, f };
    }
    let id = op.id;
    const name = op.f.name;
    if (id.startsWith('game:') && (await d.countLines.get(id)) === undefined) {
      id = 'game:' + ((await product(id.slice('game:'.length), name)) as string);
    }
    return 'gameId' in op.f ? { ...op, id, f: { ...op.f, gameId: await product(op.f.gameId, name) } } : { ...op, id };
  };
}

/**
 * Applique des opérations reçues (dans l'ordre) et renvoie le nombre d'opérations qui ont changé quelque chose.
 * Ignorées : opérations mal formées ou d'entité inconnue, réglages autres que `main`, horodatage à plus de 24 h
 * dans le futur (R15, non observé), produit inconnu ici sans fiche créée à la main. Les clés non partagées sont
 * retirées (R16). Rien n'est mis en file : ces opérations viennent déjà du canal.
 * `target` : base du tabac visé (par défaut celle de la page ; le moteur de synchronisation peut en donner une autre).
 */
export async function applyRemoteOps(ops: Op[], target: CarotteDB = db): Promise<number> {
  const limit = Date.now() + MAX_AHEAD_MS;
  let future = 0;
  let orphans = 0;
  let renamed: string | undefined;
  const changes = await target.transaction('rw', target.countLines, target.products, target.settings, async () => {
    const resolve = idResolver(target);
    let n = 0;
    for (const received of ops) {
      if (!wellFormed(received)) continue;
      if (Number(STAMP.exec(received.t)![1]) > limit) {
        future++;
        continue;
      }
      observe(received.t);
      const op = await resolve(received);
      const table = tableFor(op.e, target);
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
  if (renamed !== undefined && target === db) syncRegistryName(dbTabacId, renamed);
  return changes;
}
