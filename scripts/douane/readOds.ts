import { strFromU8, unzipSync } from 'fflate';

const MAX_COLS = 6;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function cellText(body: string): string {
  const withSpaces = body
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n) => ' '.repeat(Number(n ?? 1)))
    .replace(/<text:tab\s*\/>/g, ' ')
    .replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<\/text:p>\s*<text:p[^>]*>/g, '\n');
  return decodeEntities(withSpaces.replace(/<[^>]+>/g, '')).trim();
}

/** Lit la feuille `sheet` d'un fichier ODS et renvoie une grille de MAX_COLS colonnes. */
export function readOdsRows(buf: Uint8Array, sheet = 'Feuille1'): string[][] {
  const files = unzipSync(buf, { filter: (f) => f.name === 'content.xml' });
  const xml = strFromU8(files['content.xml']);
  const start = xml.indexOf(`<table:table table:name="${sheet}"`);
  if (start < 0) throw new Error(`Feuille « ${sheet} » introuvable dans le fichier ODS`);
  const end = xml.indexOf('</table:table>', start);
  const table = xml.slice(start, end);

  const rows: string[][] = [];
  for (const row of table.matchAll(/<table:table-row\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const cells: string[] = [];
    const cellRe = /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
    for (const cell of (row[1] ?? '').matchAll(cellRe)) {
      const repeat = Number(/number-columns-repeated="(\d+)"/.exec(cell[1])?.[1] ?? 1);
      const text = cellText(cell[2] ?? '');
      for (let i = 0; i < repeat && cells.length < MAX_COLS; i++) cells.push(text);
      if (cells.length >= MAX_COLS) break;
    }
    while (cells.length < MAX_COLS) cells.push('');
    rows.push(cells);
  }
  return rows;
}
