import { test, expect, type Page } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

const fdjGame = (ref: string, name: string, base: Record<string, unknown>, user: Record<string, unknown> = {}) => ({
  id: 'f:' + ref, source: 'fdj', fdjRef: ref, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'jeu-fdj', name, status: 'inchange', ...base }, user,
});
const marlboro = {
  id: 'd:pmi|marlboro', source: 'douane', douaneRef: 'pmi|marlboro', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'cigarette', name: 'Marlboro Gold, en 20 unités', price: 13, brand: 'Marlboro', status: 'inchange', effectiveDate: '2026-01-01' }, user: {},
};
const cash = (user: Record<string, unknown> = {}) => fdjGame('fdj|ITGC9K', 'CASH', { ticketPrice: 5, fdjCodes: ['87103', '87104', '87105'] }, user);
const astro = fdjGame('fdj|ITGAT7', 'Astro', { ticketPrice: 2, fdjCodes: ['84701'] });

const keypad = (page: Page) => page.getByRole('dialog', { name: /Quantité/ });
async function type(page: Page, digits: string) {
  for (const d of digits) await keypad(page).getByRole('button', { name: d, exact: true }).click();
  await keypad(page).getByRole('button', { name: 'Valider' }).click();
}
async function typeBoth(page: Page, linear: string, stock: string) {
  await expect(page.getByRole('dialog', { name: /Quantité linéaire/ })).toBeVisible();
  await type(page, linear);
  await expect(page.getByRole('dialog', { name: /Quantité stock/ })).toBeVisible();
  await type(page, stock);
}
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });

test.beforeEach(async ({ page }) => {
  await testMode(page);
});

test('comptage : ticket inconnu → « Ce ticket est-il un CASH ? » → Oui ; un second ticket du même carnet est reconnu directement', async ({ page }) => {
  await page.goto('./#grattage');
  await seed(page, { products: [cash(), astro] });
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();

  await scan(page, '871050010001');
  const confirm = page.getByRole('dialog', { name: 'Ce ticket est-il un CASH ?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Oui' }).click();
  await expect(keypad(page)).toContainText('CASH');
  await typeBoth(page, '12', '40');

  await scan(page, '871050020005');
  await expect(keypad(page)).toContainText('CASH');
  await expect(page.getByRole('dialog', { name: /Ce ticket est-il/ })).toHaveCount(0);
  await typeBoth(page, '13', '41');

  // « Autre jeu » : le numéro du catalogue n'est pas confirmé, le ticket va au jeu choisi (recherche sans accents).
  await scan(page, '871040000001');
  await page.getByRole('dialog', { name: 'Ce ticket est-il un CASH ?' }).getByRole('button', { name: 'Autre jeu' }).click();
  const which = page.getByRole('dialog', { name: "C'est quel jeu ?" });
  await which.getByPlaceholder('Rechercher un jeu').fill('ASTRO');
  await which.getByRole('button', { name: /Astro/ }).click();
  await expect(keypad(page)).toContainText('Astro');
  await typeBoth(page, '1', '2');
  await scan(page, '871040000002');
  await expect(page.getByRole('dialog', { name: 'Ce ticket est-il un CASH ?' })).toBeVisible();
});

test('fiche CASH : codes listés, « Retirer » → le ticket n’est plus reconnu', async ({ page }) => {
  await page.goto('./#scanner');
  await seed(page, { products: [cash({ barcodes: ['871050010001'], fdjPrefixes: ['87105'] }), astro] });
  await scan(page, '871050020005');
  const fiche = sheet(page, 'CASH');
  await expect(fiche.getByRole('heading', { name: 'CASH' })).toBeVisible();
  const codes = fiche.getByRole('region', { name: 'Codes-barres' });
  await expect(codes).toContainText('Tickets 87105…');
  await expect(codes).toContainText('871050010001');
  await expect(codes).toContainText('87103, 87104, 87105');
  await codes.getByRole('button', { name: 'Retirer 87105', exact: true }).click();
  await expect(codes).not.toContainText('Tickets 87105…');
  await codes.getByRole('button', { name: 'Retirer 871050010001' }).click();
  await expect(codes).toContainText("Aucun code pour l'instant.");
  await fiche.getByRole('button', { name: 'Fermer' }).click();
  await page.waitForTimeout(1600);
  await scan(page, '871050020005');
  await expect(page.getByRole('dialog', { name: 'Ce ticket est-il un CASH ?' })).toBeVisible();
});

test('fiche d’une référence : « Ajouter un code » rattache le prochain code lu ; plusieurs codes par référence', async ({ page }) => {
  await page.goto('./#scanner');
  await seed(page, { products: [marlboro] });
  // Premier code : par l'écran « Code inconnu » (recherche dans les références officielles).
  await scan(page, '3017620422003');
  await page.getByPlaceholder('Rechercher une référence').fill('marlboro');
  await page.getByRole('button', { name: /Marlboro Gold/ }).click();
  const fiche = sheet(page, 'Marlboro Gold, en 20 unités');
  const codes = fiche.getByRole('region', { name: 'Codes-barres' });
  await expect(codes).toContainText('3017620422003');
  // Second code (cartouche) : « Ajouter un code ».
  await codes.getByRole('button', { name: 'Ajouter un code' }).click();
  const adding = page.getByRole('dialog', { name: /Ajouter un code/ });
  await expect(adding).toBeVisible();
  await scan(page, 'KPL2F0123456789ABCDEFGHIJKLMNOP');
  await expect(page.getByText('Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet.')).toBeVisible();
  await expect(adding).toBeVisible();
  await scan(page, '4006381333931');
  await expect(adding).toHaveCount(0);
  await expect(codes).toContainText('3017620422003');
  await expect(codes).toContainText('4006381333931');
  await expect(codes.getByRole('button', { name: /^Retirer/ })).toHaveCount(2);
  await fiche.getByRole('button', { name: 'Fermer' }).click();
  await page.waitForTimeout(1600);
  await scan(page, '4006381333931');
  await expect(sheet(page, 'Marlboro Gold, en 20 unités')).toBeVisible();
});

test('code de traçabilité (KPL2F, DataMatrix) : refusé avec un message, rien n’est créé ni demandé', async ({ page }) => {
  await page.goto('./#grattage');
  await seed(page, { products: [cash(), astro] });
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  await scan(page, 'KPL2F0123456789ABCDEFGHIJKLMNOP');
  await expect(page.getByText('Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await scan(page, '0123456789ABCDEF', 'data_matrix');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('./#scanner');
  await scan(page, '0123456789ABCDEF', 'data_matrix');
  await expect(page.getByText('Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
