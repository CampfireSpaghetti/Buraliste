import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIllikoPage } from '../../scripts/fdj/parseIllikoPage';

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
