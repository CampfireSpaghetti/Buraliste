import { test, expect } from '@playwright/test';
import { seed, testMode } from './helpers';

const line = (id: string, name: string, linearQty: number) => ({ id, code: '0417001234567' + id, name, linearQty, stockQty: linearQty * 3, updatedAt: Date.now() });

test('export .jpg : image de toute la page, aperçu et lien de téléchargement', async ({ page }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await seed(page, { countLines: [line('1', 'Cash', 38), line('2', 'Astro', 45), line('3', 'Millionnaire', 12)], settings: { shopName: 'Tabac du Centre' } });
  await page.getByRole('button', { name: 'Export .jpg' }).click();
  const panel = page.getByRole('dialog', { name: 'Export du comptage' });
  await expect(panel).toBeVisible();
  const img = panel.getByRole('img', { name: /Comptage grattage/ });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(2160);
  expect(await img.getAttribute('src')).toMatch(/^blob:/);
  const link = panel.getByRole('link', { name: 'Télécharger' });
  expect(await link.getAttribute('download')).toMatch(/^comptage-grattage-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$/);
  await expect(panel.getByText("Appui long sur l'image pour l'enregistrer")).toBeVisible();
  // Le fichier téléchargé est bien un JPEG
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^comptage-grattage-.*\.jpg$/);
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync((await download.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});

test('partage natif disponible : bouton Partager puis tampon', async ({ page }) => {
  await testMode(page);
  await page.addInitScript(() => {
    (navigator as any).canShare = () => true;
    (navigator as any).share = async (data: any) => { (window as any).__shared = data.files[0].name; };
  });
  await page.goto('./#grattage');
  await seed(page, { countLines: [line('1', 'Cash', 38)] });
  await page.getByRole('button', { name: 'Export .jpg' }).click();
  await page.getByRole('button', { name: /Partager/ }).click();
  await expect(page.getByText('Comptage exporté ✓')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__shared)).toMatch(/^comptage-grattage-.*\.jpg$/);
});
