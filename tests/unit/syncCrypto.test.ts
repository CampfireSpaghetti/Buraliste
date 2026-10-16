// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateTabacKey, deriveChannel, encryptJson, decryptJson } from '../../src/sync/crypto.ts';
import { createHlc } from '../../src/sync/hlc.ts';
import { encodeTabacInvite, decodeTabacInvite } from '../../src/tabacs/registry.ts';
import { encodePairing } from '../../src/domain/sharing.ts';

describe('clé de tabac', () => {
  it('fait 43 caractères base64url et change à chaque appel', () => {
    const a = generateTabacKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateTabacKey()).not.toBe(a);
  });
});

describe('deriveChannel', () => {
  it('est déterministe, canal de 22 caractères, deux clés donnent deux canaux', async () => {
    const k1 = generateTabacKey();
    const k2 = generateTabacKey();
    const a = await deriveChannel(k1);
    expect(await deriveChannel(k1)).toEqual(a);
    expect(a.canal).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.ecriture).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const b = await deriveChannel(k2);
    expect(b.canal).not.toBe(a.canal);
    expect(b.ecriture).not.toBe(a.ecriture);
  });

  it('suit exactement la formule (SHA-256 tronqué, HMAC-SHA256)', async () => {
    const key = generateTabacKey();
    const raw = Buffer.from(key, 'base64url');
    const { createHash, createHmac } = await import('node:crypto');
    const canal = createHash('sha256').update(Buffer.concat([raw, Buffer.from('canal')])).digest().subarray(0, 16).toString('base64url');
    const ecriture = createHmac('sha256', raw).update('ecriture').digest().toString('base64url');
    expect(await deriveChannel(key)).toEqual({ canal, ecriture });
  });
});

describe('chiffrement', () => {
  it('aller-retour, avec une IV différente à chaque appel', async () => {
    const key = generateTabacKey();
    const value = { a: 1, nom: 'Gauloises é€', liste: [1, 2, null] };
    const m1 = await encryptJson(key, value);
    const m2 = await encryptJson(key, value);
    expect(m1.iv).not.toBe(m2.iv);
    expect(Buffer.from(m1.iv, 'base64url')).toHaveLength(12);
    expect(await decryptJson(key, m1)).toEqual(value);
    expect(await decryptJson(key, m2)).toEqual(value);
  });

  it('un data modifié d\'un caractère, une autre clé ou une entrée invalide donnent undefined', async () => {
    const key = generateTabacKey();
    const m = await encryptJson(key, { x: 'secret' });
    const c = m.data[5] === 'A' ? 'B' : 'A';
    expect(await decryptJson(key, { ...m, data: m.data.slice(0, 5) + c + m.data.slice(6) })).toBeUndefined();
    expect(await decryptJson(generateTabacKey(), m)).toBeUndefined();
    expect(await decryptJson(key, { iv: '!!!', data: m.data })).toBeUndefined();
    expect(await decryptJson(key, { iv: m.iv, data: '%%%' })).toBeUndefined();
    expect(await decryptJson('trop-court', m)).toBeUndefined();
    expect(await decryptJson(key, null as unknown as { iv: string; data: string })).toBeUndefined();
  });

  it('un contenu qui n\'est pas du JSON donne undefined', async () => {
    const key = generateTabacKey();
    const raw = Buffer.from(key, 'base64url');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode('{pas du json')));
    expect(await decryptJson(key, { iv: Buffer.from(iv).toString('base64url'), data: Buffer.from(ct).toString('base64url') })).toBeUndefined();
  });
});

describe('horloge HLC', () => {
  it('a le format ms(13)-compteur(4)-appareil', () => {
    const h = createHlc('abcd1234', () => 1_700_000_000_000);
    expect(h.tick()).toBe('1700000000000-0000-abcd1234');
    expect(h.tick()).toBe('1700000000000-0001-abcd1234');
  });

  it('tick est strictement croissant, même si now() recule', () => {
    let now = 5000;
    const h = createHlc('dev', () => now);
    const out = [h.tick()];
    now = 1000;
    out.push(h.tick(), h.tick());
    now = 9000;
    out.push(h.tick());
    now = 2000;
    out.push(h.tick());
    for (let i = 1; i < out.length; i++) expect(out[i] > out[i - 1]).toBe(true);
  });

  it('observe d\'un horodatage plus grand : le tick suivant le dépasse', () => {
    const h = createHlc('dev', () => 1000);
    const remote = '0000000009000-0005-autre';
    h.observe(remote);
    expect(h.tick() > remote).toBe(true);
    const h2 = createHlc('dev', () => 1000);
    h2.observe('0000000001000-0003-autre');
    expect(h2.tick() > '0000000001000-0003-autre').toBe(true);
  });

  it('observe d\'un horodatage plus ancien ou mal formé ne change rien', () => {
    const h = createHlc('dev', () => 5000);
    const t = h.tick();
    h.observe('0000000000001-0000-x');
    h.observe('n importe quoi');
    h.observe('');
    h.observe('99999999999999999-0000-x');
    const next = h.tick();
    expect(next).toBe('0000000005000-0001-dev');
    expect(next > t).toBe(true);
  });

  it('observe permet de restaurer l\'horloge persistée', () => {
    const h = createHlc('dev', () => 100);
    h.observe('0000000007000-0002-dev');
    expect(h.tick()).toBe('0000000007000-0003-dev');
  });

  it('ordonne totalement des appareils a, a-b, ab à ms et compteur égaux, et observe lit les identifiants avec "-"', () => {
    const stamps = ['a', 'a-b', 'ab'].map((id) => createHlc(id, () => 4242).tick());
    expect(new Set(stamps).size).toBe(3);
    expect([...stamps].sort()).toEqual(['0000000004242-0000-a', '0000000004242-0000-a-b', '0000000004242-0000-ab']);
    const h = createHlc('z', () => 1);
    h.observe('0000000004242-0000-a-b');
    expect(h.tick()).toBe('0000000004242-0001-z');
  });

  it('un compteur qui dépasse 9999 avance les millisecondes', () => {
    const h = createHlc('d', () => 10);
    h.observe('0000000000010-9999-d');
    const t = h.tick();
    expect(t).toBe('0000000000011-0000-d');
  });
});

describe('invitation de tabac', () => {
  const key = generateTabacKey();

  it('aller-retour', () => {
    const text = encodeTabacInvite({ name: 'Tabac du Centre é', key });
    expect(text.startsWith('LACAROTTE2:')).toBe(true);
    expect(decodeTabacInvite(text)).toEqual({ name: 'Tabac du Centre é', key });
  });

  it('refuse un autre texte, l\'ancien jumelage et les contenus invalides', () => {
    const b64 = (o: unknown) => 'LACAROTTE2:' + Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeTabacInvite('https://example.com')).toBeUndefined();
    expect(decodeTabacInvite(encodePairing({ token: 't', repo: 'r', shop: 's' }))).toBeUndefined();
    expect(decodeTabacInvite('LACAROTTE2:pas-du-base64!')).toBeUndefined();
    expect(decodeTabacInvite('lacarotte2:' + 'abc')).toBeUndefined();
    expect(decodeTabacInvite(b64([1, 2]))).toBeUndefined();
    expect(decodeTabacInvite(b64(null))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: '', key }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: '   ', key }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: 'x'.repeat(81), key }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: 'x'.repeat(80), key }))).toBeDefined();
    expect(decodeTabacInvite(b64({ name: 'A', key: 'court' }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: 'A', key: key + 'a' }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: 'A', key: '!'.repeat(43) }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: 'A' }))).toBeUndefined();
    expect(decodeTabacInvite(b64({ name: 5, key }))).toBeUndefined();
  });
});
