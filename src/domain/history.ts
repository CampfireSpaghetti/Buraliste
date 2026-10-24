import { fold } from './search';
import type { CountLine, CountSnapshot } from './types';

/** Nombre de comptages gardés dans l'historique. */
export const HISTORY_MAX = 8;

/** Clé d'un jeu d'un comptage à l'autre : son id (jeu du catalogue), sinon son nom sans accents ni majuscules. */
export function lineKey(l: Pick<CountLine, 'gameId' | 'name'>): string {
  return l.gameId ?? `nom:${fold(l.name.trim())}`;
}

/** Photo du tableau au moment de « Fin comptage » : lignes visibles, triées par nom. */
export function takeSnapshot(lines: CountLine[], at: number, id: string): CountSnapshot {
  const visible = lines.filter((l) => l.deleted !== true).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return { id, at, lines: visible.map((l) => ({ key: lineKey(l), name: l.name, code: l.code, linearQty: l.linearQty, stockQty: l.stockQty })) };
}

const byDateDesc = (a: CountSnapshot, b: CountSnapshot) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Comptages visibles, les plus récents d'abord, 8 au plus. */
export function visibleHistory(list: CountSnapshot[]): CountSnapshot[] {
  return list.filter((s) => s.deleted !== true).sort(byDateDesc).slice(0, HISTORY_MAX);
}

/** Comptages en trop (au-delà des 8 plus récents), à supprimer. */
export function overflow(list: CountSnapshot[]): CountSnapshot[] {
  return list.filter((s) => s.deleted !== true).sort(byDateDesc).slice(HISTORY_MAX);
}

/**
 * Écart avec le comptage précédent : pour chaque jeu, tickets (linéaire + stock) maintenant moins avant ; « nouveau » si
 * le jeu n'y était pas. Négatif : tickets vendus ; positif : livraison. Sans précédent : aucun écart.
 */
export function snapshotDiff(s: CountSnapshot, prev: CountSnapshot | undefined): { byKey: Map<string, number | 'nouveau'>; total: number | undefined } {
  const byKey = new Map<string, number | 'nouveau'>();
  if (!prev) return { byKey, total: undefined };
  const before = new Map(prev.lines.map((l) => [l.key, l.linearQty + l.stockQty]));
  for (const l of s.lines) {
    const b = before.get(l.key);
    byKey.set(l.key, b === undefined ? 'nouveau' : l.linearQty + l.stockQty - b);
  }
  const sum = (x: CountSnapshot) => x.lines.reduce((n, l) => n + l.linearQty + l.stockQty, 0);
  return { byKey, total: sum(s) - sum(prev) };
}
