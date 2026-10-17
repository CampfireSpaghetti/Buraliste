import { effectiveFields } from './matching';
import { stableProductId } from './productId';
import type { Kind, Product, ProductFields } from './types';

export { effectiveFields };

export type RefItem = {
  ref: string;
  previousRef?: string;
  kind: Kind;
  name: string;
  brand?: string;
  format?: string;
  manufacturer: string;
  price?: number;
  previousPrice?: number;
  status: 'nouveau' | 'retrait' | 'inchange';
};

export type ReferenceFile = { version: string; effectiveDate: string; source: string; items: RefItem[] };

export type DepartItem = {
  ref: string;
  origin?: string;
  strength?: 1 | 2 | 3 | 4 | 5;
  tasteTags?: string[];
  nicotineMg?: number;
};

export type MergeOps = { put: Product[]; unchanged: number };

/** Date locale au format AAAA-MM-JJ. */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function inEffect(f: ProductFields, today: Date): boolean {
  return !f.effectiveDate || localIsoDate(today) >= f.effectiveDate;
}

export function currentPrice(f: ProductFields, today: Date): number | undefined {
  if (f.previousPrice !== undefined && !inEffect(f, today)) return f.previousPrice;
  return f.price;
}

export function officialState(f: ProductFields, today: Date): 'actif' | 'bientot' | 'retire' {
  if (f.status === 'nouveau' && !inEffect(f, today)) return 'bientot';
  if (f.status === 'retrait' && inEffect(f, today)) return 'retire';
  return 'actif';
}

function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function stable(o: object): string {
  return JSON.stringify(o, Object.keys(o).sort());
}

function baseFor(item: RefItem, effectiveDate: string, depart?: DepartItem): Partial<ProductFields> {
  return compact({
    kind: item.kind,
    name: item.name,
    brand: item.brand,
    format: item.format,
    price: item.price,
    previousPrice: item.previousPrice,
    status: item.status,
    effectiveDate,
    origin: depart?.origin,
    strength: depart?.strength,
    tasteTags: depart?.tasteTags,
    nicotineMg: depart?.nicotineMg,
  });
}

/**
 * Fusionne la liste Douane : seule la couche `base` est remplacée. Une nouvelle référence reçoit son id stable
 * (`d:<référence>`, R20) ; une fiche existante garde le sien ici (la couche données le passe ensuite à son id stable).
 */
export function mergeReferences(
  existing: Product[],
  file: ReferenceFile,
  depart: DepartItem[],
  now: number,
): MergeOps {
  const byRef = new Map<string, Product>();
  for (const p of existing) if (p.source === 'douane' && p.douaneRef) byRef.set(p.douaneRef, p);
  const departByRef = new Map(depart.map((d) => [d.ref, d]));
  const seen = new Set<string>();
  const put: Product[] = [];
  let unchanged = 0;

  for (const item of file.items) {
    // Une ligne sans référence ne peut avoir d'id stable (ni être retrouvée à la version suivante) : ignorée.
    if (typeof item.ref !== 'string' || item.ref === '') continue;
    const target = byRef.get(item.ref) ?? (item.previousRef ? byRef.get(item.previousRef) : undefined);
    const depart = departByRef.get(item.ref) ?? (item.previousRef ? departByRef.get(item.previousRef) : undefined);
    const base = baseFor(item, file.effectiveDate, depart);
    if (!target) {
      put.push({ id: stableProductId({ id: '', source: 'douane', douaneRef: item.ref }), source: 'douane', douaneRef: item.ref, base, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: now });
      continue;
    }
    seen.add(target.id);
    if (stable(target.base) === stable(base) && target.douaneRef === item.ref) {
      unchanged++;
    } else {
      put.push({ ...target, douaneRef: item.ref, base, updatedAt: now });
    }
  }

  for (const p of byRef.values()) {
    if (seen.has(p.id)) continue;
    if (p.base.status === 'retrait') unchanged++;
    else put.push({ ...p, base: { ...p.base, status: 'retrait' }, updatedAt: now });
  }
  return { put, unchanged };
}
