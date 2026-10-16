import { mergeReferences, type DepartItem, type ReferenceFile } from '../domain/catalog';
import { mergeFdjGames, type FdjGamesFile } from '../domain/fdj';
import { db, getSettings, newId, saveSettings } from './db';
import departSeed from './seed/depart.json';

export async function syncReferences(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/references.json');
  if (!res.ok) throw new Error(`Liste officielle indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as ReferenceFile;
  const settings = await getSettings();
  if (settings.referencesVersion === file.version) return { updated: false, version: file.version };

  // Liste publique : jamais d'opération (chaque téléphone la reçoit lui-même). `opsOut` est dans la transaction
  // parce que saveSettings passe par la couche partagée (les versions ne sont pas partagées : rien n'est mis en file).
  await db.transaction('rw', db.products, db.settings, db.opsOut, async () => {
    const existing = await db.products.toArray();
    const ops = mergeReferences(existing, file, departSeed.items as DepartItem[], Date.now(), newId);
    await db.products.bulkPut(ops.put);
    await saveSettings({ referencesVersion: file.version, referencesEffectiveDate: file.effectiveDate });
  });
  return { updated: true, version: file.version };
}

/** Liste des jeux de grattage (robot hebdomadaire, page fdj.fr) : même principe que la liste Douane. */
export async function syncFdjGames(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/fdj-games.json');
  if (!res.ok) throw new Error(`Liste des jeux FDJ indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as FdjGamesFile;
  if ((await getSettings()).fdjVersion === file.version) return { updated: false, version: file.version };
  await db.transaction('rw', db.products, db.settings, db.opsOut, async () => {
    const ops = mergeFdjGames(await db.products.toArray(), file, Date.now(), newId);
    await db.products.bulkPut(ops.put);
    await saveSettings({ fdjVersion: file.version, fdjFetchedAt: file.fetchedAt });
  });
  return { updated: true, version: file.version };
}
