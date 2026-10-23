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
/** Scan : le pavé demande la quantité linéaire, puis la quantité stock. */
async function typeBoth(page: Page, linear: string, stock: string) {
  await expect(page.getByRole('dialog', { name: /Quantité linéaire/ })).toBeVisible();
  await type(page, linear);
  await expect(page.getByRole('dialog', { name: /Quantité stock/ })).toBeVisible();
  await type(page, stock);
}
async function addLine(page: Page, name: string, linear: string, stock: string) {
  await page.getByRole('button', { name: '+ Ligne' }).click();
  await page.getByLabel('Nom du jeu').fill(name);
  await page.getByLabel('Quantité linéaire', { exact: true }).fill(linear);
  await page.getByLabel('Quantité stock', { exact: true }).fill(stock);
  await page.getByRole('button', { name: 'Ajouter' }).click();
}

test.beforeEach(async ({ page }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await seed(page, seedData);
});

test('comptage complet : ligne manuelle, scan, re-scan, pavé, total, tri, suppression', async ({ page }) => {
  // 1. Ligne manuelle (linéaire + stock)
  await addLine(page, 'Millionnaire', '12', '100');
  await expect(row(page, 'Millionnaire').getByRole('button', { name: 'Linéaire Millionnaire : 12' })).toBeVisible();
  await expect(row(page, 'Millionnaire').getByRole('button', { name: 'Stock Millionnaire : 100' })).toBeVisible();
  await expect(row(page, 'Millionnaire')).toContainText(/\d{2}\/\d{2}\s*\d{2}:\d{2}/);

  // 2. Scan d'un jeu connu absent de la liste
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  await scan(page, '04170012345678');
  await expect(keypad(page)).toContainText('Cash');
  await typeBoth(page, '38', '120');
  await expect(row(page, 'Cash').getByRole('button', { name: 'Linéaire Cash : 38' })).toBeVisible();
  await expect(row(page, 'Cash').getByRole('button', { name: 'Stock Cash : 120' })).toBeVisible();
  await expect(page.getByText('Dernier : Cash → 38 · 120')).toBeVisible();

  // 3. Re-scan du même jeu : ligne illuminée, pavé sur 38
  await page.waitForTimeout(1600);
  await scan(page, '04170012345678');
  await expect(row(page, 'Cash')).toHaveClass(/hit/);
  await expect(page.getByTestId('keypad-display')).toHaveText('38');

  // 4. Scan pendant que le pavé est ouvert : ignoré
  await scan(page, '05200000000001');
  await expect(keypad(page)).toHaveCount(1);
  await expect(keypad(page)).toContainText('Cash');
  await typeBoth(page, '42', '118');
  await expect(page.getByRole('button', { name: 'Linéaire Astro : 0' })).toBeVisible();
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
  const total = page.getByRole('row', { name: /Total · 3 jeux/ });
  await expect(total).toContainText('54');
  await expect(total).toContainText('218');

  // 8. Tri par date
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText('Millionnaire 10€');
  await page.getByRole('button', { name: 'Nom', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText('Astro');

  // 6. Supprimer puis annuler
  await row(page, 'Cash').getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(row(page, 'Cash')).toHaveCount(0);
  await expect(page.getByText('Ligne supprimée')).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(row(page, 'Cash').getByRole('button', { name: 'Linéaire Cash : 42' })).toBeVisible();
});

test('toucher le linéaire enchaîne sur le stock ; toucher le stock ne corrige que lui ; glisser pour supprimer', async ({ page }) => {
  await addLine(page, 'Banco', '5', '40');
  await page.getByRole('button', { name: 'Linéaire Banco : 5' }).click();
  await expect(page.getByTestId('keypad-display')).toHaveText('5');
  await typeBoth(page, '9', '40');
  await expect(keypad(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Stock Banco : 40' }).click();
  await expect(page.getByRole('dialog', { name: /Quantité stock/ })).toBeVisible();
  await type(page, '60');
  await expect(page.getByRole('button', { name: 'Linéaire Banco : 9' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stock Banco : 60' })).toBeVisible();

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
  await typeBoth(page, '7', '0');
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
  await typeBoth(page, '15', '30');
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByRole('button', { name: 'Linéaire Volcano Rex : 15' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stock Volcano Rex : 30' })).toBeVisible();
});

test('« + Ligne » pour un jeu déjà compté met à jour sa ligne au lieu d’en créer une seconde', async ({ page }) => {
  await addLine(page, 'cash', '10', '100');
  await addLine(page, 'cash', '25', '90');
  await expect(page.locator('tbody tr')).toHaveCount(2); // Cash (mis à jour) et Astro (listé d'office)
  await expect(page.getByRole('button', { name: /^Linéaire .* : 25$/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Total · 2 jeux/ })).toContainText('90');
});

test('tous les jeux sont listés d’office ; toucher le linéaire enchaîne sur le stock', async ({ page }) => {
  await expect(row(page, 'Astro')).toContainText('—');
  await expect(row(page, 'Cash')).toContainText('—');
  await expect(page.getByRole('button', { name: 'Linéaire Astro : 0' })).toBeVisible();
  await page.getByRole('button', { name: 'Linéaire Astro : 0' }).click();
  await typeBoth(page, '12', '40');
  await expect(page.getByRole('button', { name: 'Linéaire Astro : 12' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stock Astro : 40' })).toBeVisible();
  await expect(row(page, 'Astro')).toContainText(/\d{2}\/\d{2}\s*\d{2}:\d{2}/);
  await expect(keypad(page)).toHaveCount(0);
});

test('un jeu enlevé de la liste ne revient pas tout seul', async ({ page }) => {
  await row(page, 'Astro').getByRole('button', { name: 'Astro', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(row(page, 'Astro')).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'Cash')).toBeVisible();
  await expect(row(page, 'Astro')).toHaveCount(0);
  await addLine(page, 'Astro', '3', '0'); // « + Ligne » le remet
  await expect(page.getByRole('button', { name: 'Linéaire Astro : 3' })).toBeVisible();
});

test('EAN inconnu au comptage (carnet, boîte) : rattaché à un jeu existant, puis reconnu seul', async ({ page }) => {
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  await scan(page, '3760000000024');
  const dlg = page.getByRole('dialog', { name: "C'est quel jeu ?" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: '+ Nouveau jeu' })).toBeVisible();
  await dlg.getByRole('button', { name: /Cash/ }).click();
  await typeBoth(page, '4', '20');
  await page.waitForTimeout(1600); // anti-doublon
  await scan(page, '3760000000024');
  await expect(page.getByRole('dialog', { name: "C'est quel jeu ?" })).toHaveCount(0);
  await expect(keypad(page)).toContainText('Cash');
});
