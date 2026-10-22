import { useCallback, useState } from 'react';
import { effectiveFields, gameCandidates, learnFdjCode, type ScanResult } from '../../domain/matching';
import type { Product } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, useProducts } from '../../store';
import { Toast } from '../../ui/Toast';
import { ConfirmGameDialog } from '../count/ConfirmGameDialog';
import { WhichGameDialog } from '../count/WhichGameDialog';
import { routeScan } from './scanRouter';
import { ScannerView } from './ScannerView';

export function ScannerScreen() {
  const nav = useNav();
  const products = useProducts();
  const [ask, setAsk] = useState<{ code: string; candidates: Product[] } | null>(null);
  const [confirm, setConfirm] = useState<{ code: string; game: Product; prefix: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);

  const onResult = (r: ScanResult) => {
    const to = routeScan(r, 'lookup');
    if (to.to === 'product') nav.open({ type: 'product', id: to.id });
    else if (to.to === 'attach') nav.open({ type: 'attach', code: to.code });
    else if (to.to === 'create') nav.open({ type: 'create', code: to.code, kind: to.kind });
    else if (to.to === 'refuse') setNotice(to.message);
    else if (r.type === 'confirm-game') setConfirm({ code: r.code, game: r.product, prefix: r.prefix });
    else if (r.type === 'ask-game') setAsk({ code: r.code, candidates: r.candidates });
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
            await actions.patchUserFields(game.id, learnFdjCode(game, code, products ?? [], { confirmedPrefix: prefix }));
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
            await actions.patchUserFields(g.id, learnFdjCode(g, ask.code, products ?? []));
            nav.open({ type: 'product', id: g.id });
            setAsk(null);
          }}
        />
      )}
      {notice && <Toast message={notice} onDone={closeNotice} />}
    </>
  );
}
