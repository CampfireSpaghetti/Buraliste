import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { db, listProducts, patchUserFields, upsertCountLine, deleteCountLine, restoreCountLine, resetCountLines, listCountLines, getSettings, saveSettings } from '../../src/data/db';
import { syncReferences, syncFdjGames } from '../../src/data/referencesSync';
import type { FdjGamesFile } from '../../src/domain/fdj';
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
    await upsertCountLine({ id: 'l1', code: '0417', name: 'Cash', linearQty: 3, stockQty: 12, updatedAt: 0 });
    const [saved] = await listCountLines();
    expect(saved.updatedAt).toBeGreaterThan(0);
    const removed = await deleteCountLine('l1');
    expect(await listCountLines()).toHaveLength(0);
    await restoreCountLine(removed);
    expect(await listCountLines()).toEqual([saved]);
  });
  it('remise à zéro : quantités à 0 et « jamais compté » ; Annuler rend tout tel quel', async () => {
    await upsertCountLine({ id: 'l1', code: '0417', name: 'Cash', linearQty: 3, stockQty: 12, updatedAt: 0 });
    await upsertCountLine({ id: 'l2', code: '', name: 'Millionnaire', linearQty: 0, stockQty: 4, updatedAt: 0 });
    await db.countLines.put({ id: 'l3', code: '', name: 'Astro', linearQty: 0, stockQty: 0, updatedAt: 0 });
    const before = await listCountLines();
    const previous = await resetCountLines();
    expect(previous.map((l) => l.id).sort()).toEqual(['l1', 'l2']); // une ligne déjà à 0 n'est pas réécrite
    const after = await listCountLines();
    expect(after).toHaveLength(3);
    expect(after.every((l) => l.linearQty === 0 && l.stockQty === 0 && l.updatedAt === 0)).toBe(true);
    for (const l of previous) await restoreCountLine(l);
    const strip = (ls: typeof before) => ls.map(({ _clock: _c, ...l }: any) => l).sort((a, b) => a.id.localeCompare(b.id));
    expect(strip(await listCountLines())).toEqual(strip(before));
  });
});

describe('migration de la base', () => {
  it('les lignes de la version 1 (« quantity ») deviennent linéaire + stock 0', async () => {
    db.close();
    await Dexie.delete('la-carotte');
    const v1 = new Dexie('la-carotte');
    v1.version(1).stores({ products: 'id, douaneRef, source, updatedAt', countLines: 'id, gameId, updatedAt', settings: 'key' });
    await v1.table('countLines').put({ id: 'old', code: '0417', name: 'Cash', quantity: 38, updatedAt: 5 });
    v1.close();
    await db.open();
    expect(await listCountLines()).toEqual([{ id: 'old', code: '0417', name: 'Cash', linearQty: 38, stockQty: 0, updatedAt: 5 }]);
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
  it('les refs de depart.json correspondent à la liste officielle (un retrait ou renommage isolé ne bloque pas le robot)', () => {
    const items = (JSON.parse(readFileSync('public/data/references.json', 'utf8')) as ReferenceFile).items;
    const refs = new Set(items.flatMap((i) => [i.ref, i.previousRef].filter(Boolean)));
    const missing = depart.items.map((d) => d.ref).filter((r) => !refs.has(r));
    if (missing.length) console.warn(`depart.json : ${missing.length} référence(s) absente(s) de la liste officielle :`, missing);
    expect(missing.length).toBeLessThanOrEqual(Math.floor(depart.items.length / 4));
  });
  it('syncFdjGames importe la liste FDJ, puis ne refait rien pour la même version', async () => {
    const fdj: FdjGamesFile = { version: 'f1', fetchedAt: '2026-10-16', source: 't', items: [
      { ref: 'fdj|ITGC9K', fdjId: 'ITGC9K', name: 'CASH', ticketPrice: 5, maxPrize: 500000, isNew: false },
      { ref: 'fdj|ITGBUT', fdjId: 'ITGBUT', name: 'Goal', ticketPrice: 1, maxPrize: 4000, isNew: true },
    ] };
    const fetchFdj = (async () => new Response(JSON.stringify(fdj))) as unknown as typeof fetch;
    expect(await syncFdjGames(fetchFdj)).toEqual({ updated: true, version: 'f1' });
    const games = await listProducts();
    expect(games.map((p) => p.base.name).sort()).toEqual(['CASH', 'Goal']);
    expect(games.every((p) => p.source === 'fdj' && p.base.kind === 'jeu-fdj')).toBe(true);
    expect(await syncFdjGames(fetchFdj)).toEqual({ updated: false, version: 'f1' });
    expect((await getSettings()).fdjVersion).toBe('f1');
  });
  it('le fichier fdj-games.json publié contient au moins 15 jeux en point de vente', () => {
    const f = JSON.parse(readFileSync('public/data/fdj-games.json', 'utf8')) as FdjGamesFile;
    expect(f.items.length).toBeGreaterThanOrEqual(15);
    expect(f.items.every((i) => i.ref.startsWith('fdj|ITG') && i.ticketPrice > 0)).toBe(true);
  });
});
