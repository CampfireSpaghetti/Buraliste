import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CarotteDB, db, REJOIN_ASKED, deviceKeys, ensureMember, listMembers, markRemoved, setMyName, setRole } from '../../src/data/db';
import { applyRemoteOps } from '../../src/data/sharedRepo';
import { buildEtat } from '../../src/sync/snapshot';
import { resetClockForTests } from '../../src/sync/clock';

const RELAY = 'https://relais.example.workers.dev';
const hlcAt = (ms: number, c = 0, dev = 'zzzzzzzz') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;

beforeEach(async () => {
  localStorage.removeItem('carotte:hlc');
  localStorage.setItem('carotte:device', 'moi12345');
  resetClockForTests();
  vi.stubEnv('VITE_RELAY_URL', RELAY);
  await db.delete();
  await db.open();
});
afterEach(() => vi.unstubAllEnvs());

describe('téléphones du tabac : base', () => {
  it('ce téléphone : clés créées une fois, membre publié avec sa clé publique ; dernière activité au plus tous les quarts d’heure', async () => {
    const k = await deviceKeys();
    expect(await deviceKeys()).toEqual(k);
    const me = await ensureMember('  Julie  ', 1_000_000);
    expect(me).toMatchObject({ id: 'moi12345', name: 'Julie', role: 'employe', pub: k.pub, lastSeen: 1_000_000 });
    await db.opsOut.clear();
    await ensureMember('Autre', 1_000_000 + 60_000); // ni nom remplacé, ni activité avant 15 min
    expect(await db.opsOut.count()).toBe(0);
    await ensureMember('', 1_000_000 + 16 * 60_000);
    expect((await listMembers())[0].lastSeen).toBe(1_000_000 + 16 * 60_000);
    expect(JSON.stringify(await buildEtat(db))).not.toContain(JSON.stringify(k.priv).slice(10, 40)); // clé privée jamais publiée
  });
  it('nom, rôle, retrait (partagés)', async () => {
    await ensureMember();
    await setMyName('Ali');
    await setRole('moi12345', 'gerant');
    expect((await listMembers())[0]).toMatchObject({ name: 'Ali', role: 'gerant' });
    await markRemoved('moi12345');
    expect((await listMembers())[0].removed).toBe(true);
    const ops = (await db.opsOut.toArray()).map((r) => r.op);
    expect(ops.every((o) => o.e === 'member')).toBe(true);
  });
  it('membre reçu d’un autre téléphone ; rôle inconnu ignoré', async () => {
    const now = Date.now();
    await applyRemoteOps([{ e: 'member', id: 'autre', f: { name: 'Karim', role: 'gerant', pub: 'abc', joinedAt: 1, lastSeen: 2 }, t: hlcAt(now - 2000) }]);
    await applyRemoteOps([{ e: 'member', id: 'autre', f: { role: 'patron' }, t: hlcAt(now - 1000) }]);
    expect(await listMembers()).toEqual([{ id: 'autre', name: 'Karim', role: 'gerant', pub: 'abc', joinedAt: 1, lastSeen: 2 }]);
  });
  it('mise à niveau v10 d’une base déjà synchronisée : le téléphone rejoindra le canal', async () => {
    const name = 'la-carotte-v9-synchro';
    const old = new Dexie(name);
    old.version(9).stores({
      products: 'id, douaneRef, source, updatedAt', countLines: 'id, gameId, updatedAt', settings: 'key', outbox: '++id, createdAt',
      opsOut: '++seq', syncState: 'key', parkedOps: '++seq, at', tasks: 'id', sections: 'id', countHistory: 'id, at',
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
