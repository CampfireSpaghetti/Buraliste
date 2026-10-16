import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { serializeBackup, parseBackup, needsBackupReminder, type BackupFile } from '../../src/domain/backup';
import { db, listCountLines, upsertCountLine, getSettings, saveSettings } from '../../src/data/db';
import { restoreFromText, exportBackupText } from '../../src/data/backupData';

const data = {
  products: [{ id: 'p', source: 'utilisateur' as const, base: {}, user: { kind: 'cigarette' as const, name: 'X' }, outOfStock: false, pinnedSubstitutes: [], updatedAt: 1 }],
  countLines: [{ id: 'l', code: '0417', name: 'Cash', quantity: 3, updatedAt: 2 }],
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
    if (r.ok) expect(r.data).toEqual({ app: 'la-carotte', schema: 1, exportedAt: 123, ...data } satisfies BackupFile);
  });
  it('parseBackup rejette un texte qui n’est pas du JSON', () => {
    expect(parseBackup('pas du json')).toEqual({ ok: false, error: 'Ce fichier n’est pas une sauvegarde La Carotte.' });
  });
  it('parseBackup rejette une autre application', () => {
    expect(parseBackup(JSON.stringify({ app: 'autre', schema: 1 }))).toEqual({ ok: false, error: 'Ce fichier n’est pas une sauvegarde La Carotte.' });
  });
  it('parseBackup rejette une version plus récente', () => {
    expect(parseBackup(JSON.stringify({ ...JSON.parse(serializeBackup(data, 1)), schema: 2 }))).toEqual({ ok: false, error: 'Cette sauvegarde vient d’une version plus récente de l’app.' });
  });
  it('parseBackup rejette une sauvegarde incomplète ou abîmée', () => {
    const good = JSON.parse(serializeBackup(data, 1));
    const { countLines: _omit, ...noLines } = good;
    expect(parseBackup(JSON.stringify(noLines))).toEqual({ ok: false, error: 'Sauvegarde incomplète ou abîmée.' });
    const negative = { ...good, countLines: [{ ...good.countLines[0], quantity: -1 }] };
    expect(parseBackup(JSON.stringify(negative))).toEqual({ ok: false, error: 'Sauvegarde incomplète ou abîmée.' });
  });
  it('une restauration refusée ne touche pas aux données', async () => {
    await upsertCountLine({ id: 'mine', code: '', name: 'Astro', quantity: 9, updatedAt: 0 });
    for (const bad of ['{', JSON.stringify({ app: 'la-carotte', schema: 2 }), JSON.stringify({ app: 'la-carotte', schema: 1 })]) {
      const r = await restoreFromText(bad);
      expect(r.ok).toBe(false);
    }
    expect((await listCountLines()).map((l) => l.name)).toEqual(['Astro']);
  });
  it('une restauration valide remplace tout et l’export relit la base', async () => {
    await upsertCountLine({ id: 'mine', code: '', name: 'Astro', quantity: 9, updatedAt: 0 });
    expect((await restoreFromText(serializeBackup(data, 5))).ok).toBe(true);
    expect((await listCountLines()).map((l) => l.name)).toEqual(['Cash']);
    expect((await getSettings()).shopName).toBe('Tabac du Centre');
    const again = parseBackup(await exportBackupText(10));
    expect(again.ok && again.data.countLines).toEqual(data.countLines);
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
