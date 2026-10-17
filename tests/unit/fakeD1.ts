import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import type { D1Database, D1PreparedStatement, D1Result } from '../../relay/src/d1Store.ts';

const SQL = await initSqlJs();
const SCHEMA = readFileSync(new URL('../../relay/schema.sql', import.meta.url), 'utf8');

/** Fausse base D1 sur sql.js : mêmes appels (prepare/bind/run/all/first/batch) que Cloudflare D1. */
export function createFakeD1(): { d1: D1Database; db: Database } {
  const db = new SQL.Database();
  db.exec(SCHEMA);

  const scalar = (sql: string) => Number(db.exec(sql)[0].values[0][0]);

  function execute(query: string, params: unknown[]): D1Result {
    const before = scalar('SELECT total_changes()');
    const stmt = db.prepare(query);
    try {
      stmt.bind(params.map((v) => (v === undefined ? null : v)));
      const results: Record<string, unknown>[] = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      return { results, success: true, meta: { changes: scalar('SELECT total_changes()') - before } };
    } finally {
      stmt.free();
    }
  }

  const runners = new WeakMap<D1PreparedStatement, () => D1Result>();

  function statement(query: string, params: unknown[]): D1PreparedStatement {
    const run = () => execute(query, params);
    const s: D1PreparedStatement = {
      bind: (...values: unknown[]) => statement(query, values),
      run: async () => run(),
      all: async <T,>() => run() as D1Result<T>,
      first: async <T,>() => (run().results[0] ?? null) as T | null,
    };
    runners.set(s, run);
    return s;
  }

  const d1: D1Database = {
    prepare: (query: string) => statement(query, []),
    async batch<T>(statements: D1PreparedStatement[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => runners.get(s)!());
        db.exec('COMMIT');
        return results as D1Result<T>[];
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { d1, db };
}
