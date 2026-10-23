import { useState } from 'react';
import { SERVICES } from '../../domain/tasks';
import type { Service, Task } from '../../domain/types';
import { Sheet } from '../../ui/Panel';
import { Segmented } from '../../ui/Segmented';

/** Nouvelle tâche, ou tâche existante : texte, service, et Supprimer. */
export function TaskSheet({ task, onSave, onDelete, onClose }: {
  task?: Task;
  onSave: (label: string, service: Service) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(task?.label ?? '');
  const [service, setService] = useState<Service>(task?.service ?? (new Date().getHours() < 13 ? 'matin' : 'apres-midi'));
  const [busy, setBusy] = useState(false);
  const valid = label.trim() !== '';
  const title = task ? 'Modifier la tâche' : 'Nouvelle tâche';
  return (
    <Sheet label={title} onClose={onClose}>
      <form
        className="line-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          void onSave(label, service).finally(() => setBusy(false));
        }}
      >
        <h3 style={{ fontSize: 19 }}>{title}</h3>
        <label className="field-label">
          Tâche à faire
          <input className="input" id="task-label" value={label} maxLength={120} autoComplete="off" onChange={(e) => setLabel(e.target.value)} autoFocus={!task} />
        </label>
        <Segmented label="Service" value={service} onChange={setService} options={SERVICES} />
        <div className="row">
          {onDelete && <button type="button" className="btn danger" onClick={onDelete}>Supprimer</button>}
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!valid || busy}>{task ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Sheet>
  );
}
