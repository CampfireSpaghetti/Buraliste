import { describe, it, expect } from 'vitest';
import { countTotal, sortLines } from '../../src/domain/count';
import type { CountLine } from '../../src/domain/types';

const l = (name: string, quantity: number, updatedAt: number): CountLine => ({ id: name, code: '', name, quantity, updatedAt });
const lines = [l('Millionnaire', 12, 3), l('astro', 45, 1), l('Écureuil', 5, 2), l('Cash', 38, 4)];

describe('comptage', () => {
  it('total des quantités', () => expect(countTotal(lines)).toBe(100));
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
});
