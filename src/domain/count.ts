import type { CountLine } from './types';

export function countTotal(lines: CountLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function sortLines(lines: CountLine[], by: 'name' | 'updatedAt'): CountLine[] {
  const copy = [...lines];
  if (by === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  else copy.sort((a, b) => b.updatedAt - a.updatedAt);
  return copy;
}
