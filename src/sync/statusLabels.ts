import { REFUSED_MESSAGE, type SyncStatus } from './engine';

/** Mots du point de synchronisation (en-tête) : « Synchronisation : à jour ». */
export const SYNC_LABELS: Record<SyncStatus, string> = {
  ok: 'à jour',
  attente: 'envoi en attente',
  'hors-ligne': 'hors ligne',
  erreur: 'erreur',
  refuse: 'accès refusé',
};

export const syncLabel = (s: SyncStatus): string => `Synchronisation : ${SYNC_LABELS[s]}`;

/** Phrase de Réglages, en mots simples. */
export function syncSentence(s: SyncStatus): string {
  switch (s) {
    case 'ok': return 'Les téléphones du tabac sont à jour.';
    case 'attente': return 'Des modifications partent vers les autres téléphones…';
    case 'hors-ligne': return 'Pas de réseau : les modifications partiront au retour du réseau.';
    case 'erreur': return 'Le partage ne répond pas pour l’instant. Nouvelle tentative automatique ; rien n’est perdu.';
    case 'refuse': return `${REFUSED_MESSAGE}.`;
  }
}
