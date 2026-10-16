import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Kind } from './domain/types';
import { pushRecent } from './store';

export type View =
  | { type: 'product'; id: string }
  | { type: 'create'; code?: string; kind?: Kind; then?: 'count' }
  | { type: 'edit'; id: string }
  | { type: 'attach'; code: string }
  | { type: 'compare'; ids: string[] };

type Nav = {
  stack: View[]; open: (v: View) => void; replace: (v: View) => void; close: () => void; closeAll: () => void;
  compare: string[]; toggleCompare: (id: string) => void; clearCompare: () => void;
};

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<View[]>([]);
  const track = (v: View) => v.type === 'product' && pushRecent(v.id);
  const open = useCallback((v: View) => { track(v); setStack((s) => [...s, v]); }, []);
  const replace = useCallback((v: View) => { track(v); setStack((s) => [...s.slice(0, -1), v]); }, []);
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);
  const [compare, setCompare] = useState<string[]>([]);
  const toggleCompare = useCallback(
    (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-3))),
    [],
  );
  const clearCompare = useCallback(() => setCompare([]), []);
  return (
    <NavContext.Provider value={{ stack, open, replace, close, closeAll, compare, toggleCompare, clearCompare }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav hors de NavProvider');
  return n;
}
