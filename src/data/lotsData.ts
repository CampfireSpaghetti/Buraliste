import { useEffect, useState } from 'react';
import type { LotsEntry, LotsFile } from '../domain/lots';

/**
 * Lots des jeux FDJ (public/data/fdj-lots.json, robot hebdomadaire) : téléchargés à la première fiche de jeu ouverte,
 * puis gardés en mémoire. Hors ligne, le service worker sert la dernière version publiée. Un échec ne bloque rien :
 * pas de section « Lots », et nouvel essai à la fiche suivante.
 */
let pending: Promise<LotsFile | null> | null = null;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Entrée d'un jeu, sans ce qui pourrait casser la fiche : paliers aux montant et nombre finis seulement, chiffres
 * facultatifs gardés s'ils sont des nombres finis ; undefined s'il ne reste aucun palier.
 */
export function cleanLotsEntry(raw: unknown): LotsEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  const lots = (Array.isArray(e.lots) ? e.lots : [])
    .filter((l): l is { montant: number; nombre: number } => !!l && typeof l === 'object' && finite(l.montant) && finite(l.nombre))
    .map((l) => ({ montant: l.montant, nombre: l.nombre }));
  if (!lots.length) return undefined;
  const out: LotsEntry = {
    prix: finite(e.prix) ? e.prix : 0,
    gainMax: finite(e.gainMax) ? e.gainMax : Math.max(...lots.map((l) => l.montant)),
    lots,
    source: typeof e.source === 'string' ? e.source : '',
    majLe: typeof e.majLe === 'string' ? e.majLe : '',
  };
  if (finite(e.chance)) out.chance = e.chance;
  if (finite(e.trj)) out.trj = e.trj;
  if (finite(e.bloc)) out.bloc = e.bloc;
  return out;
}

/** Fichier lu : seulement les jeux dont l'entrée est utilisable (voir cleanLotsEntry). */
export function cleanLotsFile(raw: unknown): LotsFile {
  const f = raw as Partial<LotsFile> | null;
  if (!f || typeof f.jeux !== 'object' || f.jeux === null || Array.isArray(f.jeux)) throw new Error('fichier illisible');
  const jeux: Record<string, LotsEntry> = {};
  for (const [ref, entry] of Object.entries(f.jeux)) {
    const clean = cleanLotsEntry(entry);
    if (clean) jeux[ref] = clean;
  }
  return { version: String(f.version ?? ''), fetchedAt: String(f.fetchedAt ?? ''), jeux };
}

export function loadLots(fetchFn: typeof fetch = fetch): Promise<LotsFile | null> {
  pending ??= fetchFn(import.meta.env.BASE_URL + 'data/fdj-lots.json')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return cleanLotsFile(await res.json());
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
  return Object.prototype.hasOwnProperty.call(file.jeux, fdjRef) ? file.jeux[fdjRef] : undefined;
}
