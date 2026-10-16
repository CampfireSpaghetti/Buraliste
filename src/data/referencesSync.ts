import { mergeReferences, type DepartItem, type ReferenceFile } from '../domain/catalog';
import { mergeFdjGames, type FdjGamesFile } from '../domain/fdj';
import type { IdMap } from '../domain/productId';
import { db, getSettings, normalizeProductIds, remapRecent, saveSettings } from './db';
import departSeed from './seed/depart.json';

/**
 * Ids stables après une fusion de liste (R20). Un échec n'empêche jamais la liste d'être mise à jour : il est signalé,
 * et la normalisation sera retentée à la prochaine version de la liste (aucune donnée n'est effacée avant d'être écrite).
 */
async function normalizeAfterMerge(): Promise<IdMap> {
  try {
    return await normalizeProductIds(db);
  } catch (e) {
    console.error('Ids stables des produits : normalisation non faite', e);
    return new Map();
  }
}

export async function syncReferences(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/references.json');
  if (!res.ok) throw new Error(`Liste officielle indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as ReferenceFile;
  const settings = await getSettings();
  if (settings.referencesVersion === file.version) return { updated: false, version: file.version };

  // Liste publique : jamais d'opération (chaque téléphone la reçoit lui-même). `opsOut` est dans la transaction
  // parce que saveSettings passe par la couche partagée (les versions ne sont pas partagées : rien n'est mis en file).
  // Une fiche renommée (previousRef) passe ensuite à son nouvel id stable, avec ses lignes et opérations (R20).
  const map = await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut], async () => {
    const existing = await db.products.toArray();
    const ops = mergeReferences(existing, file, departSeed.items as DepartItem[], Date.now());
    await db.products.bulkPut(ops.put);
    const remapped = await normalizeAfterMerge();
    await saveSettings({ referencesVersion: file.version, referencesEffectiveDate: file.effectiveDate });
    return remapped;
  });
  remapRecent(map);
  return { updated: true, version: file.version };
}

/** Liste des jeux de grattage (robot hebdomadaire, page fdj.fr) : même principe que la liste Douane. */
export async function syncFdjGames(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/fdj-games.json');
  if (!res.ok) throw new Error(`Liste des jeux FDJ indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as FdjGamesFile;
  if ((await getSettings()).fdjVersion === file.version) return { updated: false, version: file.version };
  const map = await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut], async () => {
    const ops = mergeFdjGames(await db.products.toArray(), file, Date.now());
    await db.products.bulkPut(ops.put);
    // Un jeu de l'ancienne liste de départ repris par la liste FDJ passe à son id stable `f:<clé>`.
    const remapped = await normalizeAfterMerge();
    await saveSettings({ fdjVersion: file.version, fdjFetchedAt: file.fetchedAt });
    return remapped;
  });
  remapRecent(map);
  return { updated: true, version: file.version };
}
