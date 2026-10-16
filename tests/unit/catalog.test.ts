import { describe, it, expect } from 'vitest';
import { currentPrice, officialState, mergeReferences, effectiveFields, type ReferenceFile, type RefItem } from '../../src/domain/catalog';
import type { Product } from '../../src/domain/types';

const item = (ref: string, over: Partial<RefItem> = {}): RefItem => ({
  ref, kind: 'cigarette', name: ref, manufacturer: 'FAB', price: 13, status: 'inchange', ...over,
});
const file = (items: RefItem[], effectiveDate = '2026-11-01'): ReferenceFile => ({ version: 'v1', effectiveDate, source: 'test', items });

describe('currentPrice / officialState', () => {
  const f = { kind: 'cigarette' as const, name: 'x', price: 13, previousPrice: 12.5, effectiveDate: '2026-11-01' };
  it('ancien prix avant la date d’effet, nouveau ensuite', () => {
    expect(currentPrice(f, new Date('2026-10-31T12:00:00'))).toBe(12.5);
    expect(currentPrice(f, new Date('2026-11-01T08:00:00'))).toBe(13);
  });
  it('sans previousPrice, toujours price', () => {
    expect(currentPrice({ ...f, previousPrice: undefined }, new Date('2026-10-01'))).toBe(13);
  });
  it('nouveau avant la date : bientot ; retrait après : retire', () => {
    expect(officialState({ ...f, status: 'nouveau' }, new Date('2026-10-20'))).toBe('bientot');
    expect(officialState({ ...f, status: 'nouveau' }, new Date('2026-11-02'))).toBe('actif');
    expect(officialState({ ...f, status: 'retrait' }, new Date('2026-10-20'))).toBe('actif');
    expect(officialState({ ...f, status: 'retrait' }, new Date('2026-11-01T09:00:00'))).toBe('retire');
  });
});

describe('mergeReferences', () => {
  const existing: Product = {
    id: 'p1', source: 'douane', douaneRef: 'fab|a', outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
    base: { kind: 'cigarette', name: 'a', price: 12, status: 'inchange' },
    user: { tasteTags: ['doux'], barcodes: ['3017620422003'] },
  };
  it('remplace base et garde user intact', () => {
    const ops = mergeReferences([existing], file([item('fab|a', { name: 'a', price: 13 })]), [], 1);
    expect(ops.put).toHaveLength(1);
    expect(ops.put[0].base.price).toBe(13);
    expect(ops.put[0].user).toEqual(existing.user);
    expect(ops.put[0].id).toBe('p1');
  });
  it('crée les nouvelles références', () => {
    const ops = mergeReferences([], file([item('fab|b')]), [], 1);
    expect(ops.put[0]).toMatchObject({ id: 'd:fab|b', source: 'douane', douaneRef: 'fab|b', base: { name: 'fab|b', effectiveDate: '2026-11-01' } });
  });
  it('suit un renommage via previousRef', () => {
    const ops = mergeReferences([existing], file([item('fab|a2', { previousRef: 'fab|a', name: 'a2' })]), [], 1);
    expect(ops.put).toHaveLength(1);
    expect(ops.put[0]).toMatchObject({ id: 'p1', douaneRef: 'fab|a2', base: { name: 'a2' } });
  });
  it('ne supprime pas une référence absente : la marque retrait', () => {
    const ops = mergeReferences([existing], file([]), [], 1);
    expect(ops.put[0].base.status).toBe('retrait');
    expect(ops.put[0].user).toEqual(existing.user);
  });
  it('enrichit base avec depart', () => {
    const ops = mergeReferences([], file([item('fab|c')]), [{ ref: 'fab|c', origin: 'France', strength: 3, tasteTags: ['corsé'] }], 1);
    expect(ops.put[0].base).toMatchObject({ origin: 'France', strength: 3, tasteTags: ['corsé'] });
  });
  it('ne touche jamais aux produits utilisateur ou depart hors Douane', () => {
    const mine: Product = { ...existing, id: 'u', source: 'utilisateur', douaneRef: undefined };
    const fdj: Product = { ...existing, id: 'g', source: 'depart', douaneRef: undefined, base: { kind: 'jeu-fdj', name: 'Cash' } };
    const ops = mergeReferences([mine, fdj], file([]), [], 1);
    expect(ops.put).toHaveLength(0);
  });
  it('est idempotent', () => {
    const f = file([item('fab|a', { price: 13 }), item('fab|z')]);
    const first = mergeReferences([existing], f, [], 1);
    const second = mergeReferences(first.put, f, [], 2);
    expect(second.put).toHaveLength(0);
    expect(second.unchanged).toBe(2);
  });
  it('un produit renommé garde ses estimations de départ (previousRef)', () => {
    const ops = mergeReferences([], file([item('fab|neuf', { previousRef: 'fab|ancien' })]), [{ ref: 'fab|ancien', strength: 4, tasteTags: ['corsé'] }], 1);
    expect(ops.put[0].base).toMatchObject({ strength: 4, tasteTags: ['corsé'] });
  });
  it('un prix saisi par le buraliste s’affiche tout de suite, même avant la date d’effet', () => {
    const p: Product = { ...existing, base: { kind: 'cigarette', name: 'a', price: 13, previousPrice: 12.5, effectiveDate: '2026-11-01' }, user: { price: 14 } };
    expect(currentPrice(effectiveFields(p), new Date('2026-10-20T12:00:00'))).toBe(14);
  });
  it('effectiveFields est réexporté', () => {
    expect(effectiveFields(existing).tasteTags).toEqual(['doux']);
  });
});
