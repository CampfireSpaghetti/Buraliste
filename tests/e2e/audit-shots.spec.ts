import { test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { scan, seed, testMode } from './helpers';

// Captures pour l'audit UX/UI n° 2 : AUDIT=1 npx playwright test audit-shots
test.skip(!process.env.AUDIT, 'captures d’audit à la demande');

const refs = JSON.parse(readFileSync('public/data/references.json', 'utf8'));
const depart = JSON.parse(readFileSync('src/data/seed/depart.json', 'utf8')).items as { ref: string }[];
const fdj = JSON.parse(readFileSync('public/data/fdj-games.json', 'utf8')).items.map((g: any) => ({ name: g.name, ticketPrice: g.ticketPrice, maxPrize: g.maxPrize }));
const pick = new Set(depart.map((d) => d.ref));
const enriched = new Map(JSON.parse(readFileSync('src/data/seed/depart.json', 'utf8')).items.map((d: any) => [d.ref, d]));
const products = [
  ...refs.items.filter((i: any) => pick.has(i.ref)).map((i: any, n: number) => {
    const d: any = enriched.get(i.ref) ?? {};
    return { id: 'r' + n, source: 'douane', douaneRef: i.ref, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
      base: { kind: i.kind, name: i.name, brand: i.brand, format: i.format, price: i.price, previousPrice: i.previousPrice, status: i.status, effectiveDate: refs.effectiveDate, origin: d.origin, strength: d.strength, tasteTags: d.tasteTags }, user: {} };
  }),
  ...fdj.map((g: any, n: number) => ({ id: 'g' + n, source: 'depart', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, base: { kind: 'jeu-fdj', ...g, ...(g.name === 'CASH' ? { fdjPrefix: '0417' } : {}) }, user: {} })),
];
const now = Date.now();
const countLines = fdj.slice(0, 30).map((g: any, n: number) => ({ id: 'l' + n, gameId: 'g' + n, code: '0417' + String(1000000000 + n * 7919).slice(0, 10), name: g.name, linearQty: (n * 13) % 70, stockQty: ((n * 37) % 9) * 30, updatedAt: now - n * 97_000 }));

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `docs/audits/captures/${name}.png` });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`captures ${scheme}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
    const page = await ctx.newPage();
    await testMode(page);
    await page.goto('./#grattage');
    await seed(page, { products, countLines, settings: { shopName: 'Tabac du Centre', lastBackupAt: now - 9 * 86_400_000, referencesEffectiveDate: refs.effectiveDate, referencesVersion: refs.version } });
    const s = (n: string) => shot(page, `${scheme}-${n}`);
    await s('01-grattage');
    await page.getByRole('button', { name: /^Linéaire CASH/ }).click();
    await s('02-pave');
    await page.getByRole('button', { name: 'Annuler' }).click();
    await page.getByRole('button', { name: 'CASH', exact: true }).click();
    await s('03-ligne');
    await page.keyboard.press('Escape');
    await page.locator('.sheet-scrim').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: 'Scanner', exact: true }).first().click();
    await scan(page, '04170012345678');
    await s('04-scan-continu-pave');
    await page.getByRole('button', { name: 'Annuler' }).click();
    await page.waitForTimeout(1600);
    await scan(page, '09990000000001');
    await s('05-quel-jeu');
    await page.locator('.sheet-scrim').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: 'Terminer' }).click();
    await page.getByRole('button', { name: 'Export .jpg' }).click();
    await page.getByRole('img').first().waitFor();
    await s('06-export');
    await page.getByRole('button', { name: 'Fermer' }).click();
    const tabs = page.getByRole('navigation', { name: 'Onglets' });
    await tabs.getByRole('button', { name: 'Scanner' }).click();
    await s('07-scanner');
    await scan(page, '3017620422003');
    await page.getByPlaceholder('Rechercher une référence').fill('marlboro gold');
    await s('08-code-inconnu');
    await page.getByRole('button', { name: 'Fermer' }).click();
    await tabs.getByRole('button', { name: 'Catalogue' }).click();
    await s('09-catalogue-vide');
    await page.getByPlaceholder('Nom, marque ou code').fill('camel');
    await s('10-recherche');
    await page.getByRole('button', { name: /Camel Filters \(paquet rigide\)/ }).click();
    await page.getByRole('button', { name: 'En stock' }).click();
    await s('11-fiche-rupture');
    await page.getByRole('button', { name: '● En rupture' }).click();
    await page.getByRole('button', { name: 'Ajouter à la comparaison' }).click();
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByPlaceholder('Nom, marque ou code').fill('winston classic');
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /Comparer \(2\)/ }).click();
    await s('12-comparer');
    await page.getByRole('button', { name: 'Fermer' }).click();
    await tabs.getByRole('button', { name: 'Réglages' }).click();
    await s('13-reglages');
    await ctx.close();
  });
}
