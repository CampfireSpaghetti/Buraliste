import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { db, listProducts, patchUserFields, upsertCountLine, deleteCountLine, restoreCountLine, listCountLines, getSettings, saveSettings } from '../../src/data/db';
import { syncReferences, seedFdj } from '../../src/data/referencesSync';
import type { ReferenceFile } from '../../src/domain/catalog';
import depart from '../../src/data/seed/depart.json';

const refFile = (price: number, version: string): ReferenceFile => ({
  version, effectiveDate: '2026-11-01', source: 'test',
  items: [
    { ref: 'a|1', kind: 'cigarette', name: 'Un', manufacturer: 'A', price, status: 'inchange' },
    { ref: 'a|2', kind: 'cigarette', name: 'Deux', manufacturer: 'A', price: 12, status: 'inchange' },
    { ref: 'a|3', kind: 'tabac-rouler', name: 'Trois', manufacturer: 'A', price: 18, status: 'nouveau' },
  ],
});
const fetchOf = (f: ReferenceFile) => (async () => new Response(JSON.stringify(f))) as unknown as typeof fetch;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('syncReferences', () => {
  it('importe la liste puis ne refait rien pour la même version', async () => {
    expect(await syncReferences(fetchOf(refFile(13, 'v1')))).toEqual({ updated: true, version: 'v1' });
    expect(await listProducts()).toHaveLength(3);
    expect(await syncReferences(fetchOf(refFile(13, 'v1')))).toEqual({ updated: false, version: 'v1' });
    expect((await getSettings()).referencesEffectiveDate).toBe('2026-11-01');
  });
  it('une nouvelle liste garde les ajouts du buraliste', async () => {
    await syncReferences(fetchOf(refFile(13, 'v1')));
    const un = (await listProducts()).find((p) => p.douaneRef === 'a|1')!;
    await patchUserFields(un.id, { tasteTags: ['doux'] });
    await syncReferences(fetchOf(refFile(14, 'v2')));
    const after = (await listProducts()).find((p) => p.douaneRef === 'a|1')!;
    expect(after.user.tasteTags).toEqual(['doux']);
    expect(after.base.price).toBe(14);
  });
});

describe('lignes de comptage', () => {
  it('supprimer puis restaurer rend la ligne avec sa date d’origine', async () => {
    await upsertCountLine({ id: 'l1', code: '0417', name: 'Cash', quantity: 3, updatedAt: 0 });
    const [saved] = await listCountLines();
    expect(saved.updatedAt).toBeGreaterThan(0);
    const removed = await deleteCountLine('l1');
    expect(await listCountLines()).toHaveLength(0);
    await restoreCountLine(removed);
    expect(await listCountLines()).toEqual([saved]);
  });
});

describe('réglages', () => {
  it('valeurs par défaut puis enregistrement', async () => {
    expect(await getSettings()).toMatchObject({ shopName: 'Mon tabac', sortCount: 'name' });
    await saveSettings({ shopName: 'Tabac du Centre' });
    expect((await getSettings()).shopName).toBe('Tabac du Centre');
  });
});

describe('données de départ', () => {
  it('chaque ref de depart.json existe dans references.json', () => {
    const refs = new Set((JSON.parse(readFileSync('public/data/references.json', 'utf8')) as ReferenceFile).items.map((i) => i.ref));
    const missing = depart.items.map((d) => d.ref).filter((r) => !refs.has(r));
    expect(missing).toEqual([]);
  });
  it('seedFdj est idempotent', async () => {
    await seedFdj();
    const n = (await listProducts()).length;
    expect(n).toBeGreaterThan(20);
    await seedFdj();
    expect(await listProducts()).toHaveLength(n);
    expect((await listProducts()).every((p) => p.base.kind === 'jeu-fdj' && p.source === 'depart')).toBe(true);
  });
});
