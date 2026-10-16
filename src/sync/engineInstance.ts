/**
 * Moteur de synchronisation de la page : un seul, pour le tabac dont la page a ouvert la base.
 * Démarré seulement quand le relais est configuré (VITE_RELAY_URL) ; sinon l'app se comporte comme avant.
 */
import { dbTabacId } from '../data/db';
import { currentTabac, listTabacs } from '../tabacs/registry';
import { createSyncEngine, type SyncEngine } from './engine';
import { createRelayClient } from './relayClient';
import { relayUrl } from './relayConfig';

let engine: SyncEngine | undefined;

/** Crée et démarre le moteur (une seule fois) ; `undefined` si le relais n'est pas configuré. */
export function startSyncEngine(): SyncEngine | undefined {
  if (engine) return engine;
  const base = relayUrl();
  if (!base) return undefined;
  // La clé du tabac de la base ouverte (un autre onglet a pu changer le tabac courant du registre).
  const key = listTabacs().find((t) => t.id === dbTabacId)?.key ?? currentTabac().key;
  engine = createSyncEngine({ relay: createRelayClient(base), key });
  engine.start();
  return engine;
}

/** Le moteur de la page, s'il a été démarré. */
export const syncEngine = (): SyncEngine | undefined => engine;
