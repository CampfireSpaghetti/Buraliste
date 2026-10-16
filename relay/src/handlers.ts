import { buildIssue } from '../../src/domain/sharing.ts';
import type { Contribution } from '../../src/domain/sharing.ts';

// Ce fichier est exécuté tel quel par Node (suppression des types) : pas d'enum, de namespace
// ni de propriété de paramètre, `import type` pour les types, extensions `.ts` dans les imports.

export type Photo = { jusqua: number; iv: string; data: string };
export type Message = { iv: string; data: string };

export interface Store {
  getChannel(canal: string): Promise<{ ecritureHash: string } | null>;
  /** Crée le canal s'il n'existe pas ; renvoie true si c'est cet appel qui l'a créé. */
  createChannel(canal: string, ecritureHash: string, now: number): Promise<boolean>;
  /** Ajoute les messages et renvoie le numéro du dernier. */
  appendMessages(canal: string, msgs: Message[], now: number): Promise<number>;
  listMessages(canal: string, after: number, max: number): Promise<{ n: number; iv: string; data: string }[]>;
  lastN(canal: string): Promise<number>;
  putPhoto(canal: string, photo: Photo, now: number): Promise<void>;
  getPhoto(canal: string): Promise<Photo | null>;
  /** Supprime les messages de numéro ≤ n reçus avant `olderThan`. */
  pruneBefore(canal: string, n: number, olderThan: number): Promise<void>;
}

export type RelayEnv = {
  store: Store;
  githubToken?: string;
  githubRepo: string;
  now: () => number;
  fetch: typeof fetch;
  allowedOrigins: string[];
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PHOTO_BYTES = 1024 * 1024;
const MAX_CODE_LENGTH = 32;
const MAX_PREFIX_LENGTH = 32;
const MAX_REF_LENGTH = 64;
const MAX_MESSAGES = 200;
const MAX_CODES = 200;
const DEFAULT_PAGE = 500;
const CANAL_PER_MINUTE = 120;
const CODES_PER_HOUR = 20;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const PRUNE_AGE = 30 * 24 * HOUR;
const CANAL_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Compteurs de limites, en mémoire. Ils sont rattachés au Store (WeakMap) : chaque Store neuf, donc
 * chaque test, repart de zéro ; dans le Worker, le Store vit autant que l'isolat. Les horodatages
 * viennent de `env.now()`, ce qui permet de piloter le temps dans les tests.
 */
const limiters = new WeakMap<Store, Map<string, number[]>>();

function hit(env: RelayEnv, key: string, limit: number, windowMs: number): boolean {
  let map = limiters.get(env.store);
  if (!map) limiters.set(env.store, (map = new Map()));
  const now = env.now();
  const recent = (map.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    map.set(key, recent);
    return false;
  }
  recent.push(now);
  map.set(key, recent);
  return true;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Lit le corps JSON (objet) en refusant plus de `maxBytes` (64 Ko par défaut, 1 Mo pour la photographie). */
async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'requête trop volumineuse');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, 'requête trop volumineuse');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
  if (!isObj(data)) throw new HttpError(400, 'objet JSON attendu');
  return data;
}

/** Vérifie la clé d'écriture ; le premier envoi dans un canal enregistre son empreinte. */
async function authorize(env: RelayEnv, canal: string, ecriture: unknown): Promise<void> {
  if (!isStr(ecriture) || !ecriture) throw new HttpError(400, 'ecriture manquante');
  const hash = await sha256Hex(ecriture);
  let channel = await env.store.getChannel(canal);
  if (!channel) {
    if (await env.store.createChannel(canal, hash, env.now())) return;
    // Un autre premier envoi a créé le canal entre-temps : on compare à son empreinte.
    channel = await env.store.getChannel(canal);
  }
  if (!channel || channel.ecritureHash !== hash) throw new HttpError(403, 'clé d’écriture refusée');
}

const shortStr = (v: unknown, max: number): v is string => isStr(v) && v.length <= max;

/** Recopie un élément reçu en ne gardant que les champs connus d'une Contribution ; null s'il est invalide. */
function toContribution(v: unknown): Contribution | null {
  if (!isObj(v) || !shortStr(v.ref, MAX_REF_LENGTH)) return null;
  if (v.kind === 'barcode' && shortStr(v.code, MAX_CODE_LENGTH)) return { kind: 'barcode', code: v.code, ref: v.ref };
  if (v.kind === 'fdjPrefix' && shortStr(v.prefix, MAX_PREFIX_LENGTH)) return { kind: 'fdjPrefix', prefix: v.prefix, ref: v.ref };
  return null;
}

async function postMessages(req: Request, env: RelayEnv, canal: string): Promise<Record<string, unknown>> {
  const body = await readJson(req);
  const list = body.messages;
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'messages manquants');
  if (list.length > MAX_MESSAGES) throw new HttpError(413, 'trop de messages');
  const msgs: Message[] = [];
  for (const m of list) {
    if (!isObj(m) || !isStr(m.iv) || !isStr(m.data)) throw new HttpError(400, 'message invalide');
    msgs.push({ iv: m.iv, data: m.data });
  }
  await authorize(env, canal, body.ecriture);
  return { dernier: await env.store.appendMessages(canal, msgs, env.now()) };
}

async function getMessages(url: URL, env: RelayEnv, canal: string): Promise<Record<string, unknown>> {
  const intParam = (name: string, fallback: number) => {
    const raw = url.searchParams.get(name);
    const v = raw === null ? NaN : Number(raw);
    return Number.isInteger(v) && v >= 0 ? v : fallback;
  };
  const after = intParam('apres', 0);
  const max = Math.min(Math.max(intParam('max', DEFAULT_PAGE), 1), DEFAULT_PAGE);
  const messages = await env.store.listMessages(canal, after, max);
  return { messages, dernier: await env.store.lastN(canal) };
}

async function putPhoto(req: Request, env: RelayEnv, canal: string): Promise<Record<string, unknown>> {
  const body = await readJson(req, MAX_PHOTO_BYTES);
  const { jusqua, iv, data } = body;
  if (typeof jusqua !== 'number' || !Number.isInteger(jusqua) || jusqua < 0 || !isStr(iv) || !isStr(data)) {
    throw new HttpError(400, 'photographie invalide');
  }
  await authorize(env, canal, body.ecriture);
  const previous = await env.store.getPhoto(canal);
  // Une photographie plus ancienne que celle en place (publiée entre-temps par un autre téléphone) est refusée.
  if (previous && jusqua < previous.jusqua) throw new HttpError(409, 'photographie plus récente déjà publiée');
  const now = env.now();
  await env.store.putPhoto(canal, { jusqua, iv, data }, now);
  // Ménage : les messages couverts par la photographie précédente et vieux de plus de 30 jours.
  if (previous) await env.store.pruneBefore(canal, previous.jusqua, now - PRUNE_AGE);
  return { ok: true };
}

async function postCodes(req: Request, env: RelayEnv): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.githubToken) throw new HttpError(503, 'envoi des codes indisponible');
  const ip = req.headers.get('CF-Connecting-IP') ?? 'inconnue';
  if (!hit(env, 'ip:' + ip, CODES_PER_HOUR, HOUR)) throw new HttpError(429, 'trop de requêtes');
  const body = await readJson(req);
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'items manquants');
  if (items.length > MAX_CODES) throw new HttpError(413, 'trop de codes');
  const contributions = items.map(toContribution);
  if (contributions.some((c) => c === null)) throw new HttpError(400, 'item invalide');
  const issue = buildIssue(contributions as Contribution[]);
  let res: Response;
  try {
    res = await env.fetch(`https://api.github.com/repos/${env.githubRepo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'la-carotte-relais',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(issue),
    });
  } catch {
    throw new HttpError(502, 'GitHub injoignable');
  }
  if (!res.ok) throw new HttpError(502, 'GitHub a refusé la contribution');
  return { status: 202, body: { ok: true } };
}

export async function handle(req: Request, env: RelayEnv): Promise<Response> {
  const requestOrigin = req.headers.get('Origin');
  // Sans en-tête Origin (serveur à serveur, tests), la requête est acceptée.
  if (requestOrigin !== null && !env.allowedOrigins.includes(requestOrigin)) {
    return json(403, { erreur: 'origine refusée' }, null);
  }
  const origin = requestOrigin;

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length === 2 && parts[0] === 'v1' && parts[1] === 'codes' && req.method === 'POST') {
      const r = await postCodes(req, env);
      return json(r.status, r.body, origin);
    }

    if (parts.length === 4 && parts[0] === 'v1' && parts[1] === 'canaux' && CANAL_RE.test(parts[2])) {
      const canal = parts[2];
      const sub = parts[3];
      const route =
        sub === 'messages' && (req.method === 'POST' || req.method === 'GET') ? 'messages'
        : sub === 'photo' && (req.method === 'PUT' || req.method === 'GET') ? 'photo'
        : null;
      if (route) {
        if (!hit(env, 'canal:' + canal, CANAL_PER_MINUTE, MINUTE)) throw new HttpError(429, 'trop de requêtes');
        if (route === 'messages') {
          return json(200, req.method === 'POST' ? await postMessages(req, env, canal) : await getMessages(url, env, canal), origin);
        }
        if (req.method === 'PUT') return json(200, await putPhoto(req, env, canal), origin);
        const photo = await env.store.getPhoto(canal);
        return photo ? json(200, photo, origin) : json(404, { erreur: 'aucune photographie' }, origin);
      }
    }

    return json(404, { erreur: 'introuvable' }, origin);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { erreur: e.message }, origin);
    return json(500, { erreur: 'erreur interne' }, origin);
  }
}
