/**
 * Photographie d'un tabac (spec §3.4, §4.3) : l'état partagé complet, `{ v: 1, etat }` une fois chiffré.
 * `etat` contient chaque enregistrement qui porte des données partagées (lignes, y compris supprimées ; produits
 * créés à la main ou avec des données du buraliste ; réglages `main`), avec ses seuls champs partagés et `_clock`.
 *
 * Une valeur jamais horodatée (donnée d'avant le partage) reçoit un horodatage « d'origine » : la date de la ligne
 * (`updatedAt`), sinon 0. Toute modification réelle plus récente l'emporte. Dans une photographie, il porte
 * l'identifiant de ce téléphone ; enregistré localement avant d'appliquer une photographie (`stampLegacy`), il porte
 * LOCAL_LEGACY_DEVICE, qui perd toute égalité contre une photographie (voir plus bas).
 * Un réglage jamais horodaté qui a encore sa valeur par défaut n'est pas publié (rien à apprendre aux autres).
 * Appliquer une photographie fusionne champ par champ, chaque champ avec SON horodatage (jamais ré-horodaté).
 */
import { DEFAULT_SETTINGS, type CarotteDB } from '../data/db';
import { applyRemoteOps, sharedKeysFor, tableFor, type Entity } from '../data/sharedRepo';
import { deviceId } from './clock';
import type { Op } from './merge';

type Rec = Record<string, unknown>;
export type EtatRecord = Rec & { id: string; _clock: Record<string, string> };
export type Etat = { line: EtatRecord[]; product: EtatRecord[]; settings: EtatRecord[]; task: EtatRecord[] };

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const ENTITIES: Entity[] = ['settings', 'product', 'line', 'task'];

/**
 * Partie « appareil » des horodatages d'origine enregistrés localement. Les horodatages se comparent comme des chaînes
 * et les identifiants d'appareil s'écrivent en [0-9a-z] (clock.ts) : « ! » (0x21) est inférieur à « 0 » (0x30), donc
 * à n'importe quel appareil. À heure égale, la valeur d'une photographie l'emporte sur une valeur locale jamais saisie
 * ici (réglages écrits d'office dans la base neuve d'un tabac rejoint, lignes de jeu jamais comptées).
 */
export const LOCAL_LEGACY_DEVICE = '!';

/** Horodatage d'origine d'une valeur sans horodatage : date de la ligne (jamais dans le futur), sinon 0. */
function legacyStamp(e: Entity, r: Rec, device: string): string {
  const u = r.updatedAt;
  const ms = e === 'line' && typeof u === 'number' && Number.isFinite(u) ? Math.min(Math.max(0, Math.floor(u)), Date.now()) : 0;
  return `${String(ms).padStart(13, '0')}-0000-${device}`;
}

/** Horodatage de chaque champ partagé : celui enregistré, sinon l'horodatage d'origine pour une valeur présente. */
function fullClock(e: Entity, r: Rec, device: string): Record<string, string> {
  const own = isObj(r._clock) ? r._clock : {};
  const keys = sharedKeysFor(e, r);
  const shared = (k: string) => (k.startsWith('user.') ? keys.includes('user') : k !== 'user' && keys.includes(k));
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(own)) if (shared(k) && typeof t === 'string') out[k] = t;
  const legacy = legacyStamp(e, r, device);
  for (const k of keys) {
    if (k === 'user') {
      for (const [uk, uv] of Object.entries(isObj(r.user) ? r.user : {})) if (uv !== undefined) out['user.' + uk] ??= legacy;
    } else if (r[k] !== undefined && r[k] !== null) {
      out[k] ??= legacy;
    }
  }
  return out;
}

/** Produit qui porte des données partagées (sinon chaque téléphone l'a déjà par les listes publiques). */
function productHasData(p: Rec): boolean {
  return p.source === 'utilisateur'
    || (isObj(p._clock) && Object.keys(p._clock).length > 0)
    || (isObj(p.user) && Object.keys(p.user).length > 0)
    || p.outOfStock === true
    || (Array.isArray(p.pinnedSubstitutes) && p.pinnedSubstitutes.length > 0);
}

/** Ligne saisie ici (pas seulement une ligne de jeu jamais comptée, que chaque téléphone déduit de son catalogue). */
function lineHasData(l: Rec): boolean {
  return !String(l.id).startsWith('game:')
    || (isObj(l._clock) && Object.keys(l._clock).length > 0)
    || (typeof l.linearQty === 'number' && l.linearQty !== 0)
    || (typeof l.stockQty === 'number' && l.stockQty !== 0)
    || l.deleted === true;
}

/** Tâche créée ou modifiée ici (pas seulement une tâche de la liste de base, que chaque téléphone crée lui-même). */
function taskHasData(t: Rec): boolean {
  return !String(t.id).startsWith('base:') || (isObj(t._clock) && Object.keys(t._clock).length > 0);
}

function etatRecord(e: Entity, r: Rec): EtatRecord {
  const out: Rec = { id: e === 'settings' ? 'main' : String(r.id) };
  const keys = sharedKeysFor(e, r);
  for (const k of keys) {
    if (k === 'user') {
      if (isObj(r.user)) out.user = { ...r.user };
    } else if (r[k] !== undefined && r[k] !== null) {
      out[k] = r[k];
    }
  }
  const clock = fullClock(e, r, deviceId());
  if (e === 'settings') {
    const own = isObj(r._clock) ? r._clock : {};
    const defaults = DEFAULT_SETTINGS as unknown as Rec;
    for (const k of keys) {
      if (!Object.hasOwn(own, k) && defaults[k] !== undefined && JSON.stringify(r[k]) === JSON.stringify(defaults[k])) {
        delete out[k];
        delete clock[k];
      }
    }
  }
  out._clock = clock;
  return out as EtatRecord;
}

async function readAll(d: CarotteDB): Promise<{ line: Rec[]; product: Rec[]; settings: Rec[]; task: Rec[] }> {
  return d.transaction('r', [d.countLines, d.products, d.settings, d.tasks], async () => {
    const [lines, products, settings, tasks] = await Promise.all([d.countLines.toArray(), d.products.toArray(), d.settings.get('main'), d.tasks.toArray()]);
    return {
      task: tasks as unknown as Rec[],
      line: lines as unknown as Rec[],
      product: (products as unknown as Rec[]).filter(productHasData),
      settings: settings ? [settings as unknown as Rec] : [],
    };
  });
}

/** État partagé complet de la base, pour une photographie. */
export async function buildEtat(d: CarotteDB): Promise<Etat> {
  const all = await readAll(d);
  return {
    line: all.line.map((r) => etatRecord('line', r)),
    product: all.product.map((r) => etatRecord('product', r)),
    settings: all.settings.map((r) => etatRecord('settings', r)),
    task: all.task.map((r) => etatRecord('task', r)),
  };
}

/** La base a des données à partager (premier contact d'un tabac existant avec le relais). */
export async function hasLocalData(d: CarotteDB): Promise<boolean> {
  const all = await readAll(d);
  return all.line.some(lineHasData) || all.product.length > 0 || all.task.some(taskHasData)
    || all.settings.some((s) => isObj(s._clock) && Object.keys(s._clock).length > 0);
}

/**
 * Avant d'appliquer une photographie à une base qui a déjà des données : chaque valeur partagée sans horodatage reçoit
 * son horodatage d'origine (enregistré, valeurs inchangées), avec l'appareil LOCAL_LEGACY_DEVICE. Sans cela, n'importe
 * quelle valeur reçue la remplacerait, même une ligne jamais comptée face à un comptage local plus récent ; avec lui,
 * à heure égale (réglages, lignes jamais comptées : heure 0), c'est la photographie qui gagne.
 */
export async function stampLegacy(d: CarotteDB): Promise<void> {
  await d.transaction('rw', [d.countLines, d.products, d.settings, d.tasks], async () => {
    const all = await readAll(d);
    for (const e of ENTITIES) {
      const table = tableFor(e, d) as unknown as { put(r: Rec): Promise<unknown> };
      for (const r of all[e]) {
        const own = isObj(r._clock) ? r._clock : {};
        const clock = fullClock(e, r, LOCAL_LEGACY_DEVICE);
        if (Object.keys(clock).some((k) => !Object.hasOwn(own, k))) await table.put({ ...r, _clock: { ...own, ...clock } });
      }
    }
  });
}

/** Opérations équivalentes à un enregistrement de photographie : une par horodatage (`source` d'abord). */
function recordOps(e: Entity, rec: unknown): Op[] {
  if (!isObj(rec) || typeof rec.id !== 'string' || !isObj(rec._clock)) return [];
  const user = isObj(rec.user) ? rec.user : {};
  const groups = new Map<string, Rec>();
  for (const [k, t] of Object.entries(rec._clock)) {
    if (typeof t !== 'string' || FORBIDDEN.has(k)) continue;
    const field = k.startsWith('user.') ? k.slice('user.'.length) : undefined;
    if (field !== undefined && FORBIDDEN.has(field)) continue;
    const v = field !== undefined ? (Object.hasOwn(user, field) ? user[field] : undefined) : Object.hasOwn(rec, k) ? rec[k] : undefined;
    const g = groups.get(t) ?? {};
    g[k] = v === undefined ? null : v;
    groups.set(t, g);
  }
  const ops: Op[] = [...groups].map(([t, f]) => ({ e, id: rec.id as string, f, t }));
  // Une fiche créée à la main n'existe ailleurs qu'à partir de l'opération qui porte `source`.
  return ops.sort((a, b) => Number('source' in b.f) - Number('source' in a.f));
}

/** Applique une photographie (fusion champ par champ) ; renvoie le nombre d'opérations qui ont changé quelque chose. */
export async function applyEtat(d: CarotteDB, etat: unknown): Promise<number> {
  if (!isObj(etat)) return 0;
  const ops: Op[] = [];
  for (const e of ENTITIES) {
    const list = etat[e];
    if (Array.isArray(list)) for (const rec of list) for (const op of recordOps(e, rec)) ops.push(op);
  }
  return ops.length ? applyRemoteOps(ops, d) : 0;
}
