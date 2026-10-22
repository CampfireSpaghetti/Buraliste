// Tableau des lots d'un jeu de grattage, lu sur sa page fdj.fr (https://www.fdj.fr/jeux-illiko/<slug>). La page embarque
// l'objet du jeu dans son contenu Next.js : `winningTables` (lignes [nombre de lots, gain]), `winningDescription`
// (« Vous avez 1 chance sur 3,82 … 70% des mises … », parfois « Pour 6 000 000 unités de jeu ») et `bet` (prix, en
// centimes). Ces chiffres sont ceux du règlement du jeu (vérifié sur 5 jeux, rapport du 22/10/2026).
import type { Lot } from '../../src/domain/lots.ts';
import { objectAt, payload } from './parseIllikoPage.ts';

export type WinningTable = {
  prix?: number;        // euros
  lots: Lot[];          // dans l'ordre de la page
  chance?: number;      // « 1 chance sur X » publié
  trj?: number;         // « Y % des mises » publié
  blocPublie?: number;  // « Pour N unités de jeu » publié
  totalPublie?: number; // ligne « 1 793 014 lots » publiée
  fdjId?: string;       // id FDJ du jeu de la page (ITG…)
};

type RawTable = { headers?: unknown[]; datas?: unknown[][] };
type RawGame = { id?: unknown; bet?: unknown; winningDescription?: unknown; winningTables?: unknown };

/** Espaces (insécables et invisibles compris), BOM et « € » retirés. */
const clean = (s: unknown) => String(s ?? '').replace(/[﻿  ​-‍⁠\s€]/g, '');

/** « 2 439 968 », « 500 000 € », « 0,50 € », « 3.81 » → nombre ; autre chose → undefined. */
function num(s: unknown): number | undefined {
  const c = clean(s).replace(',', '.');
  return /^\d+(\.\d+)?$/.test(c) ? Number(c) : undefined;
}

const filled = (t: RawTable) => Array.isArray(t?.datas) && t.datas.some((r) => Array.isArray(r) && r.some((c) => clean(c) !== ''));

/** Le plus petit objet JSON qui contient la clé `"winningTables":[` placée en `at`. */
function objectAround(text: string, at: number): RawGame | undefined {
  for (let p = text.lastIndexOf('{', at); p >= 0 && at - p < 200_000; p = text.lastIndexOf('{', p - 1)) {
    const raw = objectAt(text, p);
    if (!raw || p + raw.length <= at) continue;
    try {
      const o = JSON.parse(raw) as RawGame;
      if (Array.isArray(o.winningTables)) return o;
    } catch {
      // accolade dans une chaîne : on continue plus haut
    }
  }
  return undefined;
}

/** L'objet du jeu de la page : le premier qui a un tableau des lots rempli (les carrousels n'en ont pas). */
function gameObject(text: string): RawGame | undefined {
  for (let at = text.indexOf('"winningTables":['); at >= 0; at = text.indexOf('"winningTables":[', at + 1)) {
    const o = objectAround(text, at);
    if (o && (o.winningTables as RawTable[]).some(filled)) return o;
  }
  return undefined;
}

export function parseWinningTables(html: string): WinningTable | undefined {
  const game = gameObject(payload(html));
  if (!game) return undefined;
  const tables = (game.winningTables as RawTable[]).filter(filled);
  // Plusieurs tableaux (jeu en plusieurs étapes…) : on ne devine pas lequel s'applique au ticket.
  if (tables.length !== 1) return undefined;
  const [table] = tables;
  // Colonnes « Nombre de lots | Gains » d'habitude ; dans l'autre sens si les en-têtes le disent.
  const h = (table.headers ?? []).map((x) => clean(x).toLowerCase());
  const swapped = /gain|montant|euro/.test(h[0] ?? '') && /nombre|lot/.test(h[1] ?? '');
  const [ni, mi] = swapped ? [1, 0] : [0, 1];

  const t: WinningTable = { lots: [] };
  for (const row of table.datas!) {
    if (!Array.isArray(row) || row.every((c) => clean(c) === '')) continue;
    // Ligne de total : « 1 793 014 lots » ou « 536 401 », sans montant.
    const n = clean(row[ni]);
    if (clean(row[mi]) === '') {
      t.totalPublie = num(n.replace(/lots?$/i, ''));
      if (t.totalPublie === undefined) return undefined;
      continue;
    }
    const nombre = num(row[ni]);
    const montant = num(row[mi]);
    if (nombre === undefined || montant === undefined) return undefined;
    t.lots.push({ montant, nombre });
  }
  if (t.lots.length === 0) return undefined;

  if (typeof game.id === 'string') t.fdjId = game.id;
  if (typeof game.bet === 'number' && game.bet > 0) t.prix = game.bet / 100;
  const d = typeof game.winningDescription === 'string' ? game.winningDescription : '';
  const chance = d.match(/1\s*chance\s*sur\s*(\d+(?:[.,]\d+)?)/i);
  if (chance) t.chance = num(chance[1]);
  const trj = d.match(/(\d+(?:[.,]\d+)?)\s*%\s*des\s*mises/i);
  if (trj) t.trj = num(trj[1]);
  const bloc = d.match(/pour\s+(\d[\d\s  ]*?)\s*unit[ée]s?\s+de\s+jeu/i);
  if (bloc) t.blocPublie = num(bloc[1]);
  return t;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01 * b;

/**
 * Le tableau est-il sûr ? Non si : aucune ligne ; un nombre de lots non entier ou un montant nul ; la somme des lots
 * différente du total publié ; un bloc publié sur la page différent du bloc connu (`bloc`, règlement) ; ou, bloc
 * connu, une chance (bloc / nombre de lots) ou un taux de retour recalculés à plus de 1 % des valeurs publiées.
 */
export function checkLots(t: WinningTable, bloc?: number): boolean {
  if (t.lots.length === 0) return false;
  if (!t.lots.every((l) => Number.isInteger(l.nombre) && l.nombre > 0 && Number.isFinite(l.montant) && l.montant > 0)) return false;
  const count = t.lots.reduce((s, l) => s + l.nombre, 0);
  if (t.totalPublie !== undefined && t.totalPublie !== count) return false;
  if (bloc !== undefined && t.blocPublie !== undefined && bloc !== t.blocPublie) return false;
  const b = bloc ?? t.blocPublie;
  if (b === undefined) return true;
  if (count > b) return false;
  if (t.chance !== undefined && !near(b / count, t.chance)) return false;
  if (t.trj !== undefined && t.prix !== undefined) {
    const paid = t.lots.reduce((s, l) => s + l.nombre * l.montant, 0);
    if (!near((100 * paid) / (t.prix * b), t.trj)) return false;
  }
  return true;
}
