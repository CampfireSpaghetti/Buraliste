import type { Store } from './handlers.ts';

type Canal = {
  ecritureHash: string;
  cree: number;
  dernier: number;
  messages: { n: number; iv: string; data: string; recu: number }[];
  photo: { jusqua: number; iv: string; data: string; recu: number } | null;
  /** Dernière écriture (messages ou photographie). */
  actif: number;
};

const bytesOf = (c: Canal) => c.messages.reduce((t, m) => t + m.iv.length + m.data.length, 0);

/**
 * Store en mémoire : sert de faux relais dans les tests et de référence pour le Store D1.
 * Comme l'AUTOINCREMENT de D1, un seul compteur numérote les messages de tous les canaux :
 * les numéros croissent dans chaque canal, avec des trous.
 */
export function createMemoryStore(): Store {
  const canaux = new Map<string, Canal>();
  const quotas = new Map<string, { n: number; fenetre: number }>();
  let compteur = 0;
  return {
    async getChannel(canal) {
      const c = canaux.get(canal);
      return c ? { ecritureHash: c.ecritureHash } : null;
    },
    async createChannel(canal, ecritureHash, now) {
      if (canaux.has(canal)) return false;
      canaux.set(canal, { ecritureHash, cree: now, dernier: 0, messages: [], photo: null, actif: now });
      return true;
    },
    async appendMessages(canal, msgs, now) {
      const c = canaux.get(canal);
      if (!c) throw new Error('canal inconnu');
      for (const m of msgs) c.messages.push({ n: (c.dernier = ++compteur), iv: m.iv, data: m.data, recu: now });
      c.actif = Math.max(c.actif, now);
      return c.dernier;
    },
    async listMessages(canal, after, max) {
      const c = canaux.get(canal);
      if (!c) return [];
      return c.messages
        .filter((m) => m.n > after)
        .slice(0, max)
        .map(({ n, iv, data }) => ({ n, iv, data }));
    },
    async lastN(canal) {
      return canaux.get(canal)?.dernier ?? 0;
    },
    async putPhoto(canal, photo, now) {
      const c = canaux.get(canal);
      if (!c) throw new Error('canal inconnu');
      c.photo = { jusqua: photo.jusqua, iv: photo.iv, data: photo.data, recu: now };
      c.actif = Math.max(c.actif, now);
    },
    async getPhoto(canal) {
      const p = canaux.get(canal)?.photo;
      return p ? { jusqua: p.jusqua, iv: p.iv, data: p.data } : null;
    },
    async pruneBefore(canal, n, olderThan) {
      const c = canaux.get(canal);
      if (!c) return;
      c.messages = c.messages.filter((m) => !(m.n <= n && m.recu < olderThan));
    },
    async bumpQuota(cle, fenetre, by = 1) {
      for (const [k, q] of quotas) if (q.fenetre < fenetre - 24 * 3_600_000) quotas.delete(k);
      const q = quotas.get(cle);
      const next = !q || fenetre > q.fenetre ? { n: by, fenetre } : { n: q.fenetre === fenetre ? q.n + by : by, fenetre: q.fenetre };
      quotas.set(cle, next);
      return next.n;
    },
    async channelBytes(canal) {
      const c = canaux.get(canal);
      return c ? bytesOf(c) : 0;
    },
    async totalBytes() {
      let t = 0;
      for (const c of canaux.values()) t += bytesOf(c) + (c.photo ? c.photo.iv.length + c.photo.data.length : 0);
      return t;
    },
    async cleanup(inactiveBefore, coveredBefore) {
      let removed = 0;
      for (const [k, c] of canaux) {
        if (c.actif < inactiveBefore) {
          canaux.delete(k);
          removed++;
        } else if (c.photo) {
          const upTo = c.photo.jusqua;
          c.messages = c.messages.filter((m) => !(m.n <= upTo && m.recu < coveredBefore));
        }
      }
      return { canaux: removed };
    },
  };
}
