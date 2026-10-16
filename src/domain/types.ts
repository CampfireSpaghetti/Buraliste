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
  sharedBarcodes?: string[]; // codes partagés par les téléphones jumelés (liste publique)
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
  // Partage des codes-barres (téléphone jumelé). La clé ne quitte jamais le téléphone : exclue des sauvegardes.
  shareToken?: string;
  shareStatus?: 'ok' | 'cle-refusee' | 'hors-ligne' | 'erreur';
  lastShareAt?: number;
}

export const TASTES = ['doux', 'léger', 'équilibré', 'corsé', 'intense', 'boisé', 'épicé', 'terreux', 'vanillé', 'fruité', 'crémeux', 'torréfié', 'herbacé'] as const;
export const GAME_TYPES = ['classique', 'gros lot', 'thématique', 'multi-chances'] as const;
