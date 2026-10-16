import type { CountLine } from './types';

export type CountTotals = { linear: number; stock: number };

export function countTotals(lines: CountLine[]): CountTotals {
  return lines.reduce((t, l) => ({ linear: t.linear + l.linearQty, stock: t.stock + l.stockQty }), { linear: 0, stock: 0 });
}

export function sortLines(lines: CountLine[], by: 'name' | 'updatedAt'): CountLine[] {
  const copy = [...lines];
  if (by === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  else copy.sort((a, b) => b.updatedAt - a.updatedAt);
  return copy;
}

/** Ligne enregistrée avant l'ajout du stock (« quantity ») : elle devient la quantité linéaire, stock à 0. */
export function migrateLegacyLine(l: CountLine | (Omit<CountLine, 'linearQty' | 'stockQty'> & { quantity: number })): CountLine {
  if (!('quantity' in l)) return l;
  const { quantity, ...rest } = l;
  return { ...rest, linearQty: quantity, stockQty: 0 };
}
