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

/**
 * - fiche Douane (ou de départ rattachée à une référence Douane) : `d:<référence Douane>` ;
 * - jeu de la liste FDJ : `f:<clé du jeu>` ;
 * - jeu de l'ancienne liste de départ (sans référence) : `depart:<nom comparable>` ;
 * - fiche créée à la main (ou sans référence) : son id actuel, créé une fois sur un téléphone puis partagé.
 */
export function stableProductId(p: IdSource): string {
  if (p.source === 'utilisateur') return p.id;
  if ((p.source === 'douane' || p.source === 'depart') && p.douaneRef) return 'd:' + p.douaneRef;
  if (p.source === 'fdj' && p.fdjRef) return 'f:' + p.fdjRef;
  if (p.source === 'depart') {
    const name = p.base?.name ?? p.user?.name;
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

const mapId = (map: IdMap, id: string) => map.get(id) ?? id;

/** Liste d'ids réécrite (sans doublon, ordre gardé). */
export function remapIdList(ids: readonly string[], map: IdMap): string[] {
  return [...new Set(ids.map((id) => mapId(map, id)))];
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function remapLineId(id: string, map: IdMap): string {
  return id.startsWith('game:') && map.has(id.slice(5)) ? gameLineId(map.get(id.slice(5))!) : id;
}

/** Opération en file : id du produit, id et `gameId` des lignes de jeu, remplaçants et jeux enlevés réécrits. */
export function remapOp(op: Op, map: IdMap): Op {
  const f = { ...op.f };
  let id = op.id;
  if (op.e === 'product') {
    id = mapId(map, id);
    if (Array.isArray(f.pinnedSubstitutes)) f.pinnedSubstitutes = remapIdList(f.pinnedSubstitutes as string[], map);
  } else if (op.e === 'line') {
    id = remapLineId(id, map);
    if (typeof f.gameId === 'string') f.gameId = mapId(map, f.gameId);
  } else if (Array.isArray(f.hiddenGames)) {
    f.hiddenGames = remapIdList(f.hiddenGames as string[], map);
  }
  return JSON.stringify({ id, f }) === JSON.stringify({ id: op.id, f: op.f }) ? op : { ...op, id, f };
}

type P = Clocked<Product>;
type L = Clocked<CountLine>;
export type OpRow = { seq?: number; op: Op };

const hasUserData = (p: P) =>
  Object.keys(p.user ?? {}).length > 0 || p.outOfStock === true || (p.pinnedSubstitutes ?? []).length > 0 || Object.keys(p._clock ?? {}).length > 0;

/** Entre deux fiches pour le même id : celle qui porte des données du buraliste, puis la plus récente. */
const betterProduct = (a: P, b: P) => (hasUserData(a) !== hasUserData(b) ? hasUserData(a) : a.updatedAt > b.updatedAt);

/** Rien n'est perdu : les champs `user` absents de la fiche gardée (avec leur horodatage) et les remplaçants sont repris. */
function absorb(winner: P, loser: P): P {
  const user = { ...(winner.user ?? {}) } as Record<string, unknown>;
  const clock = { ...(winner._clock ?? {}) };
  for (const [k, v] of Object.entries(loser.user ?? {})) {
    if (k in user) continue;
    user[k] = v;
    const c = loser._clock?.['user.' + k];
    if (c !== undefined) clock['user.' + k] = c;
  }
  const out: P = { ...winner, user, pinnedSubstitutes: [...new Set([...(winner.pinnedSubstitutes ?? []), ...(loser.pinnedSubstitutes ?? [])])] };
  if (Object.keys(clock).length) out._clock = clock;
  return out;
}

/** Entre deux lignes pour le même id : la ligne visible, puis la plus récente. */
const betterLine = (a: L, b: L) => ((a.deleted === true) !== (b.deleted === true) ? b.deleted === true : a.updatedAt > b.updatedAt);

/** Regroupe par nouvel id ; garde la meilleure entrée de chaque groupe ; ids anciens à effacer. */
function regroup<T extends { id: string }>(
  items: T[],
  rewrite: (t: T) => T,
  better: (a: T, b: T) => boolean,
  merge: (winner: T, loser: T) => T,
): { all: T[]; put: T[]; del: string[] } {
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
  for (const [id, g] of groups) {
    let winner = g[0].next;
    for (const { next } of g.slice(1)) winner = better(next, winner) ? merge(next, winner) : merge(winner, next);
    all.push(winner);
    if (g.length > 1 || g[0].next !== g[0].orig) put.push(winner);
    for (const { orig } of g) if (orig.id !== id) del.add(orig.id);
  }
  for (const t of put) del.delete(t.id);
  return { all, put, del: [...del] };
}

export type IdState = { products: P[]; lines: L[]; hiddenGames?: string[]; ops?: OpRow[] };
export type IdChanges = {
  products: P[]; productPut: P[]; productDel: string[];
  lines: L[]; linePut: L[]; lineDel: string[];
  hiddenGames?: string[]; hiddenChanged: boolean;
  ops: OpRow[]; // seulement les opérations réécrites
};

/**
 * Applique `map` (ancien id → nouvel id) à tout ce qui désigne un produit : fiches (horodatages gardés),
 * remplaçants, lignes de comptage (`gameId`, id `game:<id>`), jeux enlevés, opérations en file.
 * Deux fiches (ou deux lignes) qui reçoivent le même id n'en font plus qu'une, sans perdre de donnée du buraliste.
 */
export function remapProductIds(state: IdState, map: IdMap): IdChanges {
  const products = regroup<P>(
    state.products,
    (p) => {
      const id = mapId(map, p.id);
      const pinned = remapIdList(p.pinnedSubstitutes ?? [], map);
      return id === p.id && sameList(pinned, p.pinnedSubstitutes ?? []) ? p : { ...p, id, pinnedSubstitutes: pinned };
    },
    betterProduct,
    absorb,
  );
  const lines = regroup<L>(
    state.lines,
    (l) => {
      const id = remapLineId(l.id, map);
      const gameId = l.gameId === undefined ? undefined : mapId(map, l.gameId);
      return id === l.id && gameId === l.gameId ? l : { ...l, id, ...(gameId === undefined ? {} : { gameId }) };
    },
    betterLine,
    (w) => w,
  );
  const hiddenGames = state.hiddenGames && remapIdList(state.hiddenGames, map);
  const ops: OpRow[] = [];
  for (const row of state.ops ?? []) {
    const op = remapOp(row.op, map);
    if (op !== row.op) ops.push({ ...row, op });
  }
  return {
    products: products.all, productPut: products.put, productDel: products.del,
    lines: lines.all, linePut: lines.put, lineDel: lines.del,
    hiddenGames, hiddenChanged: !!state.hiddenGames && !sameList(hiddenGames!, state.hiddenGames),
    ops,
  };
}
