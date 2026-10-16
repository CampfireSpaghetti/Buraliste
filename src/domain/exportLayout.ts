import { countTotals, sortLines, type CountTotals } from './count';
import { formatDateLong, formatDateShort } from './format';
import type { CountLine, Settings } from './types';

export const EXPORT_WIDTH = 1080;
export const IOS_MAX_CANVAS_PIXELS = 16_777_216;

/** Mesures (en pixels logiques, avant `scale`). */
export const EXPORT_METRICS = {
  pad: 48,
  headerH: 210,
  gap: 28,
  headRowH: 64,
  rowH: 64,
  totalH: 76,
  footerH: 64,
  cols: { code: 48, name: 330, linearRight: 710, stockRight: 850, date: 878 },
};

export type ExportLayout = {
  width: number;
  height: number;
  scale: number;
  rows: { y: number; cells: [string, string, string, string, string] }[];
  header: { shop: string; title: 'Comptage grattage'; stamp: string };
  headRowY: number;
  totalY: number;
  footerY: number;
  totals: CountTotals;
  totalLabel: string;
};

export function layoutExport(lines: CountLine[], s: Settings, now: number, maxPixels = IOS_MAX_CANVAS_PIXELS): ExportLayout {
  const m = EXPORT_METRICS;
  const sorted = sortLines(lines, s.sortCount);
  const headRowY = m.headerH + m.gap;
  const firstRowY = headRowY + m.headRowH;
  const rows = sorted.map((l, i) => ({
    y: firstRowY + i * m.rowH,
    cells: [l.code || '—', l.name, String(l.linearQty), String(l.stockQty), formatDateShort(l.updatedAt)] as [string, string, string, string, string],
  }));
  const totalY = firstRowY + rows.length * m.rowH;
  const footerY = totalY + m.totalH;
  const height = footerY + m.footerH;
  // Échelle 2 (net sur téléphone), réduite si l'image dépasse la limite de taille des canvas iOS.
  const fit = Math.sqrt(maxPixels / (EXPORT_WIDTH * height));
  const scale = Math.min(2, Math.floor(fit * 100) / 100);
  return {
    width: EXPORT_WIDTH,
    height,
    scale,
    rows,
    header: { shop: s.shopName, title: 'Comptage grattage', stamp: formatDateLong(now) },
    headRowY,
    totalY,
    footerY,
    totals: countTotals(sorted),
    totalLabel: `Total · ${sorted.length} ${sorted.length > 1 ? 'jeux' : 'jeu'}`,
  };
}
