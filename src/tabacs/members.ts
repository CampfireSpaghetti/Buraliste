/**
 * Gestion des employés : retirer un téléphone du tabac en changeant la clé du tabac, et suivre un changement de clé
 * fait par un gérant (nouvelle clé, ou plus d'accès). Voir docs/superpowers/specs/2026-10-24-gestion-employes-design.md.
 */
import { db, dbTabacId, deviceKeys, listMembers, markRemoved } from '../data/db';
import { visibleMembers } from '../domain/members';
import { deviceId } from '../sync/clock';
import { generateTabacKey, unwrapKey, wrapKeyFor, type Rotation } from '../sync/crypto';
import type { SyncEngine } from '../sync/engine';
import { setTabacKey } from './registry';

/** Nom de la personne qui utilise ce téléphone (le même pour tous ses tabacs), gardé sur le téléphone. */
const MY_NAME_KEY = 'carotte:nom';
export function myName(): string {
  try {
    return localStorage.getItem(MY_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberMyName(name: string): void {
  try {
    localStorage.setItem(MY_NAME_KEY, name.trim().slice(0, 40));
  } catch {
    /* gardé dans le tabac seulement */
  }
}

/** Ce téléphone a été retiré du tabac (changement de clé sans lui) : écran « plus d'accès ». */
export const NO_ACCESS_KEY = 'accesRetire';
export const NO_ACCESS_EVENT = 'carotte:plus-d-acces';

/** Clés de `syncState` qui donnent la position dans le canal : oubliées, le moteur rejoint le canal de la nouvelle clé. */
const POSITION_KEYS = ['lastN', 'dernierPull', 'vusDepuisPhoto', 'photoAFaire', 'rejoindre'];

/** Nouvelle clé : le tabac change de canal ; au rechargement, le téléphone le rejoint et y publie son état complet. */
async function adoptKey(newKey: string): Promise<void> {
  setTabacKey(dbTabacId, newKey);
  await db.syncState.bulkDelete(POSITION_KEYS);
}

/**
 * Retire un téléphone du tabac (gérant, relais joignable). La nouvelle clé est envoyée, chiffrée pour chaque téléphone
 * restant, sur le canal actuel ; puis ce téléphone passe à la nouvelle clé (la page est rechargée). Rien n'est changé
 * si l'envoi échoue (hors ligne) : l'erreur est rendue à l'écran.
 */
export async function removeMember(id: string, engine: Pick<SyncEngine, 'postControl' | 'stop'>, reload = () => location.reload()): Promise<void> {
  const keep = visibleMembers(await listMembers()).filter((m) => m.id !== id && m.pub);
  const newKey = generateTabacKey();
  const rotation = await wrapKeyFor(newKey, keep);
  if (!rotation.wraps[deviceId()]) throw new Error('Clé de ce téléphone introuvable : rouvrez l’app puis réessayez.');
  await engine.postControl({ rotation });
  engine.stop();
  await adoptKey(newKey);
  // Partagé sur le nouveau canal : les téléphones restants voient le retrait ; le retiré ne lira jamais ce canal.
  await markRemoved(id);
  reload();
}

/** Changement de clé lu sur le canal : on suit la nouvelle clé si elle nous est destinée, sinon plus d'accès. */
export async function handleRotation(rotation: Rotation, reload = () => location.reload()): Promise<void> {
  const { priv } = await deviceKeys();
  const newKey = await unwrapKey(rotation, deviceId(), priv);
  if (newKey) {
    await adoptKey(newKey);
    reload();
    return;
  }
  await db.syncState.put({ key: NO_ACCESS_KEY, value: true });
  window.dispatchEvent(new Event(NO_ACCESS_EVENT));
}

/** Plus d'accès déjà constaté (message de changement de clé sans ce téléphone). */
export const noAccess = async (): Promise<boolean> => (await db.syncState.get(NO_ACCESS_KEY))?.value === true;
