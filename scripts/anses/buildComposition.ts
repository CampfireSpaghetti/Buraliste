// Construit public/data/composition.json à partir des fichiers ANSES lus et de la liste Douane : seulement les références
// rapprochées avec certitude (voir matchDouane.ts), avec leurs émissions, leurs ingrédients et leurs EAN valides.
import { createHash } from 'node:crypto';
import { isValidEan, retailCode } from '../../src/domain/barcode.ts';
import type { RefItem } from '../../src/domain/catalog.ts';
import { MAX_INGREDIENTS, type CompositionEntry, type CompositionFile, type Ingredient } from '../../src/domain/composition.ts';
import { groupKey, matchDetailed, type AnsesProduct } from './matchDouane.ts';
import type { AnsesIngredientRow } from './parseAnses.ts';

/** Catégories du journal : cigarettes, tabac à rouler, cigares (cigares et cigarillos). */
export type StatKey = 'cigarette' | 'tabac-rouler' | 'cigare';
export type Stats = Record<StatKey, { total: number; matched: number }>;

type Options = {
  products: AnsesProduct[];
  composition: AnsesIngredientRow[];
  refs: RefItem[];
  date: string; // date du fichier ANSES (AAAA-MM-JJ)
  source: string;
  fetchedAt: string; // AAAA-MM-JJ
  previous?: CompositionFile;
};

export type BuildResult = {
  file: CompositionFile; changed: boolean; stats: Stats; ambiguous: string[];
  capped: number; // listes d'ingrédients limitées à MAX_INGREDIENTS
  eanDropped: number; // EAN écartés : déclarés pour plusieurs produits ANSES, ou rattachés à plusieurs références Douane
  emissionsDropped: number; // références sans émissions : déclarations du même jour en désaccord (R5)
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** « CELLULOSE ACETATE » → « Cellulose acetate » (le fichier est en capitales). */
function sentence(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
/** « Autre : 0 », « Autre : Not specified » → « Autre ». */
function cleanFunction(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return /^autre\s*:\s*(0|not specified|)$/i.test(t) ? 'Autre' : t;
}

/** Ingrédients par Code_Référence, dans l'ordre du fichier, sans doublon (nom, fonction, brûlé). */
function ingredientsByCode(rows: AnsesIngredientRow[]): Map<string, Ingredient[]> {
  const out = new Map<string, Ingredient[]>();
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const ing: Ingredient = { nom: sentence(r.nom), fonction: cleanFunction(r.fonction) };
    if (r.brule !== undefined) ing.brule = r.brule;
    const key = `${ing.nom.toLowerCase()}|${ing.fonction.toLowerCase()}|${ing.brule}`;
    const s = seen.get(r.code) ?? new Set<string>();
    if (s.has(key)) continue;
    s.add(key);
    seen.set(r.code, s);
    const list = out.get(r.code) ?? [];
    list.push(ing);
    out.set(r.code, list);
  }
  return out;
}

const BARCODE_TYPES = new Set(['EAN', 'GTIN', 'UPC']);

/**
 * Codes-barres du champ Numéro_Produit (il peut en contenir plusieurs) : seulement quand il est déclaré EAN, GTIN ou UPC
 * (un numéro d'article SKU ou interne passe parfois la clé EAN par hasard) ; UPC-A et GTIN-14 « 0… » rangés en EAN-13,
 * la forme que lit le scanner ; clé de contrôle vérifiée.
 */
function eans(p: AnsesProduct): string[] {
  if (!BARCODE_TYPES.has(p.typeNumero.trim().toUpperCase())) return [];
  return [...new Set(p.numero.split(/[\s,;/]+/).map(retailCode).filter((c) => isValidEan(c)))];
}

const sameEmissions = (a: AnsesProduct, b: AnsesProduct) => a.nicotine === b.nicotine && a.goudron === b.goudron && a.co === b.co;

const statKey = (k: RefItem['kind']): StatKey | undefined =>
  k === 'cigarette' ? 'cigarette' : k === 'tabac-rouler' ? 'tabac-rouler' : k === 'cigare' || k === 'cigarillo' ? 'cigare' : undefined;

export function buildComposition({ products, composition, refs, date, source, fetchedAt, previous }: Options): BuildResult {
  const { matches, ambiguous } = matchDetailed(products, refs);
  const ingredients = ingredientsByCode(composition);
  const stats: Stats = { cigarette: { total: 0, matched: 0 }, 'tabac-rouler': { total: 0, matched: 0 }, cigare: { total: 0, matched: 0 } };
  for (const r of refs) {
    const k = statKey(r.kind);
    if (!k) continue;
    stats[k].total++;
    if (matches.has(r.ref)) stats[k].matched++;
  }

  // Un EAN ne désigne qu'un produit : un code déclaré pour deux produits ANSES différents (clés différentes, sur tout le
  // fichier), ou trouvé pour deux références Douane, est écarté partout.
  const productsOf = new Map<string, Set<string>>();
  for (const p of products) for (const e of eans(p)) productsOf.set(e, (productsOf.get(e) ?? new Set()).add(groupKey(p)));
  const refsOf = new Map<string, Set<string>>();
  for (const [ref, m] of matches) for (const p of m.group) for (const e of eans(p)) refsOf.set(e, (refsOf.get(e) ?? new Set()).add(ref));
  const unique = (e: string) => (productsOf.get(e)?.size ?? 0) === 1 && (refsOf.get(e)?.size ?? 0) === 1;
  const eanDropped = [...refsOf.keys()].filter((e) => !unique(e)).length;
  let emissionsDropped = 0;

  let capped = 0;
  const produits: Record<string, CompositionEntry> = {};
  for (const ref of [...matches.keys()].sort()) {
    const { product, group } = matches.get(ref)!;
    const entry = {} as CompositionEntry;
    // Déclarations les plus récentes (même jour) en désaccord sur les émissions : on n'en affiche aucune (R5).
    const sameDay = group.filter((p) => p.majLe.slice(0, 10) === product.majLe.slice(0, 10));
    const agreed = sameDay.every((p) => sameEmissions(p, product));
    if (product.categorie === 'cigarette' && !agreed) emissionsDropped++;
    if (product.categorie === 'cigarette' && agreed) {
      if (product.nicotine !== undefined) entry.nicotine = round2(product.nicotine);
      if (product.goudron !== undefined) entry.goudron = round2(product.goudron);
      if (product.co !== undefined) entry.co = round2(product.co);
    }
    // Recette du produit retenu ; à défaut, celle d'une autre déclaration du même produit.
    let list = ingredients.get(product.code) ?? group.map((p) => ingredients.get(p.code)).find((l) => l?.length) ?? [];
    const total = list.length;
    if (total > MAX_INGREDIENTS) { list = list.slice(0, MAX_INGREDIENTS); capped++; }
    entry.ingredients = list;
    if (total > MAX_INGREDIENTS) entry.ingredientsTotal = total;
    entry.ean = [...new Set(group.flatMap(eans))].filter(unique).sort();
    if (entry.nicotine === undefined && entry.goudron === undefined && entry.co === undefined && !list.length && !entry.ean.length) continue;
    produits[ref] = entry;
  }

  const hash = createHash('sha256').update(JSON.stringify(produits)).digest('hex').slice(0, 8);
  const version = `${date}-${hash}`;
  const extra = { stats, ambiguous, capped, eanDropped, emissionsDropped };
  if (previous?.version === version) return { file: previous, changed: false, ...extra };
  return { file: { version, fetchedAt, date, source, produits }, changed: true, ...extra };
}
