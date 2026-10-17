/**
 * Invitation à un tabac envoyée par message : un lien vers l'app qui porte l'invitation dans son fragment.
 *
 * Format : `<adresse de l'app>#rejoindre=<invitation sans le préfixe LACAROTTE2:>`. Le reste de l'invitation est déjà
 * en base64url (lettres, chiffres, « - » et « _ ») : il passe tel quel dans une adresse, sans encodage. Le fragment
 * (après « # ») n'est jamais envoyé au serveur ; l'app le retire de l'adresse dès l'ouverture (`takeInviteFromUrl`).
 */
import { decodeTabacInvite, INVITE_PREFIX, type TabacInvite } from './registry';

export const LINK_MARK = '#rejoindre=';

export type ReadInvite = { ok: true; invite: TabacInvite } | { ok: false };

/** Premier bloc de caractères base64url (une messagerie peut coller un point ou un espace après le lien). */
const B64U_RUN = /^[A-Za-z0-9_-]+/;

const fromB64u = (text: string): ReadInvite => {
  const run = B64U_RUN.exec(text)?.[0];
  const invite = run ? decodeTabacInvite(INVITE_PREFIX + run) : undefined;
  return invite ? { ok: true, invite } : { ok: false };
};

/** Lien d'invitation : `base` est l'adresse de l'app (origine + chemin de base, avec « / » final). */
export function inviteLink(payload: string, base: string): string {
  if (!payload.startsWith(INVITE_PREFIX)) throw new Error('pas une invitation');
  return base + LINK_MARK + payload.slice(INVITE_PREFIX.length);
}

/** `undefined` : l'adresse ne porte pas d'invitation ; `{ ok: false }` : lien abîmé ou incomplet. */
export function parseInviteHash(hash: string): ReadInvite | undefined {
  if (typeof hash !== 'string' || !hash.startsWith(LINK_MARK)) return undefined;
  return fromB64u(hash.slice(LINK_MARK.length));
}

/** Texte collé par l'employé : le lien, le message entier qui le contient, ou l'invitation LACAROTTE2: brute. */
export function parsePastedInvite(text: string): ReadInvite {
  const t = typeof text === 'string' ? text : '';
  const link = t.indexOf(LINK_MARK);
  if (link >= 0) return fromB64u(t.slice(link + LINK_MARK.length));
  const raw = t.indexOf(INVITE_PREFIX);
  if (raw >= 0) return fromB64u(t.slice(raw + INVITE_PREFIX.length));
  return { ok: false };
}

/**
 * Au démarrage : lit l'invitation du lien et la retire aussitôt de l'adresse (remplacée dans l'historique, la clé ne
 * reste ni dans la barre d'adresse ni dans « Précédent »). Sans invitation, rien n'est touché.
 */
export function takeInviteFromUrl(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = location,
  hist: Pick<History, 'state' | 'replaceState'> = history,
): ReadInvite | undefined {
  const read = parseInviteHash(loc.hash);
  if (read) hist.replaceState(hist.state, '', loc.pathname + loc.search);
  return read;
}

/** Invitation lue dans l'adresse au démarrage, en attendant que l'écran soit prêt à la proposer. */
let pending: ReadInvite | undefined;
export const setPendingLinkInvite = (r: ReadInvite | undefined) => { pending = r; };
export function takePendingLinkInvite(): ReadInvite | undefined {
  const r = pending;
  pending = undefined;
  return r;
}

/**
 * iPhone ou iPad, dans un onglet du navigateur (pas l'app de l'écran d'accueil) : sur iOS, l'app installée ne voit pas
 * les données de Safari, il faudra y coller le lien.
 */
export function isIosBrowserTab(ua: string, standaloneMedia: boolean, navStandalone: boolean | undefined): boolean {
  return /iPhone|iPad/.test(ua) && !standaloneMedia && navStandalone !== true;
}

export function isIosBrowserTabNow(): boolean {
  try {
    const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
    return isIosBrowserTab(navigator.userAgent, standalone, (navigator as Navigator & { standalone?: boolean }).standalone);
  } catch {
    return false;
  }
}
