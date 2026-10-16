import { migrateLegacyLine } from './count';
import type { CountLine, Product, Settings } from './types';

export type BackupData = { products: Product[]; countLines: CountLine[]; settings: Settings };
export type BackupFile = { app: 'la-carotte'; schema: 2; exportedAt: number } & BackupData;

const SCHEMA = 2;
const NOT_OURS = 'Ce fichier n’est pas une sauvegarde La Carotte.';
const TOO_NEW = 'Cette sauvegarde vient d’une version plus récente de l’app.';
const BROKEN = 'Sauvegarde incomplète ou abîmée.';
const DAY = 86_400_000;

export function serializeBackup(data: BackupData, now: number): string {
  const file: BackupFile = { app: 'la-carotte', schema: SCHEMA, exportedAt: now, ...data };
  return JSON.stringify(file);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const validQty = (q: unknown) => Number.isInteger(q) && (q as number) >= 0 && (q as number) <= 99_999;

function validLine(l: unknown): boolean {
  return isObj(l) && typeof l.id === 'string' && typeof l.name === 'string' && typeof l.code === 'string'
    && typeof l.updatedAt === 'number' && validQty(l.linearQty) && validQty(l.stockQty);
}

function validProduct(p: unknown): boolean {
  return isObj(p) && typeof p.id === 'string' && isObj(p.base) && isObj(p.user) && Array.isArray(p.pinnedSubstitutes)
    && ['douane', 'depart', 'utilisateur'].includes(p.source as string);
}

export function parseBackup(text: string): { ok: true; data: BackupFile } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: NOT_OURS };
  }
  if (!isObj(raw) || raw.app !== 'la-carotte') return { ok: false, error: NOT_OURS };
  if (typeof raw.schema === 'number' && raw.schema > SCHEMA) return { ok: false, error: TOO_NEW };
  if (raw.schema !== SCHEMA && raw.schema !== 1) return { ok: false, error: NOT_OURS };
  // Sauvegarde d'avant le stock (schéma 1) : « quantity » devient la quantité linéaire.
  if (raw.schema === 1 && Array.isArray(raw.countLines)) {
    raw = { ...raw, schema: SCHEMA, countLines: raw.countLines.map((l) => (isObj(l) && 'quantity' in l ? migrateLegacyLine(l as never) : l)) };
  }
  if (!isObj(raw)) return { ok: false, error: NOT_OURS };
  const ok =
    Array.isArray(raw.products) && raw.products.every(validProduct)
    && Array.isArray(raw.countLines) && raw.countLines.every(validLine)
    && isObj(raw.settings) && typeof raw.settings.shopName === 'string';
  if (!ok) return { ok: false, error: BROKEN };
  return { ok: true, data: raw as unknown as BackupFile };
}

/** Rappel si la dernière sauvegarde a plus de 7 jours, ou s'il n'y en a jamais eu alors que des données existent. */
export function needsBackupReminder(s: Settings, now: number, hasData: boolean): boolean {
  if (s.lastBackupAt === undefined) return hasData;
  return now - s.lastBackupAt > 7 * DAY;
}
