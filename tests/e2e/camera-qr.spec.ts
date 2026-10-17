import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { testMode } from './helpers';

// Flux caméra simulé montrant un vrai (ancien) QR code de jumelage : la caméra le lit et l'app explique quoi faire.
test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve('tests/fixtures/qr-jumelage.mjpeg')}`],
  },
  permissions: ['camera'],
});

test('lit un vrai ancien QR code de jumelage avec la caméra', async ({ page }) => {
  await testMode(page);
  await page.goto('./#scanner');
  await expect(page.getByText('Ancien QR code : demandez une invitation de tabac')).toBeVisible({ timeout: 15_000 });
});
