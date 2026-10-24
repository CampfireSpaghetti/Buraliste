import { test, expect } from '@playwright/test';

test('au démarrage, les listes Douane et FDJ publiées arrivent dans le catalogue', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./#catalogue');
  await page.getByRole('button', { name: 'Jeux FDJ', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Perle Rare/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Perle Rare/ }).click();
  await expect(page.getByText('Nouveau jeu')).toBeVisible();
  await expect(page.getByText('2,00 €').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Tout', exact: true }).click();
  await page.getByPlaceholder('Nom, marque ou code').fill('marlboro gold collection');
  await expect(page.getByRole('button', { name: /Marlboro Gold Collection, en 20 unités/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Réglages' }).click();
  await page.getByText('Données et sources').click();
  await expect(page.getByText(/Gamme en point de vente \(fdj\.fr\) · liste du .* · \d+ jeux/)).toBeVisible();
});
