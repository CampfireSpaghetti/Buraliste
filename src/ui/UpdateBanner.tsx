import { useRegisterSW } from 'virtual:pwa-register/react';
import { Banner } from './Banner';

/** « Nouvelle version prête » : la mise à jour s'installe quand le buraliste le décide (jamais en plein comptage). */
export function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="update-banner">
      <Banner actions={<button type="button" className="btn" onClick={() => updateServiceWorker(true)}>Recharger</button>}>
        Nouvelle version prête
      </Banner>
    </div>
  );
}
