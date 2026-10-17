// Robot GitHub Actions : traite tous les messages « [codes-barres] » encore ouverts (liste fournie par `gh issue list`),
// sauf ceux déjà laissés « à vérifier » (R28), met à jour public/data/codes-barres.json et écrit la réponse de chaque
// message dans un fichier JSON : { "<numéro>": { "text": "…", "review": true|false } }. `review` : laisser ouvert.
// Traiter tous les messages ouverts (et pas seulement celui qui a déclenché le workflow) évite d'en perdre un
// quand GitHub annule une exécution en attente.
import { readFileSync, writeFileSync } from 'node:fs';
import { collectFromIssue, REVIEW_LABEL } from './collectFromIssue.ts';

type ListedIssue = { number: number; title: string; body: string; author: { login: string }; labels?: { name: string }[] };

const [issuesPath, repliesPath, owner] = process.argv.slice(2);
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const issues = (read(issuesPath) as ListedIssue[]).filter((i) => i.title.startsWith('[codes-barres]') && !(i.labels ?? []).some((l) => l.name === REVIEW_LABEL)).sort((a, b) => a.number - b.number);
const refs = read('public/data/references.json');
const fdj = read('public/data/fdj-games.json');
let codes = read('public/data/codes-barres.json');
const today = new Date().toISOString().slice(0, 10);
const replies: Record<number, { text: string; review: boolean }> = {};

for (const i of issues) {
  const r = collectFromIssue({ issue: { number: i.number, title: i.title, body: i.body, user: { login: i.author.login } }, repository: { owner: { login: owner } } }, refs, fdj, codes, today);
  if (r.file) codes = r.file;
  replies[i.number] = { text: r.summary, review: r.review };
  console.log(`#${i.number} : ${r.summary.split('\n')[0]}${r.review ? ' (à vérifier)' : ''}`);
}
writeFileSync('public/data/codes-barres.json', JSON.stringify(codes));
writeFileSync(repliesPath, JSON.stringify(replies));
console.log(`${issues.length} message(s) traité(s).`);
