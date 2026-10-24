/**
 * Fusion champ par champ « le plus récent gagne » (spec §3.3).
 * Module pur : pas de Dexie, pas de DOM. Utilisé pour les écritures locales (tâche 6)
 * comme pour les opérations reçues (tâche 7).
 *
 * Chaque enregistrement garde l'horodatage HLC de chacun de ses champs partagés dans `_clock`.
 * Les clés `user.<champ>` sont stockées dans `record.user` et horodatées sous la clé complète.
 * Les horodatages se comparent comme des chaînes (voir hlc.ts).
 */

export type Op = { e: 'line' | 'product' | 'settings' | 'task' | 'section' | 'snapshot'; id: string; f: Record<string, unknown>; t: string };

export type Clocked<T> = T & { _clock?: Record<string, string> };

/** Copie sans les horodatages internes (pour l'écran, les sauvegardes, ou une écriture à partir d'une lecture). */
export function withoutClock<T extends object>(r: Clocked<T>): T {
  const { _clock: _c, ...rest } = r;
  return rest as T;
}

const USER_PREFIX = 'user.';
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Clés refusées dans une opération reçue : noms dangereux, `user` seul (seuls `user.<champ>` sont
 * valides), `_clock` (réservé), et `user.` sans nom de champ ou avec des points imbriqués.
 * La liste blanche par entité est du ressort de la couche d'écriture (tâche 6).
 */
const isForbidden = (key: string): boolean => {
  if (key === 'user' || key === '_clock') return true;
  if (!key.startsWith(USER_PREFIX)) return FORBIDDEN.has(key);
  const field = key.slice(USER_PREFIX.length);
  return field === '' || field.includes('.') || FORBIDDEN.has(field);
};

/**
 * Applique `f` (champs modifiés, `null` = effacé) à l'horodatage `t`.
 * Un champ n'est remplacé que si son horodatage est absent ou strictement plus ancien que `t`.
 * Renvoie un nouvel enregistrement (l'entrée n'est jamais modifiée).
 */
export function applyFields<T extends object>(
  record: Clocked<T> | undefined,
  f: Record<string, unknown>,
  t: string,
): { record: Clocked<T>; changed: boolean } {
  const base = (record ?? {}) as Record<string, unknown> & { _clock?: Record<string, string> };
  const next: Record<string, unknown> = { ...base };
  const clock: Record<string, string> = { ...(base._clock ?? {}) };
  let user: Record<string, unknown> | undefined;
  let changed = false;

  for (const key of Object.keys(f)) {
    if (isForbidden(key)) continue;
    if (Object.hasOwn(clock, key) && !(t > clock[key])) continue;

    const value = f[key];
    if (key.startsWith(USER_PREFIX)) {
      const field = key.slice(USER_PREFIX.length);
      user ??= { ...((base.user as Record<string, unknown> | undefined) ?? {}) };
      if (value === null) delete user[field];
      else user[field] = value;
    } else if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    clock[key] = t;
    changed = true;
  }

  if (!changed) return { record: (record ?? ({} as Clocked<T>)) as Clocked<T>, changed: false };
  if (user) next.user = user;
  next._clock = clock;
  return { record: next as Clocked<T>, changed: true };
}

/** Égalité structurelle pour des données JSON (tableaux, objets, primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Compare `before` et `after`, champ partagé par champ partagé ; `null` = champ retiré. */
function diffInto(
  out: Record<string, unknown>,
  prefix: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: Iterable<string>,
): void {
  for (const k of keys) {
    const b = before[k] ?? undefined;
    const a = after[k] ?? undefined;
    if (a === undefined) {
      if (b !== undefined) out[prefix + k] = null;
    } else if (!deepEqual(a, b)) {
      out[prefix + k] = a;
    }
  }
}

/**
 * Produit `f` pour une écriture locale. `keys` liste les champs partagés de premier niveau de l'entité ;
 * la clé spéciale `user` est aplatie en `user.<champ>`.
 */
export function diffFields(before: object | undefined, after: object, keys: string[]): Record<string, unknown> {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const plain = keys.filter((k) => k !== 'user');
  diffInto(out, '', b, a, plain);
  if (keys.includes('user')) {
    const bu = (b.user ?? {}) as Record<string, unknown>;
    const au = (a.user ?? {}) as Record<string, unknown>;
    diffInto(out, USER_PREFIX, bu, au, new Set([...Object.keys(bu), ...Object.keys(au)]));
  }
  return out;
}
