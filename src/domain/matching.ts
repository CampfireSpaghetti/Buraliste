import { commonPrefix, isValidEan, normalizeCode } from './barcode';
import type { Product, ProductFields } from './types';

/** Valeurs affichées : la couche user l'emporte, les codes-barres sont unis. */
export function effectiveFields(p: Product): ProductFields {
  const f = { ...p.base, ...p.user } as ProductFields;
  const codes = [...(p.base.barcodes ?? []), ...(p.user.barcodes ?? [])];
  f.barcodes = [...new Set(codes)];
  return f;
}

export type ScanResult =
  | { type: 'product'; product: Product }
  | { type: 'unknown-ean'; code: string }
  | { type: 'ask-game'; code: string; candidates: Product[] }
  | { type: 'new-game'; code: string };

const MIN_PREFIX = 4;

function knownCodes(f: ProductFields): string[] {
  return [...(f.barcodes ?? []), ...(f.fdjPrefix ? [f.fdjPrefix] : [])];
}

export function resolveScan(raw: string, products: Product[]): ScanResult {
  const code = normalizeCode(raw);
  const fields = products.map((p) => ({ p, f: effectiveFields(p) }));

  const exact = fields.find(({ f }) => f.barcodes?.includes(code));
  if (exact) return { type: 'product', product: exact.p };

  if (isValidEan(code)) return { type: 'unknown-ean', code };

  const games = fields.filter(({ f }) => f.kind === 'jeu-fdj');
  let best: { p: Product; len: number } | undefined;
  for (const { p, f } of games) {
    if (f.fdjPrefix && code.startsWith(f.fdjPrefix) && (!best || f.fdjPrefix.length > best.len)) {
      best = { p, len: f.fdjPrefix.length };
    }
  }
  if (best) return { type: 'product', product: best.p };

  if (games.length === 0) return { type: 'new-game', code };

  const score = (f: ProductFields) => Math.max(0, ...knownCodes(f).map((k) => commonPrefix(k, code).length));
  const candidates = games
    .map(({ p, f }) => ({ p, s: score(f) }))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p);
  return { type: 'ask-game', code, candidates };
}

/** Patch à appliquer à game.user quand le buraliste rattache `code` à ce jeu. */
export function learnFdjCode(game: Product, code: string, products: Product[]): Partial<ProductFields> {
  const f = effectiveFields(game);
  const userCodes = game.user.barcodes ?? [];
  const addExact = (): Partial<ProductFields> => ({
    barcodes: [...new Set([...(f.barcodes ?? []), ...userCodes, code])],
  });

  const reference = f.fdjPrefix ?? f.barcodes?.[0];
  if (!reference) return addExact();
  const prefix = commonPrefix(reference, code);
  if (prefix.length < MIN_PREFIX) return addExact();

  const clash = products.some((other) => {
    if (other.id === game.id) return false;
    return knownCodes(effectiveFields(other)).some((k) => k.startsWith(prefix) || prefix.startsWith(k));
  });
  if (clash) return addExact();
  return { fdjPrefix: prefix };
}

/** Renvoie false si le même code a été vu il y a moins de windowMs (un code tenu devant la caméra ne compte qu'une fois). */
export function createScanDebouncer(windowMs = 1500): (code: string, now: number) => boolean {
  const lastSeen = new Map<string, number>();
  return (code, now) => {
    const prev = lastSeen.get(code);
    lastSeen.set(code, now);
    return prev === undefined || now - prev >= windowMs;
  };
}
