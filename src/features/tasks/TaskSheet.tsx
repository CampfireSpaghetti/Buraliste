import { useState } from 'react';
import type { Section, Service, Task } from '../../domain/types';
import { Sheet } from '../../ui/Panel';

/** Titre proposé pour une nouvelle tâche : Après-midi à partir de 13 h s'il existe, sinon Matin, sinon le premier. */
function defaultSection(sections: Section[]): Service {
  const pm = new Date().getHours() >= 13;
  return sections.find((s) => s.id === (pm ? 'apres-midi' : 'matin'))?.id ?? sections[0]?.id ?? '';
}

/** Nouvelle tâche, ou tâche existante : texte, service, et Supprimer. */
export function TaskSheet({ task, sections, onSave, onDelete, onClose }: {
  task?: Task;
  sections: Section[];
  onSave: (label: string, service: Service) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(task?.label ?? '');
  const [service, setService] = useState<Service>(() => task?.service ?? defaultSection(sections));
  const [busy, setBusy] = useState(false);
  const valid = label.trim() !== '' && sections.some((s) => s.id === service);
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
        <div className="field-label">
          Titre
          <div className="chips" role="group" aria-label="Titre">
            {sections.map((s) => (
              <button key={s.id} type="button" className={'chip' + (s.id === service ? ' on' : '')} aria-pressed={s.id === service} onClick={() => setService(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          {onDelete && <button type="button" className="btn danger" onClick={onDelete}>Supprimer</button>}
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!valid || busy}>{task ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Sheet>
  );
}
