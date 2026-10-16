// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { applyFields, diffFields, type Clocked, type Op } from '../../src/sync/merge.ts';

const t0 = '0000000000000-0000-a';
const t1 = '0000000000001-0000-a';
const t2 = '0000000000002-0000-a';
const t3 = '0000000000003-0000-b';

type Line = { linearQty?: number; stockQty?: number; deleted?: boolean };

describe('applyFields', () => {
  it('garde la valeur la plus récente, quel que soit l\'ordre', () => {
    const a = applyFields<Line>(applyFields<Line>(undefined, { linearQty: 5 }, t1).record, { linearQty: 3 }, t0);
    expect(a.changed).toBe(false);
    expect(a.record.linearQty).toBe(5);
    const b = applyFields<Line>(applyFields<Line>(undefined, { linearQty: 3 }, t0).record, { linearQty: 5 }, t1);
    expect(b.changed).toBe(true);
    expect(b.record).toEqual(a.record);
  });

  it('conserve deux champs différents modifiés par deux opérations concurrentes', () => {
    const x = applyFields<Line>(applyFields<Line>(undefined, { linearQty: 2 }, t1).record, { stockQty: 7 }, t0).record;
    const y = applyFields<Line>(applyFields<Line>(undefined, { stockQty: 7 }, t0).record, { linearQty: 2 }, t1).record;
    expect(x.linearQty).toBe(2);
    expect(x.stockQty).toBe(7);
    expect(y).toEqual(x);
  });

  it('suppression gagne sur plus ancien', () => {
    const del = applyFields<Line>(undefined, { deleted: true }, t2).record;
    const late = applyFields<Line>(del, { linearQty: 9 }, t1);
    expect(late.record.deleted).toBe(true);
    expect(late.record.linearQty).toBe(9);
    // une réécriture plus ancienne de `deleted` ne la lève pas
    expect(applyFields<Line>(late.record, { deleted: false }, t1).record.deleted).toBe(true);
  });

  it('un horodatage égal ne change rien (même opération rejouée)', () => {
    const r1 = applyFields<Line>(undefined, { linearQty: 5 }, t1).record;
    const r2 = applyFields<Line>(r1, { linearQty: 5 }, t1);
    expect(r2.changed).toBe(false);
    const r3 = applyFields<Line>(r1, { linearQty: 8 }, t1);
    expect(r3.changed).toBe(false);
    expect(r3.record.linearQty).toBe(5);
  });

  it('ne modifie pas l\'enregistrement reçu', () => {
    const r1 = applyFields<Line>(undefined, { linearQty: 5 }, t1).record;
    const snapshot = JSON.parse(JSON.stringify(r1));
    const r2 = applyFields<Line>(r1, { linearQty: 6 }, t2).record;
    expect(r1).toEqual(snapshot);
    expect(r2).not.toBe(r1);
  });

  it('écrit user.<champ> dans record.user et horodate la clé complète', () => {
    type P = { user?: { name?: string; tasteTags?: string[] }; outOfStock?: boolean };
    const r = applyFields<P>(undefined, { 'user.name': 'A', outOfStock: true }, t1).record;
    expect(r.user).toEqual({ name: 'A' });
    expect(r.outOfStock).toBe(true);
    expect(r._clock).toEqual({ 'user.name': t1, outOfStock: t1 });
    const older = applyFields<P>(r, { 'user.name': 'Z' }, t0);
    expect(older.changed).toBe(false);
    expect(older.record.user?.name).toBe('A');
  });

  it('user.tasteTags: null efface le champ', () => {
    type P = { user?: { name?: string; tasteTags?: string[] } };
    const r1 = applyFields<P>(undefined, { 'user.tasteTags': ['a', 'b'], 'user.name': 'A' }, t1).record;
    const r2 = applyFields<P>(r1, { 'user.tasteTags': null }, t2);
    expect(r2.changed).toBe(true);
    expect(r2.record.user).toEqual({ name: 'A' });
    expect('tasteTags' in (r2.record.user ?? {})).toBe(false);
    // une valeur plus ancienne ne ressuscite pas le champ effacé
    const r3 = applyFields<P>(r2.record, { 'user.tasteTags': ['x'] }, t0);
    expect(r3.changed).toBe(false);
    expect(r3.record.user?.tasteTags).toBeUndefined();
  });

  it('null efface un champ de premier niveau mais garde son horodatage', () => {
    type P = { outOfStock?: boolean };
    const r1 = applyFields<P>(undefined, { outOfStock: true }, t1).record;
    const r2 = applyFields<P>(r1, { outOfStock: null }, t2).record;
    expect('outOfStock' in r2).toBe(false);
    expect(r2._clock?.outOfStock).toBe(t2);
  });

  it('un null sur un champ inconnu enregistre quand même l\'horodatage', () => {
    const r = applyFields<Line>(undefined, { linearQty: null }, t1);
    expect(r.changed).toBe(true);
    expect(r.record._clock).toEqual({ linearQty: t1 });
  });

  it('ignore les clés dangereuses', () => {
    const r = applyFields<Record<string, unknown>>(undefined, JSON.parse('{"__proto__":{"x":1},"user.__proto__":{"y":1},"ok":1}'), t1);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).y).toBeUndefined();
    expect(r.record.ok).toBe(1);
  });
});

describe('convergence quel que soit l\'ordre', () => {
  // PRNG déterministe (mulberry32)
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T,>(xs: T[], r: () => number) => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const fold = (ops: Op[]) =>
    ops.reduce<Clocked<Record<string, unknown>> | undefined>((rec, op) => applyFields(rec, op.f, op.t).record, undefined);

  for (const seed of [1, 2, 3, 42, 2026]) {
    it(`20 opérations aléatoires donnent le même enregistrement (graine ${seed})`, () => {
      const r = rng(seed);
      const fieldPool: [string, () => unknown][] = [
        ['linearQty', () => Math.floor(r() * 50)],
        ['stockQty', () => Math.floor(r() * 50)],
        ['deleted', () => r() < 0.5],
        ['outOfStock', () => (r() < 0.3 ? null : r() < 0.5)],
        ['user.name', () => `n${Math.floor(r() * 9)}`],
        ['user.tasteTags', () => (r() < 0.3 ? null : ['t' + Math.floor(r() * 5)])],
      ];
      const ops: Op[] = Array.from({ length: 20 }, (_, i) => {
        const f: Record<string, unknown> = {};
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const [key, gen] = fieldPool[Math.floor(r() * fieldPool.length)];
          f[key] = gen();
        }
        // horodatages distincts (appareil a/b) pour un ordre total
        const t = `${String(1000 + Math.floor(r() * 15)).padStart(13, '0')}-${String(i).padStart(4, '0')}-${r() < 0.5 ? 'a' : 'b'}`;
        return { e: 'product', id: 'p', f, t };
      });
      const one = fold(shuffle(ops, r));
      const two = fold(shuffle(ops, r));
      const three = fold(ops.slice().reverse());
      expect(two).toEqual(one);
      expect(three).toEqual(one);
      // rejouer tout une seconde fois ne change rien
      let rec = one;
      let anyChange = false;
      for (const op of ops) {
        const res = applyFields(rec, op.f, op.t);
        rec = res.record;
        anyChange ||= res.changed;
      }
      expect(anyChange).toBe(false);
      expect(rec).toEqual(one);
    });
  }

  it('l\'opération la plus récente d\'appareil différent gagne', () => {
    const r = applyFields<Line>(applyFields<Line>(undefined, { linearQty: 1 }, t2).record, { linearQty: 2 }, t3).record;
    expect(r.linearQty).toBe(2);
  });
});

describe('diffFields', () => {
  it('aplatit user et compare le reste', () => {
    expect(
      diffFields({ user: { name: 'A' }, outOfStock: false }, { user: { name: 'B' }, outOfStock: true }, ['user', 'outOfStock']),
    ).toEqual({ 'user.name': 'B', outOfStock: true });
  });

  it('un champ retiré de user donne null', () => {
    expect(diffFields({ user: { name: 'A', brand: 'X' } }, { user: { name: 'A' } }, ['user'])).toEqual({ 'user.brand': null });
    expect(diffFields({ user: { name: 'A' } }, {}, ['user'])).toEqual({ 'user.name': null });
  });

  it('un champ de premier niveau retiré ou undefined donne null', () => {
    expect(diffFields({ outOfStock: true }, {}, ['outOfStock'])).toEqual({ outOfStock: null });
    expect(diffFields({ outOfStock: true }, { outOfStock: undefined }, ['outOfStock'])).toEqual({ outOfStock: null });
  });

  it('compare les tableaux par valeur', () => {
    const before = { pinnedSubstitutes: ['a', 'b'], user: { tasteTags: ['x'] } };
    const same = { pinnedSubstitutes: ['a', 'b'], user: { tasteTags: ['x'] } };
    expect(diffFields(before, same, ['pinnedSubstitutes', 'user'])).toEqual({});
    const diff = { pinnedSubstitutes: ['a', 'c'], user: { tasteTags: ['x', 'y'] } };
    expect(diffFields(before, diff, ['pinnedSubstitutes', 'user'])).toEqual({
      pinnedSubstitutes: ['a', 'c'],
      'user.tasteTags': ['x', 'y'],
    });
  });

  it('avant indéfini : tous les champs présents sont émis', () => {
    expect(diffFields(undefined, { shopName: 'Tabac', sortCount: 3 }, ['shopName', 'sortCount', 'hiddenGames'])).toEqual({
      shopName: 'Tabac',
      sortCount: 3,
    });
    expect(diffFields(undefined, { user: { name: 'A' } }, ['user'])).toEqual({ 'user.name': 'A' });
  });

  it('ignore les clés non partagées', () => {
    expect(diffFields({ a: 1, _clock: { a: 'x' } }, { a: 2, _clock: { a: 'y' } }, ['b'])).toEqual({});
  });
});
