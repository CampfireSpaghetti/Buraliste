import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, getSettings, saveSettings, putProduct, patchUserFields } from '../../src/data/db';
import { enqueueContributions, pendingCount, flushOutbox, syncSharedCodes, GITHUB_REPO } from '../../src/data/sharingData';
import { exportBackupText, restoreFromText } from '../../src/data/backupData';
import { parseIssueBody, type SharedCodesFile } from '../../src/domain/sharing';
import type { Product } from '../../src/domain/types';

const marlboro: Product = { id: 'm', source: 'douane', douaneRef: 'pmi|marlboro', base: { kind: 'cigarette', name: 'Marlboro' }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function fakeGitHub(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('file d’attente et envoi', () => {
  it('rattacher un code à une référence officielle le met en attente', async () => {
    await putProduct(marlboro);
    const before = (await db.products.get('m'))!;
    const after = await patchUserFields('m', { barcodes: ['3017620422003'] });
    await enqueueContributions(before, after);
    expect(await pendingCount()).toBe(1);
  });
  it('sans clé : rien n’est envoyé, tout reste en attente', async () => {
    await db.outbox.add({ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro', createdAt: 1 });
    const gh = fakeGitHub();
    expect(await flushOutbox(gh.fn)).toEqual({ sent: 0, status: 'inactif' });
    expect(gh.calls).toHaveLength(0);
    expect(await pendingCount()).toBe(1);
  });
  it('avec clé : un seul message regroupe les codes, puis la file est vidée', async () => {
    await saveSettings({ shareToken: 'github_pat_X' });
    await db.outbox.bulkAdd([
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro', createdAt: 1 },
      { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K', createdAt: 2 },
    ]);
    const gh = fakeGitHub();
    expect(await flushOutbox(gh.fn)).toEqual({ sent: 2, status: 'ok' });
    expect(gh.calls[0].url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/issues`);
    expect((gh.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer github_pat_X');
    const body = JSON.parse(gh.calls[0].init.body as string);
    expect(parseIssueBody(body.body)).toEqual([
      { kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro' },
      { kind: 'fdjPrefix', prefix: '0417', ref: 'fdj|ITGC9K' },
    ]);
    expect(await pendingCount()).toBe(0);
    expect((await getSettings()).shareStatus).toBe('ok');
  });
  it('clé refusée : la file est gardée et l’état passe à « clé refusée »', async () => {
    await saveSettings({ shareToken: 'mauvaise' });
    await db.outbox.add({ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro', createdAt: 1 });
    expect(await flushOutbox(fakeGitHub(401).fn)).toEqual({ sent: 0, status: 'cle-refusee' });
    expect(await pendingCount()).toBe(1);
    expect((await getSettings()).shareStatus).toBe('cle-refusee');
  });
  it('pas de réseau : la file est gardée pour plus tard', async () => {
    await saveSettings({ shareToken: 'github_pat_X' });
    await db.outbox.add({ kind: 'barcode', code: '3017620422003', ref: 'pmi|marlboro', createdAt: 1 });
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await flushOutbox(offline)).toEqual({ sent: 0, status: 'hors-ligne' });
    expect(await pendingCount()).toBe(1);
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

describe('la clé ne quitte jamais le téléphone', () => {
  it('exclue de la sauvegarde, et gardée lors d’une restauration', async () => {
    await saveSettings({ shareToken: 'github_pat_SECRET', shopName: 'Tabac' });
    const text = await exportBackupText(1);
    expect(text).not.toContain('github_pat_SECRET');
    await restoreFromText(text);
    expect((await getSettings()).shareToken).toBe('github_pat_SECRET');
  });
});
