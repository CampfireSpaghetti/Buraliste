import { test, expect, type Page } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

// Le partage par clé GitHub et son QR code de jumelage ont été supprimés (le relais détient la clé) :
// l'invitation de tabac les remplace (voir tabacs.spec.ts). Ici : ce qui reste côté téléphone.

function legacyPairingPayload() {
  const json = JSON.stringify({ token: 'github_pat_TEST', repo: 'exemple/Buraliste', shop: 'Tabac du Centre' });
  return 'LACAROTTE1:' + Buffer.from(json).toString('base64url');
}

/** La clé GitHub enregistrée dans les réglages du tabac principal (null si absente). */
function storedToken(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('la-carotte');
        open.onerror = () => resolve('erreur');
        open.onsuccess = () => {
          const get = open.result.transaction('settings').objectStore('settings').get('main');
          get.onsuccess = () => resolve((get.result as { shareToken?: string } | undefined)?.shareToken ?? null);
          get.onerror = () => resolve('erreur');
        };
      }),
  );
}

test('scanner un ancien QR code de jumelage : message clair, aucun produit ouvert, aucune clé enregistrée', async ({ page }) => {
  await testMode(page);
  await page.goto('./#scanner');
  await seed(page, { settings: { shopName: 'Tabac du Centre' } });
  await scan(page, legacyPairingPayload());
  await expect(page.getByRole('status').filter({ hasText: 'Ancien QR code : demandez une invitation de tabac' })).toBeVisible();
  await expect(page.getByText(/Jumeler/)).toHaveCount(0);
  expect(await storedToken(page)).toBeNull();
});

// Les e2e sont construits avec le faux relais (playwright.config.ts) : le cas « sans relais, bientôt disponible » est
// couvert par tests/unit/tabacsScreens.test.tsx.
test('Réglages : plus de clé GitHub à saisir, les codes-barres partent tout seuls par le relais', async ({ page }) => {
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, {});
  await page.getByText('Données et sources').click();
  await expect(page.getByText('Les codes-barres scannés enrichissent automatiquement la liste commune.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Activer le partage|Jumeler/ })).toHaveCount(0);
  await expect(page.getByText(/GitHub/)).toHaveCount(0);
});

test('une clé GitHub laissée par une ancienne version est effacée au démarrage', async ({ page }) => {
  await testMode(page);
  await page.goto('./#reglages');
  await seed(page, { settings: { shopName: 'Tabac du Centre', shareToken: 'github_pat_VIEUX' } });
  await page.reload();
  await page.waitForFunction(() => typeof (window as any).__carotteSeed === 'function');
  await expect.poll(() => storedToken(page)).toBeNull();
});
