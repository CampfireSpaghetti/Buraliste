import { db } from './data/db';
import { TEST_SCAN_EVENT } from './features/scanner/feedback';
import type { CountLine, Product, Settings } from './domain/types';
import { notifyDataChanged } from './store';

export function testModeEnabled(): boolean {
  try {
    return import.meta.env.MODE !== 'production' || localStorage.getItem('carotte:test') === '1';
  } catch {
    return false;
  }
}

/** Points d'entrée pour les tests de bout en bout (jamais actifs pour un utilisateur normal). */
export function installTestHooks() {
  const w = window as unknown as Record<string, unknown>;
  w.__carotteScan = (code: string) => window.dispatchEvent(new CustomEvent(TEST_SCAN_EVENT, { detail: code }));
  w.__carotteSeed = async (data: { products?: Product[]; countLines?: CountLine[]; settings?: Partial<Settings> }) => {
    await db.transaction('rw', db.products, db.countLines, db.settings, async () => {
      await Promise.all([db.products.clear(), db.countLines.clear(), db.settings.clear()]);
      await db.products.bulkPut(data.products ?? []);
      await db.countLines.bulkPut(data.countLines ?? []);
      await db.settings.put({ shopName: 'Mon tabac', sortCount: 'name', fdjSeeded: true, ...data.settings, key: 'main' });
    });
    notifyDataChanged();
  };
}
