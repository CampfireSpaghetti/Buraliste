import { frenchDateToIso } from './parseNomenclature.ts';

/** Renvoie l'URL absolue du fichier ODS dont la date d'effet (lue dans le nom du fichier) est la plus récente. */
export function findLatestOdsUrl(html: string, base = 'https://www.douane.gouv.fr'): string {
  let best: { href: string; date: string } | undefined;
  for (const m of html.matchAll(/href="([^"]+\.ods)"/gi)) {
    const href = m[1].replace(/&amp;/g, '&');
    let name = href.split('/').pop() ?? '';
    try {
      name = decodeURIComponent(name);
    } catch {
      /* nom non décodable : on garde la forme brute */
    }
    const date = frenchDateToIso(name);
    if (date && (!best || date > best.date)) best = { href, date };
  }
  if (!best) throw new Error('Aucun fichier ODS daté trouvé sur la page de la Douane.');
  return new URL(best.href, base).toString();
}
