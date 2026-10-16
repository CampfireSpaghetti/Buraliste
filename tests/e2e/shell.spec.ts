import { test, expect } from '@playwright/test';

test('affiche les 4 onglets et navigue vers Grattage', async ({ page }) => {
  await page.goto('./');
  const tabs = page.getByRole('navigation', { name: 'Onglets' });
  for (const name of ['Scanner', 'Catalogue', 'Grattage', 'Réglages']) {
    await expect(tabs.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await tabs.getByRole('button', { name: 'Grattage', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#grattage');
  await expect(page.getByRole('heading', { name: 'Comptage grattage' })).toBeVisible();
});
