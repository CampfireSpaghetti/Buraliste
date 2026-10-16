import { useSyncExternalStore } from 'react';

/** Stockage persistant accordé par le navigateur ? undefined tant que la réponse n'est pas connue. */
let persisted: boolean | undefined;
const listeners = new Set<() => void>();

export function setPersisted(v: boolean) {
  persisted = v;
  listeners.forEach((l) => l());
}

export function usePersisted(): boolean | undefined {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => persisted,
  );
}
