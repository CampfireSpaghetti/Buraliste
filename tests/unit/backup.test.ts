import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { serializeBackup, parseBackup, needsBackupReminder, type BackupFile } from '../../src/domain/backup';
import { db, listCountLines, upsertCountLine, getSettings, saveSettings, listTasks, seedTasks, setTaskDone } from '../../src/data/db';
import { restoreFromText, exportBackupText } from '../../src/data/backupData';

const data = {
  products: [{ id: 'p', source: 'utilisateur' as const, base: {}, user: { kind: 'cigarette' as const, name: 'X' }, outOfStock: false, pinnedSubstitutes: [], updatedAt: 1 }],
  countLines: [{ id: 'l', code: '0417', name: 'Cash', linearQty: 3, stockQty: 40, updatedAt: 2 }],
  settings: { shopName: 'Tabac du Centre', sortCount: 'name' as const },
};
const DAY = 86_400_000;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('sauvegarde', () => {
  it('aller-retour sérialiser / lire', () => {
    const r = parseBackup(serializeBackup(data, 123));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ app: 'la-carotte', schema: 2, exportedAt: 123, ...data } satisfies BackupFile);
  });
  it('parseBackup rejette un texte qui n’est pas du JSON', () => {
    expect(parseBackup('pas du json')).toEqual({ ok: false, error: 'Ce fichier n’est pas une sauvegarde La Carotte.' });
  });
  it('parseBackup rejette une autre application', () => {
    expect(parseBackup(JSON.stringify({ app: 'autre', schema: 1 }))).toEqual({ ok: false, error: 'Ce fichier n’est pas une sauvegarde La Carotte.' });
  });
  it('parseBackup rejette une version plus récente', () => {
    expect(parseBackup(JSON.stringify({ ...JSON.parse(serializeBackup(data, 1)), schema: 3 }))).toEqual({ ok: false, error: 'Cette sauvegarde vient d’une version plus récente de l’app.' });
  });
  it('parseBackup rejette une sauvegarde incomplète ou abîmée', () => {
    const good = JSON.parse(serializeBackup(data, 1));
    const { countLines: _omit, ...noLines } = good;
    expect(parseBackup(JSON.stringify(noLines))).toEqual({ ok: false, error: 'Sauvegarde incomplète ou abîmée.' });
    const negative = { ...good, countLines: [{ ...good.countLines[0], stockQty: -1 }] };
    expect(parseBackup(JSON.stringify(negative))).toEqual({ ok: false, error: 'Sauvegarde incomplète ou abîmée.' });
  });
  it('une restauration refusée ne touche pas aux données', async () => {
    await upsertCountLine({ id: 'mine', code: '', name: 'Astro', linearQty: 9, stockQty: 0, updatedAt: 0 });
    for (const bad of ['{', JSON.stringify({ app: 'la-carotte', schema: 3 }), JSON.stringify({ app: 'la-carotte', schema: 2 })]) {
      const r = await restoreFromText(bad);
      expect(r.ok).toBe(false);
    }
    expect((await listCountLines()).map((l) => l.name)).toEqual(['Astro']);
  });
  it('une restauration valide remplace tout et l’export relit la base', async () => {
    await upsertCountLine({ id: 'mine', code: '', name: 'Astro', linearQty: 9, stockQty: 0, updatedAt: 0 });
    expect((await restoreFromText(serializeBackup(data, 5))).ok).toBe(true);
    expect((await listCountLines()).map((l) => l.name)).toEqual(['Cash']);
    expect((await getSettings()).shopName).toBe('Tabac du Centre');
    const again = parseBackup(await exportBackupText(10));
    expect(again.ok && again.data.countLines).toEqual(data.countLines);
  });
});

describe('anciennes sauvegardes (schéma 1)', () => {
  it('« quantity » devient la quantité linéaire', () => {
    const old = { app: 'la-carotte', schema: 1, exportedAt: 1, products: [], settings: data.settings,
      countLines: [{ id: 'l', code: '0417', name: 'Cash', quantity: 3, updatedAt: 2 }] };
    const r = parseBackup(JSON.stringify(old));
    expect(r.ok && r.data.countLines).toEqual([{ id: 'l', code: '0417', name: 'Cash', linearQty: 3, stockQty: 0, updatedAt: 2 }]);
  });
});

describe('rappel de sauvegarde', () => {
  const now = 100 * DAY;
  it('vrai après 8 jours, faux après 6', () => {
    expect(needsBackupReminder({ shopName: '', sortCount: 'name', lastBackupAt: now - 8 * DAY }, now, true)).toBe(true);
    expect(needsBackupReminder({ shopName: '', sortCount: 'name', lastBackupAt: now - 6 * DAY }, now, true)).toBe(false);
  });
  it('jamais sauvegardé : seulement s’il y a des lignes', () => {
    expect(needsBackupReminder({ shopName: '', sortCount: 'name' }, now, true)).toBe(true);
    expect(needsBackupReminder({ shopName: '', sortCount: 'name' }, now, false)).toBe(false);
  });
  it('saveSettings garde lastBackupAt', async () => {
    await saveSettings({ lastBackupAt: 42 });
    expect((await getSettings()).lastBackupAt).toBe(42);
  });
});

describe('sauvegarde de la liste « À faire »', () => {
  const tasks = [{ id: 'base:1', label: 'Vérifier stock grattage', service: 'matin' as const, order: 1, doneAt: 5 }, { id: 'x', label: 'Arroser', service: 'apres-midi' as const, order: 2, doneAt: 0 }];
  it('les tâches sont sauvegardées puis restaurées (les absentes supprimées)', async () => {
    await seedTasks();
    await setTaskDone('base:matin-2', true, 9);
    const exported = JSON.parse(await exportBackupText(1));
    expect(exported.tasks).toHaveLength(18);
    expect(exported.tasks.find((t: { id: string }) => t.id === 'base:matin-2')).toEqual({ id: 'base:matin-2', label: 'Vérifier stock cigarettes', service: 'matin', order: 2, doneAt: 9 });
    expect(await restoreFromText(serializeBackup({ ...data, tasks }, 1))).toEqual({ ok: true });
    expect((await listTasks()).sort((a, b) => a.order - b.order)).toEqual(tasks.map((t) => ({ ...t, deleted: false })));
  });
  it('une ancienne sauvegarde sans tâches est valide et laisse la liste telle quelle', async () => {
    await seedTasks();
    expect(await restoreFromText(serializeBackup(data, 1))).toEqual({ ok: true });
    expect(await listTasks()).toHaveLength(18);
  });
  it('une tâche abîmée rend la sauvegarde invalide', () => {
    const bad = serializeBackup({ ...data, tasks: [{ ...tasks[0], service: 'nuit' as never }] }, 1);
    expect(parseBackup(bad)).toEqual({ ok: false, error: 'Sauvegarde incomplète ou abîmée.' });
  });
});
