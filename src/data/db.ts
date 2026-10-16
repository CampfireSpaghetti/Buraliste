import Dexie, { type Table } from 'dexie';
import type { CountLine, Product, ProductFields, Settings } from '../domain/types';
import type { Contribution } from '../domain/sharing';
import type { Op } from '../sync/merge';
import { currentTabac, DEFAULT_TABAC_NAME, dbNameFor, ensureRegistry, listTabacs, syncRegistryName } from '../tabacs/registry';

export type OutboxItem = Contribution & { id?: number; createdAt: number };

export type OpOut = { seq?: number; op: Op };
export type SyncStateRow = { key: string; value: unknown };

type SettingsRow = Settings & { key: 'main' };

export const DEFAULT_SETTINGS: Settings = { shopName: DEFAULT_TABAC_NAME, sortCount: 'name' };

export class CarotteDB extends Dexie {
  products!: Table<Product, string>;
  countLines!: Table<CountLine, string>;
  settings!: Table<SettingsRow, string>;
  outbox!: Table<OutboxItem, number>;
  opsOut!: Table<OpOut, number>;
  syncState!: Table<SyncStateRow, string>;
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
  const { key: _key, ...s } = row;
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await db.settings.put({ ...next, key: 'main' });
  if (patch.shopName !== undefined) syncRegistryName(dbTabacId, next.shopName);
  return next;
}

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

export async function putProduct(p: Product): Promise<Product> {
  const next = { ...p, updatedAt: Date.now() };
  await db.products.put(next);
  return next;
}

async function update(id: string, fn: (p: Product) => Product): Promise<Product> {
  return db.transaction('rw', db.products, async () => {
    const p = await db.products.get(id);
    if (!p) throw new Error(`Produit introuvable : ${id}`);
    return putProduct(fn(p));
  });
}

export const patchUserFields = (id: string, patch: Partial<ProductFields>) =>
  update(id, (p) => ({ ...p, user: { ...p.user, ...patch } }));

export const clearUserField = (id: string, key: keyof ProductFields) =>
  update(id, (p) => {
    const user = { ...p.user };
    delete user[key];
    return { ...p, user };
  });

export const setOutOfStock = (id: string, v: boolean) => update(id, (p) => ({ ...p, outOfStock: v }));
export const setPinned = (id: string, ids: string[]) => update(id, (p) => ({ ...p, pinnedSubstitutes: ids }));

export const listCountLines = () => db.countLines.toArray();

export async function upsertCountLine(line: CountLine): Promise<CountLine> {
  const next = { ...line, updatedAt: Date.now() };
  await db.countLines.put(next);
  return next;
}

export async function deleteCountLine(id: string): Promise<CountLine> {
  return db.transaction('rw', db.countLines, async () => {
    const line = await db.countLines.get(id);
    if (!line) throw new Error(`Ligne introuvable : ${id}`);
    await db.countLines.delete(id);
    return line;
  });
}

/** Ajoute des lignes telles quelles (lignes « jamais comptées » des jeux du catalogue). */
export const addCountLines = (lines: CountLine[]) => db.countLines.bulkPut(lines);

/** Remet une ligne supprimée telle quelle (garde sa date de modification). */
export const restoreCountLine = (line: CountLine) => db.countLines.put(line);

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
