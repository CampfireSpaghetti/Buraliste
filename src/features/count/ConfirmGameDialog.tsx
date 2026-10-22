import { effectiveFields } from '../../domain/matching';
import type { Product } from '../../domain/types';
import { Sheet } from '../../ui/Panel';

/**
 * Le numéro du ticket commence comme un jeu du catalogue FDJ, jamais confirmé dans ce tabac. « Oui » confirme ce début
 * de numéro (reconnu directement ensuite, sur tous les téléphones du tabac) ; « Autre jeu » ne le confirme pas.
 */
export function ConfirmGameDialog({ game, code, onYes, onOther, onClose }: { game: Product; code: string; onYes: () => void; onOther: () => void; onClose: () => void }) {
  const title = `Ce ticket est-il un ${effectiveFields(game).name} ?`;
  return (
    <Sheet label={title} onClose={onClose}>
      <h3 style={{ fontSize: 20 }}>{title}</h3>
      <p className="muted" style={{ margin: 0 }}>Code <span className="num">{code}</span></p>
      <div className="row">
        <button type="button" className="btn" onClick={onOther}>Autre jeu</button>
        <button type="button" className="btn accent" onClick={onYes}>Oui</button>
      </div>
    </Sheet>
  );
}
