import { useEffect, useState } from 'react';
import { Toast } from './Toast';

export const PAIRING_EVENT = 'carotte:pairing';

/**
 * Un QR code scanné qui n'est pas un produit (n'importe quel scanner) arrive ici. Pour l'instant seul l'ancien QR code de
 * jumelage (clé GitHub, supprimé) est reconnu : on dit au gérant quoi faire plutôt que de le traiter comme un code inconnu.
 *  */
export function PairingPrompt() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setToast('Ancien QR code : demandez une invitation de tabac');
    window.addEventListener(PAIRING_EVENT, on);
    return () => window.removeEventListener(PAIRING_EVENT, on);
  }, []);
  return toast ? <Toast message={toast} onDone={() => setToast(null)} ms={4000} /> : null;
}
