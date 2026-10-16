import type { Store } from './handlers.ts';

// Types minimaux de Cloudflare D1 : seulement les appels utilisés ici (pas de @cloudflare/workers-types).
export type D1Result<T = Record<string, unknown>> = { results: T[]; success: boolean; meta: { changes: number } };

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Exécute les requêtes dans une seule transaction. */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/**
 * Store du relais sur Cloudflare D1 (schéma : relay/schema.sql).
 * Les numéros de messages viennent d'un AUTOINCREMENT commun à tous les canaux : ils croissent dans
 * chaque canal sans être consécutifs. `canaux.dernier` garde le dernier numéro malgré le ménage.
 */
export function createD1Store(db: D1Database): Store {
  return {
    async getChannel(canal) {
      const row = await db.prepare('SELECT ecriture_hash FROM canaux WHERE canal = ?').bind(canal).first<{ ecriture_hash: string }>();
      return row ? { ecritureHash: row.ecriture_hash } : null;
    },

    async createChannel(canal, ecritureHash, now) {
      const r = await db
        .prepare('INSERT OR IGNORE INTO canaux (canal, ecriture_hash, cree) VALUES (?, ?, ?)')
        .bind(canal, ecritureHash, now)
        .run();
      return r.meta.changes > 0;
    },

    async appendMessages(canal, msgs, now) {
      // Une seule insertion pour tout l'envoi (jusqu'à 200 messages) : le tableau JSON est déplié par json_each,
      // dans l'ordre. Rien n'est inséré si le canal n'existe pas.
      const [, updated] = await db.batch<{ dernier: number }>([
        db
          .prepare(
            `INSERT INTO messages (canal, iv, data, recu)
             SELECT ?1, json_extract(value, '$.iv'), json_extract(value, '$.data'), ?2 FROM json_each(?3)
             WHERE EXISTS (SELECT 1 FROM canaux WHERE canal = ?1) ORDER BY key`,
          )
          .bind(canal, now, JSON.stringify(msgs.map(({ iv, data }) => ({ iv, data })))),
        db
          .prepare(
            `UPDATE canaux SET dernier = MAX(dernier, COALESCE((SELECT MAX(n) FROM messages WHERE canal = ?1), dernier))
             WHERE canal = ?1 RETURNING dernier`,
          )
          .bind(canal),
      ]);
      const row = updated.results[0];
      if (!row) throw new Error('canal inconnu');
      return Number(row.dernier);
    },

    async listMessages(canal, after, max) {
      const r = await db
        .prepare('SELECT n, iv, data FROM messages WHERE canal = ? AND n > ? ORDER BY n LIMIT ?')
        .bind(canal, after, max)
        .all<{ n: number; iv: string; data: string }>();
      return r.results.map(({ n, iv, data }) => ({ n: Number(n), iv, data }));
    },

    async lastN(canal) {
      const row = await db.prepare('SELECT dernier FROM canaux WHERE canal = ?').bind(canal).first<{ dernier: number }>();
      return row ? Number(row.dernier) : 0;
    },

    async putPhoto(canal, photo, now) {
      await db
        .prepare(
          `INSERT INTO photos (canal, jusqua, iv, data, recu) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (canal) DO UPDATE SET jusqua = excluded.jusqua, iv = excluded.iv, data = excluded.data, recu = excluded.recu`,
        )
        .bind(canal, photo.jusqua, photo.iv, photo.data, now)
        .run();
    },

    async getPhoto(canal) {
      const row = await db
        .prepare('SELECT jusqua, iv, data FROM photos WHERE canal = ?')
        .bind(canal)
        .first<{ jusqua: number; iv: string; data: string }>();
      return row ? { jusqua: Number(row.jusqua), iv: row.iv, data: row.data } : null;
    },

    async pruneBefore(canal, n, olderThan) {
      await db.prepare('DELETE FROM messages WHERE canal = ? AND n <= ? AND recu < ?').bind(canal, n, olderThan).run();
    },
  };
}
