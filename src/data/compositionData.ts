import { useEffect, useState } from 'react';
import type { CompositionEntry, CompositionFile } from '../domain/composition';

/**
 * Composition déclarée à l'ANSES (public/data/composition.json, robot hebdomadaire) : trop gros pour le démarrage, il est
 * téléchargé à la première fiche de tabac ouverte, puis gardé en mémoire. Le service worker en garde une copie (cache à
 * l'exécution, pas de précache) pour le hors-ligne. Un échec ne bloque rien : pas de section, nouvel essai à la fiche suivante.
 */
let pending: Promise<CompositionFile | null> | null = null;

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
  const entry = Object.prototype.hasOwnProperty.call(file.produits, douaneRef) ? file.produits[douaneRef] : undefined;
  return entry && typeof entry === 'object' ? { entry, date: String(file.date ?? '') } : undefined;
}
