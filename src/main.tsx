import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/global.css';
import App from './App';
import { requestPersistence } from './data/db';
import { syncFdjGames, syncReferences } from './data/referencesSync';
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
  void syncFdjGames()
    .then((r) => r.updated && window.dispatchEvent(new CustomEvent('carotte:catalog-changed')))
    .catch((e) => console.error('Liste des jeux FDJ non mise à jour', e));
  void syncReferences()
    .then((r) => r.updated && window.dispatchEvent(new CustomEvent('carotte:catalog-changed')))
    .catch((e) => console.error('Liste officielle non mise à jour', e));
}
