import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIllikoPage } from '../../scripts/fdj/parseIllikoPage';
import { GAME_CODES, codesFor } from '../../scripts/fdj/gameCodes';

const html = readFileSync('tests/fixtures/fdj-illiko.html', 'utf8');
const file = parseIllikoPage(html, 'https://www.fdj.fr/jeux-illiko', '2026-10-16');
const byName = (n: string) => file.items.find((i) => i.name === n);

describe('parseIllikoPage', () => {
  it('garde uniquement les jeux de grattage vendus en point de vente, sans doublon', () => {
    expect(file.items.map((i) => i.name).sort()).toEqual(['CASH', 'Goal', 'Mythic Jungle', 'Méga Goal', 'Numéro Fétiche', "Ticket D'Argent"].sort());
  });
  it('exclut les jeux exclusivement en ligne et la roue gratuite', () => {
    expect(byName("L'héritage de Merlin")).toBeUndefined();
    expect(file.items.some((i) => i.name.startsWith('Roue de la Chance'))).toBe(false);
  });
  it('prix du ticket en euros et gain maximum', () => {
    expect(byName('CASH')).toMatchObject({ ref: 'fdj|ITGC9K', fdjId: 'ITGC9K', ticketPrice: 5, maxPrize: 500000 });
    expect(byName('Méga Goal')).toMatchObject({ ticketPrice: 10, maxPrize: 750000 });
    expect(byName('Goal')).toMatchObject({ ticketPrice: 1, maxPrize: 4000, isNew: true });
  });
  it('un « maximum de lots » n’est pas un gain maximum', () => {
    expect(byName('Mythic Jungle')?.maxPrize).toBeUndefined();
  });
  it('version datée avec empreinte', () => {
    expect(file.version).toMatch(/^2026-10-16-[0-9a-f]{8}$/);
    expect(file.fetchedAt).toBe('2026-10-16');
  });
  it('page sans jeux : erreur claire', () => {
    expect(() => parseIllikoPage('<html></html>', 'x', '2026-10-16')).toThrow(/Aucun jeu/);
  });
});

describe('numéros de jeu FDJ (code jeu + émission, table scripts/fdj/gameCodes.ts)', () => {
  it('chaque numéro a 5 chiffres et n’appartient qu’à un jeu', () => {
    const all = Object.values(GAME_CODES).flat();
    expect(all.every((c) => /^\d{5}$/.test(c))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
  it('CASH : code jeu 871, émissions 03, 04 et 05 ; nom comparé sans casse ni accents', () => {
    expect(codesFor('CASH')).toEqual(['87103', '87104', '87105']);
    expect(codesFor('Méga Goal')).toEqual(codesFor('mega goal'));
    expect(codesFor('Jeu inconnu')).toBeUndefined();
  });
  it('parseIllikoPage ajoute les numéros connus à chaque jeu, et la version change avec eux', () => {
    const withCodes = parseIllikoPage(html, 'https://www.fdj.fr/jeux-illiko', '2026-10-16', codesFor);
    expect(withCodes.items.find((i) => i.name === 'CASH')?.codes).toEqual(['87103', '87104', '87105']);
    expect(withCodes.items.find((i) => i.name === "Ticket D'Argent")).not.toHaveProperty('codes');
    expect(withCodes.version).not.toBe(file.version);
  });
});
