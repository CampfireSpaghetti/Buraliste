import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { hostHash, isRetiredHost, wipeEverything } from '../../src/retired';

describe('ancienne adresse de l’app', () => {
  it('reconnue par son empreinte, pas par son nom en clair', () => {
    expect(hostHash('exemple.github.io')).toBe(0x55e487e4);
    expect(isRetiredHost('exemple.github.io', new Set([0x55e487e4]))).toBe(true);
    expect(isRetiredHost('autre.github.io', new Set([0x55e487e4]))).toBe(false);
    expect(isRetiredHost('localhost')).toBe(false);
  });

  beforeEach(() => localStorage.clear());

  it('tout est effacé : bases et préférences', async () => {
    const d = new Dexie('la-carotte-test');
    d.version(1).stores({ t: 'id' });
    await d.table('t').put({ id: 'cle' });
    d.close();
    localStorage.setItem('carotte:nom', 'Julie');
    await wipeEverything();
    expect(await Dexie.getDatabaseNames()).not.toContain('la-carotte-test');
    expect(localStorage.length).toBe(0);
  });
});
