/** Un ingrédient déclaré : nom, fonction (« Humectant »…), brûlé ou non (absent : non précisé). */
export type Ingredient = { nom: string; fonction: string; brule?: boolean };

/**
 * Composition déclarée par le fabricant à l'ANSES pour une référence Douane rapprochée.
 * Émissions en mg par cigarette (cigarettes seulement) ; ingrédients sans doublon (au plus MAX_INGREDIENTS) ;
 * `ean` : codes-barres EAN-8/13 valides du fichier ANSES, aussi ajoutés aux codes officiels de la référence.
 */
export type CompositionEntry = {
  nicotine?: number;
  goudron?: number;
  co?: number;
  ingredients: Ingredient[];
  ean: string[];
};

/**
 * public/data/composition.json (robot hebdomadaire, fichiers ANSES de data.gouv.fr) : clé = référence Douane (`douaneRef`
 * du produit). `date` (AAAA-MM-JJ) : date du fichier ANSES, citée sur la fiche.
 */
export type CompositionFile = {
  version: string;
  fetchedAt: string;
  date: string;
  source: string;
  produits: Record<string, CompositionEntry>;
};

export const MAX_INGREDIENTS = 60;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-07-01 » → « juillet 2026 » ; chaîne vide si la date est illisible. */
export function monthYearFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso));
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : '';
}

/** « 0,8 » ; « 10 » ; « 0,56 ». */
export const formatMg = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** « Nicotine 0,8 mg · Goudron 10 mg · Monoxyde de carbone 10 mg » ; vide si aucune valeur. */
export function emissionsLine(e: Pick<CompositionEntry, 'nicotine' | 'goudron' | 'co'>): string {
  const parts: string[] = [];
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (ok(e.nicotine)) parts.push(`Nicotine ${formatMg(e.nicotine)} mg`);
  if (ok(e.goudron)) parts.push(`Goudron ${formatMg(e.goudron)} mg`);
  if (ok(e.co)) parts.push(`Monoxyde de carbone ${formatMg(e.co)} mg`);
  return parts.join(' · ');
}
