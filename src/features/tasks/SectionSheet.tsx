import { useState } from 'react';
import type { Section } from '../../domain/types';
import { Sheet } from '../../ui/Panel';

/** « Supprimer le titre et ses 9 tâches » ; « … et sa tâche » ; « Supprimer le titre » s'il est vide. */
const deleteLabel = (n: number) => (n === 0 ? 'Supprimer le titre' : `Supprimer le titre et ${n > 1 ? `ses ${n} tâches` : 'sa tâche'}`);

/** Nouveau titre (vide, en bas), ou titre existant : renommer, monter, descendre, supprimer avec ses tâches. */
export function SectionSheet({ section, taskCount, canUp, canDown, onMove, onSave, onDelete, onClose }: {
  section?: Section;
  taskCount: number;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onSave: (label: string) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(section?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const valid = label.trim() !== '';
  const title = section ? 'Modifier le titre' : 'Nouveau titre';

  if (confirming && section && onDelete) {
    const what = taskCount === 0 ? '' : ` et ${taskCount > 1 ? `ses ${taskCount} tâches` : 'sa tâche'}`;
    return (
      <Sheet label="Supprimer le titre" onClose={onClose}>
        <h3 style={{ fontSize: 20 }}>Supprimer « {section.label} »{what} ?</h3>
        <p className="muted" style={{ margin: 0 }}>Sur tous les téléphones du tabac. « Annuler » reste possible quelques secondes.</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>Annuler</button>
          <button type="button" className="btn danger" onClick={onDelete}>Supprimer</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet label={title} onClose={onClose}>
      <form
        className="line-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          void onSave(label).finally(() => setBusy(false));
        }}
      >
        <h3 style={{ fontSize: 19 }}>{title}</h3>
        <label className="field-label">
          Titre
          <input className="input" id="section-label" value={label} maxLength={40} autoComplete="off" onChange={(e) => setLabel(e.target.value)} autoFocus={!section} />
        </label>
        {!section && <p className="muted" style={{ margin: 0 }}>Le titre est ajouté en bas, sans tâche : ajoutez-les ensuite avec « + Tâche ».</p>}
        {section && (
          <div className="row">
            <button type="button" className="btn" disabled={!canUp} onClick={() => onMove(-1)}>↑ Monter</button>
            <button type="button" className="btn" disabled={!canDown} onClick={() => onMove(1)}>↓ Descendre</button>
          </div>
        )}
        {section && onDelete && <button type="button" className="btn danger" onClick={() => setConfirming(true)}>{deleteLabel(taskCount)}</button>}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!valid || busy}>{section ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Sheet>
  );
}
