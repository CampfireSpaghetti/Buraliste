import { test, expect } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

test.beforeEach(async ({ page }) => {
  await testMode(page);
  await page.goto('./#scanner');
  await seed(page, { products: [
    { id: 'ref1', source: 'douane', douaneRef: 'pmi|marlboro gold collection, en 20 unités', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
      base: { kind: 'cigarette', name: 'Marlboro Gold Collection, en 20 unités', price: 13, brand: 'Marlboro', format: '20 unités' }, user: {} },
  ] });
});

test('caméra refusée : explication et saisie manuelle', async ({ browser }) => {
  const page = await browser.newPage();
  await testMode(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refus', 'NotAllowedError'));
  });
  await page.goto('./#scanner');
  await expect(page.getByText("Autorisez l'appareil photo")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Saisir le code/ })).toBeVisible();
  await page.close();
});

test('pas de caméra : saisie manuelle du code', async ({ page }) => {
  await expect(page.getByText('Appareil photo indisponible')).toBeVisible();
  await page.getByRole('button', { name: /Saisir le code/ }).click();
  await page.getByLabel('Code-barres').fill('3017620422003');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: 'Code inconnu' })).toBeVisible();
});

test('code inconnu : rattacher à une référence officielle, puis le scan ouvre la fiche', async ({ page }) => {
  await scan(page, '3017620422003');
  await expect(page.getByRole('heading', { name: 'Code inconnu' })).toBeVisible();
  await expect(page.getByText('3017620422003')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer une fiche à la main' })).toBeVisible();
  await page.getByPlaceholder('Rechercher une référence').fill('marlboro gold');
  await page.getByRole('button', { name: /Marlboro Gold Collection, en 20 unités/ }).click();
  await expect(page.getByRole('heading', { name: 'Marlboro Gold Collection, en 20 unités' })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.waitForTimeout(1600); // anti-doublon : un même code n'est relu qu'après 1,5 s
  await scan(page, '3017620422003');
  await expect(page.getByRole('heading', { name: 'Marlboro Gold Collection, en 20 unités' })).toBeVisible();
});

test('code inconnu : créer une fiche à la main, puis le scan ouvre la fiche', async ({ page }) => {
  await scan(page, '4006381333931');
  await page.getByRole('button', { name: 'Créer une fiche à la main' }).click();
  await expect(page.getByLabel('Code-barres')).toHaveValue('4006381333931');
  await page.getByLabel('Nom').fill('Cigare maison');
  await page.getByLabel('Famille').selectOption('cigare');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Cigare maison' })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.waitForTimeout(1600);
  await scan(page, '4006381333931');
  await expect(page.getByRole('heading', { name: 'Cigare maison' })).toBeVisible();
});

test('code inconnu : rattacher à un jeu de grattage existant, puis le scan ouvre le jeu', async ({ page }) => {
  await seed(page, { products: [
    { id: 'cash', source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', name: 'Cash', ticketPrice: 5 }, user: {} },
    { id: 'astro', source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', name: 'Astro', ticketPrice: 2 }, user: {} },
  ] });
  await scan(page, '3760000000024');
  await expect(page.getByRole('heading', { name: 'Code inconnu' })).toBeVisible();
  await page.getByRole('button', { name: 'Jeu de grattage' }).click();
  // Les jeux sont listés sans recherche ; la recherche les filtre.
  await expect(page.getByRole('button', { name: /Astro/ })).toBeVisible();
  await page.getByPlaceholder('Rechercher un jeu').fill('cas');
  await expect(page.getByRole('button', { name: /Astro/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Nouveau jeu' })).toBeVisible();
  await page.getByRole('button', { name: /Cash/ }).click();
  await expect(page.getByRole('heading', { name: 'Cash' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Cash' }).getByRole('status')).toContainText('Code ajouté à Cash');
  await expect(page.getByRole('region', { name: 'Codes-barres' })).toContainText('3760000000024');
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.waitForTimeout(1600);
  await scan(page, '3760000000024');
  await expect(page.getByRole('heading', { name: 'Cash' })).toBeVisible();
  // Le choix « Jeu de grattage » est retenu pour le prochain code inconnu.
  await page.getByRole('button', { name: 'Fermer' }).click();
  await scan(page, '4006381333931');
  await expect(page.getByRole('button', { name: 'Jeu de grattage' })).toHaveAttribute('aria-pressed', 'true');
});
