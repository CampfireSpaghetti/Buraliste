import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { doneCount, isDoneToday, serviceTasks, visibleSections, visibleTasks } from '../../domain/tasks';
import { layoutTasksExport } from '../../domain/tasksExportLayout';
import type { Section, Service, Task } from '../../domain/types';
import { actions, useSections, useSettings, useTasks } from '../../store';
import { Sheet } from '../../ui/Panel';
import { Toast } from '../../ui/Toast';
import { ImageExportPanel } from '../../ui/ImageExportPanel';
import { TaskSheet } from './TaskSheet';
import { SectionSheet } from './SectionSheet';
import { renderTasksJpg } from './exportTasksJpg';
import './tasks.css';

type ToastState = { message: string; undo?: Task[]; undoSection?: { section: Section; tasks: Task[] } };
type SheetState = { mode: 'new' } | { mode: 'edit'; task: Task };
type SectionSheetState = { mode: 'new' } | { mode: 'edit'; section: Section };
/** Glisser une tâche par sa poignée : `from` (index de départ) → `to` (index visé), dans son service. */
type Drag = { id: string; service: Service; pointerId: number; startY: number; dy: number; from: number; to: number; tops: number[]; heights: number[] };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** « Samedi 24 octobre » (seule la première lettre en capitale). */
const today = (ms: number) => {
  const s = new Date(ms).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function vibrate() {
  try {
    navigator.vibrate?.(15);
  } catch {
    /* vibration indisponible */
  }
}

/** Heure courante, rafraîchie chaque minute et au retour sur l'app : la liste se décoche d'elle-même le lendemain. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

export function TasksScreen() {
  const allTasks = useTasks();
  const allSections = useSections();
  const settings = useSettings();
  const now = useNow();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sectionSheet, setSectionSheet] = useState<SectionSheetState | null>(null);
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Déplacement en cours d'enregistrement : la tâche est montrée tout de suite à sa nouvelle place.
  const [moving, setMoving] = useState<{ id: string; to: number } | null>(null);
  useEffect(() => setMoving(null), [allTasks]);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const closeToast = useCallback(() => setToast(null), []);

  if (!allTasks || !allSections) return null;
  const sections = visibleSections(allSections);
  // Tâches affichées : sous un titre visible (un titre supprimé sur un autre téléphone cache ses tâches).
  const tasks = visibleTasks(allTasks, sections);
  const { done, total } = doneCount(tasks, now);

  const removeSection = async (s: Section) => {
    setSectionSheet(null);
    const before = await actions.deleteSection(s.id);
    setToast({ message: `Titre supprimé : ${s.label}`, undoSection: before });
  };

  const toggle = (t: Task) => {
    vibrate();
    void actions.setTaskDone(t.id, !isDoneToday(t, now));
  };

  const reset = async () => {
    setResetting(false);
    const before = await actions.resetTasks();
    setToast({ message: 'Tâches remises à zéro', undo: before });
  };

  const remove = async (t: Task) => {
    setSheet(null);
    const before = await actions.deleteTask(t.id);
    setToast({ message: `Tâche supprimée : ${t.label}`, undo: [before] });
  };

  const move = (id: string, to: number) => {
    setMoving({ id, to });
    void actions.moveTask(id, to).catch(() => setMoving(null));
  };
  /** Tâches d'un service, avec le déplacement en cours d'enregistrement déjà appliqué. */
  const ordered = (s: Service): Task[] => {
    const list = serviceTasks(tasks, s);
    const i = moving ? list.findIndex((t) => t.id === moving.id) : -1;
    if (!moving || i < 0) return list;
    const rest = list.filter((t) => t.id !== moving.id);
    return [...rest.slice(0, moving.to), list[i], ...rest.slice(moving.to)];
  };

  const startDrag = (e: PointerEvent<HTMLButtonElement>, t: Task, list: Task[]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = list.map((x) => rows.current.get(x.id)?.getBoundingClientRect());
    const from = list.findIndex((x) => x.id === t.id);
    setDrag({
      id: t.id, service: t.service, pointerId: e.pointerId, startY: e.clientY, dy: 0, from, to: from,
      tops: rects.map((r) => r?.top ?? 0), heights: rects.map((r) => r?.height ?? 0),
    });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    const center = drag.tops[drag.from] + drag.heights[drag.from] / 2 + dy;
    const to = drag.tops.filter((top, i) => i !== drag.from && top + drag.heights[i] / 2 < center).length;
    setDrag({ ...drag, dy, to });
  };
  const endDrag = (e: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!cancelled && drag.to !== drag.from) move(drag.id, drag.to);
    setDrag(null);
  };
  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, t: Task, index: number, count: number) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= count) return;
    e.preventDefault();
    move(t.id, to);
  };

  /** Décalage d'une ligne pendant qu'une autre est glissée : elle fait de la place à la position visée. */
  const shift = (service: Service, i: number): number => {
    if (!drag || drag.service !== service) return 0;
    if (i === drag.from) return drag.dy;
    const h = drag.heights[drag.from];
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return h;
    return 0;
  };

  return (
    <div className="tasks">
      <div className="tasks-day">
        <span className="tasks-date">{today(now)}</span>
        <span className="tasks-progress num" aria-label={`${done} tâches faites sur ${total}`}><b>{done}</b> / {total} faites</span>
        <span className="tasks-bar" aria-hidden="true"><span style={{ width: total ? `${(done / total) * 100}%` : 0 }} /></span>
      </div>
      <div className="count-actions">
        <button type="button" className="btn accent" disabled={sections.length === 0} onClick={() => setSheet({ mode: 'new' })}>+ Tâche</button>
        <button type="button" className="btn" onClick={() => setSectionSheet({ mode: 'new' })}>+ Titre</button>
        <button type="button" className="btn primary" disabled={total === 0} onClick={() => setExporting(true)}>Export .jpg</button>
      </div>
      <div className="tasks-tools">
        <span className="muted">Touchez une tâche pour la cocher. ⠿ pour la déplacer.</span>
        <button type="button" className="chip reset-chip" disabled={done === 0} onClick={() => setResetting(true)}>Remettre à zéro</button>
      </div>

      {sections.length === 0 && <p className="muted tasks-empty">Aucun titre. Touchez « + Titre » pour commencer.</p>}
      {sections.map((s) => {
        const list = ordered(s.id);
        const n = list.filter((t) => isDoneToday(t, now)).length;
        return (
          <section key={s.id} className="tasks-service" aria-labelledby={`service-${s.id}`}>
            <div className="tasks-service-head">
              <h3 id={`service-${s.id}`}>
                <span>{s.label}</span>
                <span className="num tasks-count">{n} / {list.length}</span>
              </h3>
              <button type="button" className="task-more" aria-label={`Modifier le titre « ${s.label} »`} onClick={() => setSectionSheet({ mode: 'edit', section: s })}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
              </button>
            </div>
            {list.length === 0 && <p className="muted tasks-empty">Aucune tâche. Touchez « + Tâche ».</p>}
            <ul className={'task-list' + (drag?.service === s.id ? ' dragging-list' : '')}>
              {list.map((t, i) => {
                const ok = isDoneToday(t, now);
                const dy = shift(s.id, i);
                const dragged = drag?.id === t.id;
                return (
                  <li
                    key={t.id}
                    ref={(el) => { if (el) rows.current.set(t.id, el); else rows.current.delete(t.id); }}
                    className={'task' + (ok ? ' done' : '') + (dragged ? ' dragged' : '')}
                    style={dy ? { transform: `translateY(${dy}px)` } : undefined}
                  >
                    <button
                      type="button"
                      className="task-handle"
                      aria-label={`Déplacer « ${t.label} » (flèches haut et bas)`}
                      onPointerDown={(e) => startDrag(e, t, list)}
                      onPointerMove={moveDrag}
                      onPointerUp={(e) => endDrag(e)}
                      onPointerCancel={(e) => endDrag(e, true)}
                      onKeyDown={(e) => keyMove(e, t, i, list.length)}
                    >
                      <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
                        {[3, 10, 17].map((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />))}
                      </svg>
                    </button>
                    <label className="task-check">
                      <input type="checkbox" checked={ok} onChange={() => toggle(t)} />
                      <span className="task-box" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      </span>
                      <span className="task-label">{t.label}</span>
                      {ok && <span className="task-time num">{hhmm(t.doneAt)}</span>}
                    </label>
                    <button type="button" className="task-more" aria-label={`Modifier « ${t.label} »`} onClick={() => setSheet({ mode: 'edit', task: t })}>
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {sheet && (
        <TaskSheet
          task={sheet.mode === 'edit' ? sheet.task : undefined}
          sections={sections}
          onClose={() => setSheet(null)}
          onSave={async (label, service) => {
            if (sheet.mode === 'edit') await actions.updateTask(sheet.task.id, { label, service });
            else await actions.addTask(label, service);
            setSheet(null);
          }}
          onDelete={sheet.mode === 'edit' ? () => void remove(sheet.task) : undefined}
        />
      )}
      {sectionSheet && (
        <SectionSheet
          section={sectionSheet.mode === 'edit' ? sectionSheet.section : undefined}
          taskCount={sectionSheet.mode === 'edit' ? tasks.filter((t) => t.service === sectionSheet.section.id).length : 0}
          canUp={sectionSheet.mode === 'edit' && sections[0]?.id !== sectionSheet.section.id}
          canDown={sectionSheet.mode === 'edit' && sections.at(-1)?.id !== sectionSheet.section.id}
          onMove={(dir) => { if (sectionSheet.mode === 'edit') void actions.moveSection(sectionSheet.section.id, dir); }}
          onClose={() => setSectionSheet(null)}
          onSave={async (label) => {
            if (sectionSheet.mode === 'edit') await actions.renameSection(sectionSheet.section.id, label);
            else await actions.addSection(label);
            setSectionSheet(null);
          }}
          onDelete={sectionSheet.mode === 'edit' ? () => void removeSection(sectionSheet.section) : undefined}
        />
      )}
      {resetting && (
        <Sheet label="Remettre les tâches à zéro" onClose={() => setResetting(false)}>
          <h3 style={{ fontSize: 20 }}>Remettre les tâches à zéro ?</h3>
          <p className="muted" style={{ margin: 0 }}>
            {done} {done > 1 ? 'tâches cochées sont décochées' : 'tâche cochée est décochée'}, sur tous les téléphones du tabac. La liste reste la même.
            Elle se remet aussi à zéro toute seule chaque jour.
          </p>
          <button type="button" className="btn" onClick={() => { setResetting(false); setExporting(true); }}>Exporter d'abord (.jpg)</button>
          <div className="row">
            <button type="button" className="btn" onClick={() => setResetting(false)}>Annuler</button>
            <button type="button" className="btn danger" onClick={() => void reset()}>Remettre à zéro</button>
          </div>
        </Sheet>
      )}
      {exporting && (
        <ImageExportPanel
          title="Export des tâches"
          fileBase="taches-du-jour"
          alt={`Tâches du ${today(now)}`}
          note="les deux services, avec les heures"
          doneLabel="Tâches exportées ✓"
          render={(at) => renderTasksJpg(layoutTasksExport(tasks, sections, settings?.shopName ?? '', at))}
          onClose={() => setExporting(false)}
        />
      )}
      {toast && (
        <Toast
          message={toast.message}
          action={toast.undo?.length || toast.undoSection ? 'Annuler' : undefined}
          onAction={() => {
            if (toast.undo) void actions.restoreTasks(toast.undo);
            if (toast.undoSection) void actions.restoreSection(toast.undoSection.section, toast.undoSection.tasks);
            setToast(null);
          }}
          onDone={closeToast}
        />
      )}
    </div>
  );
}
