import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CarotteDB, db, REJOIN_ASKED, deleteSnapshot, listHistory, putSnapshots, saveSnapshot, upsertCountLine } from '../../src/data/db';
import { applyRemoteOps } from '../../src/data/sharedRepo';
import { buildEtat, hasLocalData } from '../../src/sync/snapshot';
import { resetClockForTests } from '../../src/sync/clock';

const RELAY = 'https://relais.example.workers.dev';
const hlcAt = (ms: number, c = 0, dev = 'zzzzzzzz') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;

beforeEach(async () => {
  localStorage.removeItem('carotte:hlc');
  resetClockForTests();
  vi.stubEnv('VITE_RELAY_URL', RELAY);
  await db.delete();
  await db.open();
});
afterEach(() => vi.unstubAllEnvs());

describe('historique du grattage : base', () => {
  it('« Fin comptage » enregistre le tableau (partagé) ; le tableau n’est pas touché', async () => {
    await upsertCountLine({ id: 'game:g1', gameId: 'g1', code: '0417', name: 'Cash', linearQty: 4, stockQty: 30, updatedAt: 0 });
    await db.opsOut.clear();
    const { snapshot, pruned } = await saveSnapshot(5_000);
    expect(pruned).toEqual([]);
    expect(snapshot.lines).toEqual([{ key: 'g1', name: 'Cash', code: '0417', linearQty: 4, stockQty: 30 }]);
    expect(await listHistory()).toEqual([{ ...snapshot, deleted: false }].map(({ deleted: _d, ...s }) => s));
    const ops = (await db.opsOut.toArray()).map((r) => r.op);
    expect(ops).toEqual([expect.objectContaining({ e: 'snapshot', id: snapshot.id, f: expect.objectContaining({ at: 5_000 }) })]);
    expect(await hasLocalData(db)).toBe(true);
    expect((await buildEtat(db)).snapshot).toHaveLength(1);
  });
  it('8 au plus : le 9e supprime le plus ancien ; « Annuler » le rend', async () => {
    for (let i = 1; i <= 8; i++) await saveSnapshot(i * 1000);
    const { snapshot, pruned } = await saveSnapshot(9_000);
    expect(pruned.map((s) => s.at)).toEqual([1000]);
    expect((await listHistory()).map((s) => s.at)).toEqual([9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000]);
    await putSnapshots([{ ...snapshot, deleted: true }, ...pruned]);
    expect((await listHistory()).map((s) => s.at)).toEqual([8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000]);
  });
  it('supprimer puis annuler', async () => {
    const { snapshot } = await saveSnapshot(1000);
    const removed = await deleteSnapshot(snapshot.id);
    expect(await listHistory()).toEqual([]);
    await putSnapshots([removed]);
    expect((await listHistory()).map((s) => s.id)).toEqual([snapshot.id]);
  });
  it('comptage reçu d’un autre téléphone ; lignes de mauvais type ignorées', async () => {
    const now = Date.now();
    await applyRemoteOps([{ e: 'snapshot', id: 's1', f: { at: 42, lines: [{ key: 'g1', name: 'Cash', code: '', linearQty: 1, stockQty: 2 }], deleted: false }, t: hlcAt(now - 2000) }]);
    await applyRemoteOps([{ e: 'snapshot', id: 's1', f: { lines: [{ key: 'g1', name: 'Cash', linearQty: 'beaucoup' }] }, t: hlcAt(now - 1000) }]);
    expect(await listHistory()).toEqual([{ id: 's1', at: 42, lines: [{ key: 'g1', name: 'Cash', code: '', linearQty: 1, stockQty: 2 }], deleted: false }]);
  });
  it('mise à niveau v9 d’une base déjà synchronisée : le téléphone rejoindra le canal', async () => {
    const name = 'la-carotte-v8-synchro';
    const old = new Dexie(name);
    old.version(8).stores({
      products: 'id, douaneRef, source, updatedAt', countLines: 'id, gameId, updatedAt', settings: 'key',
      outbox: '++id, createdAt', opsOut: '++seq', syncState: 'key', parkedOps: '++seq, at', tasks: 'id', sections: 'id',
    });
    await old.open();
    await old.table('syncState').put({ key: 'lastN', value: 3 });
    old.close();
    const up = new CarotteDB(name);
    await up.open();
    expect(up.verno).toBe(10);
    expect((await up.syncState.get(REJOIN_ASKED))?.value).toBe(true);
    up.close();
    await up.delete();
  });
});
