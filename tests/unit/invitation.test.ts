import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inviteFor } from '../../src/tabacs/inviteFor';
import {
  inviteLink, isIosBrowserTab, parseInviteHash, parsePastedInvite, takeInviteFromUrl,
} from '../../src/tabacs/inviteLink';
import {
  addTabac, decodeTabacInvite, encodeTabacInvite, listTabacs, PRINCIPAL_ID, renameTabac, resetRegistryMemoryForTests,
} from '../../src/tabacs/registry';
import { db, DEFAULT_SETTINGS, openTabacDb, saveSettings } from '../../src/data/db';

const KEY = 'K'.repeat(43);
const BASE = 'https://wongmichel2048.github.io/Buraliste/';
const payload = encodeTabacInvite({ name: 'Tabac de la Gare', key: KEY });

beforeEach(async () => {
  localStorage.clear();
  resetRegistryMemoryForTests();
  await db.settings.clear();
});

describe('lien d’invitation', () => {
  it('lien = adresse de l’app + #rejoindre= + invitation sans le préfixe LACAROTTE2:', () => {
    const link = inviteLink(payload, BASE);
    expect(link).toBe(BASE + '#rejoindre=' + payload.slice('LACAROTTE2:'.length));
    expect(link).not.toContain('LACAROTTE2');
  });

  it('aller-retour : le lien redonne le nom et la clé', () => {
    const hash = new URL(inviteLink(payload, BASE)).hash;
    expect(parseInviteHash(hash)).toEqual({ ok: true, invite: { name: 'Tabac de la Gare', key: KEY } });
  });

  it('accents et guillemets dans le nom : aller-retour intact', () => {
    const p = encodeTabacInvite({ name: 'Tabac « Le Saint-Éloi » d’Arès', key: KEY });
    expect(parseInviteHash(new URL(inviteLink(p, BASE)).hash)).toEqual({ ok: true, invite: { name: 'Tabac « Le Saint-Éloi » d’Arès', key: KEY } });
  });

  it('refuse autre chose qu’une invitation', () => {
    expect(() => inviteLink('3017620422003', BASE)).toThrow();
  });

  it('adresse sans #rejoindre= : pas une invitation', () => {
    expect(parseInviteHash('')).toBeUndefined();
    expect(parseInviteHash('#grattage')).toBeUndefined();
    expect(parseInviteHash('#reglages')).toBeUndefined();
  });

  it('lien abîmé ou incomplet : reconnu mais refusé', () => {
    expect(parseInviteHash('#rejoindre=')).toEqual({ ok: false });
    expect(parseInviteHash('#rejoindre=n%27importe%20quoi')).toEqual({ ok: false });
    expect(parseInviteHash('#rejoindre=' + payload.slice('LACAROTTE2:'.length, 30))).toEqual({ ok: false });
    expect(parseInviteHash('#rejoindre=' + 'eyJuYW1lIjoiWCJ9')).toEqual({ ok: false }); // {"name":"X"} sans clé
  });

  it('ponctuation collée au lien par une messagerie : ignorée', () => {
    const hash = new URL(inviteLink(payload, BASE)).hash;
    expect(parseInviteHash(hash + '.')).toEqual({ ok: true, invite: { name: 'Tabac de la Gare', key: KEY } });
  });
});

describe('coller le lien d’invitation', () => {
  const ok = { ok: true, invite: { name: 'Tabac de la Gare', key: KEY } };
  it('le lien seul, le message entier, ou l’invitation LACAROTTE2: brute', () => {
    const link = inviteLink(payload, BASE);
    expect(parsePastedInvite(link)).toEqual(ok);
    expect(parsePastedInvite(`  ${link}\n`)).toEqual(ok);
    expect(parsePastedInvite(`Rejoins le tabac « Tabac de la Gare » sur La Carotte : ouvre ce lien sur ton téléphone. ${link}`)).toEqual(ok);
    expect(parsePastedInvite(payload)).toEqual(ok);
  });
  it('n’importe quoi : refusé', () => {
    expect(parsePastedInvite('')).toEqual({ ok: false });
    expect(parsePastedInvite('bonjour')).toEqual({ ok: false });
    expect(parsePastedInvite(BASE)).toEqual({ ok: false });
    expect(parsePastedInvite('LACAROTTE2:abc')).toEqual({ ok: false });
  });
});

describe('ouverture du lien au démarrage', () => {
  const fake = (hash: string) => {
    const loc = { hash, pathname: '/Buraliste/', search: '' };
    const hist = { state: { a: 1 }, replaceState: vi.fn() };
    return { loc, hist };
  };

  it('#rejoindre= : l’invitation est lue et l’adresse nettoyée tout de suite (la clé ne reste pas dans l’historique)', () => {
    const { loc, hist } = fake(new URL(inviteLink(payload, BASE)).hash);
    expect(takeInviteFromUrl(loc, hist)).toEqual({ ok: true, invite: { name: 'Tabac de la Gare', key: KEY } });
    expect(hist.replaceState).toHaveBeenCalledWith({ a: 1 }, '', '/Buraliste/');
  });

  it('lien abîmé : adresse nettoyée aussi', () => {
    const { loc, hist } = fake('#rejoindre=abc');
    expect(takeInviteFromUrl(loc, hist)).toEqual({ ok: false });
    expect(hist.replaceState).toHaveBeenCalledWith({ a: 1 }, '', '/Buraliste/');
  });

  it('adresse ordinaire : rien n’est touché', () => {
    const { loc, hist } = fake('#scanner');
    expect(takeInviteFromUrl(loc, hist)).toBeUndefined();
    expect(hist.replaceState).not.toHaveBeenCalled();
  });
});

describe('iPhone : onglet de Safari (pas l’app de l’écran d’accueil)', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  it('onglet Safari sur iPhone : oui ; app installée ou Android : non', () => {
    expect(isIosBrowserTab(IPHONE, false, undefined)).toBe(true);
    expect(isIosBrowserTab(IPHONE, true, undefined)).toBe(false);
    expect(isIosBrowserTab(IPHONE, false, true)).toBe(false);
    expect(isIosBrowserTab(ANDROID, false, undefined)).toBe(false);
  });
});

describe('inviteFor : le vrai nom du tabac choisi et sa propre clé', () => {
  const read = async (id: string) => {
    const r = await inviteFor(id);
    return { ...r, decoded: decodeTabacInvite(r.payload) };
  };

  it('tabac de la page : le nom des réglages (partagé), pas celui du registre', async () => {
    await saveSettings({ shopName: 'Tabac du Port' });
    renameTabac(PRINCIPAL_ID, 'Ancien nom');
    const r = await read(PRINCIPAL_ID);
    expect(r.name).toBe('Tabac du Port');
    expect(r.decoded).toEqual({ name: 'Tabac du Port', key: listTabacs().find((t) => t.id === PRINCIPAL_ID)!.key });
  });

  it('autre tabac : le nom lu dans sa base, avec sa clé à lui', async () => {
    const other = addTabac('Nom du registre');
    const d = openTabacDb(other.id);
    await d.settings.put({ ...DEFAULT_SETTINGS, shopName: 'Tabac de la Gare SNCF', key: 'main' });
    d.close();
    const r = await read(other.id);
    expect(r.name).toBe('Tabac de la Gare SNCF');
    expect(r.decoded?.key).toBe(other.key);
    expect(r.decoded?.key).not.toBe(listTabacs().find((t) => t.id === PRINCIPAL_ID)!.key);
  });

  it('autre tabac sans base (ou réglages encore par défaut) : le nom du registre', async () => {
    const noDb = addTabac('Tabac du Centre');
    expect((await read(noDb.id)).decoded).toEqual({ name: 'Tabac du Centre', key: noDb.key });
    const fresh = addTabac('Tabac des Halles');
    const d = openTabacDb(fresh.id);
    await d.settings.put({ ...DEFAULT_SETTINGS, key: 'main' });
    d.close();
    expect((await read(fresh.id)).name).toBe('Tabac des Halles');
  });

  it('nom sans espaces autour, coupé à 80 caractères', async () => {
    await saveSettings({ shopName: '   ' + 'T'.repeat(100) + '  ' });
    const r = await read(PRINCIPAL_ID);
    expect(r.name).toBe('T'.repeat(80));
    expect(r.decoded?.name).toBe('T'.repeat(80));
  });

  it('nom par défaut : « Mon tabac » (le QR code est quand même fait)', async () => {
    expect((await read(PRINCIPAL_ID)).name).toBe('Mon tabac');
  });

  it('tabac inconnu : refusé', async () => {
    await expect(inviteFor('nexistepas')).rejects.toThrow();
  });
});
