import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { dbTabacId, openTabacDb } from '../data/db';
import { formatIsoDateFr } from '../domain/format';
import { relayUrl } from '../sync/relayConfig';
import { switchAfterSync } from '../tabacs/pageTabac';
import { addTabac, listTabacs, removeTabac, TabacBusyError, type TabacEntry } from '../tabacs/registry';
import { Sheet } from './Panel';
import { SyncDot } from './SyncDot';

type Mode = { type: 'liste' } | { type: 'creer' } | { type: 'rejoindre' } | { type: 'retirer'; tabac: TabacEntry };

const pad = (n: number) => String(n).padStart(2, '0');
/** « ajouté le 16 octobre 2026 » : distingue deux tabacs du même nom (« Mon tabac » tant qu'on ne les a pas nommés). */
function addedOn(ts: number): string {
  const d = new Date(ts);
  return `ajouté le ${formatIsoDateFr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)}`;
}

/** Nom du tabac dans l'en-tête : un bouton qui ouvre « Mes tabacs ». Le point de synchronisation seulement avec le relais. */
export function TabacSwitcher({ name, removeTimeoutMs }: { name: string; removeTimeoutMs?: number }) {
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
      {open && createPortal(<TabacsSheet onClose={() => setOpen(false)} removeTimeoutMs={removeTimeoutMs} />, document.body)}
    </>
  );
}

function TabacsSheet({ onClose, removeTimeoutMs }: { onClose: () => void; removeTimeoutMs?: number }) {
  const [mode, setMode] = useState<Mode>({ type: 'liste' });
  const [tabacs, setTabacs] = useState(listTabacs);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // Le tabac dont cette page a ouvert la base (un autre onglet a pu changer le tabac courant du registre).
  const current = dbTabacId;
  const relay = !!relayUrl();

  /** Les modifications en file du tabac quitté partent d'abord (3 s au plus), puis la page se recharge. */
  const go = (id: string) => {
    if (busy) return;
    setBusy(true);
    void switchAfterSync(id);
  };

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    // Clé générée sur le téléphone : le tabac est partagé d'office (dès que le relais est en service).
    go(addTabac(n).id);
  };

  const openScanner = () => {
    onClose();
    location.hash = 'scanner';
  };

  if (mode.type === 'retirer') {
    return (
      <RemoveSheet
        tabac={mode.tabac}
        relay={relay}
        timeoutMs={removeTimeoutMs}
        onClose={onClose}
        onDone={() => { setTabacs(listTabacs()); setMode({ type: 'liste' }); }}
        onCancel={() => setMode({ type: 'liste' })}
      />
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
              disabled={busy}
              onClick={() => (t.id === current ? onClose() : go(t.id))}
            >
              <span className="tabac-check" aria-hidden="true">{t.id === current ? '✓' : ''}</span>
              <span className="tabac-text">
                <span className="tabac-name">{t.name}</span>
                <span className="tabac-added">{addedOn(t.addedAt)}</span>
              </span>
            </button>
            {/* Jamais le tabac en cours, ni le dernier qui reste. */}
            {t.id !== current && tabacs.length > 1 && (
              <button type="button" className="btn ghost tabac-remove" aria-label={`Retirer ${t.name}`} disabled={busy} onClick={() => setMode({ type: 'retirer', tabac: t })}>
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>
      {busy && <p className="muted" role="status" style={{ margin: 0 }}>Changement de tabac…</p>}

      {mode.type === 'creer' ? (
        <form className="tabac-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <label className="field-label">
            Nom du nouveau tabac
            <input className="input" autoFocus maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex. : Tabac de la Gare" />
          </label>
          <div className="row">
            <button type="button" className="btn" onClick={() => setMode({ type: 'liste' })}>Annuler</button>
            <button type="submit" className="btn accent" disabled={!newName.trim() || busy}>Créer</button>
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

/** Modifications du tabac pas encore parties (sa file d'envoi), lues sans le changer ; `null` si illisible. */
async function pendingOps(id: string): Promise<number | null> {
  const d = openTabacDb(id);
  try {
    return await d.opsOut.count();
  } catch {
    return null;
  } finally {
    d.close();
  }
}

function RemoveSheet({ tabac, relay, timeoutMs, onClose, onDone, onCancel }: {
  tabac: TabacEntry; relay: boolean; timeoutMs?: number; onClose: () => void; onDone: () => void; onCancel: () => void;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (relay) void pendingOps(tabac.id).then((n) => alive && setPending(n));
    return () => { alive = false; };
  }, [tabac.id, relay]);

  const remove = async () => {
    setWorking(true);
    setError(undefined);
    try {
      await removeTabac(tabac.id, timeoutMs);
      onDone();
    } catch (e) {
      setError(e instanceof TabacBusyError ? 'Fermez les autres onglets de La Carotte puis réessayez.' : 'Le tabac n’a pas pu être retiré. Réessayez.');
      setWorking(false);
    }
  };

  return (
    <Sheet label="Retirer un tabac" onClose={onClose}>
      <h3>Retirer «{' '}{tabac.name}{' '}» de ce téléphone{' '}?</h3>
      <p className="muted" style={{ margin: 0 }}>
        Ses données seront effacées de ce téléphone. Si aucun autre téléphone n’a rejoint ce tabac, elles seront perdues.
      </p>
      {!relay && <p className="error">Ce tabac n’est pas partagé : ses données n’existent que sur ce téléphone.</p>}
      {relay && pending !== null && pending > 0 && <p className="error">Des modifications n’ont pas encore été envoyées.</p>}
      <p className="muted" style={{ margin: 0 }}>Pour garder une copie : ouvrez ce tabac, puis Réglages › Sauvegarde complète.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn danger" disabled={working} onClick={() => void remove()}>Retirer</button>
      </div>
    </Sheet>
  );
}
