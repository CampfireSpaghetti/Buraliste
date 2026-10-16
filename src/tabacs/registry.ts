import Dexie from 'dexie';
import { b64uToText, generateTabacKey, textToB64u } from '../sync/crypto.ts';

export type TabacInvite = { name: string; key: string };

const INVITE_PREFIX = 'LACAROTTE2:';
const NAME_MAX = 80;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Contenu du QR code d'invitation à un tabac (contient la clé : à ne montrer qu'aux personnes invitées). */
export function encodeTabacInvite(t: TabacInvite): string {
  return INVITE_PREFIX + textToB64u(JSON.stringify({ name: t.name, key: t.key }));
}

export function decodeTabacInvite(text: string): TabacInvite | undefined {
  if (typeof text !== 'string' || !text.startsWith(INVITE_PREFIX)) return undefined;
  try {
    const p = JSON.parse(b64uToText(text.slice(INVITE_PREFIX.length)));
    if (p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= NAME_MAX && typeof p.key === 'string' && KEY_PATTERN.test(p.key)) {
      return { name: p.name, key: p.key };
    }
  } catch {
    /* QR code d'un autre usage */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Registre des tabacs du téléphone : un tabac = une base IndexedDB + une clé de partage.
// ---------------------------------------------------------------------------

export type TabacEntry = { id: string; name: string; key: string; addedAt: number };
type Registry = { current: string; tabacs: TabacEntry[] };

const STORAGE_KEY = 'carotte:tabacs';
export const PRINCIPAL_ID = 'principal';
const DEFAULT_NAME = 'Mon tabac';

/** Copie en mémoire : sert seulement quand localStorage est indisponible (navigation privée, accès refusé). */
let memory: Registry | undefined;

/** Nom de la base IndexedDB d'un tabac. `principal` garde la base historique « la-carotte ». */
export function dbNameFor(id: string): string {
  return id === PRINCIPAL_ID ? 'la-carotte' : `la-carotte-${id}`;
}

const newPrincipal = (name: string): TabacEntry => ({ id: PRINCIPAL_ID, name, key: generateTabacKey(), addedAt: Date.now() });

const isEntry = (e: unknown): e is TabacEntry => {
  const t = e as Partial<TabacEntry> | null;
  return !!t && typeof t === 'object' && typeof t.id === 'string' && t.id.length > 0 && typeof t.name === 'string'
    && typeof t.key === 'string' && KEY_PATTERN.test(t.key) && typeof t.addedAt === 'number';
};

/** Remet un registre lu en bon état : entrées valides seulement, tabac courant existant ; `undefined` s'il ne reste rien. */
function sanitize(raw: unknown): Registry | undefined {
  const r = raw as Partial<Registry> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.tabacs)) return undefined;
  const seen = new Set<string>();
  const tabacs = r.tabacs.filter((e): e is TabacEntry => isEntry(e) && !seen.has(e.id) && !!seen.add(e.id));
  if (tabacs.length === 0) return undefined;
  const current = tabacs.some((t) => t.id === r.current) ? (r.current as string) : tabacs[0].id;
  return { current, tabacs };
}

function load(defaultName: string): Registry {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return (memory ??= { current: PRINCIPAL_ID, tabacs: [newPrincipal(defaultName)] });
  }
  if (raw !== null) {
    try {
      const ok = sanitize(JSON.parse(raw));
      if (ok) return ok;
    } catch {
      /* JSON corrompu : on repart d'un registre « principal » */
    }
  }
  const fresh: Registry = { current: PRINCIPAL_ID, tabacs: [newPrincipal(defaultName)] };
  save(fresh);
  return fresh;
}

function save(r: Registry): void {
  memory = r;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* gardé en mémoire */
  }
}

/** Au premier lancement, crée « principal » pour la base existante. Sans effet ensuite. */
export function ensureRegistry(defaultName: string = DEFAULT_NAME): void {
  load(defaultName);
}

export const listTabacs = (): TabacEntry[] => load(DEFAULT_NAME).tabacs;

export function currentTabac(): TabacEntry {
  const r = load(DEFAULT_NAME);
  return r.tabacs.find((t) => t.id === r.current) ?? r.tabacs[0];
}

const randomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Crée un tabac (clé neuve) ou en rejoint un (clé de l'invitation). Ne change pas de tabac courant. */
export function addTabac(name: string, key?: string): TabacEntry {
  const r = load(DEFAULT_NAME);
  let id = randomId();
  while (r.tabacs.some((t) => t.id === id) || id === PRINCIPAL_ID) id = randomId();
  const entry: TabacEntry = { id, name, key: key ?? generateTabacKey(), addedAt: Date.now() };
  save({ ...r, tabacs: [...r.tabacs, entry] });
  return entry;
}

/** Change de tabac courant dans le registre (la page doit ensuite être rechargée : voir `switchTabac`). */
export function setCurrentTabac(id: string): void {
  const r = load(DEFAULT_NAME);
  if (r.tabacs.some((t) => t.id === id)) save({ ...r, current: id });
}

export function renameTabac(id: string, name: string): void {
  const r = load(DEFAULT_NAME);
  save({ ...r, tabacs: r.tabacs.map((t) => (t.id === id ? { ...t, name } : t)) });
}

/** Le nom affiché reprend `settings.shopName` (partagé) ; ignoré s'il est vide ou identique. */
export function syncRegistryName(shopName: string): void {
  const name = shopName.trim();
  if (!name) return;
  const cur = currentTabac();
  if (cur.name !== name) renameTabac(cur.id, name);
}

/**
 * Retire un tabac et supprime sa base. Refusé (`false`) s'il est le seul ou s'il n'existe pas.
 * Si c'est le tabac courant, un autre devient courant (la page doit ensuite être rechargée).
 */
export async function removeTabac(id: string): Promise<boolean> {
  const r = load(DEFAULT_NAME);
  if (r.tabacs.length <= 1 || !r.tabacs.some((t) => t.id === id)) return false;
  const tabacs = r.tabacs.filter((t) => t.id !== id);
  save({ current: r.current === id ? tabacs[0].id : r.current, tabacs });
  await Dexie.delete(dbNameFor(id));
  return true;
}

/** Change de tabac : les données sont rechargées depuis la base du nouveau tabac. */
export function switchTabac(id: string): void {
  setCurrentTabac(id);
  location.reload();
}
