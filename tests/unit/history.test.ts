import { describe, it, expect } from 'vitest';
import { HISTORY_MAX, lineKey, overflow, snapshotDiff, takeSnapshot, visibleHistory } from '../../src/domain/history';
import type { CountLine, CountSnapshot } from '../../src/domain/types';

const line = (over: Partial<CountLine>): CountLine => ({ id: 'l', code: '0417', name: 'Cash', linearQty: 0, stockQty: 0, updatedAt: 0, ...over });
const snap = (id: string, at: number, lines: CountSnapshot['lines'] = [], deleted = false): CountSnapshot => ({ id, at, lines, deleted });

describe('historique du grattage', () => {
  it('clé d’un jeu : son id, sinon son nom sans accents ni majuscules', () => {
    expect(lineKey(line({ gameId: 'f:fdj|X' }))).toBe('f:fdj|X');
    expect(lineKey(line({ name: '  Méga Goal ' }))).toBe('nom:mega goal');
  });
  it('photo du comptage : lignes visibles, triées par nom, quantités et codes', () => {
    const s = takeSnapshot([line({ id: 'b', gameId: 'g2', name: 'Banco', linearQty: 3, stockQty: 30 }), line({ id: 'a', name: 'Astro', linearQty: 1 }), line({ id: 'z', name: 'Supprimée', deleted: true })], 1000, 's1');
    expect(s).toEqual({ id: 's1', at: 1000, lines: [
      { key: 'nom:astro', name: 'Astro', code: '0417', linearQty: 1, stockQty: 0 },
      { key: 'g2', name: 'Banco', code: '0417', linearQty: 3, stockQty: 30 },
    ] });
  });
  it('8 au plus, les plus récents d’abord ; ceux en trop sont les plus anciens', () => {
    const list = Array.from({ length: 10 }, (_, i) => snap(`s${i}`, i * 10)).concat(snap('x', 999, [], true));
    expect(HISTORY_MAX).toBe(8);
    expect(visibleHistory(list).map((s) => s.id)).toEqual(['s9', 's8', 's7', 's6', 's5', 's4', 's3', 's2']);
    expect(overflow(list).map((s) => s.id)).toEqual(['s1', 's0']);
  });
  it('écart avec le précédent : (linéaire + stock) d’un jeu à l’autre, jeu nouveau, total', () => {
    const prev = snap('p', 1, [{ key: 'g1', name: 'Cash', code: '', linearQty: 10, stockQty: 60 }, { key: 'g2', name: 'Astro', code: '', linearQty: 5, stockQty: 0 }]);
    const cur = snap('c', 2, [{ key: 'g1', name: 'Cash', code: '', linearQty: 4, stockQty: 54 }, { key: 'g3', name: 'X10', code: '', linearQty: 2, stockQty: 0 }]);
    const d = snapshotDiff(cur, prev);
    expect(d.byKey.get('g1')).toBe(-12);
    expect(d.byKey.get('g3')).toBe('nouveau');
    expect(d.total).toBe(60 - 75); // 60 tickets maintenant, 75 avant
    expect(snapshotDiff(cur, undefined)).toEqual({ byKey: new Map(), total: undefined });
  });
});
