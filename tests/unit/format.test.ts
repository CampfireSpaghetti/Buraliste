import { describe, it, expect } from 'vitest';
import { formatDateShort, formatStamp, formatDateLong, formatEuro, formatIsoDateFr, shortCode } from '../../src/domain/format';

describe('format', () => {
  const ts = new Date(2026, 9, 16, 18, 42).getTime();
  it('date courte du tableau', () => expect(formatDateShort(ts)).toBe('16/10 18:42'));
  it('horodatage des fichiers', () => expect(formatStamp(ts)).toBe('2026-10-16-1842'));
  it('date longue', () => expect(formatDateLong(ts)).toBe('16/10/2026 18:42'));
  it('euros', () => {
    expect(formatEuro(13).replace(/\s/g, ' ')).toBe('13,00 €');
    expect(formatEuro(0.5).replace(/\s/g, ' ')).toBe('0,50 €');
  });
  it('date d’effet en français', () => {
    expect(formatIsoDateFr('2026-11-01')).toBe('1er novembre 2026');
    expect(formatIsoDateFr('2026-03-15')).toBe('15 mars 2026');
  });
  it('code raccourci aux 6 derniers chiffres', () => {
    expect(shortCode('04170012345678')).toBe('…345678');
    expect(shortCode('0417')).toBe('0417');
    expect(shortCode('')).toBe('—');
  });
});
