/**
 * Moteur de synchronisation d'un tabac (spec §3.4, §5) :
 * - envoie la file `opsOut`, chiffrée, par messages de 200 opérations au plus (corps de moins de 60 000 octets) ;
 * - reçoit et déchiffre les messages des autres téléphones et les applique (le plus récent gagne, champ par champ) ;
 * - au premier contact, lit la photographie puis seulement les messages qui la suivent ;
 * - publie une photographie au-delà de 500 messages vus depuis la précédente, ou au premier contact d'une base qui a
 *   des données avec un canal vide et sans photographie (le tabac `principal`, sans action du gérant).
 * Les numéros de messages croissent dans un canal, avec des trous : on ne suppose jamais qu'ils se suivent.
 */
import { db as appDb, type CarotteDB } from '../data/db';
import { applyRemoteOps, OPS_QUEUED_EVENT } from '../data/sharedRepo';
import { notifyDataChanged } from '../store';
import { decryptJson, deriveChannel, encryptJson } from './crypto';
import type { Op } from './merge';
import { RelayError, type RelayClient, type Sealed } from './relayClient';
import { applyEtat, buildEtat, hasLocalData, stampLegacy } from './snapshot';

export type SyncStatus = 'ok' | 'attente' | 'hors-ligne' | 'erreur' | 'refuse';
export const SYNC_STATUS_EVENT = 'carotte:sync-status';
/** Message à afficher quand le relais refuse la clé d'écriture (403). */
export const REFUSED_MESSAGE = 'Ce téléphone n’a plus accès à ce tabac';

export type SyncEngine = {
  start(): void;
  stop(): void;
  /** Synchronise maintenant ; pendant une synchronisation, renvoie celle en cours. Ne rejette jamais. */
  syncNow(): Promise<void>;
  status(): SyncStatus;
  /** Délai avant la prochaine tentative après un échec ; `null` si aucune n'est prévue (pas d'échec, ou accès refusé). */
  nextDelayMs(): number | null;
};

export type SyncEngineOptions = {
  relay: RelayClient;
  /** Clé du tabac (base64url, 32 octets). */
  key: string;
  /** Base du tabac (par défaut celle de la page). */
  db?: CarotteDB;
  intervalMs?: number;
  /** Appelé quand des données reçues ont changé la base (par défaut : rafraîchir l'écran). */
  onChange?: () => void;
};

const MAX_OPS_PER_MESSAGE = 200;
const MAX_MESSAGES_PER_POST = 200;
const MAX_POST_BYTES = 60_000;
/** `{"ecriture":"<43 caractères>","messages":[]}` et une marge. */
const POST_OVERHEAD = 100;
/** `{"iv":"<16 caractères>","data":""}`, la virgule et une marge. */
const MESSAGE_OVERHEAD = 50;
/** `{"v":1,"ops":[]}` et une marge. */
const BODY_OVERHEAD = 20;
const PAGE = 500;
const PHOTO_AFTER = 500;
const SEND_DELAY_MS = 2_000;
const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 300_000;

const K_LAST = 'lastN';
const K_SEEN = 'vusDepuisPhoto';
const K_PHOTO_TODO = 'photoAFaire';

const enc = new TextEncoder();
const utf8Length = (s: string) => enc.encode(s).length;
/** Taille d'un message chiffré dans le corps JSON : AES-GCM ajoute 16 octets, puis base64url (×4/3). */
const sealedSize = (plainBytes: number) => Math.ceil(((plainBytes + 16) * 4) / 3) + MESSAGE_OVERHEAD;
const MAX_MESSAGE_BYTES = MAX_POST_BYTES - POST_OVERHEAD;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type Row = { seq: number; op: Op };
type Outgoing = { seqs: number[]; ops: Op[]; size: number };

/**
 * Regroupe la file en envois : messages de 200 opérations au plus, envois de 200 messages au plus et de moins de
 * 60 000 octets. Une opération qui dépasse à elle seule la limite d'un envoi est mise à part (elle bloquerait la file).
 */
function pack(rows: Row[]): { posts: Outgoing[][]; tooBig: number[] } {
  const messages: Outgoing[] = [];
  const tooBig: number[] = [];
  let current: Outgoing & { plain: number } = { seqs: [], ops: [], size: 0, plain: BODY_OVERHEAD };
  const close = () => {
    if (current.ops.length) messages.push({ seqs: current.seqs, ops: current.ops, size: sealedSize(current.plain) });
    current = { seqs: [], ops: [], size: 0, plain: BODY_OVERHEAD };
  };
  for (const row of rows) {
    const bytes = utf8Length(JSON.stringify(row.op)) + 1;
    if (sealedSize(BODY_OVERHEAD + bytes) > MAX_MESSAGE_BYTES) {
      tooBig.push(row.seq);
      continue;
    }
    if (current.ops.length >= MAX_OPS_PER_MESSAGE || sealedSize(current.plain + bytes) > MAX_MESSAGE_BYTES) close();
    current.seqs.push(row.seq);
    current.ops.push(row.op);
    current.plain += bytes;
  }
  close();

  const posts: Outgoing[][] = [];
  let post: Outgoing[] = [];
  let size = 0;
  for (const m of messages) {
    if (post.length && (post.length >= MAX_MESSAGES_PER_POST || size + m.size > MAX_MESSAGE_BYTES)) {
      posts.push(post);
      post = [];
      size = 0;
    }
    post.push(m);
    size += m.size;
  }
  if (post.length) posts.push(post);
  return { posts, tooBig };
}

export function createSyncEngine(opts: SyncEngineOptions): SyncEngine {
  const d = opts.db ?? appDb;
  const { relay, key } = opts;
  const intervalMs = opts.intervalMs ?? 10_000;
  const onChange = opts.onChange ?? notifyDataChanged;

  let channel: Promise<{ canal: string; ecriture: string }> | undefined;
  let inflight: Promise<void> | undefined;
  let failures = 0;
  let refused = false;
  let pending = false;
  let lastEmitted: SyncStatus | undefined;
  let started = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;

  const getState = async (k: string): Promise<unknown> => (await d.syncState.get(k))?.value;
  const numState = async (k: string): Promise<number> => {
    const v = await getState(k);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };

  // ---------------------------------------------------------------- statut

  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  function computeStatus(): SyncStatus {
    if (refused) return 'refuse';
    if (offline()) return 'hors-ligne';
    if (failures > 0) return 'erreur';
    if (pending) return 'attente';
    return 'ok';
  }

  function emitStatus() {
    const s = computeStatus();
    if (s === lastEmitted) return;
    lastEmitted = s;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SyncStatus>(SYNC_STATUS_EVENT, { detail: s }));
  }

  const nextDelayMs = () => (refused || failures === 0 ? null : Math.min(BASE_DELAY_MS * 2 ** failures, MAX_DELAY_MS));

  // ---------------------------------------------------------------- réception

  /** Lit les messages qui suivent `lastN` (page après page), les applique, puis avance `lastN`. */
  async function pull(canal: string): Promise<void> {
    let last = await numState(K_LAST);
    for (;;) {
      const page = await relay.list(canal, last, PAGE);
      const list = Array.isArray(page?.messages) ? page.messages : [];
      const ops: Op[] = [];
      let maxN = last;
      let skipped = 0;
      for (const m of list) {
        if (!isObj(m) || typeof m.n !== 'number' || !Number.isInteger(m.n) || m.n <= last) continue;
        maxN = Math.max(maxN, m.n);
        const body = await decryptJson(key, m);
        if (!isObj(body) || body.v !== 1 || !Array.isArray(body.ops)) {
          skipped++;
          continue;
        }
        for (const op of body.ops) ops.push(op as Op);
      }
      if (skipped) console.warn(`Synchronisation : ${skipped} message(s) illisible(s) ignoré(s).`);
      const changes = ops.length ? await applyRemoteOps(ops, d) : 0;
      if (changes > 0) onChange();
      // Après application seulement. Dernier numéro reçu (pas `dernier` du relais : un message enregistré entre la
      // lecture de la page et celle de `dernier` serait sauté).
      const seen = (await numState(K_SEEN)) + list.length;
      await d.syncState.bulkPut([{ key: K_LAST, value: maxN }, { key: K_SEEN, value: seen }]);
      last = maxN;
      if (list.length < PAGE) return;
    }
  }

  /** Premier contact : photographie (si elle existe) puis messages qui la suivent. */
  async function join(canal: string): Promise<void> {
    const photo = await relay.getPhoto(canal);
    if (photo) {
      const body = await decryptJson(key, photo);
      if (isObj(body) && body.v === 1 && isObj(body.etat) && Number.isInteger(photo.jusqua) && photo.jusqua >= 0) {
        await stampLegacy(d);
        if ((await applyEtat(d, body.etat)) > 0) onChange();
        await d.syncState.bulkPut([{ key: K_LAST, value: photo.jusqua }, { key: K_SEEN, value: 0 }]);
        return;
      }
      console.warn('Synchronisation : photographie illisible ignorée.');
    }
    // Pas de photographie lisible : tout le canal. S'il est vide et sans photographie alors que la base a des
    // données (tabac existant au premier contact avec le relais), son état sera publié.
    const todo = !photo && (await hasLocalData(d));
    await d.syncState.bulkPut([{ key: K_LAST, value: 0 }, { key: K_SEEN, value: 0 }, { key: K_PHOTO_TODO, value: todo }]);
    await pull(canal);
    if (todo && (await numState(K_LAST)) > 0) await d.syncState.put({ key: K_PHOTO_TODO, value: false });
  }

  // ---------------------------------------------------------------- envoi

  async function send(canal: string, ecriture: string): Promise<void> {
    const rows = (await d.opsOut.orderBy('seq').toArray()).filter((r): r is Row => typeof r.seq === 'number');
    if (rows.length === 0) return;
    const { posts, tooBig } = pack(rows);
    if (tooBig.length) {
      console.warn(`Synchronisation : ${tooBig.length} opération(s) trop volumineuse(s) pour le relais, abandonnée(s).`);
      await d.opsOut.bulkDelete(tooBig);
    }
    for (const post of posts) {
      const messages: Sealed[] = [];
      for (const m of post) messages.push(await encryptJson(key, { v: 1, ops: m.ops }));
      await relay.post(canal, { ecriture, messages });
      // Exactement les opérations envoyées : d'autres ont pu être ajoutées entre-temps.
      await d.opsOut.bulkDelete(post.flatMap((m) => m.seqs));
    }
  }

  // ---------------------------------------------------------------- photographie

  async function maybePublish(canal: string, ecriture: string): Promise<void> {
    const todo = (await getState(K_PHOTO_TODO)) === true;
    if (!todo && (await numState(K_SEEN)) <= PHOTO_AFTER) return;
    const jusqua = await numState(K_LAST);
    const sealed = await encryptJson(key, { v: 1, etat: await buildEtat(d) });
    try {
      await relay.putPhoto(canal, { ecriture, jusqua, ...sealed });
    } catch (e) {
      if (!(e instanceof RelayError)) throw e;
      if (e.status === 413) console.error('Synchronisation : photographie trop volumineuse pour le relais, non publiée.');
      // 409 : une photographie plus récente a déjà été publiée par un autre téléphone (compte comme publiée).
      else if (e.status !== 409) throw e;
    }
    await d.syncState.bulkPut([{ key: K_SEEN, value: 0 }, { key: K_PHOTO_TODO, value: false }]);
  }

  // ---------------------------------------------------------------- une synchronisation

  async function refreshPending() {
    try {
      pending = (await d.opsOut.count()) > 0;
    } catch {
      /* base indisponible : statut inchangé */
    }
  }

  function clearRetry() {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  async function run(): Promise<void> {
    try {
      channel ??= deriveChannel(key);
      const { canal, ecriture } = await channel;
      if ((await getState(K_LAST)) === undefined) await join(canal);
      await send(canal, ecriture);
      await pull(canal);
      await maybePublish(canal, ecriture);
      failures = 0;
      refused = false;
      clearRetry();
    } catch (e) {
      if (e instanceof RelayError && e.status === 403) {
        refused = true;
        clearRetry();
        console.warn(`Synchronisation : ${REFUSED_MESSAGE}.`);
      } else {
        failures++;
        console.warn('Synchronisation impossible, nouvelle tentative plus tard.', e);
        clearRetry();
        const delay = nextDelayMs();
        if (started && delay !== null) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void syncNow();
          }, delay);
        }
      }
    }
    await refreshPending();
    emitStatus();
  }

  function syncNow(): Promise<void> {
    if (inflight) return inflight;
    const p = run().finally(() => {
      if (inflight === p) inflight = undefined;
    });
    inflight = p;
    return p;
  }

  // ---------------------------------------------------------------- déclencheurs

  /** Synchronisation automatique : jamais après un refus, ni hors ligne, ni pendant l'attente après un échec. */
  function auto(respectBackoff = true) {
    if (!started || refused || offline()) return;
    if (respectBackoff && retryTimer !== undefined) return;
    void syncNow();
  }

  const onInterval = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') auto();
  };
  const onOnline = () => {
    emitStatus();
    clearRetry();
    auto(false);
  };
  const onOffline = () => emitStatus();
  const onVisibility = () => {
    if (document.visibilityState === 'visible') auto();
  };
  const onQueued = () => {
    if (!started) return;
    pending = true;
    emitStatus();
    if (sendTimer !== undefined) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendTimer = undefined;
      auto();
    }, SEND_DELAY_MS);
  };

  function start() {
    if (started) return;
    started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      window.addEventListener(OPS_QUEUED_EVENT, onQueued);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    interval = setInterval(onInterval, intervalMs);
    emitStatus();
    auto(false);
  }

  function stop() {
    if (!started) return;
    started = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(OPS_QUEUED_EVENT, onQueued);
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (interval !== undefined) clearInterval(interval);
    if (sendTimer !== undefined) clearTimeout(sendTimer);
    interval = undefined;
    sendTimer = undefined;
    clearRetry();
  }

  return { start, stop, syncNow, status: computeStatus, nextDelayMs };
}
