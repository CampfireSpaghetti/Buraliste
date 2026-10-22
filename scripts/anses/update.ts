// Composition déclarée à l'ANSES (cigarettes, tabac à rouler, cigares) pour les références de la liste Douane : écrit
// public/data/composition.json, seulement s'il a changé, puis ajoute les EAN des références rapprochées à
// public/data/references.json (codes officiels).
//
// Échec (code de sortie 1) : téléchargement ou lecture impossible, fichier trop court, aucun rapprochement. Le dernier
// composition.json valide est alors gardé ; ses EAN sont quand même remis dans la liste Douane (réécrite juste avant).
//
//   npm run anses:update                                   fichiers téléchargés sur data.gouv.fr (URL permanentes)
//   npm run anses:update -- --dir <dossier> [--date AAAA-MM-JJ]  fichiers déjà enregistrés (liste-fr-cigarettes.csv,
//                                                           liste-fr-autres-produits.csv, composition-fr-tabac.csv)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ReferenceFile } from '../../src/domain/catalog.ts';
import type { CompositionFile } from '../../src/domain/composition.ts';
import { applyAnsesBarcodes } from './applyBarcodes.ts';
import { buildComposition, type StatKey } from './buildComposition.ts';
import { parseAutres, parseCigarettes, parseComposition } from './parseAnses.ts';

const REFS = 'public/data/references.json';
const OUT = 'public/data/composition.json';
const DATASET = 'https://www.data.gouv.fr/datasets/produits-du-tabac-et-produits-connexes-declares-sur-le-marche-francais';
const FILES = {
  cigarettes: { url: 'https://www.data.gouv.fr/api/1/datasets/r/782aeeef-b2d3-4781-b0bf-a23f72a1c798', name: 'liste-fr-cigarettes.csv' },
  autres: { url: 'https://www.data.gouv.fr/api/1/datasets/r/2e50e0a2-e81e-45bb-9fe9-3f8a1c835e57', name: 'liste-fr-autres-produits.csv' },
  composition: { url: 'https://www.data.gouv.fr/api/1/datasets/r/ebbd0a65-703f-41e5-a566-1adb012c9bb4', name: 'composition-fr-tabac.csv' },
};
// En dessous, le format des fichiers a probablement changé : on garde l'ancien fichier.
const MIN_CIGARETTES = 1000;
const MIN_INGREDIENT_ROWS = 10000;
const MIN_MATCHED = 50;
const headers = { 'User-Agent': 'Mozilla/5.0 (La Carotte; mise a jour hebdomadaire)' };

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dir = arg('--dir');
const dateArg = arg('--date');

/** Fichier CSV et date de publication (lue dans l'adresse finale : …/resources/<jeu>/20260701-155343/<fichier>.csv). */
async function fetchCsv(f: { url: string; name: string }): Promise<{ text: string; date?: string }> {
  if (dir) return { text: readFileSync(`${dir}/${f.name}`, 'utf8') };
  const res = await fetch(f.url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`${f.url} → HTTP ${res.status}`);
  const m = /\/(\d{4})(\d{2})(\d{2})-\d{6}\//.exec(res.url);
  return { text: await res.text(), date: m ? `${m[1]}-${m[2]}-${m[3]}` : undefined };
}

const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined);
const LABELS: Record<StatKey, string> = { cigarette: 'cigarettes', 'tabac-rouler': 'tabac à rouler', cigare: 'cigares et cigarillos' };

let failed = false;
try {
  const refs = readJson<ReferenceFile>(REFS);
  if (!refs?.items?.length) throw new Error(`${REFS} absent ou vide.`);
  const [cig, aut, comp] = [await fetchCsv(FILES.cigarettes), await fetchCsv(FILES.autres), await fetchCsv(FILES.composition)];
  const cigarettes = parseCigarettes(cig.text);
  const autres = parseAutres(aut.text);
  const composition = parseComposition(comp.text);
  if (cigarettes.length < MIN_CIGARETTES) throw new Error(`Seulement ${cigarettes.length} cigarettes lues : le format a peut-être changé.`);
  if (composition.length < MIN_INGREDIENT_ROWS) throw new Error(`Seulement ${composition.length} lignes d'ingrédients lues : le format a peut-être changé.`);
  const products = [...cigarettes, ...autres];
  // Date du fichier ANSES : celle de l'adresse publiée ; hors réseau, --date, sinon le dossier le plus récent.
  const date = dateArg ?? cig.date ?? products.reduce((m, p) => (p.majLe > m ? p.majLe : m), '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date du fichier ANSES illisible (${date}).`);

  const previous = readJson<CompositionFile>(OUT);
  const today = new Date().toISOString().slice(0, 10);
  const r = buildComposition({ products, composition, refs: refs.items, date, source: DATASET, fetchedAt: today, previous });
  const matched = Object.values(r.stats).reduce((s, x) => s + x.matched, 0);
  for (const k of Object.keys(r.stats) as StatKey[]) {
    const { total, matched: m } = r.stats[k];
    console.log(`Rapprochement ${LABELS[k]} : ${m}/${total} (${total ? Math.round((100 * m) / total) : 0} %)`);
  }
  const withEan = Object.values(r.file.produits).filter((e) => e.ean.length).length;
  console.log(`${r.ambiguous.length} référence(s) ambiguë(s) laissée(s) sans composition ; ${withEan} référence(s) avec EAN`
    + `${r.eanDropped ? ` (${r.eanDropped} EAN partagé(s) par deux références, écarté(s))` : ''}`
    + `${r.capped ? ` ; ${r.capped} liste(s) d'ingrédients limitée(s)` : ''}.`);
  if (matched < MIN_MATCHED) throw new Error(`Seulement ${matched} références rapprochées : fichier gardé tel quel.`);
  if (r.changed) {
    const json = JSON.stringify(r.file);
    writeFileSync(OUT, json);
    console.log(`${OUT} mis à jour (${r.file.version}, ${Object.keys(r.file.produits).length} références, ${Math.round(json.length / 1024)} Ko).`);
  } else console.log(`${OUT} : rien de changé (${r.file.version}).`);
} catch (e) {
  failed = true;
  console.error(`::error::Composition ANSES : ${e instanceof Error ? e.message : String(e)} (dernier fichier valide gardé)`);
}

// Codes-barres de la dernière composition valide dans la liste Douane (même en cas d'échec ci-dessus).
const refs = readJson<ReferenceFile>(REFS);
const comp = readJson<CompositionFile>(OUT);
if (refs && comp) {
  const next = applyAnsesBarcodes(refs, comp);
  if (next !== refs) {
    writeFileSync(REFS, JSON.stringify(next));
    console.log(`${REFS} : codes-barres ANSES ajoutés (${next.version}).`);
  }
}
if (failed) process.exit(1);
