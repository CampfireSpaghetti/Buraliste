import { test, expect, type Page } from '@playwright/test';
import { seed, testMode } from './helpers';

const game = (id: string, name: string) => ({ id, source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', name, ticketPrice: 5 }, user: {} });
const line = (gameId: string, name: string, linearQty: number, stockQty: number) => ({ id: `game:${gameId}`, gameId, code: '0417', name, linearQty, stockQty, updatedAt: Date.now() });

async function finish(page: Page, choice: 'Enregistrer et remettre à zéro' | 'Enregistrer seulement') {
  await page.getByRole('button', { name: 'Fin comptage' }).click();
  await page.getByRole('dialog', { name: 'Fin comptage' }).getByRole('button', { name: choice }).click();
}

test.beforeEach(async ({ page }) => {
  await testMode(page);
  await page.goto('./#grattage');
  await seed(page, { products: [game('cash', 'Cash'), game('astro', 'Astro')], countLines: [line('cash', 'Cash', 10, 60), line('astro', 'Astro', 5, 0)], settings: { lastBackupAt: Date.now() } });
});

test('« Fin comptage » : enregistrer seulement, puis enregistrer et remettre à zéro, et « Annuler »', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Historique', exact: true })).toBeDisabled();
  await finish(page, 'Enregistrer seulement');
  await expect(page.locator('.toast')).toContainText('Comptage enregistré');
  await expect(page.getByRole('button', { name: 'Historique · 1 comptage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Linéaire Cash : 10' })).toBeVisible(); // tableau gardé

  await finish(page, 'Enregistrer et remettre à zéro');
  await expect(page.getByRole('button', { name: 'Historique · 2 comptages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Linéaire Cash : 0' })).toBeVisible();
  await page.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('button', { name: 'Historique · 1 comptage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Linéaire Cash : 10' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stock Cash : 60' })).toBeVisible();
});

test('historique : liste, détail avec écart, premier comptage sans écart, supprimer puis annuler', async ({ page }) => {
  await finish(page, 'Enregistrer seulement');
  // Ventes : Cash passe de 70 à 58 tickets ; Astro de 5 à 5.
  await page.getByRole('button', { name: 'Linéaire Cash : 10' }).click();
  const keypad = page.getByRole('dialog', { name: /Quantité/ });
  for (const d of '4') await keypad.getByRole('button', { name: d, exact: true }).click();
  await keypad.getByRole('button', { name: 'Valider' }).click();
  for (const d of '54') await keypad.getByRole('button', { name: d, exact: true }).click();
  await keypad.getByRole('button', { name: 'Valider' }).click();
  await finish(page, 'Enregistrer seulement');

  await page.getByRole('button', { name: 'Historique · 2 comptages' }).click();
  const panel = page.getByRole('dialog', { name: 'Historique du grattage' });
  const items = panel.locator('.history-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('2 jeux · linéaire 9 · stock 54');
  await expect(items.first().getByLabel('Écart −12')).toBeVisible();
  await expect(items.nth(1).locator('.history-delta')).toHaveCount(0); // le plus ancien : pas de précédent

  await items.first().click();
  const detail = page.getByRole('dialog', { name: /^Comptage du / });
  await expect(detail.getByRole('row', { name: /^Cash/ })).toContainText('−12');
  await expect(detail.getByRole('row', { name: /^Astro/ })).toContainText('0');
  await detail.getByRole('button', { name: 'Supprimer ce comptage' }).click();
  await page.getByRole('dialog', { name: 'Supprimer ce comptage' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(items).toHaveCount(1);
  await panel.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
  await expect(items).toHaveCount(2);

  // Le plus ancien n'a pas d'écart.
  await items.nth(1).click();
  await expect(page.getByRole('dialog', { name: /^Comptage du / })).toContainText('Premier comptage de l’historique');
});

test('8 comptages au plus : le 9e retire le plus ancien', async ({ page }) => {
  for (let i = 0; i < 9; i++) {
    await finish(page, 'Enregistrer seulement');
    await expect(page.getByRole('button', { name: `Historique · ${Math.min(i + 1, 8)} ${i ? 'comptages' : 'comptage'}` })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Historique · 8 comptages' })).toBeVisible();
  await page.getByRole('button', { name: 'Fin comptage' }).click();
  await expect(page.getByRole('dialog', { name: 'Fin comptage' })).toContainText('Le plus ancien des 8 comptages gardés sera retiré.');
});
