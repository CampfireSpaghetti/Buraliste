// Fabrique une fixture réduite à partir d'une page de jeu fdj.fr enregistrée (https://www.fdj.fr/jeux-illiko/<slug>,
// ~900 Ko). On garde l'objet du jeu de la page (requête « pageGame » du contenu Next.js : titre, id, prix `bet`,
// `winningDescription`, `winningTables`…) sans ses champs lourds (textes et images), précédé d'un objet de carrousel
// d'un autre jeu (leurre, comme sur la vraie page), le tout coupé en deux appels self.__next_f.push comme sur le site.
//
//   node tests/fixtures/fdj-lots/trim.ts <page enregistrée> <fixture.html> "<date et adresse d'origine>"
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out, origin] = process.argv.slice(2);
const html = readFileSync(src, 'utf8');
const text = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1]) as string).join('');
const at = text.indexOf('"winningTables":[{');
const start = text.indexOf('{', text.lastIndexOf('"state":{"data":', at) + 16);
let depth = 0, inString = false, escaped = false, end = -1;
for (let i = start; i < text.length && end < 0; i++) {
  const c = text[i];
  if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; }
  else if (c === '"') inString = true;
  else if (c === '{') depth++;
  else if (c === '}' && --depth === 0) end = i + 1;
}
const game = JSON.parse(text.slice(start, end)) as Record<string, unknown>;
for (const k of ['editorialContent', 'longDescription', 'summary', 'claim', 'logo', 'logoClear', 'gameLogo', 'background', 'thumbnail', 'legalNotices', 'webTerms', 'pdvTerms', 'gameFilters', 'gameFormulasFilters', 'gameShareJackpotFilters']) delete game[k];
const decoy = { title: 'Astro', bet: '2.00', prize: '25000.00', winning_description: 'Vous avez 1 chance sur 3,20 de remporter un gain et 68,5% des mises sont redistribuées aux joueurs.', winning_tables: [] };
const payload = `0:{"carousel":[${JSON.stringify(decoy)}]}\n1:{"state":{"data":${JSON.stringify(game)}},"queryKey":["pageGame","{\\"slug\\":\\"${game.pageUrl}\\"}"]}\n`;
const cut = Math.floor(payload.length / 2);
const push = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
writeFileSync(out, `<!doctype html><!-- Extrait réduit de ${origin}, fabriqué par tests/fixtures/fdj-lots/trim.ts -->\n${push(payload.slice(0, cut))}\n${push(payload.slice(cut))}\n`);
console.log(`${out} : ${game.title}, ${JSON.stringify(game).length} caractères`);
