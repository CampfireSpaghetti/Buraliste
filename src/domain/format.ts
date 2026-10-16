const pad = (n: number) => String(n).padStart(2, '0');

/** « 16/10 18:42 » (heure locale). */
export function formatDateShort(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** « 2026-10-16-1842 », pour les noms de fichiers. */
export function formatStamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** « 16/10/2026 18:42 ». */
export function formatDateLong(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** « 13,00 € » ; « 0,50 € ». */
export function formatEuro(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** « 2026-11-01 » → « 1er novembre 2026 ». */
export function formatIsoDateFr(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${d === 1 ? '1er' : d} ${months[m - 1]} ${y}`;
}
