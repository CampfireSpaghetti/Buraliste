import { mergeReferences, type DepartItem, type ReferenceFile } from '../domain/catalog';
import type { Product } from '../domain/types';
import { db, getSettings, newId, saveSettings } from './db';
import departSeed from './seed/depart.json';
import fdjSeed from './seed/fdj.json';

export async function syncReferences(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/references.json');
  if (!res.ok) throw new Error(`Liste officielle indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as ReferenceFile;
  const settings = await getSettings();
  if (settings.referencesVersion === file.version) return { updated: false, version: file.version };

  await db.transaction('rw', db.products, db.settings, async () => {
    const existing = await db.products.toArray();
    const ops = mergeReferences(existing, file, departSeed.items as DepartItem[], Date.now(), newId);
    await db.products.bulkPut(ops.put);
    await saveSettings({ referencesVersion: file.version, referencesEffectiveDate: file.effectiveDate });
  });
  return { updated: true, version: file.version };
}

export async function seedFdj(): Promise<void> {
  await db.transaction('rw', db.products, db.settings, async () => {
    if ((await getSettings()).fdjSeeded) return;
    const now = Date.now();
    const games: Product[] = fdjSeed.items.map((g) => ({
      id: newId(),
      source: 'depart',
      base: { kind: 'jeu-fdj', ...g },
      user: {},
      outOfStock: false,
      pinnedSubstitutes: [],
      updatedAt: now,
    }));
    await db.products.bulkAdd(games);
    await saveSettings({ fdjSeeded: true });
  });
}
