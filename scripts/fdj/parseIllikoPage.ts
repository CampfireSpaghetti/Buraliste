import { createHash } from 'node:crypto';
import type { FdjGamesFile, FdjItem } from '../../src/domain/fdj.ts';

type RawGame = {
  id: string; title: string; bet?: number; prize?: number; prizeType?: string;
  isGrattage?: boolean; isExclusWeb?: boolean; new?: boolean;
};

/** Le site fdj.fr (Next.js) embarque ses données dans des appels self.__next_f.push([1, "…"]). */
function payload(html: string): string {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)];
  return chunks.map((m) => JSON.parse(m[1]) as string).join('');
}

/** Objet JSON équilibré commençant à `start` (accolades comptées hors chaînes). */
function objectAt(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

export function parseIllikoPage(html: string, sourceUrl: string, fetchedAt: string): FdjGamesFile {
  const text = payload(html);
  const items = new Map<string, FdjItem>();
  for (const m of text.matchAll(/\{"title":"[^"]*","id":"ITG[A-Z0-9]+"/g)) {
    const raw = objectAt(text, m.index!);
    if (!raw) continue;
    let g: RawGame;
    try {
      g = JSON.parse(raw);
    } catch {
      continue;
    }
    // Jeux de grattage vendus en point de vente : version « grattage » existante et pas exclusivement en ligne.
    if (!g.isGrattage || g.isExclusWeb || !g.bet || items.has(g.id)) continue;
    const item: FdjItem = { ref: `fdj|${g.id}`, fdjId: g.id, name: g.title.trim(), ticketPrice: g.bet / 100, isNew: !!g.new };
    if (g.prize && /^jusqu/i.test((g.prizeType ?? '').trim())) item.maxPrize = g.prize;
    items.set(g.id, item);
  }
  if (items.size === 0) throw new Error('Aucun jeu de grattage trouvé : la page fdj.fr a peut-être changé de format.');
  const list = [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const hash = createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 8);
  return { version: `${fetchedAt}-${hash}`, fetchedAt, source: sourceUrl, items: list };
}
