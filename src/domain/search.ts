import { effectiveFields } from './matching';
import type { Kind, Product } from './types';

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Recherche insensible aux accents dans le nom, la marque et les codes ; tous les mots doivent correspondre. */
export function searchProducts(products: Product[], query: string, opts: { kinds?: Kind[]; limit?: number } = {}): Product[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const out: { p: Product; name: string }[] = [];
  for (const p of products) {
    const f = effectiveFields(p);
    if (opts.kinds && !opts.kinds.includes(f.kind)) continue;
    const hay = fold([f.name, f.brand ?? '', ...(f.barcodes ?? []), f.fdjPrefix ?? ''].join(' '));
    if (words.every((w) => hay.includes(w))) out.push({ p, name: f.name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return out.slice(0, opts.limit ?? 100).map((x) => x.p);
}
