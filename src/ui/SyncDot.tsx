import { useEffect, useState } from 'react';
import { SYNC_STATUS_EVENT, type SyncStatus } from '../sync/engine';
import { syncEngine } from '../sync/engineInstance';
import { syncLabel } from '../sync/statusLabels';

/** Avant le démarrage du moteur (listes publiques en cours) : hors ligne si le téléphone n'a pas de réseau, sinon en attente. */
const initialStatus = (): SyncStatus => syncEngine()?.status() ?? (typeof navigator !== 'undefined' && navigator.onLine === false ? 'hors-ligne' : 'attente');

/** Statut de la synchronisation du tabac, mis à jour à chaque changement annoncé par le moteur. */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(initialStatus);
  useEffect(() => {
    const on = (e: Event) => setStatus((e as CustomEvent<SyncStatus>).detail);
    // Réseau perdu ou retrouvé (aussi avant le démarrage du moteur).
    const onNetwork = () => setStatus(initialStatus());
    window.addEventListener(SYNC_STATUS_EVENT, on);
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    // Le moteur a pu démarrer entre le premier rendu et l'abonnement.
    onNetwork();
    return () => {
      window.removeEventListener(SYNC_STATUS_EVENT, on);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    };
  }, []);
  return status;
}

/** Petit point de l'en-tête : vert à jour, laiton envoi en attente, gris hors ligne, rouge erreur ou accès refusé. */
export function SyncDot() {
  const status = useSyncStatus();
  return <span className={'sync-dot sync-' + status} role="img" aria-label={syncLabel(status)} title={syncLabel(status)} />;
}
