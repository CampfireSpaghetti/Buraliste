import { useEffect, useState } from 'react';
import { relayUrl } from '../sync/relayConfig';
import { inviteAction, joinTabac } from '../tabacs/invite';
import { listTabacs, type TabacInvite } from '../tabacs/registry';
import { dbTabacId } from '../data/db';
import { Sheet } from './Panel';
import { Toast } from './Toast';

export const PAIRING_EVENT = 'carotte:pairing';

/** QR code de La Carotte scanné : ancien QR code à clé GitHub (`LACAROTTE1`, supprimé) ou invitation à un tabac. */
export type PairingScan = { kind: 'ancien' } | { kind: 'invitation'; invite?: TabacInvite };

export const announcePairing = (detail: PairingScan) => window.dispatchEvent(new CustomEvent<PairingScan>(PAIRING_EVENT, { detail }));

/**
 * Tous les scanners de l'app envoient ici les QR codes de La Carotte. Une invitation demande « Rejoindre « nom » ? »
 * (ou « Bientôt disponible » sans relais) ; un ancien QR code à clé GitHub reçoit une explication.
 */
export function PairingPrompt() {
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<TabacInvite | null>(null);
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PairingScan | undefined>).detail;
      if (!d || d.kind === 'ancien') return setToast('Ancien QR code : demandez une invitation de tabac');
      if (!relayUrl()) return setToast('Bientôt disponible');
      if (!d.invite) return setToast('QR code d’invitation illisible : réessayez');
      if (inviteAction(d.invite, listTabacs(), dbTabacId).type === 'deja') return setToast('Ce téléphone est déjà dans ce tabac');
      setAsk(d.invite);
    };
    window.addEventListener(PAIRING_EVENT, on);
    return () => window.removeEventListener(PAIRING_EVENT, on);
  }, []);
  return (
    <>
      {ask && (
        <Sheet label={`Rejoindre « ${ask.name} » ?`} onClose={() => setAsk(null)}>
          <h3>Rejoindre «{'\u00a0'}{ask.name}{'\u00a0'}»{'\u00a0'}?</h3>
          <p className="muted" style={{ margin: 0 }}>
            Ce téléphone recevra le comptage, les ruptures et les fiches de ce tabac. Vos autres tabacs restent sur ce téléphone.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setAsk(null)}>Annuler</button>
            <button type="button" className="btn accent" disabled={joining} onClick={() => { setJoining(true); void joinTabac(ask, dbTabacId); }}>Rejoindre</button>
          </div>
        </Sheet>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} ms={4000} />}
    </>
  );
}
