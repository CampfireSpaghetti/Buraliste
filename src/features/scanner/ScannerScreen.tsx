import { useState } from 'react';
import { learnFdjCode, type ScanResult } from '../../domain/matching';
import { effectiveFields } from '../../domain/matching';
import type { Product } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, useProducts } from '../../store';
import { WhichGameDialog } from '../count/WhichGameDialog';
import { routeScan } from './scanRouter';
import { ScannerView } from './ScannerView';

export function ScannerScreen() {
  const nav = useNav();
  const products = useProducts();
  const [ask, setAsk] = useState<{ code: string; candidates: Product[] } | null>(null);

  const onResult = (r: ScanResult) => {
    const to = routeScan(r, 'lookup');
    if (to.to === 'product') nav.open({ type: 'product', id: to.id });
    else if (to.to === 'attach') nav.open({ type: 'attach', code: to.code });
    else if (to.to === 'create') nav.open({ type: 'create', code: to.code, kind: to.kind });
    else if (r.type === 'ask-game') setAsk({ code: r.code, candidates: r.candidates });
  };

  const games = (products ?? []).filter((p) => effectiveFields(p).kind === 'jeu-fdj');
  return (
    <>
      <ScannerView mode="lookup" onResult={onResult} paused={nav.stack.length > 0 || ask !== null} />
      {ask && (
        <WhichGameDialog
          code={ask.code}
          candidates={ask.candidates}
          games={games}
          onClose={() => setAsk(null)}
          onNewGame={() => { nav.open({ type: 'create', code: ask.code, kind: 'jeu-fdj' }); setAsk(null); }}
          onPick={async (g) => {
            await actions.patchUserFields(g.id, learnFdjCode(g, ask.code, products ?? []));
            nav.open({ type: 'product', id: g.id });
            setAsk(null);
          }}
        />
      )}
    </>
  );
}
