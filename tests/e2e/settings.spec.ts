import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seed, testMode } from './helpers';

const line = (id: string, name: string, linearQty: number) => ({ id, code: '', name, linearQty, stockQty: 0, updatedAt: Date.now() });

test('nom du tabac, sauvegarde complète puis restauration', async ({ page }, info) => {
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, { countLines: [line('1', 'Cash', 38)] });

  await page.getByLabel('Nom du tabac').fill('Tabac de la Gare');
  await page.getByLabel('Nom du tabac').blur();
  await expect(page.locator('.app-header small')).toContainText('Tabac de la Gare');

  await page.getByRole('button', { name: 'Sauvegarde complète' }).click();
  const panel = page.getByRole('dialog', { name: 'Sauvegarde complète' });
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('link', { name: 'Télécharger' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^la-carotte-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = info.outputPath('sauvegarde.json');
  await download.saveAs(backupPath);
  expect(JSON.parse(readFileSync(backupPath, 'utf8')).countLines[0].name).toBe('Cash');
  await panel.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByText(/Dernière sauvegarde : \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

  // Les données changent, puis on restaure la sauvegarde
  await seed(page, { countLines: [line('2', 'Astro', 1)] });
  // Contenu passé directement : Playwright n'envoie pas un fichier dont le chemin contient des accents.
  await page.getByLabel('Choisir une sauvegarde').setInputFiles({ name: 'sauvegarde.json', mimeType: 'application/json', buffer: readFileSync(backupPath) });
  await expect(page.getByText('Remplacer toutes les données ?')).toBeVisible();
  await page.getByRole('button', { name: 'Remplacer' }).click();
  await expect(page.getByText('Données restaurées')).toBeVisible();
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Grattage' }).click();
  await expect(page.getByRole('button', { name: 'Cash', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Astro', exact: true })).toHaveCount(0);
});

test('fichier invalide : message clair, rien ne change', async ({ page }) => {
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, { countLines: [line('1', 'Cash', 38)] });
  await page.getByLabel('Choisir une sauvegarde').setInputFiles({ name: 'mauvais.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"autre"}') });
  await expect(page.getByRole('alert')).toHaveText('Ce fichier n’est pas une sauvegarde La Carotte.');
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Grattage' }).click();
  await expect(page.getByRole('button', { name: 'Cash', exact: true })).toBeVisible();
});

test('rappel de sauvegarde sur Grattage, « Plus tard » le masque', async ({ page }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await seed(page, { countLines: [line('1', 'Cash', 38)], settings: { lastBackupAt: Date.now() - 9 * 86_400_000 } });
  await expect(page.getByText('Dernière sauvegarde il y a 9 jours')).toBeVisible();
  await page.getByRole('button', { name: 'Plus tard' }).click();
  await expect(page.getByText('Dernière sauvegarde il y a 9 jours')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cash', exact: true })).toBeVisible();
  await expect(page.getByText(/Dernière sauvegarde il y a/)).toHaveCount(0);
});

test('guide d’installation et version de la liste officielle', async ({ page }) => {
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, { settings: { referencesEffectiveDate: '2026-11-01', referencesVersion: '2026-11-01-abcd1234' } });
  await expect(page.getByText('En vigueur au 1er novembre 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Installer sur mon téléphone' }).click();
  await expect(page.getByRole('heading', { name: 'iPhone (Safari)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Android (Chrome)' })).toBeVisible();
});
