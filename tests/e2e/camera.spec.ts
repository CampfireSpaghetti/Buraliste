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
