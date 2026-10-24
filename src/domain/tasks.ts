import type { Service, Task } from './types';

export const SERVICES: { id: Service; label: string }[] = [
  { id: 'matin', label: 'Matin' },
  { id: 'apres-midi', label: 'Après-midi' },
];

/** Liste de base, la même le matin et l'après-midi, dans l'ordre donné par le gérant (le grattage deux fois). */
const BASE = [
  'Vérifier stock grattage',
  'Vérifier stock cigarettes',
  'Remplir le linéaire',
  'Remplir la vitrine',
  "Nettoyer l'espace de travail",
  'Vérifier stock tabletterie',
  'Vérifier stock grattage',
  'Remplir la machine à café',
  "Nettoyer l'espace client",
];

/**
 * Liste de base : ids fixes (`base:matin-1`… `base:apres-midi-9`), la même sur chaque téléphone (créée sans opération
 * partagée, comme les lignes de jeu).
 */
export const BASE_TASKS: Task[] = SERVICES.flatMap((s) => BASE.map((label, i) => ({ id: `base:${s.id}-${i + 1}`, label, service: s.id, order: i + 1, doneAt: 0 })));

/** Première liste de base (6 le matin, 3 l'après-midi, ids `base:1`… `base:9`), remplacée par BASE_TASKS. */
export const LEGACY_BASE_TASKS: Pick<Task, 'id' | 'label' | 'service'>[] = ([
  ['matin', 'Vérifier stock grattage'], ['matin', 'Vérifier stock cigarettes'], ['matin', 'Vérifier stock tabletterie'],
  ['matin', 'Remplir le linéaire'], ['matin', 'Remplir la vitrine'], ['matin', 'Remplir la machine à café'],
  ['apres-midi', 'Vérifier stock grattage'], ['apres-midi', "Nettoyer l'espace de travail"], ['apres-midi', "Nettoyer l'espace client"],
] as [Service, string][]).map(([service, label], i) => ({ id: `base:${i + 1}`, label, service }));

const dayOf = (ms: number) => new Date(ms).toDateString();

/** Faite aujourd'hui (heure du téléphone) : une tâche cochée hier apparaît décochée, sans rien écrire. */
export function isDoneToday(t: Task, now: number): boolean {
  return t.doneAt > 0 && dayOf(t.doneAt) === dayOf(now);
}

/** Tâches visibles d'un service, dans l'ordre. */
export function serviceTasks(tasks: Task[], s: Service): Task[] {
  return tasks.filter((t) => t.service === s && t.deleted !== true).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Rang d'une tâche ajoutée en fin de service. */
export function nextOrder(list: Task[]): number {
  return list.length ? Math.max(...list.map((t) => t.order)) + 1 : 1;
}

const MIN_GAP = 1e-6;

/**
 * Rang de la tâche `movedId` placée à l'index `toIndex` de `list` (un service, dans l'ordre) : milieu des deux voisines,
 * première − 1 en tête, dernière + 1 en fin. Écart trop petit : tout le service est renuméroté 1, 2, 3… (nouvel ordre).
 */
export function orderAt(list: Task[], movedId: string, toIndex: number): { order: number } | { renumber: { id: string; order: number }[] } {
  const moved = list.find((t) => t.id === movedId);
  if (!moved) return { order: 0 };
  const rest = list.filter((t) => t.id !== movedId);
  const i = Math.max(0, Math.min(toIndex, rest.length));
  const before = rest[i - 1];
  const after = rest[i];
  if (list.indexOf(moved) === i) return { order: moved.order };
  if (!before) return { order: after.order - 1 };
  if (!after) return { order: before.order + 1 };
  if (after.order - before.order < MIN_GAP) {
    const next = [...rest.slice(0, i), moved, ...rest.slice(i)];
    return { renumber: next.map((t, n) => ({ id: t.id, order: n + 1 })) };
  }
  return { order: (before.order + after.order) / 2 };
}

/** Faites aujourd'hui / visibles. */
export function doneCount(tasks: Task[], now: number): { done: number; total: number } {
  const visible = tasks.filter((t) => t.deleted !== true);
  return { done: visible.filter((t) => isDoneToday(t, now)).length, total: visible.length };
}
