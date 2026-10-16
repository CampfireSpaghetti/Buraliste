import { parseBackup, serializeBackup } from '../domain/backup';
import { db, getSettings } from './db';

export async function exportBackupText(now: number): Promise<string> {
  const [products, countLines, settings] = await Promise.all([db.products.toArray(), db.countLines.toArray(), getSettings()]);
  return serializeBackup({ products, countLines, settings }, now);
}

/** Lit une sauvegarde et remplace toutes les données en une seule transaction. Rien n'est modifié si le fichier est refusé. */
export async function restoreFromText(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  const { products, countLines, settings } = parsed.data;
  await db.transaction('rw', db.products, db.countLines, db.settings, async () => {
    await Promise.all([db.products.clear(), db.countLines.clear(), db.settings.clear()]);
    await db.products.bulkPut(products);
    await db.countLines.bulkPut(countLines);
    // La version de la liste officielle est oubliée : la prochaine ouverture refusionne la liste à jour.
    await db.settings.put({ ...settings, referencesVersion: undefined, key: 'main' });
  });
  return { ok: true };
}
