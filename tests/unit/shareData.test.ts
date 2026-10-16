import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, getSettings, saveSettings, putProduct, patchUserFields } from '../../src/data/db';
import { enqueueContributions, pendingCount, flushOutbox, syncSharedCodes, clearLegacyShareToken } from '../../src/data/sharingData';
import { exportBackupText, restoreFromText } from '../../src/data/backupData';
import type { SharedCodesFile } from '../../src/domain/sharing';
import type { Product } from '../../src/domain/types';

const marlboro: Product = { id: 'm', source: 'douane', douaneRef: 'pmi|marlboro', base: { kind: 'cigarette', name: 'Marlboro' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const RELAY = 'https://la-carotte-relais.example.workers.dev';

/** Faux relais : enregistre les appels et répond avec le code HTTP donné (ou celui que `statusFor` choisit). */
function fakeRelay(status: number | ((items: unknown[]) => number) = 202) {
  const calls: { url: string; init: RequestInit; items: unknown[] }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const items = (JSON.parse(init.body as string) as { items: unknown[] }).items;
    calls.push({ url, init, items });
    const s = typeof status === 'function' ? status(items) : status;
    return new Response(s < 300 ? '{"ok":true}' : '{"erreur":"x"}', { status: s });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const barcode = (n: number, createdAt = n) => ({ kind: 'barcode' as const, code: String(1000000000000 + n), ref: 'pmi|marlboro', createdAt });

describe('file d’attente et envoi', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rattacher un code à une référence officielle le met en attente', async () => {
    await putProduct(marlboro);
    const before = (await db.products.get('m'))!;
    const after = await patchUserFields('m', { barcodes: ['3017620422003'] });
    await enqueueContributions(before, after);
    expect(await pendingCount()).toBe(1);
  });
  it('sans relais configuré : rien n’est envoyé, tout reste en attente', async () => {
    vi.stubEnv('VITE_RELAY_URL', '');
    await db.outbox.add({ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro', createdAt: 1 });
    const relay = fakeRelay();
    expect(await flushOutbox(relay.fn)).toEqual({ sent: 0, status: 'inactif' });
    expect(relay.calls).toHaveLength(0);
    expect(await pendingCount()).toBe(1);
  });
  it('avec relais : un seul envoi vers <relais>/v1/codes, sans clé, puis la file est vidée', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.bulkAdd([
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro', createdAt: 1 },
      { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K', createdAt: 2 },
    ]);
    const relay = fakeRelay();
    expect(await flushOutbox(relay.fn)).toEqual({ sent: 2, status: 'ok' });
    expect(relay.calls).toHaveLength(1);
    expect(relay.calls[0].url).toBe(`${RELAY}/v1/codes`);
    expect(relay.calls[0].init.method).toBe('POST');
    const headers = Object.fromEntries(Object.entries(relay.calls[0].init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    expect(headers).not.toHaveProperty('authorization');
    expect(relay.calls[0].items).toEqual([
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' },
      { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' },
    ]);
    expect(await pendingCount()).toBe(0);
    const s = await getSettings();
    expect(s.shareStatus).toBe('ok');
    expect(s.lastShareAt).toBeGreaterThan(0);
  });
  it('une clé GitHub héritée d’une ancienne version n’est jamais envoyée', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await saveSettings({ shareToken: 'github_pat_VIEUX' });
    await db.outbox.add(barcode(1));
    const relay = fakeRelay();
    await flushOutbox(relay.fn);
    expect(JSON.stringify(relay.calls[0])).not.toContain('github_pat_VIEUX');
  });
  it('plus de 200 codes : envoyés par paquets de 200, dans l’ordre', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.bulkAdd(Array.from({ length: 450 }, (_, i) => barcode(i)));
    const relay = fakeRelay();
    expect(await flushOutbox(relay.fn)).toEqual({ sent: 450, status: 'ok' });
    expect(relay.calls.map((c) => c.items.length)).toEqual([200, 200, 50]);
    expect((relay.calls[0].items[0] as { code: string }).code).toBe('1000000000000');
    expect((relay.calls[2].items[49] as { code: string }).code).toBe('1000000000449');
    expect(await pendingCount()).toBe(0);
  });
  it('trop rempli (429) : la file est gardée, état « erreur », nouvel essai plus tard', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.add(barcode(1));
    expect(await flushOutbox(fakeRelay(429).fn)).toEqual({ sent: 0, status: 'erreur' });
    expect(await pendingCount()).toBe(1);
    expect((await getSettings()).shareStatus).toBe('erreur');
  });
  it('relais en panne (500) : la file est gardée', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.add(barcode(1));
    expect(await flushOutbox(fakeRelay(500).fn)).toEqual({ sent: 0, status: 'erreur' });
    expect(await pendingCount()).toBe(1);
  });
  it('un échec au milieu : les paquets déjà partis sont retirés, les autres restent', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.bulkAdd(Array.from({ length: 250 }, (_, i) => barcode(i)));
    let n = 0;
    const relay = fakeRelay(() => (++n === 1 ? 202 : 503));
    expect(await flushOutbox(relay.fn)).toEqual({ sent: 200, status: 'erreur' });
    expect(await pendingCount()).toBe(50);
    expect(((await db.outbox.orderBy('createdAt').first()) as { code: string }).code).toBe('1000000000200');
  });
  it('pas de réseau : la file est gardée pour plus tard', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.add(barcode(1));
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await flushOutbox(offline)).toEqual({ sent: 0, status: 'hors-ligne' });
    expect(await pendingCount()).toBe(1);
    expect((await getSettings()).shareStatus).toBe('hors-ligne');
  });
  it('paquet refusé comme trop gros (413) : coupé en deux jusqu’à passer', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.bulkAdd(Array.from({ length: 10 }, (_, i) => barcode(i)));
    const relay = fakeRelay((items) => (items.length > 3 ? 413 : 202));
    expect(await flushOutbox(relay.fn)).toEqual({ sent: 10, status: 'ok' });
    expect(await pendingCount()).toBe(0);
    const accepted = relay.calls.filter((c) => c.items.length <= 3).flatMap((c) => c.items.map((i) => (i as { code: string }).code));
    expect(accepted).toEqual(Array.from({ length: 10 }, (_, i) => String(1000000000000 + i)));
  });
  it('un code refusé seul (413 ou 400) est abandonné : il ne bloque pas la file', async () => {
    vi.stubEnv('VITE_RELAY_URL', RELAY);
    await db.outbox.bulkAdd([barcode(1), barcode(2), barcode(3)]);
    const bad = '1000000000002';
    const relay = fakeRelay((items) => ((items as { code: string }[]).some((i) => i.code === bad) ? 400 : 202));
    expect(await flushOutbox(relay.fn)).toEqual({ sent: 2, status: 'ok' });
    expect(await pendingCount()).toBe(0);
  });
});

describe('réception de la liste publique', () => {
  it('applique les codes partagés aux produits officiels', async () => {
    await putProduct(marlboro);
    const file: SharedCodesFile = { version: 'c1', updatedAt: '2026-10-16', barcodes: { '3017620422003': 'pmi|marlboro' }, fdjPrefixes: {} };
    const fetchFile = (async () => new Response(JSON.stringify(file))) as unknown as typeof fetch;
    expect(await syncSharedCodes(fetchFile)).toEqual({ updated: true, version: 'c1' });
    expect((await db.products.get('m'))!.sharedBarcodes).toEqual(['3017620422003']);
    expect(await syncSharedCodes(fetchFile)).toEqual({ updated: false, version: 'c1' });
  });
});

describe('plus aucune clé sur le téléphone', () => {
  it('une clé héritée est effacée au démarrage (et l’ancien état d’envoi avec elle)', async () => {
    await saveSettings({ shareToken: 'github_pat_VIEUX', shareStatus: 'cle-refusee' as never, shopName: 'Tabac' });
    await clearLegacyShareToken();
    const row = (await db.settings.get('main'))! as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty('shareToken');
    expect(row).not.toHaveProperty('shareStatus');
    expect(row.shopName).toBe('Tabac');
    await clearLegacyShareToken(); // sans clé : rien à faire
  });
  it('sans réglages enregistrés : ne crée rien', async () => {
    await clearLegacyShareToken();
    expect(await db.settings.get('main')).toBeUndefined();
  });
  it('la sauvegarde n’en contient pas, et la restauration ne l’écrit pas (même depuis une ancienne sauvegarde)', async () => {
    await saveSettings({ shareToken: 'github_pat_SECRET', shopName: 'Tabac' });
    const text = await exportBackupText(1);
    expect(text).not.toContain('github_pat_SECRET');
    const old = JSON.parse(text);
    old.settings.shareToken = 'github_pat_DANS_UNE_VIEILLE_SAUVEGARDE';
    expect(await restoreFromText(JSON.stringify(old))).toEqual({ ok: true });
    expect((await getSettings()).shareToken).toBeUndefined();
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('github_pat_');
  });
});
