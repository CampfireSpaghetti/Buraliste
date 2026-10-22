import { useEffect, useState } from 'react';
import * as repo from './data/db';
import { enqueueContributions, flushOutbox } from './data/sharingData';
import type { CountLine, Product, ProductFields, Settings } from './domain/types';

const DATA_EVENT = 'carotte:data';
export const notifyDataChanged = () => window.dispatchEvent(new Event(DATA_EVENT));

function useLive<T>(load: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void load().then((v) => alive && setValue(v));
    refresh();
    window.addEventListener(DATA_EVENT, refresh);
    window.addEventListener('carotte:catalog-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener(DATA_EVENT, refresh);
      window.removeEventListener('carotte:catalog-changed', refresh);
    };
  }, [load]);
  return value;
}

export const useProducts = () => useLive(repo.listProducts);
export const useCountLines = () => useLive(repo.listCountLines);
export const useSettings = () => useLive(repo.getSettings);

function withNotify<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  return async (...a: A): Promise<R> => {
    const r = await fn(...a);
    notifyDataChanged();
    return r;
  };
}

const FLUSH_DELAY_MS = 15_000;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** Envoi automatique des codes partagés, regroupés : 15 s après le dernier ajout (ou au retour du réseau). */
export function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushOutbox().then(notifyDataChanged), delay);
}

/** Toute modification d'un produit officiel qui ajoute un code part dans la file d'attente de partage. */
async function shareAfter(id: string, write: () => Promise<Product>): Promise<Product> {
  const before = await repo.getProduct(id);
  const after = await write();
  if (before && (await enqueueContributions(before, after)) > 0) scheduleFlush();
  return after;
}

export const actions = {
  // `base` (facultatif) : l'état dont l'écran est parti ; seuls les champs changés depuis sont écrits (R21).
  putProduct: withNotify((p: Product, base?: Product) => shareAfter(p.id, () => repo.putProduct(p, base))),
  patchUserFields: withNotify((id: string, patch: Partial<ProductFields>) => shareAfter(id, () => repo.patchUserFields(id, patch))),
  clearUserField: withNotify((id: string, key: keyof ProductFields) => repo.clearUserField(id, key)),
  // Retirer ne retire pas une contribution déjà envoyée à la liste commune : seulement ce tabac.
  removeUserCode: withNotify((id: string, code: string) => repo.removeUserCode(id, code)),
  setOutOfStock: withNotify((id: string, v: boolean) => repo.setOutOfStock(id, v)),
  setPinned: withNotify((id: string, ids: string[]) => repo.setPinned(id, ids)),
  upsertCountLine: withNotify((l: CountLine, base?: CountLine) => repo.upsertCountLine(l, base)),
  deleteCountLine: withNotify((id: string) => repo.deleteCountLine(id)),
  restoreCountLine: withNotify((l: CountLine) => repo.restoreCountLine(l)),
  saveSettings: withNotify((s: Partial<Settings>) => repo.saveSettings(s)),
  hideGame: withNotify((gameId: string) => repo.hideGame(gameId)),
  unhideGame: withNotify((gameId: string) => repo.unhideGame(gameId)),
};

/** État enregistré d'une fiche (la copie d'un écran peut dater d'avant une modification venue d'un autre téléphone). */
export const currentProduct = async (p: Product): Promise<Product> => (await repo.getProduct(p.id)) ?? p;

/** Nouveau produit saisi par le buraliste (couche user uniquement). */
export function newUserProduct(fields: Partial<ProductFields>): Product {
  return { id: repo.newId(), source: 'utilisateur', base: {}, user: fields, outOfStock: false, pinnedSubstitutes: [], updatedAt: Date.now() };
}

const { RECENT_KEY } = repo;
export function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function pushRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 20)));
  } catch {
    /* stockage indisponible : pas d'historique */
  }
}
