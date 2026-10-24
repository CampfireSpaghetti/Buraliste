import { EXPORT_WIDTH, IOS_MAX_CANVAS_PIXELS } from './exportLayout';
import { formatDateLong } from './format';
import { isDoneToday, serviceTasks, visibleSections } from './tasks';
import type { Section, Task } from './types';

/** Mesures (en pixels logiques, avant `scale`) ; en-tête et pied comme l'export du comptage. */
export const TASKS_EXPORT_METRICS = { pad: 48, headerH: 210, gap: 28, sectionH: 76, rowH: 68, totalH: 80, footerH: 64, boxX: 48, labelX: 116, timeRight: 1032 };

export type TasksExportLayout = {
  width: number;
  height: number;
  scale: number;
  header: { shop: string; title: 'Tâches du jour'; stamp: string };
  sections: { y: number; label: string; count: string }[];
  rows: { y: number; label: string; done: boolean; time: string }[];
  totalY: number;
  totalLabel: string;
  footerY: number;
};

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function layoutTasksExport(tasks: Task[], sections: Section[], shop: string, now: number, maxPixels = IOS_MAX_CANVAS_PIXELS): TasksExportLayout {
  const m = TASKS_EXPORT_METRICS;
  let y = m.headerH + m.gap;
  const heads: TasksExportLayout['sections'] = [];
  const rows: TasksExportLayout['rows'] = [];
  let done = 0;
  let total = 0;
  for (const s of visibleSections(sections)) {
    const list = serviceTasks(tasks, s.id);
    const n = list.filter((t) => isDoneToday(t, now)).length;
    heads.push({ y, label: s.label, count: `${n} / ${list.length}` });
    y += m.sectionH;
    for (const t of list) {
      const ok = isDoneToday(t, now);
      rows.push({ y, label: t.label, done: ok, time: ok ? hhmm(t.doneAt) : '' });
      y += m.rowH;
    }
    done += n;
    total += list.length;
  }
  const totalY = y;
  const footerY = totalY + m.totalH;
  const height = footerY + m.footerH;
  const fit = Math.sqrt(maxPixels / (EXPORT_WIDTH * height));
  return {
    width: EXPORT_WIDTH,
    height,
    scale: Math.min(2, Math.floor(fit * 100) / 100),
    header: { shop, title: 'Tâches du jour', stamp: formatDateLong(now) },
    sections: heads,
    rows,
    totalY,
    totalLabel: `${done} / ${total} faites`,
    footerY,
  };
}
