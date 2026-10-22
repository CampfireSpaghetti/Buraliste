/** Un palier du tableau des lots : `nombre` lots de `montant` euros, par bloc de tickets. */
export type Lot = { montant: number; nombre: number };

/** Lots d'un jeu de grattage, d'après sa page fdj.fr (mêmes chiffres que le règlement du jeu). */
export type LotsEntry = {
  prix: number;     // prix du ticket, en euros
  chance?: number;  // 1 chance sur `chance` de gagner (publiée, sinon recalculée : bloc / nombre de lots)
  trj?: number;     // taux de retour aux joueurs, en %
  gainMax: number;  // plus gros lot, en euros
  bloc?: number;    // tickets par bloc (règlement), quand il est connu
  lots: Lot[];      // du plus gros montant au plus petit
  source: string;   // page fdj.fr lue
  majLe: string;    // date (AAAA-MM-JJ) du dernier changement de ces chiffres
};

/** public/data/fdj-lots.json : clé = `ref` du jeu dans fdj-games.json (`fdj|<id FDJ>`, `fdjRef` du produit). */
export type LotsFile = { version: string; fetchedAt: string; jeux: Record<string, LotsEntry> };

const fr = (n: number, min: number, max: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max });

/** « 2 439 968 ». */
export const formatCount = (n: number) => fr(n, 0, 0);
/** « 500 000 € » ; « 0,50 € ». */
export const formatGain = (n: number) => (Number.isInteger(n) ? fr(n, 0, 0) : fr(n, 2, 2)) + '\u00a0€';
/** « 3,82 ». */
export const formatChance = (n: number) => fr(n, 2, 2);
/** « 70 % » ; « 68,5 % ». */
export const formatTrj = (n: number) => fr(n, 0, 1) + '\u00a0%';
