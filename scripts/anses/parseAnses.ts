// Lecture des fichiers ANSES « Produits du tabac et produits connexes déclarés sur le marché français » (data.gouv.fr) :
// CSV UTF-8, séparateur « ; », texte entre guillemets, décimale « . ». Points d'attention (fichier de juillet 2026) :
// dates aux formats mélangés (« 5/9/2019 08:14:00 », « 13/01/2026 13:10:25 »), quantités en notation scientifique.
// Données publiées telles que déclarées : lues comme du texte, jamais exécutées.
import type { AnsesCategory, AnsesProduct } from './matchDouane.ts';

export type AnsesIngredientRow = { code: string; nom: string; fonction: string; brule?: boolean };

/** CSV « ; » (guillemets, guillemets doublés, retours à la ligne dans un champ, BOM, fins de ligne \r\n). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Nombre (« 8.23 », « 4.6e-04 ») ; undefined si vide ou illisible. */
export function num(s: string | undefined): number | undefined {
  const t = (s ?? '').trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** « 5/9/2019 08:14:00 » → « 2019-09-05T08:14:00 » (jour/mois, complétés ou non) ; chaîne vide si illisible. */
export function frDateTime(s: string | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec((s ?? '').trim());
  if (!m) return '';
  const p = (x: string | undefined) => (x ?? '0').padStart(2, '0');
  return `${m[3]}-${p(m[2])}-${p(m[1])}T${p(m[4])}:${p(m[5])}:${p(m[6])}`;
}

/** Lignes du fichier, par nom de colonne. Une colonne attendue absente : erreur (format changé), jamais une liste vide. */
function table(csv: string, required: string[]): Record<string, string>[] {
  const [head, ...body] = parseCsv(csv);
  const cols = (head ?? []).map((h) => h.trim());
  const missing = required.filter((r) => !cols.includes(r));
  if (missing.length) throw new Error(`Fichier ANSES : colonne(s) absente(s) ${missing.join(', ')} (format changé ?)`);
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

const COMMON = ['Code_Référence', 'Date_Dernière_Mise_A_Jour_Du_Dossier', 'Nom_Marque_Produit', 'Nom_Sous-type_Marque_Produit',
  'Filtre_Produit', 'Unités_Conditionnement_Produit', 'Type_Conditionnement_Produit', 'Type_Numéro_Produit', 'Numéro_Produit'];

function product(r: Record<string, string>, categorie: AnsesCategory): AnsesProduct {
  const p: AnsesProduct = {
    code: r['Code_Référence'],
    categorie,
    marque: r['Nom_Marque_Produit'],
    sousType: r['Nom_Sous-type_Marque_Produit'],
    conditionnement: r['Type_Conditionnement_Produit'],
    typeNumero: r['Type_Numéro_Produit'],
    numero: r['Numéro_Produit'],
    majLe: frDateTime(r['Date_Dernière_Mise_A_Jour_Du_Dossier']),
  };
  // « filtre » / « sans filtre » ; vide ou autre valeur : non précisé.
  const filtre = r['Filtre_Produit'].trim().toLowerCase();
  if (filtre === 'filtre') p.filtre = true;
  else if (filtre === 'sans filtre') p.filtre = false;
  const unites = num(r['Unités_Conditionnement_Produit']);
  if (unites) p.unites = unites;
  const poids = num(r['Poids_NET_Conditionnement_Produit']);
  if (poids) p.poids = poids;
  return orderKeys(p);
}

/** Ordre des clés fixe (lisible dans les tests et les journaux). */
function orderKeys(p: AnsesProduct): AnsesProduct {
  const { code, categorie, marque, sousType, filtre, unites, poids, conditionnement, typeNumero, numero, majLe, ...rest } = p;
  return { code, categorie, marque, sousType, ...(filtre !== undefined ? { filtre } : {}), ...(unites !== undefined ? { unites } : {}), ...(poids !== undefined ? { poids } : {}), conditionnement, typeNumero, numero, majLe, ...rest };
}

/** liste-fr-cigarettes.csv : émissions de goudron, nicotine et CO (mg par cigarette, ISO). */
export function parseCigarettes(csv: string): AnsesProduct[] {
  return table(csv, [...COMMON, 'Émission_Goudron', 'Émission_Nicotine', 'Émission_CO'])
    .filter((r) => r['Code_Référence'])
    .map((r) => {
      const p = product(r, 'cigarette');
      const goudron = num(r['Émission_Goudron']);
      const nicotine = num(r['Émission_Nicotine']);
      const co = num(r['Émission_CO']);
      if (goudron !== undefined) p.goudron = goudron;
      if (nicotine !== undefined) p.nicotine = nicotine;
      if (co !== undefined) p.co = co;
      return p;
    });
}

const TYPES: Record<string, AnsesCategory> = { 'tabac à rouler': 'tabac-rouler', cigare: 'cigare', cigarillo: 'cigarillo' };

/** liste-fr-autres-produits.csv : tabac à rouler (poids net), cigares et cigarillos ; les autres types sont « autre ». */
export function parseAutres(csv: string): AnsesProduct[] {
  return table(csv, [...COMMON, 'Type_Produit', 'Poids_NET_Conditionnement_Produit'])
    .filter((r) => r['Code_Référence'])
    .map((r) => product(r, TYPES[r['Type_Produit'].toLowerCase()] ?? 'autre'));
}

/** composition-fr-tabac.csv : une ligne par ingrédient (« (brûlé) », « (non brûlé) », « (divers) » = non précisé). */
export function parseComposition(csv: string): AnsesIngredientRow[] {
  return table(csv, ['Code_Référence', 'Nom_Ingrédient', 'Fonction_Ingrédient', 'Ingrédient_Combustion'])
    .filter((r) => r['Code_Référence'] && r['Nom_Ingrédient'])
    .map((r) => {
      const c = r['Ingrédient_Combustion'].toLowerCase();
      const row: AnsesIngredientRow = { code: r['Code_Référence'], nom: r['Nom_Ingrédient'], fonction: r['Fonction_Ingrédient'] };
      if (c.includes('non brûlé')) row.brule = false;
      else if (c.includes('brûlé')) row.brule = true;
      return row;
    });
}
