import type { ReactNode } from 'react';
import './panel.css';

/** Écran plein cadre par-dessus les onglets (fiche, formulaire…). */
export function Panel({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel" role="dialog" aria-modal="true" aria-label={title}>
      <header className="panel-head">
        <button type="button" className="panel-close" onClick={onClose} aria-label="Fermer">‹</button>
        <h2>{title}</h2>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** Feuille qui monte du bas de l'écran (pavé, choix rapides). */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={label}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grab" />
        {children}
      </div>
    </div>
  );
}
