/** Garde chiffres et lettres, supprime espaces, tirets et autres séparateurs. */
export function normalizeCode(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Clé de contrôle GS1 juste : poids 3 sur le chiffre le plus proche de la clé, puis alternance 1/3. */
function checkDigitOk(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** EAN-8 ou EAN-13 avec clé de contrôle valide. */
export function isValidEan(code: string): boolean {
  return /^(\d{8}|\d{13})$/.test(code) && checkDigitOk(code);
}

/**
 * Code de commerce tout en chiffres (EAN-8, UPC-A, EAN-13, GTIN-14) dont la clé de contrôle est fausse : faute de
 * frappe ou code inventé. Les autres codes (lettres, autres longueurs) n'ont pas de clé connue : jamais « faux » ici.
 */
export function hasBadCheckDigit(code: string): boolean {
  return /^(\d{8}|\d{12,14})$/.test(code) && !checkDigitOk(code);
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

/**
 * Écritures d'un même code-barres (le scanner peut rendre l'une ou l'autre) : un UPC-A (12 chiffres) et son EAN-13
 * « 0… » ; un EAN-8 et sa forme complétée de zéros (GTIN-12 « 0000… », GTIN-13 « 00000… », GTIN-14 « 000000… »).
 */
export function barcodeVariants(code: string): string[] {
  const out = [code];
  const add = (c: string) => { if (!out.includes(c)) out.push(c); };
  if (/^\d{12}$/.test(code) && isValidEan('0' + code)) add('0' + code);
  if (/^0\d{12}$/.test(code) && isValidEan(code)) add(code.slice(1));
  // EAN-8 : lu en 8 chiffres par la caméra, déclaré parfois en GTIN-13 / GTIN-14 complété de zéros.
  const ean8 = /^\d{8}$/.test(code) ? code : /^0{4,6}\d{8}$/.test(code) ? code.slice(-8) : undefined;
  if (ean8 && isValidEan(ean8)) for (const c of [ean8, '0000' + ean8, '00000' + ean8, '000000' + ean8]) add(c);
  return out;
}

export function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}
