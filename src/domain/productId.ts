/**
 * Identifiants stables (R20) : les opérations entre téléphones visent un enregistrement par son id, donc une fiche
 * officielle doit avoir le même id sur tous les téléphones d'un tabac. Il est déduit de sa référence publique.
 * Module pur : pas de Dexie, pas de DOM.
 */
import type { Clocked, Op } from '../sync/merge';
import type { CountLine, Product, ProductFields } from './types';

/** Nom comparable : sans casse, accents ni ponctuation (« Goal ! » = « Goal », « CASH » = « Cash »). */
export function gameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}


type IdSource = Pick<Product, 'id' | 'source' | 'douaneRef' | 'fdjRef'> & { base?: Partial<ProductFields>; user?: Partial<ProductFields> };

const isRef = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * - fiche Douane (ou de départ rattachée à une référence Douane) : `d:<référence Douane>` ;
 * - jeu de la liste FDJ : `f:<clé du jeu>` ;
 * - jeu de l'ancienne liste de départ (sans référence) : `depart:<nom comparable>` ;
 * - fiche créée à la main, ou sans référence utilisable (vide) : son id actuel, créé une fois sur un téléphone.
 * Ne renvoie jamais une chaîne vide pour une fiche qui a un id (les fusions ignorent les références vides).
 */
export function stableProductId(p: IdSource): string {
  if (p.source === 'utilisateur') return p.id;
  if ((p.source === 'douane' || p.source === 'depart') && isRef(p.douaneRef)) return 'd:' + p.douaneRef;
  if (p.source === 'fdj' && isRef(p.fdjRef)) return 'f:' + p.fdjRef;
  if (p.source === 'depart') {
    const name = isObj(p.base) && typeof p.base.name === 'string' ? p.base.name : isObj(p.user) ? p.user.name : undefined;
    const key = typeof name === 'string' ? gameKey(name) : '';
    if (key) return 'depart:' + key;
  }
  return p.id;
}

/** Ligne de comptage d'un jeu du catalogue : son id dépend du jeu (le même sur tous les téléphones). */
export const gameLineId = (gameId: string) => 'game:' + gameId;

export type IdMap = ReadonlyMap<string, string>;

/** Ancien id → id stable, pour les seules fiches dont l'id change. */
export function productIdMap(products: IdSource[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of products) {
    const s = stableProductId(p);
    if (s !== p.id) map.set(p.id, s);
  }
  return map;
}

const mapId = <T>(map: IdMap, id: T): T => (typeof id === 'string' ? ((map.get(id) ?? id) as T) : id);

/**
 * Liste d'ids réécrite (sans doublon, ordre gardé). Totale : une valeur qui n'est pas une liste (donnée abîmée)
 * est rendue telle quelle, un élément qui n'est pas une chaîne aussi.
 */
export function remapIdList<T>(ids: T, map: IdMap): T {
  if (!Array.isArray(ids)) return ids;
  return [...new Set(ids.map((id: unknown) => mapId(map, id)))] as T;
}

const sameList = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

function remapLineId<T>(id: T, map: IdMap): T {
  return typeof id === 'string' && id.startsWith('game:') && map.has(id.slice(5)) ? (gameLineId(map.get(id.slice(5))!) as T) : id;
}

/** Opération en file : id du produit, id et `gameId` des lignes de jeu, remplaçants et jeux enlevés réécrits. */
export function remapOp(op: Op, map: IdMap): Op {
  if (!isObj(op) || !isObj(op.f)) return op;
  const f = { ...op.f };
  let id = op.id;
  if (op.e === 'product') {
    id = mapId(map, id);
    f.pinnedSubstitutes = remapIdList(f.pinnedSubstitutes, map);
  } else if (op.e === 'line') {
    id = remapLineId(id, map);
    f.gameId = mapId(map, f.gameId);
  } else {
    f.hiddenGames = remapIdList(f.hiddenGames, map);
  }
  for (const k of ['pinnedSubstitutes', 'gameId', 'hiddenGames']) if (f[k] === undefined && !(k in op.f)) delete f[k];
  return JSON.stringify({ id, f }) === JSON.stringify({ id: op.id, f: op.f }) ? op : { ...op, id, f };
}

type P = Clocked<Product>;
type L = Clocked<CountLine>;
export type OpRow = { seq?: number; op: Op };

const clockOf = (p: P, k: string): string | undefined => {
  const c = isObj(p._clock) ? p._clock[k] : undefined;
  return typeof c === 'string' ? c : undefined;
};
const userOf = (p: P): Record<string, unknown> => (isObj(p.user) ? p.user : {});

const hasUserData = (p: P) =>
  Object.keys(userOf(p)).length > 0 || p.outOfStock === true
  || (Array.isArray(p.pinnedSubstitutes) && p.pinnedSubstitutes.length > 0) || (isObj(p._clock) && Object.keys(p._clock).length > 0);

/** Entre deux fiches pour le même id : celle qui porte des données du buraliste, puis la plus récente. */
const betterProduct = (a: P, b: P) => (hasUserData(a) !== hasUserData(b) ? hasUserData(a) : a.updatedAt > b.updatedAt);

/** Fiche qui donne le champ `k` : l'horodatage le plus récent ; une valeur horodatée l'emporte sur une valeur sans. */
function newer(w: P, l: P, k: string): P {
  const cw = clockOf(w, k);
  const cl = clockOf(l, k);
  return cl !== undefined && (cw === undefined || cl > cw) ? l : w;
}

/**
 * Deux fiches pour le même id n'en font qu'une, champ partagé par champ partagé (`outOfStock`, `pinnedSubstitutes`,
 * chaque `user.<champ>`) : la valeur dont l'horodatage est le plus récent gagne. Sans horodatage des deux côtés :
 * la valeur de la fiche préférée `w` (un champ `user` qu'elle n'a pas est repris de l'autre ; remplaçants réunis).
 */
function mergeDuplicate(w: P, l: P): P {
  const clock: Record<string, string> = { ...(isObj(l._clock) ? (l._clock as Record<string, string>) : {}), ...(isObj(w._clock) ? (w._clock as Record<string, string>) : {}) };
  const take = (k: string, from: P) => {
    const c = clockOf(from, k);
    if (c !== undefined) clock[k] = c;
  };
  const out: P = { ...w, updatedAt: Math.max(Number(w.updatedAt) || 0, Number(l.updatedAt) || 0) };

  const o = newer(w, l, 'outOfStock');
  out.outOfStock = o.outOfStock;
  take('outOfStock', o);

  const unclockedPins = clockOf(w, 'pinnedSubstitutes') === undefined && clockOf(l, 'pinnedSubstitutes') === undefined;
  if (unclockedPins && Array.isArray(w.pinnedSubstitutes) && Array.isArray(l.pinnedSubstitutes)) {
    out.pinnedSubstitutes = [...new Set([...w.pinnedSubstitutes, ...l.pinnedSubstitutes])];
  } else {
    const s = newer(w, l, 'pinnedSubstitutes');
    out.pinnedSubstitutes = s.pinnedSubstitutes;
    take('pinnedSubstitutes', s);
  }

  const wu = userOf(w);
  const lu = userOf(l);
  const user: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(wu), ...Object.keys(lu)])) {
    const key = 'user.' + k;
    const unclocked = clockOf(w, key) === undefined && clockOf(l, key) === undefined;
    const from = unclocked ? (k in wu ? w : l) : newer(w, l, key);
    const u = from === w ? wu : lu;
    if (k in u) user[k] = u[k];
    take(key, from);
  }
  out.user = user as Product['user'];
  if (Object.keys(clock).length) out._clock = clock;
  else delete out._clock;
  return out;
}

/** Entre deux lignes pour le même id : la plus récente (`updatedAt`), puis la ligne visible. */
const betterLine = (a: L, b: L) => (a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.deleted !== true && b.deleted === true);

/** Regroupe par nouvel id ; garde la meilleure entrée de chaque groupe ; ids anciens à effacer et perdants. */
function regroup<T extends { id: string }>(
  items: T[],
  rewrite: (t: T) => T,
  better: (a: T, b: T) => boolean,
  merge: (winner: T, loser: T) => T,
): { all: T[]; put: T[]; del: string[]; losers: string[] } {
  const groups = new Map<string, { orig: T; next: T }[]>();
  for (const orig of items) {
    const next = rewrite(orig);
    const g = groups.get(next.id);
    if (g) g.push({ orig, next });
    else groups.set(next.id, [{ orig, next }]);
  }
  const all: T[] = [];
  const put: T[] = [];
  const del = new Set<string>();
  const losers: string[] = [];
  for (const [id, g] of groups) {
    let winner = g[0].next;
    let winnerOrig = g[0].orig;
    for (const { orig, next } of g.slice(1)) {
      if (better(next, winner)) {
        winner = merge(next, winner);
        winnerOrig = orig;
      } else {
        winner = merge(winner, next);
      }
    }
    all.push(winner);
    if (g.length > 1 || g[0].next !== g[0].orig) put.push(winner);
    for (const { orig } of g) {
      if (orig.id !== id) del.add(orig.id);
      if (orig !== winnerOrig) losers.push(orig.id);
    }
  }
  for (const t of put) del.delete(t.id);
  return { all, put, del: [...del], losers };
}

export type IdState = { products: P[]; lines: L[]; hiddenGames?: string[]; ops?: OpRow[] };
export type IdChanges = {
  products: P[]; productPut: P[]; productDel: string[];
  lines: L[]; linePut: L[]; lineDel: string[];
  hiddenGames?: string[]; hiddenChanged: boolean;
  ops: OpRow[]; // seulement les opérations réécrites
  opDel: number[]; // opérations en file d'une ligne en double écartée (seq)
};

/**
 * Applique `map` (ancien id → nouvel id) à tout ce qui désigne un produit : fiches (horodatages gardés),
 * remplaçants, lignes de comptage (`gameId`, id `game:<id>`), jeux enlevés, opérations en file.
 * Totale : une donnée abîmée (liste qui n'en est pas une…) est laissée telle quelle, jamais d'exception.
 * Deux fiches qui reçoivent le même id fusionnent champ par champ (voir mergeDuplicate). Deux lignes qui reçoivent
 * le même id : la plus récente reste ; les opérations en file de l'autre sont retirées (et non reportées sur la
 * ligne gardée, dont elles écraseraient les quantités avec celles d'un double).
 */
export function remapProductIds(state: IdState, map: IdMap): IdChanges {
  const products = regroup<P>(
    state.products,
    (p) => {
      const id = mapId(map, p.id);
      const pinned = remapIdList(p.pinnedSubstitutes, map);
      return id === p.id && sameList(pinned, p.pinnedSubstitutes) ? p : { ...p, id, pinnedSubstitutes: pinned };
    },
    betterProduct,
    mergeDuplicate,
  );
  const lines = regroup<L>(
    state.lines,
    (l) => {
      const id = remapLineId(l.id, map);
      const gameId = mapId(map, l.gameId);
      return id === l.id && gameId === l.gameId ? l : { ...l, id, ...(gameId === undefined ? {} : { gameId }) };
    },
    betterLine,
    (w) => w,
  );
  const hiddenGames = remapIdList(state.hiddenGames, map);
  const dropped = new Set(lines.losers);
  const ops: OpRow[] = [];
  const opDel: number[] = [];
  for (const row of state.ops ?? []) {
    if (isObj(row?.op) && row.op.e === 'line' && dropped.has(row.op.id)) {
      if (typeof row.seq === 'number') opDel.push(row.seq);
      continue;
    }
    const op = remapOp(row.op, map);
    if (op !== row.op) ops.push({ ...row, op });
  }
  return {
    products: products.all, productPut: products.put, productDel: products.del,
    lines: lines.all, linePut: lines.put, lineDel: lines.del,
    hiddenGames, hiddenChanged: !sameList(hiddenGames, state.hiddenGames),
    ops, opDel,
  };
}
