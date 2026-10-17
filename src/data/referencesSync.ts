import { mergeReferences, type DepartItem, type ReferenceFile } from '../domain/catalog';
import { mergeFdjGames, type FdjGamesFile } from '../domain/fdj';
import type { IdMap } from '../domain/productId';
import { db, getSettings, normalizeProductIds, remapRecent, saveSettings } from './db';
import { replayParkedOps } from './sharedRepo';
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

/**
 * Rejoue les opérations reçues pour des produits encore inconnus (voir replayParkedOps). Un échec n'empêche jamais la
 * mise à jour des listes : les opérations restent en attente pour la prochaine fois.
 */
async function replayParked(renames: IdMap = new Map()): Promise<void> {
  try {
    await replayParkedOps(db, renames);
  } catch (e) {
    console.error('Opérations en attente : rejouées plus tard', e);
  }
}

/** Renommages de la liste Douane (`previousRef`) : ancien id stable → nouvel id stable. */
function douaneRenames(file: ReferenceFile): IdMap {
  const map = new Map<string, string>();
  for (const item of Array.isArray(file.items) ? file.items : []) {
    if (item?.previousRef && item.ref && item.previousRef !== item.ref) map.set('d:' + item.previousRef, 'd:' + item.ref);
  }
  return map;
}

export async function syncReferences(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/references.json');
  if (!res.ok) throw new Error(`Liste officielle indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as ReferenceFile;
  const settings = await getSettings();
  if (settings.referencesVersion === file.version) {
    await replayParked(douaneRenames(file));
    return { updated: false, version: file.version };
  }

  // Liste publique : jamais d'opération (chaque téléphone la reçoit lui-même). `opsOut` est dans la transaction
  // parce que saveSettings passe par la couche partagée (les versions ne sont pas partagées : rien n'est mis en file).
  // Une fiche renommée (previousRef) passe ensuite à son nouvel id stable, avec ses lignes et opérations (R20).
  const map = await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.syncState, db.parkedOps], async () => {
    const existing = await db.products.toArray();
    const ops = mergeReferences(existing, file, departSeed.items as DepartItem[], Date.now());
    await db.products.bulkPut(ops.put);
    const remapped = await normalizeAfterMerge();
    await saveSettings({ referencesVersion: file.version, referencesEffectiveDate: file.effectiveDate });
    return remapped;
  });
  remapRecent(map);
  // Opérations reçues pour des références que ce téléphone n'avait pas encore (ou sous leur ancien nom).
  await replayParked(douaneRenames(file));
  return { updated: true, version: file.version };
}

/** Liste des jeux de grattage (robot hebdomadaire, page fdj.fr) : même principe que la liste Douane. */
export async function syncFdjGames(fetchFn: typeof fetch = fetch): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/fdj-games.json');
  if (!res.ok) throw new Error(`Liste des jeux FDJ indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as FdjGamesFile;
  if ((await getSettings()).fdjVersion === file.version) {
    await replayParked();
    return { updated: false, version: file.version };
  }
  const map = await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.syncState, db.parkedOps], async () => {
    const ops = mergeFdjGames(await db.products.toArray(), file, Date.now());
    await db.products.bulkPut(ops.put);
    // Un jeu de l'ancienne liste de départ repris par la liste FDJ passe à son id stable `f:<clé>`.
    const remapped = await normalizeAfterMerge();
    await saveSettings({ fdjVersion: file.version, fdjFetchedAt: file.fetchedAt });
    return remapped;
  });
  remapRecent(map);
  await replayParked();
  return { updated: true, version: file.version };
}
