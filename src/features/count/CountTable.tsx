import { useRef, useState } from 'react';
import { countTotals } from '../../domain/count';
import { formatDateShort } from '../../domain/format';
import type { CountLine } from '../../domain/types';

export type QtyField = 'linearQty' | 'stockQty';

type Props = {
  lines: CountLine[];
  hitId?: string;
  onQuantity: (l: CountLine, field: QtyField) => void;
  onCheck: (l: CountLine, checked: boolean) => void;
  onEdit: (l: CountLine) => void;
  onDelete: (l: CountLine) => void;
};

const SWIPE_PX = 50;

function Row({ line, hit, onQuantity, onCheck, onEdit, onDelete }: { line: CountLine; hit: boolean } & Omit<Props, 'lines' | 'hitId'>) {
  const [swiped, setSwiped] = useState(false);
  const start = useRef<number | null>(null);
  return (
    <tr
      className={(hit ? 'hit' : '') + (line.checked ? ' done' : '') + (swiped ? ' swiped' : '')}
      data-updated={line.updatedAt}
      onPointerDown={(e) => { start.current = e.clientX; }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const dx = e.clientX - start.current;
        if (dx < -SWIPE_PX) setSwiped(true);
        if (dx > SWIPE_PX) setSwiped(false);
      }}
      onPointerUp={() => { start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
    >
      <td className="c-check">
        <label className="check-cell">
          <input type="checkbox" checked={line.checked === true} onChange={(e) => onCheck(line, e.target.checked)} aria-label={`Valider ${line.name}`} />
        </label>
      </td>
      <td className="c-name"><button type="button" className="cell-btn" onClick={() => onEdit(line)}>{line.name}</button></td>
      <td className="c-qty">
        <button type="button" className="cell-btn qty num" onClick={() => onQuantity(line, 'linearQty')} aria-label={`Linéaire ${line.name} : ${line.linearQty}`}><span className="qty-box">{line.linearQty}</span></button>
      </td>
      <td className="c-qty">
        <button type="button" className="cell-btn qty num" onClick={() => onQuantity(line, 'stockQty')} aria-label={`Stock ${line.name} : ${line.stockQty}`}><span className="qty-box">{line.stockQty}</span></button>
      </td>
      <td className="c-date num">
        {swiped ? (
          <button type="button" className="swipe-del" onClick={() => onDelete(line)} aria-label={`Supprimer ${line.name}`}>Supprimer</button>
        ) : (
          line.updatedAt > 0 ? <>{formatDateShort(line.updatedAt).split(' ')[0]}<br />{formatDateShort(line.updatedAt).split(' ')[1]}</> : '—'
        )}
      </td>
    </tr>
  );
}

export function CountTable({ lines, hitId, onQuantity, onCheck, onEdit, onDelete }: Props) {
  const totals = countTotals(lines);
  return (
    <div className="count-table-wrap">
      <table className="count-table">
        <thead>
          <tr><th scope="col" className="c-check" aria-label="Validé">✓</th><th scope="col">Jeu</th><th scope="col" className="c-qty">Linéaire</th><th scope="col" className="c-qty">Stock</th><th scope="col">Modifié</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <Row key={l.id} line={l} hit={l.id === hitId} onQuantity={onQuantity} onCheck={onCheck} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <th scope="row">Total · {lines.length} {lines.length > 1 ? 'jeux' : 'jeu'}</th>
            <td className="c-qty num" aria-label={`Total linéaire ${totals.linear}`}>{totals.linear}</td>
            <td className="c-qty num" aria-label={`Total stock ${totals.stock}`}>{totals.stock}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {lines.length === 0 && <p className="muted empty">Aucune ligne. Touchez « Scanner » pour compter les tickets, ou « + Ligne » pour saisir à la main.</p>}
    </div>
  );
}
