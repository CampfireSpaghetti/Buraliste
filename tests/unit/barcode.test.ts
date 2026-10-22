import { describe, it, expect } from 'vitest';
import { normalizeCode, isValidEan, commonPrefix, retailCode, barcodeVariants } from '../../src/domain/barcode';

describe('barcode', () => {
  it('valide la clé EAN-13', () => {
    expect(isValidEan('3017620422003')).toBe(true);
    expect(isValidEan('3017620422004')).toBe(false);
  });
  it('valide la clé EAN-8', () => {
    expect(isValidEan('96385074')).toBe(true);
    expect(isValidEan('96385075')).toBe(false);
  });
  it('refuse les longueurs non EAN et les lettres', () => {
    expect(isValidEan('04170012345678')).toBe(false);
    expect(isValidEan('30176204220AB')).toBe(false);
  });
  it('normalise espaces et tirets', () => {
    expect(normalizeCode(' 3017-6204 22003 ')).toBe('3017620422003');
  });
  it('UPC-A (12 chiffres) et son EAN-13 « 0… » : un même code', () => {
    expect(retailCode('012345678905')).toBe('0012345678905');
    expect(retailCode('00012345678905')).toBe('0012345678905'); // GTIN-14
    expect(retailCode('012345678906')).toBe('012345678906'); // clé fausse : inchangé
    expect(retailCode('3017620422003')).toBe('3017620422003');
    expect(barcodeVariants('012345678905')).toEqual(['012345678905', '0012345678905']);
    expect(barcodeVariants('0012345678905')).toEqual(['0012345678905', '012345678905']);
    expect(barcodeVariants('3017620422003')).toEqual(['3017620422003']);
  });
  it('calcule le préfixe commun', () => {
    expect(commonPrefix('04170012345678', '04170099999999')).toBe('041700');
    expect(commonPrefix('abc', 'xyz')).toBe('');
  });
});
