import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handle, type RelayEnv } from '../../relay/src/handlers';
import { createMemoryStore } from '../../relay/src/memoryStore';
import { CarotteDB } from '../../src/data/db';
import { applyRemoteOps } from '../../src/data/sharedRepo';
import { createRelayClient } from '../../src/sync/relayClient';
import { createSyncEngine, type SyncStatus } from '../../src/sync/engine';
import { deriveChannel, decryptJson, encryptJson, generateTabacKey } from '../../src/sync/crypto';
import type { Op } from '../../src/sync/merge';

const RELAY = 'https://relais.test';
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const hlcAt = (ms: number, c = 0, dev = 'aaaaaaaa') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;
const lineOp = (id: string, f: Record<string, unknown>, t: string): Op => ({ e: 'line', id, f, t });

const phones: CarotteDB[] = [];
function phone(): CarotteDB {
  const d = new CarotteDB(`telephone-${phones.length}-${Math.random().toString(36).slice(2)}`);
  phones.push(d);
  return d;
}

/** Faux relais : le vrai `handle` sur un Store en mémoire (un compteur commun à tous les canaux). */
function fakeRelay() {
  const store = createMemoryStore();
  let t = 1_000_000;
  const env: RelayEnv = {
    store,
    githubRepo: 'wongmichel2048/Buraliste',
    now: () => (t += 1000),
    fetch: (async () => new Response('{}', { status: 201 })) as unknown as typeof fetch,
    allowedOrigins: [],
  };
  const requests: { method: string; path: string; bytes: number }[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    const req = new Request(input, init);
    const body = init?.body ? String(init.body) : '';
    requests.push({ method: req.method, path: new URL(req.url).pathname, bytes: new TextEncoder().encode(body).length });
    return handle(req, env);
  };
  return { store, fetchFn, requests, client: createRelayClient(RELAY, fetchFn) };
}

/** Écriture locale « hors ligne » : appliquée à la base du téléphone et mise dans sa file d'envoi. */
async function localWrite(d: CarotteDB, op: Op) {
  await applyRemoteOps([op], d);
  await d.opsOut.add({ op });
}

/** Tout ce que le relais a stocké pour un canal (messages et photographie), en texte. */
async function stored(store: ReturnType<typeof createMemoryStore>, canal: string) {
  return JSON.stringify([await store.listMessages(canal, 0, 1_000_000), await store.getPhoto(canal)]);
}

const pause = () => new Promise<void>((r) => setImmediate(r));
async function settle(times = 50) {
  for (let i = 0; i < times; i++) await pause();
}

beforeEach(() => {
  localStorage.removeItem('carotte:hlc');
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const d of phones.splice(0)) {
    d.close();
    await d.delete();
  }
});

describe('moteur de synchronisation', () => {
  it('deux moteurs convergent', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const A = phone();
    const B = phone();
    const now = Date.now();
    const full = { code: '0417', name: 'Cash', stockQty: 0, deleted: false };
    await localWrite(A, lineOp('l1', { ...full, linearQty: 5, updatedAt: now }, hlcAt(now - 2000, 0, 'aaaaaaaa')));
    await localWrite(B, lineOp('l1', { ...full, linearQty: 7, updatedAt: now + 1 }, hlcAt(now - 1000, 0, 'bbbbbbbb')));
    const ea = createSyncEngine({ relay: r.client, key, db: A });
    const eb = createSyncEngine({ relay: r.client, key, db: B });

    await ea.syncNow();
    await eb.syncNow();
    await ea.syncNow();

    expect((await A.countLines.get('l1'))!).toMatchObject({ linearQty: 7, name: 'Cash' });
    expect((await B.countLines.get('l1'))!).toMatchObject({ linearQty: 7, name: 'Cash' });
    expect(await A.opsOut.count()).toBe(0);
    expect(await B.opsOut.count()).toBe(0);
    expect(ea.status()).toBe('ok');
    expect(eb.status()).toBe('ok');

    // Le relais ne voit jamais de texte en clair (ni la clé).
    const { canal } = await deriveChannel(key);
    const all = await stored(r.store, canal);
    expect(all.length).toBeGreaterThan(100);
    expect(all.match(/Cash/g)).toBeNull();
    expect(all.match(/0417/g)).toBeNull();
    expect(all.includes(key)).toBe(false);
  });

  it('deux moteurs convergent aussi quand la saisie la plus ancienne arrive en dernier', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const A = phone();
    const B = phone();
    const now = Date.now();
    await localWrite(A, lineOp('l1', { name: 'Cash', linearQty: 5 }, hlcAt(now - 2000, 0, 'aaaaaaaa')));
    await localWrite(B, lineOp('l1', { name: 'Cash', linearQty: 7 }, hlcAt(now - 1000, 0, 'bbbbbbbb')));
    const ea = createSyncEngine({ relay: r.client, key, db: A });
    const eb = createSyncEngine({ relay: r.client, key, db: B });
    await eb.syncNow();
    await ea.syncNow();
    await eb.syncNow();
    expect((await A.countLines.get('l1'))!.linearQty).toBe(7);
    expect((await B.countLines.get('l1'))!.linearQty).toBe(7);
  });

  it('message falsifié ignoré : les messages illisibles sont sautés, les suivants appliqués', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const { canal, ecriture } = await deriveChannel(key);
    const now = Date.now();
    const good1 = await encryptJson(key, { v: 1, ops: [lineOp('l1', { name: 'Un', linearQty: 1 }, hlcAt(now))] });
    const forged = { iv: good1.iv, data: good1.data.slice(0, -6) + 'AAAAAA' };
    const garbage = { iv: '!!', data: 'pas du base64url' };
    const wrongVersion = await encryptJson(key, { v: 2, ops: [lineOp('l3', { name: 'Trois', linearQty: 3 }, hlcAt(now))] });
    const notOps = await encryptJson(key, { v: 1, ops: 'rien' });
    const otherKey = await encryptJson(generateTabacKey(), { v: 1, ops: [lineOp('l4', { name: 'Quatre', linearQty: 4 }, hlcAt(now))] });
    const good2 = await encryptJson(key, { v: 1, ops: [lineOp('l2', { name: 'Deux', linearQty: 2 }, hlcAt(now + 1))] });
    await r.client.post(canal, { ecriture, messages: [good1, forged, garbage, wrongVersion, notOps, otherKey, good2] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const B = phone();
    const eb = createSyncEngine({ relay: r.client, key, db: B });
    await eb.syncNow();

    expect((await B.countLines.get('l1'))!).toMatchObject({ name: 'Un', linearQty: 1 });
    expect((await B.countLines.get('l2'))!).toMatchObject({ name: 'Deux', linearQty: 2 });
    expect(await B.countLines.get('l3')).toBeUndefined();
    expect(await B.countLines.get('l4')).toBeUndefined();
    expect(eb.status()).toBe('ok');
    expect(warn).toHaveBeenCalled();
    expect((await B.syncState.get('lastN'))!.value).toBe(await r.store.lastN(canal));
  });

  it('relais en panne : erreur, file intacte, attente croissante (20 s, 40 s… 5 min) ; ensuite un 200 vide la file', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    let mode: 'ok' | '500' | '429' | 'reseau' = '500';
    const fetchFn: FetchFn = async (input, init) => {
      if (mode === '500') return new Response('{"erreur":"interne"}', { status: 500 });
      if (mode === '429') return new Response('{"erreur":"trop"}', { status: 429 });
      if (mode === 'reseau') throw new TypeError('Failed to fetch');
      return r.fetchFn(input, init);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const A = phone();
    await localWrite(A, lineOp('l1', { name: 'Cash', linearQty: 5 }, hlcAt(Date.now())));
    const e = createSyncEngine({ relay: createRelayClient(RELAY, fetchFn), key, db: A });

    await e.syncNow();
    expect(e.status()).toBe('erreur');
    expect(await A.opsOut.count()).toBe(1);
    expect(e.nextDelayMs()).toBe(20_000);

    mode = '429';
    await e.syncNow();
    expect(e.nextDelayMs()).toBe(40_000);
    mode = 'reseau';
    await e.syncNow();
    expect(e.nextDelayMs()).toBe(80_000);
    mode = '500';
    await e.syncNow();
    await e.syncNow();
    expect(e.nextDelayMs()).toBe(300_000);
    await e.syncNow();
    expect(e.nextDelayMs()).toBe(300_000);
    expect(e.status()).toBe('erreur');
    expect(await A.opsOut.count()).toBe(1);

    mode = 'ok';
    await e.syncNow();
    expect(await A.opsOut.count()).toBe(0);
    expect(e.status()).toBe('ok');
    expect(e.nextDelayMs()).toBeNull();
    const { canal } = await deriveChannel(key);
    expect((await r.store.listMessages(canal, 0, 100)).length).toBe(1);
  });

  it('rejoindre après photographie : un téléphone neuf lit la photographie puis seulement les messages qui suivent', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const { canal, ecriture } = await deriveChannel(key);
    const other = await deriveChannel(generateTabacKey());
    const base = Date.now() - 100_000;
    const msgs = [];
    for (let i = 0; i < 510; i++) {
      msgs.push(await encryptJson(key, { v: 1, ops: [lineOp(`l${i % 30}`, { name: `Jeu ${i % 30}`, linearQty: i }, hlcAt(base + i))] }));
    }
    for (let i = 0; i < msgs.length; i += 170) {
      await r.client.post(canal, { ecriture, messages: msgs.slice(i, i + 170) });
      // un autre tabac écrit entre-temps : les numéros du canal ont des trous
      await r.client.post(other.canal, { ecriture: other.ecriture, messages: [{ iv: 'x', data: 'y' }] });
    }

    const A = phone();
    await createSyncEngine({ relay: r.client, key, db: A }).syncNow();
    const photo = (await r.store.getPhoto(canal))!;
    expect(photo).not.toBeNull();
    expect(photo.jusqua).toBe(await r.store.lastN(canal));
    expect((await A.syncState.get('vusDepuisPhoto'))!.value).toBe(0);

    await r.store.pruneBefore(canal, photo.jusqua, Number.MAX_SAFE_INTEGER);
    expect(await r.store.listMessages(canal, 0, 1000)).toHaveLength(0);
    await r.client.post(canal, { ecriture, messages: [await encryptJson(key, { v: 1, ops: [lineOp('l0', { linearQty: 999 }, hlcAt(base + 5000))] })] });

    const C = phone();
    const before = r.requests.length;
    await createSyncEngine({ relay: r.client, key, db: C }).syncNow();
    const lines = await C.countLines.toArray();
    expect(lines).toHaveLength(30);
    expect((await C.countLines.get('l0'))!.linearQty).toBe(999);
    for (let k = 1; k < 30; k++) {
      const l = (await C.countLines.get(`l${k}`))!;
      expect(l).toMatchObject({ name: `Jeu ${k}`, linearQty: 480 + k });
      // chaque champ garde son propre horodatage (jamais ré-horodaté à la réception)
      expect(l._clock!.linearQty).toBe(hlcAt(base + 480 + k));
    }
    expect((await C.syncState.get('lastN'))!.value).toBe(await r.store.lastN(canal));
    const cRequests = r.requests.slice(before);
    expect(cRequests.filter((q) => q.method === 'GET' && q.path.endsWith('/photo'))).toHaveLength(1);
    expect(cRequests.some((q) => q.method === 'PUT')).toBe(false);
  });

  it('premier partage publie l’état : une base jamais synchronisée publie ses lignes, sans action du gérant', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const A = phone();
    // Données d'avant le partage : sans horodatage, aucune opération en file.
    await A.countLines.bulkPut([
      { id: 'game:f:cash', gameId: 'f:cash', code: '', name: 'Cash', linearQty: 4, stockQty: 10, updatedAt: Date.now() - 60_000 },
      { id: 'm1', code: '123', name: 'Astro', linearQty: 1, stockQty: 0, updatedAt: Date.now() - 50_000 },
      { id: 'm2', code: '456', name: 'Goal', linearQty: 0, stockQty: 2, updatedAt: Date.now() - 40_000, deleted: true },
    ]);
    await A.settings.put({ key: 'main', shopName: 'Tabac du Port', sortCount: 'updatedAt', shareToken: 'secret' } as never);
    await createSyncEngine({ relay: r.client, key, db: A }).syncNow();
    const { canal } = await deriveChannel(key);
    expect(await r.store.getPhoto(canal)).not.toBeNull();
    expect((await stored(r.store, canal)).includes('Astro')).toBe(false);

    const C = phone();
    await createSyncEngine({ relay: r.client, key, db: C }).syncNow();
    expect(await C.countLines.count()).toBe(3);
    expect((await C.countLines.get('game:f:cash'))!).toMatchObject({ gameId: 'f:cash', name: 'Cash', linearQty: 4, stockQty: 10 });
    expect((await C.countLines.get('m1'))!).toMatchObject({ code: '123', name: 'Astro', linearQty: 1 });
    expect((await C.countLines.get('m2'))!).toMatchObject({ name: 'Goal', deleted: true });
    const s = (await C.settings.get('main'))! as unknown as Record<string, unknown>;
    expect(s).toMatchObject({ shopName: 'Tabac du Port', sortCount: 'updatedAt' });
    expect(s.shareToken).toBeUndefined();
  });

  it('un téléphone sans données ne publie pas de photographie sur un canal vide', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    await createSyncEngine({ relay: r.client, key, db: phone() }).syncNow();
    expect(r.requests.some((q) => q.method === 'PUT')).toBe(false);
  });

  it('rejoindre une photographie ne défait pas des comptages locaux d’avant le partage plus récents', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const J = phone();
    const old = Date.now() - 3_600_000;
    await localWrite(J, lineOp('game:f:cash', { gameId: 'f:cash', name: 'Cash', linearQty: 0, stockQty: 0, updatedAt: old }, hlcAt(old)));
    await createSyncEngine({ relay: r.client, key, db: J }).syncNow();
    expect(await r.store.getPhoto((await deriveChannel(key)).canal)).not.toBeNull();

    const P = phone();
    await P.countLines.put({ id: 'game:f:cash', gameId: 'f:cash', code: '', name: 'Cash', linearQty: 8, stockQty: 3, updatedAt: Date.now() - 1000 });
    await createSyncEngine({ relay: r.client, key, db: P }).syncNow();
    expect((await P.countLines.get('game:f:cash'))!).toMatchObject({ linearQty: 8, stockQty: 3 });
  });

  it('accès refusé : 403 → « refuse », plus aucune tentative, données locales gardées', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const { canal } = await deriveChannel(key);
    await r.store.createChannel(canal, 'empreinte-d-une-autre-cle-d-ecriture', 0);
    const A = phone();
    await localWrite(A, lineOp('l1', { name: 'Cash', linearQty: 5 }, hlcAt(Date.now())));
    let calls = 0;
    const fetchFn: FetchFn = (input, init) => {
      calls++;
      return r.fetchFn(input, init);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const e = createSyncEngine({ relay: createRelayClient(RELAY, fetchFn), key, db: A, intervalMs: 1000 });
    e.start();
    await e.syncNow();
    expect(e.status()).toBe('refuse');
    expect(e.nextDelayMs()).toBeNull();
    const after = calls;
    window.dispatchEvent(new Event('carotte:ops-queued'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(calls).toBe(after);
    expect(await A.opsOut.count()).toBe(1);
    expect((await A.countLines.get('l1'))!.linearQty).toBe(5);
    e.stop();
  });

  it('envoi : au plus 200 opérations par message et un corps de moins de 60 000 octets ; une opération ajoutée pendant l’envoi reste en file', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const A = phone();
    const now = Date.now();
    const filler = 'x'.repeat(300);
    for (let i = 0; i < 450; i++) await A.opsOut.add({ op: lineOp(`l${i}`, { name: `Ligne ${i} ${filler}`, linearQty: i }, hlcAt(now, i)) });
    let injected = false;
    const fetchFn: FetchFn = async (input, init) => {
      if (!injected && init?.method === 'POST') {
        injected = true;
        await A.opsOut.add({ op: lineOp('tard', { name: 'Tard', linearQty: 1 }, hlcAt(now + 1)) });
      }
      return r.fetchFn(input, init);
    };
    const e = createSyncEngine({ relay: createRelayClient(RELAY, fetchFn), key, db: A });
    await e.syncNow();

    const posts = r.requests.filter((q) => q.method === 'POST');
    expect(posts.length).toBeGreaterThan(2);
    for (const p of posts) expect(p.bytes).toBeLessThanOrEqual(60_000);
    const { canal } = await deriveChannel(key);
    const sent: Op[] = [];
    for (const m of await r.store.listMessages(canal, 0, 10_000)) {
      const body = (await decryptJson(key, m)) as { v: number; ops: Op[] };
      expect(body.v).toBe(1);
      expect(body.ops.length).toBeLessThanOrEqual(200);
      sent.push(...body.ops);
    }
    expect(sent.slice(0, 450).map((o) => o.id)).toEqual(Array.from({ length: 450 }, (_, i) => `l${i}`));
    // l'opération ajoutée pendant le premier envoi part à la suite (ou reste en file), jamais perdue
    expect(sent.some((o) => o.id === 'tard') || (await A.opsOut.count()) === 1).toBe(true);
    await e.syncNow();
    expect(await A.opsOut.count()).toBe(0);
  });

  it('photographie au-delà de 500 messages vus ; 409 (déjà publiée par un autre téléphone) compte comme publiée', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const { canal, ecriture } = await deriveChannel(key);
    const A = phone();
    const e = createSyncEngine({ relay: r.client, key, db: A });
    await e.syncNow();
    // un autre téléphone a déjà publié une photographie plus avancée
    await r.client.putPhoto(canal, { ecriture, jusqua: 1_000_000_000, ...(await encryptJson(key, { v: 1, etat: {} })) });
    const msgs = [];
    for (let i = 0; i < 501; i++) msgs.push(await encryptJson(key, { v: 1, ops: [lineOp('l1', { name: 'Cash', linearQty: i }, hlcAt(Date.now() - 10_000 + i))] }));
    for (let i = 0; i < msgs.length; i += 200) await r.client.post(canal, { ecriture, messages: msgs.slice(i, i + 200) });
    const puts = () => r.requests.filter((q) => q.method === 'PUT').length;
    const before = puts();
    await e.syncNow();
    expect(puts()).toBe(before + 1);
    expect(e.status()).toBe('ok');
    expect((await A.syncState.get('vusDepuisPhoto'))!.value).toBe(0);
    expect((await r.store.getPhoto(canal))!.jusqua).toBe(1_000_000_000);
    await e.syncNow();
    expect(puts()).toBe(before + 1);
  });

  it('syncNow ne lance jamais deux synchronisations à la fois', async () => {
    const r = fakeRelay();
    const e = createSyncEngine({ relay: r.client, key: generateTabacKey(), db: phone() });
    const p1 = e.syncNow();
    const p2 = e.syncNow();
    expect(p2).toBe(p1);
    await p1;
  });

  it('déclencheurs : immédiat, toutes les intervalMs si visible, 2 s après carotte:ops-queued, au retour du réseau ; statut émis ; stop arrête tout', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    const A = phone();
    let visibility = 'visible';
    let online = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    const statuses: SyncStatus[] = [];
    const onStatus = (ev: Event) => statuses.push((ev as CustomEvent<SyncStatus>).detail);
    window.addEventListener('carotte:sync-status', onStatus);
    const pulls = () => r.requests.filter((q) => q.method === 'GET' && q.path.endsWith('/messages')).length;
    const postsCount = () => r.requests.filter((q) => q.method === 'POST').length;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      const e = createSyncEngine({ relay: r.client, key, db: A, intervalMs: 10_000 });
      e.start();
      await e.syncNow(); // la synchronisation immédiate, en cours
      expect(pulls()).toBeGreaterThan(0);
      expect(e.status()).toBe('ok');

      let n = pulls();
      await vi.advanceTimersByTimeAsync(10_000);
      await e.syncNow();
      expect(pulls()).toBe(n + 1);

      visibility = 'hidden';
      n = pulls();
      await vi.advanceTimersByTimeAsync(30_000);
      await settle();
      expect(pulls()).toBe(n);
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await e.syncNow();
      expect(pulls()).toBe(n + 1);

      await A.opsOut.add({ op: lineOp('l1', { name: 'Cash', linearQty: 1 }, hlcAt(Date.now())) });
      window.dispatchEvent(new Event('carotte:ops-queued'));
      expect(e.status()).toBe('attente');
      const p = postsCount();
      await vi.advanceTimersByTimeAsync(1_999);
      await settle();
      expect(postsCount()).toBe(p);
      await vi.advanceTimersByTimeAsync(1);
      await e.syncNow();
      expect(postsCount()).toBe(p + 1);
      expect(e.status()).toBe('ok');

      online = false;
      window.dispatchEvent(new Event('offline'));
      expect(e.status()).toBe('hors-ligne');
      n = pulls();
      await vi.advanceTimersByTimeAsync(30_000);
      await settle();
      expect(pulls()).toBe(n);
      online = true;
      window.dispatchEvent(new Event('online'));
      await e.syncNow();
      expect(pulls()).toBe(n + 1);
      expect(e.status()).toBe('ok');

      e.stop();
      n = pulls();
      window.dispatchEvent(new Event('carotte:ops-queued'));
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(60_000);
      await settle();
      expect(pulls()).toBe(n);
      expect(statuses).toEqual(expect.arrayContaining(['ok', 'attente', 'hors-ligne']));
      for (let i = 1; i < statuses.length; i++) expect(statuses[i]).not.toBe(statuses[i - 1]);
    } finally {
      window.removeEventListener('carotte:sync-status', onStatus);
      delete (document as unknown as Record<string, unknown>).visibilityState;
      delete (navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it('après un échec, une nouvelle tentative est programmée au délai annoncé', async () => {
    const key = generateTabacKey();
    const r = fakeRelay();
    let down = true;
    const fetchFn: FetchFn = async (input, init) => (down ? new Response('{}', { status: 503 }) : r.fetchFn(input, init));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const A = phone();
    await localWrite(A, lineOp('l1', { name: 'Cash', linearQty: 5 }, hlcAt(Date.now())));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      const e = createSyncEngine({ relay: createRelayClient(RELAY, fetchFn), key, db: A, intervalMs: 1_000 });
      e.start();
      await e.syncNow();
      expect(e.status()).toBe('erreur');
      expect(e.nextDelayMs()).toBe(20_000);
      down = false;
      // ni l'intervalle ni une nouvelle écriture ne relancent pendant l'attente
      window.dispatchEvent(new Event('carotte:ops-queued'));
      await vi.advanceTimersByTimeAsync(19_000);
      await settle();
      expect(await A.opsOut.count()).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await e.syncNow();
      expect(await A.opsOut.count()).toBe(0);
      expect(e.status()).toBe('ok');
      e.stop();
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});
