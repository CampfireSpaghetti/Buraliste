import type { MergeOps } from './catalog';
import { effectiveFields } from './matching';
import { gameKey, stableProductId } from './productId';
import type { Product, ProductFields } from './types';

/** Un jeu de grattage vendu en point de vente, d'après la page des jeux de fdj.fr. */
export type FdjItem = {
  ref: string; fdjId: string; name: string; ticketPrice: number; maxPrize?: number; isNew: boolean;
  codes?: string[]; // numéros FDJ en vente (code jeu + émission, 5 chiffres) : à confirmer au premier scan
  page?: string; // page du jeu sur fdj.fr (« /jeux-illiko/cash ») : tableau des lots (scripts/fdj/lots.ts)
};
export type FdjGamesFile = { version: string; fetchedAt: string; source: string; items: FdjItem[] };

export { gameKey };

/** La FDJ ne publie pas de type de jeu : « gros lot » dès 5 € avec au moins 500 000 € à gagner, sinon « classique ». */
export function gameTypeFor(item: FdjItem): string {
  return item.ticketPrice >= 5 && (item.maxPrize ?? 0) >= 500_000 ? 'gros lot' : 'classique';
}

function baseFor(item: FdjItem): Partial<ProductFields> {
  const base: Partial<ProductFields> = { kind: 'jeu-fdj', name: item.name, ticketPrice: item.ticketPrice, gameType: gameTypeFor(item), status: 'inchange' };
  if (item.maxPrize !== undefined) base.maxPrize = item.maxPrize;
  if (item.isNew) base.isNew = true;
  const codes = Array.isArray(item.codes) ? item.codes.filter((c) => typeof c === 'string' && /^\d{5}$/.test(c)) : [];
  if (codes.length) base.fdjCodes = codes;
  return base;
}

const stable = (o: object) => JSON.stringify(o, Object.keys(o).sort());

/**
 * Fusionne la liste FDJ : seule la couche `base` est remplacée, la couche `user` (codes appris…) est gardée.
 * Les jeux de la liste de départ sont repris par leur nom (même id ici ; la couche données le passe ensuite à son
 * id stable, lignes de comptage comprises). Un nouveau jeu reçoit son id stable (`f:<clé>`, R20).
 * Un jeu absent de la liste est marqué retiré, jamais effacé.
 */
export function mergeFdjGames(existing: Product[], file: FdjGamesFile, now: number): MergeOps {
  const byRef = new Map<string, Product>();
  const legacyByKey = new Map<string, Product>();
  for (const p of existing) {
    if (p.source === 'fdj' && p.fdjRef) byRef.set(p.fdjRef, p);
    else if (p.source === 'depart' && effectiveFields(p).kind === 'jeu-fdj') legacyByKey.set(gameKey(effectiveFields(p).name), p);
  }
  const put: Product[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  for (const item of file.items) {
    // Un jeu sans clé ne peut avoir d'id stable (ni être retrouvé à la version suivante) : ignoré.
    if (typeof item.ref !== 'string' || item.ref === '') continue;
    const base = baseFor(item);
    const current = byRef.get(item.ref);
    if (current) {
      seen.add(current.id);
      if (stable(current.base) === stable(base)) unchanged++;
      else put.push({ ...current, base, updatedAt: now });
      continue;
    }
    const legacy = legacyByKey.get(gameKey(item.name));
    if (legacy) {
      legacyByKey.delete(gameKey(item.name));
      put.push({ ...legacy, source: 'fdj', fdjRef: item.ref, base, updatedAt: now });
      continue;
    }
    put.push({ id: stableProductId({ id: '', source: 'fdj', fdjRef: item.ref }), source: 'fdj', fdjRef: item.ref, base, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: now });
  }

  for (const p of byRef.values()) {
    if (seen.has(p.id)) continue;
    if (p.base.status === 'retrait') unchanged++;
    else put.push({ ...p, base: { ...p.base, status: 'retrait', isNew: undefined }, updatedAt: now });
  }
  return { put, unchanged };
}
