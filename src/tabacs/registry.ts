import { b64uToText, textToB64u } from '../sync/crypto.ts';

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
    if (p && typeof p === 'object' && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= NAME_MAX && typeof p.key === 'string' && KEY_PATTERN.test(p.key)) {
      return { name: p.name, key: p.key };
    }
  } catch {
    /* QR code d'un autre usage */
  }
  return undefined;
}
