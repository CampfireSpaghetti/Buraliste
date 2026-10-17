export type Kind = 'cigarette' | 'tabac-rouler' | 'cigare' | 'cigarillo' | 'autre-tabac' | 'jeu-fdj';

export const KIND_LABELS: Record<Kind, string> = {
  cigarette: 'Cigarettes',
  'tabac-rouler': 'Tabac à rouler',
  cigare: 'Cigares',
  cigarillo: 'Cigarillos',
  'autre-tabac': 'Autres tabacs',
  'jeu-fdj': 'Jeux FDJ',
};

export interface ProductFields {
  kind: Kind;
  name: string;
  brand?: string;
  format?: string;
  barcodes?: string[];
  fdjPrefix?: string;
  origin?: string;
  nicotineMg?: number;
  strength?: 1 | 2 | 3 | 4 | 5;
  tasteTags?: string[];
  price?: number;
  previousPrice?: number;
  effectiveDate?: string;
  status?: 'nouveau' | 'retrait' | 'inchange';
  ticketPrice?: number;
  maxPrize?: number;
  gameType?: string;
  isNew?: boolean; // jeu FDJ signalé « nouveau » par la FDJ
  notes?: string;
}

export interface Product {
  id: string;
  source: 'douane' | 'fdj' | 'depart' | 'utilisateur';
  douaneRef?: string;           // clé de la ligne Douane (tabac)
  fdjRef?: string;              // clé du jeu dans la liste FDJ (« fdj|ITGC9K »)
  base: Partial<ProductFields>;
  user: Partial<ProductFields>;
  outOfStock: boolean;
  pinnedSubstitutes: string[];
  sharedBarcodes?: string[]; // codes partagés par les téléphones de tous les tabacs (liste publique)
  sharedFdjPrefix?: string; // code de jeu partagé
  updatedAt: number;
}

export interface CountLine {
  id: string;
  gameId?: string;
  code: string;
  name: string;
  linearQty: number; // quantité linéaire (au présentoir), en tickets
  stockQty: number; // quantité en stock (réserve), en tickets
  updatedAt: number;
  deleted?: boolean; // ligne supprimée (gardée pour la synchronisation, jamais affichée)
}

export interface Settings {
  shopName: string;
  lastBackupAt?: number;
  referencesVersion?: string;
  referencesEffectiveDate?: string;
  sortCount: 'name' | 'updatedAt';
  fdjVersion?: string;
  fdjFetchedAt?: string;
  sharedCodesVersion?: string;
  hiddenGames?: string[]; // jeux enlevés de la liste de comptage par le buraliste
  // Envoi des codes-barres au relais. `shareToken` est l'ancienne clé GitHub des versions précédentes : plus utilisée,
  // effacée au démarrage, jamais partagée ni sauvegardée (le champ reste déclaré pour lire les anciennes données).
  shareToken?: string;
  shareStatus?: 'ok' | 'hors-ligne' | 'erreur';
  lastShareAt?: number;
}

export const TASTES = ['doux', 'léger', 'équilibré', 'corsé', 'intense', 'boisé', 'épicé', 'terreux', 'vanillé', 'fruité', 'crémeux', 'torréfié', 'herbacé'] as const;
export const GAME_TYPES = ['classique', 'gros lot', 'thématique', 'multi-chances'] as const;
