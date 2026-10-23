import { useEffect, useState } from 'react';
import { relayUrl } from '../sync/relayConfig';
import { inviteAction, joinTabac } from '../tabacs/invite';
import { isIosBrowserTabNow, takeInviteFromUrl, takePendingLinkInvite, type ReadInvite } from '../tabacs/inviteLink';
import { listTabacs, type TabacInvite } from '../tabacs/registry';
import { dbTabacId } from '../data/db';
import { Sheet } from './Panel';
import { Toast } from './Toast';

export const PAIRING_EVENT = 'carotte:pairing';

/**
 * QR code de La Carotte scanné : ancien QR code à clé GitHub (`LACAROTTE1`, supprimé) ou invitation à un tabac.
 * `via: 'lien'` : invitation reçue par message (lien ouvert ou collé) plutôt que scannée.
 */
export type PairingScan = { kind: 'ancien' } | { kind: 'invitation'; invite?: TabacInvite; via?: 'lien' };

export const announcePairing = (detail: PairingScan) => window.dispatchEvent(new CustomEvent<PairingScan>(PAIRING_EVENT, { detail }));

const announceLink = (r: ReadInvite) => announcePairing({ kind: 'invitation', via: 'lien', invite: r.ok ? r.invite : undefined });

/** Après avoir rejoint par un lien dans Safari (iPhone) : l'astuce s'affiche une fois la page rechargée sur le tabac. */
const IOS_HINT_KEY = 'carotte:astuce-iphone';
function takeIosHint(): boolean {
  try {
    const on = sessionStorage.getItem(IOS_HINT_KEY) === '1';
    sessionStorage.removeItem(IOS_HINT_KEY);
    return on;
  } catch {
    return false;
  }
}
function rememberIosHint(on: boolean) {
  try {
    if (on) sessionStorage.setItem(IOS_HINT_KEY, '1');
    else sessionStorage.removeItem(IOS_HINT_KEY);
  } catch {
    /* tant pis : pas d'astuce */
  }
}

/**
 * Tous les scanners de l'app envoient ici les QR codes de La Carotte. Une invitation demande « Rejoindre « nom » ? »
 * (ou « Bientôt disponible » sans relais) ; un ancien QR code à clé GitHub reçoit une explication.
 */
export function PairingPrompt() {
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ invite: TabacInvite; viaLink: boolean } | null>(null);
  const [joining, setJoining] = useState(false);
  const [iosHint, setIosHint] = useState(takeIosHint);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PairingScan | undefined>).detail;
      if (!d || d.kind === 'ancien') return setToast('Ancien QR code : demandez une invitation de tabac');
      if (!relayUrl()) return setToast('Bientôt disponible');
      if (!d.invite) return setToast(d.via === 'lien' ? 'Lien d’invitation invalide ou incomplet.' : 'QR code d’invitation illisible : réessayez');
      if (inviteAction(d.invite, listTabacs(), dbTabacId).type === 'deja') return setToast('Ce téléphone est déjà dans ce tabac');
      setAsk({ invite: d.invite, viaLink: d.via === 'lien' });
    };
    // Lien ouvert alors que l'app l'était déjà (seul le fragment change) : lu et retiré de l'adresse de la même façon.
    const onHash = () => {
      const r = takeInviteFromUrl();
      if (r) announceLink(r);
    };
    window.addEventListener(PAIRING_EVENT, on);
    window.addEventListener('hashchange', onHash);
    // Lien d'invitation lu au démarrage (main.tsx), proposé maintenant que l'écran écoute.
    const pending = takePendingLinkInvite();
    if (pending) announceLink(pending);
    return () => {
      window.removeEventListener(PAIRING_EVENT, on);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  const join = (a: { invite: TabacInvite; viaLink: boolean }) => {
    setJoining(true);
    // Posée avant : rejoindre recharge la page. Retirée si rejoindre échoue, et le bouton redevient utilisable.
    const hint = a.viaLink && isIosBrowserTabNow();
    if (hint) rememberIosHint(true);
    joinTabac(a.invite, dbTabacId).catch(() => {
      if (hint) rememberIosHint(false);
      setJoining(false);
      setToast('Le tabac n’a pas pu être rejoint : réessayez');
    });
  };
  return (
    <>
      {ask && (
        <Sheet label={`Rejoindre « ${ask.invite.name} » ?`} onClose={() => setAsk(null)}>
          <h3>Rejoindre «{'\u00a0'}{ask.invite.name}{'\u00a0'}»{'\u00a0'}?</h3>
          <p className="muted" style={{ margin: 0 }}>
            Ce téléphone recevra le comptage, les ruptures et les fiches de ce tabac. Vos autres tabacs restent sur ce téléphone.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setAsk(null)}>Annuler</button>
            <button type="button" className="btn accent" disabled={joining} onClick={() => join(ask)}>Rejoindre</button>
          </div>
        </Sheet>
      )}
      {iosHint && (
        <Sheet label="Sur l’écran d’accueil" onClose={() => setIosHint(false)}>
          <h3>Sur l’écran d’accueil</h3>
          <p style={{ margin: 0 }}>
            Pour l’avoir sur l’écran d’accueil : ouvrez ce lien dans Safari, puis Menu de la page (•••) → Partager → « Sur l’écran d’accueil ».
            Ensuite, ouvrez l’app, touchez le nom du tabac en haut → Rejoindre un tabac → Coller le lien d’invitation.
          </p>
          <button type="button" className="btn accent" onClick={() => setIosHint(false)}>Compris</button>
        </Sheet>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} ms={4000} />}
    </>
  );
}
