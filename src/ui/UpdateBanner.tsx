import { useRegisterSW } from 'virtual:pwa-register/react';
import { Banner } from './Banner';

/**
 * L'app installée reste souvent ouverte en arrière-plan des jours entiers : sans relance, le navigateur ne cherche
 * pas de nouvelle version. On la cherche donc au retour au premier plan, et toutes les heures.
 */
function watchUpdates(reg: ServiceWorkerRegistration) {
  const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 60 * 60 * 1000);
}

/** « Nouvelle version prête » : la mise à jour s'installe quand le buraliste le décide (jamais en plein comptage). */
export function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({ onRegisteredSW: (_url, reg) => reg && watchUpdates(reg) });
  if (!needRefresh) return null;
  return (
    <div className="update-banner">
      <Banner actions={<button type="button" className="btn" onClick={() => updateServiceWorker(true)}>Recharger</button>}>
        Nouvelle version prête
      </Banner>
    </div>
  );
}
