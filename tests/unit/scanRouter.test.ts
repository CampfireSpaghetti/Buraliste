import { describe, it, expect } from 'vitest';
import { routeScan } from '../../src/features/scanner/scanRouter';
import type { Product } from '../../src/domain/types';

const prod = { id: 'p1' } as Product;
const game = { id: 'g1' } as Product;

describe('routeScan (mode consultation)', () => {
  it('produit connu : ouvre la fiche', () => {
    expect(routeScan({ type: 'product', product: prod }, 'lookup')).toEqual({ to: 'product', id: 'p1' });
  });
  it('EAN inconnu : écran de rattachement (création en option)', () => {
    expect(routeScan({ type: 'unknown-ean', code: '3017620422003' }, 'lookup')).toEqual({ to: 'attach', code: '3017620422003' });
  });
  it('code de ticket incertain : demande le jeu', () => {
    expect(routeScan({ type: 'ask-game', code: '0417', candidates: [game] }, 'lookup')).toEqual({ to: 'which-game', code: '0417', candidateIds: ['g1'] });
  });
  it('aucun jeu connu : création d’un jeu', () => {
    expect(routeScan({ type: 'new-game', code: '0417' }, 'lookup')).toEqual({ to: 'create', code: '0417', kind: 'jeu-fdj' });
  });
  it('préfixe du catalogue à confirmer : « Ce ticket est-il un … ? »', () => {
    expect(routeScan({ type: 'confirm-game', code: '871050010001', product: game, prefix: '87105' }, 'lookup')).toEqual({ to: 'confirm-game', code: '871050010001', id: 'g1', prefix: '87105' });
  });
  it('code de traçabilité : refusé avec un message, rien n’est ouvert', () => {
    expect(routeScan({ type: 'traceability', code: 'KPL2F01' }, 'lookup')).toEqual({ to: 'refuse', message: 'Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet.' });
  });
});
