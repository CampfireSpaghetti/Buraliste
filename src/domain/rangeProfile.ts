import type { ProductFields } from './types';

/**
 * Ce que dit le nom officiel d'un paquet (liste Douane) : marque, couleur de gamme, format.
 * C'est le repère des clients (« un Marlboro rouge en 20 »), à la place d'estimations de goût.
 */
export type RangeProfile = {
  brand: string;
  color?: string; // Rouge, Bleu, Gold, Argent, Blanc…
  rank?: number; // 4 corsé … 1 très léger
  type: 'blond' | 'brun';
  count?: number; // cigarettes par paquet
  weight?: number; // grammes (tabac à rouler)
  length: 'normal' | 'long' | 'slim' | 'compact';
  pack?: 'rigide' | 'souple';
};

const MULTI_WORD_BRANDS = [
  'Lucky Strike', 'Philip Morris', 'Pall Mall', 'Peter Stuyvesant', 'Benson & Hedges', 'Craven A', 'Golden Virginia',
  'Fleur du Pays', 'Fleur de Pays', 'American Spirit', 'Austin', 'Che', 'Rothmans', 'Royale', 'Gauloises', 'Gitanes',
];

const COLORS: [RegExp, string, number][] = [
  [/^(rouge|red|rosso)$/, 'Rouge', 4],
  [/^(noir|noire|black)$/, 'Noir', 4],
  [/^(bleu|bleue|blue)$/, 'Bleu', 3],
  [/^(gold|or|dorée?)$/, 'Gold', 3],
  [/^(blond|blonde)$/, 'Blond', 3],
  [/^(argent|silver|gris|grey)$/, 'Argent', 2],
  [/^(clair|claire|beige)$/, 'Clair', 2],
  [/^(vert|verte|green)$/, 'Vert', 2],
  [/^(blanc|blanche|white)$/, 'Blanc', 1],
];
const CLASSIC = /^(classic|classique|original|originale|l'originale|filters?|filtre)$/;
/** Marques de tabac brun dont le nom ne le précise pas. */
const DARK_BRANDS = ['gitanes'];

function words(name: string): string[] {
  return name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[\s,]+/).filter(Boolean);
}

export function rangeProfile(f: Pick<ProductFields, 'name' | 'format' | 'kind'>): RangeProfile {
  const label = f.name.replace(/, en .+$/, '').replace(/\s+by\s+.+$/i, '').trim();
  const lower = label.toLowerCase();
  const multi = MULTI_WORD_BRANDS.find((b) => lower.startsWith(b.toLowerCase() + ' ') || lower === b.toLowerCase());
  const brand = multi ?? label.split(/\s+/)[0];
  const rest = words(label.slice(brand.length));

  let color: string | undefined;
  let rank: number | undefined;
  for (const w of rest) {
    const hit = COLORS.find(([re]) => re.test(w));
    if (hit) { [, color, rank] = hit; break; }
  }
  if (!color && rest.some((w) => CLASSIC.test(w))) { color = 'Classique'; rank = 4; }

  const all = words(f.name);
  const saysDark = all.some((w) => /^brun(e|es|s)?$/.test(w));
  const saysBlond = all.some((w) => /^blond(e|es|s)?$/.test(w));
  const type = saysDark || (DARK_BRANDS.includes(brand.toLowerCase()) && !saysBlond) ? 'brun' : 'blond';
  const length: RangeProfile['length'] = all.some((w) => /^(slims?|ssl|superslims)$/.test(w))
    ? 'slim'
    : all.some((w) => /^(100s|100's|100|longues?|longs?)$/.test(w)) || /\(100's\)/i.test(f.name)
      ? 'long'
      : all.includes('compact') ? 'compact' : 'normal';
  const pack = /paquet rigide/i.test(f.name) ? 'rigide' : /paquet souple/i.test(f.name) ? 'souple' : undefined;
  const fmt = f.format ?? '';
  const count = Number(/(\d+)\s*unités/.exec(fmt)?.[1]) || undefined;
  const weight = Number(/(\d+)\s*g\b/.exec(fmt)?.[1]) || undefined;
  return { brand, color, rank, type, count, weight, length, pack };
}
