/** Garde chiffres et lettres, supprime espaces, tirets et autres séparateurs. */
export function normalizeCode(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** EAN-8 ou EAN-13 avec clé de contrôle valide. */
export function isValidEan(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // Poids 3 sur le chiffre le plus proche de la clé, puis alternance 1/3.
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Forme EAN-13 d'un code de commerce : un UPC-A (12 chiffres) ou un GTIN-14 commençant par 0, à clé juste, devient
 * l'EAN-13 équivalent (« 0 » + UPC-A) ; tout autre code est rendu tel quel.
 */
export function retailCode(code: string): string {
  if (/^\d{12}$/.test(code) && isValidEan('0' + code)) return '0' + code;
  if (/^0\d{13}$/.test(code) && isValidEan(code.slice(1))) return code.slice(1);
  return code;
}

/** Écritures d'un même code-barres : un UPC-A (12 chiffres) et son EAN-13 « 0… » (le scanner peut rendre l'une ou l'autre). */
export function barcodeVariants(code: string): string[] {
  if (/^\d{12}$/.test(code) && isValidEan('0' + code)) return [code, '0' + code];
  if (/^0\d{12}$/.test(code) && isValidEan(code)) return [code, code.slice(1)];
  return [code];
}

export function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}
