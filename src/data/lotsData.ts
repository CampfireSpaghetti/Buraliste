import { useEffect, useState } from 'react';
import type { LotsEntry, LotsFile } from '../domain/lots';

/**
 * Lots des jeux FDJ (public/data/fdj-lots.json, robot hebdomadaire) : téléchargés à la première fiche de jeu ouverte,
 * puis gardés en mémoire. Hors ligne, le service worker sert la dernière version publiée. Un échec ne bloque rien :
 * pas de section « Lots », et nouvel essai à la fiche suivante.
 */
let pending: Promise<LotsFile | null> | null = null;

export function loadLots(fetchFn: typeof fetch = fetch): Promise<LotsFile | null> {
  pending ??= fetchFn(import.meta.env.BASE_URL + 'data/fdj-lots.json')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = (await res.json()) as LotsFile;
      if (!file || typeof file.jeux !== 'object' || file.jeux === null) throw new Error('fichier illisible');
      return file;
    })
    .catch((e) => {
      console.warn('Lots des jeux FDJ indisponibles', e);
      pending = null;
      return null;
    });
  return pending;
}

/** Pour les tests : oublie le fichier chargé. */
export function resetLotsCache(): void {
  pending = null;
}

/** Lots du jeu `fdjRef` (undefined tant que le fichier n'est pas là, ou si le jeu n'y est pas). */
export function useLots(fdjRef: string | undefined): LotsEntry | undefined {
  const [file, setFile] = useState<LotsFile | null>(null);
  useEffect(() => {
    if (!fdjRef) return;
    let alive = true;
    void loadLots().then((f) => { if (alive) setFile(f); });
    return () => { alive = false; };
  }, [fdjRef]);
  if (!fdjRef || !file) return undefined;
  const entry = file.jeux[fdjRef];
  return entry && Array.isArray(entry.lots) && entry.lots.length > 0 ? entry : undefined;
}
