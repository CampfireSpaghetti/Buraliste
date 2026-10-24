import { test, expect, type Browser, type Page } from '@playwright/test';

// Deux téléphones (deux contextes de navigateur, A le gérant et B l'employé) et le faux relais local
// (scripts/mock-relay.ts, lancé par playwright.config.ts). Démarrage complet de l'app (listes publiques comprises) :
// le moteur de synchronisation démarre une fois les listes en place.

const CONTEXT = {
  baseURL: 'http://localhost:4173/Buraliste/',
  viewport: { width: 390, height: 844 },
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
};

async function phone(browser: Browser) {
  const ctx = await browser.newContext(CONTEXT);
  await ctx.addInitScript(() => localStorage.setItem('carotte:test', '1'));
  const page = await ctx.newPage();
  return { ctx, page };
}

const header = (page: Page) => page.locator('.app-header');
const shopName = (page: Page) => page.locator('.app-header small');
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Onglets' });
const keypad = (page: Page) => page.getByRole('dialog', { name: /Quantité/ });

/** Attend que le moteur de synchronisation tourne (points d'entrée de test installés à son démarrage). */
async function engineReady(page: Page) {
  await page.waitForFunction(() => typeof (window as any).__carotteSync === 'function', null, { timeout: 30_000 });
}

const syncNow = (page: Page) => page.evaluate(() => (window as any).__carotteSync());

/** Synchronise les téléphones (écrivain d'abord) jusqu'à ce que `check` passe, 15 s au plus. */
async function eventually(pages: Page[], check: () => Promise<void>) {
  await expect(async () => {
    for (const p of pages) await syncNow(p);
    await check();
  }).toPass({ timeout: 15_000 });
}

async function scan(page: Page, code: string) {
  await page.waitForFunction(() => typeof (window as any).__carotteScan === 'function');
  await page.evaluate((c) => (window as any).__carotteScan(c), code);
}

async function typeQty(page: Page, digits: string) {
  for (const d of digits) await keypad(page).getByRole('button', { name: d, exact: true }).click();
  await keypad(page).getByRole('button', { name: 'Valider' }).click();
}

async function openTabacs(page: Page) {
  await header(page).getByRole('button', { name: /Mes tabacs/ }).click();
  return page.getByRole('dialog', { name: 'Mes tabacs' });
}

test('deux téléphones : créer, inviter par QR code, rejoindre, tout se partage, hors ligne, sélecteur', async ({ browser }) => {
  test.setTimeout(180_000);
  const A = await phone(browser);
  const B = await phone(browser);

  // --- A crée « Tabac de la Gare » (clé générée automatiquement)
  await A.page.goto('./#grattage');
  let sheet = await openTabacs(A.page);
  await sheet.getByRole('button', { name: 'Créer un tabac' }).click();
  await sheet.getByLabel('Nom du nouveau tabac').fill('Tabac de la Gare');
  await sheet.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(shopName(A.page)).toHaveText('Tabac de la Gare');
  await engineReady(A.page);

  // --- A affiche « Inviter un employé » ; la charge du QR code est lue par data-invite (mode test)
  await tabs(A.page).getByRole('button', { name: 'Réglages' }).click();
  await A.page.getByRole('button', { name: 'Inviter un employé' }).click();
  await expect(A.page.getByText('Toute personne qui scanne ce QR code accède aux données du tabac.')).toBeVisible();
  // Deux tabacs sur A (« Mon tabac » et celui-ci) : le QR code est d'office celui du tabac ouvert.
  await expect(A.page.getByRole('radio', { name: /Tabac de la Gare/ })).toBeChecked();
  const invite = await A.page.locator('[data-invite]').getAttribute('data-invite');
  expect(invite).toMatch(/^LACAROTTE2:/);
  await A.page.getByRole('button', { name: 'Fermer' }).click();

  // --- B scanne l'invitation et rejoint
  await B.page.goto('./#scanner');
  await scan(B.page, invite!);
  const ask = B.page.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Rejoindre' }).click();
  await expect(shopName(B.page)).toHaveText('Tabac de la Gare');
  await engineReady(B.page);
  await expect(B.page.getByRole('button', { name: /^Synchronisation : / })).toBeVisible();

  // --- A saisit Cash : linéaire 38, stock 120 → B le voit
  await tabs(A.page).getByRole('button', { name: 'Grattage' }).click();
  await A.page.getByRole('button', { name: '+ Ligne' }).click();
  await A.page.getByLabel('Nom du jeu').fill('Cash');
  await A.page.getByLabel('Quantité linéaire', { exact: true }).fill('38');
  await A.page.getByLabel('Quantité stock', { exact: true }).fill('120');
  await A.page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(A.page.getByRole('button', { name: 'Linéaire Cash : 38' })).toBeVisible();
  await tabs(B.page).getByRole('button', { name: 'Grattage' }).click();
  await eventually([A.page, B.page], () => expect(B.page.getByRole('button', { name: 'Linéaire Cash : 38' })).toBeVisible({ timeout: 1_000 }));
  await expect(B.page.getByRole('button', { name: 'Stock Cash : 120' })).toBeVisible();
  await expect(A.page.getByRole('button', { name: 'Synchronisation : à jour' })).toBeVisible();

  // --- B met un produit « En rupture » → A le voit
  await tabs(B.page).getByRole('button', { name: 'Catalogue' }).click();
  await B.page.getByPlaceholder('Nom, marque ou code').fill('marlboro gold collection');
  await B.page.getByRole('button', { name: /Marlboro Gold Collection, en 20 unités/ }).first().click();
  await B.page.getByRole('button', { name: 'En stock' }).click();
  await expect(B.page.getByRole('button', { name: /En rupture/ }).first()).toBeVisible();
  await B.page.getByRole('button', { name: 'Fermer' }).click();
  await tabs(A.page).getByRole('button', { name: 'Catalogue' }).click();
  await eventually([B.page, A.page], () => expect(A.page.getByRole('button', { name: /En rupture · 1/ })).toBeVisible({ timeout: 1_000 }));

  // --- A renomme le tabac → B voit le nouveau nom
  await tabs(A.page).getByRole('button', { name: 'Réglages' }).click();
  await A.page.getByLabel('Nom du tabac').fill('Tabac de la Gare SNCF');
  await A.page.getByLabel('Nom du tabac').blur();
  await expect(shopName(A.page)).toHaveText('Tabac de la Gare SNCF');
  await eventually([A.page, B.page], () => expect(shopName(B.page)).toHaveText('Tabac de la Gare SNCF', { timeout: 1_000 }));

  // --- B hors ligne modifie le stock de Cash à 90 ; de retour en ligne, A voit 90
  await tabs(A.page).getByRole('button', { name: 'Grattage' }).click();
  await tabs(B.page).getByRole('button', { name: 'Grattage' }).click();
  await B.ctx.setOffline(true);
  await expect(B.page.getByRole('button', { name: 'Synchronisation : hors ligne' })).toBeVisible();
  await B.page.getByRole('button', { name: 'Stock Cash : 120' }).click();
  await expect(B.page.getByRole('dialog', { name: /Quantité stock/ })).toBeVisible();
  await typeQty(B.page, '90');
  await expect(B.page.getByRole('button', { name: 'Stock Cash : 90' })).toBeVisible();
  await B.ctx.setOffline(false);
  await eventually([B.page, A.page], () => expect(A.page.getByRole('button', { name: 'Stock Cash : 90' })).toBeVisible({ timeout: 1_000 }));

  // --- Le sélecteur de B revient au tabac « principal », aux données séparées
  sheet = await openTabacs(B.page);
  await expect(sheet.getByRole('button', { name: /Tabac de la Gare SNCF/ })).toHaveAttribute('aria-current', 'true');
  await sheet.getByRole('button', { name: /^Mon tabac/ }).click();
  await expect(shopName(B.page)).toHaveText('Mon tabac');
  await expect(B.page.getByRole('button', { name: '+ Ligne' })).toBeVisible();
  await expect(B.page.getByRole('button', { name: 'Linéaire Cash : 38' })).toHaveCount(0);

  // --- Rejoindre une seconde fois la même invitation : on revient simplement au tabac déjà présent
  await tabs(B.page).getByRole('button', { name: 'Scanner' }).click();
  await scan(B.page, invite!);
  await B.page.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' }).getByRole('button', { name: 'Rejoindre' }).click();
  await expect(shopName(B.page)).toHaveText('Tabac de la Gare SNCF');
  sheet = await openTabacs(B.page);
  await expect(sheet.locator('[data-tabac]')).toHaveCount(2);
  await sheet.locator('.sheet-scrim').click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
  await tabs(B.page).getByRole('button', { name: 'Grattage' }).click();
  // Base rechargée après le changement de tabac : sous charge (tests en parallèle), la lecture peut dépasser 5 s.
  await expect(B.page.getByRole('button', { name: 'Stock Cash : 90' })).toBeVisible({ timeout: 15_000 });

  await A.ctx.close();
  await B.ctx.close();
});

test('accès refusé par le relais : message dans Réglages, point rouge, données gardées', async ({ browser }) => {
  test.setTimeout(90_000);
  const A = await phone(browser);
  // Le relais refuse la clé d'écriture (403) : simulé, le faux relais ne peut pas refuser un vrai membre.
  await A.ctx.route('http://localhost:8787/**', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"erreur":"ecriture"}', headers: { 'access-control-allow-origin': 'http://localhost:4173' } }),
  );
  await A.page.goto('./#grattage');
  await A.page.getByRole('button', { name: '+ Ligne' }).click();
  await A.page.getByLabel('Nom du jeu').fill('Cash');
  await A.page.getByLabel('Quantité linéaire', { exact: true }).fill('38');
  await A.page.getByLabel('Quantité stock', { exact: true }).fill('120');
  await A.page.getByRole('button', { name: 'Ajouter' }).click();
  await engineReady(A.page);
  await syncNow(A.page);
  // Le point rouge mène au détail, dans Réglages.
  await A.page.getByRole('button', { name: 'Synchronisation : accès refusé' }).click();
  await expect(A.page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
  await expect(A.page.getByText('Ce téléphone n’a plus accès à ce tabac.')).toBeVisible();
  await expect(A.page.getByLabel('Nom du tabac')).toHaveValue('Mon tabac');
  // Les données restent.
  await tabs(A.page).getByRole('button', { name: 'Grattage' }).click();
  await expect(A.page.getByRole('button', { name: 'Linéaire Cash : 38' })).toBeVisible();
  await expect(A.page.getByRole('button', { name: 'Stock Cash : 120' })).toBeVisible();
  await A.ctx.close();
});

test('deux téléphones : la liste « À faire » se partage (cases cochées en même temps, tâche ajoutée)', async ({ browser }) => {
  test.setTimeout(120_000);
  const A = await phone(browser);
  const B = await phone(browser);
  await A.page.goto('./#taches');
  const sheet = await openTabacs(A.page);
  await sheet.getByRole('button', { name: 'Créer un tabac' }).click();
  await sheet.getByLabel('Nom du nouveau tabac').fill('Tabac des Halles');
  await sheet.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(shopName(A.page)).toHaveText('Tabac des Halles');
  await engineReady(A.page);
  await tabs(A.page).getByRole('button', { name: 'Réglages' }).click();
  await A.page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = await A.page.locator('[data-invite]').getAttribute('data-invite');
  await A.page.getByRole('button', { name: 'Fermer' }).click();
  await B.page.goto('./#scanner');
  await scan(B.page, invite!);
  await B.page.getByRole('dialog', { name: 'Rejoindre « Tabac des Halles » ?' }).getByRole('button', { name: 'Rejoindre' }).click();
  await expect(shopName(B.page)).toHaveText('Tabac des Halles');
  await engineReady(B.page);

  // A et B cochent chacun une tâche différente, sans se synchroniser entre-temps : aucune ne se perd.
  await tabs(A.page).getByRole('button', { name: 'À faire' }).click();
  await tabs(B.page).getByRole('button', { name: 'À faire' }).click();
  const matin = (p: Page) => p.getByRole('region', { name: /^Matin/ });
  await matin(A.page).getByText('Remplir la vitrine').click();
  await matin(B.page).getByText('Remplir le linéaire').click();
  await A.page.getByRole('button', { name: '+ Tâche' }).click();
  const add = A.page.getByRole('dialog', { name: 'Nouvelle tâche' });
  await add.getByLabel('Tâche à faire').fill('Commander les tickets');
  await add.getByRole('button', { name: 'Après-midi' }).click();
  await add.getByRole('button', { name: 'Ajouter' }).click();
  for (const p of [A.page, B.page]) {
    await eventually([A.page, B.page], async () => {
      await expect(matin(p).getByRole('checkbox', { name: 'Remplir la vitrine' })).toBeChecked({ timeout: 1_000 });
      await expect(matin(p).getByRole('checkbox', { name: 'Remplir le linéaire' })).toBeChecked({ timeout: 1_000 });
      await expect(p.getByText('Commander les tickets')).toBeVisible({ timeout: 1_000 });
    });
  }
  await expect(B.page.getByText('2 / 19 faites')).toBeVisible();
  await A.ctx.close();
  await B.ctx.close();
});
