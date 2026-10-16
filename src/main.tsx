import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/global.css';
import App from './App';
import { requestPersistence } from './data/db';
import { seedFdj, syncReferences } from './data/referencesSync';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Démarrage en arrière-plan : l'affichage n'attend pas. En cas d'échec, l'app garde les données en place.
void requestPersistence();
void seedFdj().catch((e) => console.error('Jeux FDJ de départ non chargés', e));
void syncReferences()
  .then((r) => r.updated && window.dispatchEvent(new CustomEvent('carotte:catalog-changed')))
  .catch((e) => console.error('Liste officielle non mise à jour', e));
