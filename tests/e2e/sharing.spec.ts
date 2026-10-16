import { test, expect, type Page } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

const marlboro = { id: 'm', source: 'douane', douaneRef: 'pmi|marlboro gold collection, en 20 unités', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'cigarette', name: 'Marlboro Gold Collection, en 20 unités', price: 13 }, user: {} };

function pairingPayload(token: string) {
  const json = JSON.stringify({ token, repo: 'wongmichel2048/Buraliste', shop: 'Tabac du Centre' });
  return 'LACAROTTE1:' + Buffer.from(json).toString('base64url');
}

async function fakeGitHub(page: Page, status = 200) {
  const posted: any[] = [];
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') posted.push({ auth: req.headers()['authorization'], body: JSON.parse(req.postData() ?? '{}') });
    await route.fulfill({ status: req.method() === 'POST' && status === 200 ? 201 : status, contentType: 'application/json', body: '[]' });
  });
  return posted;
}

test('activer le partage, rattacher un code : il part vers GitHub avec son produit, et rien d’autre', async ({ page }) => {
  const posted = await fakeGitHub(page);
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, { products: [marlboro], settings: { shopName: 'Tabac du Centre' } });
  await expect(page.getByText('Partage des codes : désactivé')).toBeVisible();
  await page.getByRole('button', { name: 'Activer le partage' }).click();
  await page.getByLabel('Clé GitHub').fill('github_pat_TEST');
  await page.getByRole('button', { name: 'Vérifier et activer' }).click();
  await expect(page.getByText('Partage des codes : activé')).toBeVisible();

  const tabs = page.getByRole('navigation', { name: 'Onglets' });
  await tabs.getByRole('button', { name: 'Scanner' }).click();
  await scan(page, '3017620422003');
  await page.getByPlaceholder('Rechercher une référence').fill('marlboro gold');
  await page.getByRole('button', { name: /Marlboro Gold Collection, en 20 unités/ }).click();
  await page.getByRole('button', { name: 'En stock' }).click(); // une rupture ne doit pas partir
  await page.getByRole('button', { name: 'Fermer' }).click();

  await tabs.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.getByText('1 code en attente')).toBeVisible();
  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page.getByText(/0 code en attente/)).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0].auth).toBe('Bearer github_pat_TEST');
  expect(posted[0].body.title).toBe('[codes-barres] 1 code');
  const json = JSON.parse(/```json\s*([\s\S]*?)```/.exec(posted[0].body.body)![1]);
  expect(json.items).toEqual([{ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro gold collection, en 20 unités' }]);
  expect(posted[0].body.body).not.toMatch(/Tabac du Centre|rupture|outOfStock/);
});

test('clé refusée par GitHub : message clair, partage non activé', async ({ page }) => {
  await fakeGitHub(page, 401);
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, {});
  await page.getByRole('button', { name: 'Activer le partage' }).click();
  await page.getByLabel('Clé GitHub').fill('mauvaise');
  await page.getByRole('button', { name: 'Vérifier et activer' }).click();
  await expect(page.getByRole('alert')).toContainText('Clé refusée par GitHub');
  await expect(page.getByText('Partage des codes : désactivé')).toBeVisible();
});

test('jumeler un téléphone en scannant le QR code', async ({ page }) => {
  await fakeGitHub(page);
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, { settings: { shopName: 'Tabac du Centre', shareToken: 'github_pat_TEST' } });
  await page.getByRole('button', { name: 'Jumeler un autre téléphone' }).click();
  await expect(page.getByRole('img', { name: 'QR code de jumelage' })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();

  // Second téléphone : pas de clé, il scanne le QR code
  await seed(page, {});
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Scanner' }).click();
  await scan(page, pairingPayload('github_pat_TEST'));
  await expect(page.getByText('Jumeler ce téléphone avec Tabac du Centre ?')).toBeVisible();
  await page.getByRole('button', { name: 'Jumeler' }).click();
  await page.getByRole('navigation', { name: 'Onglets' }).getByRole('button', { name: 'Réglages' }).click();
  await expect(page.getByText('Partage des codes : activé')).toBeVisible();
});
