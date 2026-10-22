// Passage hebdomadaire sur chaque jeu de fdj-games.json : lit le tableau des lots de sa page fdj.fr, le contrôle et
// construit public/data/fdj-lots.json. Un jeu en échec (page injoignable, d'un autre jeu, tableau incohérent) garde son
// ancienne entrée. Sans aucun changement, le fichier précédent est rendu tel quel (même version : rien à publier).
import { createHash } from 'node:crypto';
import type { FdjItem } from '../../src/domain/fdj.ts';
import type { LotsEntry, LotsFile } from '../../src/domain/lots.ts';
import { checkLots, parseWinningTables, type WinningTable } from './parseWinningTables.ts';

const SITE = 'https://www.fdj.fr';

/** Page du jeu : celle donnée par la liste FDJ (`page`), sinon tirée du nom (« Mots croisés » → /jeux-illiko/mots-croises). */
export function pageUrlFor(item: FdjItem): string {
  if (typeof item.page === 'string' && /^\/jeux-illiko\/[a-z0-9-]+$/.test(item.page)) return SITE + item.page;
  const slug = item.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${SITE}/jeux-illiko/${slug}`;
}

export type LotsFailure = { ref: string; name: string; reason: string; hadEntry: boolean };
export type LotsUpdate = { file: LotsFile; changed: boolean; ok: string[]; failed: LotsFailure[] };

type Options = {
  games: FdjItem[];
  previous?: LotsFile;
  today: string; // AAAA-MM-JJ
  fetchPage: (url: string) => Promise<string>;
  blocFor?: (name: string) => number | undefined;
};

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Entrée du fichier : chance et taux de retour publiés, sinon recalculés depuis le bloc quand il est connu. */
function toEntry(t: WinningTable, bloc: number | undefined, prix: number, source: string, majLe: string): LotsEntry {
  const lots = [...t.lots].sort((a, b) => b.montant - a.montant || b.nombre - a.nombre);
  const count = lots.reduce((s, l) => s + l.nombre, 0);
  const paid = lots.reduce((s, l) => s + l.nombre * l.montant, 0);
  const chance = t.chance ?? (bloc ? round(bloc / count, 2) : undefined);
  const trj = t.trj ?? (bloc ? round((100 * paid) / (prix * bloc), 1) : undefined);
  // Ordre des clés fixe (deux passages identiques donnent le même fichier) ; pas de clé pour une valeur inconnue.
  const entry = { prix } as LotsEntry;
  if (chance !== undefined) entry.chance = chance;
  if (trj !== undefined) entry.trj = trj;
  entry.gainMax = lots[0].montant;
  if (bloc !== undefined) entry.bloc = bloc;
  return Object.assign(entry, { lots, source, majLe });
}

const sameFigures = (a: LotsEntry, b: LotsEntry) => JSON.stringify({ ...a, majLe: '' }) === JSON.stringify({ ...b, majLe: '' });

export async function updateLots({ games, previous, today, fetchPage, blocFor }: Options): Promise<LotsUpdate> {
  const jeux: Record<string, LotsEntry> = {};
  const ok: string[] = [];
  const failed: LotsFailure[] = [];
  const list = games.filter((g) => typeof g.ref === 'string' && g.ref !== '').sort((a, b) => a.ref.localeCompare(b.ref));
  for (const item of list) {
    const old = previous?.jeux?.[item.ref];
    const url = pageUrlFor(item);
    let reason: string | undefined;
    try {
      const t = parseWinningTables(await fetchPage(url));
      const bloc = blocFor?.(item.name);
      if (!t) reason = 'pas de tableau des lots sur la page';
      else if (t.fdjId && t.fdjId !== item.fdjId) reason = `page d'un autre jeu (${t.fdjId})`;
      else if (!checkLots(t, bloc)) reason = 'tableau incohérent (chance, total ou bloc)';
      else {
        const entry = toEntry(t, bloc ?? t.blocPublie, t.prix ?? item.ticketPrice, url, today);
        jeux[item.ref] = old && sameFigures(old, entry) ? old : entry;
        ok.push(item.ref);
        continue;
      }
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    failed.push({ ref: item.ref, name: item.name, reason, hadEntry: !!old });
    if (old) jeux[item.ref] = old;
  }
  const changed = !previous || JSON.stringify(jeux) !== JSON.stringify(previous.jeux);
  if (!changed) return { file: previous!, changed, ok, failed };
  const hash = createHash('sha256').update(JSON.stringify(jeux)).digest('hex').slice(0, 8);
  return { file: { version: `${today}-${hash}`, fetchedAt: today, jeux }, changed, ok, failed };
}
