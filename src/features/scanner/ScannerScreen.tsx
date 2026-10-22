import { useState } from 'react';
import { effectiveFields, gameCandidates, learnFdjCode } from '../../domain/matching';
import type { Product } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, currentProduct, useProducts } from '../../store';
import { ConfirmGameDialog } from '../count/ConfirmGameDialog';
import { WhichGameDialog } from '../count/WhichGameDialog';
import { routeScan } from './scanRouter';
import { ScannerView, type ScannedResult } from './ScannerView';

export function ScannerScreen() {
  const nav = useNav();
  const products = useProducts();
  const [ask, setAsk] = useState<{ code: string; candidates: Product[] } | null>(null);
  const [confirm, setConfirm] = useState<{ code: string; game: Product; prefix: string } | null>(null);
  const byId = (id: string) => (products ?? []).find((p) => p.id === id);

  // Un code de traçabilité n'arrive jamais ici (ScannerView l'explique) : pas de cas « refuse ».
  const onResult = (r: ScannedResult) => {
    const to = routeScan(r, 'lookup');
    if (to.to === 'product') nav.open({ type: 'product', id: to.id });
    else if (to.to === 'attach') nav.open({ type: 'attach', code: to.code });
    else if (to.to === 'create') nav.open({ type: 'create', code: to.code, kind: to.kind });
    else if (to.to === 'confirm-game') {
      const game = byId(to.id);
      if (game) setConfirm({ code: to.code, game, prefix: to.prefix });
    } else if (to.to === 'which-game') {
      setAsk({ code: to.code, candidates: to.candidateIds.map(byId).filter((p): p is Product => !!p) });
    }
  };

  const games = (products ?? []).filter((p) => effectiveFields(p).kind === 'jeu-fdj');
  // « Ajouter un code » d'une fiche ouvre sa propre caméra : celle de cet onglet s'arrête pendant ce temps.
  const adding = nav.stack.some((v) => v.type === 'add-code');
  return (
    <>
      {!adding && <ScannerView mode="lookup" onResult={onResult} paused={nav.stack.length > 0 || ask !== null || confirm !== null} />}
      {confirm && (
        <ConfirmGameDialog
          game={confirm.game}
          code={confirm.code}
          onClose={() => setConfirm(null)}
          onOther={() => { setConfirm(null); setAsk({ code: confirm.code, candidates: gameCandidates(confirm.code, products ?? []) }); }}
          onYes={async () => {
            const { code, game, prefix } = confirm;
            setConfirm(null);
            await actions.patchUserFields(game.id, learnFdjCode(await currentProduct(game), code, products ?? [], { confirmedPrefix: prefix }));
            nav.open({ type: 'product', id: game.id });
          }}
        />
      )}
      {ask && (
        <WhichGameDialog
          code={ask.code}
          candidates={ask.candidates}
          games={games}
          onClose={() => setAsk(null)}
          onNewGame={() => { nav.open({ type: 'create', code: ask.code, kind: 'jeu-fdj' }); setAsk(null); }}
          onPick={async (g) => {
            await actions.patchUserFields(g.id, learnFdjCode(await currentProduct(g), ask.code, products ?? []));
            nav.open({ type: 'product', id: g.id });
            setAsk(null);
          }}
        />
      )}
    </>
  );
}
