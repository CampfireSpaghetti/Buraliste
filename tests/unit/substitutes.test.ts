import { describe, it, expect } from 'vitest';
import { suggestSubstitutes } from '../../src/domain/substitutes';
import type { Product, ProductFields } from '../../src/domain/types';

const today = new Date('2026-10-16T12:00:00');
function p(id: string, f: Partial<ProductFields>, extra: Partial<Product> = {}): Product {
  return { id, source: 'douane', base: { kind: 'cigare', name: id, ...f }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, ...extra };
}
const target = p('T', { strength: 3, format: '20 unités', tasteTags: ['doux', 'équilibré'], price: 13, origin: 'France', brand: 'Marque' });

describe('suggestSubstitutes — cigares (score force, format, goût, prix)', () => {
  it('même force, format, goût et prix : 90 points sans origine ni marque', () => {
    const twin = p('A', { strength: 3, format: '20 unités', tasteTags: ['équilibré', 'doux'], price: 13, origin: 'Cuba', brand: 'Autre' });
    const [s] = suggestSubstitutes(target, [target, twin], today);
    expect(s.score).toBe(90);
    expect(s.reasons).toEqual(['même force', 'même format', 'goût proche', 'prix ±0,50 €']);
  });
  it('origine et marque rapportent 5 points chacune', () => {
    const cousin = p('B', { origin: 'France', brand: 'Marque' });
    expect(suggestSubstitutes(target, [cousin], today)[0]).toMatchObject({ score: 10, reasons: ['même origine', 'même marque'] });
  });
  it('force proche et prix à 1 € près', () => {
    const near = p('C', { strength: 4, price: 14 });
    expect(suggestSubstitutes(target, [near], today)[0]).toMatchObject({ score: 22, reasons: ['force proche'] });
  });
  it('donnée absente : ni points ni raison', () => {
    const blank = p('D', { format: '20 unités' });
    expect(suggestSubstitutes(target, [blank], today)[0]).toMatchObject({ score: 20, reasons: ['même format'] });
  });
  it('exclut rupture, la cible, les autres familles, les retirés, les pas encore en vente et les scores nuls', () => {
    const all = [
      target,
      p('rupture', { strength: 3 }, { outOfStock: true }),
      p('rouler', { kind: 'cigarette', strength: 3 }),
      p('retire', { strength: 3, status: 'retrait', effectiveDate: '2026-10-01' }),
      p('bientot', { strength: 3, status: 'nouveau', effectiveDate: '2026-11-01' }),
      p('rien', { origin: 'Cuba' }),
      p('ok', { strength: 3 }),
    ];
    expect(suggestSubstitutes(target, all, today).map((s) => s.product.id)).toEqual(['ok']);
  });
  it('cigarillo proposé pour un cigare avec 10 points de pénalité', () => {
    const cigare = p('cig', { kind: 'cigare', strength: 2, format: '20 cigares' });
    const cigarillo = p('illo', { kind: 'cigarillo', strength: 2, format: '20 cigares' });
    expect(suggestSubstitutes(cigare, [cigarillo], today)[0].score).toBe(40);
  });
  it('les épinglés passent en tête dans l’ordre choisi, sauf en rupture', () => {
    const t = { ...target, pinnedSubstitutes: ['P2', 'P1', 'Px'] };
    const all = [t, p('best', { strength: 3, format: '20 unités' }), p('P1', { brand: 'Marque' }), p('P2', {}), p('Px', {}, { outOfStock: true })];
    const r = suggestSubstitutes(t, all, today);
    expect(r.map((s) => s.product.id)).toEqual(['P2', 'P1', 'best']);
    expect(r[0].reasons[0]).toBe('épinglé');
  });
  it('limite le nombre de suggestions hors épinglés', () => {
    const many = Array.from({ length: 9 }, (_, i) => p('m' + i, { strength: 3 }));
    expect(suggestSubstitutes(target, many, today, 5)).toHaveLength(5);
  });
});

describe('suggestSubstitutes — jeux FDJ', () => {
  const g = (id: string, f: Partial<ProductFields>) => p(id, { kind: 'jeu-fdj', ...f }, { source: 'depart' });
  const cash = g('Cash', { ticketPrice: 5, gameType: 'gros lot', maxPrize: 500000 });
  it('même prix et même type : au moins 80 points', () => {
    const r = suggestSubstitutes(cash, [g('Or', { ticketPrice: 5, gameType: 'gros lot', maxPrize: 500000 })], today);
    expect(r[0].score).toBe(100);
    expect(r[0].reasons).toEqual(['même prix de ticket', 'même type de jeu']);
  });
  it('gain maximum : ratio × 20', () => {
    const r = suggestSubstitutes(cash, [g('Demi', { ticketPrice: 2, maxPrize: 250000 })], today);
    expect(r[0].score).toBe(10);
  });
  it('ne mélange pas jeux et tabac', () => {
    expect(suggestSubstitutes(cash, [target], today)).toEqual([]);
  });
});
