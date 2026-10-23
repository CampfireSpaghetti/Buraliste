import { parseBackup, serializeBackup, withStableIds } from '../domain/backup';
import type { CountLine, Product, Task } from '../domain/types';
import { withoutClock, type Clocked } from '../sync/merge';
import { syncRegistryName } from '../tabacs/registry';
import { db, dbTabacId, DEFAULT_SETTINGS, getSettings } from './db';
import { writeShared } from './sharedRepo';

/** Sauvegarde : les lignes visibles et les produits, sans les horodatages internes de la synchronisation. */
export async function exportBackupText(now: number): Promise<string> {
  const [products, lines, { shareToken: _secret, ...settings }, allTasks] = await Promise.all([db.products.toArray(), db.countLines.toArray(), getSettings(), db.tasks.toArray()]);
  const countLines = lines.filter((l) => l.deleted !== true).map(({ _clock: _c, deleted: _d, ...l }) => l as CountLine);
  const tasks = allTasks.filter((t) => t.deleted !== true).map(({ _clock: _c, deleted: _d, ...t }) => t as Task);
  return serializeBackup({ products: products.map((p) => withoutClock<Product>(p)), countLines, settings, tasks }, now);
}

/**
 * Lit une sauvegarde et remplace toutes les données en une seule transaction. Rien n'est modifié si le fichier est refusé.
 * Les données partagées passent par la couche partagée : les autres téléphones du tabac reçoivent la restauration
 * (lignes absentes de la sauvegarde supprimées, champs partagés modifiés) au lieu de la défaire.
 */
export async function restoreFromText(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  const { products, countLines, settings, tasks } = withStableIds(parsed.data);
  await db.transaction('rw', [db.products, db.countLines, db.settings, db.tasks, db.opsOut, db.syncState], async () => {
    // Produits : pas de suppression partagée ; ceux qui manquent à la sauvegarde ne sont retirés que d'ici.
    const keepProducts = new Set(products.map((p) => p.id));
    await db.products.bulkDelete((await db.products.toCollection().primaryKeys()).filter((id) => !keepProducts.has(id)));
    for (const p of products) await writeShared('product', p.id, withoutClock<Product>(p));

    const keepLines = new Set(countLines.map((l) => l.id));
    for (const l of await db.countLines.toArray()) {
      if (!keepLines.has(l.id) && l.deleted !== true) await writeShared('line', l.id, { ...withoutClock<CountLine>(l), deleted: true });
    }
    for (const l of countLines) await writeShared('line', l.id, { ...withoutClock<CountLine>(l), deleted: l.deleted === true });

    // Tâches : remplacées seulement si la sauvegarde en contient (une sauvegarde d'avant la liste « À faire » n'y touche pas).
    if (tasks) {
      const keepTasks = new Set(tasks.map((t) => t.id));
      for (const t of await db.tasks.toArray()) {
        if (!keepTasks.has(t.id) && t.deleted !== true) await writeShared('task', t.id, { ...withoutClock<Task>(t), deleted: true });
      }
      for (const t of tasks) await writeShared('task', t.id, { ...withoutClock<Task>(t), deleted: false });
    }

    // La version de la liste officielle est oubliée : la prochaine ouverture refusionne la liste à jour.
    // Une clé GitHub qu'une très ancienne sauvegarde contiendrait est ignorée : les téléphones n'en ont plus.
    const { _clock: _c, shareToken: _legacy, ...restored } = settings as Clocked<typeof settings>;
    await writeShared('settings', 'main', { ...DEFAULT_SETTINGS, ...restored, referencesVersion: undefined, sharedCodesVersion: undefined });
  });
  syncRegistryName(dbTabacId, (await getSettings()).shopName);
  return { ok: true };
}
