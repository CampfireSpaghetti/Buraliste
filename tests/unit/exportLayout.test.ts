import { describe, it, expect } from 'vitest';
import { layoutExport, EXPORT_WIDTH } from '../../src/domain/exportLayout';
import type { CountLine, Settings } from '../../src/domain/types';

const settings: Settings = { shopName: 'Tabac du Centre', sortCount: 'name' };
const now = new Date(2026, 9, 16, 18, 42).getTime();
const line = (name: string, quantity: number, i = 0): CountLine => ({ id: name, code: '0417001234567' + (i % 10), name, quantity, updatedAt: new Date(2026, 9, 16, 18, i % 60).getTime() });

describe('layoutExport', () => {
  const five = ['Millionnaire', 'Astro', 'Cash', 'Banco', 'Morpion'].map((n, i) => line(n, i + 1, i));
  const l = layoutExport(five, settings, now);
  it('toutes les lignes, codes complets, triées comme à l’écran', () => {
    expect(l.rows).toHaveLength(5);
    expect(l.rows.map((r) => r.cells[1])).toEqual(['Astro', 'Banco', 'Cash', 'Millionnaire', 'Morpion']);
    expect(l.rows[0].cells[0]).toBe('04170012345671');
    expect(l.rows[0].cells[3]).toBe('16/10 18:01');
  });
  it('en-tête : tabac, titre, date', () => {
    expect(l.header).toEqual({ shop: 'Tabac du Centre', title: 'Comptage grattage', stamp: '16/10/2026 18:42' });
  });
  it('hauteur : en-tête, lignes, total puis pied, dans l’ordre', () => {
    expect(l.width).toBe(EXPORT_WIDTH);
    expect(l.rows[0].y).toBeLessThan(l.rows[4].y);
    expect(l.totalY).toBeGreaterThan(l.rows[4].y);
    expect(l.footerY).toBeGreaterThan(l.totalY);
    expect(l.height).toBeGreaterThan(l.footerY);
    expect(l.total).toBe(15);
    expect(l.totalLabel).toBe('Total · 5 jeux');
    expect(l.scale).toBe(2);
  });
  it('suit le tri par date', () => {
    const byDate = layoutExport(five, { ...settings, sortCount: 'updatedAt' }, now);
    expect(byDate.rows[0].cells[1]).toBe('Morpion');
  });
  it('layoutExport réduit l’échelle au-delà de la limite iOS', () => {
    const many = Array.from({ length: 300 }, (_, i) => line('Jeu ' + i, 1, i));
    const big = layoutExport(many, settings, now);
    expect(big.rows).toHaveLength(300);
    expect(big.scale).toBeLessThan(2);
    expect(big.width * big.scale * big.height * big.scale).toBeLessThanOrEqual(16_777_216);
  });
});
