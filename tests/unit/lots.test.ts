import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkLots, parseWinningTables } from '../../scripts/fdj/parseWinningTables';
import { BLOCS, blocFor } from '../../scripts/fdj/blocs';
import { pageUrlFor, updateLots } from '../../scripts/fdj/updateLots';
import type { FdjItem } from '../../src/domain/fdj';
import type { LotsFile } from '../../src/domain/lots';

const fixture = (name: string) => readFileSync(`tests/fixtures/fdj-lots/${name}.html`, 'utf8');
const sum = (lots: { nombre: number }[]) => lots.reduce((s, l) => s + l.nombre, 0);
const total = (lots: { nombre: number; montant: number }[]) => lots.reduce((s, l) => s + l.nombre * l.montant, 0);

/** Page minimale au format du site (contenu Next.js), pour les cas qu'aucune page enregistrée ne montre. */
function page(game: Record<string, unknown>): string {
  const payload = `1:{"state":{"data":${JSON.stringify({ title: 'Test', id: 'ITGTST', bet: 200, ...game })}}}`;
  return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
}
const table = (datas: string[][], headers = ['Nombre de lots', 'Gains en euros']) => [{ caption: '', subcaption: '', notice: '', headers, datas }];

describe('parseWinningTables (pages de jeu fdj.fr)', () => {
  it('CASH : 10 paliers, 6 289 005 lots pour 84 000 000 €, 1 chance sur 3,82, TRJ 70 %, ticket à 5 €', () => {
    const t = parseWinningTables(fixture('cash'))!;
    expect(t.fdjId).toBe('ITGC9K');
    expect(t.prix).toBe(5);
    expect(t.chance).toBe(3.82);
    expect(t.trj).toBe(70);
    expect(t.lots).toHaveLength(10);
    expect(t.lots[0]).toEqual({ montant: 500000, nombre: 4 });
    expect(t.lots[9]).toEqual({ montant: 5, nombre: 2439968 });
    expect(sum(t.lots)).toBe(6289005);
    expect(total(t.lots)).toBe(84000000);
    expect(t.blocPublie).toBeUndefined();
  });

  it('Millionnaire : BOM, espaces autour des nombres, ligne de total « 1 793 014 lots », TRJ « 73.5% », bloc dans le texte', () => {
    const html = fixture('millionnaire');
    expect(html).toContain('﻿Nombre de lots');
    const t = parseWinningTables(html)!;
    expect(t.prix).toBe(10);
    expect(t.lots).toHaveLength(9);
    expect(t.lots[0]).toEqual({ montant: 1000000, nombre: 4 });
    expect(sum(t.lots)).toBe(1793014);
    expect(total(t.lots)).toBe(44100000);
    expect(t.totalPublie).toBe(1793014);
    expect(t.trj).toBe(73.5);
    expect(t.chance).toBeUndefined(); // la page ne la donne pas : elle est recalculée depuis le bloc
    expect(t.blocPublie).toBe(6000000);
  });

  it('X10 : montants sans « € » et nombre sans espace (« 75010 »)', () => {
    const t = parseWinningTables(fixture('x10'))!;
    expect(t.lots).toContainEqual({ montant: 20, nombre: 75010 });
    expect(sum(t.lots)).toBe(1565622);
    expect(total(t.lots)).toBe(8220000);
    expect(t).toMatchObject({ prix: 2, chance: 3.83, trj: 68.5, blocPublie: 6000000 });
  });

  it('colonnes vides en plus, espaces insécables, « 20 000€ » collé, cote « 3.81 » avec un point, montant décimal', () => {
    const t = parseWinningTables(page({
      winningDescription: 'Vous avez 1 chance sur 3.81 de remporter un gain et 64,50% des mises sont redistribuées aux joueurs.',
      winningTables: table([['2', '20 000€', '', '', ''], ['19 200', '25 €', '', '', ''], ['10', '0,50 €', '', '', ''], ['', '', '', '', '']], ['Nom', 'Gains en euros', '', '', '']),
    }))!;
    expect(t.lots).toEqual([{ montant: 20000, nombre: 2 }, { montant: 25, nombre: 19200 }, { montant: 0.5, nombre: 10 }]);
    expect(t.chance).toBe(3.81);
    expect(t.trj).toBe(64.5);
  });

  it('espace invisible après « € » (Pharaonis), ligne de total sans le mot « lots » (Super 10 ou 200)', () => {
    const t = parseWinningTables(page({ winningTables: table([['2', '30 000 €​'], ['508 580', '10'], ['508 582', ''], ['', '']]) }))!;
    expect(t.lots).toEqual([{ montant: 30000, nombre: 2 }, { montant: 10, nombre: 508580 }]);
    expect(t.totalPublie).toBe(508582);
  });

  it('colonnes inversées (gains puis nombre de lots) : lues dans le bon sens', () => {
    const t = parseWinningTables(page({ winningTables: table([['500 €', '3 000'], ['5 €', '10']], ['Gains en euros', 'Nombre de lots']) }))!;
    expect(t.lots).toEqual([{ montant: 500, nombre: 3000 }, { montant: 5, nombre: 10 }]);
  });

  it('page sans tableau (jeu introuvable, page d’erreur) : undefined', () => {
    expect(parseWinningTables('<html>404</html>')).toBeUndefined();
    expect(parseWinningTables(page({ winningTables: [] }))).toBeUndefined();
  });

  it('cellule illisible : undefined (format changé, on ne devine pas)', () => {
    expect(parseWinningTables(page({ winningTables: table([['4', '500 000 €'], ['beaucoup', '10 €']]) }))).toBeUndefined();
  });
});

describe('checkLots', () => {
  const cash = parseWinningTables(fixture('cash'))!;
  it('CASH avec son bloc de 24 000 000 : cohérent', () => {
    expect(checkLots(cash, 24_000_000)).toBe(true);
  });
  it('bloc inconnu : seulement la cohérence interne', () => {
    expect(checkLots(cash)).toBe(true);
  });
  it('aucune ligne : refusé', () => {
    expect(checkLots({ ...cash, lots: [] })).toBe(false);
  });
  it('chance recalculée (bloc / nombre de lots) à plus de 1 % de la chance publiée : refusé', () => {
    expect(checkLots({ ...cash, lots: cash.lots.slice(0, -1) }, 24_000_000)).toBe(false);
    expect(checkLots({ ...cash, chance: 3.9 }, 24_000_000)).toBe(false);
  });
  it('somme des lots différente du total publié : refusé', () => {
    const m = parseWinningTables(fixture('millionnaire'))!;
    expect(checkLots(m, 6_000_000)).toBe(true);
    expect(checkLots({ ...m, lots: m.lots.slice(1) }, 6_000_000)).toBe(false);
  });
  it('bloc publié sur la page différent du bloc connu (nouveau règlement) : refusé', () => {
    const m = parseWinningTables(fixture('millionnaire'))!;
    expect(checkLots(m, 4_500_000)).toBe(false);
  });
  it('TRJ recalculé différent du TRJ publié : refusé', () => {
    expect(checkLots({ ...cash, trj: 75 }, 24_000_000)).toBe(false);
  });
  it('nombre de lots non entier ou montant nul : refusé', () => {
    expect(checkLots({ ...cash, lots: [{ montant: 10, nombre: 1.5 }] })).toBe(false);
    expect(checkLots({ ...cash, lots: [{ montant: 0, nombre: 3 }] })).toBe(false);
  });
});

describe('table des blocs (scripts/fdj/blocs.ts)', () => {
  it('CASH = 24 000 000 tickets, Millionnaire = 6 000 000 ; nom comparé sans casse ni accents', () => {
    expect(blocFor('CASH')).toBe(24_000_000);
    expect(blocFor('millionnaire')).toBe(6_000_000);
    expect(blocFor('Mega Mots Croises')).toBe(blocFor('Méga Mots Croisés'));
    expect(blocFor('Jeu inconnu')).toBeUndefined();
  });
  it('chaque bloc est un entier positif', () => {
    expect(Object.values(BLOCS).every((b) => Number.isInteger(b) && b > 0)).toBe(true);
  });
});

const item = (id: string, name: string, over: Partial<FdjItem> = {}): FdjItem => ({ ref: 'fdj|' + id, fdjId: id, name, ticketPrice: 5, isNew: false, ...over });
const games = [item('ITGC9K', 'CASH', { page: '/jeux-illiko/cash' }), item('ITGMI4', 'Millionnaire', { ticketPrice: 10 })];
const pages: Record<string, string> = {
  'https://www.fdj.fr/jeux-illiko/cash': fixture('cash'),
  'https://www.fdj.fr/jeux-illiko/millionnaire': fixture('millionnaire'),
};
const fetchFrom = (map: Record<string, string>) => async (url: string) => {
  if (!(url in map)) throw new Error(`${url} → HTTP 404`);
  return map[url];
};

describe('updateLots (passage hebdomadaire sur chaque jeu de fdj-games.json)', () => {
  it('adresse de la page : celle de la liste FDJ, sinon tirée du nom', () => {
    expect(pageUrlFor(item('ITGCBF', 'Chambre Forte', { page: '/jeux-illiko/fdjchambreforte2026' }))).toBe('https://www.fdj.fr/jeux-illiko/fdjchambreforte2026');
    expect(pageUrlFor(item('ITGMO1', 'Mots croisés'))).toBe('https://www.fdj.fr/jeux-illiko/mots-croises');
    expect(pageUrlFor(item('ITGTDO', "Ticket d'Or"))).toBe('https://www.fdj.fr/jeux-illiko/ticket-dor');
  });

  it('écrit une entrée par jeu, clé = ref de fdj-games.json : prix, chance, TRJ, gain maximal, bloc, lots du plus gros au plus petit, source', async () => {
    const r = await updateLots({ games, today: '2026-10-22', fetchPage: fetchFrom(pages), blocFor });
    expect(r.changed).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.file.version).toMatch(/^2026-10-22-[0-9a-f]{8}$/);
    expect(r.file.fetchedAt).toBe('2026-10-22');
    const cash = r.file.jeux['fdj|ITGC9K'];
    expect(cash).toMatchObject({ prix: 5, chance: 3.82, trj: 70, gainMax: 500000, bloc: 24000000, source: 'https://www.fdj.fr/jeux-illiko/cash', majLe: '2026-10-22' });
    expect(sum(cash.lots)).toBe(6289005);
    expect(cash.lots.map((l) => l.montant)).toEqual([...cash.lots.map((l) => l.montant)].sort((a, b) => b - a));
    // Millionnaire : la page ne donne pas la chance, elle est recalculée (6 000 000 / 1 793 014 = 3,35).
    expect(r.file.jeux['fdj|ITGMI4']).toMatchObject({ prix: 10, chance: 3.35, trj: 73.5, gainMax: 1000000, bloc: 6000000 });
  });

  it('bloc inconnu et absent de la page : pas de bloc, la chance publiée est gardée', async () => {
    const r = await updateLots({ games: [games[0]], today: '2026-10-22', fetchPage: fetchFrom(pages), blocFor: () => undefined });
    expect(r.file.jeux['fdj|ITGC9K'].chance).toBe(3.82);
    expect(r.file.jeux['fdj|ITGC9K']).not.toHaveProperty('bloc');
  });

  it('tableau incohérent ignoré : l’ancienne entrée est gardée et le jeu est signalé', async () => {
    const before = await updateLots({ games, today: '2026-10-15', fetchPage: fetchFrom(pages), blocFor });
    const broken = fixture('cash').replace('[\\"2 439 968\\",\\"5 €\\"],', '');
    expect(broken).not.toBe(fixture('cash'));
    const r = await updateLots({ games, previous: before.file, today: '2026-10-22', fetchPage: fetchFrom({ ...pages, 'https://www.fdj.fr/jeux-illiko/cash': broken }), blocFor });
    expect(r.file.jeux['fdj|ITGC9K']).toEqual(before.file.jeux['fdj|ITGC9K']);
    expect(r.failed.map((f) => f.ref)).toEqual(['fdj|ITGC9K']);
    expect(r.failed[0].hadEntry).toBe(true);
  });

  it('page injoignable ou d’un autre jeu : l’ancienne entrée est gardée', async () => {
    const before = await updateLots({ games, today: '2026-10-15', fetchPage: fetchFrom(pages), blocFor });
    const r = await updateLots({ games, previous: before.file, today: '2026-10-22', fetchPage: fetchFrom({ 'https://www.fdj.fr/jeux-illiko/cash': fixture('millionnaire') }), blocFor });
    expect(r.file.jeux).toEqual(before.file.jeux);
    expect(r.failed.map((f) => f.ref).sort()).toEqual(['fdj|ITGC9K', 'fdj|ITGMI4']);
    expect(r.changed).toBe(false);
  });

  it('rien de changé : même version, même date de mise à jour (le fichier n’est pas réécrit)', async () => {
    const before = await updateLots({ games, today: '2026-10-15', fetchPage: fetchFrom(pages), blocFor });
    const r = await updateLots({ games, previous: before.file, today: '2026-10-22', fetchPage: fetchFrom(pages), blocFor });
    expect(r.changed).toBe(false);
    expect(r.file).toEqual(before.file);
  });

  it('un jeu qui n’est plus dans la liste FDJ disparaît du fichier', async () => {
    const before = await updateLots({ games, today: '2026-10-15', fetchPage: fetchFrom(pages), blocFor });
    const r = await updateLots({ games: [games[0]], previous: before.file, today: '2026-10-22', fetchPage: fetchFrom(pages), blocFor });
    expect(Object.keys(r.file.jeux)).toEqual(['fdj|ITGC9K']);
    expect(r.changed).toBe(true);
    expect(r.file.jeux['fdj|ITGC9K'].majLe).toBe('2026-10-15');
  });
});

// Seulement la forme : ce test passe avant chaque publication (workflow), il ne doit pas la bloquer quand la FDJ change
// un tableau (les valeurs sont vérifiées plus haut sur les pages enregistrées).
describe('fichier publié public/data/fdj-lots.json', () => {
  const f = JSON.parse(readFileSync('public/data/fdj-lots.json', 'utf8')) as LotsFile;
  it('versionné, au moins 10 jeux, chaque entrée lisible (lots triés, gain maximal = plus gros lot)', () => {
    expect(f.version).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    expect(Object.keys(f.jeux).length).toBeGreaterThanOrEqual(10);
    for (const [ref, e] of Object.entries(f.jeux)) {
      expect(ref).toMatch(/^fdj\|ITG[A-Z0-9]+$/);
      expect(e.prix).toBeGreaterThan(0);
      expect(e.lots.length).toBeGreaterThan(0);
      expect(e.lots.every((l, i) => Number.isInteger(l.nombre) && l.nombre > 0 && (i === 0 || l.montant <= e.lots[i - 1].montant))).toBe(true);
      expect(e.gainMax).toBe(e.lots[0].montant);
      expect(e.majLe).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
