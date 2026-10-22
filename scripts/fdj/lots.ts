// Tableau des lots de chaque jeu de grattage de public/data/fdj-games.json, lu sur sa page fdj.fr : écrit
// public/data/fdj-lots.json, seulement s'il a changé. Un jeu en échec garde son ancienne entrée.
//
// Échec (code de sortie 1, le fichier écrit reste valable) : aucun jeu lu, ou un jeu qui avait un tableau ne se lit plus
// (page modifiée, tableau incohérent) : à vérifier. Un jeu jamais lu (pas de tableau sur sa page) est seulement signalé.
//
//   npm run fdj:lots                     pages téléchargées sur fdj.fr
//   npm run fdj:lots -- --pages <dossier>  pages déjà enregistrées (<dossier>/<slug>.html), sans réseau
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { FdjGamesFile } from '../../src/domain/fdj.ts';
import { blocFor } from './blocs.ts';
import { fetchText } from './fetchText.ts';
import { readPreviousLots, updateLots } from './updateLots.ts';

const GAMES = 'public/data/fdj-games.json';
const OUT = 'public/data/fdj-lots.json';
const headers = { 'User-Agent': 'Mozilla/5.0 (La Carotte; mise a jour hebdomadaire)' };

const dirArg = process.argv.indexOf('--pages');
const pagesDir = dirArg > 0 ? process.argv[dirArg + 1] : undefined;

async function fetchPage(url: string): Promise<string> {
  const slug = url.slice(url.lastIndexOf('/') + 1);
  if (pagesDir) return readFileSync(`${pagesDir}/${slug}.html`, 'utf8');
  await new Promise((r) => setTimeout(r, 500)); // une page à la fois, sans presser le site
  return fetchText(url, { headers }); // 20 s au plus, un nouvel essai
}

const games = (JSON.parse(readFileSync(GAMES, 'utf8')) as FdjGamesFile).items;
const previous = readPreviousLots(existsSync(OUT) ? readFileSync(OUT, 'utf8') : undefined);
const today = new Date().toISOString().slice(0, 10);
const { file, changed, ok, failed } = await updateLots({ games, previous, today, fetchPage, blocFor });

if (changed) writeFileSync(OUT, JSON.stringify(file));
console.log(`${ok.length}/${games.length} tableaux de lots lus${changed ? `, ${OUT} mis à jour (${file.version})` : ', rien de changé'}.`);
for (const f of failed) console.log(`${f.hadEntry ? '::warning::' : ''}${f.name} : ${f.reason}${f.hadEntry ? ' (ancien tableau gardé)' : ''}`);
const lost = failed.filter((f) => f.hadEntry);
if (ok.length === 0 || lost.length > 0) {
  console.error(ok.length === 0 ? 'Aucun tableau de lots lu : les pages fdj.fr ont peut-être changé de format.' : `${lost.length} jeu(x) à vérifier : ${lost.map((f) => f.name).join(', ')}.`);
  process.exit(1);
}
