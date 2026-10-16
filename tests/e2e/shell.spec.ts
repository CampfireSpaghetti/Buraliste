import { test, expect } from '@playwright/test';

test('affiche les 4 onglets et navigue vers Grattage', async ({ page }) => {
  await page.goto('./');
  for (const name of ['Scanner', 'Catalogue', 'Grattage', 'Réglages']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Grattage', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#grattage');
  await expect(page.getByRole('heading', { name: 'Comptage grattage' })).toBeVisible();
});
