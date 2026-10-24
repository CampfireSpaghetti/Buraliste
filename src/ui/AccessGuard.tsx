import { useEffect, useState } from 'react';
import { dbTabacId } from '../data/db';
import { actions, useRole } from '../store';
import { relayUrl } from '../sync/relayConfig';
import { forgetTabac, listTabacs } from '../tabacs/registry';
import { myName, NO_ACCESS_EVENT, noAccess, rememberMyName } from '../tabacs/members';
import { BackupPanel } from '../features/settings/BackupPanel';
import { NameSheet } from '../features/settings/EmployeesPanel';
import { Panel } from './Panel';

const LATER_KEY = 'carotte:nom-plus-tard';
const askedLater = () => { try { return localStorage.getItem(LATER_KEY) === '1'; } catch { return false; } };

/**
 * Écran « plus d'accès » (ce téléphone a été retiré du tabac), et demande du nom une fois après la mise à jour, dans un
 * tabac partagé avec d'autres téléphones.
 */
export function AccessGuard() {
  const { me, members } = useRole();
  const [lost, setLost] = useState(false);
  const [backup, setBackup] = useState(false);
  const [later, setLater] = useState(askedLater);
  useEffect(() => {
    const check = () => void noAccess().then((v) => v && setLost(true));
    check();
    window.addEventListener(NO_ACCESS_EVENT, check);
    return () => window.removeEventListener(NO_ACCESS_EVENT, check);
  }, []);
  if (!relayUrl()) return null;
  const shop = listTabacs().find((t) => t.id === dbTabacId)?.name ?? 'ce tabac';
  if (lost || me?.removed === true) {
    // Un gérant garde ses données (un téléphone piraté ne doit pas pouvoir les lui faire effacer).
    const manager = me?.role === 'gerant';
    return (
      <Panel title="Plus d'accès" onClose={() => undefined}>
        <h3 style={{ fontSize: 20 }}>Vous n'avez plus accès au tabac « {shop} »</h3>
        {manager ? (
          <>
            <p style={{ margin: 0 }}>La clé du tabac a été changée sans ce téléphone. Vos données restent ici : faites une sauvegarde, puis demandez une nouvelle invitation.</p>
            <button type="button" className="btn accent" onClick={() => setBackup(true)}>Sauvegarde complète</button>
            {backup && <BackupPanel onClose={() => setBackup(false)} />}
          </>
        ) : (
          <>
            <p style={{ margin: 0 }}>Un gérant a retiré ce téléphone du tabac. Les données de ce tabac vont être effacées de ce téléphone.</p>
            <button type="button" className="btn accent" onClick={() => void forgetTabac(dbTabacId).then(() => location.reload())}>OK</button>
          </>
        )}
      </Panel>
    );
  }
  const shared = members.filter((m) => m.removed !== true).length > 1;
  if (me && !me.name && shared && !later) {
    const dismiss = () => { try { localStorage.setItem(LATER_KEY, '1'); } catch { /* redemandé plus tard */ } setLater(true); };
    return (
      <NameSheet
        title="Votre nom"
        text="Affiché aux autres téléphones du tabac, dans Réglages › Employés."
        initial={myName()}
        action="Enregistrer"
        later
        onSave={async (name) => { rememberMyName(name); await actions.setMyName(name); }}
        onClose={dismiss}
      />
    );
  }
  return null;
}
