import { useState } from 'react';
import { createPortal } from 'react-dom';
import { relayUrl } from '../sync/relayConfig';
import { dbTabacId } from '../data/db';
import { addTabac, DEFAULT_TABAC_NAME, listTabacs, removeTabac, switchTabac, type TabacEntry } from '../tabacs/registry';
import { Sheet } from './Panel';
import { SyncDot } from './SyncDot';

/**
 * Nom du tabac ouvert par la page : celui des réglages (partagé). Dans la base neuve d'un tabac créé ou rejoint, tant
 * que ses réglages ne sont pas écrits (ils valent alors « Mon tabac » par défaut), celui du registre.
 */
export function tabacDisplayName(shopName: string | undefined): string {
  if (shopName && shopName !== DEFAULT_TABAC_NAME) return shopName;
  return listTabacs().find((t) => t.id === dbTabacId)?.name || shopName || '';
}

type Mode = { type: 'liste' } | { type: 'creer' } | { type: 'rejoindre' } | { type: 'retirer'; tabac: TabacEntry };

/** Nom du tabac dans l'en-tête : un bouton qui ouvre « Mes tabacs ». Le point de synchronisation seulement avec le relais. */
export function TabacSwitcher({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="tabac-row">
        <button type="button" className="tabac-btn" aria-haspopup="dialog" aria-label={`Mes tabacs : ${name}`} onClick={() => setOpen(true)}>
          <small>{name}</small>
          <span className="tabac-caret" aria-hidden="true">▾</span>
        </button>
        {relayUrl() && <SyncDot />}
      </div>
      {/* Hors de l'en-tête (couleurs et styles du bandeau bordeaux). */}
      {open && createPortal(<TabacsSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function TabacsSheet({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>({ type: 'liste' });
  const [tabacs, setTabacs] = useState(listTabacs);
  const [newName, setNewName] = useState('');
  // Le tabac dont cette page a ouvert la base (un autre onglet a pu changer le tabac courant du registre).
  const current = dbTabacId;
  const relay = !!relayUrl();

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    // Clé générée sur le téléphone : le tabac est partagé d'office (dès que le relais est en service).
    switchTabac(addTabac(n).id);
  };

  const remove = async (t: TabacEntry) => {
    await removeTabac(t.id);
    setTabacs(listTabacs());
    setMode({ type: 'liste' });
  };

  const openScanner = () => {
    onClose();
    location.hash = 'scanner';
  };

  if (mode.type === 'retirer') {
    return (
      <Sheet label="Retirer un tabac" onClose={onClose}>
        <h3>Retirer «{'\u00a0'}{mode.tabac.name}{'\u00a0'}» de ce téléphone{'\u00a0'}?</h3>
        <p className="muted" style={{ margin: 0 }}>
          Ses données sur ce téléphone seront effacées (comptage, ruptures, fiches). Les autres téléphones du tabac les gardent.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => setMode({ type: 'liste' })}>Annuler</button>
          <button type="button" className="btn danger" onClick={() => void remove(mode.tabac)}>Retirer</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet label="Mes tabacs" onClose={onClose}>
      <h3>Mes tabacs</h3>
      <ul className="tabac-list">
        {tabacs.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={'tabac-item' + (t.id === current ? ' on' : '')}
              data-tabac={t.id}
              aria-current={t.id === current ? 'true' : undefined}
              onClick={() => (t.id === current ? onClose() : switchTabac(t.id))}
            >
              <span className="tabac-check" aria-hidden="true">{t.id === current ? '✓' : ''}</span>
              <span className="tabac-name">{t.name}</span>
            </button>
            {/* Jamais le tabac en cours, ni le dernier qui reste. */}
            {t.id !== current && tabacs.length > 1 && (
              <button type="button" className="btn ghost tabac-remove" aria-label={`Retirer ${t.name}`} onClick={() => setMode({ type: 'retirer', tabac: t })}>
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>

      {mode.type === 'creer' ? (
        <form className="tabac-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <label className="field-label">
            Nom du nouveau tabac
            <input className="input" autoFocus maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex. : Tabac de la Gare" />
          </label>
          <div className="row">
            <button type="button" className="btn" onClick={() => setMode({ type: 'liste' })}>Annuler</button>
            <button type="submit" className="btn accent" disabled={!newName.trim()}>Créer</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setMode({ type: 'creer' })}>Créer un tabac</button>
      )}

      {mode.type === 'rejoindre' ? (
        relay ? (
          <div className="tabac-join">
            <p style={{ margin: 0 }}>Scannez le QR code « Inviter un employé » affiché sur le téléphone du gérant.</p>
            <button type="button" className="btn accent" onClick={openScanner}>Ouvrir le Scanner</button>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Rejoindre un tabac : bientôt disponible</p>
        )
      ) : (
        <button type="button" className="btn" onClick={() => setMode({ type: 'rejoindre' })}>Rejoindre un tabac</button>
      )}
    </Sheet>
  );
}
