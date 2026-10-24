import { fold } from './search';
import type { Member } from './types';

/** Membres du tabac (retirés exclus) : gérants d'abord, puis par nom. */
export function visibleMembers(list: Member[]): Member[] {
  return list.filter((m) => m.removed !== true).sort((a, b) =>
    Number(b.role === 'gerant') - Number(a.role === 'gerant') || fold(a.name).localeCompare(fold(b.name), 'fr') || (a.id < b.id ? -1 : 1));
}

const managers = (list: Member[]) => list.filter((m) => m.removed !== true && m.role === 'gerant');

export const hasManager = (list: Member[]): boolean => managers(list).length > 0;

/** Peut faire ce qui est réservé au gérant : sans gérant déclaré, tout le monde (sinon personne ne pourrait). */
export const canManage = (list: Member[], myId: string): boolean => !hasManager(list) || managers(list).some((m) => m.id === myId);

/** Le rôle de gérant peut être retiré à ce membre : jamais au dernier gérant. */
export const canDemote = (list: Member[], id: string): boolean => managers(list).length > 1 && managers(list).some((m) => m.id === id);

/** « actif maintenant », « actif il y a 25 min », « … 2 h », « … 3 jours ». */
export function activeLabel(lastSeen: number, now: number): string {
  if (!lastSeen) return 'jamais vu';
  const min = Math.floor((now - lastSeen) / 60_000);
  if (min < 5) return 'actif maintenant';
  if (min < 60) return `actif il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `actif il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `actif il y a ${d} jour${d > 1 ? 's' : ''}`;
}
