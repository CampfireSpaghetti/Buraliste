import { describe, it, expect } from 'vitest';
import { layoutTasksExport, TASKS_EXPORT_METRICS as M } from '../../src/domain/tasksExportLayout';
import { BASE_TASKS } from '../../src/domain/tasks';
import type { Task } from '../../src/domain/types';

const now = new Date(2026, 9, 23, 15, 30).getTime();
const at = (h: number, m: number) => new Date(2026, 9, 23, h, m).getTime();

describe('export .jpg de la liste « À faire »', () => {
  it('en-tête, services dans l’ordre, tâches avec heure, total', () => {
    const tasks: Task[] = BASE_TASKS.map((t) => (t.id === 'base:matin-2' ? { ...t, doneAt: at(8, 12) } : t.id === 'base:apres-midi-5' ? { ...t, doneAt: at(14, 5) } : t));
    const l = layoutTasksExport(tasks, 'Tabac du Centre', now);
    expect(l.header).toEqual({ shop: 'Tabac du Centre', title: 'Tâches du jour', stamp: '23/10/2026 15:30' });
    expect(l.sections.map((s) => [s.label, s.count])).toEqual([['Matin', '1 / 9'], ['Après-midi', '1 / 9']]);
    expect(l.rows).toHaveLength(18);
    expect(l.rows[1]).toMatchObject({ label: 'Vérifier stock cigarettes', done: true, time: '08:12' });
    expect(l.rows[0]).toMatchObject({ done: false, time: '' });
    expect(l.rows[13]).toMatchObject({ label: "Nettoyer l'espace de travail", done: true, time: '14:05' });
    expect(l.totalLabel).toBe('2 / 18 faites');
    // Les lignes ne se chevauchent pas, la section Après-midi vient après la dernière tâche du matin.
    expect(l.sections[1].y).toBe(l.rows[8].y + M.rowH);
    expect(l.height).toBe(l.footerY + M.footerH);
    expect(l.scale).toBe(2);
  });
  it('une tâche faite hier compte comme pas faite ; les supprimées n’apparaissent pas', () => {
    const tasks: Task[] = [
      { id: 'a', label: 'Hier', service: 'matin', order: 1, doneAt: new Date(2026, 9, 22, 18).getTime() },
      { id: 'b', label: 'Partie', service: 'matin', order: 2, doneAt: 0, deleted: true },
    ];
    const l = layoutTasksExport(tasks, 'T', now);
    expect(l.rows.map((r) => [r.label, r.done])).toEqual([['Hier', false]]);
    expect(l.sections.map((s) => s.count)).toEqual(['0 / 1', '0 / 0']);
  });
  it('image très haute : échelle réduite sous la limite des canvas iOS', () => {
    const many: Task[] = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, label: `Tâche ${i}`, service: 'matin', order: i, doneAt: 0 }));
    const l = layoutTasksExport(many, 'T', now, 16_777_216);
    expect(1080 * l.height * l.scale ** 2).toBeLessThanOrEqual(16_777_216);
    expect(l.scale).toBeLessThan(2);
  });
});
