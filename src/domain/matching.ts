import { barcodeVariants, commonPrefix, isValidEan, normalizeCode, retailCode } from './barcode.ts';
import type { Product, ProductFields } from './types';

const uniq = (list: string[]) => [...new Set(list)];

/** Préfixes de jeu d'une couche : `fdjPrefixes`, plus l'ancien `fdjPrefix` unique (encore lu, plus écrit). */
export function layerPrefixes(f: Partial<ProductFields>): string[] {
  return uniq([...(f.fdjPrefixes ?? []), ...(f.fdjPrefix ? [f.fdjPrefix] : [])]);
}

const sharedPrefixes = (p: Product): string[] => uniq([...(p.sharedFdjPrefixes ?? []), ...(p.sharedFdjPrefix ? [p.sharedFdjPrefix] : [])]);

/**
 * Valeurs affichées : la couche user l'emporte ; les codes-barres et les préfixes de jeu sont unis (user, officiels,
 * partagés). L'ancien préfixe unique `fdjPrefix` est repris dans `fdjPrefixes` et n'apparaît plus seul.
 */
export function effectiveFields(p: Product): ProductFields {
  const f = { ...p.base, ...p.user } as ProductFields;
  const codes = [...(p.base.barcodes ?? []), ...(p.sharedBarcodes ?? []), ...(p.user.barcodes ?? [])];
  f.barcodes = uniq(codes);
  const prefixes = uniq([...layerPrefixes(p.user), ...layerPrefixes(p.base), ...sharedPrefixes(p)]);
  delete f.fdjPrefix;
  if (prefixes.length) f.fdjPrefixes = prefixes;
  else delete f.fdjPrefixes;
  // Prix saisi par le buraliste : il s'applique tout de suite, sans calendrier officiel.
  if (p.user.price !== undefined) delete f.previousPrice;
  return f;
}

export type ScanResult =
  | { type: 'product'; product: Product }
  | { type: 'unknown-ean'; code: string }
  | { type: 'confirm-game'; code: string; product: Product; prefix: string }
  | { type: 'ask-game'; code: string; candidates: Product[] }
  | { type: 'new-game'; code: string }
  | { type: 'traceability'; code: string };

export const TRACEABILITY_MESSAGE = 'Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet.';

/**
 * Identifiant de traçabilité d'un paquet (UE, en France « KPL2F… », en DataMatrix) : unique par paquet. Un DataMatrix
 * fait seulement de chiffres n'en est pas un (R4).
 */
export function isTraceabilityCode(code: string, format?: string): boolean {
  return /^KPL2F/i.test(code) || (format === 'data_matrix' && !/^\d+$/.test(code));
}

/** Formats lus par la caméra qui ne sont jamais des EAN (un code ITF de 8 chiffres peut avoir une « clé » juste). */
const NOT_EAN = new Set(['itf', 'code_128', 'code_39', 'qr_code', 'data_matrix']);

const MIN_PREFIX = 4;

/** Codes et préfixes établis d'une fiche (sans les numéros du catalogue FDJ, jamais confirmés d'office). */
function knownCodes(f: ProductFields): string[] {
  return [...(f.barcodes ?? []), ...(f.fdjPrefixes ?? [])];
}

/**
 * Ordre : code de traçabilité (refusé) ; code exact ; EAN valide ; préfixe confirmé (le plus long gagne) ; numéro du
 * catalogue FDJ jamais confirmé (« Ce ticket est-il un … ? ») ; sinon « Quel jeu ? » (ou nouveau jeu).
 */
export function resolveScan(raw: string, products: Product[], opts: { format?: string } = {}): ScanResult {
  const code = normalizeCode(raw);
  if (isTraceabilityCode(code, opts.format)) return { type: 'traceability', code };
  const fields = products.map((p) => ({ p, f: effectiveFields(p) }));

  // Un UPC-A (12 chiffres) et son EAN-13 « 0… » sont le même paquet, sauf pour un format qui n'est jamais un EAN (ticket).
  const notEan = !!opts.format && NOT_EAN.has(opts.format);
  const variants = notEan ? [code] : barcodeVariants(code);
  const exact = fields.find(({ f }) => f.barcodes?.some((b) => variants.includes(b)));
  if (exact) return { type: 'product', product: exact.p };

  if (isValidEan(code) && !notEan) return { type: 'unknown-ean', code };
  if (opts.format === 'upc_a' && isValidEan(retailCode(code))) return { type: 'unknown-ean', code: retailCode(code) };

  const games = fields.filter(({ f }) => f.kind === 'jeu-fdj');
  const longest = (pick: (f: ProductFields) => string[] | undefined) => {
    let best: { p: Product; prefix: string } | undefined;
    for (const { p, f } of games) {
      for (const prefix of pick(f) ?? []) {
        if (prefix && code.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { p, prefix };
      }
    }
    return best;
  };
  const confirmed = longest((f) => f.fdjPrefixes);
  const catalog = longest((f) => f.fdjCodes);
  // Un préfixe appris ou partagé d'un autre jeu ne prend jamais un ticket à un numéro du catalogue FDJ : on demande
  // pour le jeu du catalogue, sauf si ce numéro y est déjà confirmé dans ce tabac.
  if (confirmed && catalog && catalog.p.id !== confirmed.p.id) {
    const owner = fields.find(({ p }) => p.id === catalog.p.id)!.f;
    const ownerConfirmed = (owner.fdjPrefixes ?? []).some((k) => code.startsWith(k));
    return ownerConfirmed ? { type: 'product', product: catalog.p } : { type: 'confirm-game', code, product: catalog.p, prefix: catalog.prefix };
  }
  if (confirmed) return { type: 'product', product: confirmed.p };
  if (catalog) return { type: 'confirm-game', code, product: catalog.p, prefix: catalog.prefix };

  if (games.length === 0) return { type: 'new-game', code };
  return { type: 'ask-game', code, candidates: gameCandidates(code, products) };
}

/** Jeux proposés pour un code inconnu : ceux dont un code connu (ou un numéro du catalogue) lui ressemble le plus d'abord. */
export function gameCandidates(raw: string, products: Product[]): Product[] {
  const code = normalizeCode(raw);
  const score = (f: ProductFields) => Math.max(0, ...[...knownCodes(f), ...(f.fdjCodes ?? [])].map((k) => commonPrefix(k, code).length));
  return products
    .map((p) => ({ p, f: effectiveFields(p) }))
    .filter(({ f }) => f.kind === 'jeu-fdj')
    .map(({ p, f }) => ({ p, s: score(f) }))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p);
}

/**
 * Patch à appliquer à game.user quand le buraliste rattache `code` à ce jeu :
 * - le code complet est toujours ajouté (`barcodes`, couche user seulement) ;
 * - `confirmedPrefix` (« Oui » à « Ce ticket est-il un … ? ») est ajouté aux préfixes ;
 * - sinon, un préfixe est appris : le plus long préfixe commun (au moins 4 caractères) avec un code ou un préfixe de ce
 *   jeu, s'il ne touche aucun code d'un autre produit ; il remplace les préfixes appris plus longs qu'il couvre
 *   (carnet suivant) et s'ajoute aux autres (une émission par préfixe).
 */
export function learnFdjCode(game: Product, code: string, products: Product[], opts: { confirmedPrefix?: string } = {}): Partial<ProductFields> {
  const barcodes = uniq([...(game.user.barcodes ?? []), code]);
  let prefixes = layerPrefixes(game.user);
  if (opts.confirmedPrefix) {
    prefixes = uniq([...prefixes, opts.confirmedPrefix]);
  } else {
    const f = effectiveFields(game);
    // Codes, préfixes et numéros du catalogue FDJ des autres produits : un préfixe qui en touche un n'est pas appris.
    const clash = (prefix: string) =>
      products.some((other) => {
        if (other.id === game.id) return false;
        const of = effectiveFields(other);
        return [...knownCodes(of), ...(of.fdjCodes ?? [])].some((k) => k.startsWith(prefix) || prefix.startsWith(k));
      });
    let best = '';
    for (const k of knownCodes(f)) {
      if (k === code) continue;
      const prefix = commonPrefix(k, code);
      if (prefix.length >= MIN_PREFIX && prefix.length > best.length && !clash(prefix)) best = prefix;
    }
    if (best && !(f.fdjPrefixes ?? []).some((p) => best.startsWith(p))) {
      prefixes = [...prefixes.filter((p) => !p.startsWith(best)), best];
    }
  }
  return prefixes.length ? { barcodes, fdjPrefixes: prefixes } : { barcodes };
}

/** Patch : ajoute un code-barres à la couche user (une référence peut en avoir plusieurs : paquet, cartouche…). */
export function withUserBarcode(user: Partial<ProductFields>, code: string): Partial<ProductFields> {
  return { barcodes: uniq([...(user.barcodes ?? []), code]) };
}

/** Couche user sans ce code ni ce préfixe (ancien `fdjPrefix` compris) ; une liste vidée disparaît. */
export function withoutUserCode(user: Partial<ProductFields>, code: string): Partial<ProductFields> {
  const out = { ...user };
  for (const key of ['barcodes', 'fdjPrefixes'] as const) {
    if (!out[key]) continue;
    const rest = out[key]!.filter((c) => c !== code);
    if (rest.length) out[key] = rest;
    else delete out[key];
  }
  if (out.fdjPrefix === code) delete out.fdjPrefix;
  return out;
}

export type CodeRow = { code: string; type: 'code' | 'prefix'; origin: 'officiel' | 'partagé' | 'ajouté ici'; removable: boolean };

/**
 * Codes de la fiche : officiels, partagés (liste commune), puis ajoutés ici. Seuls ces derniers peuvent être retirés :
 * un code aussi officiel ou partagé resterait reconnu, il est donc montré comme tel.
 */
export function codeRows(p: Product): CodeRow[] {
  const rows: CodeRow[] = [];
  const seen = new Set<string>();
  const add = (codes: string[], type: CodeRow['type'], origin: CodeRow['origin']) => {
    for (const code of codes) {
      const key = type + ':' + code;
      if (seen.has(key)) continue;
      seen.add(key);
      // Code ajouté ici à la fois comme code-barres et comme préfixe : une seule ligne (« Retirer » enlève les deux).
      const twin = origin === 'ajouté ici' && type === 'prefix' && rows.find((r) => r.origin === origin && r.type === 'code' && r.code === code);
      if (twin) twin.type = 'prefix';
      else rows.push({ code, type, origin, removable: origin === 'ajouté ici' });
    }
  };
  add(p.base.barcodes ?? [], 'code', 'officiel');
  add(layerPrefixes(p.base), 'prefix', 'officiel');
  add(p.sharedBarcodes ?? [], 'code', 'partagé');
  add(sharedPrefixes(p), 'prefix', 'partagé');
  add(p.user.barcodes ?? [], 'code', 'ajouté ici');
  add(layerPrefixes(p.user), 'prefix', 'ajouté ici');
  return rows;
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
