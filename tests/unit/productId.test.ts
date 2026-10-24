import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { stableProductId, productIdMap, remapProductIds, gameLineId } from '../../src/domain/productId';
import { mergeReferences, type ReferenceFile } from '../../src/domain/catalog';
import { mergeFdjGames, type FdjGamesFile } from '../../src/domain/fdj';
import { countLineId } from '../../src/domain/count';
import { CarotteDB, db, listProducts, normalizeProductIds, setOutOfStock, type IdTables } from '../../src/data/db';
import { applyRemoteOps } from '../../src/data/sharedRepo';
import { syncFdjGames, syncReferences } from '../../src/data/referencesSync';
import { restoreFromText } from '../../src/data/backupData';
import { serializeBackup } from '../../src/domain/backup';
import { readRecent } from '../../src/store';
import { resetClockForTests } from '../../src/sync/clock';
import type { Clocked } from '../../src/sync/merge';
import type { CountLine, Product } from '../../src/domain/types';
import type { Op } from '../../src/sync/merge';

const RELAY = 'https://relais.example.workers.dev';
const refFile: ReferenceFile = {
  version: 'v1', effectiveDate: '2026-11-01', source: 'test',
  items: [
    { ref: 'a|1', kind: 'cigarette', name: 'Un', manufacturer: 'A', price: 12, status: 'inchange' },
    { ref: 'a|2', kind: 'cigarette', name: 'Deux', manufacturer: 'A', price: 13, status: 'inchange' },
  ],
};
const fdjFile: FdjGamesFile = {
  version: 'f1', fetchedAt: '2026-10-16', source: 't',
  items: [{ ref: 'fdj|ITGC9K', fdjId: 'ITGC9K', name: 'CASH', ticketPrice: 5, maxPrize: 500000, isNew: false }],
};
const fetchOf = (f: unknown) => (async () => new Response(JSON.stringify(f))) as unknown as typeof fetch;
const prod = (over: Partial<Clocked<Product>>): Clocked<Product> => ({ id: 'x', source: 'douane', base: {}, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 1, ...over });

describe('stableProductId', () => {
  it('Douane : « d: » + la référence Douane', () => {
    expect(stableProductId({ id: 'rnd', source: 'douane', douaneRef: 'pmi|marlboro' })).toBe('d:pmi|marlboro');
  });
  it('liste de départ rattachée à une référence Douane : même id que la fiche Douane', () => {
    expect(stableProductId({ id: 'rnd', source: 'depart', douaneRef: 'pmi|marlboro' })).toBe('d:pmi|marlboro');
  });
  it('FDJ : « f: » + la clé du jeu', () => {
    expect(stableProductId({ id: 'rnd', source: 'fdj', fdjRef: 'fdj|ITGC9K' })).toBe('f:fdj|ITGC9K');
  });
  it('jeu de l’ancienne liste de départ (sans référence) : « depart: » + son nom comparable', () => {
    expect(stableProductId({ id: 'rnd', source: 'depart', base: { kind: 'jeu-fdj', name: 'Goal !' } })).toBe('depart:goal');
  });
  it('fiche créée à la main : son id d’origine', () => {
    expect(stableProductId({ id: 'u-123', source: 'utilisateur', douaneRef: 'x' })).toBe('u-123');
  });
  it('référence vide : jamais un id vide, l’id actuel est gardé', () => {
    expect(stableProductId({ id: 'rnd', source: 'douane', douaneRef: '' })).toBe('rnd');
    expect(stableProductId({ id: 'rnd', source: 'fdj', fdjRef: '' })).toBe('rnd');
  });
  it('sans référence ni nom : l’id actuel', () => {
    expect(stableProductId({ id: 'rnd', source: 'douane' })).toBe('rnd');
    expect(stableProductId({ id: 'rnd', source: 'depart', base: {} })).toBe('rnd');
  });
  it('ligne de jeu : « game: » + id du jeu ; ligne libre : id au hasard', () => {
    expect(gameLineId('f:fdj|X')).toBe('game:f:fdj|X');
    expect(countLineId('f:fdj|X', () => 'r')).toBe('game:f:fdj|X');
    expect(countLineId(undefined, () => 'r')).toBe('r');
  });
});

describe('deux téléphones vides reçoivent les mêmes ids', () => {
  it('mergeReferences', () => {
    const a = mergeReferences([], refFile, [], 1).put.map((p) => p.id);
    const b = mergeReferences([], refFile, [], 2).put.map((p) => p.id);
    expect(a).toEqual(['d:a|1', 'd:a|2']);
    expect(b).toEqual(a);
  });
  it('mergeFdjGames', () => {
    const a = mergeFdjGames([], fdjFile, 1).put.map((p) => p.id);
    expect(a).toEqual(['f:fdj|ITGC9K']);
    expect(mergeFdjGames([], fdjFile, 2).put.map((p) => p.id)).toEqual(a);
  });
});

describe('références vides dans les listes publiques', () => {
  it('une ligne Douane ou un jeu FDJ sans référence est ignoré (pas d’id vide)', () => {
    const douane = mergeReferences([], { ...refFile, items: [{ ...refFile.items[0], ref: '' }, refFile.items[1]] }, [], 1);
    expect(douane.put.map((p) => p.id)).toEqual(['d:a|2']);
    const fdj = mergeFdjGames([], { ...fdjFile, items: [{ ...fdjFile.items[0], ref: '' }] }, 1);
    expect(fdj.put).toEqual([]);
  });
});

describe('remapProductIds (pur)', () => {
  it('déplace les fiches, réécrit remplaçants, lignes, jeux enlevés et opérations', () => {
    const products = [
      prod({ id: 'r1', douaneRef: 'a|1', pinnedSubstitutes: ['r2', 'u'] }),
      prod({ id: 'r2', douaneRef: 'a|2' }),
      prod({ id: 'u', source: 'utilisateur', pinnedSubstitutes: ['r1'] }),
    ];
    const lines: CountLine[] = [
      { id: 'game:r1', gameId: 'r1', code: '', name: 'Un', linearQty: 1, stockQty: 2, updatedAt: 3 },
      { id: 'libre', gameId: 'r2', code: '', name: 'Deux', linearQty: 0, stockQty: 0, updatedAt: 0 },
    ];
    const map = productIdMap(products);
    expect([...map]).toEqual([['r1', 'd:a|1'], ['r2', 'd:a|2']]);
    const c = remapProductIds({ products, lines, hiddenGames: ['r2', 'zz'], ops: [{ seq: 1, op: { e: 'product', id: 'r1', f: { outOfStock: true }, t: 't' } }] }, map);
    expect(c.products.map((p) => p.id).sort()).toEqual(['d:a|1', 'd:a|2', 'u']);
    expect(c.products.find((p) => p.id === 'd:a|1')!.pinnedSubstitutes).toEqual(['d:a|2', 'u']);
    expect(c.products.find((p) => p.id === 'u')!.pinnedSubstitutes).toEqual(['d:a|1']);
    expect(c.productDel.sort()).toEqual(['r1', 'r2']);
    expect(c.lines.map((l) => [l.id, l.gameId])).toEqual([['game:d:a|1', 'd:a|1'], ['libre', 'd:a|2']]);
    expect(c.lineDel).toEqual(['game:r1']);
    expect(c.hiddenGames).toEqual(['d:a|2', 'zz']);
    expect(c.ops).toEqual([{ seq: 1, op: { e: 'product', id: 'd:a|1', f: { outOfStock: true }, t: 't' } }]);
  });
  it('deux fiches pour la même référence : celle qui a des données du buraliste reste, rien n’est perdu', () => {
    const products = [
      prod({ id: 'a', douaneRef: 'a|1', updatedAt: 9 }),
      prod({ id: 'b', douaneRef: 'a|1', updatedAt: 2, outOfStock: true, user: { notes: 'n' }, pinnedSubstitutes: ['p'], _clock: { outOfStock: 'h1', 'user.notes': 'h2' } }),
      prod({ id: 'c', douaneRef: 'a|1', updatedAt: 1, user: { tasteTags: ['doux'], notes: 'autre' }, pinnedSubstitutes: ['q'], _clock: { 'user.tasteTags': 'h3' } }),
    ];
    const c = remapProductIds({ products, lines: [] }, productIdMap(products));
    expect(c.products).toHaveLength(1);
    expect(c.products[0]).toMatchObject({ id: 'd:a|1', outOfStock: true, user: { notes: 'n', tasteTags: ['doux'] }, pinnedSubstitutes: ['p', 'q'] });
    expect(c.products[0]._clock).toEqual({ outOfStock: 'h1', 'user.notes': 'h2', 'user.tasteTags': 'h3' });
    expect(c.productDel.sort()).toEqual(['a', 'b', 'c']);
  });
  it('deux fiches pour la même référence : champ par champ, l’horodatage le plus récent gagne', () => {
    const products = [
      prod({ id: 'a', douaneRef: 'a|1', updatedAt: 9, outOfStock: false, user: { notes: 'ancien', price: 5 }, pinnedSubstitutes: ['x'], _clock: { outOfStock: '5', 'user.notes': '2', pinnedSubstitutes: '1' } }),
      prod({ id: 'b', douaneRef: 'a|1', updatedAt: 2, outOfStock: true, user: { notes: 'récent' }, pinnedSubstitutes: ['y'], _clock: { outOfStock: '4', 'user.notes': '3', 'user.price': '6', pinnedSubstitutes: '2' } }),
    ];
    const [merged] = remapProductIds({ products, lines: [] }, productIdMap(products)).products;
    // outOfStock : a (5) > b (4) ; notes : b (3) > a (2) ; price : effacé sur b (6) après a (sans horodatage) ; remplaçants : b (2).
    expect(merged).toMatchObject({ id: 'd:a|1', outOfStock: false, user: { notes: 'récent' }, pinnedSubstitutes: ['y'], updatedAt: 9 });
    expect(merged.user).not.toHaveProperty('price');
    expect(merged._clock).toEqual({ outOfStock: '5', 'user.notes': '3', 'user.price': '6', pinnedSubstitutes: '2' });
  });
  it('deux lignes pour le même jeu : la plus récente reste ; les opérations en file de l’autre sont retirées', () => {
    const products = [prod({ id: 'a', douaneRef: 'a|1' }), prod({ id: 'b', douaneRef: 'a|1' })];
    const lines: CountLine[] = [
      { id: 'game:a', gameId: 'a', code: '', name: 'Un', linearQty: 1, stockQty: 0, updatedAt: 5 },
      { id: 'game:b', gameId: 'b', code: '', name: 'Un', linearQty: 9, stockQty: 4, updatedAt: 8 },
    ];
    const ops = [
      { seq: 1, op: { e: 'line', id: 'game:a', f: { linearQty: 1 }, t: 't1' } as Op },
      { seq: 2, op: { e: 'line', id: 'game:b', f: { linearQty: 9 }, t: 't2' } as Op },
    ];
    const c = remapProductIds({ products, lines, ops }, productIdMap(products));
    expect(c.lines).toEqual([{ ...lines[1], id: 'game:d:a|1', gameId: 'd:a|1' }]);
    expect(c.lineDel.sort()).toEqual(['game:a', 'game:b']);
    expect(c.opDel).toEqual([1]);
    expect(c.ops).toEqual([{ seq: 2, op: { e: 'line', id: 'game:d:a|1', f: { linearQty: 9 }, t: 't2' } }]);
  });
  it('totale : une donnée abîmée est laissée telle quelle, sans exception', () => {
    const products = [prod({ id: 'r', douaneRef: 'a|1', pinnedSubstitutes: 'abîmé' as never, user: null as never })];
    const lines = [{ id: 'game:r', gameId: 7, code: '', name: '', linearQty: 0, stockQty: 0, updatedAt: 0 } as never as CountLine];
    const ops = [{ seq: 1, op: { e: 'product', id: 'r', f: null } as never as Op }, { seq: 2, op: { e: 'settings', id: 'main', f: { hiddenGames: 'x' }, t: 't' } as never as Op }];
    const c = remapProductIds({ products, lines, hiddenGames: 'abîmé' as never, ops }, productIdMap(products));
    expect(c.products).toEqual([{ ...products[0], id: 'd:a|1' }]);
    expect(c.lines.map((l) => [l.id, l.gameId])).toEqual([['game:d:a|1', 7]]);
    expect(c.hiddenGames).toBe('abîmé');
    expect(c.hiddenChanged).toBe(false);
    expect(c.ops).toEqual([]);
  });
});

describe('base de données', () => {
  beforeEach(async () => {
    localStorage.removeItem('carotte:hlc');
    localStorage.removeItem('carotte:device');
    localStorage.removeItem('carotte:recent');
    resetClockForTests();
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.delete();
    await db.open();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('mise à niveau v4 → v5 : ids stables partout, rien de perdu, horloges gardées', async () => {
    const name = 'la-carotte-v4-ids';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(4).stores({
      products: 'id, douaneRef, source, updatedAt', countLines: 'id, gameId, updatedAt', settings: 'key',
      outbox: '++id, createdAt', opsOut: '++seq', syncState: 'key',
    });
    await old.table('products').bulkPut([
      { id: 'rnd-d', source: 'douane', douaneRef: 'a|1', base: { kind: 'cigarette', name: 'Un' }, user: { notes: 'fort' }, outOfStock: true, pinnedSubstitutes: ['rnd-f', 'u1'], updatedAt: 4, _clock: { outOfStock: 'c1', 'user.notes': 'c2' } },
      { id: 'rnd-f', source: 'fdj', fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' }, user: { fdjPrefix: '0417' }, outOfStock: false, pinnedSubstitutes: [], updatedAt: 3 },
      { id: 'u1', source: 'utilisateur', base: {}, user: { kind: 'cigarette', name: 'Maison' }, outOfStock: false, pinnedSubstitutes: ['rnd-d'], updatedAt: 2 },
    ]);
    await old.table('countLines').bulkPut([
      { id: 'game:rnd-f', gameId: 'rnd-f', code: '0417', name: 'CASH', linearQty: 3, stockQty: 40, updatedAt: 7, _clock: { linearQty: 'c3' } },
      { id: 'libre', code: '', name: 'Astro', linearQty: 1, stockQty: 0, updatedAt: 1 },
    ]);
    await old.table('settings').put({ key: 'main', shopName: 'Chez moi', sortCount: 'name', hiddenGames: ['rnd-f'], _clock: { hiddenGames: 'c4' } });
    await old.table('opsOut').bulkAdd([
      { op: { e: 'product', id: 'rnd-d', f: { outOfStock: true, pinnedSubstitutes: ['rnd-f'] }, t: 'c1' } },
      { op: { e: 'line', id: 'game:rnd-f', f: { gameId: 'rnd-f', linearQty: 3 }, t: 'c3' } },
      { op: { e: 'settings', id: 'main', f: { hiddenGames: ['rnd-f'] }, t: 'c4' } },
    ]);
    old.close();
    localStorage.setItem('carotte:recent', JSON.stringify(['rnd-f', 'u1', 'rnd-d']));

    const up = new CarotteDB(name);
    await up.open();
    expect(up.verno).toBe(9);
    expect((await up.products.toCollection().primaryKeys()).sort()).toEqual(['d:a|1', 'f:fdj|ITGC9K', 'u1']);
    expect(await up.products.get('d:a|1')).toEqual({
      id: 'd:a|1', source: 'douane', douaneRef: 'a|1', base: { kind: 'cigarette', name: 'Un' }, user: { notes: 'fort' }, outOfStock: true,
      pinnedSubstitutes: ['f:fdj|ITGC9K', 'u1'], updatedAt: 4, _clock: { outOfStock: 'c1', 'user.notes': 'c2' },
    });
    expect((await up.products.get('f:fdj|ITGC9K'))!.user).toEqual({ fdjPrefix: '0417' });
    expect((await up.products.get('u1'))!.pinnedSubstitutes).toEqual(['d:a|1']);
    expect((await up.countLines.toCollection().primaryKeys()).sort()).toEqual(['game:f:fdj|ITGC9K', 'libre']);
    expect(await up.countLines.get('game:f:fdj|ITGC9K')).toEqual({
      id: 'game:f:fdj|ITGC9K', gameId: 'f:fdj|ITGC9K', code: '0417', name: 'CASH', linearQty: 3, stockQty: 40, updatedAt: 7, _clock: { linearQty: 'c3' },
    });
    expect(await up.settings.get('main')).toEqual({ key: 'main', shopName: 'Chez moi', sortCount: 'name', hiddenGames: ['f:fdj|ITGC9K'], _clock: { hiddenGames: 'c4' } });
    expect((await up.opsOut.orderBy('seq').toArray()).map((r) => r.op)).toEqual([
      { e: 'product', id: 'd:a|1', f: { outOfStock: true, pinnedSubstitutes: ['f:fdj|ITGC9K'] }, t: 'c1' },
      { e: 'line', id: 'game:f:fdj|ITGC9K', f: { gameId: 'f:fdj|ITGC9K', linearQty: 3 }, t: 'c3' },
      { e: 'settings', id: 'main', f: { hiddenGames: ['f:fdj|ITGC9K'] }, t: 'c4' },
    ]);
    expect(readRecent()).toEqual(['f:fdj|ITGC9K', 'u1', 'd:a|1']);
    up.close();
    await Dexie.delete(name);
  });

  it('mise à niveau v4 → v5 : une donnée abîmée n’empêche jamais l’ouverture de la base', async () => {
    const name = 'la-carotte-v4-abimee';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(4).stores({
      products: 'id, douaneRef, source, updatedAt', countLines: 'id, gameId, updatedAt', settings: 'key',
      outbox: '++id, createdAt', opsOut: '++seq', syncState: 'key',
    });
    await old.table('products').put({ id: 'z', source: 'douane', douaneRef: 'a|9', base: {}, user: {}, outOfStock: false, pinnedSubstitutes: 'abîmé', updatedAt: 1 });
    old.close();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const up = new CarotteDB(name);
    await up.open();
    expect(up.verno).toBe(9);
    expect(await up.products.count()).toBe(1);
    expect((await up.products.get('d:a|9'))!.pinnedSubstitutes).toBe('abîmé');
    up.close();
    await Dexie.delete(name);
  });

  const failing = <T extends object>(table: T, method: string): T =>
    new Proxy(table, { get: (t, k) => (k === method ? () => Promise.reject(new Error('quota')) : Reflect.get(t, k, t)) }) as T;
  const dump = async () => ({
    products: await db.products.toArray(), lines: await db.countLines.toArray(), settings: await db.settings.toArray(), ops: await db.opsOut.toArray(),
  });

  it('une écriture qui échoue (erreur rattrapée) ne fait perdre aucune donnée : pas d’effacement avant écriture', async () => {
    await db.products.put(prod({ id: 'rnd', douaneRef: 'a|1', outOfStock: true, user: { notes: 'n' }, _clock: { outOfStock: 'c1' } }));
    await db.countLines.put({ id: 'game:rnd', gameId: 'rnd', code: '', name: 'Un', linearQty: 3, stockQty: 40, updatedAt: 2 });
    for (const which of ['products', 'countLines'] as const) {
      const tables: IdTables = { products: db.products, countLines: db.countLines, settings: db.settings, opsOut: db.opsOut };
      tables[which] = failing(db[which], 'bulkPut') as never;
      await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.parkedOps], async () => {
        await normalizeProductIds(tables).catch(() => undefined);
      });
      expect(await db.products.get('rnd')).toMatchObject({ outOfStock: true, user: { notes: 'n' }, _clock: { outOfStock: 'c1' } });
      expect(await db.countLines.get('game:rnd')).toMatchObject({ linearQty: 3, stockQty: 40 });
    }
    // La normalisation suivante fusionne le doublon laissé (ancien id + nouvel id).
    await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.parkedOps], () => normalizeProductIds(db));
    expect((await db.products.toArray()).map((p) => [p.id, p.outOfStock, p.user])).toEqual([['d:a|1', true, { notes: 'n' }]]);
    expect((await db.countLines.toArray()).map((l) => [l.id, l.linearQty])).toEqual([['game:d:a|1', 3]]);
  });

  it('relancer la normalisation ne change rien', async () => {
    await db.products.bulkPut([prod({ id: 'rnd', douaneRef: 'a|1', pinnedSubstitutes: ['u'] }), prod({ id: 'u', source: 'utilisateur', pinnedSubstitutes: ['rnd'] })]);
    await db.countLines.put({ id: 'game:rnd', gameId: 'rnd', code: '', name: 'Un', linearQty: 3, stockQty: 4, updatedAt: 2, _clock: { linearQty: 'c' } } as CountLine);
    await db.opsOut.add({ op: { e: 'product', id: 'rnd', f: { outOfStock: true }, t: 'c' } });
    const first = await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.parkedOps], () => normalizeProductIds(db));
    expect(first.size).toBe(1);
    const after = await dump();
    const second = await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.parkedOps], () => normalizeProductIds(db));
    expect(second.size).toBe(0);
    expect(await dump()).toEqual(after);
  });

  it('les produits récents ne sont réécrits qu’une fois la transaction validée', async () => {
    await db.products.put(prod({ id: 'rnd', douaneRef: 'a|1' }));
    localStorage.setItem('carotte:recent', JSON.stringify(['rnd']));
    await db.transaction('rw', [db.products, db.countLines, db.settings, db.opsOut, db.parkedOps], async () => {
      await normalizeProductIds(db);
      throw new Error('annulée');
    }).catch(() => undefined);
    expect(readRecent()).toEqual(['rnd']);
    expect(await db.products.get('rnd')).toBeDefined();
  });

  it('renommage Douane (previousRef) : d:ancien → d:nouveau, avec ses lignes, opérations et produits récents', async () => {
    await syncReferences(fetchOf(refFile));
    await db.countLines.put({ id: 'game:d:a|1', gameId: 'd:a|1', code: '', name: 'Un', linearQty: 2, stockQty: 6, updatedAt: 4, _clock: { stockQty: 'c' } } as CountLine);
    await db.products.put(prod({ id: 'u', source: 'utilisateur', pinnedSubstitutes: ['d:a|1'] }));
    await setOutOfStock('d:a|1', true);
    localStorage.setItem('carotte:recent', JSON.stringify(['d:a|1']));
    const renamed: ReferenceFile = { ...refFile, version: 'v2', items: [{ ...refFile.items[0], ref: 'a|1bis', previousRef: 'a|1' }, refFile.items[1]] };
    await syncReferences(fetchOf(renamed));
    expect(await db.products.get('d:a|1')).toBeUndefined();
    expect(await db.products.get('d:a|1bis')).toMatchObject({ douaneRef: 'a|1bis', outOfStock: true });
    expect((await db.products.get('u'))!.pinnedSubstitutes).toEqual(['d:a|1bis']);
    expect(await db.countLines.get('game:d:a|1')).toBeUndefined();
    expect(await db.countLines.get('game:d:a|1bis')).toMatchObject({ gameId: 'd:a|1bis', linearQty: 2, stockQty: 6, _clock: { stockQty: 'c' } });
    expect((await db.opsOut.toArray()).map((r) => r.op.id)).toEqual(['d:a|1bis']);
    expect(readRecent()).toEqual(['d:a|1bis']);
  });

  it('données abîmées (remplaçants, jeux enlevés) : la liste officielle est quand même mise à jour', async () => {
    await db.products.put(prod({ id: 'rnd', douaneRef: 'a|1', pinnedSubstitutes: 'abîmé' as never }));
    await db.settings.put({ key: 'main', shopName: 'T', sortCount: 'name', hiddenGames: 'abîmé' as never });
    expect(await syncReferences(fetchOf(refFile))).toEqual({ updated: true, version: 'v1' });
    expect((await db.products.get('d:a|1'))!.pinnedSubstitutes).toBe('abîmé');
    expect((await db.settings.get('main'))!).toMatchObject({ hiddenGames: 'abîmé', referencesVersion: 'v1' });
  });

  it('une normalisation qui échoue n’empêche pas la mise à jour des listes Douane et FDJ', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await db.products.put(prod({ id: 'rnd', douaneRef: 'a|1' }));
    vi.spyOn(db.countLines, 'toArray').mockRejectedValue(new Error('panne'));
    expect(await syncReferences(fetchOf(refFile))).toEqual({ updated: true, version: 'v1' });
    expect(await syncFdjGames(fetchOf(fdjFile))).toEqual({ updated: true, version: 'f1' });
    // La fiche « rnd » reste (non effacée) ; elle passera à son id stable à la prochaine normalisation.
    expect((await listProducts()).map((p) => p.id).sort()).toEqual(['d:a|2', 'f:fdj|ITGC9K', 'rnd']);
    expect(error).toHaveBeenCalled();
  });

  it('un jeu de l’ancienne liste de départ repris par la liste FDJ change d’id, et sa ligne le suit', async () => {
    await db.products.put({ id: 'depart:cash', source: 'depart', base: { kind: 'jeu-fdj', name: 'Cash' }, user: { fdjPrefix: '0417' }, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 });
    await db.countLines.put({ id: 'game:depart:cash', gameId: 'depart:cash', code: '0417', name: 'Cash', linearQty: 2, stockQty: 5, updatedAt: 3 });
    await syncFdjGames(fetchOf(fdjFile));
    expect((await listProducts()).map((p) => [p.id, p.source, p.user.fdjPrefix])).toEqual([['f:fdj|ITGC9K', 'fdj', '0417']]);
    expect(await db.countLines.get('game:depart:cash')).toBeUndefined();
    expect(await db.countLines.get('game:f:fdj|ITGC9K')).toMatchObject({ gameId: 'f:fdj|ITGC9K', linearQty: 2, stockQty: 5 });
    expect(await db.opsOut.count()).toBe(0);
  });

  it('une sauvegarde d’avant (ids au hasard) est restaurée avec les ids stables', async () => {
    const data = {
      products: [
        prod({ id: 'rnd-d', douaneRef: 'a|1', base: { kind: 'cigarette', name: 'Un' }, pinnedSubstitutes: ['rnd-f'] }),
        prod({ id: 'rnd-f', source: 'fdj', fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' } }),
      ],
      countLines: [{ id: 'game:rnd-f', gameId: 'rnd-f', code: '0417', name: 'CASH', linearQty: 3, stockQty: 40, updatedAt: 2 }],
      settings: { shopName: 'Tabac', sortCount: 'name' as const, hiddenGames: ['rnd-f'] },
    };
    expect((await restoreFromText(serializeBackup(data, 5))).ok).toBe(true);
    expect((await listProducts()).map((p) => p.id).sort()).toEqual(['d:a|1', 'f:fdj|ITGC9K']);
    expect((await db.products.get('d:a|1'))!.pinnedSubstitutes).toEqual(['f:fdj|ITGC9K']);
    expect((await db.countLines.toArray()).map((l) => [l.id, l.gameId])).toEqual([['game:f:fdj|ITGC9K', 'f:fdj|ITGC9K']]);
    expect((await db.settings.get('main'))!.hiddenGames).toEqual(['f:fdj|ITGC9K']);
  });

  it('deux téléphones : la rupture saisie sur A pour la référence X arrive sur la fiche X de B', async () => {
    // Téléphone A : liste reçue, rupture saisie.
    await syncReferences(fetchOf(refFile));
    await setOutOfStock('d:a|1', true);
    const ops = (await db.opsOut.toArray()).map((r) => r.op);
    expect(ops).toEqual([expect.objectContaining({ e: 'product', id: 'd:a|1', f: { outOfStock: true } })]);
    // Téléphone B : base neuve, même liste, aucun historique commun.
    await db.delete();
    await db.open();
    await syncReferences(fetchOf(refFile));
    expect(await applyRemoteOps(ops)).toBe(1);
    expect((await db.products.get('d:a|1'))!.outOfStock).toBe(true);
    expect((await db.products.get('d:a|2'))!.outOfStock).toBe(false);
  });
});
