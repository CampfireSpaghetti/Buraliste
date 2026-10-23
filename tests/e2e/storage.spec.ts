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

test('iPhone dans Safari : conseil d’installer, guide iOS 26 en premier, adresse à copier', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 }, locale: 'fr-FR',
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await testMode(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { value: { persisted: async () => true, persist: async () => true } });
  });
  await page.goto('./#grattage');
  await expect(page.getByText(/Installez La Carotte sur l'écran d'accueil/)).toBeVisible();
  await page.getByRole('button', { name: 'Comment installer' }).click();
  const guide = page.getByRole('dialog', { name: 'Installer sur mon téléphone' });
  await expect(guide.getByRole('heading', { level: 3 }).first()).toHaveText('iPhone (Safari)');
  await expect(guide).toContainText('Menu de la page');
  await expect(guide).toContainText('« Ouvrir comme app web » activé');
  await guide.getByText('Je ne trouve pas ces boutons').click();
  await expect(guide).toContainText('Modifier les actions');
  await guide.getByRole('button', { name: "Copier l'adresse" }).click();
  await expect(guide.getByRole('button', { name: 'Adresse copiée' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/Buraliste\/$/);
  await guide.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Compris' }).click();
  await expect(page.getByText(/Installez La Carotte/)).toHaveCount(0);
  await ctx.close();
});
