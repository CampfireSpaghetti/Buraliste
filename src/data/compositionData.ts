import { useEffect, useState } from 'react';
import type { CompositionEntry, CompositionFile, Ingredient } from '../domain/composition';

/**
 * Composition déclarée à l'ANSES (public/data/composition.json, robot hebdomadaire) : trop gros pour le démarrage, il est
 * téléchargé à la première fiche de tabac ouverte, puis gardé en mémoire. Le service worker en garde une copie (cache à
 * l'exécution, pas de précache) pour le hors-ligne. Un échec ne bloque rien : pas de section, nouvel essai à la fiche suivante.
 */
let pending: Promise<CompositionFile | null> | null = null;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Composition d'une référence, sans ce qui pourrait casser la fiche : ingrédients au nom texte (fonction texte ou vide,
 * « brûlé » seulement s'il est vrai ou faux), émissions et total seulement en nombres finis, EAN en texte.
 */
export function cleanCompositionEntry(raw: unknown): CompositionEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  const ingredients: Ingredient[] = [];
  for (const i of Array.isArray(e.ingredients) ? e.ingredients : []) {
    if (!i || typeof i !== 'object' || typeof i.nom !== 'string') continue;
    const ing: Ingredient = { nom: i.nom, fonction: typeof i.fonction === 'string' ? i.fonction : '' };
    if (typeof i.brule === 'boolean') ing.brule = i.brule;
    ingredients.push(ing);
  }
  const out: CompositionEntry = { ingredients, ean: Array.isArray(e.ean) ? e.ean.filter((c): c is string => typeof c === 'string') : [] };
  if (finite(e.nicotine)) out.nicotine = e.nicotine;
  if (finite(e.goudron)) out.goudron = e.goudron;
  if (finite(e.co)) out.co = e.co;
  if (finite(e.ingredientsTotal)) out.ingredientsTotal = e.ingredientsTotal;
  return out;
}

export function loadComposition(fetchFn: typeof fetch = fetch): Promise<CompositionFile | null> {
  pending ??= fetchFn(import.meta.env.BASE_URL + 'data/composition.json')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = (await res.json()) as CompositionFile;
      if (!file || typeof file.produits !== 'object' || file.produits === null) throw new Error('fichier illisible');
      return file;
    })
    .catch((e) => {
      console.warn('Composition ANSES indisponible', e);
      pending = null;
      return null;
    });
  return pending;
}

/** Pour les tests : oublie le fichier chargé. */
export function resetCompositionCache(): void {
  pending = null;
}

/** Composition de la référence Douane `douaneRef` et date de la déclaration ; undefined si inconnue (ou pas encore là). */
export function useComposition(douaneRef: string | undefined): { entry: CompositionEntry; date: string } | undefined {
  const [file, setFile] = useState<CompositionFile | null>(null);
  useEffect(() => {
    if (!douaneRef) return;
    let alive = true;
    void loadComposition().then((f) => { if (alive) setFile(f); });
    return () => { alive = false; };
  }, [douaneRef]);
  if (!douaneRef || !file) return undefined;
  const entry = Object.prototype.hasOwnProperty.call(file.produits, douaneRef) ? cleanCompositionEntry(file.produits[douaneRef]) : undefined;
  return entry ? { entry, date: String(file.date ?? '') } : undefined;
}
