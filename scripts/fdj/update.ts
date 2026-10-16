// Récupère la gamme des jeux de grattage vendus en point de vente (page des jeux de fdj.fr) et écrit public/data/fdj-games.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseIllikoPage } from './parseIllikoPage.ts';

const PAGE = 'https://www.fdj.fr/jeux-illiko';
const OUT = 'public/data/fdj-games.json';
const MIN_ITEMS = 15; // en dessous, la page a probablement changé de format

const res = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (La Carotte; mise a jour hebdomadaire)' } });
if (!res.ok) throw new Error(`${PAGE} → HTTP ${res.status}`);
const today = new Date().toISOString().slice(0, 10);
const file = parseIllikoPage(await res.text(), PAGE, today);
if (file.items.length < MIN_ITEMS) throw new Error(`Seulement ${file.items.length} jeux lus : la page fdj.fr a peut-être changé de format.`);
mkdirSync('public/data', { recursive: true });
writeFileSync(OUT, JSON.stringify(file));
console.log(`${file.items.length} jeux de grattage en point de vente (${PAGE})`);
