import { useCallback, useState } from 'react';
import { activeLabel, canDemote, visibleMembers } from '../../domain/members';
import type { Member } from '../../domain/types';
import { actions, useRole } from '../../store';
import { syncEngine } from '../../sync/engineInstance';
import { useSyncStatus } from '../../ui/SyncDot';
import { Panel, Sheet } from '../../ui/Panel';
import { Toast } from '../../ui/Toast';
import { rememberMyName, removeMember } from '../../tabacs/members';

const label = (m: Member) => m.name || 'Téléphone sans nom';

/** Liste des téléphones du tabac ; le gérant nomme un autre gérant ou retire un téléphone (changement de clé). */
export function EmployeesPanel({ onClose }: { onClose: () => void }) {
  const { me, members, canManage, hasManager } = useRole();
  const status = useSyncStatus();
  const [open, setOpen] = useState<Member | null>(null);
  const [naming, setNaming] = useState<'nom' | 'gerant' | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const list = visibleMembers(members);
  const now = Date.now();
  const online = status === 'ok' || status === 'attente';

  const claim = async (name: string) => {
    rememberMyName(name);
    await actions.setMyName(name);
    if (naming === 'gerant' && me) await actions.setRole(me.id, 'gerant');
    setNaming(null);
  };

  const remove = async (m: Member) => {
    const engine = syncEngine();
    if (!engine) return setToast('Partage entre téléphones indisponible.');
    setBusy(true);
    try {
      await removeMember(m.id, engine);
    } catch (e) {
      console.error('Retrait du téléphone', e);
      setBusy(false);
      setRemoving(null);
      setToast('Retrait impossible : vérifiez la connexion, puis réessayez.');
    }
  };

  return (
    <Panel title="Employés" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>Les téléphones qui ont accès à ce tabac. Seul un gérant peut inviter ou retirer quelqu'un.</p>
      {!hasManager && (
        <div className="banner">
          <span>Aucun gérant pour l'instant : tout le monde peut tout faire.</span>
          <span className="banner-actions"><button type="button" className="btn accent" onClick={() => setNaming('gerant')}>Je suis le gérant</button></span>
        </div>
      )}
      <ul className="member-list">
        {list.map((m) => {
          const mine = m.id === me?.id;
          return (
            <li key={m.id}>
              <button type="button" className="card member" disabled={!mine && !canManage} onClick={() => (mine ? setNaming('nom') : setOpen(m))}
                aria-label={`${label(m)}${m.role === 'gerant' ? ', gérant' : ''}${mine ? ', ce téléphone' : ''}`}>
                <span className="member-name"><b>{label(m)}</b>{m.role === 'gerant' && <span className="pill">Gérant</span>}{mine && <span className="muted"> (ce téléphone)</span>}</span>
                <span className="muted">{mine ? 'Toucher pour changer votre nom' : activeLabel(m.lastSeen, now)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted hint">Un téléphone qui n'apparaît pas ici n'a pas encore la dernière version de l'app.</p>

      {naming && (
        <NameSheet
          title={naming === 'gerant' ? 'Je suis le gérant' : 'Votre nom'}
          text={naming === 'gerant' ? 'Votre nom, affiché aux autres téléphones du tabac. Vous pourrez ensuite inviter et retirer des employés.' : 'Affiché aux autres téléphones du tabac.'}
          initial={me?.name ?? ''}
          action={naming === 'gerant' ? 'Devenir gérant' : 'Enregistrer'}
          onSave={claim}
          onClose={() => setNaming(null)}
        />
      )}
      {open && !removing && (
        <Sheet label={label(open)} onClose={() => setOpen(null)}>
          <h3 style={{ fontSize: 20 }}>{label(open)}</h3>
          <p className="muted" style={{ margin: 0 }}>{open.role === 'gerant' ? 'Gérant' : 'Employé'} · {activeLabel(open.lastSeen, now)}</p>
          {open.role === 'gerant' ? (
            <button type="button" className="btn" disabled={!canDemote(members, open.id, now)} onClick={() => { void actions.setRole(open.id, 'employe'); setOpen(null); }}>Retirer le rôle de gérant</button>
          ) : (
            <button type="button" className="btn" onClick={() => { void actions.setRole(open.id, 'gerant'); setOpen(null); }}>Nommer gérant</button>
          )}
          <button type="button" className="btn danger" onClick={() => setRemoving(open)}>Retirer du tabac</button>
          <button type="button" className="btn ghost" onClick={() => setOpen(null)}>Annuler</button>
        </Sheet>
      )}
      {removing && (
        <Sheet label="Retirer du tabac" onClose={() => { if (!busy) { setRemoving(null); setOpen(null); } }}>
          <h3 style={{ fontSize: 20 }}>Retirer « {label(removing)} » du tabac ?</h3>
          <p className="muted" style={{ margin: 0 }}>
            La clé du tabac change : ce téléphone n'aura plus accès aux données. Les autres téléphones de la liste suivent
            tout seuls. Un téléphone absent de la liste (pas encore à jour) devra être réinvité.
          </p>
          {!online && <p className="alert-text" role="alert">Connexion nécessaire pour retirer un téléphone.</p>}
          <div className="row">
            <button type="button" className="btn" disabled={busy} onClick={() => { setRemoving(null); setOpen(null); }}>Annuler</button>
            <button type="button" className="btn danger" disabled={busy || !online} onClick={() => void remove(removing)}>{busy ? 'Changement de la clé…' : 'Retirer'}</button>
          </div>
        </Sheet>
      )}
      {toast && <Toast message={toast} onDone={closeToast} />}
    </Panel>
  );
}

/** Demande du nom (au premier usage, « Je suis le gérant », « Modifier mon nom »). */
export function NameSheet({ title, text, initial, action, onSave, onClose, later }: {
  title: string; text: string; initial: string; action: string; onSave: (name: string) => Promise<void>; onClose: () => void; later?: boolean;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet label={title} onClose={onClose}>
      <form className="line-form" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || busy) return; setBusy(true); void onSave(name).finally(() => setBusy(false)); }}>
        <h3 style={{ fontSize: 19 }}>{title}</h3>
        <p className="muted" style={{ margin: 0 }}>{text}</p>
        <label className="field-label">Nom<input className="input" id="member-name" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>{later ? 'Plus tard' : 'Annuler'}</button>
          <button type="submit" className="btn accent" disabled={!name.trim() || busy}>{action}</button>
        </div>
      </form>
    </Sheet>
  );
}
