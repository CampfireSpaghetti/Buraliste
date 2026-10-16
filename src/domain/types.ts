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
  notes?: string;
}

export interface Product {
  id: string;
  source: 'douane' | 'depart' | 'utilisateur';
  douaneRef?: string;
  base: Partial<ProductFields>;
  user: Partial<ProductFields>;
  outOfStock: boolean;
  pinnedSubstitutes: string[];
  updatedAt: number;
}

export interface CountLine {
  id: string;
  gameId?: string;
  code: string;
  name: string;
  quantity: number;
  updatedAt: number;
}

export interface Settings {
  shopName: string;
  lastBackupAt?: number;
  referencesVersion?: string;
  referencesEffectiveDate?: string;
  sortCount: 'name' | 'updatedAt';
  fdjSeeded?: boolean;
}

export const TASTES = ['doux', 'léger', 'équilibré', 'corsé', 'intense', 'boisé', 'épicé', 'terreux', 'vanillé', 'fruité', 'crémeux', 'torréfié', 'herbacé'] as const;
export const GAME_TYPES = ['classique', 'gros lot', 'thématique', 'multi-chances'] as const;
