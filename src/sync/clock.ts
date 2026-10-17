/**
 * Horloge HLC du téléphone (règles R4/R18) :
 * - identifiant d'appareil : 8 caractères base36 tirés au hasard, créés une fois (`carotte:device`) ;
 * - dernier horodatage connu enregistré (`carotte:hlc`) après chaque tick ou observation, et repris au
 *   démarrage avec `observe()` : un horodatage ne recule jamais d'un rechargement à l'autre.
 * Sans stockage local (navigation privée…), l'horloge fonctionne en mémoire pour la page.
 */
import { createHlc, type Hlc } from './hlc';

const DEVICE_KEY = 'carotte:device';
const HLC_KEY = 'carotte:hlc';
const DEVICE_PATTERN = /^[0-9a-z]{8}$/;
const STAMP = /^\d{13}-\d{4}-.+$/;
/** Partie « heure + compteur » d'un horodatage, comparable comme chaîne. */
const STAMP_PREFIX = 18;

let hlc: Hlc | undefined;
let last = '';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : l'horloge reste en mémoire */
  }
}

function randomDeviceId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

let device: string | undefined;
export function deviceId(): string {
  if (device) return device;
  const saved = read(DEVICE_KEY);
  if (saved && DEVICE_PATTERN.test(saved)) return (device = saved);
  device = randomDeviceId();
  write(DEVICE_KEY, device);
  return device;
}

function clock(): Hlc {
  if (hlc) return hlc;
  hlc = createHlc(deviceId());
  const saved = read(HLC_KEY);
  if (saved && STAMP.test(saved)) {
    hlc.observe(saved);
    last = saved;
  }
  return hlc;
}

/** Nouvel horodatage local, strictement supérieur à tout horodatage émis ou observé. */
export function tick(): string {
  const t = clock().tick();
  last = t;
  write(HLC_KEY, t);
  return t;
}

/** Prend en compte un horodatage reçu (ou déjà enregistré) : les ticks suivants seront plus grands. */
export function observe(t: string): void {
  if (typeof t !== 'string' || !STAMP.test(t)) return;
  clock().observe(t);
  if (t.slice(0, STAMP_PREFIX) > last.slice(0, STAMP_PREFIX)) {
    last = t;
    write(HLC_KEY, t);
  }
}

/** Tests : oublie l'horloge en mémoire (relue depuis le stockage au prochain appel). */
export function resetClockForTests(): void {
  hlc = undefined;
  device = undefined;
  last = '';
}
