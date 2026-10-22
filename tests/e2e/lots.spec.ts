import { test, expect } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

// Lots lus dans le fichier publié public/data/fdj-lots.json (robot hebdomadaire) : on vérifie la présentation, pas
// les chiffres, qui suivent les règlements FDJ.
const fdjGame = (ref: string, name: string, prefix: string) => ({
  id: 'f:' + ref, source: 'fdj', fdjRef: ref, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'jeu-fdj', name, ticketPrice: 5, status: 'inchange' }, user: { fdjPrefixes: [prefix] },
});

test.beforeEach(async ({ page }) => {
  await testMode(page);
});

test('fiche CASH : section « Lots » (chance, taux de retour, gain maximal, tableau, source) ; jeu sans tableau connu : pas de section', async ({ page }) => {
  await page.goto('./#scanner');
  await seed(page, { products: [fdjGame('fdj|ITGC9K', 'CASH', '87105'), fdjGame('fdj|ITGZZZ', 'Jeu sans tableau', '99901')] });
  await scan(page, '871050020005');
  const fiche = page.getByRole('dialog', { name: 'CASH' });
  const lots = fiche.getByRole('region', { name: 'Lots' });
  await expect(lots).toContainText(/1 chance sur \d+,\d\d de gagner/);
  await expect(lots).toContainText(/Taux de retour aux joueurs : \d+(,\d)?\s%/);
  await expect(lots).toContainText(/Gain maximal : [\d\s]+\s€/);
  await expect(lots.getByRole('columnheader')).toHaveText(['Montant', 'Nombre de lots']);
  await expect(lots).toContainText("D'après le règlement FDJ du jeu · mis à jour le");
  await fiche.getByRole('button', { name: 'Fermer' }).click();

  await page.waitForTimeout(1600);
  await scan(page, '999010000001');
  const autre = page.getByRole('dialog', { name: 'Jeu sans tableau' });
  await expect(autre.getByRole('region', { name: 'Codes-barres' })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(autre.getByRole('region', { name: 'Lots' })).toHaveCount(0);
});
