import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/data/db';
import { applyRemoteOps, replayParkedOps, PARKED_MAX, PARKED_MAX_AGE_MS } from '../../src/data/sharedRepo';
import { syncFdjGames, syncReferences } from '../../src/data/referencesSync';
import { resetClockForTests } from '../../src/sync/clock';
import type { ReferenceFile } from '../../src/domain/catalog';
import type { FdjGamesFile } from '../../src/domain/fdj';
import type { Op } from '../../src/sync/merge';

const hlcAt = (ms: number, c = 0, dev = 'bbbbbbbb') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;
const fetchOf = (f: unknown) => (async () => new Response(JSON.stringify(f))) as unknown as typeof fetch;
const item = (ref: string, name: string, over: Partial<ReferenceFile['items'][number]> = {}) =>
  ({ ref, kind: 'cigarette', name, manufacturer: 'A', price: 12, status: 'inchange', ...over }) as ReferenceFile['items'][number];
const refs = (version: string, items: ReferenceFile['items']): ReferenceFile => ({ version, effectiveDate: '2026-11-01', source: 'test', items });
const fdjFile = (version: string, items: FdjGamesFile['items']): FdjGamesFile => ({ version, fetchedAt: '2026-10-16', source: 't', items });
const op = (id: string, f: Record<string, unknown>, ms = Date.now()): Op => ({ e: 'product', id, f, t: hlcAt(ms) });

beforeEach(async () => {
  localStorage.removeItem('carotte:hlc');
  localStorage.removeItem('carotte:device');
  resetClockForTests();
  vi.stubEnv('VITE_RELAY_URL', 'https://relais.example.workers.dev');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await db.delete();
  await db.open();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('opérations en attente (produit inconnu ici)', () => {
  it('une opération pour une référence Douane pas encore reçue ici est gardée, puis appliquée quand la liste l’apporte', async () => {
    await syncReferences(fetchOf(refs('v1', [item('a|1', 'Un')])));
    // un autre téléphone, avec une liste plus récente, met « a|2 » en rupture
    expect(await applyRemoteOps([op('d:a|2', { outOfStock: true, 'user.notes': 'vu' })])).toBe(0);
    expect(await db.products.get('d:a|2')).toBeUndefined();
    expect(await db.parkedOps.count()).toBe(1);
    await syncReferences(fetchOf(refs('v2', [item('a|1', 'Un'), item('a|2', 'Deux')])));
    expect((await db.products.get('d:a|2'))!).toMatchObject({ outOfStock: true, user: { notes: 'vu' } });
    expect(await db.parkedOps.count()).toBe(0);
    // rien n'est renvoyé aux autres téléphones (l'opération vient déjà du canal)
    expect(await db.opsOut.count()).toBe(0);
  });

  it('une opération plus ancienne que la valeur saisie ici ne l’écrase pas au moment où elle est rejouée', async () => {
    await syncReferences(fetchOf(refs('v1', [item('a|1', 'Un')])));
    await applyRemoteOps([op('d:a|2', { outOfStock: true }, Date.now() - 60_000)]);
    await syncReferences(fetchOf(refs('v2', [item('a|1', 'Un'), item('a|2', 'Deux')])));
    await applyRemoteOps([op('d:a|2', { outOfStock: false }, Date.now())]);
    await replayParkedOps();
    expect((await db.products.get('d:a|2'))!.outOfStock).toBe(false);
  });

  it('renommage Douane : fiche encore sous l’ancienne référence ici, opération reçue pour la nouvelle', async () => {
    await syncReferences(fetchOf(refs('v1', [item('a|1', 'Un')])));
    await applyRemoteOps([op('d:a|1bis', { outOfStock: true })]);
    expect(await db.parkedOps.count()).toBe(1);
    await syncReferences(fetchOf(refs('v2', [item('a|1bis', 'Un', { previousRef: 'a|1' })])));
    expect(await db.products.get('d:a|1')).toBeUndefined();
    expect((await db.products.get('d:a|1bis'))!.outOfStock).toBe(true);
    expect(await db.parkedOps.count()).toBe(0);
  });

  it('renommage Douane : nouvelle liste déjà ici, opération reçue d’un téléphone resté sur l’ancienne référence', async () => {
    await syncReferences(fetchOf(refs('v2', [item('a|1bis', 'Un', { previousRef: 'a|1' })])));
    await applyRemoteOps([op('d:a|1', { outOfStock: true, pinnedSubstitutes: ['d:a|1'] })]);
    expect(await db.parkedOps.count()).toBe(1);
    // même version de la liste : les opérations en attente sont quand même rejouées, avec les renommages de la liste
    expect(await syncReferences(fetchOf(refs('v2', [item('a|1bis', 'Un', { previousRef: 'a|1' })])))).toEqual({ updated: false, version: 'v2' });
    expect((await db.products.get('d:a|1bis'))!).toMatchObject({ outOfStock: true, pinnedSubstitutes: ['d:a|1bis'] });
    expect(await db.products.get('d:a|1')).toBeUndefined();
    expect(await db.parkedOps.count()).toBe(0);
  });

  it('jeu FDJ pas encore dans la liste ici : appliqué quand la liste FDJ l’apporte (y compris à un jeu de départ repris)', async () => {
    await db.products.put({ id: 'depart:cash', source: 'depart', base: { kind: 'jeu-fdj', name: 'Cash' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 });
    await applyRemoteOps([op('f:fdj|ITGC9K', { outOfStock: true }), op('f:fdj|GOAL01', { 'user.fdjPrefix': '0418' })]);
    expect(await db.parkedOps.count()).toBe(2);
    await syncFdjGames(fetchOf(fdjFile('f1', [
      { ref: 'fdj|ITGC9K', fdjId: 'ITGC9K', name: 'CASH', ticketPrice: 5, maxPrize: 500000, isNew: false },
      { ref: 'fdj|GOAL01', fdjId: 'GOAL01', name: 'Goal', ticketPrice: 2, maxPrize: 20000, isNew: false },
    ])));
    expect((await db.products.get('f:fdj|ITGC9K'))!.outOfStock).toBe(true);
    expect((await db.products.get('f:fdj|GOAL01'))!.user.fdjPrefix).toBe('0418');
    expect(await db.parkedOps.count()).toBe(0);
  });

  it('les ids des opérations en attente suivent la normalisation des ids (même table des ids)', async () => {
    // fiche d'avant les ids stables (id au hasard) ; une opération en attente la désigne comme remplaçant
    await db.products.put({ id: 'rnd', source: 'douane', douaneRef: 'a|1', base: { kind: 'cigarette', name: 'Un' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 1 });
    await applyRemoteOps([op('d:a|2', { pinnedSubstitutes: ['rnd'] })]);
    expect(await db.parkedOps.count()).toBe(1);
    await syncReferences(fetchOf(refs('v1', [item('a|1', 'Un'), item('a|2', 'Deux')])));
    expect(await db.products.get('rnd')).toBeUndefined();
    expect((await db.products.get('d:a|2'))!.pinnedSubstitutes).toEqual(['d:a|1']);
  });

  it('au plus PARKED_MAX opérations en attente : les plus anciennes partent', async () => {
    expect(PARKED_MAX).toBe(5000);
    const ops = Array.from({ length: PARKED_MAX + 3 }, (_, i) => op('d:inconnu|' + i, { outOfStock: true }));
    await applyRemoteOps(ops);
    expect(await db.parkedOps.count()).toBe(PARKED_MAX);
    const first = (await db.parkedOps.orderBy('seq').first())!;
    expect(first.op.id).toBe('d:inconnu|3');
  });

  it('une opération en attente depuis plus de 60 jours est abandonnée', async () => {
    expect(PARKED_MAX_AGE_MS).toBe(60 * 24 * 3_600_000);
    const now = Date.now();
    await db.parkedOps.bulkAdd([
      { op: op('d:vieux|1', { outOfStock: true }), at: now - PARKED_MAX_AGE_MS - 1 },
      { op: op('d:recent|1', { outOfStock: true }), at: now - 1000 },
    ]);
    await replayParkedOps();
    expect((await db.parkedOps.toArray()).map((r) => [r.op.id, r.at])).toEqual([['d:recent|1', now - 1000]]);
  });
});
