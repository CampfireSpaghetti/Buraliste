import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { OPS_QUEUED_EVENT } from '../data/sharedRepo';
import { SYNC_STATUS_EVENT, type SyncStatus } from '../sync/engine';
import { syncEngine } from '../sync/engineInstance';
import { syncLabel, type SyncDisplay } from '../sync/statusLabels';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Avant le démarrage du moteur (listes publiques en cours) : hors ligne, ou « connexion… ». */
const engineOrNeutral = (): SyncDisplay => syncEngine()?.status() ?? (offline() ? 'hors-ligne' : 'connexion');

/** Statut de la synchronisation du tabac, mis à jour à chaque changement annoncé par le moteur. */
export function useSyncStatus(): SyncDisplay {
  const [status, setStatus] = useState<SyncDisplay>(engineOrNeutral);
  useEffect(() => {
    let alive = true;
    const on = (e: Event) => setStatus((e as CustomEvent<SyncStatus>).detail);
    // Avant le moteur : « envoi en attente » seulement si des modifications attendent vraiment d'être envoyées.
    const refresh = () => {
      const s = engineOrNeutral();
      setStatus(s);
      if (s === 'connexion') {
        void db.opsOut.count().then((n) => { if (alive && n > 0 && engineOrNeutral() === 'connexion') setStatus('attente'); }).catch(() => undefined);
      }
    };
    const onQueued = () => { if (!syncEngine() && !offline()) setStatus('attente'); };
    window.addEventListener(SYNC_STATUS_EVENT, on);
    window.addEventListener(OPS_QUEUED_EVENT, onQueued);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    // Le moteur a pu démarrer entre le premier rendu et l'abonnement.
    refresh();
    return () => {
      alive = false;
      window.removeEventListener(SYNC_STATUS_EVENT, on);
      window.removeEventListener(OPS_QUEUED_EVENT, onQueued);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);
  return status;
}

/** Pastille seule (aussi dans Réglages) ; « ! » en cas d'erreur ou de refus, pour ne pas dépendre de la couleur. */
export function Dot({ status }: { status: SyncDisplay }) {
  const alert = status === 'erreur' || status === 'refuse';
  return <span className={'sync-dot sync-' + status} aria-hidden="true">{alert ? '!' : null}</span>;
}

/**
 * Point de l'en-tête : vert à jour, laiton envoi en attente, gris hors ligne, rouge erreur ou accès refusé, cercle vide
 * pendant la connexion. Le toucher ouvre Réglages, où se trouve le détail.
 */
export function SyncDot() {
  const status = useSyncStatus();
  return (
    <button type="button" className="sync-dot-btn" aria-label={syncLabel(status)} title={syncLabel(status)} onClick={() => { location.hash = 'reglages'; }}>
      <Dot status={status} />
    </button>
  );
}
