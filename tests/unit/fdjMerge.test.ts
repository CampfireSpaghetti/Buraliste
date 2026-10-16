import { describe, it, expect } from 'vitest';
import { mergeFdjGames, type FdjGamesFile, type FdjItem } from '../../src/domain/fdj';
import { officialState } from '../../src/domain/catalog';
import { effectiveFields } from '../../src/domain/matching';
import type { Product } from '../../src/domain/types';

const item = (id: string, name: string, over: Partial<FdjItem> = {}): FdjItem => ({ ref: 'fdj|' + id, fdjId: id, name, ticketPrice: 5, maxPrize: 500000, isNew: false, ...over });
const file = (items: FdjItem[]): FdjGamesFile => ({ version: 'v', fetchedAt: '2026-10-16', source: 't', items });
let n = 0;
const newId = () => 'id' + ++n;
const today = new Date('2026-10-16');

describe('mergeFdjGames', () => {
  const legacy: Product = { id: 'old', source: 'depart', outOfStock: false, pinnedSubstitutes: ['x'], updatedAt: 0,
    base: { kind: 'jeu-fdj', name: 'Cash', ticketPrice: 5 }, user: { fdjPrefix: '0417' } };

  it('reprend un jeu de la liste de départ par son nom (même id, couche user gardée)', () => {
    const ops = mergeFdjGames([legacy], file([item('ITGC9K', 'CASH')]), 1, newId);
    expect(ops.put).toHaveLength(1);
    expect(ops.put[0]).toMatchObject({ id: 'old', source: 'fdj', fdjRef: 'fdj|ITGC9K', user: { fdjPrefix: '0417' }, pinnedSubstitutes: ['x'] });
    expect(ops.put[0].base).toMatchObject({ kind: 'jeu-fdj', name: 'CASH', ticketPrice: 5, maxPrize: 500000, gameType: 'gros lot' });
  });
  it('les noms sont comparés sans casse, accents ni ponctuation', () => {
    const goal: Product = { ...legacy, id: 'g', base: { kind: 'jeu-fdj', name: 'Goal !' } };
    const ops = mergeFdjGames([goal], file([item('ITGBUT', 'Goal', { ticketPrice: 1, maxPrize: 4000 })]), 1, newId);
    expect(ops.put[0]).toMatchObject({ id: 'g', fdjRef: 'fdj|ITGBUT', base: { gameType: 'classique' } });
  });
  it('crée les nouveaux jeux et marque « nouveau »', () => {
    const ops = mergeFdjGames([], file([item('ITGPER', 'Perle Rare', { ticketPrice: 2, maxPrize: 20000, isNew: true })]), 1, () => 'neuf');
    expect(ops.put[0]).toMatchObject({ id: 'neuf', source: 'fdj', fdjRef: 'fdj|ITGPER', base: { name: 'Perle Rare', isNew: true } });
  });
  it('un jeu absent de la nouvelle liste est marqué retiré, jamais effacé', () => {
    const first = mergeFdjGames([], file([item('ITGJA2', 'Jackpot')]), 1, newId).put;
    first[0].user = { fdjPrefix: '0512' };
    const ops = mergeFdjGames(first, file([]), 2, newId);
    expect(ops.put[0].user).toEqual({ fdjPrefix: '0512' });
    expect(officialState(effectiveFields(ops.put[0]), today)).toBe('retire');
  });
  it('ne touche pas aux jeux créés par le buraliste', () => {
    const mine: Product = { ...legacy, id: 'm', source: 'utilisateur', base: {}, user: { kind: 'jeu-fdj', name: 'Cash' } };
    expect(mergeFdjGames([mine], file([item('ITGC9K', 'CASH')]), 1, () => 'nouveau').put.map((p) => p.id)).toEqual(['nouveau']);
  });
  it('est idempotent', () => {
    const f = file([item('ITGC9K', 'CASH'), item('ITGBUT', 'Goal')]);
    const first = mergeFdjGames([legacy], f, 1, newId);
    const all = [...first.put];
    const second = mergeFdjGames(all, f, 2, newId);
    expect(second.put).toHaveLength(0);
    expect(second.unchanged).toBe(2);
  });
});
