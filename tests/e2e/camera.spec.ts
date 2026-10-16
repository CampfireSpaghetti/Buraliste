import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { testMode } from './helpers';

// Flux caméra simulé contenant un vrai code EAN-13 : vérifie la chaîne complète
// caméra → moteur de lecture zxing (servi par l'app, sans CDN) → reconnaissance.
test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve('tests/fixtures/ean13-3017620422003.mjpeg')}`],
  },
  permissions: ['camera'],
});

test('lit un vrai code-barres depuis la caméra', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4173/')) external.push(r.url()); });
  await testMode(page);
  await page.goto('./#scanner');
  await expect(page.getByRole('heading', { name: 'Code inconnu' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('3017620422003')).toBeVisible();
  expect(external).toEqual([]);
});

test('comptage : un ticket resté devant la caméra ne rouvre pas le pavé après Valider', async ({ page }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await page.waitForFunction(() => typeof (window as any).__carotteSeed === 'function');
  await page.evaluate(() => (window as any).__carotteSeed({ products: [
    { id: 'g', source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', name: 'Test', barcodes: ['3017620422003'] }, user: {} },
  ] }));
  await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
  const keypad = page.getByRole('dialog', { name: /Quantité/ });
  await expect(keypad).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000); // le temps de compter les tickets
  await keypad.getByRole('button', { name: '3', exact: true }).click();
  await keypad.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('dialog', { name: /Quantité stock/ })).toBeVisible();
  await page.waitForTimeout(1000);
  await keypad.getByRole('button', { name: '9', exact: true }).click();
  await keypad.getByRole('button', { name: 'Valider' }).click();
  await page.waitForTimeout(2500);
  await expect(keypad).toHaveCount(0);
  await expect(page.getByText('Dernier : Test → 3 · 9')).toBeVisible();
});
