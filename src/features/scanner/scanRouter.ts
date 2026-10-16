import type { ScanResult } from '../../domain/matching';
import type { Kind } from '../../domain/types';

export type Navigation =
  | { to: 'product'; id: string }
  | { to: 'create'; code: string; kind?: Kind }
  | { to: 'attach'; code: string }
  | { to: 'which-game'; code: string; candidateIds: string[] };

export function routeScan(result: ScanResult, _mode: 'lookup'): Navigation {
  switch (result.type) {
    case 'product':
      return { to: 'product', id: result.product.id };
    case 'unknown-ean':
      return { to: 'attach', code: result.code };
    case 'ask-game':
      return { to: 'which-game', code: result.code, candidateIds: result.candidates.map((c) => c.id) };
    case 'new-game':
      return { to: 'create', code: result.code, kind: 'jeu-fdj' };
  }
}
