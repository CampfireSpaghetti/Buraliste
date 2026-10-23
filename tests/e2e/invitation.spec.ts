import { test, expect, type Browser, type Page } from '@playwright/test';

// « Inviter un employé » : QR code tout de suite pour le tabac choisi, et invitation envoyée par message (lien).
// Faux relais local (scripts/mock-relay.ts, lancé par playwright.config.ts).

const ORIGIN = 'http://localhost:4173';
const CONTEXT = {
  baseURL: ORIGIN + '/Buraliste/',
  viewport: { width: 390, height: 844 },
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
};

/** Un téléphone. `sync: false` : sans listes publiques ni moteur de synchronisation (plus rapide). */
async function phone(browser: Browser, { sync = true, userAgent }: { sync?: boolean; userAgent?: string } = {}) {
  const ctx = await browser.newContext({ ...CONTEXT, ...(userAgent ? { userAgent } : {}) });
  await ctx.addInitScript((noSync) => {
    localStorage.setItem('carotte:test', '1');
    if (noSync) localStorage.setItem('carotte:nosync', '1');
  }, !sync);
  const page = await ctx.newPage();
  return { ctx, page };
}

type Entry = { id: string; name: string; key: string };
const registry = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('carotte:tabacs')!).tabacs as Entry[]);
const tabacKey = async (page: Page, name: string) => (await registry(page)).find((t) => t.name === name)?.key;

/** Charge du QR code (data-invite, mode test) décodée : nom et clé. */
function decodeInvite(payload: string | null): { name: string; key: string } | undefined {
  if (!payload?.startsWith('LACAROTTE2:')) return undefined;
  return JSON.parse(Buffer.from(payload.slice('LACAROTTE2:'.length), 'base64url').toString('utf8'));
}
const shownInvite = async (page: Page) => decodeInvite(await page.locator('[data-invite]').getAttribute('data-invite'));

const shopName = (page: Page) => page.locator('.app-header small');
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Onglets' });
const invitePanel = (page: Page) => page.getByRole('dialog', { name: 'Inviter un employé' });

async function openTabacs(page: Page) {
  await page.locator('.app-header').getByRole('button', { name: /Mes tabacs/ }).click();
  return page.getByRole('dialog', { name: 'Mes tabacs' });
}

async function createTabac(page: Page, name: string) {
  const sheet = await openTabacs(page);
  await sheet.getByRole('button', { name: 'Créer un tabac' }).click();
  await sheet.getByLabel('Nom du nouveau tabac').fill(name);
  await sheet.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(shopName(page)).toHaveText(name);
}

async function openInvite(page: Page) {
  await tabs(page).getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  return invitePanel(page);
}

async function engineReady(page: Page) {
  await page.waitForFunction(() => typeof (window as any).__carotteSync === 'function', null, { timeout: 30_000 });
}

test('deux tabacs : QR code tout de suite pour le tabac ouvert, puis pour celui qu’on choisit (son nom, sa clé)', async ({ browser }) => {
  const A = await phone(browser, { sync: false });
  await A.page.goto('./#reglages');
  await A.page.getByLabel('Nom du tabac').fill('Tabac du Port');
  await A.page.getByLabel('Nom du tabac').blur();
  await expect(shopName(A.page)).toHaveText('Tabac du Port');
  await createTabac(A.page, 'Tabac de la Gare');

  const panel = await openInvite(A.page);
  // Aucune étape avant le QR code.
  await expect(panel.getByRole('img', { name: 'QR code d’invitation au tabac' })).toBeVisible();
  await expect(panel.getByText('Toute personne qui scanne ce QR code accède aux données du tabac.')).toBeVisible();
  await expect(panel.getByRole('radio', { name: /Tabac de la Gare/ })).toBeChecked();
  await expect(panel.getByRole('radio')).toHaveCount(2);
  const gare = await tabacKey(A.page, 'Tabac de la Gare');
  expect(await shownInvite(A.page)).toEqual({ name: 'Tabac de la Gare', key: gare });

  // L'autre tabac du téléphone : son propre nom et sa propre clé.
  await panel.getByRole('radio', { name: /Tabac du Port/ }).check();
  const port = await tabacKey(A.page, 'Tabac du Port');
  expect(port).not.toBe(gare);
  await expect.poll(() => shownInvite(A.page)).toEqual({ name: 'Tabac du Port', key: port });
  await expect(panel.getByText(/« Tabac du Port », sans compte/)).toBeVisible();

  // Et retour au premier.
  await panel.getByRole('radio', { name: /Tabac de la Gare/ }).check();
  await expect.poll(() => shownInvite(A.page)).toEqual({ name: 'Tabac de la Gare', key: gare });
  await A.ctx.close();
});

test('tabac encore nommé « Mon tabac » : QR code tout de suite et proposition de renommer, qui refait le QR code', async ({ browser }) => {
  const A = await phone(browser, { sync: false });
  await A.page.goto('./#grattage');
  await expect(shopName(A.page)).toHaveText('Mon tabac');
  const panel = await openInvite(A.page);
  await expect(panel.getByRole('img', { name: 'QR code d’invitation au tabac' })).toBeVisible();
  await expect(panel.getByText('Ce tabac s’appelle encore « Mon tabac » : vos employés auront du mal à le reconnaître.')).toBeVisible();
  await expect(panel.getByRole('radio')).toHaveCount(0);
  const key = await tabacKey(A.page, 'Mon tabac');
  expect(await shownInvite(A.page)).toEqual({ name: 'Mon tabac', key });

  await panel.getByLabel('Nouveau nom du tabac').fill('Tabac du Marché');
  await panel.getByRole('button', { name: 'Renommer' }).click();
  await expect.poll(() => shownInvite(A.page)).toEqual({ name: 'Tabac du Marché', key });
  await expect(panel.getByText(/s’appelle encore/)).toHaveCount(0);
  await expect(shopName(A.page)).toHaveText('Tabac du Marché');
  await A.ctx.close();
});

test('invitation par message : le lien ouvert sur un autre téléphone rejoint le tabac, la clé quitte l’adresse, tout se partage', async ({ browser }) => {
  test.setTimeout(150_000);
  const A = await phone(browser);
  // Partage du téléphone simulé : on garde ce que l'app lui donne.
  await A.ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => { (window as any).__shared = data; },
    });
  });
  await A.page.goto('./#grattage');
  await createTabac(A.page, 'Tabac de la Gare');
  await engineReady(A.page);

  // A saisit une ligne avant d'inviter.
  await A.page.getByRole('button', { name: '+ Ligne' }).click();
  await A.page.getByLabel('Nom du jeu').fill('Cash');
  await A.page.getByLabel('Quantité linéaire', { exact: true }).fill('38');
  await A.page.getByLabel('Quantité stock', { exact: true }).fill('120');
  await A.page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(A.page.getByRole('button', { name: 'Linéaire Cash : 38' })).toBeVisible();

  const panel = await openInvite(A.page);
  await expect(panel.getByText('Ce lien donne accès au tabac : envoyez-le seulement à vos employés, et supprimez le message ensuite si possible.')).toBeVisible();
  await panel.getByRole('button', { name: 'Envoyer l’invitation par message' }).click();
  await expect.poll(() => A.page.evaluate(() => (window as any).__shared ?? null)).not.toBeNull();
  const shared = await A.page.evaluate(() => (window as any).__shared as ShareData);
  expect(shared.title).toBe('La Carotte');
  expect(shared.text).toBe('Rejoins le tabac « Tabac de la Gare » sur La Carotte : ouvre ce lien sur ton téléphone.');
  const payload = await A.page.locator('[data-invite]').getAttribute('data-invite');
  expect(shared.url).toBe(`${ORIGIN}/Buraliste/#rejoindre=${payload!.slice('LACAROTTE2:'.length)}`);
  await panel.getByRole('button', { name: 'Fermer' }).click();

  // B ouvre le lien : la clé quitte l'adresse tout de suite, avant même la réponse.
  const B = await phone(browser);
  await B.page.goto(shared.url!);
  const ask = B.page.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' });
  await expect(ask).toBeVisible();
  expect(B.page.url()).not.toContain('rejoindre');
  expect(B.page.url()).toBe(`${ORIGIN}/Buraliste/`);
  await ask.getByRole('button', { name: 'Rejoindre' }).click();
  await expect(shopName(B.page)).toHaveText('Tabac de la Gare');
  expect(B.page.url()).not.toContain('rejoindre');
  expect(await tabacKey(B.page, 'Tabac de la Gare')).toBe(await tabacKey(A.page, 'Tabac de la Gare'));
  // Pas un iPhone : pas d'astuce « écran d'accueil ».
  await expect(B.page.getByRole('dialog', { name: 'Sur l’écran d’accueil' })).toHaveCount(0);

  // Les données arrivent comme après un QR code.
  await engineReady(B.page);
  await tabs(B.page).getByRole('button', { name: 'Grattage' }).click();
  await expect(async () => {
    await A.page.evaluate(() => (window as any).__carotteSync());
    await B.page.evaluate(() => (window as any).__carotteSync());
    await expect(B.page.getByRole('button', { name: 'Linéaire Cash : 38' })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(B.page.getByRole('button', { name: 'Stock Cash : 120' })).toBeVisible();

  await A.ctx.close();
  await B.ctx.close();
});

test('sans partage du téléphone : le lien est copié ; « Coller le lien d’invitation » rejoint le tabac', async ({ browser }) => {
  test.setTimeout(90_000);
  const A = await phone(browser, { sync: false });
  await A.ctx.addInitScript(() => { delete (Navigator.prototype as any).share; delete (navigator as any).share; });
  await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await A.page.goto('./#grattage');
  await createTabac(A.page, 'Tabac de la Gare');
  const panel = await openInvite(A.page);
  await expect(panel.getByRole('img', { name: 'QR code d’invitation au tabac' })).toBeVisible();
  await panel.getByRole('button', { name: 'Envoyer l’invitation par message' }).click();
  await expect(A.page.getByRole('status').filter({ hasText: 'Lien copié : collez-le dans un message à votre employé.' })).toBeVisible();
  const link = await A.page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^http:\/\/localhost:4173\/Buraliste\/#rejoindre=[A-Za-z0-9_-]+$/);

  // B (par exemple l'app de l'écran d'accueil d'un iPhone) colle le message reçu.
  const B = await phone(browser, { sync: false });
  await B.page.goto('./#grattage');
  const sheet = await openTabacs(B.page);
  await sheet.getByRole('button', { name: 'Rejoindre un tabac' }).click();
  await sheet.getByLabel('Coller le lien d’invitation').fill('n’importe quoi');
  await sheet.getByRole('button', { name: 'Rejoindre avec ce lien' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Lien d’invitation invalide ou incomplet.');
  await sheet.getByLabel('Coller le lien d’invitation').fill(`Rejoins le tabac « Tabac de la Gare » sur La Carotte : ouvre ce lien sur ton téléphone. ${link}`);
  await sheet.getByRole('button', { name: 'Rejoindre avec ce lien' }).click();
  const ask = B.page.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Rejoindre' }).click();
  await expect(shopName(B.page)).toHaveText('Tabac de la Gare');
  expect(await tabacKey(B.page, 'Tabac de la Gare')).toBe(await tabacKey(A.page, 'Tabac de la Gare'));
  await A.ctx.close();
  await B.ctx.close();
});

test('lien abîmé : message clair, l’adresse est nettoyée, aucun tabac ajouté', async ({ browser }) => {
  const B = await phone(browser, { sync: false });
  await B.page.goto('./#rejoindre=abc');
  await expect(B.page.getByRole('status').filter({ hasText: 'Lien d’invitation invalide ou incomplet.' })).toBeVisible();
  expect(B.page.url()).toBe(`${ORIGIN}/Buraliste/`);
  expect(await registry(B.page)).toHaveLength(1);
  await B.ctx.close();
});

test('iPhone, lien ouvert dans Safari : après avoir rejoint, astuce pour l’écran d’accueil (sans bloquer)', async ({ browser }) => {
  const A = await phone(browser, { sync: false });
  await A.page.goto('./#grattage');
  await createTabac(A.page, 'Tabac de la Gare');
  await openInvite(A.page);
  const payload = await A.page.locator('[data-invite]').getAttribute('data-invite');
  const B = await phone(browser, {
    sync: false,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await B.page.goto(`./#rejoindre=${payload!.slice('LACAROTTE2:'.length)}`);
  await B.page.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' }).getByRole('button', { name: 'Rejoindre' }).click();
  await expect(shopName(B.page)).toHaveText('Tabac de la Gare');
  const hint = B.page.getByRole('dialog', { name: 'Sur l’écran d’accueil' });
  await expect(hint).toContainText('Pour l’avoir sur l’écran d’accueil : ouvrez ce lien dans Safari, puis Menu de la page (•••) → Partager → « Sur l’écran d’accueil ». Ensuite, ouvrez l’app, touchez le nom du tabac en haut → Rejoindre un tabac → Coller le lien d’invitation.');
  await expect(hint).not.toContainText('Mes tabacs');
  await hint.getByRole('button', { name: 'Compris' }).click();
  await expect(hint).toHaveCount(0);
  // Une seule fois.
  await B.page.reload();
  await expect(shopName(B.page)).toHaveText('Tabac de la Gare');
  await expect(hint).toHaveCount(0);
  await A.ctx.close();
  await B.ctx.close();
});
