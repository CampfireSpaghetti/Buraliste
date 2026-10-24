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
/** Les compteurs d'une fenêtre de plus d'un jour sont supprimés. */
const QUOTA_TTL = 24 * 3_600_000;
/** Place des messages d'un canal, recalculée après un ménage. */
const SUM_BYTES = '(SELECT COALESCE(SUM(LENGTH(iv) + LENGTH(data)), 0) FROM messages WHERE canal = ?)';

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
      if (r.meta.changes === 0) return false;
      // Volume repris à zéro (un canal supprimé par le ménage puis recréé).
      await db.prepare('INSERT OR REPLACE INTO volumes (canal, octets, actif) VALUES (?, 0, ?)').bind(canal, now).run();
      return true;
    },

    async appendMessages(canal, msgs, now) {
      // Une seule insertion pour tout l'envoi (jusqu'à 200 messages) : le tableau JSON est déplié par json_each,
      // dans l'ordre. Rien n'est inséré si le canal n'existe pas.
      const bytes = msgs.reduce((t, m) => t + m.iv.length + m.data.length, 0);
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
        db
          .prepare(
            `INSERT INTO volumes (canal, octets, actif) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM canaux WHERE canal = ?1)
             ON CONFLICT (canal) DO UPDATE SET octets = octets + ?2, actif = MAX(actif, ?3)`,
          )
          .bind(canal, bytes, now),
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
      await db
        .prepare('INSERT INTO volumes (canal, octets, actif) VALUES (?1, 0, ?2) ON CONFLICT (canal) DO UPDATE SET actif = MAX(actif, ?2)')
        .bind(canal, now)
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
      await db.batch([
        db.prepare('DELETE FROM messages WHERE canal = ? AND n <= ? AND recu < ?').bind(canal, n, olderThan),
        db.prepare(`UPDATE volumes SET octets = ${SUM_BYTES} WHERE canal = ?`).bind(canal, canal),
      ]);
    },

    async bumpQuota(cle, fenetre, by = 1) {
      // Une seule transaction : ménage des vieux compteurs, puis incrément atomique (ou remise à 1 si la fenêtre a changé).
      const [, bumped] = await db.batch<{ n: number }>([
        db.prepare('DELETE FROM quotas WHERE fenetre < ?').bind(fenetre - QUOTA_TTL),
        db
          .prepare(
            `INSERT INTO quotas (cle, n, fenetre) VALUES (?1, ?3, ?2)
             ON CONFLICT (cle) DO UPDATE SET n = CASE WHEN fenetre = ?2 THEN n + ?3 ELSE ?3 END, fenetre = MAX(fenetre, ?2)
             RETURNING n`,
          )
          .bind(cle, fenetre, by),
      ]);
      return Number(bumped.results[0]?.n ?? by);
    },

    async channelBytes(canal) {
      const row = await db.prepare('SELECT octets FROM volumes WHERE canal = ?').bind(canal).first<{ octets: number }>();
      return row ? Number(row.octets) : 0;
    },

    async totalBytes() {
      const row = await db
        .prepare('SELECT (SELECT COALESCE(SUM(octets), 0) FROM volumes) + (SELECT COALESCE(SUM(LENGTH(iv) + LENGTH(data)), 0) FROM photos) AS t')
        .first<{ t: number }>();
      return Number(row?.t ?? 0);
    },

    async cleanup(inactiveBefore, coveredBefore) {
      // Canaux sans écriture depuis `inactiveBefore` (un canal d'avant la table volumes compte par sa date de création).
      const old = await db
        .prepare('SELECT c.canal FROM canaux c LEFT JOIN volumes v ON v.canal = c.canal WHERE COALESCE(v.actif, c.cree) < ?')
        .bind(inactiveBefore)
        .all<{ canal: string }>();
      const list = JSON.stringify(old.results.map((r) => r.canal));
      const inList = 'canal IN (SELECT value FROM json_each(?))';
      await db.batch([
        ...['messages', 'photos', 'volumes', 'canaux'].map((t) => db.prepare(`DELETE FROM ${t} WHERE ${inList}`).bind(list)),
        db.prepare('DELETE FROM messages WHERE recu < ? AND n <= (SELECT jusqua FROM photos p WHERE p.canal = messages.canal)').bind(coveredBefore),
        db.prepare(`UPDATE volumes SET octets = ${SUM_BYTES.replace('canal = ?', 'canal = volumes.canal')}`),
      ]);
      return { canaux: old.results.length };
    },
  };
}
