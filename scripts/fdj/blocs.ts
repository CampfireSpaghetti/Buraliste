// Taille du bloc de chaque jeu de grattage : le nombre de tickets auquel s'applique le tableau des lots (« Chaque émission
// de tickets est répartie en blocs de N tickets »). Elle est dans le règlement du jeu, pas sur sa page fdj.fr.
//
// Table tenue à la main (versionnée) : règlements particuliers PDV des jeux en vente, relevés le 22/10/2026 (rapport
// « Composition tabac et lots grattage », section 1). Elle sert à afficher « pour N tickets » et à contrôler la chance
// publiée (bloc / nombre de lots). Un jeu absent : pas de bloc affiché, sauf si sa page le donne (« Pour N unités de
// jeu »). À un nouveau règlement (nouveau code jeu dans gameCodes.ts), vérifier ici la taille du bloc.
import { gameKey } from '../../src/domain/productId.ts';

/** Nom du jeu (comme sur fdj.fr) → tickets par bloc. */
export const BLOCS: Record<string, number> = {
  'Astro': 4_500_000,
  'Banco': 6_000_000,
  'Black Jack': 4_500_000,
  'CASH': 24_000_000, // Cash 2026 (code 871)
  'Cash Pocket': 6_000_000,
  'Chambre Forte': 6_000_000,
  "Chiffre d'Or": 9_000_000,
  'Color Mix': 3_000_000,
  'Emeraude vs Rubis': 12_000_000,
  'Goal': 3_000_000, // Goal 2026 (code 872)
  'Jackpot': 15_000_000, // Jackpot 2026 (code 882)
  'Maxi Black Jack': 9_000_000,
  'Maxi Goal': 4_500_000,
  'Maxi Mots Croisés': 4_500_000,
  'Méga Goal': 6_000_000,
  'Méga Mots Croisés': 6_000_000,
  'Millionnaire': 6_000_000,
  'Mission Patrimoine': 4_500_000,
  'Mots croisés': 4_500_000,
  'Mythic Jungle': 6_000_000,
  'Numéro Fétiche': 4_500_000,
  'Perle Rare': 6_000_000,
  'Pharaonis': 3_000_000,
  'Solitaire': 4_500_000, // Solitaire 2025 (code 866)
  'Super 10 ou 200': 3_000_000,
  'Tarot Divination': 6_000_000,
  "Ticket d'Or": 9_000_000,
  'Vegas': 2_000_000,
  'X10': 6_000_000,
  'X20': 12_000_000,
};

const byKey = new Map(Object.entries(BLOCS).map(([name, bloc]) => [gameKey(name), bloc]));

/** Tickets par bloc d'un jeu, par son nom (sans casse, accents ni ponctuation), sinon undefined. */
export function blocFor(name: string): number | undefined {
  return byKey.get(gameKey(name));
}
