// Construit public/data/composition.json à partir des fichiers ANSES lus et de la liste Douane : seulement les références
// rapprochées avec certitude (voir matchDouane.ts), avec leurs émissions, leurs ingrédients et leurs EAN valides.
import { createHash } from 'node:crypto';
import { isValidEan } from '../../src/domain/barcode.ts';
import type { RefItem } from '../../src/domain/catalog.ts';
import { MAX_INGREDIENTS, type CompositionEntry, type CompositionFile, type Ingredient } from '../../src/domain/composition.ts';
import { matchDetailed, type AnsesProduct } from './matchDouane.ts';
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

export type BuildResult = { file: CompositionFile; changed: boolean; stats: Stats; ambiguous: string[]; capped: number; eanDropped: number };

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

/** EAN-8/13 valides du champ Numéro_Produit (il peut en contenir plusieurs, séparés par des virgules). */
function eans(p: AnsesProduct): string[] {
  return p.numero.split(/[\s,;/]+/).filter((c) => isValidEan(c));
}

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

  // Un EAN ne peut désigner qu'une référence : un code trouvé pour deux références est écarté des deux.
  const owners = new Map<string, Set<string>>();
  for (const [ref, m] of matches) for (const p of m.group) for (const e of eans(p)) owners.set(e, (owners.get(e) ?? new Set()).add(ref));
  let eanDropped = 0;
  for (const s of owners.values()) if (s.size > 1) eanDropped++;

  let capped = 0;
  const produits: Record<string, CompositionEntry> = {};
  for (const ref of [...matches.keys()].sort()) {
    const { product, group } = matches.get(ref)!;
    const entry = {} as CompositionEntry;
    if (product.categorie === 'cigarette') {
      if (product.nicotine !== undefined) entry.nicotine = round2(product.nicotine);
      if (product.goudron !== undefined) entry.goudron = round2(product.goudron);
      if (product.co !== undefined) entry.co = round2(product.co);
    }
    // Recette du produit retenu ; à défaut, celle d'une autre déclaration du même produit.
    let list = ingredients.get(product.code) ?? group.map((p) => ingredients.get(p.code)).find((l) => l?.length) ?? [];
    if (list.length > MAX_INGREDIENTS) { list = list.slice(0, MAX_INGREDIENTS); capped++; }
    entry.ingredients = list;
    entry.ean = [...new Set(group.flatMap(eans))].filter((e) => owners.get(e)!.size === 1).sort();
    if (entry.nicotine === undefined && entry.goudron === undefined && entry.co === undefined && !list.length && !entry.ean.length) continue;
    produits[ref] = entry;
  }

  const hash = createHash('sha256').update(JSON.stringify(produits)).digest('hex').slice(0, 8);
  const version = `${date}-${hash}`;
  if (previous?.version === version) return { file: previous, changed: false, stats, ambiguous, capped, eanDropped };
  return { file: { version, fetchedAt, date, source, produits }, changed: true, stats, ambiguous, capped, eanDropped };
}
