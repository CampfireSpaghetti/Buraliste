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
