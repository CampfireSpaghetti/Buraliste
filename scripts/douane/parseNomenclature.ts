import { createHash } from 'node:crypto';
import type { Kind } from '../../src/domain/types.ts';
import type { RefItem, ReferenceFile } from '../../src/domain/catalog.ts';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 1er novembre 2026 » → « 2026-11-01 » ; undefined si aucune date. */
export function frenchDateToIso(text: string): string | undefined {
  const m = /(1er|\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(text.normalize('NFC'));
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  if (!month) return undefined;
  const day = m[1].toLowerCase() === '1er' ? 1 : Number(m[1]);
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function clean(s: string): string {
  return s.normalize('NFKC').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeRef(manufacturer: string, label: string): string {
  return `${clean(manufacturer)}|${clean(label)}`.toLowerCase();
}

function familyKind(header: string, label: string): Kind {
  const h = clean(header).toLowerCase();
  if (h === 'cigarettes') return 'cigarette';
  if (h.startsWith('tabac à rouler') || h.startsWith('tabacs à rouler')) return 'tabac-rouler';
  if (h.startsWith('cigares')) return /cigarillo/i.test(label) ? 'cigarillo' : 'cigare';
  return 'autre-tabac';
}

const PRICE_CELL = /^(\d[\d\s ]*(,\d+)?|Sans changement|Retrait)$/;

function toNumber(s: string): number | undefined {
  const t = s.replace(/[\s ]/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
}

export function parseNomenclature(rows: string[][], sourceUrl: string): ReferenceFile {
  let effectiveDate = '';
  let manufacturer = '';
  let family = '';
  const items: RefItem[] = [];
  const indexByRef = new Map<string, number>();
  let duplicates = 0;

  for (const raw of rows) {
    const c = raw.map((x) => (x ?? '').trim());
    const [c0, c1, , c3, , c5] = c;
    if (c0.startsWith('Arrêté du')) {
      const applicable = /applicable au (.*)$/i.exec(c0)?.[1] ?? c0;
      effectiveDate = frenchDateToIso(applicable) ?? effectiveDate;
      continue;
    }
    if (c0.startsWith('FOURNISSEUR')) continue;
    if (c0.startsWith('FABRICANT')) {
      manufacturer = clean(c0.slice(c0.indexOf(':') + 1));
      continue;
    }
    const isProduct = PRICE_CELL.test(c5) && (c0 || c1);
    if (!isProduct) {
      if (c0 && !c1 && !c.slice(2).some(Boolean) && !/^(DÉSIGNATION|RÉFÉRENCE)/.test(c0)) family = c0;
      continue;
    }

    const label = clean(c1 || c0);
    const ref = normalizeRef(manufacturer, label);

    const item: RefItem = {
      ref,
      kind: familyKind(family, label),
      name: label,
      brand: label.split(' ')[0],
      format: /, en (.+)$/.exec(label)?.[1],
      manufacturer,
      status: 'inchange',
    };
    if (c0 && c1) item.previousRef = normalizeRef(manufacturer, c0);
    const oldPrice = toNumber(c3);
    if (c5 === 'Retrait') {
      item.status = 'retrait';
      item.price = oldPrice;
    } else if (c5 === 'Sans changement') {
      item.price = oldPrice;
    } else {
      item.price = toNumber(c5);
      if (oldPrice !== undefined && oldPrice !== item.price) item.previousPrice = oldPrice;
    }
    if (!c0 && c1) item.status = 'nouveau';
    if (item.format === undefined) delete item.format;

    // Un même produit peut être listé chez plusieurs fournisseurs : on garde la première
    // version, sauf si elle est retirée alors qu'une autre est encore en vente.
    const prev = indexByRef.get(ref);
    if (prev !== undefined) {
      duplicates++;
      if (items[prev].status === 'retrait' && item.status !== 'retrait') items[prev] = item;
      continue;
    }
    indexByRef.set(ref, items.length);
    items.push(item);
  }

  if (duplicates) console.warn(`${duplicates} référence(s) listée(s) chez plusieurs fournisseurs, fusionnée(s).`);
  if (!effectiveDate) throw new Error('Date d’effet introuvable (ligne « Arrêté du … applicable au … »).');
  return { version: referenceVersion(effectiveDate, items), effectiveDate, source: sourceUrl, items };
}

/** Version de la liste : date d'effet + empreinte du contenu (change dès qu'une ligne change, codes-barres compris). */
export function referenceVersion(effectiveDate: string, items: RefItem[]): string {
  return `${effectiveDate}-${createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 8)}`;
}
