import { useState } from 'react';
import { usePersisted } from '../storageStatus';
import { isIosBrowserTabNow } from '../tabacs/inviteLink';
import { InstallGuide } from '../features/settings/InstallGuide';
import { Banner } from './Banner';

const KEY = 'carotte:storage-ack';

/**
 * Spec §9 : stockage persistant refusé → conseiller l'installation sur l'écran d'accueil et la sauvegarde. Sur iPhone,
 * dans Safari (app pas encore installée), le conseil s'affiche aussi : c'est là qu'on cherche le plus comment installer.
 */
export function StorageBanner() {
  const persisted = usePersisted();
  const [iosTab] = useState(isIosBrowserTabNow);
  const [guide, setGuide] = useState(false);
  const [ack, setAck] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (guide) return <InstallGuide onClose={() => setGuide(false)} />;
  if ((persisted !== false && !iosTab) || ack) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* ré-affiché à la prochaine ouverture */ }
    setAck(true);
  };
  return (
    <div className="update-banner">
      <Banner
        actions={
          <>
            <button type="button" className="btn" onClick={() => setGuide(true)}>Comment installer</button>
            <button type="button" className="btn ghost" onClick={dismiss}>Compris</button>
          </>
        }
      >
        {iosTab
          ? "Installez La Carotte sur l'écran d'accueil : elle s'ouvre en plein écran, sans connexion, et vos données y sont mieux gardées. Faites aussi une sauvegarde chaque semaine."
          : "Stockage non garanti sur ce téléphone : installez l'app sur l'écran d'accueil et faites une sauvegarde chaque semaine."}
      </Banner>
    </div>
  );
}
