import { describe, it, expect } from 'vitest';
import { BASE_SECTIONS, BASE_TASKS, doneCount, isDoneToday, nextOrder, orderAt, sectionNeighbour, serviceTasks, visibleSections, visibleTasks } from '../../src/domain/tasks';
import type { Section } from '../../src/domain/types';
import type { Task } from '../../src/domain/types';

const at = (h: number, m = 0, day = 23) => new Date(2026, 9, day, h, m).getTime();
const t = (id: string, order: number, f: Partial<Task> = {}): Task => ({ id, label: id, service: 'matin', order, doneAt: 0, ...f });

describe('tâches', () => {
  it('faite aujourd’hui : seulement si l’heure tombe le jour même (remise à zéro chaque jour)', () => {
    const now = at(10);
    expect(isDoneToday(t('a', 1, { doneAt: at(8) }), now)).toBe(true);
    expect(isDoneToday(t('a', 1, { doneAt: at(23, 59, 22) }), now)).toBe(false);
    expect(isDoneToday(t('a', 1, { doneAt: at(23, 59) }), at(0, 1, 24))).toBe(false);
    expect(isDoneToday(t('a', 1, { doneAt: 0 }), now)).toBe(false);
  });
  it('un service : sans les supprimées, trié par rang puis id', () => {
    const list = [t('c', 2), t('b', 1), t('a', 1), t('x', 0, { service: 'apres-midi' }), t('d', 0, { deleted: true })];
    expect(serviceTasks(list, 'matin').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(serviceTasks(list, 'apres-midi').map((x) => x.id)).toEqual(['x']);
  });
  it('liste de base : la même liste le matin et l’après-midi (9 tâches chacun, le grattage deux fois), ids fixes', () => {
    const LIST = ['Vérifier stock grattage', 'Vérifier stock cigarettes', 'Remplir le linéaire', 'Remplir la vitrine', "Nettoyer l'espace de travail", 'Vérifier stock tabletterie', 'Vérifier stock grattage', 'Remplir la machine à café', "Nettoyer l'espace client"];
    expect(BASE_TASKS).toHaveLength(18);
    expect(serviceTasks(BASE_TASKS, 'matin').map((x) => x.label)).toEqual(LIST);
    expect(serviceTasks(BASE_TASKS, 'apres-midi').map((x) => x.label)).toEqual(LIST);
    expect(BASE_TASKS.map((x) => x.id).slice(0, 2)).toEqual(['base:matin-1', 'base:matin-2']);
    expect(BASE_TASKS.at(-1)!.id).toBe('base:apres-midi-9');
    expect(new Set(BASE_TASKS.map((x) => x.id)).size).toBe(18);
    expect(BASE_TASKS.every((x) => x.doneAt === 0)).toBe(true);
    expect(BASE_SECTIONS).toEqual([{ id: 'matin', label: 'Matin', order: 1 }, { id: 'apres-midi', label: 'Après-midi', order: 2 }]);
  });
  it('déplacer : milieu des voisines, avant la première, après la dernière', () => {
    const list = [t('a', 1), t('b', 2), t('c', 3)];
    expect(orderAt(list, 'c', 0)).toEqual({ order: 0 });
    expect(orderAt(list, 'a', 2)).toEqual({ order: 4 });
    expect(orderAt(list, 'c', 1)).toEqual({ order: 1.5 });
    expect(orderAt(list, 'a', 1)).toEqual({ order: 2.5 });
    expect(orderAt(list, 'b', 1)).toEqual({ order: 2 }); // même place
  });
  it('déplacer : écart trop petit → tout le service renuméroté 1, 2, 3… dans le nouvel ordre', () => {
    const list = [t('a', 1), t('b', 1 + 1e-7), t('c', 3)];
    expect(orderAt(list, 'c', 1)).toEqual({ renumber: [{ id: 'a', order: 1 }, { id: 'c', order: 2 }, { id: 'b', order: 3 }] });
  });
  it('rang d’une nouvelle tâche, et comptes du jour', () => {
    expect(nextOrder([])).toBe(1);
    expect(nextOrder([t('a', 1), t('b', 7.5)])).toBe(8.5);
    const now = at(12);
    expect(doneCount([t('a', 1, { doneAt: at(9) }), t('b', 2), t('c', 3, { doneAt: at(9), deleted: true })], now)).toEqual({ done: 1, total: 2 });
  });
});

describe('titres', () => {
  const sec = (id: string, order: number, deleted = false): Section => ({ id, label: id, order, deleted });
  it('titres visibles, dans l’ordre ; tâches d’un titre supprimé ou inconnu cachées', () => {
    const sections = [sec('b', 2), sec('a', 1), sec('x', 0, true)];
    expect(visibleSections(sections).map((s) => s.id)).toEqual(['a', 'b']);
    const tasks = [t('1', 1, { service: 'a' }), t('2', 1, { service: 'x' }), t('3', 1, { service: 'perdu' }), t('4', 2, { service: 'b', deleted: true })];
    expect(visibleTasks(tasks, sections).map((x) => x.id)).toEqual(['1']);
  });
  it('voisin pour Monter / Descendre (aucun au bord)', () => {
    const sections = [sec('a', 1), sec('b', 2), sec('c', 3), sec('d', 2.5, true)];
    expect(sectionNeighbour(sections, 'b', -1)?.id).toBe('a');
    expect(sectionNeighbour(sections, 'b', 1)?.id).toBe('c');
    expect(sectionNeighbour(sections, 'a', -1)).toBeUndefined();
    expect(sectionNeighbour(sections, 'c', 1)).toBeUndefined();
  });
});
