import { test, expect, type Page } from '@playwright/test';
import { seed, testMode } from './helpers';

const service = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) });
const labels = (page: Page, name: 'Matin' | 'Après-midi') => service(page, name).locator('.task-label').allTextContents();
const box = (page: Page, label: string, s: 'Matin' | 'Après-midi' = 'Matin') => service(page, s).getByRole('checkbox', { name: label });
const tap = (page: Page, label: string, s: 'Matin' | 'Après-midi' = 'Matin') => service(page, s).getByText(label, { exact: true }).click();
const LIST = ['Vérifier stock grattage', 'Vérifier stock cigarettes', 'Remplir le linéaire', 'Remplir la vitrine', "Nettoyer l'espace de travail", 'Vérifier stock tabletterie', 'Vérifier stock grattage', 'Remplir la machine à café', "Nettoyer l'espace client"];

test.beforeEach(async ({ page }) => {
  await testMode(page);
  await page.goto('./#taches');
  await seed(page, { settings: { shopName: 'Tabac du Centre', lastBackupAt: Date.now() } });
});

test('onglet entre Catalogue et Grattage ; la même liste de base le matin et l’après-midi', async ({ page }) => {
  const tabs = page.getByRole('navigation', { name: 'Onglets' }).getByRole('button');
  await expect(tabs).toHaveText(['Scanner', 'Catalogue', 'À faire', 'Grattage', 'Réglages']);
  await expect(page.getByRole('heading', { name: 'À faire', level: 2 })).toBeVisible();
  await expect.poll(() => labels(page, 'Matin')).toEqual(LIST);
  expect(await labels(page, 'Après-midi')).toEqual(LIST);
  await expect(page.getByText('0 / 18 faites')).toBeVisible();
});

test('cocher affiche l’heure, décocher l’efface ; le compte suit', async ({ page }) => {
  await tap(page, 'Remplir la vitrine');
  await expect(box(page, 'Remplir la vitrine')).toBeChecked();
  await expect(box(page, 'Remplir la vitrine', 'Après-midi')).not.toBeChecked(); // chaque service a sa propre case
  await expect(service(page, 'Matin').locator('.task.done .task-time')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.getByText('1 / 18 faites')).toBeVisible();
  await expect(service(page, 'Matin').getByRole('heading')).toContainText('1 / 9');
  await tap(page, 'Remplir la vitrine');
  await expect(box(page, 'Remplir la vitrine')).not.toBeChecked();
  await expect(service(page, 'Matin').locator('.task-time')).toHaveCount(0);
});

test('ajouter (texte vide refusé), modifier, changer de service, supprimer puis annuler', async ({ page }) => {
  await page.getByRole('button', { name: '+ Tâche' }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle tâche' });
  await sheet.getByLabel('Tâche à faire').fill('   ');
  await expect(sheet.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
  await sheet.getByLabel('Tâche à faire').fill('Sortir les poubelles');
  await sheet.getByRole('button', { name: 'Après-midi' }).click();
  await sheet.getByRole('button', { name: 'Ajouter' }).click();
  await expect.poll(async () => (await labels(page, 'Après-midi')).at(-1)).toBe('Sortir les poubelles');

  await page.getByRole('button', { name: 'Modifier « Sortir les poubelles »' }).click();
  const edit = page.getByRole('dialog', { name: 'Modifier la tâche' });
  await edit.getByLabel('Tâche à faire').fill('Sortir les poubelles (bac jaune)');
  await edit.getByRole('button', { name: 'Matin' }).click();
  await edit.getByRole('button', { name: 'Enregistrer' }).click();
  await expect.poll(async () => (await labels(page, 'Matin')).at(-1)).toBe('Sortir les poubelles (bac jaune)');

  await service(page, 'Matin').getByRole('button', { name: 'Modifier « Remplir la vitrine »' }).click();
  await page.getByRole('dialog', { name: 'Modifier la tâche' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(service(page, 'Matin').getByText('Remplir la vitrine')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click();
  await expect(service(page, 'Matin').getByText('Remplir la vitrine')).toBeVisible();
});

test('remettre à zéro : confirmation, tout décoché, « Annuler » rend les heures', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Remettre à zéro' })).toBeDisabled();
  await tap(page, 'Remplir la vitrine');
  await tap(page, "Nettoyer l'espace client", 'Après-midi');
  await page.getByRole('button', { name: 'Remettre à zéro' }).click();
  const dlg = page.getByRole('dialog', { name: 'Remettre les tâches à zéro' });
  await expect(dlg).toContainText('2 tâches cochées sont décochées');
  await dlg.getByRole('button', { name: 'Remettre à zéro' }).click();
  await expect(page.getByText('0 / 18 faites')).toBeVisible();
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText('2 / 18 faites')).toBeVisible();
  await expect(box(page, 'Remplir la vitrine')).toBeChecked();
});

test('ranger : poignée au clavier (flèches) et au doigt (glisser)', async ({ page }) => {
  const handle = service(page, 'Matin').getByRole('button', { name: /Déplacer « Remplir la machine à café »/ });
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await labels(page, 'Matin'))[6]).toBe('Remplir la machine à café');
  await expect(handle).toBeFocused(); // on peut enchaîner les flèches
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await labels(page, 'Matin'))[5]).toBe('Remplir la machine à café');
  expect(await labels(page, 'Après-midi')).toEqual(LIST); // l'autre service ne bouge pas

  // Glisser « Vérifier stock grattage » (1re) sous « Remplir le linéaire » (3e).
  const grip = service(page, 'Matin').getByRole('button', { name: /Déplacer « Vérifier stock grattage »/ }).first();
  await grip.scrollIntoViewIfNeeded();
  const b = (await grip.boundingBox())!;
  const rowH = (await service(page, 'Matin').locator('.task').first().boundingBox())!.height;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + rowH * 2.1, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await labels(page, 'Matin')).slice(0, 3)).toEqual(['Vérifier stock cigarettes', 'Remplir le linéaire', 'Vérifier stock grattage']);
  // L'ordre est gardé après rechargement.
  await page.reload();
  await expect.poll(async () => (await labels(page, 'Matin')).slice(0, 3)).toEqual(['Vérifier stock cigarettes', 'Remplir le linéaire', 'Vérifier stock grattage']);
});

test('export .jpg de la liste du jour', async ({ page }) => {
  await tap(page, 'Remplir la vitrine');
  await page.getByRole('button', { name: 'Export .jpg' }).click();
  const panel = page.getByRole('dialog', { name: 'Export des tâches' });
  await expect(panel.getByRole('img')).toBeVisible();
  await expect(panel).toContainText(/taches-du-jour-\d{4}-\d{2}-\d{2}-\d{4}\.jpg/);
  const size = await panel.getByRole('img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size[0]).toBe(2160);
  expect(size[1]).toBeGreaterThan(1500);
});

test('le lendemain, la liste est décochée toute seule', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-10-23T18:00:00+02:00') });
  await testMode(page);
  await page.goto('./#taches');
  await seed(page, { settings: { shopName: 'T', lastBackupAt: Date.now() } });
  await tap(page, 'Remplir la vitrine');
  await expect(page.getByText('1 / 18 faites')).toBeVisible();
  await page.clock.fastForward('08:00:00'); // vendredi 18:00 → samedi 02:00
  await expect(page.getByText('0 / 18 faites')).toBeVisible();
  await expect(page.getByText(/^Samedi 24 octobre$/)).toBeVisible();
  await expect(box(page, 'Remplir la vitrine')).not.toBeChecked();
  await ctx.close();
});

test('titres : renommer, ajouter (vide, en bas), y ajouter une tâche, monter, supprimer avec ses tâches puis annuler', async ({ page }) => {
  const titles = () => page.locator('.tasks-service h3 > span:first-child').allTextContents();
  // Renommer « Matin » ; texte vide refusé.
  await page.getByRole('button', { name: 'Modifier le titre « Matin »' }).click();
  let sheet = page.getByRole('dialog', { name: 'Modifier le titre' });
  await expect(sheet.getByRole('button', { name: '↑ Monter' })).toBeDisabled();
  await sheet.getByLabel('Titre').fill('  ');
  await expect(sheet.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await sheet.getByLabel('Titre').fill('Ouverture');
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect.poll(titles).toEqual(['Ouverture', 'Après-midi']);

  // Ajouter « Fermeture » : en bas, vide.
  await page.getByRole('button', { name: '+ Titre' }).click();
  sheet = page.getByRole('dialog', { name: 'Nouveau titre' });
  await sheet.getByLabel('Titre').fill('Fermeture');
  await sheet.getByRole('button', { name: 'Ajouter' }).click();
  await expect.poll(titles).toEqual(['Ouverture', 'Après-midi', 'Fermeture']);
  await expect(service(page, 'Fermeture')).toContainText('Aucune tâche');

  // Une tâche dans « Fermeture ».
  await page.getByRole('button', { name: '+ Tâche' }).click();
  const add = page.getByRole('dialog', { name: 'Nouvelle tâche' });
  await add.getByLabel('Tâche à faire').fill('Baisser le rideau');
  await add.getByRole('button', { name: 'Fermeture' }).click();
  await add.getByRole('button', { name: 'Ajouter' }).click();
  await expect(service(page, 'Fermeture').getByText('Baisser le rideau')).toBeVisible();
  await expect(page.getByText('0 / 19 faites')).toBeVisible();

  // Monter « Fermeture » au-dessus d'« Après-midi » ; « Descendre » désactivé une fois en bas… puis plus.
  await page.getByRole('button', { name: 'Modifier le titre « Fermeture »' }).click();
  sheet = page.getByRole('dialog', { name: 'Modifier le titre' });
  await expect(sheet.getByRole('button', { name: '↓ Descendre' })).toBeDisabled();
  await sheet.getByRole('button', { name: '↑ Monter' }).click();
  await expect.poll(titles).toEqual(['Ouverture', 'Fermeture', 'Après-midi']);
  await expect(sheet.getByRole('button', { name: '↓ Descendre' })).toBeEnabled();
  await sheet.getByRole('button', { name: 'Annuler' }).click();

  // Supprimer « Après-midi » et ses 9 tâches, puis annuler.
  await page.getByRole('button', { name: 'Modifier le titre « Après-midi »' }).click();
  await page.getByRole('dialog', { name: 'Modifier le titre' }).getByRole('button', { name: 'Supprimer le titre et ses 9 tâches' }).click();
  const confirm = page.getByRole('dialog', { name: 'Supprimer le titre' });
  await expect(confirm.getByRole('heading')).toHaveText('Supprimer « Après-midi » et ses 9 tâches ?');
  await confirm.getByRole('button', { name: 'Supprimer' }).click();
  await expect.poll(titles).toEqual(['Ouverture', 'Fermeture']);
  await expect(page.getByText('0 / 10 faites')).toBeVisible();
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click();
  await expect.poll(titles).toEqual(['Ouverture', 'Fermeture', 'Après-midi']);
  await expect(page.getByText('0 / 19 faites')).toBeVisible();
});

test('tous les titres supprimés : message, « + Tâche » désactivé', async ({ page }) => {
  for (const name of ['Matin', 'Après-midi']) {
    await page.getByRole('button', { name: `Modifier le titre « ${name} »` }).click();
    await page.getByRole('dialog', { name: 'Modifier le titre' }).getByRole('button', { name: /^Supprimer le titre/ }).click();
    await page.getByRole('dialog', { name: 'Supprimer le titre' }).getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('region', { name: new RegExp(`^${name}`) })).toHaveCount(0);
  }
  await expect(page.getByText('Aucun titre. Touchez « + Titre » pour commencer.')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Tâche' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export .jpg' })).toBeDisabled();
});
