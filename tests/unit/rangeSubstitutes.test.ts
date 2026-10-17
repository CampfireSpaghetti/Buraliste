import { describe, it, expect } from 'vitest';
import { suggestSubstitutes } from '../../src/domain/substitutes';
import type { Product } from '../../src/domain/types';

const today = new Date('2026-10-16T12:00:00');
let n = 0;
const cig = (name: string, price: number, extra: Partial<Product> = {}): Product => ({
  id: 'p' + ++n, source: 'douane', douaneRef: 'x|' + name, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
  base: { kind: 'cigarette', name, format: /, en (.+)$/.exec(name)?.[1], price, status: 'inchange', effectiveDate: '2026-11-01' }, user: {}, ...extra,
});

const target = cig('Marlboro Red (paquet rigide), en 20 unités', 13);
const red25 = cig('Marlboro XL Classic Red, en 25 unités', 16.25);
const gold20 = cig('Marlboro Gold Collection, en 20 unités', 13);
const luckyRed = cig('Lucky Strike Red, en 20 unités', 13);
const winstonRed = cig('Winston Rouge, en 20 unités', 12.5);
const camelBlue = cig('Camel Bleu No.1, en 20 unités', 10.5);
const gauloisesBrune = cig('Gauloises Brunes Filtre, en 20 unités', 13);
const luckyRedOut = cig('Lucky Strike Red XL, en 25 unités', 16.25, { outOfStock: true });
const all = [target, red25, gold20, luckyRed, winstonRed, camelBlue, gauloisesBrune, luckyRedOut];

describe('remplaçants de cigarettes : raisonnement de buraliste', () => {
  const s = suggestSubstitutes(target, all, today);
  it('ordre : même marque même goût, puis même marque couleur voisine, puis autre marque même goût et format', () => {
    expect(s.map((x) => x.product.id)).toEqual([red25.id, gold20.id, luckyRed.id, winstonRed.id]);
  });
  it('une phrase claire pour chaque proposition', () => {
    expect(s[0].sentence).toBe('Même marque, même goût (Rouge), paquet de 25 au lieu de 20 · +3,25 €');
    expect(s[1].sentence).toBe('Même marque, un cran plus léger (Gold) · même prix');
    expect(s[2].sentence).toBe('Autre marque, même goût (Rouge), même format · même prix');
    expect(s[3].sentence).toBe('Autre marque, même goût (Rouge), même format · −0,50 €');
  });
  it('jamais de brun pour un blond, ni de produit en rupture, ni deux crans d’écart', () => {
    const ids = s.map((x) => x.product.id);
    expect(ids).not.toContain(gauloisesBrune.id);
    expect(ids).not.toContain(luckyRedOut.id);
    expect(ids).not.toContain(camelBlue.id); // autre marque ET autre goût : pas pertinent
  });
  it('les épinglés restent en tête', () => {
    const pinned = { ...target, pinnedSubstitutes: [camelBlue.id] };
    const r = suggestSubstitutes(pinned, all, today);
    expect(r[0].product.id).toBe(camelBlue.id);
    expect(r[0].sentence).toMatch(/^Épinglé/);
  });
  it('tabac à rouler : même logique avec le poids', () => {
    const roll = (name: string, price: number) => ({ ...cig(name, price), base: { ...cig(name, price).base, kind: 'tabac-rouler' as const } });
    const drum30 = roll('Drum bleu (blague), en 30 g', 18.9);
    const drum50 = roll('Drum bleu (blague), en 50 g', 31.5);
    const r = suggestSubstitutes(drum30, [drum30, drum50], today);
    expect(r[0].sentence).toBe('Même marque, même goût (Bleu), 50 g au lieu de 30 g · +12,60 €');
  });
});
