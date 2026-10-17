import { describe, it, expect } from 'vitest';
import { rangeProfile } from '../../src/domain/rangeProfile';

const prof = (name: string, kind: 'cigarette' | 'tabac-rouler' = 'cigarette') => rangeProfile({ kind, name, format: /, en (.+)$/.exec(name)?.[1] });

describe('rangeProfile : lecture du nom officiel', () => {
  it('marque, couleur et format', () => {
    expect(prof('Marlboro Red (paquet rigide), en 20 unités')).toMatchObject({ brand: 'Marlboro', color: 'Rouge', rank: 4, count: 20, length: 'normal', pack: 'rigide', type: 'blond' });
    expect(prof('Lucky Strike Bleu XXL, en 30 unités')).toMatchObject({ brand: 'Lucky Strike', color: 'Bleu', rank: 3, count: 30 });
    expect(prof('Marlboro Gold Collection, en 20 unités')).toMatchObject({ brand: 'Marlboro', color: 'Gold', rank: 3 });
  });
  it('longueur : 100s, longues, slims', () => {
    expect(prof("Camel Filters 100's no.1, en 20 unités")).toMatchObject({ brand: 'Camel', color: 'Classique', length: 'long' });
    expect(prof('Rothmans Bleu longues, en 20 unités').length).toBe('long');
    expect(prof('Pall Mall Bleue Slims, en 20 unités')).toMatchObject({ brand: 'Pall Mall', color: 'Bleu', length: 'slim' });
  });
  it('marques en plusieurs mots et « by … »', () => {
    expect(prof('Lucky Strike Bleu by Winfield XXL, en 30 unités').brand).toBe('Lucky Strike');
    expect(prof('Philip Morris Bleue 100s, en 20 unités')).toMatchObject({ brand: 'Philip Morris', color: 'Bleu', length: 'long' });
    expect(prof('Benson & Hedges blue, en 20 unités').brand).toBe('Benson & Hedges');
    expect(prof('Peter Stuyvesant rouge longues (100\'s) by Dunhill, en 20 unités')).toMatchObject({ brand: 'Peter Stuyvesant', color: 'Rouge', length: 'long' });
  });
  it('tabac brun', () => {
    expect(prof('Gauloises Brunes Filtre, en 20 unités')).toMatchObject({ brand: 'Gauloises', type: 'brun' });
    expect(prof('Gauloises Blondes Bleu, en 20 unités')).toMatchObject({ brand: 'Gauloises', type: 'blond', color: 'Bleu' });
    expect(prof('Gitanes Filtre, en 20 unités').type).toBe('brun'); // marque brune : le nom ne le dit pas
    expect(prof('Gitanes Bleu (filtre), en 20 unités').type).toBe('brun');
  });
  it('tabac à rouler : poids', () => {
    expect(prof('Drum bleu (blague), en 30 g', 'tabac-rouler')).toMatchObject({ brand: 'Drum', color: 'Bleu', weight: 30 });
  });
  it('sans couleur reconnue', () => {
    expect(prof('Vogue Lilas Super Slims, en 20 unités')).toMatchObject({ brand: 'Vogue', color: undefined, length: 'slim' });
  });
});
