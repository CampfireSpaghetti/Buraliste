import Dexie, { type Table } from 'dexie';
import type { CountLine, Product, ProductFields, Settings } from '../domain/types';
import { officialRef, type Contribution } from '../domain/sharing';
import { productIdMap, remapIdList, remapOp, remapProductIds, type IdMap } from '../domain/productId';
import { withoutClock, type Clocked, type Op } from '../sync/merge';
import { withoutUserCode } from '../domain/matching';
import { currentTabac, DEFAULT_TABAC_NAME, dbNameFor, ensureRegistry, listTabacs, syncRegistryName } from '../tabacs/registry';
// Import circulaire voulu avec sharedRepo.ts : chacun n'utilise l'autre que dans des fonctions (voir sharedRepo.ts).
import { writeShared } from './sharedRepo';

export type OutboxItem = Contribution & { id?: number; createdAt: number };

export type OpOut = { seq?: number; op: Op };
/** Opération reçue pour un produit inconnu ici (liste plus récente ailleurs), gardée pour plus tard ; `at` : reçue le. */
export type ParkedOp = { seq?: number; op: Op; at: number };
export type SyncStateRow = { key: string; value: unknown };

type SettingsRow = Settings & { key: 'main' };

export const DEFAULT_SETTINGS: Settings = { shopName: DEFAULT_TABAC_NAME, sortCount: 'name' };

export class CarotteDB extends Dexie {
  // Enregistrements partagés : `_clock` garde l'horodatage HLC de chaque champ partagé (voir sharedRepo.ts).
  products!: Table<Clocked<Product>, string>;
  countLines!: Table<Clocked<CountLine>, string>;
  settings!: Table<Clocked<SettingsRow>, string>;
  outbox!: Table<OutboxItem, number>;
  opsOut!: Table<OpOut, number>;
  syncState!: Table<SyncStateRow, string>;
  parkedOps!: Table<ParkedOp, number>;
  constructor(name = 'la-carotte') {
    super(name);
    this.version(1).stores({
      products: 'id, douaneRef, source, updatedAt',
      countLines: 'id, gameId, updatedAt',
      settings: 'key',
    });
    // v2 : « quantity » devient linéaire + stock.
    this.version(2).stores({}).upgrade((tx) =>
      tx.table('countLines').toCollection().modify((l: Record<string, unknown>) => {
        if ('quantity' in l) {
          l.linearQty = l.quantity;
          l.stockQty = 0;
          delete l.quantity;
        }
      }),
    );
    // v3 : file d'attente des codes à partager.
    this.version(3).stores({ outbox: '++id, createdAt' });
    // v4 : opérations à envoyer et état de la synchronisation entre téléphones.
    this.version(4).stores({ opsOut: '++seq', syncState: 'key' });
    // v5 : ids stables des fiches officielles (R20), et tout ce qui les désigne. Ne doit jamais empêcher l'ouverture.
    this.version(5).stores({}).upgrade(async (tx) => {
      try {
        const map = await normalizeProductIds({
          products: tx.table('products'), countLines: tx.table('countLines'), settings: tx.table('settings'), opsOut: tx.table('opsOut'),
        });
        tx.on('complete', () => remapRecent(map));
      } catch (e) {
        console.error('Ids stables des produits : migration non faite', e);
      }
    });
    // v6 : opérations reçues pour des produits encore inconnus ici, rejouées après chaque mise à jour des listes.
    this.version(6).stores({ parkedOps: '++seq, at' });
  }
}

export type IdTables = {
  products: Table<Clocked<Product>, string>;
  countLines: Table<Clocked<CountLine>, string>;
  settings: Table<Clocked<SettingsRow>, string>;
  opsOut: Table<OpOut, number>;
  /** Absente pendant la migration v5 (la table naît en v6). */
  parkedOps?: Table<ParkedOp, number>;
};

/**
 * Passe chaque fiche à son id stable (`stableProductId`) et réécrit tout ce qui la désigne : remplaçants, lignes de
 * comptage, jeux enlevés, opérations en file. Horodatages gardés, aucune opération produite : chaque téléphone fait
 * la même chose de son côté. Les opérations en attente (`parkedOps`) sont réécrites avec la même table des ids.
 * À appeler dans une transaction qui inclut ces tables ; renvoie la table des ids,
 * à passer à `remapRecent` une fois la transaction validée (la liste des récents n'est pas dans la base).
 *
 * Toutes les écritures passent avant tout effacement : si l'une échoue (et que l'appelant rattrape l'erreur), le pire
 * est un doublon (ancien id + nouvel id), que la prochaine normalisation fusionne ; jamais une donnée perdue.
 * Relancée, elle ne fait rien (les ids sont déjà stables).
 */
export async function normalizeProductIds(t: IdTables): Promise<IdMap> {
  const products = await t.products.toArray();
  const map = productIdMap(products);
  if (map.size === 0) return map;
  const [lines, settings, ops] = await Promise.all([t.countLines.toArray(), t.settings.get('main'), t.opsOut.toArray()]);
  const c = remapProductIds({ products, lines, hiddenGames: settings?.hiddenGames, ops }, map);
  await t.products.bulkPut(c.productPut);
  await t.countLines.bulkPut(c.linePut);
  if (settings && c.hiddenChanged) await t.settings.put({ ...settings, hiddenGames: c.hiddenGames });
  if (c.ops.length) await t.opsOut.bulkPut(c.ops);
  if (t.parkedOps) await remapParkedOps(t.parkedOps, map);
  await t.products.bulkDelete(c.productDel);
  await t.countLines.bulkDelete(c.lineDel);
  if (c.opDel.length) await t.opsOut.bulkDelete(c.opDel);
  return map;
}

/** Réécrit les opérations en attente avec une table des ids (produit visé, remplaçants, lignes de jeu, jeux enlevés). */
export async function remapParkedOps(table: Table<ParkedOp, number>, map: IdMap): Promise<void> {
  if (map.size === 0) return;
  const changed: ParkedOp[] = [];
  for (const row of await table.toArray()) {
    const op = remapOp(row.op, map);
    if (op !== row.op) changed.push({ ...row, op });
  }
  if (changed.length) await table.bulkPut(changed);
}

/** Produits consultés récemment (sur ce téléphone). */
export const RECENT_KEY = 'carotte:recent';

/** Liste des produits récents (localStorage) réécrite avec les nouveaux ids : seulement après la transaction validée. */
export function remapRecent(map: IdMap) {
  if (map.size === 0) return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : undefined;
    if (Array.isArray(ids) && ids.some((id) => map.has(id))) localStorage.setItem(RECENT_KEY, JSON.stringify(remapIdList(ids, map)));
  } catch {
    /* stockage indisponible : les ids inconnus sont ignorés à la lecture */
  }
}

/** Ouvre la base d'un tabac (« la-carotte » pour `principal`, sinon « la-carotte-<id> »). */
export const openTabacDb = (id: string): CarotteDB => new CarotteDB(dbNameFor(id));

// Ce module est évalué avant main.tsx : le registre doit exister avant d'ouvrir la base.
// Changer de tabac recharge la page, donc `db` reste constant pour la durée de la page.
ensureRegistry(DEFAULT_TABAC_NAME);
/** Tabac dont cette page a ouvert la base (un autre onglet peut changer le tabac courant du registre). */
export const dbTabacId = currentTabac().id;
export const db = openTabacDb(dbTabacId);

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main');
  if (!row) return { ...DEFAULT_SETTINGS };
  const { key: _key, _clock: _c, ...s } = row;
  return { ...DEFAULT_SETTINGS, ...s };
}

/** Réglages : `shopName`, `sortCount`, `hiddenGames` sont partagés ; le reste reste sur ce téléphone. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = await db.transaction('rw', db.settings, db.opsOut, db.syncState, async () => {
    const merged = { ...(await getSettings()), ...patch };
    await writeShared('settings', 'main', merged);
    return merged;
  });
  if (patch.shopName !== undefined) syncRegistryName(dbTabacId, next.shopName);
  return next;
}

/** Jeux enlevés de la liste : lus dans la transaction, jamais reconstruits depuis une copie de l'écran (R21). */
async function updateHiddenGames(fn: (ids: string[]) => string[]): Promise<Settings> {
  return db.transaction('rw', db.settings, db.opsOut, db.syncState, async () => {
    const current = await getSettings();
    const before = current.hiddenGames ?? [];
    const after = fn(before);
    if (after.length === before.length && after.every((g, i) => g === before[i])) return current;
    return saveSettings({ hiddenGames: after });
  });
}

export const hideGame = (gameId: string) => updateHiddenGames((ids) => (ids.includes(gameId) ? ids : [...ids, gameId]));
export const unhideGame = (gameId: string) => updateHiddenGames((ids) => ids.filter((g) => g !== gameId));

/**
 * Au démarrage : le nom du tabac dans le registre suit `settings.shopName`. Dans une base neuve (tabac créé ou
 * rejoint), il n'y a pas encore de réglages : on y écrit le nom du registre, sans horloge, pour que les
 * réglages venus des autres téléphones l'emportent ensuite.
 */
export async function syncSettingsNameAtStartup(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('main');
    if (row) {
      syncRegistryName(dbTabacId, row.shopName);
      return;
    }
    const entry = listTabacs().find((t) => t.id === dbTabacId);
    if (entry) await db.settings.put({ ...DEFAULT_SETTINGS, shopName: entry.name, key: 'main' });
  });
}

export const listProducts = () => db.products.toArray();
export const getProduct = (id: string) => db.products.get(id);

/** `base` : la fiche dont le formulaire est parti (R21) ; seuls les champs changés depuis sont écrits. */
export async function putProduct(p: Product, base?: Product): Promise<Product> {
  const next = { ...withoutClock<Product>(p), updatedAt: Date.now() };
  return writeShared('product', next.id, next, base && withoutClock<Product>(base));
}

async function update(id: string, fn: (p: Product) => Product): Promise<Product> {
  return db.transaction('rw', db.products, db.opsOut, db.syncState, async () => {
    const p = await db.products.get(id);
    if (!p) throw new Error(`Produit introuvable : ${id}`);
    return putProduct(fn(withoutClock<Product>(p)));
  });
}

export const patchUserFields = (id: string, patch: Partial<ProductFields>) =>
  update(id, (p) => ({ ...p, user: { ...p.user, ...patch } }));

/**
 * Retire un code-barres ou un préfixe de jeu ajouté ici (couche user, partagée dans le tabac). Sa contribution à la liste
 * commune, si elle n'est pas encore partie, est effacée de la file d'envoi (R3) ; une contribution déjà envoyée reste.
 */
export const removeUserCode = (id: string, code: string) =>
  db.transaction('rw', db.products, db.opsOut, db.syncState, db.outbox, async () => {
    const after = await update(id, (p) => ({ ...p, user: withoutUserCode(p.user, code) }));
    const ref = officialRef(after);
    if (ref) {
      const stale = (await db.outbox.toArray()).filter((i) => i.ref === ref && (i.kind === 'barcode' ? i.code === code : i.prefix === code));
      if (stale.length) await db.outbox.bulkDelete(stale.map((i) => i.id!));
    }
    return after;
  });

export const clearUserField = (id: string, key: keyof ProductFields) =>
  update(id, (p) => {
    const user = { ...p.user };
    delete user[key];
    return { ...p, user };
  });

export const setOutOfStock = (id: string, v: boolean) => update(id, (p) => ({ ...p, outOfStock: v }));
export const setPinned = (id: string, ids: string[]) => update(id, (p) => ({ ...p, pinnedSubstitutes: ids }));

/** Lignes visibles : une ligne supprimée (`deleted: true`) est gardée comme pierre tombale, mais n'apparaît plus. */
export const listCountLines = async (): Promise<CountLine[]> =>
  (await db.countLines.toArray()).filter((l) => l.deleted !== true).map((l) => withoutClock<CountLine>(l));

/** `base` : la ligne dont le pavé ou le formulaire est parti (R21) ; seuls les champs changés depuis sont écrits. */
export async function upsertCountLine(line: CountLine, base?: CountLine): Promise<CountLine> {
  const next = { ...withoutClock<CountLine>(line), updatedAt: Date.now(), deleted: false };
  return writeShared('line', next.id, next, base && { ...withoutClock<CountLine>(base), deleted: false });
}

/** Marque la ligne supprimée (partagé) et la renvoie telle qu'elle était, pour l'annulation. */
export async function deleteCountLine(id: string): Promise<CountLine> {
  return db.transaction('rw', db.countLines, db.opsOut, db.syncState, async () => {
    const stored = await db.countLines.get(id);
    if (!stored || stored.deleted === true) throw new Error(`Ligne introuvable : ${id}`);
    const line = withoutClock<CountLine>(stored);
    await writeShared('line', id, { ...line, deleted: true });
    return line;
  });
}

/**
 * Lignes « jamais comptées » des jeux du catalogue : une ligne neuve est ajoutée telle quelle, sans opération
 * (chaque téléphone les déduit de son catalogue). Une ligne supprimée du même id revient (`deleted: false`,
 * partagé) : `missingGameLines` ne la propose que si le jeu n'est pas enlevé de la liste.
 */
export async function addCountLines(lines: CountLine[]): Promise<void> {
  await db.transaction('rw', db.countLines, db.opsOut, db.syncState, async () => {
    for (const l of lines) {
      const current = await db.countLines.get(l.id);
      if (!current) await db.countLines.put(l);
      else if (current.deleted === true) await writeShared('line', l.id, { ...l, deleted: false });
    }
  });
}

/**
 * Remise à zéro du comptage (partagée) : chaque ligne comptée repasse à 0 / 0, « jamais comptée » (updatedAt 0). Les
 * lignes restent dans la liste. Renvoie les lignes telles qu'elles étaient, pour « Annuler » (restoreCountLine).
 */
export async function resetCountLines(): Promise<CountLine[]> {
  return db.transaction('rw', db.countLines, db.opsOut, db.syncState, async () => {
    const counted = (await db.countLines.toArray()).filter((l) => l.deleted !== true && (l.linearQty !== 0 || l.stockQty !== 0 || l.updatedAt !== 0));
    const previous = counted.map((l) => withoutClock<CountLine>(l));
    for (const l of previous) await writeShared('line', l.id, { ...l, linearQty: 0, stockQty: 0, updatedAt: 0 });
    return previous;
  });
}

/** Remet une ligne supprimée telle quelle (garde sa date de modification). */
export async function restoreCountLine(line: CountLine): Promise<CountLine> {
  return writeShared('line', line.id, { ...withoutClock<CountLine>(line), deleted: false });
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
