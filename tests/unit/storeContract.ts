import { describe, it, expect } from 'vitest';
import type { Store } from '../../relay/src/handlers.ts';

/**
 * Tests de contrat du Store du relais : tout Store (mémoire, D1) doit les passer.
 * Les numéros de messages croissent, sans être forcément consécutifs ni propres à un canal.
 */
export function storeContract(name: string, makeStore: () => Store | Promise<Store>) {
  const m = (k: string) => ({ iv: 'iv-' + k, data: 'data-' + k });

  describe(`Store (contrat) : ${name}`, () => {
    it('canal inconnu : getChannel null, aucun message, dernier 0, pas de photographie', async () => {
      const s = await makeStore();
      expect(await s.getChannel('c1')).toBeNull();
      expect(await s.listMessages('c1', 0, 10)).toEqual([]);
      expect(await s.lastN('c1')).toBe(0);
      expect(await s.getPhoto('c1')).toBeNull();
    });

    it('createChannel renvoie true puis false, et garde la première empreinte', async () => {
      const s = await makeStore();
      expect(await s.createChannel('c1', 'h1', 10)).toBe(true);
      expect(await s.createChannel('c1', 'h2', 20)).toBe(false);
      expect(await s.getChannel('c1')).toEqual({ ecritureHash: 'h1' });
    });

    it('appendMessages renvoie des numéros croissants, relus dans l’ordre', async () => {
      const s = await makeStore();
      await s.createChannel('c1', 'h', 1);
      const a = await s.appendMessages('c1', [m('1'), m('2')], 100);
      const b = await s.appendMessages('c1', [m('3')], 100);
      expect(b).toBeGreaterThan(a);
      const list = await s.listMessages('c1', 0, 10);
      expect(list.map(({ iv, data }) => ({ iv, data }))).toEqual([m('1'), m('2'), m('3')]);
      const ns = list.map((x) => x.n);
      expect(ns[0]).toBeGreaterThan(0);
      expect(ns[1]).toBeGreaterThan(ns[0]);
      expect(ns[1]).toBe(a);
      expect(ns[2]).toBe(b);
      expect(await s.lastN('c1')).toBe(b);
    });

    it('les canaux sont séparés', async () => {
      const s = await makeStore();
      await s.createChannel('c1', 'h', 1);
      await s.createChannel('c2', 'h', 1);
      const a1 = await s.appendMessages('c1', [m('a1')], 100);
      const b1 = await s.appendMessages('c2', [m('b1')], 100);
      const a2 = await s.appendMessages('c1', [m('a2')], 100);
      expect((await s.listMessages('c1', 0, 10)).map((x) => x.data)).toEqual(['data-a1', 'data-a2']);
      expect((await s.listMessages('c2', 0, 10)).map((x) => x.data)).toEqual(['data-b1']);
      expect(await s.lastN('c1')).toBe(a2);
      expect(await s.lastN('c2')).toBe(b1);
      expect(a2).toBeGreaterThan(a1);
      // Un seul compteur pour tous les canaux : aucun numéro n'est partagé entre deux canaux.
      expect(new Set([a1, b1, a2]).size).toBe(3);
      expect(b1).toBeGreaterThan(a1);
      expect(a2).toBeGreaterThan(b1);
    });

    it('listMessages respecte « après » et « max »', async () => {
      const s = await makeStore();
      await s.createChannel('c1', 'h', 1);
      await s.appendMessages('c1', ['1', '2', '3', '4', '5'].map(m), 100);
      const all = await s.listMessages('c1', 0, 10);
      expect(all).toHaveLength(5);
      const page = await s.listMessages('c1', all[1].n, 2);
      expect(page.map((x) => x.data)).toEqual(['data-3', 'data-4']);
      expect(await s.listMessages('c1', all[4].n, 10)).toEqual([]);
    });

    it('lastN ne recule pas après le ménage, et les numéros suivants continuent de croître', async () => {
      const s = await makeStore();
      await s.createChannel('c1', 'h', 1);
      const last = await s.appendMessages('c1', [m('1'), m('2'), m('3')], 100);
      await s.pruneBefore('c1', last, 1000);
      expect(await s.listMessages('c1', 0, 10)).toEqual([]);
      expect(await s.lastN('c1')).toBe(last);
      const next = await s.appendMessages('c1', [m('4')], 2000);
      expect(next).toBeGreaterThan(last);
      expect(await s.lastN('c1')).toBe(next);
    });

    it('putPhoto remplace la photographie précédente', async () => {
      const s = await makeStore();
      await s.createChannel('c1', 'h', 1);
      await s.putPhoto('c1', { jusqua: 3, iv: 'i1', data: 'd1' }, 100);
      expect(await s.getPhoto('c1')).toEqual({ jusqua: 3, iv: 'i1', data: 'd1' });
      await s.putPhoto('c1', { jusqua: 9, iv: 'i2', data: 'd2' }, 200);
      expect(await s.getPhoto('c1')).toEqual({ jusqua: 9, iv: 'i2', data: 'd2' });
    });

    it('pruneBefore ne supprime que n ≤ N reçus strictement avant olderThan, dans ce canal', async () => {
      const s = await makeStore();
      await s.createChannel('c1', 'h', 1);
      await s.createChannel('c2', 'h', 1);
      const n1 = await s.appendMessages('c1', [m('vieux')], 100); // n ≤ N, vieux -> supprimé
      const n2 = await s.appendMessages('c1', [m('recent')], 500); // n ≤ N, récent -> gardé
      const n3 = await s.appendMessages('c1', [m('limite')], 300); // n ≤ N, recu = olderThan -> gardé
      const n4 = await s.appendMessages('c1', [m('apres')], 100); // n > N -> gardé
      await s.appendMessages('c2', [m('autre')], 100); // autre canal -> gardé
      await s.pruneBefore('c1', n3, 300);
      expect((await s.listMessages('c1', 0, 10)).map((x) => x.n)).toEqual([n2, n3, n4]);
      expect(n1).toBeLessThan(n2);
      expect((await s.listMessages('c2', 0, 10)).map((x) => x.data)).toEqual(['data-autre']);
    });

    it('bumpQuota compte par clé et par fenêtre, et repart à 1 dans une nouvelle fenêtre', async () => {
      const s = await makeStore();
      expect(await s.bumpQuota('issues', 3_600_000)).toBe(1);
      expect(await s.bumpQuota('issues', 3_600_000)).toBe(2);
      expect(await s.bumpQuota('autre', 3_600_000)).toBe(1);
      expect(await s.bumpQuota('issues', 3_600_000)).toBe(3);
      expect(await s.bumpQuota('issues', 7_200_000)).toBe(1);
      expect(await s.bumpQuota('issues', 7_200_000)).toBe(2);
      // un compteur d'une vieille fenêtre ne gêne pas : il repart à 1
      expect(await s.bumpQuota('autre', 7_200_000)).toBe(1);
    });
  });
}
