import { test, expect } from '@playwright/test';
import { testMode } from './helpers';

test('stockage non persistant : conseil d’installer l’app et de sauvegarder', async ({ page }) => {
  await testMode(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false, persist: async () => false } });
  });
  await page.goto('./#grattage');
  await expect(page.getByText(/Stockage non garanti/)).toBeVisible();
  await page.getByRole('button', { name: 'Compris' }).click();
  await expect(page.getByText(/Stockage non garanti/)).toHaveCount(0);
});

test('stockage persistant : pas de bandeau', async ({ page }) => {
  await testMode(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { value: { persisted: async () => true, persist: async () => true } });
  });
  await page.goto('./#grattage');
  await page.waitForTimeout(500);
  await expect(page.getByText(/Stockage non garanti/)).toHaveCount(0);
});
