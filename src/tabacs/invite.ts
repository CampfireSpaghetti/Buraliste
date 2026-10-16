/**
 * Invitation à un tabac scannée (QR code « Inviter un employé », LACAROTTE2) : la reconnaître, puis décider quoi faire.
 * Rejoindre deux fois la même invitation ne crée pas de doublon : on revient simplement au tabac déjà présent.
 */
import { switchAfterSync } from './pageTabac';
import { addTabac, decodeTabacInvite, INVITE_PREFIX, listTabacs, type TabacEntry, type TabacInvite } from './registry';

/** `undefined` : ce n'est pas une invitation ; `{ ok: false }` : une invitation abîmée (QR code mal lu, autre version). */
export function scannedInvite(raw: string): { ok: true; invite: TabacInvite } | { ok: false } | undefined {
  if (typeof raw !== 'string' || !raw.startsWith(INVITE_PREFIX)) return undefined;
  const invite = decodeTabacInvite(raw);
  return invite ? { ok: true, invite } : { ok: false };
}

export type InviteAction = { type: 'ajouter' } | { type: 'changer'; id: string } | { type: 'deja' };

/** Le tabac de l'invitation est reconnu à sa clé (son nom a pu changer depuis). */
export function inviteAction(invite: TabacInvite, tabacs: TabacEntry[], currentId: string): InviteAction {
  const known = tabacs.find((t) => t.key === invite.key);
  if (!known) return { type: 'ajouter' };
  return known.id === currentId ? { type: 'deja' } : { type: 'changer', id: known.id };
}

/**
 * Rejoint le tabac de l'invitation (ou y revient) : la page est rechargée sur sa base, le moteur récupère son état.
 * `pageTabacId` : le tabac dont la page a ouvert la base.
 */
export async function joinTabac(invite: TabacInvite, pageTabacId: string): Promise<void> {
  const action = inviteAction(invite, listTabacs(), pageTabacId);
  if (action.type === 'deja') return;
  await switchAfterSync(action.type === 'changer' ? action.id : addTabac(invite.name.trim(), invite.key).id);
}
