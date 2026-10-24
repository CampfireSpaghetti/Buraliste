import './retiredGuard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/global.css';
import App from './App';
import { ensureMember, requestPersistence, seedTasks, syncSettingsNameAtStartup } from './data/db';
import { myName } from './tabacs/members';
import { DEFAULT_TABAC_NAME, ensureRegistry } from './tabacs/registry';
import { setPendingLinkInvite, takeInviteFromUrl } from './tabacs/inviteLink';
import { syncFdjGames, syncReferences } from './data/referencesSync';
import { clearLegacyShareToken, syncSharedCodes } from './data/sharingData';
import { notifyDataChanged, scheduleFlush } from './store';
import { installSyncTestHooks, installTestHooks, testModeEnabled } from './testHooks';
import { startSyncEngine } from './sync/engineInstance';
import { setPersisted } from './storageStatus';

ensureRegistry(DEFAULT_TABAC_NAME);
// Lien d'invitation (#rejoindre=…) : retiré de l'adresse avant tout affichage (la clé ne reste pas dans l'historique),
// puis proposé par PairingPrompt dès qu'il est à l'écran.
setPendingLinkInvite(takeInviteFromUrl());
const test = testModeEnabled();
if (test) installTestHooks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Le nom du tabac dans le registre et le nom de la boutique (réglages) restent alignés. Dans la base neuve d'un tabac
// créé ou rejoint, le nom vient d'être écrit : l'écran (en-tête) est rafraîchi.
void syncSettingsNameAtStartup().then(notifyDataChanged).catch(() => undefined);
// Ce téléphone dans la liste « Employés » du tabac (clé publique, nom, activité), au démarrage et au retour sur l'app.
const touchMember = () => void ensureMember(myName()).then(notifyDataChanged).catch((e) => console.error('Téléphone non inscrit', e));
touchMember();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touchMember(); });
// Liste « À faire » de base (une fois par tabac et par téléphone).
void seedTasks().then(notifyDataChanged).catch((e) => console.error('Liste « À faire » non créée', e));
// Les téléphones n'ont plus de clé GitHub (le relais la détient) : celle d'une ancienne version est effacée.
void clearLegacyShareToken().catch(() => undefined);

// Démarrage en arrière-plan : l'affichage n'attend pas. En cas d'échec, l'app garde les données en place.
void requestPersistence().then(setPersisted);

const skipStartup = test && localStorage.getItem('carotte:nosync') === '1';
if (!skipStartup) {
  // Listes publiques (Douane, FDJ), puis codes partagés : appliqués aussi aux références qui viennent d'arriver.
  // Partage entre téléphones du tabac (seulement si le relais est configuré), une fois les listes publiques en place
  // (les données reçues sur un produit officiel ne s'appliquent qu'à une fiche présente sur ce téléphone), ou au plus
  // tard après 15 s si elles tardent (elles continuent d'arriver).
  const startSync = () => {
    clearTimeout(syncFallback);
    const engine = startSyncEngine();
    if (test && engine) installSyncTestHooks(engine);
  };
  const syncFallback = setTimeout(startSync, 15_000);
  void (async () => {
    const changed = (r: PromiseSettledResult<{ updated: boolean }>) => r.status === 'fulfilled' && r.value.updated;
    const [refs, fdj] = await Promise.allSettled([syncReferences(), syncFdjGames()]);
    for (const r of [refs, fdj]) if (r.status === 'rejected') console.error('Liste non mise à jour', r.reason);
    startSync();
    const codes = await syncSharedCodes(fetch, changed(refs) || changed(fdj)).catch((e) => (console.error('Codes partagés non reçus', e), undefined));
    if (changed(refs) || changed(fdj) || codes?.updated) window.dispatchEvent(new CustomEvent('carotte:catalog-changed'));
  })();
  // Codes en attente d'envoi : au démarrage et au retour du réseau.
  scheduleFlush(3_000);
  window.addEventListener('online', () => scheduleFlush(1_000));
}
