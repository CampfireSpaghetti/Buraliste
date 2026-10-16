import { useEffect, useState } from 'react';
import * as repo from './data/db';
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

export const actions = {
  putProduct: withNotify((p: Product) => repo.putProduct(p)),
  patchUserFields: withNotify((id: string, patch: Partial<ProductFields>) => repo.patchUserFields(id, patch)),
  clearUserField: withNotify((id: string, key: keyof ProductFields) => repo.clearUserField(id, key)),
  setOutOfStock: withNotify((id: string, v: boolean) => repo.setOutOfStock(id, v)),
  setPinned: withNotify((id: string, ids: string[]) => repo.setPinned(id, ids)),
  upsertCountLine: withNotify((l: CountLine) => repo.upsertCountLine(l)),
  deleteCountLine: withNotify((id: string) => repo.deleteCountLine(id)),
  restoreCountLine: withNotify((l: CountLine) => repo.restoreCountLine(l)),
  saveSettings: withNotify((s: Partial<Settings>) => repo.saveSettings(s)),
};

/** Nouveau produit saisi par le buraliste (couche user uniquement). */
export function newUserProduct(fields: Partial<ProductFields>): Product {
  return { id: repo.newId(), source: 'utilisateur', base: {}, user: fields, outOfStock: false, pinnedSubstitutes: [], updatedAt: Date.now() };
}

const RECENT_KEY = 'carotte:recent';
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
