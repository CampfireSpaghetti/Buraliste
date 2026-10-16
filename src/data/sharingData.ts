import { applySharedCodes, buildIssue, contributionsFor, type Contribution, type SharedCodesFile } from '../domain/sharing';
import type { Product } from '../domain/types';
import { db, getSettings, saveSettings } from './db';

export const GITHUB_REPO = 'wongmichel2048/Buraliste';

export async function enqueueContributions(before: Product, after: Product): Promise<number> {
  const items = contributionsFor(before, after);
  if (items.length) await db.outbox.bulkAdd(items.map((i) => ({ ...i, createdAt: Date.now() })));
  return items.length;
}

export const pendingCount = () => db.outbox.count();

let flushing: Promise<{ sent: number; status: string }> | undefined;

/** Envoie la file d'attente en un seul message (issue) au dépôt GitHub. Sans clé ou sans réseau, tout reste en attente. */
export function flushOutbox(fetchFn: typeof fetch = fetch): Promise<{ sent: number; status: string }> {
  flushing ??= (async () => {
    const { shareToken } = await getSettings();
    if (!shareToken) return { sent: 0, status: 'inactif' };
    const queued = await db.outbox.orderBy('createdAt').limit(200).toArray();
    if (queued.length === 0) return { sent: 0, status: 'ok' };
    const items: Contribution[] = queued.map(({ id: _id, createdAt: _at, ...c }) => c as Contribution);
    let res: Response;
    try {
      res = await fetchFn(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${shareToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(buildIssue(items)),
      });
    } catch {
      await saveSettings({ shareStatus: 'hors-ligne' });
      return { sent: 0, status: 'hors-ligne' };
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      await saveSettings({ shareStatus: 'cle-refusee' });
      return { sent: 0, status: 'cle-refusee' };
    }
    if (!res.ok) {
      await saveSettings({ shareStatus: 'erreur' });
      return { sent: 0, status: 'erreur' };
    }
    await db.outbox.bulkDelete(queued.map((q) => q.id!));
    await saveSettings({ shareStatus: 'ok', lastShareAt: Date.now() });
    return { sent: items.length, status: 'ok' };
  })().finally(() => (flushing = undefined));
  return flushing;
}

/** Vérifie qu'une clé est acceptée par GitHub pour ce dépôt (lecture des issues). */
export async function checkToken(token: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${GITHUB_REPO}/issues?per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Reçoit la liste publique des codes partagés (publiée avec l'app) et l'applique aux produits officiels. */
export async function syncSharedCodes(fetchFn: typeof fetch = fetch, force = false): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/codes-barres.json');
  if (!res.ok) throw new Error(`Liste des codes partagés indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as SharedCodesFile;
  if (!force && (await getSettings()).sharedCodesVersion === file.version) return { updated: false, version: file.version };
  await db.transaction('rw', db.products, db.settings, async () => {
    await db.products.bulkPut(applySharedCodes(await db.products.toArray(), file));
    await saveSettings({ sharedCodesVersion: file.version });
  });
  return { updated: true, version: file.version };
}
