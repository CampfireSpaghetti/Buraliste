/**
 * Contenu du QR code « Inviter un employé » pour un tabac du téléphone : son vrai nom du moment et sa propre clé.
 */
import Dexie from 'dexie';
import { dbTabacId, getSettings, openTabacDb } from '../data/db';
import { tabacDisplayName } from './pageTabac';
import { DEFAULT_TABAC_NAME, dbNameFor, encodeTabacInvite, listTabacs } from './registry';

const NAME_MAX = 80;

/** Nom des réglages d'un autre tabac, lu sans rien y écrire ; `undefined` si sa base n'existe pas ou est illisible. */
async function otherShopName(id: string): Promise<string | undefined> {
  try {
    if (!(await Dexie.exists(dbNameFor(id)))) return undefined;
    const d = openTabacDb(id);
    try {
      return (await d.settings.get('main'))?.shopName;
    } finally {
      d.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Nom et charge du QR code d'invitation au tabac `tabacId`.
 * Tabac de la page : le nom des réglages (partagé, `tabacDisplayName`). Autre tabac : le nom lu dans sa base ; le nom
 * du registre s'il n'y en a pas (ou s'il vaut encore « Mon tabac »). Nom sans espaces autour, 80 caractères au plus.
 */
export async function inviteFor(tabacId: string, pageTabacId: string = dbTabacId): Promise<{ name: string; payload: string }> {
  const entry = listTabacs().find((t) => t.id === tabacId);
  if (!entry) throw new Error('tabac inconnu');
  let full: string;
  if (tabacId === pageTabacId) {
    full = tabacDisplayName((await getSettings()).shopName);
  } else {
    const shop = (await otherShopName(tabacId))?.trim();
    full = shop && shop !== DEFAULT_TABAC_NAME ? shop : entry.name || shop || '';
  }
  const name = full.trim().slice(0, NAME_MAX).trim() || DEFAULT_TABAC_NAME;
  return { name, payload: encodeTabacInvite({ name, key: entry.key }) };
}
