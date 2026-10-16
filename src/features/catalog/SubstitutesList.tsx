import { useMemo } from 'react';
import { effectiveFields } from '../../domain/matching';
import { suggestSubstitutes } from '../../domain/substitutes';
import type { Product } from '../../domain/types';
import { useNav } from '../../nav';
import { actions } from '../../store';

export function SubstitutesList({ target, all }: { target: Product; all: Product[] }) {
  const nav = useNav();
  const suggestions = useMemo(() => suggestSubstitutes(target, all, new Date()), [target, all]);
  const togglePin = (id: string) => {
    const pinned = target.pinnedSubstitutes;
    void actions.setPinned(target.id, pinned.includes(id) ? pinned.filter((x) => x !== id) : [id, ...pinned]);
  };
  return (
    <section className="subs" aria-label="À proposer au client" id="substitutes">
      <span className="label">À proposer au client</span>
      {suggestions.length === 0 && (
        <p className="muted">Aucun remplaçant trouvé. Renseignez la force, le format ou le goût de ce produit pour de meilleures suggestions.</p>
      )}
      {suggestions.map((s) => {
        const f = effectiveFields(s.product);
        const pinned = target.pinnedSubstitutes.includes(s.product.id);
        return (
          <div key={s.product.id} className="sub">
            <button type="button" className="card" onClick={() => nav.open({ type: 'product', id: s.product.id })}>
              <b>{f.name}</b>
              <span className="chips">
                {s.reasons.map((r) => <span key={r} className="chip">{r}</span>)}
              </span>
            </button>
            <button type="button" className="btn pin" aria-pressed={pinned} onClick={() => togglePin(s.product.id)}>
              {pinned ? 'Désépingler' : 'Épingler'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
