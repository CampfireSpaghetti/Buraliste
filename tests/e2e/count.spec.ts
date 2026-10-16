import { test, expect, type Page } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

const game = (id: string, name: string, f: Record<string, unknown>) => ({
  id, source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', name, ...f }, user: {},
});
const seedData = { products: [game('cash', 'Cash', { ticketPrice: 5, fdjPrefix: '0417' }), game('astro', 'Astro', { ticketPrice: 2, barcodes: ['05200000000001'] })] };

const row = (page: Page, name: string) => page.locator('tbody tr', { has: page.getByRole('button', { name, exact: true }) });
const keypad = (page: Page) => page.getByRole('dialog', { name: /Quantité/ });
async function type(page: Page, digits: string) {
  for (const d of digits) await keypad(page).getByRole('button', { name: d, exact: true }).click();
  await keypad(page).getByRole('button', { name: 'Valider' }).click();
}

test.beforeEach(async ({ page }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await seed(page, seedData);
});

test('comptage complet : ligne manuelle, scan, re-scan, pavé, total, tri, suppression', async ({ page }) => {
  // 1. Ligne manuelle
  await page.getByRole('button', { name: '+ Ligne' }).click();
  await page.getByLabel('Nom du jeu').fill('Millionnaire');
  await page.getByLabel('Quantité').fill('12');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(row(page, 'Millionnaire')).toContainText('12');
  await expect(row(page, 'Millionnaire')).toContainText(/\d{2}\/\d{2} \d{2}:\d{2}/);

  // 2. Scan d'un jeu connu absent de la liste
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  await scan(page, '04170012345678');
  await expect(keypad(page)).toContainText('Cash');
  await type(page, '38');
  await expect(row(page, 'Cash')).toContainText('38');
  await expect(page.getByText('Dernier : Cash → 38')).toBeVisible();

  // 3. Re-scan du même jeu : ligne illuminée, pavé sur 38
  await page.waitForTimeout(1600);
  await scan(page, '04170012345678');
  await expect(row(page, 'Cash')).toHaveClass(/hit/);
  await expect(page.getByTestId('keypad-display')).toHaveText('38');

  // 4. Scan pendant que le pavé est ouvert : ignoré
  await scan(page, '05200000000001');
  await expect(keypad(page)).toHaveCount(1);
  await expect(keypad(page)).toContainText('Cash');
  await type(page, '42');
  await expect(row(page, 'Astro')).toHaveCount(0);
  await page.getByRole('button', { name: 'Terminer' }).click();

  // 5. Modifier le nom d'une ligne : la date de la ligne change
  const before = Number(await row(page, 'Millionnaire').getAttribute('data-updated'));
  await page.waitForTimeout(50);
  await row(page, 'Millionnaire').getByRole('button', { name: 'Millionnaire', exact: true }).click();
  await page.getByLabel('Nom du jeu').fill('Millionnaire 10€');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(row(page, 'Millionnaire 10€')).toBeVisible();
  expect(Number(await row(page, 'Millionnaire 10€').getAttribute('data-updated'))).toBeGreaterThan(before);

  // 7. Total
  await expect(page.getByRole('row', { name: /Total · 2 jeux/ })).toContainText('54');

  // 8. Tri par date
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText('Millionnaire 10€');
  await page.getByRole('button', { name: 'Nom', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText('Cash');

  // 6. Supprimer puis annuler
  await row(page, 'Cash').getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(row(page, 'Cash')).toHaveCount(0);
  await expect(page.getByText('Ligne supprimée')).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(row(page, 'Cash')).toContainText('42');
});

test('toucher la quantité ouvre le pavé ; glisser pour supprimer', async ({ page }) => {
  await page.getByRole('button', { name: '+ Ligne' }).click();
  await page.getByLabel('Nom du jeu').fill('Banco');
  await page.getByLabel('Quantité').fill('5');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('button', { name: 'Quantité Banco : 5' }).click();
  await expect(page.getByTestId('keypad-display')).toHaveText('5');
  await type(page, '9');
  await expect(row(page, 'Banco')).toContainText('9');

  const box = (await row(page, 'Banco').boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Supprimer Banco' }).click();
  await expect(row(page, 'Banco')).toHaveCount(0);
});

test('code inconnu : « C’est quel jeu ? » apprend le préfixe', async ({ page }) => {
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  await scan(page, '05209999999999');
  const dlg = page.getByRole('dialog', { name: "C'est quel jeu ?" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button').first()).toContainText('Astro');
  await dlg.getByRole('button', { name: /Astro/ }).click();
  await type(page, '7');
  await page.waitForTimeout(100);
  await scan(page, '05201111111111');
  await expect(page.getByRole('dialog', { name: "C'est quel jeu ?" })).toHaveCount(0);
  await expect(keypad(page)).toContainText('Astro');
});

test('jeu inconnu : mini-fiche puis pavé', async ({ page }) => {
  await seed(page, { products: [] });
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  await scan(page, '09990000000001');
  await page.getByLabel('Nom du jeu').fill('Volcano Rex');
  await page.getByLabel('Prix du ticket (€)').fill('3');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await type(page, '15');
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect(row(page, 'Volcano Rex')).toContainText('15');
});

test('« + Ligne » pour un jeu déjà compté met à jour sa ligne au lieu d’en créer une seconde', async ({ page }) => {
  for (const qty of ['10', '25']) {
    await page.getByRole('button', { name: '+ Ligne' }).click();
    await page.getByLabel('Nom du jeu').fill('cash');
    await page.getByLabel('Quantité', { exact: true }).fill(qty);
    await page.getByRole('button', { name: 'Ajouter' }).click();
  }
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('25');
  await expect(page.getByRole('row', { name: /Total · 1 jeu/ })).toContainText('25');
});
