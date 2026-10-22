// Rapprochement des produits déclarés à l'ANSES avec les références de la liste Douane. Il n'existe aucun identifiant
// commun : on compare le nom (marque + variante), le format (nombre de cigarettes ou de cigares, poids du tabac à rouler)
// et le paquet. Règle : aucune composition plutôt qu'une mauvaise.
//
// - chaque mot significatif d'un côté doit se retrouver de l'autre (« Marlboro Gold » ≠ « Marlboro Gold Touch ») ;
//   seule tolérance : une faute de frappe d'une lettre dans un mot d'au moins 7 lettres (note 0,9 au lieu de 1) ;
// - format et catégorie identiques ; paquet souple/rigide ou pochette/boîte : jamais contradictoires ;
// - meilleure note ≥ MIN_SCORE, et au moins MARGIN de plus que tout produit différent : sinon, non rapproché ;
// - filtre : une désignation Douane avec « filtre » ne prend qu'une déclaration « filtre », avec « sans filtre » qu'une
//   déclaration « sans filtre » ; sans mention, seulement « sans filtre » si la liste Douane a aussi la variante « Filtre »
//   (« Gitanes » / « Gitanes Filtre ») ; sinon filtre et sans filtre sont deux produits (ambigus s'ils ont le même nom).
//   Hors tabac à rouler (le filtre n'y a pas de sens) ;
// - plusieurs déclarations d'un même produit (mêmes mots, même format, même paquet, même filtre) : la plus récente.
import type { RefItem } from '../../src/domain/catalog.ts';

export type AnsesCategory = 'cigarette' | 'tabac-rouler' | 'cigare' | 'cigarillo' | 'autre';

export type AnsesProduct = {
  code: string; // Code_Référence (clé ANSES : désignation + empreinte)
  categorie: AnsesCategory;
  marque: string;
  sousType: string;
  filtre?: boolean; // Filtre_Produit : true « filtre », false « sans filtre », absent si non précisé
  unites?: number;
  poids?: number; // g (tabac à rouler)
  conditionnement: string;
  typeNumero: string; // Type_Numéro_Produit : « EAN », « GTIN », « UPC », « SKU » ou « - » (interne)
  numero: string; // Numéro_Produit
  majLe: string; // date de dernière mise à jour du dossier (AAAA-MM-JJTHH:MM:SS)
  goudron?: number;
  nicotine?: number;
  co?: number;
};

export const MIN_SCORE = 0.9;
export const MARGIN = 0.05;
const PACK_BONUS = 0.05;

/** Mots sans valeur pour distinguer deux produits (le format et le paquet sont comparés à part). */
const NOISE = new Set([
  'a', 'et', 'de', 'du', 'des', 'la', 'le', 'les', 'en', 'by', 'the', 'and', 'of',
  'cigarette', 'cigare', 'cigar', 'ks', 'hard', 'soft', 'pack', 'paquet', 'rigide', 'souple', 'box',
  'blague', 'pot', 'rond', 'ronde', 'boite', 'coffret', 'etui', 'metal', 'pochette', 'pouch',
  'xl', 'xxl', 'mega', 'unite', 'g', 'gr', 'gramme',
]);
const FOLD: Record<string, string> = {
  bleue: 'bleu', verte: 'vert', blonde: 'blond', brune: 'brun', noire: 'noir', originale: 'original',
  longue: '100s', long: '100s', longs: '100s', cigarettes: 'cigarette', cigares: 'cigare', cigars: 'cigar', unites: 'unite',
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Mots significatifs d'un nom (accents, casse, ponctuation, « by », pluriels et format retirés). */
export function nameTokens(name: string, formatNumber?: number): string[] {
  const t = fold(name)
    .replace(/\bsans\s+filtres?\b/g, ' ') // « sans filtre » est comparé à part (filtre)
    .replace(/\b100\s*['’`´]?\s*s\b/g, ' 100s ')
    .replace(/\b[ld]\s*['’`´]\s*/g, '') // élision : « L'Originale » = « Originale », « D'Oro » = « Oro »
    .replace(/['’`´]/g, ' ');
  const out = new Set<string>();
  for (let w of t.split(/[^a-z0-9]+/)) {
    if (!w) continue;
    w = FOLD[w] ?? w;
    if (w.length >= 5 && w.endsWith('s') && !/\d/.test(w)) w = FOLD[w.slice(0, -1)] ?? w.slice(0, -1);
    if (NOISE.has(w)) continue;
    // Le nombre du format (« 20 », « 30g ») est comparé à part.
    const n = /^(\d+(?:\.\d+)?)g?$/.exec(w);
    if (n && formatNumber !== undefined && Number(n[1]) === formatNumber) continue;
    out.add(w);
  }
  return [...out];
}

type Pack = 'rigide' | 'souple' | 'multiple';
type Wrap = 'pochette' | 'boite';

function ansesPack(p: AnsesProduct): Pack {
  if (/emballage multiple/i.test(p.conditionnement)) return 'multiple';
  return /paquet souple/i.test(p.conditionnement) || /soft pack/i.test(p.sousType) ? 'souple' : 'rigide';
}
function ansesWrap(p: AnsesProduct): Wrap | undefined {
  const c = fold(p.conditionnement);
  if (/^(pochette|sachet|paquet souple)/.test(c)) return 'pochette';
  if (/^(boite|pot)/.test(c)) return 'boite';
  return undefined;
}

type Side = { kind: RefItem['kind']; tokens: string[]; count?: number; weight?: number; pack?: Pack; wrap?: Wrap; filtre?: boolean };

/** Ce que dit la désignation Douane : nom, nombre ou poids (« , en 20 unités », « en boîte de 42 cigares »), paquet. */
export function douaneSide(item: Pick<RefItem, 'name' | 'kind'>): Side | undefined {
  const m = /^(.*?)[,\s]+en\s+(?:bo[iî]te\s+de\s+)?(\d+(?:[.,]\d+)?)\s*([a-zA-Zéè]*)\s*$/i.exec(item.name.trim());
  if (!m) return undefined;
  const label = m[1];
  const value = Number(m[2].replace(',', '.'));
  const unit = fold(m[3]);
  const side: Side = { kind: item.kind, tokens: [] };
  if (/^g/.test(unit)) side.weight = value;
  else if (unit === '' || /^(unite|cigar|ciagre|piece)/.test(unit)) side.count = value;
  else return undefined;
  const l = fold(label);
  if (/paquet souple|soft pack/.test(l)) side.pack = 'souple';
  else if (/paquet rigide|hard pack/.test(l)) side.pack = 'rigide';
  if (/\b(blague|pochette|pouch)\b/.test(l)) side.wrap = 'pochette';
  else if (/\b(pot|boite|tin)\b/.test(l)) side.wrap = 'boite';
  if (item.kind !== 'tabac-rouler') {
    if (/\bsans\s+filtres?\b/.test(l)) side.filtre = false;
    else if (/\bfiltres?\b/.test(l)) side.filtre = true;
  }
  side.tokens = nameTokens(label, side.weight ?? side.count);
  return side.tokens.length ? side : undefined;
}

const CATEGORIES: Partial<Record<RefItem['kind'], AnsesCategory[]>> = {
  cigarette: ['cigarette'],
  'tabac-rouler': ['tabac-rouler'],
  cigare: ['cigare', 'cigarillo'],
  cigarillo: ['cigare', 'cigarillo'],
};

/** Mot à une lettre près (substitution, ajout ou retrait), pour les mots d'au moins 7 lettres de même initiale. */
function nearlySame(a: string, b: string): boolean {
  if (a.length < 7 || b.length < 7 || a[0] !== b[0] || Math.abs(a.length - b.length) > 1 || /\d/.test(a + b)) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Note de nom : 0 si un mot d'un côté manque de l'autre ; sinon moyenne (1 exact, 0,9 à une lettre près). */
function nameScore(d: string[], a: string[]): number {
  const as = new Set(a);
  const ds = new Set(d);
  let total = 0;
  for (const [mine, other, otherSet] of [[d, a, as], [a, d, ds]] as const) {
    for (const w of mine) {
      if (otherSet.has(w)) total += 1;
      else if (other.some((o) => nearlySame(w, o))) total += 0.9;
      else return 0;
    }
  }
  return total / (d.length + a.length);
}

type Prepared = { p: AnsesProduct; tokens: string[]; pack: Pack; wrap?: Wrap; filtre?: boolean; key: string; format: number };

/** Filtre d'une déclaration ; sans objet pour le tabac à rouler. */
const ansesFiltre = (p: AnsesProduct) => (p.categorie === 'tabac-rouler' ? undefined : p.filtre);
const filtreKey = (f: boolean | undefined) => (f === true ? 'filtre' : f === false ? 'sans-filtre' : '');

/** Produit comparable (mots, paquet, clé du produit) ; undefined s'il n'est jamais rapproché (Duty Free, autre type…). */
function describe(p: AnsesProduct): Prepared | undefined {
  if (p.categorie === 'autre' || /duty\s*free/i.test(`${p.marque} ${p.sousType} ${p.code}`)) return undefined;
  const format = p.categorie === 'tabac-rouler' ? p.poids : p.unites;
  if (!format) return undefined;
  const tokens = nameTokens(`${p.marque} ${p.sousType}`, format);
  if (!tokens.length) return undefined;
  const pack = ansesPack(p);
  const wrap = ansesWrap(p);
  const filtre = ansesFiltre(p);
  const key = [p.categorie, [...tokens].sort().join(' '), format, pack, p.categorie === 'tabac-rouler' ? wrap ?? '' : '', filtreKey(filtre)].join('|');
  return { p, tokens, pack, wrap, filtre, key, format };
}

/**
 * Clé d'un produit : deux déclarations de même clé sont le même produit (mêmes mots, format, paquet). Pour un produit
 * jamais rapproché, une clé brute (catégorie, nom, unités, poids, paquet) : sert à repérer un EAN partagé par deux produits.
 */
export function groupKey(p: AnsesProduct): string {
  return describe(p)?.key ?? ['brut', p.categorie, fold(`${p.marque} ${p.sousType}`).replace(/\s+/g, ' ').trim(), p.unites ?? '', p.poids ?? '', fold(p.conditionnement), filtreKey(ansesFiltre(p))].join('|');
}

function prepare(products: AnsesProduct[]): Map<string, Prepared[]> {
  const index = new Map<string, Prepared[]>();
  for (const p of products) {
    const d = describe(p);
    if (!d) continue;
    const k = `${p.categorie}|${d.format}`;
    const list = index.get(k) ?? [];
    list.push(d);
    index.set(k, list);
  }
  return index;
}

function score(side: Side, c: Prepared): number {
  if (c.pack === 'multiple') return 0;
  if (side.pack && side.pack !== c.pack) return 0;
  if (side.filtre !== undefined && c.p.categorie !== 'tabac-rouler' && c.filtre !== side.filtre) return 0;
  const tabac = c.p.categorie === 'tabac-rouler';
  if (tabac && side.wrap && c.wrap && side.wrap !== c.wrap) return 0;
  const s = nameScore(side.tokens, c.tokens);
  if (!s) return 0;
  let bonus = 0;
  if (!side.pack && c.p.categorie === 'cigarette' && c.pack === 'rigide') bonus += PACK_BONUS; // paquet non précisé : rigide
  if (tabac && side.wrap && side.wrap === c.wrap) bonus += PACK_BONUS;
  return s + bonus;
}

/** La plus récente des déclarations d'un même produit, puis la première clé ANSES (résultat stable). */
const newestFirst = (a: AnsesProduct, b: AnsesProduct) => (a.majLe !== b.majLe ? (a.majLe > b.majLe ? -1 : 1) : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

export type MatchResult = { product: AnsesProduct; group: AnsesProduct[]; score: number };
export type MatchReport = { matches: Map<string, MatchResult>; ambiguous: string[] };

/** Rapprochement détaillé : produit retenu, toutes les déclarations du même produit (EAN), note ; références ambiguës. */
export function matchDetailed(products: AnsesProduct[], refs: RefItem[]): MatchReport {
  const index = prepare(products);
  const matches = new Map<string, MatchResult>();
  const ambiguous: string[] = [];
  // Noms qui ont une variante « Filtre » dans la liste Douane (« Gitanes Filtre ») : le nom seul est alors sans filtre.
  const variantKey = (s: Side) => `${s.kind}|${s.tokens.filter((t) => t !== 'filtre').sort().join(' ')}`;
  const sides = new Map<RefItem, Side>();
  for (const item of refs) {
    const s = CATEGORIES[item.kind] && typeof item.ref === 'string' && item.ref ? douaneSide(item) : undefined;
    if (s) sides.set(item, s);
  }
  const withFilterVariant = new Set([...sides.values()].filter((s) => s.filtre === true).map(variantKey));
  for (const item of refs) {
    const cats = CATEGORIES[item.kind];
    const side = sides.get(item);
    if (!cats || !side) continue;
    if (side.filtre === undefined && item.kind !== 'tabac-rouler' && withFilterVariant.has(variantKey(side))) side.filtre = false;
    const format = item.kind === 'tabac-rouler' ? side.weight : side.count;
    if (format === undefined) continue;
    const scored: { c: Prepared; s: number }[] = [];
    for (const cat of cats) {
      for (const c of index.get(`${cat}|${format}`) ?? []) {
        const s = score(side, c);
        if (s > 0) scored.push({ c, s });
      }
    }
    if (!scored.length) continue;
    const best = Math.max(...scored.map((x) => x.s));
    if (best < MIN_SCORE) continue;
    const top = scored.filter((x) => x.s >= best - 1e-9);
    const key = top[0].c.key;
    const second = Math.max(0, ...scored.filter((x) => x.c.key !== key).map((x) => x.s));
    if (top.some((x) => x.c.key !== key) || best - second < MARGIN - 1e-9) {
      ambiguous.push(item.ref);
      continue;
    }
    const group = scored.filter((x) => x.c.key === key).map((x) => x.c.p).sort(newestFirst);
    matches.set(item.ref, { product: group[0], group, score: best });
  }
  return { matches, ambiguous };
}

/** Référence Douane → Code_Référence ANSES, pour les seuls rapprochements sûrs. */
export function matchToDouane(products: AnsesProduct[], refs: RefItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [ref, m] of matchDetailed(products, refs).matches) out.set(ref, m.product.code);
  return out;
}
