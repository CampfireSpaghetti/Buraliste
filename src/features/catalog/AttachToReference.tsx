import { useMemo, useState } from 'react';
import { effectiveFields, withUserBarcode } from '../../domain/matching';
import { currentPrice } from '../../domain/catalog';
import { searchProducts } from '../../domain/search';
import { formatEuro } from '../../domain/format';
import { useNav } from '../../nav';
import { actions, useProducts } from '../../store';
import { Panel } from '../../ui/Panel';

/** Écran « Code inconnu » : rattacher le code à une référence officielle (recommandé) ou créer une fiche. */
export function AttachToReference({ code }: { code: string }) {
  const nav = useNav();
  const products = useProducts();
  const [q, setQ] = useState('');
  const official = useMemo(() => (products ?? []).filter((p) => p.source === 'douane'), [products]);
  const results = useMemo(() => (q.trim().length >= 2 ? searchProducts(official, q, { limit: 40 }) : []), [official, q]);
  const today = new Date();

  const attach = async (id: string) => {
    const p = (products ?? []).find((x) => x.id === id);
    if (!p) return;
    await actions.patchUserFields(id, withUserBarcode(p.user, code));
    nav.replace({ type: 'product', id });
  };

  return (
    <Panel title="Code inconnu" onClose={nav.close}>
      <p className="num" style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{code}</p>
      <div className="card">
        <b>Rattacher à une référence officielle</b>
        <span className="muted">Recommandé : nom et prix officiels, mis à jour chaque semaine.</span>
      </div>
      <input className="input" id="attach-search" placeholder="Rechercher une référence" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.map((p) => {
        const f = effectiveFields(p);
        const price = currentPrice(f, today);
        return (
          <button key={p.id} type="button" className="card" onClick={() => attach(p.id)}>
            <b>{f.name}</b>
            <span className="muted">{price !== undefined ? formatEuro(price) : ''}</span>
          </button>
        );
      })}
      {q.trim().length >= 2 && results.length === 0 && <p className="muted">Aucune référence trouvée. Essayez la marque seule.</p>}
      <button type="button" className="btn" onClick={() => nav.replace({ type: 'create', code })}>Créer une fiche à la main</button>
    </Panel>
  );
}
