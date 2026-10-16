import type { Store } from './handlers.ts';

type Canal = {
  ecritureHash: string;
  cree: number;
  dernier: number;
  messages: { n: number; iv: string; data: string; recu: number }[];
  photo: { jusqua: number; iv: string; data: string; recu: number } | null;
};

/** Store en mémoire : sert de faux relais dans les tests et de référence pour le Store D1. */
export function createMemoryStore(): Store {
  const canaux = new Map<string, Canal>();
  return {
    async getChannel(canal) {
      const c = canaux.get(canal);
      return c ? { ecritureHash: c.ecritureHash } : null;
    },
    async createChannel(canal, ecritureHash, now) {
      if (canaux.has(canal)) return;
      canaux.set(canal, { ecritureHash, cree: now, dernier: 0, messages: [], photo: null });
    },
    async appendMessages(canal, msgs, now) {
      const c = canaux.get(canal);
      if (!c) throw new Error('canal inconnu');
      for (const m of msgs) c.messages.push({ n: ++c.dernier, iv: m.iv, data: m.data, recu: now });
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
  };
}
