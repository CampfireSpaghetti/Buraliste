/**
 * Chiffrement de bout en bout des tabacs partagés (WebCrypto).
 * Le relais ne voit jamais la clé ni un contenu en clair.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const B64URL = /^[A-Za-z0-9_-]*$/;
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Octets → base64url sans remplissage. */
export function bytesToB64u(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → octets ; lève une exception si le texte n'est pas du base64url valide. */
export function b64uToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || !B64URL.test(text)) throw new Error('base64url invalide');
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Texte UTF-8 → base64url (QR codes). */
export function textToB64u(text: string): string {
  return bytesToB64u(enc.encode(text));
}

/** base64url → texte UTF-8 ; lève une exception si invalide. */
export function b64uToText(text: string): string {
  return dec.decode(b64uToBytes(text));
}

/** Clé d'un tabac : 32 octets aléatoires, en base64url (43 caractères). */
export function generateTabacKey(): string {
  return bytesToB64u(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const bytes = b64uToBytes(key);
  if (bytes.length !== KEY_BYTES) throw new Error('clé invalide');
  return bytes;
}

/** Canal (identifiant public du tabac) et clé d'écriture, dérivés de la clé du tabac. */
export async function deriveChannel(key: string): Promise<{ canal: string; ecriture: string }> {
  const raw = keyBytes(key);
  const label = enc.encode('canal');
  const joined = new Uint8Array(raw.length + label.length);
  joined.set(raw);
  joined.set(label, raw.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  const hmacKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode('ecriture')));
  return { canal: bytesToB64u(digest.subarray(0, 16)), ecriture: bytesToB64u(mac) };
}

function aesKey(key: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes(key), 'AES-GCM', false, [usage]);
}

/** AES-256-GCM, IV aléatoire de 12 octets ; iv et data en base64url. */
export async function encryptJson(key: string, value: unknown): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key, 'encrypt'), enc.encode(JSON.stringify(value)));
  return { iv: bytesToB64u(iv), data: bytesToB64u(new Uint8Array(data)) };
}

/** Déchiffre un message ; renvoie undefined (sans jamais lever) si la clé, le contenu ou le JSON sont invalides. */
export async function decryptJson(key: string, msg: { iv: string; data: string }): Promise<unknown | undefined> {
  try {
    const iv = b64uToBytes(msg.iv);
    if (iv.length !== IV_BYTES) return undefined;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(key, 'decrypt'), b64uToBytes(msg.data));
    return JSON.parse(dec.decode(plain));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- changement de clé (retrait d'un employé)

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** Paire de clés d'un téléphone pour un tabac : la publique (base64url) est partagée, la privée reste sur le téléphone. */
export async function generateDeviceKeys(): Promise<{ pub: string; priv: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const pub = bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { pub, priv: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

/** Nouvelle clé du tabac chiffrée pour chaque téléphone restant (clé éphémère `epub`, AES-GCM, id en données associées). */
export type Rotation = { epub: string; wraps: Record<string, { iv: string; data: string }> };

const importPub = (pub: string) => crypto.subtle.importKey('raw', b64uToBytes(pub), ECDH, false, []);
const sharedKey = (priv: CryptoKey, pub: CryptoKey, usage: 'encrypt' | 'decrypt') =>
  crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, [usage]);

export async function wrapKeyFor(newKey: string, recipients: { id: string; pub: string }[]): Promise<Rotation> {
  keyBytes(newKey);
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const wraps: Rotation['wraps'] = {};
  for (const r of recipients) {
    let pub: CryptoKey;
    try {
      pub = await importPub(r.pub);
    } catch {
      continue; // téléphone sans clé publique (pas encore à jour) : il devra être réinvité
    }
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(r.id) }, await sharedKey(eph.privateKey, pub, 'encrypt'), enc.encode(newKey));
    wraps[r.id] = { iv: bytesToB64u(iv), data: bytesToB64u(new Uint8Array(data)) };
  }
  return { epub: bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))), wraps };
}

/** Nouvelle clé du tabac pour ce téléphone ; `undefined` s'il n'est pas dans la liste ou si rien ne se déchiffre. */
export async function unwrapKey(rot: Rotation, id: string, priv: JsonWebKey): Promise<string | undefined> {
  const w = rot?.wraps?.[id];
  if (!w || typeof w.iv !== 'string' || typeof w.data !== 'string') return undefined;
  try {
    const mine = await crypto.subtle.importKey('jwk', priv, ECDH, false, ['deriveKey']);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64uToBytes(w.iv), additionalData: enc.encode(id) },
      await sharedKey(mine, await importPub(rot.epub), 'decrypt'),
      b64uToBytes(w.data),
    );
    const key = dec.decode(plain);
    keyBytes(key);
    return key;
  } catch {
    return undefined;
  }
}
