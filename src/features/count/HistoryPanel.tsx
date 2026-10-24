import { useCallback, useState } from 'react';
import { snapshotDiff } from '../../domain/history';
import { formatDateLong } from '../../domain/format';
import type { CountSnapshot } from '../../domain/types';
import { actions, useHistory } from '../../store';
import { Panel, Sheet } from '../../ui/Panel';
import { Toast } from '../../ui/Toast';

const totals = (s: CountSnapshot) => s.lines.reduce((t, l) => ({ linear: t.linear + l.linearQty, stock: t.stock + l.stockQty }), { linear: 0, stock: 0 });
/** « −12 », « +30 », « 0 » (vrai signe moins). */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const weekday = (ms: number) => {
  const s = new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const when = (ms: number) => `${weekday(ms)} ${formatDateLong(ms)}`;

/** Historique des 8 derniers comptages (« Fin comptage »), le plus récent en haut ; détail, écart, suppression. */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const history = useHistory();
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: CountSnapshot } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  if (!history) return null;
  const previous = (i: number) => history[i + 1];
  const open = history.findIndex((s) => s.id === openId);

  const remove = async (s: CountSnapshot) => {
    setOpenId(null);
    const before = await actions.deleteSnapshot(s.id);
    setToast({ message: `Comptage du ${formatDateLong(s.at)} supprimé`, undo: before });
  };

  return (
    <Panel title="Historique du grattage" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>Les 8 derniers comptages enregistrés par « Fin comptage ». Écart : tickets (linéaire + stock) par rapport au comptage précédent ; négatif = vendus, positif = livrés.</p>
      {history.length === 0 && <p className="muted">Aucun comptage enregistré. Touchez « Fin comptage » en bas de l'onglet Grattage.</p>}
      <ul className="history-list">
        {history.map((s, i) => {
          const t = totals(s);
          const d = snapshotDiff(s, previous(i)).total;
          return (
            <li key={s.id}>
              <button type="button" className="card history-item" onClick={() => setOpenId(s.id)}>
                <span className="history-when">{when(s.at)}</span>
                <span className="muted num">{s.lines.length} {s.lines.length > 1 ? 'jeux' : 'jeu'} · linéaire {t.linear} · stock {t.stock}</span>
                {d !== undefined && <span className={'history-delta num' + (d < 0 ? ' down' : d > 0 ? ' up' : '')} aria-label={`Écart ${signed(d)}`}>{signed(d)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {open >= 0 && <SnapshotDetail snapshot={history[open]} previous={previous(open)} onDelete={remove} onClose={() => setOpenId(null)} />}
      {toast && (
        <Toast
          message={toast.message}
          action={toast.undo ? 'Annuler' : undefined}
          onAction={() => { if (toast.undo) void actions.putSnapshots([toast.undo]); setToast(null); }}
          onDone={closeToast}
        />
      )}
    </Panel>
  );
}

function SnapshotDetail({ snapshot, previous, onDelete, onClose }: { snapshot: CountSnapshot; previous?: CountSnapshot; onDelete: (s: CountSnapshot) => void; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const diff = snapshotDiff(snapshot, previous);
  const t = totals(snapshot);
  return (
    <Panel title={`Comptage du ${formatDateLong(snapshot.at)}`} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        {previous ? `Écart avec le comptage du ${formatDateLong(previous.at)}.` : 'Premier comptage de l’historique : pas d’écart à montrer.'}
      </p>
      <div className="count-table-wrap">
        <table className="count-table history-table">
          <thead>
            <tr><th scope="col">Jeu</th><th scope="col" className="c-qty">Linéaire</th><th scope="col" className="c-qty">Stock</th>{previous && <th scope="col" className="c-qty">Écart</th>}</tr>
          </thead>
          <tbody>
            {snapshot.lines.map((l) => {
              const d = diff.byKey.get(l.key);
              return (
                <tr key={l.key + l.name}>
                  <th scope="row">{l.name}</th>
                  <td className="c-qty num">{l.linearQty}</td>
                  <td className="c-qty num">{l.stockQty}</td>
                  {previous && <td className={'c-qty num' + (typeof d === 'number' && d < 0 ? ' down' : typeof d === 'number' && d > 0 ? ' up' : '')}>{d === 'nouveau' ? 'nouveau' : d === undefined ? '' : signed(d)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total · {snapshot.lines.length} {snapshot.lines.length > 1 ? 'jeux' : 'jeu'}</th>
              <td className="c-qty num">{t.linear}</td>
              <td className="c-qty num">{t.stock}</td>
              {previous && <td className="c-qty num">{diff.total !== undefined ? signed(diff.total) : ''}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="btn danger" onClick={() => setConfirming(true)}>Supprimer ce comptage</button>
      {confirming && (
        <Sheet label="Supprimer ce comptage" onClose={() => setConfirming(false)}>
          <h3 style={{ fontSize: 20 }}>Supprimer le comptage du {formatDateLong(snapshot.at)} ?</h3>
          <p className="muted" style={{ margin: 0 }}>Sur tous les téléphones du tabac. « Annuler » reste possible quelques secondes.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Annuler</button>
            <button type="button" className="btn danger" onClick={() => onDelete(snapshot)}>Supprimer</button>
          </div>
        </Sheet>
      )}
    </Panel>
  );
}
