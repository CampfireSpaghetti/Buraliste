// Numéros des jeux de grattage en vente : code jeu (3 chiffres) + numéro d'émission (2 chiffres). D'après le règlement
// général des jeux de grattage FDJ, ce sont les 5 premiers chiffres du numéro d'identification de chaque ticket.
// Rien ne prouve que le code-barres reprenne ce numéro : l'app ne s'en sert que pour demander « Ce ticket est-il un … ? »
// au premier scan, jamais pour rattacher un ticket d'office.
//
// Table tenue à la main (versionnée) : « Validité des tickets vendus en points de vente » (Forclos.pdf, publié le
// 05/10/2026) et avis FDJ relatifs aux jeux de grattage de juin, juillet-août et octobre 2026. Les avis mensuels ne
// sont pas lus automatiquement : à chaque nouvelle émission annoncée, ajouter ici son numéro.
import { gameKey } from '../../src/domain/productId.ts';

/** Nom du jeu (comme sur fdj.fr) → numéros en vente (code jeu + émission). */
export const GAME_CODES: Record<string, string[]> = {
  'Astro': ['84701'],
  'Banco': ['88703'],
  'Black Jack': ['64712'],
  'CASH': ['87103', '87104', '87105'], // Cash 2026 (code 871) ; l'ancien Cash (code 140) est clos depuis le 28/06/2026
  'Cash Pocket': ['85901', '85902'],
  'Chambre Forte': ['87701'],
  "Chiffre d'Or": ['85601'],
  'Color Mix': ['87901'],
  'Emeraude vs Rubis': ['87001'],
  'Goal': ['87201', '87202'],
  'Jackpot': ['88201'], // nouveau Jackpot (code 882) depuis le 05/10/2026 ; code 659 clos
  'Maxi Black Jack': ['70502'],
  'Maxi Goal': ['87301'],
  'Maxi Mots Croisés': ['67307', '67308'],
  'Méga Goal': ['87401', '87402'],
  'Méga Mots Croisés': ['67406'],
  'Millionnaire': ['67105', '67106'],
  'Mission Patrimoine': ['88101'],
  'Mots croisés': ['67506'],
  'Mythic Jungle': ['86701'],
  'Numéro Fétiche': ['79902'],
  'Perle Rare': ['87501'],
  'Pharaonis': ['12101'],
  'Solitaire': ['86601'],
  // Émission 08 : code 668 d'après l'avis de juillet-août 2026, 666 d'après Forclos.pdf (incohérence FDJ non élucidée).
  'Super 10 ou 200': ['66807', '66808', '66608'],
  'Tarot Divination': ['86901'],
  "Ticket d'Or": ['80802', '80803'],
  'Vegas': ['63304', '63305'],
  'X10': ['14903', '14904'],
  'X20': ['14805', '14806'],
};

const byKey = new Map(Object.entries(GAME_CODES).map(([name, codes]) => [gameKey(name), codes]));

/** Numéros connus d'un jeu, par son nom (sans casse, accents ni ponctuation), sinon undefined. */
export function codesFor(name: string): string[] | undefined {
  return byKey.get(gameKey(name));
}
