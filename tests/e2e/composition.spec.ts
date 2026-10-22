import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { scan, seed, testMode } from './helpers';

// Composition lue dans le fichier publié public/data/composition.json (robot hebdomadaire, ANSES) : on vérifie la
// présentation et le chargement à l'ouverture de la fiche, pas les chiffres, qui suivent les déclarations des fabricants.
type Entry = { nicotine?: number; ingredients: unknown[]; ean: string[] };
const comp = JSON.parse(readFileSync('public/data/composition.json', 'utf8')) as { produits: Record<string, Entry> };
const refs = JSON.parse(readFileSync('public/data/references.json', 'utf8')).items as { ref: string; kind: string; name: string }[];
const sample = refs.find((r) => r.kind === 'cigarette' && comp.produits[r.ref]?.nicotine !== undefined && comp.produits[r.ref].ingredients.length > 0)!;
const unmatched = refs.find((r) => r.kind === 'cigarette' && !comp.produits[r.ref])!;

const douane = (ref: string, name: string, code: string) => ({
  id: 'd:' + ref, source: 'douane', douaneRef: ref, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'cigarette', name, price: 12, status: 'inchange', barcodes: [code] }, user: {},
});

test.beforeEach(async ({ page }) => {
  await testMode(page);
});

test('fiche d’un tabac rapproché : composition ANSES (émissions par cigarette, ingrédients repliés, source) ; non rapproché : rien', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/data/composition.json')) loaded.push(r.url()); });
  await page.goto('./#scanner');
  await seed(page, { products: [douane(sample.ref, sample.name, '3017620422003'), douane(unmatched.ref, unmatched.name, '3017620422010')] });
  await page.waitForTimeout(300);
  expect(loaded).toHaveLength(0); // jamais au démarrage

  await scan(page, '3017620422003');
  const fiche = page.getByRole('dialog', { name: sample.name });
  const section = fiche.getByRole('region', { name: 'Composition' });
  await expect(section).toContainText('Composition (déclaration ANSES)');
  await expect(section).toContainText(/Nicotine \d+(,\d+)?\smg · Goudron \d+(,\d+)?\smg · Monoxyde de carbone \d+(,\d+)?\smg \(par cigarette\)/);
  await expect(section).toContainText("Déclaration du fabricant à l'ANSES, juillet 2026");
  const summary = section.getByText(/^Ingrédients déclarés \(\d+\)$/);
  await expect(summary).toBeVisible();
  const first = section.getByRole('listitem').first();
  await expect(first).toBeHidden();
  await summary.click();
  await expect(first).toBeVisible();
  expect(loaded.length).toBeGreaterThan(0);
  await fiche.getByRole('button', { name: 'Fermer' }).click();

  await page.waitForTimeout(1600);
  await scan(page, '3017620422010');
  const autre = page.getByRole('dialog', { name: unmatched.name });
  await expect(autre.getByRole('region', { name: 'Codes-barres' })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(autre.getByRole('region', { name: 'Composition' })).toHaveCount(0);
});
