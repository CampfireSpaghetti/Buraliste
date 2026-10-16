import { useState } from 'react';
import { usePersisted } from '../storageStatus';
import { Banner } from './Banner';

const KEY = 'carotte:storage-ack';

/** Spec §9 : stockage persistant refusé → conseiller l'installation sur l'écran d'accueil et la sauvegarde. */
export function StorageBanner() {
  const persisted = usePersisted();
  const [ack, setAck] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (persisted !== false || ack) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* ré-affiché à la prochaine ouverture */ }
    setAck(true);
  };
  return (
    <div className="update-banner">
      <Banner actions={<button type="button" className="btn" onClick={dismiss}>Compris</button>}>
        Stockage non garanti sur ce téléphone : installez l'app sur l'écran d'accueil (Réglages › Installer) et faites une sauvegarde chaque semaine.
      </Banner>
    </div>
  );
}
