import { barcodeVariants, normalizeCode } from './barcode.ts';
import { effectiveFields, layerPrefixes } from './matching.ts';
import type { Product } from './types';

/** Ce qu'un téléphone partage (par le relais, anonymement) : uniquement « code → produit officiel ». */
export type Contribution =
  | { kind: 'barcode'; code: string; ref: string }
  | { kind: 'fdjPrefix'; prefix: string; ref: string };

/**
 * Liste publique des codes partagés (public/data/codes-barres.json). Un jeu peut avoir plusieurs codes de jeu (une
 * émission chacun) : liste, ou texte seul quand il n'y en a qu'un (forme des anciens fichiers, lue par les anciennes
 * versions de l'app).
 */
export type SharedCodesFile = { version: string; updatedAt: string; barcodes: Record<string, string>; fdjPrefixes: Record<string, string | string[]> };

/** Codes de jeu d'une entrée de la liste publique (texte ou liste). */
export function prefixList(v: string | string[] | undefined): string[] {
  if (typeof v === 'string') return v ? [v] : [];
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : [];
}

export const ISSUE_PREFIX = '[codes-barres]';
const PAIRING_PREFIX = 'LACAROTTE1:'; // ancien QR code à clé GitHub, supprimé

/** Référence officielle partageable (liste Douane ou liste FDJ), sinon undefined. */
export function officialRef(p: Product): string | undefined {
  if (p.source === 'douane') return p.douaneRef;
  if (p.source === 'fdj') return p.fdjRef;
  return undefined;
}

/** Contributions nées d'une modification : nouveaux codes et nouveau code de jeu d'un produit officiel, rien d'autre. */
export function contributionsFor(before: Product, after: Product): Contribution[] {
  const ref = officialRef(after);
  if (!ref) return [];
  const known = new Set([...(effectiveFields(before).barcodes ?? []), ...(after.base.barcodes ?? [])]);
  const out: Contribution[] = [];
  for (const code of after.user.barcodes ?? []) if (!known.has(code)) out.push({ kind: 'barcode', code, ref });
  const knownPrefixes = new Set([
    ...layerPrefixes(before.user), ...layerPrefixes(after.base), ...(after.sharedFdjPrefixes ?? []), ...(after.sharedFdjPrefix ? [after.sharedFdjPrefix] : []),
  ]);
  for (const prefix of layerPrefixes(after.user)) if (!knownPrefixes.has(prefix)) out.push({ kind: 'fdjPrefix', prefix, ref });
  return out;
}

export function buildIssue(items: Contribution[]): { title: string; body: string } {
  const n = items.length;
  const payload = { app: 'la-carotte', v: 1, items };
  return {
    title: `${ISSUE_PREFIX} ${n} code${n > 1 ? 's' : ''}`,
    body: `Envoi automatique de l'app La Carotte (codes-barres → produits officiels).\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
  };
}

export function parseIssueBody(body: string): Contribution[] {
  const m = /```json\s*([\s\S]*?)```/.exec(body);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    if (data?.app !== 'la-carotte' || !Array.isArray(data.items)) return [];
    return data.items.filter(
      (i: Contribution) =>
        (i?.kind === 'barcode' && typeof i.code === 'string' && typeof i.ref === 'string') ||
        (i?.kind === 'fdjPrefix' && typeof i.prefix === 'string' && typeof i.ref === 'string'),
    );
  } catch {
    return [];
  }
}

/** Ancien QR code à clé GitHub (supprimé) : reconnu seulement pour répondre à qui le scanne ; son contenu n'est pas lu. */
export function isLegacyPairingCode(text: string): boolean {
  return text.trim().startsWith(PAIRING_PREFIX);
}

/** Empreinte courte (FNV-1a), utilisable dans l'app comme dans le robot. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Robot : vérifie chaque contribution et l'ajoute à la liste publique. Les contributions sont anonymes (le relais les
 * transmet sans savoir qui les envoie) : seules les correspondances nouvelles et sans conflit sont appliquées (R28).
 * Une contribution qui changerait ce qui est déjà publié (code-barres attribué à un autre produit, code de jeu changé,
 * code de jeu déjà pris par un autre jeu) n'est jamais appliquée : elle est mise de côté (`held`) pour le propriétaire.
 *
 * `catalog` : numéros FDJ du catalogue par jeu (fdj-games.json, `codes`). Un code de jeu contribué qui empiète sur le
 * numéro d'un autre jeu (dans un sens ou dans l'autre) est mis de côté : il prendrait ses tickets sans confirmation.
 *
 * `official` : codes-barres officiels par référence (references.json, `items[].barcodes`). Un code-barres contribué qui
 * est déjà officiel sur une autre référence est mis de côté (R7) ; déjà officiel sur la même : sans effet.
 */
export function mergeContributions(
  current: SharedCodesFile, items: Contribution[], knownRefs: Set<string>, today: string,
  catalog: Record<string, string[]> = {}, official: Record<string, string[]> = {},
) {
  const officialRef = new Map<string, string>();
  for (const [ref, codes] of Object.entries(official)) for (const c of codes ?? []) if (typeof c === 'string' && !officialRef.has(c)) officialRef.set(c, ref);
  const barcodes = { ...current.barcodes };
  const prefixes = new Map<string, string[]>(Object.entries(current.fdjPrefixes ?? {}).map(([ref, v]) => [ref, prefixList(v)]));
  const rejected: { item: Contribution; reason: string }[] = [];
  const held: { item: Contribution; reason: string }[] = [];
  let accepted = 0;
  /** Code de jeu ou code-barres d'un autre produit que l'un engloberait ou qui engloberait l'autre (R28). */
  const conflict = (prefix: string, ref: string): string | undefined => {
    for (const [other, list] of prefixes) {
      if (other === ref) continue;
      if (list.includes(prefix)) return `code de jeu déjà attribué à ${other}`;
      const hit = list.find((k) => k.startsWith(prefix) || prefix.startsWith(k));
      if (hit) return `code de jeu en conflit avec ${hit} (${other})`;
    }
    for (const [other, codes] of Object.entries(catalog)) {
      if (other === ref) continue;
      const hit = (codes ?? []).find((k) => k.startsWith(prefix) || prefix.startsWith(k));
      if (hit) return `code de jeu en conflit avec le numéro FDJ ${hit} (${other})`;
    }
    const code = Object.keys(barcodes).find((c) => barcodes[c] !== ref && c.startsWith(prefix));
    return code ? `code de jeu en conflit avec ${code} (${barcodes[code]})` : undefined;
  };
  for (const item of items) {
    if (item.kind === 'barcode') {
      const code = normalizeCode(item.code);
      const officialOwners = new Set(barcodeVariants(code).map((v) => officialRef.get(v)).filter((r): r is string => !!r));
      const officialOther = [...officialOwners].find((r) => r !== item.ref);
      if (!/^[0-9A-Z]{6,24}$/.test(code)) rejected.push({ item, reason: 'code invalide' });
      else if (!knownRefs.has(item.ref)) rejected.push({ item, reason: 'référence inconnue' });
      else if (officialOther) held.push({ item, reason: `code-barres officiel de ${officialOther}` });
      else if (officialOwners.size) continue; // déjà officiel pour cette référence
      else if (barcodes[code] && barcodes[code] !== item.ref) held.push({ item, reason: `code déjà attribué à ${barcodes[code]}` });
      else if (!barcodes[code]) { barcodes[code] = item.ref; accepted++; }
    } else {
      const prefix = normalizeCode(item.prefix);
      const own = prefixes.get(item.ref) ?? [];
      const reason = /^\d{4,24}$/.test(prefix) ? conflict(prefix, item.ref) : undefined;
      if (!/^\d{4,24}$/.test(prefix)) rejected.push({ item, reason: 'code de jeu trop court' });
      else if (!knownRefs.has(item.ref)) rejected.push({ item, reason: 'référence inconnue' });
      else if (reason) held.push({ item, reason });
      // Déjà connu, ou déjà couvert par un code de jeu plus court de ce jeu : sans effet.
      else if (!own.some((k) => prefix.startsWith(k))) { prefixes.set(item.ref, [...own, prefix]); accepted++; }
    }
  }
  const fdjPrefixes: Record<string, string | string[]> = {};
  for (const [ref, list] of prefixes) if (list.length) fdjPrefixes[ref] = list.length === 1 ? list[0] : list;
  const content = JSON.stringify({ barcodes, fdjPrefixes });
  const file: SharedCodesFile = { version: `${today}-${fingerprint(content)}`, updatedAt: today, barcodes, fdjPrefixes };
  return { file, accepted, rejected, held };
}

/** Téléphones : applique la liste publique aux produits officiels. Renvoie seulement les produits modifiés. */
export function applySharedCodes(products: Product[], file: SharedCodesFile): Product[] {
  const codesByRef = new Map<string, string[]>();
  for (const [code, ref] of Object.entries(file.barcodes)) codesByRef.set(ref, [...(codesByRef.get(ref) ?? []), code]);
  const changed: Product[] = [];
  for (const p of products) {
    const ref = officialRef(p);
    if (!ref) continue;
    const codes = (codesByRef.get(ref) ?? []).sort();
    const prefixes = prefixList(file.fdjPrefixes?.[ref]);
    const same = JSON.stringify(p.sharedBarcodes ?? []) === JSON.stringify(codes)
      && JSON.stringify(p.sharedFdjPrefixes ?? []) === JSON.stringify(prefixes) && p.sharedFdjPrefix === undefined;
    if (same) continue;
    const next: Product = { ...p, sharedBarcodes: codes, sharedFdjPrefixes: prefixes };
    if (!codes.length) delete next.sharedBarcodes;
    if (!prefixes.length) delete next.sharedFdjPrefixes;
    delete next.sharedFdjPrefix; // ancien champ unique : remplacé par la liste
    changed.push(next);
  }
  return changed;
}
