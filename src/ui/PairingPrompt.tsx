import { useEffect, useState } from 'react';
import { GITHUB_REPO, flushOutbox } from '../data/sharingData';
import type { Pairing } from '../domain/sharing';
import { actions, notifyDataChanged } from '../store';
import { Sheet } from './Panel';
import { Toast } from './Toast';

export const PAIRING_EVENT = 'carotte:pairing';

/** Un QR code de jumelage scanné (n'importe quel scanner) propose d'activer le partage sur ce téléphone. */
export function PairingPrompt() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setPairing((e as CustomEvent<Pairing>).detail);
    window.addEventListener(PAIRING_EVENT, on);
    return () => window.removeEventListener(PAIRING_EVENT, on);
  }, []);
  if (!pairing) return toast ? <Toast message={toast} onDone={() => setToast(null)} ms={3000} /> : null;
  const foreign = pairing.repo !== GITHUB_REPO;
  const accept = async () => {
    setPairing(null);
    await actions.saveSettings({ shareToken: pairing.token, shareStatus: 'ok' });
    void flushOutbox().then(notifyDataChanged);
    setToast('Téléphone jumelé : le partage des codes est activé');
  };
  return (
    <Sheet label="Jumelage" onClose={() => setPairing(null)}>
      {foreign ? (
        <>
          <h3>QR code d’une autre installation</h3>
          <p className="muted" style={{ margin: 0 }}>Ce QR code ne correspond pas à cette app.</p>
          <button type="button" className="btn" onClick={() => setPairing(null)}>Fermer</button>
        </>
      ) : (
        <>
          <h3>Jumeler ce téléphone avec {pairing.shop} ?</h3>
          <p className="muted" style={{ margin: 0 }}>Les codes-barres rattachés sur ce téléphone seront partagés automatiquement avec la liste commune. Rien d’autre n’est envoyé.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setPairing(null)}>Annuler</button>
            <button type="button" className="btn accent" onClick={accept}>Jumeler</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
