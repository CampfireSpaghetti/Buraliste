import { describe, it, expect } from 'vitest';
import { countTotals, sortLines, migrateLegacyLine } from '../../src/domain/count';
import type { CountLine } from '../../src/domain/types';

const l = (name: string, linearQty: number, updatedAt: number, stockQty = 0): CountLine => ({ id: name, code: '', name, linearQty, stockQty, updatedAt });
const lines = [l('Millionnaire', 12, 3, 100), l('astro', 45, 1, 50), l('Écureuil', 5, 2), l('Cash', 38, 4, 150)];

describe('comptage', () => {
  it('totaux linéaire et stock', () => expect(countTotals(lines)).toEqual({ linear: 100, stock: 300 }));
  it('tri par nom à la française (accents, casse)', () => {
    expect(sortLines(lines, 'name').map((x) => x.name)).toEqual(['astro', 'Cash', 'Écureuil', 'Millionnaire']);
  });
  it('tri par date : plus récentes d’abord', () => {
    expect(sortLines(lines, 'updatedAt').map((x) => x.name)).toEqual(['Cash', 'Millionnaire', 'Écureuil', 'astro']);
  });
  it('ne modifie pas le tableau d’origine', () => {
    const copy = [...lines];
    sortLines(lines, 'name');
    expect(lines).toEqual(copy);
  });
  it('ancienne ligne « quantity » : devient la quantité linéaire, stock à 0', () => {
    expect(migrateLegacyLine({ id: 'a', code: '1', name: 'Cash', quantity: 7, updatedAt: 5 })).toEqual({ id: 'a', code: '1', name: 'Cash', linearQty: 7, stockQty: 0, updatedAt: 5 });
    const modern = l('X', 1, 1, 2);
    expect(migrateLegacyLine(modern)).toEqual(modern);
  });
});

import { missingGameLines } from '../../src/domain/count';
import type { Product } from '../../src/domain/types';

describe('tous les jeux listés dans le comptage', () => {
  const game = (id: string, name: string, over: Partial<Product> = {}): Product => ({ id, source: 'fdj', fdjRef: 'fdj|' + id, base: { kind: 'jeu-fdj', name, status: 'inchange' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, ...over });
  const cig: Product = { id: 'c', source: 'douane', base: { kind: 'cigarette', name: 'Marlboro' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 };
  it('ajoute une ligne à 0 / 0, jamais modifiée, pour chaque jeu actif sans ligne', () => {
    const lines = missingGameLines([game('A', 'Astro', { user: { fdjPrefix: '0520' } }), game('B', 'Banco'), cig], [l('Banco', 3, 9)].map((x) => ({ ...x, gameId: 'B' })), []);
    expect(lines).toEqual([{ id: 'game:A', gameId: 'A', code: '0520', name: 'Astro', linearQty: 0, stockQty: 0, updatedAt: 0 }]);
  });
  it('ignore les jeux retirés et ceux que le buraliste a enlevés de sa liste', () => {
    const retired = game('R', 'Ancien', { base: { kind: 'jeu-fdj', name: 'Ancien', status: 'retrait' } });
    expect(missingGameLines([retired, game('H', 'Caché')], [], ['H'])).toEqual([]);
  });
});
