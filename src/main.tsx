import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/global.css';
import App from './App';
import { requestPersistence } from './data/db';
import { syncFdjGames, syncReferences } from './data/referencesSync';
import { syncSharedCodes } from './data/sharingData';
import { scheduleFlush } from './store';
import { installTestHooks, testModeEnabled } from './testHooks';
import { setPersisted } from './storageStatus';

const test = testModeEnabled();
if (test) installTestHooks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Démarrage en arrière-plan : l'affichage n'attend pas. En cas d'échec, l'app garde les données en place.
void requestPersistence().then(setPersisted);

const skipStartup = test && localStorage.getItem('carotte:nosync') === '1';
if (!skipStartup) {
  // Listes publiques (Douane, FDJ), puis codes partagés : appliqués aussi aux références qui viennent d'arriver.
  void (async () => {
    const changed = (r: PromiseSettledResult<{ updated: boolean }>) => r.status === 'fulfilled' && r.value.updated;
    const [refs, fdj] = await Promise.allSettled([syncReferences(), syncFdjGames()]);
    for (const r of [refs, fdj]) if (r.status === 'rejected') console.error('Liste non mise à jour', r.reason);
    const codes = await syncSharedCodes(fetch, changed(refs) || changed(fdj)).catch((e) => (console.error('Codes partagés non reçus', e), undefined));
    if (changed(refs) || changed(fdj) || codes?.updated) window.dispatchEvent(new CustomEvent('carotte:catalog-changed'));
  })();
  // Codes en attente d'envoi : au démarrage et au retour du réseau.
  scheduleFlush(3_000);
  window.addEventListener('online', () => scheduleFlush(1_000));
}
