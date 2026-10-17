import { applySharedCodes, contributionsFor, type Contribution, type SharedCodesFile } from '../domain/sharing';
import type { Product } from '../domain/types';
import { createRelayClient, RelayError } from '../sync/relayClient';
import { relayUrl } from '../sync/relayConfig';
import { db, getSettings, saveSettings } from './db';

export async function enqueueContributions(before: Product, after: Product): Promise<number> {
  const items = contributionsFor(before, after);
  if (items.length) await db.outbox.bulkAdd(items.map((i) => ({ ...i, createdAt: Date.now() })));
  return items.length;
}

export const pendingCount = () => db.outbox.count();

/** Le relais accepte au plus 200 codes par requête. */
const BATCH_SIZE = 200;

type FlushResult = { sent: number; status: string };
let flushing: Promise<FlushResult> | undefined;

type Queued = Contribution & { id?: number; createdAt: number };
const toContribution = ({ id: _id, createdAt: _at, ...c }: Queued): Contribution => c as Contribution;

/**
 * Envoie un lot au relais. Sur un refus « trop gros » (413) ou « contenu invalide » (400), le lot est coupé en deux et
 * chaque moitié est renvoyée ; un code refusé seul est abandonné, sinon il bloquerait toute la file pour toujours.
 * Les autres échecs (429, 5xx, réseau) lèvent l'erreur : le lot reste en file et sera renvoyé plus tard.
 */
async function sendBatch(client: ReturnType<typeof createRelayClient>, batch: Queued[]): Promise<number> {
  try {
    await client.postCodes(batch.map(toContribution));
  } catch (e) {
    if (!(e instanceof RelayError) || (e.status !== 413 && e.status !== 400)) throw e;
    if (batch.length === 1) {
      await db.outbox.bulkDelete([batch[0].id!]);
      return 0;
    }
    const mid = Math.ceil(batch.length / 2);
    return (await sendBatch(client, batch.slice(0, mid))) + (await sendBatch(client, batch.slice(mid)));
  }
  await db.outbox.bulkDelete(batch.map((q) => q.id!));
  return batch.length;
}

/**
 * Envoie la file d'attente au relais (`POST <relais>/v1/codes`), sans aucune clé : c'est le relais qui détient la clé
 * GitHub. Sans relais configuré ou sans réseau, tout reste en attente.
 */
export function flushOutbox(fetchFn: typeof fetch = fetch): Promise<FlushResult> {
  flushing ??= (async () => {
    const base = relayUrl();
    if (!base) return { sent: 0, status: 'inactif' };
    const client = createRelayClient(base, fetchFn);
    let sent = 0;
    for (;;) {
      const queued = (await db.outbox.orderBy('createdAt').limit(BATCH_SIZE).toArray()) as Queued[];
      if (queued.length === 0) break;
      try {
        sent += await sendBatch(client, queued);
      } catch (e) {
        const status = e instanceof RelayError ? 'erreur' : 'hors-ligne';
        await saveSettings(sent > 0 ? { shareStatus: status, lastShareAt: Date.now() } : { shareStatus: status });
        return { sent, status };
      }
    }
    if (sent > 0) await saveSettings({ shareStatus: 'ok', lastShareAt: Date.now() });
    return { sent, status: 'ok' };
  })().finally(() => (flushing = undefined));
  return flushing;
}

/**
 * Les téléphones n'ont plus aucune clé GitHub (le relais la détient) : une clé enregistrée par une ancienne version est
 * effacée au démarrage, avec l'ancien état d'envoi « clé refusée ». Réécriture directe : ces champs ne sont jamais partagés.
 */
export async function clearLegacyShareToken(): Promise<void> {
  const row = await db.settings.get('main');
  if (row && ('shareToken' in row || 'shareStatus' in row)) {
    const { shareToken: _t, shareStatus: _s, ...rest } = row;
    await db.settings.put(rest);
  }
}

/** Reçoit la liste publique des codes partagés (publiée avec l'app) et l'applique aux produits officiels. */
export async function syncSharedCodes(fetchFn: typeof fetch = fetch, force = false): Promise<{ updated: boolean; version: string }> {
  const res = await fetchFn(import.meta.env.BASE_URL + 'data/codes-barres.json');
  if (!res.ok) throw new Error(`Liste des codes partagés indisponible (HTTP ${res.status})`);
  const file = (await res.json()) as SharedCodesFile;
  if (!force && (await getSettings()).sharedCodesVersion === file.version) return { updated: false, version: file.version };
  await db.transaction('rw', db.products, db.settings, db.opsOut, db.syncState, async () => {
    await db.products.bulkPut(applySharedCodes(await db.products.toArray(), file));
    await saveSettings({ sharedCodesVersion: file.version });
  });
  return { updated: true, version: file.version };
}
