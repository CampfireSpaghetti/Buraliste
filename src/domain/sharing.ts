import { normalizeCode } from './barcode.ts';
import { effectiveFields } from './matching.ts';
import type { Product } from './types';

/** Ce qu'un téléphone partage (par le relais, anonymement) : uniquement « code → produit officiel ». */
export type Contribution =
  | { kind: 'barcode'; code: string; ref: string }
  | { kind: 'fdjPrefix'; prefix: string; ref: string };

/** Liste publique des codes partagés (public/data/codes-barres.json). */
export type SharedCodesFile = { version: string; updatedAt: string; barcodes: Record<string, string>; fdjPrefixes: Record<string, string> };

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
  const prefix = after.user.fdjPrefix;
  if (prefix && prefix !== before.user.fdjPrefix && prefix !== after.sharedFdjPrefix) out.push({ kind: 'fdjPrefix', prefix, ref });
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
 */
export function mergeContributions(current: SharedCodesFile, items: Contribution[], knownRefs: Set<string>, today: string) {
  const barcodes = { ...current.barcodes };
  const fdjPrefixes = { ...current.fdjPrefixes };
  const rejected: { item: Contribution; reason: string }[] = [];
  const held: { item: Contribution; reason: string }[] = [];
  let accepted = 0;
  for (const item of items) {
    if (item.kind === 'barcode') {
      const code = normalizeCode(item.code);
      if (!/^[0-9A-Z]{6,24}$/.test(code)) rejected.push({ item, reason: 'code invalide' });
      else if (!knownRefs.has(item.ref)) rejected.push({ item, reason: 'référence inconnue' });
      else if (barcodes[code] && barcodes[code] !== item.ref) held.push({ item, reason: `code déjà attribué à ${barcodes[code]}` });
      else if (!barcodes[code]) { barcodes[code] = item.ref; accepted++; }
    } else {
      const prefix = normalizeCode(item.prefix);
      const owner = Object.keys(fdjPrefixes).find((ref) => ref !== item.ref && fdjPrefixes[ref] === prefix);
      if (!/^\d{4,24}$/.test(prefix)) rejected.push({ item, reason: 'code de jeu trop court' });
      else if (!knownRefs.has(item.ref)) rejected.push({ item, reason: 'référence inconnue' });
      else if (fdjPrefixes[item.ref] && fdjPrefixes[item.ref] !== prefix) held.push({ item, reason: `code de jeu déjà connu pour ce jeu : ${fdjPrefixes[item.ref]}` });
      else if (owner) held.push({ item, reason: `code de jeu déjà attribué à ${owner}` });
      else if (!fdjPrefixes[item.ref]) { fdjPrefixes[item.ref] = prefix; accepted++; }
    }
  }
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
    const prefix = file.fdjPrefixes[ref];
    const same = JSON.stringify(p.sharedBarcodes ?? []) === JSON.stringify(codes) && p.sharedFdjPrefix === prefix;
    if (same) continue;
    const next: Product = { ...p, sharedBarcodes: codes.length ? codes : undefined, sharedFdjPrefix: prefix };
    if (!next.sharedBarcodes) delete next.sharedBarcodes;
    if (!next.sharedFdjPrefix) delete next.sharedFdjPrefix;
    changed.push(next);
  }
  return changed;
}
