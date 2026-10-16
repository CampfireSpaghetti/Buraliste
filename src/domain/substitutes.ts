import { currentPrice, effectiveFields, officialState } from './catalog';
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

export type Suggestion = { product: Product; score: number; reasons: Reason[] };

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

export function suggestSubstitutes(target: Product, all: Product[], today: Date, limit = 5): Suggestion[] {
  const t = effectiveFields(target);
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
