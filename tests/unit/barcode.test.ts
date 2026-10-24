import { describe, it, expect } from 'vitest';
import { normalizeCode, isValidEan, commonPrefix, retailCode, barcodeVariants, hasBadCheckDigit } from '../../src/domain/barcode';

describe('barcode', () => {
  it('clé de contrôle fausse : EAN-13, UPC-A, EAN-8, GTIN-14 ; les autres codes ne sont jamais « faux »', () => {
    for (const ok of ['3017620422003', '036000291452', '96385074', '10036000291459']) expect(hasBadCheckDigit(ok)).toBe(false);
    for (const bad of ['3017620422004', '036000291453', '96385075', '10036000291458']) expect(hasBadCheckDigit(bad)).toBe(true);
    for (const other of ['ABC123456', '1234567', '12345678901', '123456789012345']) expect(hasBadCheckDigit(other)).toBe(false);
  });

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
  it('EAN-8 complété de zéros (GTIN-13 « 00000… », GTIN-14 « 000000… ») : même code que l\'EAN-8, dans les deux sens', () => {
    expect(barcodeVariants('96385074')).toEqual(expect.arrayContaining(['96385074', '0000096385074', '00000096385074']));
    expect(barcodeVariants('0000096385074')).toEqual(expect.arrayContaining(['0000096385074', '96385074']));
    expect(barcodeVariants('00000096385074')).toEqual(expect.arrayContaining(['00000096385074', '96385074', '0000096385074']));
    // Clé EAN-8 fausse : pas d'équivalence.
    expect(barcodeVariants('0000096385075')).toEqual(['0000096385075']);
    expect(barcodeVariants('96385075')).toEqual(['96385075']);
    // Un EAN-13 ordinaire n'est pas un EAN-8 complété.
    expect(barcodeVariants('3017620422003')).toEqual(['3017620422003']);
  });
  it('calcule le préfixe commun', () => {
    expect(commonPrefix('04170012345678', '04170099999999')).toBe('041700');
    expect(commonPrefix('abc', 'xyz')).toBe('');
  });
});
