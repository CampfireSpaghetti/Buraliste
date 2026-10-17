import { REFUSED_MESSAGE, type SyncStatus } from './engine';

/** Statut affiché : celui du moteur, ou « connexion » tant qu'il n'a pas démarré (et que rien n'attend d'être envoyé). */
export type SyncDisplay = SyncStatus | 'connexion';

/** Mots du point de synchronisation (en-tête) : « Synchronisation : à jour ». */
export const SYNC_LABELS: Record<SyncDisplay, string> = {
  connexion: 'connexion…',
  ok: 'à jour',
  attente: 'envoi en attente',
  'hors-ligne': 'hors ligne',
  erreur: 'erreur',
  refuse: 'accès refusé',
};

export const syncLabel = (s: SyncDisplay): string => `Synchronisation : ${SYNC_LABELS[s]}`;

/** Phrase de Réglages, en mots simples. */
export function syncSentence(s: SyncDisplay): string {
  switch (s) {
    case 'connexion': return 'Connexion au partage du tabac…';
    case 'ok': return 'Les téléphones du tabac sont à jour.';
    case 'attente': return 'Des modifications partent vers les autres téléphones…';
    case 'hors-ligne': return 'Pas de réseau : les modifications partiront au retour du réseau.';
    case 'erreur': return 'Le partage ne répond pas pour l’instant. Nouvelle tentative automatique ; rien n’est perdu.';
    case 'refuse': return `${REFUSED_MESSAGE}.`;
  }
}
