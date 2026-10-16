import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addTabac, currentTabac, dbNameFor, ensureRegistry, listTabacs, removeTabac, renameTabac,
  setCurrentTabac, syncRegistryName,
} from '../../src/tabacs/registry';
import { CarotteDB, openTabacDb } from '../../src/data/db';

const STORAGE_KEY = 'carotte:tabacs';
const line = (id: string) => ({ id, code: '0417', name: 'Cash', linearQty: 3, stockQty: 12, updatedAt: 0 });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('ensureRegistry', () => {
  it('crée « principal » comme tabac courant, avec une clé de 43 caractères', () => {
    ensureRegistry('Mon tabac');
    const t = currentTabac();
    expect(t.id).toBe('principal');
    expect(t.name).toBe('Mon tabac');
    expect(t.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(listTabacs()).toHaveLength(1);
  });
  it('un second appel ne change rien (même clé, même nom)', () => {
    ensureRegistry('Mon tabac');
    const before = JSON.stringify(listTabacs());
    ensureRegistry('Autre nom');
    expect(JSON.stringify(listTabacs())).toBe(before);
  });
  it('est stocké dans localStorage sous carotte:tabacs', () => {
    ensureRegistry('Mon tabac');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.current).toBe('principal');
    expect(stored.tabacs).toHaveLength(1);
  });
  it('un JSON corrompu est remplacé par « principal », sans erreur', () => {
    localStorage.setItem(STORAGE_KEY, '{pas du json');
    expect(() => ensureRegistry('Mon tabac')).not.toThrow();
    expect(currentTabac().id).toBe('principal');
    expect(dbNameFor(currentTabac().id)).toBe('la-carotte');
  });
  it('une structure invalide est remplacée par « principal »', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ current: 'x', tabacs: 'non' }));
    ensureRegistry('Mon tabac');
    expect(currentTabac().id).toBe('principal');
  });
  it('sans localStorage, se comporte comme un registre « principal » en mémoire', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqué'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqué'); });
    expect(() => ensureRegistry('Mon tabac')).not.toThrow();
    const t = currentTabac();
    expect(t.id).toBe('principal');
    expect(currentTabac().key).toBe(t.key);
  });
});

describe('dbNameFor', () => {
  it('« la-carotte » pour principal, sinon la-carotte-<id>', () => {
    expect(dbNameFor('principal')).toBe('la-carotte');
    expect(dbNameFor('abc')).toBe('la-carotte-abc');
  });
});

describe('tabacs', () => {
  beforeEach(() => ensureRegistry('Mon tabac'));

  it('addTabac sans clé en génère une ; avec clé, la reprend', () => {
    const a = addTabac('Rue haute');
    expect(a.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.id).not.toBe('principal');
    const key = 'A'.repeat(43);
    const b = addTabac('Gare', key);
    expect(b.key).toBe(key);
    expect(b.id).not.toBe(a.id);
    expect(listTabacs().map((t) => t.name)).toEqual(['Mon tabac', 'Rue haute', 'Gare']);
  });
  it('setCurrentTabac et renameTabac', () => {
    const a = addTabac('Rue haute');
    setCurrentTabac(a.id);
    expect(currentTabac().id).toBe(a.id);
    renameTabac(a.id, 'Rue basse');
    expect(currentTabac().name).toBe('Rue basse');
    setCurrentTabac('inconnu');
    expect(currentTabac().id).toBe(a.id);
  });
  it('syncRegistryName renomme le tabac courant seulement si le nom est non vide et différent', () => {
    syncRegistryName('Tabac du coin');
    expect(currentTabac().name).toBe('Tabac du coin');
    syncRegistryName('   ');
    expect(currentTabac().name).toBe('Tabac du coin');
    syncRegistryName('  Tabac du port ');
    expect(currentTabac().name).toBe('Tabac du port');
  });
  it('removeTabac refuse de retirer le seul tabac', async () => {
    expect(await removeTabac('principal')).toBe(false);
    expect(listTabacs()).toHaveLength(1);
  });
  it('removeTabac retire un autre tabac et supprime sa base, pas « la-carotte »', async () => {
    const principal = openTabacDb('principal');
    await principal.countLines.put(line('p1'));
    principal.close();
    const a = addTabac('Rue haute');
    const dbA = openTabacDb(a.id);
    await dbA.countLines.put(line('a1'));
    dbA.close();
    expect(await removeTabac(a.id)).toBe(true);
    expect(listTabacs().map((t) => t.id)).toEqual(['principal']);
    expect(await Dexie.exists(dbNameFor(a.id))).toBe(false);
    expect(await Dexie.exists('la-carotte')).toBe(true);
  });
  it('retirer le tabac courant désigne un autre tabac comme courant', async () => {
    const a = addTabac('Rue haute');
    setCurrentTabac(a.id);
    expect(await removeTabac(a.id)).toBe(true);
    expect(currentTabac().id).toBe('principal');
  });
});

describe('une base par tabac', () => {
  it('deux tabacs ont deux bases distinctes', async () => {
    ensureRegistry('Mon tabac');
    const a = addTabac('A');
    const b = addTabac('B');
    const dbA = openTabacDb(a.id);
    const dbB = openTabacDb(b.id);
    await dbA.countLines.put(line('seulement-a'));
    expect(await dbA.countLines.get('seulement-a')).toBeDefined();
    expect(await dbB.countLines.get('seulement-a')).toBeUndefined();
    expect(await dbB.countLines.count()).toBe(0);
    dbA.close();
    dbB.close();
  });
  it('la version 4 ajoute opsOut et syncState', async () => {
    const d = openTabacDb('v4');
    await d.syncState.put({ key: 'cursor', value: 7 });
    const seq = await d.opsOut.add({ op: { e: 'line', id: 'l1', f: { name: 'x' }, t: '1' } });
    expect(seq).toBe(1);
    expect((await d.syncState.get('cursor'))?.value).toBe(7);
    d.close();
  });
  it('une base en version 3 garde ses données après la mise à niveau', async () => {
    const name = 'la-carotte-ancienne';
    const old = new Dexie(name);
    old.version(3).stores({
      products: 'id, douaneRef, source, updatedAt',
      countLines: 'id, gameId, updatedAt',
      settings: 'key',
      outbox: '++id, createdAt',
    });
    await old.table('countLines').put(line('avant'));
    await old.table('settings').put({ key: 'main', shopName: 'Chez moi', sortCount: 'name' });
    old.close();
    const upgraded = new CarotteDB(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    expect(await upgraded.countLines.get('avant')).toMatchObject({ name: 'Cash', linearQty: 3 });
    expect((await upgraded.settings.get('main'))?.shopName).toBe('Chez moi');
    upgraded.close();
  });
});
