import { test, expect } from '@playwright/test';
import { seed, testMode } from './helpers';
import { catalogSeed } from './fixtures';

test.beforeEach(async ({ page }) => {
  await testMode(page);
  await page.goto('./#catalogue');
  await seed(page, catalogSeed);
});

test('recherche insensible aux accents et filtre par famille', async ({ page }) => {
  await page.getByPlaceholder('Nom, marque ou code').fill('DUNHILL');
  await expect(page.getByRole('button', { name: /Dunhill rouge/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Dunhill bleu/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Camel Filters/ })).toHaveCount(0);
  await page.getByPlaceholder('Nom, marque ou code').fill('');
  await page.getByRole('button', { name: 'Cigares', exact: true }).click();
  await expect(page.getByRole('button', { name: /Cohiba Club/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Camel Filters/ })).toHaveCount(0);
  await page.getByRole('button', { name: /En rupture · 1/ }).click();
  await expect(page.getByRole('button', { name: /Marlboro Red/ })).toBeVisible();
});

test('produit manquant : remplaçants en 1 tap, sans produit en rupture, épinglage', async ({ page }) => {
  await page.getByPlaceholder('Nom, marque ou code').fill('camel');
  await page.getByRole('button', { name: /Camel Filters/ }).click();
  await page.getByRole('button', { name: 'En stock' }).click(); // 1 tap : passe en rupture
  const subs = page.getByRole('region', { name: 'À proposer au client' });
  await expect(subs).toBeVisible();
  await expect(subs.getByText(/Autre marque, même goût \(Classique|Rouge\)/).first()).toBeVisible();
  await expect(subs.getByText(/Marlboro Red/)).toHaveCount(0);
  await expect(subs.getByText(/Cohiba/)).toHaveCount(0);
  const last = subs.locator('.sub').last();
  const lastName = (await last.locator('b').innerText()).trim();
  await last.getByRole('button', { name: 'Épingler' }).click();
  await expect(subs.locator('.sub').first().locator('b')).toHaveText(lastName);
  await expect(subs.locator('.sub').first().getByText(/^Épinglé/)).toBeVisible();
});

test('bouton « Proposer un remplaçant » sur une fiche en stock', async ({ page }) => {
  await page.getByPlaceholder('Nom, marque ou code').fill('lucky');
  await page.getByRole('button', { name: /Lucky Strike Red/ }).click();
  await page.getByRole('button', { name: 'Proposer un remplaçant' }).click();
  await expect(page.getByRole('region', { name: 'À proposer au client' })).toBeVisible();
  await expect(page.getByText('Force et goût : estimations de départ, modifiables.')).toBeVisible();
});

test('modifier le goût puis revenir à la valeur officielle', async ({ page }) => {
  await page.getByPlaceholder('Nom, marque ou code').fill('winston');
  await page.getByRole('button', { name: /Winston Classic/ }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.getByRole('button', { name: 'doux', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('corsé · doux')).toBeVisible();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.getByRole('button', { name: /Revenir à la valeur officielle \(corsé\)/ }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('corsé', { exact: true })).toBeVisible();
});

test('nouvelle référence affichée « en vente au 1er novembre 2026 »', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-16T12:00:00'));
  await page.getByPlaceholder('Nom, marque ou code').fill('pall mall');
  await page.getByRole('button', { name: /Pall Mall Red/ }).click();
  await expect(page.getByText('En vente au 1er novembre 2026')).toBeVisible();
});

test('comparer 2 produits : différences surlignées', async ({ page }) => {
  await page.getByPlaceholder('Nom, marque ou code').fill('dunhill');
  await page.getByRole('checkbox', { name: /Comparer Dunhill rouge/ }).check();
  await page.getByRole('checkbox', { name: /Comparer Dunhill bleu/ }).check();
  await page.getByRole('button', { name: 'Comparer (2)' }).click();
  const table = page.getByRole('table', { name: 'Comparaison' });
  await expect(table).toBeVisible();
  await expect(table.locator('td.diff').first()).toBeVisible();
  await expect(table.getByRole('row', { name: /Force/ }).locator('td.diff')).toHaveCount(2);
});

test('sans recherche : récemment consultés', async ({ page }) => {
  await page.getByPlaceholder('Nom, marque ou code').fill('cohiba');
  await page.getByRole('button', { name: /Cohiba Club/ }).click();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByPlaceholder('Nom, marque ou code').fill('');
  await expect(page.getByText('Récemment consultés')).toBeVisible();
  await expect(page.getByRole('button', { name: /Cohiba Club/ })).toBeVisible();
});

test('modifier un jeu garde le préfixe appris (couche user préservée)', async ({ page }) => {
  await seed(page, { products: [
    { id: 'cash', source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', name: 'Cash', ticketPrice: 5 }, user: { fdjPrefix: '0417', nicotineMg: 1 } },
  ] });
  await page.getByPlaceholder('Nom, marque ou code').fill('cash');
  await page.getByRole('button', { name: /^Cash/ }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Gain maximum (€)').fill('500000');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('500 000,00 €')).toBeVisible();
  const user = await page.evaluate(async () => {
    const req = indexedDB.open('la-carotte');
    const dbh: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    return new Promise((r) => { const g = dbh.transaction('products').objectStore('products').get('cash'); g.onsuccess = () => r(g.result.user); });
  });
  expect(user).toMatchObject({ fdjPrefix: '0417', nicotineMg: 1, maxPrize: 500000 });
});
