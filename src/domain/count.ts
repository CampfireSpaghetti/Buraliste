import { officialState } from './catalog';
import { effectiveFields } from './matching';
import { gameLineId } from './productId';
import type { CountLine, Product } from './types';

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

/**
 * Tous les jeux de grattage figurent dans le comptage : une ligne à 0 / 0, jamais modifiée (updatedAt 0),
 * pour chaque jeu actif du catalogue qui n'en a pas encore, sauf ceux que le buraliste a enlevés de sa liste.
 * L'id dépend du jeu : relancer la fonction ne crée jamais de doublon.
 */
export function missingGameLines(products: Product[], lines: CountLine[], hiddenGameIds: string[], today = new Date()): CountLine[] {
  const counted = new Set(lines.map((l) => l.gameId).filter(Boolean));
  const hidden = new Set(hiddenGameIds);
  const out: CountLine[] = [];
  for (const p of products) {
    const f = effectiveFields(p);
    if (f.kind !== 'jeu-fdj' || counted.has(p.id) || hidden.has(p.id) || officialState(f, today) === 'retire') continue;
    out.push({ id: gameLineId(p.id), gameId: p.id, code: f.fdjPrefixes?.[0] ?? f.barcodes?.[0] ?? '', name: f.name, linearQty: 0, stockQty: 0, updatedAt: 0 });
  }
  return out;
}

/** Id d'une nouvelle ligne : `game:<id du jeu>` pour un jeu du catalogue (le même partout), sinon un id au hasard. */
export const countLineId = (gameId: string | undefined, newId: () => string): string => (gameId ? gameLineId(gameId) : newId());
