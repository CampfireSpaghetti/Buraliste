import { currentPrice, effectiveFields, officialState } from './catalog';
import { formatEuro } from './format';
import { rangeProfile, type RangeProfile } from './rangeProfile';
import type { Kind, Product, ProductFields } from './types';

export type Reason =
  | 'épinglé'
  | 'même force'
  | 'force proche'
  | 'même format'
  | 'goût proche'
  | 'prix ±0,50 €'
  | 'même origine'
  | 'même marque'
  | 'même prix de ticket'
  | 'même type de jeu';

/** `sentence` : explication en clair (cigarettes, tabac à rouler). */
export type Suggestion = { product: Product; score: number; reasons: Reason[]; sentence?: string };

const CIGAR_FAMILY: Kind[] = ['cigare', 'cigarillo'];
const CROSS_CIGAR_PENALTY = 10;

function sameText(a?: string, b?: string): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function familyPenalty(a: Kind, b: Kind): number | null {
  if (a === b) return 0;
  if (CIGAR_FAMILY.includes(a) && CIGAR_FAMILY.includes(b)) return CROSS_CIGAR_PENALTY;
  return null;
}

function scoreTobacco(t: ProductFields, c: ProductFields, today: Date): { score: number; reasons: Reason[] } {
  let score = 0;
  const reasons: Reason[] = [];
  if (t.strength !== undefined && c.strength !== undefined) {
    const gap = Math.abs(t.strength - c.strength);
    if (gap === 0) { score += 30; reasons.push('même force'); }
    else if (gap === 1) { score += 15; reasons.push('force proche'); }
  }
  if (sameText(t.format, c.format)) { score += 20; reasons.push('même format'); }
  if (t.tasteTags?.length && c.tasteTags?.length) {
    const a = new Set(t.tasteTags);
    const b = new Set(c.tasteTags);
    const inter = [...a].filter((x) => b.has(x)).length;
    const jaccard = inter / new Set([...a, ...b]).size;
    score += Math.round(jaccard * 25);
    if (jaccard >= 0.5) reasons.push('goût proche');
  }
  const pt = currentPrice(t, today);
  const pc = currentPrice(c, today);
  if (pt !== undefined && pc !== undefined) {
    const gap = Math.abs(pt - pc);
    if (gap <= 0.5 + 1e-9) { score += 15; reasons.push('prix ±0,50 €'); }
    else if (gap <= 1.5 + 1e-9) score += 7;
  }
  if (sameText(t.origin, c.origin)) { score += 5; reasons.push('même origine'); }
  if (sameText(t.brand, c.brand)) { score += 5; reasons.push('même marque'); }
  return { score, reasons };
}

function scoreGame(t: ProductFields, c: ProductFields): { score: number; reasons: Reason[] } {
  let score = 0;
  const reasons: Reason[] = [];
  if (t.ticketPrice !== undefined && t.ticketPrice === c.ticketPrice) { score += 50; reasons.push('même prix de ticket'); }
  if (sameText(t.gameType, c.gameType)) { score += 30; reasons.push('même type de jeu'); }
  if (t.maxPrize && c.maxPrize) score += Math.round((Math.min(t.maxPrize, c.maxPrize) / Math.max(t.maxPrize, c.maxPrize)) * 20);
  return { score, reasons };
}

const RANGE_KINDS: Kind[] = ['cigarette', 'tabac-rouler'];

function pricePhrase(target?: number, candidate?: number): string | undefined {
  if (target === undefined || candidate === undefined) return undefined;
  const d = Math.round((candidate - target) * 100) / 100;
  if (d === 0) return 'même prix';
  return `${d > 0 ? '+' : '−'}${formatEuro(Math.abs(d))}`;
}

function formatPhrase(t: RangeProfile, c: RangeProfile): string | undefined {
  if (t.count && c.count && t.count !== c.count) return `paquet de ${c.count} au lieu de ${t.count}`;
  if (t.weight && c.weight && t.weight !== c.weight) return `${c.weight} g au lieu de ${t.weight} g`;
  if (t.length !== c.length) return c.length === 'long' ? 'version longue (100s)' : c.length === 'slim' ? 'version slim' : 'version classique';
  if (t.pack && c.pack && t.pack !== c.pack) return `paquet ${c.pack}`;
  return undefined;
}

const sameFormat = (t: RangeProfile, c: RangeProfile) => formatPhrase(t, c) === undefined;

/** Distance de format : paquet souple/rigide < longueur < nombre de cigarettes ou poids. */
function formatDistance(t: RangeProfile, c: RangeProfile): number {
  let d = 0;
  if (t.pack && c.pack && t.pack !== c.pack) d += 0.5;
  if (t.length !== c.length) d += 1;
  if ((t.count && c.count && t.count !== c.count) || (t.weight && c.weight && t.weight !== c.weight)) d += 2;
  return d;
}

const SAME_BRAND_MAX = 3;

/**
 * Cigarettes et tabac à rouler : raisonnement de buraliste à partir du nom officiel.
 * 1. même marque, même goût (couleur), autre format ; 2. même marque, couleur voisine ;
 * 3. autre marque, même goût, même format (prix le plus proche) ; 4. autre marque, même goût, autre format.
 * Jamais de brun pour un blond, ni de produit à deux crans d'écart d'une autre marque.
 */
function suggestByRange(target: Product, candidates: Product[], today: Date, limit: number): Suggestion[] {
  const tf = effectiveFields(target);
  const tp = rangeProfile(tf);
  const tPrice = currentPrice(tf, today);
  const ranked: { product: Product; tier: number; dist: number; gap: number; sentence: string }[] = [];
  for (const product of candidates) {
    const cf = effectiveFields(product);
    if (cf.kind !== tf.kind) continue;
    const cp = rangeProfile(cf);
    if (cp.type !== tp.type) continue;
    const sameBrand = cp.brand.toLowerCase() === tp.brand.toLowerCase();
    const cPrice = currentPrice(cf, today);
    const gap = tPrice !== undefined && cPrice !== undefined ? Math.abs(cPrice - tPrice) : 99;
    const fmt = formatPhrase(tp, cp);
    let tier: number | undefined;
    let parts: string[] = [];
    if (sameBrand && tp.color && cp.color === tp.color) {
      tier = 1;
      parts = ['Même marque', `même goût (${cp.color})`, ...(fmt ? [fmt] : [])];
    } else if (sameBrand && tp.rank && cp.rank && Math.abs(tp.rank - cp.rank) === 1) {
      tier = 2;
      parts = ['Même marque', `un cran plus ${cp.rank < tp.rank ? 'léger' : 'corsé'} (${cp.color})`, ...(fmt ? [fmt] : [])];
    } else if (sameBrand && (!tp.color || !cp.color)) {
      tier = 2.5; // couleur non précisée dans le nom : moins sûr qu'une couleur voisine
      parts = ['Même marque', ...(fmt ? [fmt] : [])];
    } else if (!sameBrand && tp.rank && cp.rank === tp.rank) {
      tier = sameFormat(tp, cp) ? 3 : 4;
      parts = ['Autre marque', `même goût (${cp.color})`, fmt ?? 'même format'];
    }
    if (tier === undefined) continue;
    const price = pricePhrase(tPrice, cPrice);
    ranked.push({ product, tier, dist: formatDistance(tp, cp), gap, sentence: parts.join(', ') + (price ? ` · ${price}` : '') });
  }
  ranked.sort((a, b) => a.tier - b.tier || a.dist - b.dist || a.gap - b.gap || effectiveFields(a.product).name.localeCompare(effectiveFields(b.product).name, 'fr'));
  // Quelques formats de la même marque, puis d'autres marques (au cas où toute la marque manque).
  const same = ranked.filter((r) => r.tier < 3).slice(0, SAME_BRAND_MAX);
  const other = ranked.filter((r) => r.tier >= 3).slice(0, Math.max(0, limit - same.length));
  const extra = ranked.filter((r) => r.tier < 3 && !same.includes(r)).slice(0, Math.max(0, limit - same.length - other.length));
  return [...same, ...other, ...extra].map((r) => ({ product: r.product, score: Math.round(500 - r.tier * 100 - r.gap), reasons: [], sentence: r.sentence }));
}

export function suggestSubstitutes(target: Product, all: Product[], today: Date, limit = 5): Suggestion[] {
  const t = effectiveFields(target);
  if (RANGE_KINDS.includes(t.kind)) {
    const pinned = target.pinnedSubstitutes;
    const available = all.filter((p) => p.id !== target.id && !p.outOfStock && officialState(effectiveFields(p), today) === 'actif');
    const byRange = suggestByRange(target, available.filter((p) => !pinned.includes(p.id)), today, limit);
    const pinnedInfo = suggestByRange(target, available.filter((p) => pinned.includes(p.id)), today, pinned.length);
    const pinnedHits = pinned
      .map((id) => available.find((p) => p.id === id))
      .filter((p): p is Product => !!p)
      .map((product) => {
        const known = pinnedInfo.find((s) => s.product.id === product.id);
        return { product, score: 1000, reasons: ['épinglé'] as Reason[], sentence: known ? `Épinglé · ${known.sentence}` : 'Épinglé par vous' };
      });
    return [...pinnedHits, ...byRange];
  }
  const pinned = target.pinnedSubstitutes;
  const scored: Suggestion[] = [];

  for (const product of all) {
    if (product.id === target.id || product.outOfStock) continue;
    const c = effectiveFields(product);
    if (officialState(c, today) !== 'actif') continue;
    const penalty = familyPenalty(t.kind, c.kind);
    if (penalty === null) continue;
    const { score, reasons } = t.kind === 'jeu-fdj' ? scoreGame(t, c) : scoreTobacco(t, c, today);
    scored.push({ product, score: score - penalty, reasons });
  }

  const pinnedHits = pinned
    .map((id) => scored.find((s) => s.product.id === id))
    .filter((s): s is Suggestion => !!s)
    .map((s) => ({ ...s, reasons: ['épinglé', ...s.reasons] as Reason[] }));

  const rest = scored
    .filter((s) => !pinned.includes(s.product.id) && s.score > 0)
    .sort((a, b) => b.score - a.score || effectiveFields(a.product).name.localeCompare(effectiveFields(b.product).name, 'fr'))
    .slice(0, limit);

  return [...pinnedHits, ...rest];
}
