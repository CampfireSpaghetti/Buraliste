import Dexie, { type Table } from 'dexie';
import type { CountLine, Product, ProductFields, Settings } from '../domain/types';

type SettingsRow = Settings & { key: 'main' };

export const DEFAULT_SETTINGS: Settings = { shopName: 'Mon tabac', sortCount: 'name' };

export class CarotteDB extends Dexie {
  products!: Table<Product, string>;
  countLines!: Table<CountLine, string>;
  settings!: Table<SettingsRow, string>;
  constructor() {
    super('la-carotte');
    this.version(1).stores({
      products: 'id, douaneRef, source, updatedAt',
      countLines: 'id, gameId, updatedAt',
      settings: 'key',
    });
  }
}

export const db = new CarotteDB();

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
  return next;
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
