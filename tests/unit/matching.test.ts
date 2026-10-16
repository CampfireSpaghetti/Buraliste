import { describe, it, expect } from 'vitest';
import { resolveScan, learnFdjCode, createScanDebouncer, effectiveFields } from '../../src/domain/matching';
import type { Product, ProductFields } from '../../src/domain/types';

function p(id: string, base: Partial<ProductFields>, user: Partial<ProductFields> = {}): Product {
  return { id, source: 'utilisateur', base, user, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 };
}
const game = (id: string, f: Partial<ProductFields>) => p(id, { kind: 'jeu-fdj', name: id, ...f });

describe('effectiveFields', () => {
  it('user l’emporte sur base et les codes sont unis sans doublon', () => {
    const f = effectiveFields(p('a', { kind: 'cigarette', name: 'Base', barcodes: ['1', '2'] }, { name: 'Perso', barcodes: ['2', '3'] }));
    expect(f.name).toBe('Perso');
    expect(f.barcodes).toEqual(['1', '2', '3']);
  });
});

describe('resolveScan', () => {
  const cig = p('cig', { kind: 'cigarette', name: 'Cig', barcodes: ['3017620422003'] });
  const cigUser = p('cig2', { kind: 'cigarette', name: 'Cig2' }, { barcodes: ['96385074'] });
  it('correspondance exacte en couche base', () => {
    expect(resolveScan('3017620422003', [cig])).toEqual({ type: 'product', product: cig });
  });
  it('correspondance exacte en couche user', () => {
    expect(resolveScan('9638 5074', [cig, cigUser])).toMatchObject({ type: 'product', product: { id: 'cig2' } });
  });
  it('EAN valide inconnu', () => {
    expect(resolveScan('4006381333931', [cig])).toEqual({ type: 'unknown-ean', code: '4006381333931' });
  });
  it('code ITF reconnu par préfixe FDJ', () => {
    const cash = game('Cash', { fdjPrefix: '0417' });
    expect(resolveScan('04170012345678', [cash])).toMatchObject({ type: 'product', product: { id: 'Cash' } });
  });
  it('retient le préfixe le plus long', () => {
    const a = game('A', { fdjPrefix: '0417' });
    const b = game('B', { fdjPrefix: '041700' });
    expect(resolveScan('04170012345678', [a, b])).toMatchObject({ product: { id: 'B' } });
  });
  it('demande le jeu, candidats triés par préfixe commun', () => {
    const a = game('A', { barcodes: ['05000000000000'] });
    const b = game('B', { barcodes: ['04179900000000'] });
    const r = resolveScan('04170012345678', [a, b, cig]);
    expect(r.type).toBe('ask-game');
    if (r.type === 'ask-game') expect(r.candidates.map((c) => c.id)).toEqual(['B', 'A']);
  });
  it('aucun jeu connu : nouveau jeu', () => {
    expect(resolveScan('04170012345678', [cig])).toEqual({ type: 'new-game', code: '04170012345678' });
  });
});

describe('learnFdjCode', () => {
  it('apprend le préfixe commun', () => {
    const g = game('Cash', { barcodes: ['04170012345678'] });
    expect(learnFdjCode(g, '04170099999999', [g])).toEqual({ fdjPrefix: '041700' });
  });
  it('généralise depuis un préfixe existant', () => {
    const g = game('Cash', { fdjPrefix: '041700' });
    expect(learnFdjCode(g, '04171111111111', [g])).toEqual({ fdjPrefix: '0417' });
  });
  it('préfixe trop court : ajoute le code exact', () => {
    const g = game('Cash', { barcodes: ['04170012345678'] });
    expect(learnFdjCode(g, '05170012345678', [g])).toEqual({ barcodes: ['04170012345678', '05170012345678'] });
  });
  it('préfixe qui engloberait un autre jeu : ajoute le code exact', () => {
    const g = game('Cash', { barcodes: ['04170012345678'] });
    const other = game('Astro', { barcodes: ['04175555555555'] });
    expect(learnFdjCode(g, '04179999999999', [g, other])).toEqual({ barcodes: ['04170012345678', '04179999999999'] });
  });
});

describe('createScanDebouncer', () => {
  it('ignore le même code dans la fenêtre de 1,5 s', () => {
    const accept = createScanDebouncer();
    expect(accept('A', 0)).toBe(true);
    expect(accept('A', 1000)).toBe(false);
    expect(accept('B', 1100)).toBe(true);
    expect(accept('A', 2600)).toBe(true);
  });
});
