import { test, expect, type Page } from '@playwright/test';
import { testMode } from './helpers';

/**
 * Migration v4 → v5 (ids stables, R20) dans un vrai navigateur : une base « la-carotte » au schéma v4, telle que Dexie
 * l'a créée (version IndexedDB = 4 × 10), avec des ids au hasard, est ouverte par l'app actuelle.
 * Schéma v4 (src/data/db.ts, versions 1 à 4) :
 *   products 'id, douaneRef, source, updatedAt' · countLines 'id, gameId, updatedAt' · settings 'key'
 *   outbox '++id, createdAt' · opsOut '++seq' · syncState 'key'
 */
const CLOCK = '0000001700000-0000-aaaaaaaa';
const v4Data = {
  products: [
    {
      id: 'rnd-d1', source: 'douane', douaneRef: 'pmi|marlboro red', updatedAt: 5,
      base: { kind: 'cigarette', name: 'Marlboro Red, en 20 unités', brand: 'Marlboro', price: 13, status: 'inchange' },
      user: { notes: 'Client du matin', barcodes: ['3000000000017'] }, outOfStock: true, pinnedSubstitutes: ['rnd-d2', 'rnd-f1'],
      _clock: { outOfStock: CLOCK, 'user.notes': CLOCK },
    },
    {
      id: 'rnd-d2', source: 'douane', douaneRef: 'jti|camel', updatedAt: 1,
      base: { kind: 'cigarette', name: 'Camel Filters, en 20 unités', brand: 'Camel', price: 12, status: 'inchange' },
      user: {}, outOfStock: false, pinnedSubstitutes: [],
    },
    {
      id: 'rnd-f1', source: 'fdj', fdjRef: 'fdj|ITGC9K', updatedAt: 2,
      base: { kind: 'jeu-fdj', name: 'Cash', ticketPrice: 5 }, user: { fdjPrefix: '0417' }, outOfStock: false, pinnedSubstitutes: [],
    },
    // jeux de l'ancienne liste de départ (sans référence) : id « depart:<nom comparable> »
    {
      id: 'rnd-g1', source: 'depart', updatedAt: 3,
      base: { kind: 'jeu-fdj', name: 'Goal !', ticketPrice: 2 }, user: {}, outOfStock: true, pinnedSubstitutes: ['rnd-f1'],
    },
    {
      id: 'rnd-g2', source: 'depart', updatedAt: 4,
      base: { kind: 'jeu-fdj', name: 'Astro', ticketPrice: 2 }, user: {}, outOfStock: false, pinnedSubstitutes: [],
    },
  ],
  countLines: [
    { id: 'game:rnd-f1', gameId: 'rnd-f1', code: '0417', name: 'Cash', linearQty: 3, stockQty: 7, updatedAt: 10, _clock: { linearQty: CLOCK } },
    { id: 'game:rnd-g1', gameId: 'rnd-g1', code: '', name: 'Goal !', linearQty: 2, stockQty: 4, updatedAt: 11 },
    { id: 'libre-1', code: '', name: 'Millionnaire', linearQty: 1, stockQty: 9, updatedAt: 12 },
  ],
  settings: { key: 'main', shopName: 'Tabac de la Migration', sortCount: 'name', hiddenGames: ['rnd-g2'] },
  ops: [{ op: { e: 'product', id: 'rnd-d1', f: { outOfStock: true }, t: CLOCK } }],
  recent: ['rnd-d1', 'rnd-f1', 'rnd-g1'],
};

/** Crée la base v4 avec l'API IndexedDB brute (sans Dexie), avant que l'app ne soit chargée. */
async function createV4Database(page: Page) {
  // Une page de la même origine qui ne charge pas l'app.
  await page.goto('./icons/favicon.svg');
  await page.evaluate(async (data) => {
    localStorage.setItem('carotte:recent', JSON.stringify(data.recent));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('la-carotte', 40);
      req.onupgradeneeded = () => {
        const idb = req.result;
        const products = idb.createObjectStore('products', { keyPath: 'id' });
        for (const i of ['douaneRef', 'source', 'updatedAt']) products.createIndex(i, i);
        const lines = idb.createObjectStore('countLines', { keyPath: 'id' });
        for (const i of ['gameId', 'updatedAt']) lines.createIndex(i, i);
        idb.createObjectStore('settings', { keyPath: 'key' });
        idb.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }).createIndex('createdAt', 'createdAt');
        idb.createObjectStore('opsOut', { keyPath: 'seq', autoIncrement: true });
        idb.createObjectStore('syncState', { keyPath: 'key' });
        const tx = req.transaction!;
        for (const p of data.products) tx.objectStore('products').put(p);
        for (const l of data.countLines) tx.objectStore('countLines').put(l);
        tx.objectStore('settings').put(data.settings);
        for (const o of data.ops) tx.objectStore('opsOut').add(o);
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }, v4Data);
}

/** Lit toute la base « la-carotte » (API brute, sans en changer la version). */
async function readDatabase(page: Page) {
  return page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('la-carotte');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = (store: string) =>
      new Promise<any[]>((resolve, reject) => {
        const r = idb.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const out = {
      version: idb.version,
      stores: [...idb.objectStoreNames].sort(),
      products: await all('products'),
      countLines: await all('countLines'),
      settings: await all('settings'),
      opsOut: await all('opsOut'),
      recent: JSON.parse(localStorage.getItem('carotte:recent') ?? '[]'),
    };
    idb.close();
    return out;
  });
}

test('migration v4 → v5 dans le navigateur : ids au hasard remplacés par les ids stables, rien de perdu', async ({ page }) => {
  await testMode(page);
  // Pas de relais : les opérations en file doivent rester en file pour être vérifiées.
  await page.route('http://localhost:8787/**', (r) => r.abort());
  await createV4Database(page);

  await page.goto('./#grattage');
  // Interface : comptages gardés sous les nouveaux ids, jeu enlevé de la liste toujours enlevé.
  const row = (name: string) => page.locator('tbody tr', { has: page.getByRole('button', { name, exact: true }) });
  await expect(row('Cash').getByRole('button', { name: 'Linéaire Cash : 3' })).toBeVisible();
  await expect(row('Cash').getByRole('button', { name: 'Stock Cash : 7' })).toBeVisible();
  await expect(row('Goal !').getByRole('button', { name: 'Linéaire Goal ! : 2' })).toBeVisible();
  await expect(row('Millionnaire').getByRole('button', { name: 'Stock Millionnaire : 9' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Astro', exact: true })).toHaveCount(0);

  const db = await readDatabase(page);
  expect(db.version).toBeGreaterThanOrEqual(50);
  expect(db.stores).toEqual(expect.arrayContaining(['countLines', 'opsOut', 'outbox', 'products', 'settings', 'syncState']));

  const byId = new Map(db.products.map((p: any) => [p.id, p]));
  expect([...byId.keys()].sort()).toEqual(['d:jti|camel', 'd:pmi|marlboro red', 'depart:astro', 'depart:goal', 'f:fdj|ITGC9K']);
  expect(byId.get('d:pmi|marlboro red')).toMatchObject({
    douaneRef: 'pmi|marlboro red', outOfStock: true, user: { notes: 'Client du matin', barcodes: ['3000000000017'] },
    pinnedSubstitutes: ['d:jti|camel', 'f:fdj|ITGC9K'], _clock: { outOfStock: CLOCK, 'user.notes': CLOCK },
  });
  expect(byId.get('f:fdj|ITGC9K')).toMatchObject({ fdjRef: 'fdj|ITGC9K', user: { fdjPrefix: '0417' } });
  expect(byId.get('depart:goal')).toMatchObject({ outOfStock: true, pinnedSubstitutes: ['f:fdj|ITGC9K'] });

  const lines = new Map(db.countLines.map((l: any) => [l.id, l]));
  expect(lines.get('game:f:fdj|ITGC9K')).toMatchObject({ gameId: 'f:fdj|ITGC9K', linearQty: 3, stockQty: 7, _clock: { linearQty: CLOCK } });
  expect(lines.get('game:depart:goal')).toMatchObject({ gameId: 'depart:goal', linearQty: 2, stockQty: 4 });
  expect(lines.get('libre-1')).toMatchObject({ name: 'Millionnaire', linearQty: 1, stockQty: 9 });
  // aucune trace des anciens ids
  expect(JSON.stringify([db.products, db.countLines, db.settings, db.opsOut])).not.toContain('rnd-');

  expect(db.settings.find((s: any) => s.key === 'main')).toMatchObject({ shopName: 'Tabac de la Migration', hiddenGames: ['depart:astro'] });
  expect(db.opsOut.map((r: any) => r.op)).toEqual([{ e: 'product', id: 'd:pmi|marlboro red', f: { outOfStock: true }, t: CLOCK }]);
  expect(db.recent).toEqual(['d:pmi|marlboro red', 'f:fdj|ITGC9K', 'depart:goal']);

  // Catalogue : les produits récemment consultés sont retrouvés sous leurs nouveaux ids.
  await page.goto('./#catalogue');
  await expect(page.getByText('Récemment consultés')).toBeVisible();
  await expect(page.getByText('Marlboro Red, en 20 unités')).toBeVisible();
  await expect(page.getByText('Tabac de la Migration').first()).toBeVisible();
});
