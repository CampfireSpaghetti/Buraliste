// Types minimaux de sql.js (SQLite en WebAssembly), pour la fausse base D1 des tests.
declare module 'sql.js' {
  export interface Statement {
    bind(values?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }
  export interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
