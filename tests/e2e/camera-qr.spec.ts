import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { testMode } from './helpers';

// Flux caméra simulé montrant un vrai QR code de jumelage (généré comme dans Réglages › Jumeler).
test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve('tests/fixtures/qr-jumelage.mjpeg')}`],
  },
  permissions: ['camera'],
});

test('lit un vrai QR code de jumelage avec la caméra', async ({ page }) => {
  await testMode(page);
  await page.goto('./#scanner');
  await expect(page.getByText('Jumeler ce téléphone avec Tabac du Centre ?')).toBeVisible({ timeout: 15_000 });
});
