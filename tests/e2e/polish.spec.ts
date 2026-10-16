import { test, expect } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

test('la carotte rebondit à chaque scan', async ({ page }) => {
  await testMode(page);
  await page.goto('./#scanner');
  await seed(page, {});
  await scan(page, '3017620422003');
  await expect(page.locator('.app-header .carotte')).toHaveClass(/bounce/);
});

test('aucune animation si « réduire les animations » est activé', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await testMode(page);
  await page.goto('./#scanner');
  await seed(page, {});
  await scan(page, '3017620422003');
  const name = await page.locator('.app-header .carotte').evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe('none');
  await context.close();
});

test('rouvre sur le dernier onglet utilisé, Grattage par défaut', async ({ page }) => {
  await testMode(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Comptage grattage', level: 2 })).toBeVisible();
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Catalogue' }).click();
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Catalogue', level: 2 })).toBeVisible();
});

test('fonctionne hors connexion après le premier chargement', async ({ page, context }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // la page est maintenant contrôlée par le service worker
  await seed(page, { countLines: [{ id: '1', code: '', name: 'Cash', quantity: 38, updatedAt: Date.now() }] });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cash', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Scanner' }).click();
  await expect(page.getByRole('button', { name: /Saisir le code/ })).toBeVisible();
  await context.setOffline(false);
});
