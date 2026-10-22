// Récupère la dernière nomenclature officielle des prix du tabac (Douane) et écrit public/data/references.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CompositionFile } from '../../src/domain/composition.ts';
import { applyAnsesBarcodes } from '../anses/applyBarcodes.ts';
import { findLatestOdsUrl } from './findLatest.ts';
import { parseNomenclature } from './parseNomenclature.ts';
import { readOdsRows } from './readOds.ts';

const LISTING = 'https://www.douane.gouv.fr/la-douane/opendata/categories/tabacs-manufactures/homologation-des-prix-arretes';
const OUT = 'public/data/references.json';
const COMPOSITION = 'public/data/composition.json'; // EAN déclarés à l'ANSES (robot anses:update), remis à chaque passage
const MIN_ITEMS = 1000; // en dessous, le format du fichier a probablement changé
const headers = { 'User-Agent': 'Mozilla/5.0 (La Carotte; mise a jour hebdomadaire)' };

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
}

const html = await (await get(LISTING)).text();
const odsUrl = findLatestOdsUrl(html);
const buf = new Uint8Array(await (await get(odsUrl)).arrayBuffer());
const parsed = parseNomenclature(readOdsRows(buf), odsUrl);
if (parsed.items.length < MIN_ITEMS) {
  throw new Error(`Seulement ${parsed.items.length} références lues : le format du fichier a peut-être changé.`);
}
/** Dernière composition ANSES ; illisible ou absente : la liste est écrite sans codes ANSES (jamais d'échec ici). */
function readComposition(): CompositionFile | undefined {
  try {
    return existsSync(COMPOSITION) ? (JSON.parse(readFileSync(COMPOSITION, 'utf8')) as CompositionFile) : undefined;
  } catch (e) {
    console.warn(`::warning::${COMPOSITION} illisible, codes-barres ANSES non repris : ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}
const composition = readComposition();
const file = applyAnsesBarcodes(parsed, composition);
mkdirSync('public/data', { recursive: true });
writeFileSync(OUT, JSON.stringify(file));
console.log(`${file.items.length} références, en vigueur le ${file.effectiveDate} (${odsUrl})`);
