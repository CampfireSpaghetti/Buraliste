// Récupère la dernière nomenclature officielle des prix du tabac (Douane) et écrit public/data/references.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { findLatestOdsUrl } from './findLatest.ts';
import { parseNomenclature } from './parseNomenclature.ts';
import { readOdsRows } from './readOds.ts';

const LISTING = 'https://www.douane.gouv.fr/la-douane/opendata/categories/tabacs-manufactures/homologation-des-prix-arretes';
const OUT = 'public/data/references.json';
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
const file = parseNomenclature(readOdsRows(buf), odsUrl);
if (file.items.length < MIN_ITEMS) {
  throw new Error(`Seulement ${file.items.length} références lues : le format du fichier a peut-être changé.`);
}
mkdirSync('public/data', { recursive: true });
writeFileSync(OUT, JSON.stringify(file));
console.log(`${file.items.length} références, en vigueur le ${file.effectiveDate} (${odsUrl})`);
