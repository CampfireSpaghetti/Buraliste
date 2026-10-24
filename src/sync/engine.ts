/**
 * Moteur de synchronisation d'un tabac (spec §3.4, §5) :
 * - envoie la file `opsOut`, chiffrée, par messages de 200 opérations au plus (corps de moins de 60 000 octets) ;
 * - reçoit et déchiffre les messages des autres téléphones et les applique (le plus récent gagne, champ par champ) ;
 * - au premier contact, lit la photographie puis seulement les messages qui la suivent ;
 * - publie une photographie au-delà de 500 messages vus depuis la précédente, ou au premier contact d'une base qui a
 *   des données avec un canal vide et sans photographie (le tabac `principal`, sans action du gérant).
 * Les numéros de messages croissent dans un canal, avec des trous : on ne suppose jamais qu'ils se suivent.
 * Un relais dont le dernier numéro recule (données effacées, canal changé) est rejoint de nouveau, état republié.
 */
import { db as appDb, REJOIN_ASKED, type CarotteDB } from '../data/db';
import { applyRemoteOps, OPS_QUEUED_EVENT } from '../data/sharedRepo';
import { notifyDataChanged } from '../store';
import { decryptJson, deriveChannel, encryptJson, type Rotation } from './crypto';
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
  /** Envoie un message de contrôle (changement de clé) sur le canal, après les opérations en file. */
  postControl(body: { rotation: Rotation }): Promise<void>;
};

export type SyncEngineOptions = {
  relay: RelayClient;
  /** Clé du tabac (base64url, 32 octets). */
  key: string;
  /** Base du tabac (par défaut celle de la page). */
  db?: CarotteDB;
  intervalMs?: number;
  /** Horloge murale (ms) : date du dernier pull réussi, absence de plus de 25 jours. */
  now?: () => number;
  /** Appelé quand des données reçues ont changé la base (par défaut : rafraîchir l'écran). */
  onChange?: () => void;
  /**
   * Message de changement de clé lu sur le canal (retrait d'un employé) : les opérations d'avant sont appliquées, la
   * lecture de ce canal s'arrête et le moteur aussi. Sans lui, le message est ignoré.
   */
  onRotation?: (rotation: Rotation) => Promise<void> | void;
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
const K_PULL = 'dernierPull';
/**
 * Le relais supprime les messages couverts par la photographie précédente et reçus il y a plus de 30 jours : après
 * 25 jours sans réception, on relit la dernière photographie avant les messages (R24).
 */
const STALE_PULL_MS = 25 * 24 * 3_600_000;

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
 * 60 000 octets. Une opération qui dépasse à elle seule la limite d'un envoi est mise à part (`tooBig`).
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
  const now = opts.now ?? Date.now;

  let channel: Promise<{ canal: string; ecriture: string }> | undefined;
  let inflight: Promise<void> | undefined;
  let failures = 0;
  let refused = false;
  let pending = false;
  /** Opérations en file qui ne pourront jamais partir (trop volumineuses) : gardées, statut « erreur ». */
  let stuck = 0;
  let lastEmitted: SyncStatus | undefined;
  let started = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  /** Changement de clé lu sur le canal : le moteur s'arrête après l'avoir transmis (`onRotation`). */
  let rotated: Rotation | undefined;

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
    if (failures > 0 || stuck > 0) return 'erreur';
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

  /**
   * Lit les messages qui suivent `lastN` (page après page), les applique, puis avance `lastN`.
   * Renvoie true si le relais a moins de messages que ce téléphone n'en a déjà vu (`dernier` < `lastN`) : ses données
   * ont été effacées ou le canal a changé ; rien n'est appliqué, l'appelant rejoint de nouveau le canal.
   */
  async function pull(canal: string): Promise<boolean> {
    let last = await numState(K_LAST);
    for (;;) {
      const page = await relay.list(canal, last, PAGE);
      if (typeof page?.dernier === 'number' && page.dernier < last) return true;
      const list = Array.isArray(page?.messages) ? page.messages : [];
      const ops: Op[] = [];
      let maxN = last;
      let skipped = 0;
      let fresh = 0;
      let rotation: Rotation | undefined;
      // Messages dans l'ordre des numéros : un message de changement de clé arrête la lecture (les suivants sont ignorés).
      const ordered = list.filter((m) => isObj(m) && typeof m.n === 'number' && Number.isInteger(m.n) && m.n > last).sort((a, b) => a.n - b.n);
      for (const m of ordered) {
        fresh++;
        maxN = Math.max(maxN, m.n);
        const body = await decryptJson(key, m);
        if (opts.onRotation && isObj(body) && body.v === 1 && isObj(body.rotation)) {
          rotation = body.rotation as Rotation;
          break;
        }
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
      const seen = (await numState(K_SEEN)) + fresh;
      await d.syncState.bulkPut([{ key: K_LAST, value: maxN }, { key: K_SEEN, value: seen }]);
      if (rotation) {
        rotated = rotation;
        return false;
      }
      if (list.length < PAGE) break;
      if (maxN === last) {
        // Page pleine sans aucun message nouveau : relais défaillant, on s'arrête (pas de boucle sans fin).
        console.warn('Synchronisation : le relais renvoie une page sans message nouveau, lecture arrêtée.');
        break;
      }
      last = maxN;
    }
    await d.syncState.put({ key: K_PULL, value: now() });
    return false;
  }

  /**
   * Relais remis à zéro : ce téléphone oublie sa position dans le canal (et ses compteurs de photographie) puis le
   * rejoint comme au premier contact, ce qui republie son état fusionné (R25, R26). Sinon il attendrait pour toujours
   * des numéros que le relais ne donnera plus, avec un statut « à jour ».
   */
  async function rejoin(canal: string): Promise<void> {
    console.warn('Synchronisation : le relais a perdu les messages de ce tabac, ce téléphone republie son état.');
    await d.syncState.bulkDelete([K_LAST, K_PULL, K_SEEN, K_PHOTO_TODO]);
    await join(canal);
  }

  /** Photographie lisible du canal ; `null` si le relais n'en a pas, `undefined` si elle est illisible. */
  async function readPhoto(canal: string): Promise<{ jusqua: number; etat: Record<string, unknown> } | undefined | null> {
    const photo = await relay.getPhoto(canal);
    if (!photo) return null;
    const body = await decryptJson(key, photo);
    if (isObj(body) && body.v === 1 && isObj(body.etat) && Number.isInteger(photo.jusqua) && photo.jusqua >= 0) {
      return { jusqua: photo.jusqua, etat: body.etat };
    }
    console.warn('Synchronisation : photographie illisible ignorée.');
    return undefined;
  }

  /** Applique une photographie (fusion champ par champ) et reprend la lecture des messages après elle. */
  async function applyPhoto(photo: { jusqua: number; etat: Record<string, unknown> }): Promise<void> {
    await stampLegacy(d);
    if ((await applyEtat(d, photo.etat)) > 0) onChange();
    await d.syncState.bulkPut([{ key: K_LAST, value: photo.jusqua }, { key: K_SEEN, value: 0 }]);
  }

  /** Plus de 25 jours sans réception : les messages manqués ont pu être supprimés ; la photographie les couvre. */
  async function catchUp(canal: string): Promise<void> {
    const photo = await readPhoto(canal);
    if (photo && photo.jusqua > (await numState(K_LAST))) await applyPhoto(photo);
  }

  /** Premier contact : photographie (si elle existe) puis messages qui la suivent. */
  async function join(canal: string): Promise<void> {
    // Premier contact d'une base qui a déjà des données partagées (tabac existant, données d'avant le partage) : son
    // état fusionné est publié à la fin de cette synchronisation, qu'il y ait déjà une photographie ou non (R25, R26),
    // sinon ces données n'atteindraient jamais les autres téléphones (elles ne sont pas dans la file d'envoi).
    // Un téléphone neuf qui rejoint n'a pas de données : il ne publie rien.
    const todo = await hasLocalData(d);
    const photo = await readPhoto(canal);
    if (photo) {
      await applyPhoto(photo);
      await d.syncState.put({ key: K_PHOTO_TODO, value: todo });
      return;
    }
    // Pas de photographie lisible : tout le canal.
    await d.syncState.bulkPut([{ key: K_LAST, value: 0 }, { key: K_SEEN, value: 0 }, { key: K_PHOTO_TODO, value: todo }]);
    await pull(canal);
  }

  // ---------------------------------------------------------------- envoi

  /**
   * Envoie la file. Renvoie true si le relais a numéroté un envoi sans dépasser le dernier numéro déjà vu ici : sur un
   * relais sain, tout nouveau message reçoit un numéro plus grand que tous ceux du canal ; c'est donc une remise à zéro.
   */
  async function send(canal: string, ecriture: string): Promise<boolean> {
    const rows = (await d.opsOut.orderBy('seq').toArray()).filter((r): r is Row => typeof r.seq === 'number');
    stuck = 0;
    if (rows.length === 0) return false;
    const seen = await numState(K_LAST);
    let reset = false;
    const { posts, tooBig } = pack(rows);
    // Une opération plus grosse qu'un envoi (limite du relais : 64 Ko par requête) ne partira jamais. Elle n'est pas
    // effacée (rien ne disparaît sans que le gérant le voie) mais sautée, pour ne pas bloquer les autres ; le statut
    // reste « erreur » tant qu'elle est en file.
    stuck = tooBig.length;
    if (stuck) console.warn(`Synchronisation : ${stuck} opération(s) trop volumineuse(s) pour le relais, non envoyée(s).`);
    for (const post of posts) {
      const messages: Sealed[] = [];
      for (const m of post) messages.push(await encryptJson(key, { v: 1, ops: m.ops }));
      const r = await relay.post(canal, { ecriture, messages });
      if (seen > 0 && typeof r?.dernier === 'number' && r.dernier <= seen) reset = true;
      // Exactement les opérations envoyées : d'autres ont pu être ajoutées entre-temps.
      await d.opsOut.bulkDelete(post.flatMap((m) => m.seqs));
    }
    return reset;
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
      pending = (await d.opsOut.count()) > stuck;
    } catch {
      /* base indisponible : statut inchangé */
    }
  }

  function clearRetry() {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  /**
   * Changement de clé lu : ce canal n'est plus celui du tabac. Le moteur s'arrête (rien d'autre n'y est envoyé ni
   * publié) et transmet le message (`onRotation` : nouvelle clé, ou plus d'accès).
   */
  async function stopForRotation(): Promise<boolean> {
    if (!rotated) return false;
    const r = rotated;
    rotated = undefined;
    stop();
    await opts.onRotation?.(r);
    return true;
  }

  /** Message de contrôle, après une dernière synchronisation (les opérations en file partent d'abord). */
  async function postControl(body: { rotation: Rotation }): Promise<void> {
    await syncNow();
    channel ??= deriveChannel(key);
    const { canal, ecriture } = await channel;
    await relay.post(canal, { ecriture, messages: [await encryptJson(key, { v: 1, ...body })] });
  }

  async function run(): Promise<void> {
    try {
      channel ??= deriveChannel(key);
      const { canal, ecriture } = await channel;
      // Mise à jour de l'app (base v7, liste « À faire ») : la version d'avant ignorait les opérations des tâches. Le
      // téléphone oublie sa position et rejoint le canal, pour récupérer celles déjà créées par les autres téléphones.
      if ((await getState(REJOIN_ASKED)) === true) await d.syncState.bulkDelete([K_LAST, K_PULL, K_SEEN, K_PHOTO_TODO, REJOIN_ASKED]);
      if ((await getState(K_LAST)) === undefined) await join(canal);
      else if (now() - (await numState(K_PULL)) > STALE_PULL_MS) await catchUp(canal);
      if (await stopForRotation()) return;
      const resetOnSend = await send(canal, ecriture);
      const lost = await pull(canal);
      if (await stopForRotation()) return;
      if (lost || resetOnSend) await rejoin(canal);
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
    // Écriture faite pendant la synchronisation (son délai de 2 s a pu tomber pendant qu'elle tournait) : envoi 2 s après.
    if (started && pending && !refused && failures === 0) scheduleSend();
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
  function scheduleSend() {
    if (sendTimer !== undefined) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendTimer = undefined;
      auto();
    }, SEND_DELAY_MS);
  }
  const onQueued = () => {
    if (!started) return;
    pending = true;
    emitStatus();
    scheduleSend();
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

  return { start, stop, syncNow, status: computeStatus, nextDelayMs, postControl };
}
