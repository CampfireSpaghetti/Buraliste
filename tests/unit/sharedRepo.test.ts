import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  db, addCountLines, clearUserField, deleteCountLine, getSettings, hideGame, listCountLines, listProducts, patchUserFields,
  putProduct, removeUserCode, restoreCountLine, saveSettings, setOutOfStock, setPinned, unhideGame, upsertCountLine,
} from '../../src/data/db';
import { SHARED_KEYS, applyRemoteOps, writeShared } from '../../src/data/sharedRepo';
import { resetClockForTests } from '../../src/sync/clock';
import { relayUrl } from '../../src/sync/relayConfig';
import { syncReferences } from '../../src/data/referencesSync';
import { restoreFromText } from '../../src/data/backupData';
import { serializeBackup } from '../../src/domain/backup';
import type { ReferenceFile } from '../../src/domain/catalog';
import type { CountLine, Product } from '../../src/domain/types';
import { applyFields, withoutClock, type Op } from '../../src/sync/merge';

const RELAY = 'https://relais.example.workers.dev';
const line = (over: Partial<CountLine> = {}): CountLine => ({ id: 'l1', code: '0417', name: 'Cash', linearQty: 3, stockQty: 12, updatedAt: 0, ...over });
const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', source: 'douane', douaneRef: 'a|1', base: { kind: 'cigarette', name: 'Un', price: 12 }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 1, ...over,
});
const queued = async (): Promise<Op[]> => (await db.opsOut.orderBy('seq').toArray()).map((r) => r.op);
const hlcAt = (ms: number, c = 0, dev = 'zzzzzzzz') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;

beforeEach(async () => {
  localStorage.removeItem('carotte:hlc');
  localStorage.removeItem('carotte:device');
  resetClockForTests();
  vi.stubEnv('VITE_RELAY_URL', RELAY);
  await db.delete();
  await db.open();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('configuration du relais', () => {
  it('relayUrl suit VITE_RELAY_URL (vide = non configuré)', () => {
    expect(relayUrl()).toBe(RELAY);
    vi.stubEnv('VITE_RELAY_URL', '');
    expect(relayUrl()).toBeUndefined();
  });
});

describe('SHARED_KEYS', () => {
  it('reprend les champs partagés des contraintes globales', () => {
    expect(SHARED_KEYS.line).toEqual(['gameId', 'code', 'name', 'linearQty', 'stockQty', 'updatedAt', 'deleted']);
    expect(SHARED_KEYS.product).toEqual(['user', 'outOfStock', 'pinnedSubstitutes', 'source', 'base']);
    expect(SHARED_KEYS.settings).toEqual(['shopName', 'sortCount', 'hiddenGames']);
  });
});

describe('écritures locales → opérations', () => {
  it('upsertCountLine ajoute une opération line avec seulement les champs modifiés', async () => {
    await upsertCountLine(line());
    await upsertCountLine({ ...(await listCountLines())[0], linearQty: 7 });
    const ops = await queued();
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ e: 'line', id: 'l1' });
    expect(ops[0].f).toMatchObject({ code: '0417', name: 'Cash', linearQty: 3, stockQty: 12, deleted: false });
    expect(Object.keys(ops[1].f).sort()).toEqual(['linearQty', 'updatedAt']);
    expect(ops[1].f.linearQty).toBe(7);
    expect(ops[1].t > ops[0].t).toBe(true);
    expect(ops[0].t).toMatch(/^\d{13}-\d{4}-[0-9a-z]{8}$/);
  });

  it('relais non configuré : écriture locale horodatée, rien dans la file', async () => {
    vi.stubEnv('VITE_RELAY_URL', '');
    const events = vi.fn();
    window.addEventListener('carotte:ops-queued', events);
    await upsertCountLine(line());
    window.removeEventListener('carotte:ops-queued', events);
    expect(await db.opsOut.count()).toBe(0);
    expect(events).not.toHaveBeenCalled();
    const stored = await db.countLines.get('l1');
    expect(Object.keys((stored as { _clock?: object })._clock ?? {})).toContain('linearQty');
  });

  it('R29 : relais absent de cette version mais tabac déjà synchronisé : les opérations restent mises en file', async () => {
    await db.syncState.put({ key: 'lastN', value: 42 });
    vi.stubEnv('VITE_RELAY_URL', '');
    await upsertCountLine(line());
    await saveSettings({ shopName: 'Le Balto' });
    await hideGame('g1');
    await db.products.put(product());
    await setOutOfStock('p1', true);
    await deleteCountLine('l1');
    await addCountLines([line({ id: 'game:g2', gameId: 'g2' })]);
    expect((await queued()).map((o) => o.e)).toEqual(['line', 'settings', 'settings', 'product', 'line']);
  });

  it('une opération mise en file déclenche carotte:ops-queued', async () => {
    const events = vi.fn();
    window.addEventListener('carotte:ops-queued', events);
    await upsertCountLine(line());
    window.removeEventListener('carotte:ops-queued', events);
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('setOutOfStock donne {outOfStock:true} ; patchUserFields donne user.<champ>', async () => {
    await db.products.put(product());
    await setOutOfStock('p1', true);
    await patchUserFields('p1', { tasteTags: ['doux', 'boisé'] });
    const ops = await queued();
    expect(ops.map((o) => [o.e, o.id, o.f])).toEqual([
      ['product', 'p1', { outOfStock: true }],
      ['product', 'p1', { 'user.tasteTags': ['doux', 'boisé'] }],
    ]);
  });

  it('clearUserField donne user.<champ>: null ; setPinned donne pinnedSubstitutes', async () => {
    await db.products.put(product({ user: { notes: 'x' } }));
    await clearUserField('p1', 'notes');
    await setPinned('p1', ['p2']);
    expect((await queued()).map((o) => o.f)).toEqual([{ 'user.notes': null }, { pinnedSubstitutes: ['p2'] }]);
    expect((await db.products.get('p1'))!.user).toEqual({});
  });

  it('putProduct d’une fiche créée à la main partage source et base ; une fiche officielle non', async () => {
    await putProduct({ id: 'u1', source: 'utilisateur', base: {}, user: { kind: 'jeu-fdj', name: 'Astro' }, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 });
    await db.products.put(product());
    await putProduct({ ...product(), base: { kind: 'cigarette', name: 'Autre' }, outOfStock: true });
    const [mine, official] = await queued();
    expect(mine.f).toEqual({ source: 'utilisateur', base: {}, 'user.kind': 'jeu-fdj', 'user.name': 'Astro', outOfStock: false, pinnedSubstitutes: [] });
    expect(official.f).toEqual({ outOfStock: true });
    expect((await db.products.get('p1'))!.base.name).toBe('Autre');
  });

  it('saveSettings({lastBackupAt}) ne produit aucune opération ; saveSettings({shopName}) en produit une', async () => {
    await saveSettings({ lastBackupAt: 42 });
    expect(await db.opsOut.count()).toBe(0);
    expect((await getSettings()).lastBackupAt).toBe(42);
    await saveSettings({ shopName: 'Tabac du Centre' });
    const ops = await queued();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ e: 'settings', id: 'main', f: { shopName: 'Tabac du Centre' } });
  });

  it('getSettings ne renvoie pas les horodatages internes', async () => {
    await saveSettings({ shopName: 'Tabac du Centre' });
    expect(await getSettings()).not.toHaveProperty('_clock');
  });

  it('writeShared sans changement partagé n’horodate rien et ne met rien en file', async () => {
    await writeShared('line', 'l1', line());
    const n = await db.opsOut.count();
    await writeShared('line', 'l1', line());
    expect(await db.opsOut.count()).toBe(n);
  });
});

describe('suppression de ligne', () => {
  it('deleteCountLine la retire de listCountLines (deleted:true), l’annulation la fait revenir', async () => {
    await upsertCountLine(line());
    const [saved] = await listCountLines();
    const removed = await deleteCountLine('l1');
    expect(await listCountLines()).toEqual([]);
    expect((await db.countLines.get('l1'))!.deleted).toBe(true);
    await restoreCountLine(removed);
    expect(await listCountLines()).toEqual([saved]);
    const ops = await queued();
    expect(ops.at(-2)!.f).toEqual({ deleted: true });
    expect(ops.at(-1)!.f).toEqual({ deleted: false });
  });

  it('une ligne supprimée qui reçoit une modification plus ancienne reste masquée', async () => {
    await upsertCountLine(line());
    const created = (await db.countLines.get('l1'))!._clock!.linearQty;
    await deleteCountLine('l1');
    const older = hlcAt(Number(created.slice(0, 13)), Number(created.slice(14, 18)) + 1, 'aaaaaaaa');
    expect(await applyRemoteOps([{ e: 'line', id: 'l1', f: { linearQty: 9 }, t: older }])).toBe(1);
    expect(await listCountLines()).toEqual([]);
  });

  it('addCountLines : une ligne de jeu neuve ne produit pas d’opération ; une ligne supprimée revient avec deleted:false', async () => {
    await addCountLines([line({ id: 'game:g1', gameId: 'g1', linearQty: 0, stockQty: 0 })]);
    expect(await db.opsOut.count()).toBe(0);
    await upsertCountLine({ ...(await listCountLines())[0], linearQty: 4 });
    await deleteCountLine('game:g1');
    await db.opsOut.clear();
    await addCountLines([line({ id: 'game:g1', gameId: 'g1', linearQty: 0, stockQty: 0 })]);
    const [revived] = await listCountLines();
    expect(revived).toMatchObject({ id: 'game:g1', linearQty: 0 });
    expect((await queued())[0].f).toMatchObject({ deleted: false, linearQty: 0 });
  });

  it('première écriture d’une ligne jamais horodatée : l’opération porte toute la ligne', async () => {
    await addCountLines([line({ id: 'game:g1', gameId: 'g1', linearQty: 0, stockQty: 0 })]);
    await upsertCountLine({ ...(await listCountLines())[0], linearQty: 5 });
    expect((await queued())[0].f).toMatchObject({ gameId: 'g1', code: '0417', name: 'Cash', linearQty: 5, stockQty: 0, deleted: false });
  });
});

describe('applyRemoteOps', () => {
  const now = () => Date.now();

  it('sur une ligne inconnue la crée', async () => {
    const op: Op = { e: 'line', id: 'r1', f: { code: '0999', name: 'Astro', linearQty: 2, stockQty: 5, updatedAt: 10, deleted: false }, t: hlcAt(now()) };
    expect(await applyRemoteOps([op])).toBe(1);
    expect(await listCountLines()).toEqual([{ id: 'r1', code: '0999', name: 'Astro', linearQty: 2, stockQty: 5, updatedAt: 10, deleted: false }]);
    expect(await db.opsOut.count()).toBe(0);
  });

  it('une opération plus ancienne qu’un champ local ne change rien', async () => {
    await upsertCountLine(line());
    const before = await db.countLines.get('l1');
    expect(await applyRemoteOps([{ e: 'line', id: 'l1', f: { linearQty: 99 }, t: hlcAt(1000) }])).toBe(0);
    expect(await db.countLines.get('l1')).toEqual(before);
  });

  it('une opération plus récente l’emporte', async () => {
    await upsertCountLine(line());
    expect(await applyRemoteOps([{ e: 'line', id: 'l1', f: { linearQty: 99 }, t: hlcAt(now() + 60_000) }])).toBe(1);
    expect((await listCountLines())[0].linearQty).toBe(99);
  });

  it('le tick local suivant est plus grand que l’horodatage reçu', async () => {
    const remote = hlcAt(now() + 3_600_000, 5, 'aaaaaaaa');
    await applyRemoteOps([{ e: 'line', id: 'r1', f: { code: '', name: 'A', linearQty: 1, stockQty: 0, updatedAt: 1 }, t: remote }]);
    await upsertCountLine(line());
    const [op] = await queued();
    expect(op.t > remote).toBe(true);
  });

  it('R15 : une opération à plus de 24 h dans le futur est ignorée et non observée', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const future = hlcAt(now() + 25 * 3_600_000);
    const n = await applyRemoteOps([
      { e: 'line', id: 'f1', f: { code: '', name: 'A', linearQty: 1, stockQty: 0, updatedAt: 1 }, t: future },
      { e: 'line', id: 'f2', f: { code: '', name: 'B', linearQty: 1, stockQty: 0, updatedAt: 1 }, t: future },
    ]);
    expect(n).toBe(0);
    expect(await db.countLines.count()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    await upsertCountLine(line());
    expect((await queued())[0].t < future).toBe(true);
  });

  it('R16 : les clés non partagées sont retirées, user.x refusé sur une ligne, le reste de l’opération est appliqué', async () => {
    await applyRemoteOps([{ e: 'line', id: 'r1', f: { code: '1', name: 'A', linearQty: 1, stockQty: 0, updatedAt: 1, secret: 'x', 'user.name': 'pirate' }, t: hlcAt(now()) }]);
    const stored = (await db.countLines.get('r1')) as unknown as Record<string, unknown>;
    expect(stored.name).toBe('A');
    expect(stored).not.toHaveProperty('secret');
    expect(stored).not.toHaveProperty('user');
  });

  it('R16 : réglages non partagés refusés, id de réglages autre que main refusé, entité inconnue refusée', async () => {
    await saveSettings({ shareToken: 'mine' });
    const n = await applyRemoteOps([
      { e: 'settings', id: 'main', f: { shareToken: 'volé', lastBackupAt: 1, sortCount: 'updatedAt' }, t: hlcAt(now()) },
      { e: 'settings', id: 'autre', f: { shopName: 'X' }, t: hlcAt(now()) },
      { e: 'outbox', id: '1', f: { code: 'x' }, t: hlcAt(now()) } as unknown as Op,
    ]);
    expect(n).toBe(1);
    const s = await getSettings();
    expect(s).toMatchObject({ shareToken: 'mine', sortCount: 'updatedAt' });
    expect(s.lastBackupAt).toBeUndefined();
    expect(await db.settings.get('autre')).toBeUndefined();
  });

  it('R16 : un produit officiel garde sa source et sa base ; user.* et outOfStock appliqués', async () => {
    await db.products.put(product());
    await applyRemoteOps([{ e: 'product', id: 'p1', f: { source: 'utilisateur', base: { name: 'pirate' }, outOfStock: true, 'user.notes': 'ok', douaneRef: 'z' }, t: hlcAt(now()) }]);
    const p = (await db.products.get('p1'))!;
    expect(p).toMatchObject({ source: 'douane', douaneRef: 'a|1', outOfStock: true, user: { notes: 'ok' } });
    expect(p.base.name).toBe('Un');
  });

  it('un produit créé à la main sur un autre téléphone est créé ici', async () => {
    await applyRemoteOps([{ e: 'product', id: 'u9', f: { source: 'utilisateur', base: {}, 'user.kind': 'jeu-fdj', 'user.name': 'Astro', outOfStock: false, pinnedSubstitutes: [] }, t: hlcAt(now()) }]);
    const [p] = await listProducts();
    expect(p).toMatchObject({ id: 'u9', source: 'utilisateur', base: {}, user: { kind: 'jeu-fdj', name: 'Astro' }, outOfStock: false, pinnedSubstitutes: [] });
  });

  it('un produit inconnu sans source n’est pas créé', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await applyRemoteOps([{ e: 'product', id: 'x', f: { outOfStock: true }, t: hlcAt(now()) }])).toBe(0);
    expect(await db.products.count()).toBe(0);
  });

  it('des réglages amorcés sans horodatage cèdent à une opération reçue', async () => {
    await db.settings.put({ key: 'main', shopName: 'Invité', sortCount: 'name' });
    expect(await applyRemoteOps([{ e: 'settings', id: 'main', f: { shopName: 'Tabac du Centre' }, t: hlcAt(1000) }])).toBe(1);
    expect((await getSettings()).shopName).toBe('Tabac du Centre');
  });
});

describe('horloge persistante', () => {
  it('identifiant d’appareil de 8 caractères base36, créé une fois ; dernier tick enregistré', async () => {
    await upsertCountLine(line());
    const device = localStorage.getItem('carotte:device');
    expect(device).toMatch(/^[0-9a-z]{8}$/);
    const [op] = await queued();
    expect(op.t.endsWith(`-${device}`)).toBe(true);
    expect(localStorage.getItem('carotte:hlc')).toBe(op.t);
  });

  it('après redémarrage, le tick reprend après le dernier enregistré', async () => {
    const saved = hlcAt(Date.now() + 3_600_000, 3, 'abcdefgh');
    localStorage.setItem('carotte:device', 'abcdefgh');
    localStorage.setItem('carotte:hlc', saved);
    resetClockForTests();
    await upsertCountLine(line());
    expect((await queued())[0].t > saved).toBe(true);
  });
});

describe('listes publiques et sauvegarde (R17)', () => {
  const refFile: ReferenceFile = {
    version: 'v2', effectiveDate: '2026-11-01', source: 'test',
    items: [{ ref: 'a|1', kind: 'cigarette', name: 'Un', manufacturer: 'A', price: 14, status: 'inchange' }],
  };
  const fetchOf = (f: ReferenceFile) => (async () => new Response(JSON.stringify(f))) as unknown as typeof fetch;

  it('syncReferences garde _clock, user, outOfStock et pinnedSubstitutes, sans produire d’opération', async () => {
    await db.products.put(product());
    await patchUserFields('p1', { tasteTags: ['doux'] });
    await setOutOfStock('p1', true);
    await setPinned('p1', ['p2']);
    const clock = (await db.products.get('p1'))!._clock;
    const n = await db.opsOut.count();
    await syncReferences(fetchOf(refFile));
    // La fiche passe à son id stable (« d: » + référence Douane), avec tout ce qu'elle portait.
    expect(await db.products.get('p1')).toBeUndefined();
    const p = (await db.products.get('d:a|1'))!;
    expect(p.base.price).toBe(14);
    expect(p).toMatchObject({ user: { tasteTags: ['doux'] }, outOfStock: true, pinnedSubstitutes: ['p2'] });
    expect(p._clock).toEqual(clock);
    expect(await db.opsOut.count()).toBe(n);
  });

  it('la restauration d’une sauvegarde passe par la couche partagée (opérations, plus de clé GitHub, versions remises à zéro)', async () => {
    await saveSettings({ shareToken: 'secret', referencesVersion: 'v1' });
    await upsertCountLine(line({ id: 'mine', name: 'Astro' }));
    await db.opsOut.clear();
    const data = {
      products: [{ id: 'u', source: 'utilisateur' as const, base: {}, user: { kind: 'cigarette' as const, name: 'X' }, outOfStock: false, pinnedSubstitutes: [], updatedAt: 1 }],
      countLines: [{ id: 'l', code: '0417', name: 'Cash', linearQty: 3, stockQty: 40, updatedAt: 2 }],
      settings: { shopName: 'Tabac du Centre', sortCount: 'name' as const },
    };
    expect((await restoreFromText(serializeBackup(data, 5))).ok).toBe(true);
    expect((await listCountLines()).map((l) => l.name)).toEqual(['Cash']);
    const s = await getSettings();
    expect(s).toMatchObject({ shopName: 'Tabac du Centre' });
    expect(s.shareToken).toBeUndefined(); // plus de clé GitHub sur les téléphones
    expect(s.referencesVersion).toBeUndefined();
    const ops = await queued();
    expect(ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ e: 'line', id: 'mine', f: { deleted: true } }),
      expect.objectContaining({ e: 'line', id: 'l' }),
      expect.objectContaining({ e: 'product', id: 'u' }),
      expect.objectContaining({ e: 'settings', id: 'main', f: { shopName: 'Tabac du Centre' } }),
    ]));
    expect((await db.countLines.get('l'))!._clock).toBeDefined();
  });
});

describe('instantané de départ (R21) : une copie périmée ne défait pas la modification d’un autre téléphone', () => {
  it('B met le stock à 20 ; A, dont le pavé avait 12, ne change que le linéaire : le stock reste 20 partout', async () => {
    await upsertCountLine(line({ stockQty: 12 }));
    const snapshotA = (await listCountLines())[0];
    const phoneB = applyFields({ ...snapshotA }, {}, '');
    const tB = hlcAt(Date.now() + 1000, 0, 'bbbbbbbb');
    const opB: Op = { e: 'line', id: 'l1', f: { stockQty: 20, updatedAt: Date.now() - 5000 }, t: tB };
    const recordB = applyFields(phoneB.record, opB.f, opB.t).record;
    expect(await applyRemoteOps([opB])).toBe(1);
    await db.opsOut.clear();

    const saved = await upsertCountLine({ ...snapshotA, linearQty: 5 }, snapshotA);
    expect(saved).toMatchObject({ linearQty: 5, stockQty: 20 });
    expect((await listCountLines())[0]).toMatchObject({ linearQty: 5, stockQty: 20 });
    const [opA] = await queued();
    expect(Object.keys(opA.f).sort()).toEqual(['linearQty', 'updatedAt']);
    expect(applyFields(recordB, opA.f, opA.t).record).toMatchObject({ linearQty: 5, stockQty: 20 });
  });

  it('sans instantané, le comportement reste « différence avec la valeur stockée »', async () => {
    await upsertCountLine(line({ stockQty: 12 }));
    await applyRemoteOps([{ e: 'line', id: 'l1', f: { stockQty: 20 }, t: hlcAt(Date.now() + 1000) }]);
    await upsertCountLine({ ...line({ stockQty: 12 }), linearQty: 5 });
    expect((await listCountLines())[0].stockQty).toBe(12);
  });

  it('putProduct avec instantané : un champ user changé ailleurs reste, seul le champ du formulaire part', async () => {
    await db.products.put(product({ user: { notes: 'a' } }));
    const snapshot = withoutClock((await db.products.get('p1'))!);
    await applyRemoteOps([{ e: 'product', id: 'p1', f: { 'user.notes': 'b', outOfStock: true }, t: hlcAt(Date.now() + 1000) }]);
    await db.opsOut.clear();
    await putProduct({ ...snapshot, user: { ...snapshot.user, tasteTags: ['doux'] } }, snapshot);
    expect((await db.products.get('p1'))!).toMatchObject({ outOfStock: true, user: { notes: 'b', tasteTags: ['doux'] } });
    expect((await queued()).map((o) => o.f)).toEqual([{ 'user.tasteTags': ['doux'] }]);
  });

  it('hideGame sur A puis unhideGame d’un autre jeu sur B, avec une synchronisation entre les deux : rien n’est écrasé', async () => {
    // Ce téléphone joue B : jeux cachés [g2]. A cache g1, son opération arrive, puis B remet g2 dans la liste.
    await saveSettings({ hiddenGames: ['g2'] });
    await applyRemoteOps([{ e: 'settings', id: 'main', f: { hiddenGames: ['g2', 'g1'] }, t: hlcAt(Date.now() + 1000, 0, 'aaaaaaaa') }]);
    await db.opsOut.clear();
    await unhideGame('g2');
    expect((await getSettings()).hiddenGames).toEqual(['g1']);
    expect((await queued()).map((o) => o.f)).toEqual([{ hiddenGames: ['g1'] }]);
    await hideGame('g3');
    await hideGame('g3');
    expect((await getSettings()).hiddenGames).toEqual(['g1', 'g3']);
    await unhideGame('absent');
    expect(await db.opsOut.count()).toBe(2);
  });
});

describe('réglages non partagés', () => {
  it('saveSettings({shareToken}) et saveSettings({referencesVersion}) ne mettent rien en file', async () => {
    await saveSettings({ shareToken: 'secret' });
    await saveSettings({ referencesVersion: 'v9' });
    expect(await db.opsOut.count()).toBe(0);
    expect(await getSettings()).toMatchObject({ shareToken: 'secret', referencesVersion: 'v9' });
  });
});

describe('types des valeurs reçues', () => {
  it('une valeur du mauvais type est retirée, null reste un effacement, le reste est appliqué', async () => {
    await db.products.put(product({ user: { notes: 'x' } }));
    await applyRemoteOps([
      { e: 'line', id: 'r1', f: { code: 1, name: 'A', linearQty: '5', stockQty: 2, updatedAt: 3, deleted: 'oui', gameId: null }, t: hlcAt(Date.now()) },
      { e: 'settings', id: 'main', f: { shopName: 42, sortCount: 'n’importe', hiddenGames: ['g', 3] }, t: hlcAt(Date.now()) },
      { e: 'product', id: 'p1', f: { outOfStock: 'oui', pinnedSubstitutes: 'p2', 'user.tasteTags': 'doux', 'user.price': '12', 'user.name': 'Bon', 'user.notes': null }, t: hlcAt(Date.now()) },
    ]);
    const l = (await db.countLines.get('r1'))!;
    expect(l).toMatchObject({ code: '', name: 'A', linearQty: 0, stockQty: 2, updatedAt: 3 });
    expect(l.deleted).toBeUndefined();
    expect(await getSettings()).toMatchObject({ shopName: 'Mon tabac', sortCount: 'name' });
    expect((await getSettings()).hiddenGames).toBeUndefined();
    const p = (await db.products.get('p1'))!;
    expect(p).toMatchObject({ outOfStock: false, pinnedSubstitutes: [], user: { name: 'Bon' } });
    expect(p.user).not.toHaveProperty('notes');
    expect(p.user).not.toHaveProperty('tasteTags');
    expect(p.user).not.toHaveProperty('price');
  });

  it('null n’efface qu’un champ facultatif : un champ obligatoire reçu à null est ignoré', async () => {
    await upsertCountLine(line({ gameId: 'g1' }));
    await saveSettings({ hiddenGames: ['g1'] });
    await db.products.put(product());
    const t = hlcAt(Date.now() + 1000);
    await applyRemoteOps([
      { e: 'line', id: 'l1', f: { gameId: null, linearQty: null, name: null }, t },
      { e: 'settings', id: 'main', f: { hiddenGames: null, shopName: null }, t },
      { e: 'product', id: 'p1', f: { outOfStock: null, pinnedSubstitutes: null }, t },
    ]);
    const l = (await db.countLines.get('l1'))!;
    expect(l.gameId).toBeUndefined();
    expect(l).toMatchObject({ linearQty: 3, name: 'Cash' });
    const s = await getSettings();
    expect(s.hiddenGames).toBeUndefined();
    expect(s.shopName).toBe('Mon tabac');
    expect((await db.products.get('p1'))!).toMatchObject({ outOfStock: false, pinnedSubstitutes: [] });
  });
});

describe('codes-barres rattachés (user.barcodes, user.fdjPrefixes)', () => {
  it('user.fdjPrefixes reçu : liste de textes seulement', async () => {
    await db.products.put(product({ id: 'g', base: { kind: 'jeu-fdj', name: 'CASH' } }));
    await applyRemoteOps([{ e: 'product', id: 'g', f: { 'user.fdjPrefixes': '87105' }, t: hlcAt(Date.now()) }]);
    expect((await db.products.get('g'))!.user).not.toHaveProperty('fdjPrefixes');
    await applyRemoteOps([{ e: 'product', id: 'g', f: { 'user.fdjPrefixes': ['87105', 87104] }, t: hlcAt(Date.now() + 1) }]);
    expect((await db.products.get('g'))!.user).not.toHaveProperty('fdjPrefixes');
    await applyRemoteOps([{ e: 'product', id: 'g', f: { 'user.fdjPrefixes': ['87105'] }, t: hlcAt(Date.now() + 2) }]);
    expect((await db.products.get('g'))!.user.fdjPrefixes).toEqual(['87105']);
  });
  it('retirer un code passe par la couche partagée : l’autre téléphone du tabac ne le reconnaît plus', async () => {
    await db.products.put(product({ id: 'g', base: { kind: 'jeu-fdj', name: 'CASH' } }));
    await patchUserFields('g', { barcodes: ['871050010001'], fdjPrefixes: ['87105', '87104'] });
    await db.opsOut.clear();
    await removeUserCode('g', '87105');
    await removeUserCode('g', '871050010001');
    expect((await db.products.get('g'))!.user).toEqual({ fdjPrefixes: ['87104'] });
    const ops = await queued();
    expect(ops.map((o) => o.f)).toEqual([{ 'user.fdjPrefixes': ['87104'] }, { 'user.barcodes': null }]);
  });
});

describe('retirer un code : la contribution pas encore envoyée est annulée (R3)', () => {
  it('removeUserCode efface de la file d’envoi le code ou le préfixe de cette référence, rien d’autre', async () => {
    await db.products.put(product({ id: 'g', source: 'fdj', douaneRef: undefined, fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH' } }));
    await patchUserFields('g', { barcodes: ['871050010001'], fdjPrefixes: ['87105'] });
    await db.outbox.bulkAdd([
      { kind: 'barcode', code: '871050010001', ref: 'fdj|ITGC9K', createdAt: 1 },
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|ITGC9K', createdAt: 1 },
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|AUTRE', createdAt: 1 },
      { kind: 'barcode', code: '3017620422003', ref: 'fdj|ITGC9K', createdAt: 1 },
    ]);
    await removeUserCode('g', '87105');
    await removeUserCode('g', '871050010001');
    const left = (await db.outbox.toArray()).map(({ id: _id, createdAt: _c, ...c }) => c);
    expect(left).toEqual([
      { kind: 'fdjPrefix', prefix: '87105', ref: 'fdj|AUTRE' },
      { kind: 'barcode', code: '3017620422003', ref: 'fdj|ITGC9K' },
    ]);
  });
});

describe('applyRemoteOps : jeu de départ repris par la liste FDJ (depart:<nom comparable> ↔ f:<référence FDJ>)', () => {
  // Ids réels : un jeu de la liste FDJ a l'id « f:fdj|<code> » ; le même jeu de l'ancienne liste de départ,
  // « depart:<nom comparable> » (gameKey du nom). Ils ne se déduisent pas l'un de l'autre : seul le nom les relie.
  const fdjGame = (fdjRef: string, name: string, over: Partial<Product> = {}) =>
    product({ id: 'f:' + fdjRef, source: 'fdj', douaneRef: undefined, fdjRef, base: { kind: 'jeu-fdj', name }, ...over });
  const departGame = (name: string, over: Partial<Product> = {}) =>
    product({ id: 'depart:' + name.toLowerCase().replace(/[^a-z0-9]/g, ''), source: 'depart', douaneRef: undefined, base: { kind: 'jeu-fdj', name }, ...over });
  const t = () => hlcAt(Date.now() + 1000);

  it('une opération produit visant depart:<clé> absent ici s’applique au jeu FDJ du même nom (f:fdj|<code>)', async () => {
    await db.products.put(fdjGame('fdj|ITGC9K', 'CASH'));
    await db.products.put(fdjGame('fdj|GOAL01', 'Goal !'));
    expect(await applyRemoteOps([
      { e: 'product', id: 'depart:cash', f: { outOfStock: true, pinnedSubstitutes: ['depart:goal'] }, t: t() },
    ])).toBe(1);
    expect((await db.products.get('f:fdj|ITGC9K'))!).toMatchObject({ outOfStock: true, pinnedSubstitutes: ['f:fdj|GOAL01'] });
    expect(await db.products.get('depart:cash')).toBeUndefined();
  });

  it('ligne de jeu : id game:<produit> et gameId suivent la fiche présente ici, dans les deux sens ; jeux enlevés aussi', async () => {
    // ici : Cash vient de la liste FDJ ; Goal est encore un jeu de départ
    await db.products.put(fdjGame('fdj|ITGC9K', 'Cash'));
    await db.countLines.put({ id: 'game:f:fdj|ITGC9K', gameId: 'f:fdj|ITGC9K', code: '', name: 'Cash', linearQty: 0, stockQty: 0, updatedAt: 0 });
    await db.products.put(departGame('Goal'));
    await applyRemoteOps([
      { e: 'line', id: 'game:depart:cash', f: { gameId: 'depart:cash', linearQty: 4 }, t: t() },
      // un téléphone qui a déjà la liste FDJ : la ligne porte le nom du jeu, qui le relie au jeu de départ d'ici
      { e: 'line', id: 'game:f:fdj|GOAL01', f: { gameId: 'f:fdj|GOAL01', name: 'Goal', linearQty: 2 }, t: t() },
      { e: 'settings', id: 'main', f: { hiddenGames: ['depart:cash', 'autre'] }, t: t() },
    ]);
    expect((await db.countLines.get('game:f:fdj|ITGC9K'))!).toMatchObject({ gameId: 'f:fdj|ITGC9K', linearQty: 4 });
    expect((await db.countLines.get('game:depart:goal'))!).toMatchObject({ gameId: 'depart:goal', name: 'Goal', linearQty: 2 });
    expect(await db.countLines.get('game:depart:cash')).toBeUndefined();
    expect(await db.countLines.get('game:f:fdj|GOAL01')).toBeUndefined();
    expect((await getSettings()).hiddenGames).toEqual(['f:fdj|ITGC9K', 'autre']);
  });

  it('sans contrepartie ici (ou si l’id visé existe), rien n’est réécrit', async () => {
    await db.products.put(departGame('Cash'));
    await db.products.put(fdjGame('fdj|ITGC9K', 'Cash'));
    await applyRemoteOps([
      { e: 'product', id: 'depart:cash', f: { outOfStock: true }, t: t() },
      { e: 'line', id: 'game:depart:zut', f: { gameId: 'depart:zut', linearQty: 1 }, t: t() },
    ]);
    expect((await db.products.get('depart:cash'))!.outOfStock).toBe(true);
    expect((await db.products.get('f:fdj|ITGC9K'))!.outOfStock).toBe(false);
    expect((await db.countLines.get('game:depart:zut'))!).toMatchObject({ gameId: 'depart:zut', linearQty: 1 });
  });
});

describe('applyRemoteOps : base cible', () => {
  it('s’applique à la base donnée, sans toucher la base de la page', async () => {
    const { CarotteDB } = await import('../../src/data/db');
    const other = new CarotteDB('autre-' + Math.random());
    await applyRemoteOps([{ e: 'line', id: 'x1', f: { name: 'Autre', linearQty: 2 }, t: hlcAt(Date.now()) }], other);
    expect((await other.countLines.get('x1'))!).toMatchObject({ name: 'Autre', linearQty: 2 });
    expect(await db.countLines.get('x1')).toBeUndefined();
    await other.delete();
  });
});
