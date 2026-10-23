import { useMemo, useState } from 'react';
import { currentPrice, officialState } from '../../domain/catalog';
import { effectiveFields } from '../../domain/matching';
import { searchProducts } from '../../domain/search';
import { formatEuro } from '../../domain/format';
import { KIND_LABELS, type Kind, type Product } from '../../domain/types';
import { useNav } from '../../nav';
import { readRecent, useProducts } from '../../store';
import enseigne from '../../assets/enseigne-tabac.webp';
import './catalog.css';

type Filter = 'tout' | Kind | 'rupture';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'tout', label: 'Tout' },
  { id: 'cigarette', label: 'Cigarettes' },
  { id: 'tabac-rouler', label: 'Rouler' },
  { id: 'cigare', label: 'Cigares' },
  { id: 'cigarillo', label: 'Cigarillos' },
  { id: 'autre-tabac', label: 'Autres' },
  { id: 'jeu-fdj', label: 'Jeux FDJ' },
];

export function ProductCard({ product, today }: { product: Product; today: Date }) {
  const nav = useNav();
  const f = effectiveFields(product);
  const price = f.kind === 'jeu-fdj' ? f.ticketPrice : currentPrice(f, today);
  const state = officialState(f, today);
  const checked = nav.compare.includes(product.id);
  return (
    <div className="pcard">
      <button type="button" className="card" onClick={() => nav.open({ type: 'product', id: product.id })}>
        <b>{f.name}</b>
        <span className="muted">
          {KIND_LABELS[f.kind]}
          {price !== undefined && ` · ${formatEuro(price)}`}
          {f.strength && ` · force ${f.strength}/5`}
          {product.outOfStock && <strong className="alert-text"> · En rupture</strong>}
          {state === 'bientot' && <strong> · Bientôt en vente</strong>}
          {state === 'retire' && <strong> · Retiré</strong>}
        </span>
      </button>
      <label className="compare-check">
        <input type="checkbox" checked={checked} onChange={() => nav.toggleCompare(product.id)} aria-label={`Comparer ${f.name}`} />
        <span aria-hidden="true">Comparer</span>
      </label>
    </div>
  );
}

export function CatalogScreen() {
  const nav = useNav();
  const products = useProducts();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('tout');
  const today = useMemo(() => new Date(), []);
  const all = products ?? [];
  const outCount = all.filter((p) => p.outOfStock).length;

  const list = useMemo(() => {
    if (filter === 'rupture') return searchProducts(all.filter((p) => p.outOfStock), q);
    const kinds = filter === 'tout' ? undefined : [filter];
    if (!q.trim() && filter === 'tout') return null; // → récemment consultés
    return searchProducts(all, q, { kinds });
  }, [all, q, filter]);

  const recent = useMemo(() => {
    const byId = new Map(all.map((p) => [p.id, p]));
    return readRecent().map((id) => byId.get(id)).filter((p): p is Product => !!p);
  }, [all, nav.stack.length]);

  return (
    <div className="catalog">
      <input className="input" id="catalog-search" type="search" placeholder="Nom, marque ou code" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" role="group" aria-label="Familles">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={'chip' + (filter === f.id ? ' on' : '')} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        {outCount > 0 && (
          <button type="button" className={'chip alert' + (filter === 'rupture' ? ' on' : '')} aria-pressed={filter === 'rupture'} onClick={() => setFilter('rupture')}>
            En rupture · {outCount}
          </button>
        )}
      </div>
      <p className="muted count-line">{all.length.toLocaleString('fr-FR')} références</p>
      {list === null ? (
        recent.length ? (
          <>
            <span className="label">Récemment consultés</span>
            {recent.map((p) => <ProductCard key={p.id} product={p} today={today} />)}
          </>
        ) : (
          <div className="catalog-empty">
            <img src={enseigne} alt="" width={102} height={240} />
            <div>
              <p><b>Retrouvez une fiche en un geste.</b></p>
              <p className="muted">Scannez un paquet ou un ticket, ou tapez un nom, une marque, un code. Les fiches ouvertes s'affichent ici.</p>
              <button type="button" className="btn accent" onClick={() => { location.hash = 'scanner'; }}>Ouvrir le scanner</button>
            </div>
          </div>
        )
      ) : (
        <>
          {list.map((p) => <ProductCard key={p.id} product={p} today={today} />)}
          {list.length === 0 && <p className="muted">Aucun produit trouvé.</p>}
          {list.length === 100 && <p className="muted">100 premiers résultats : précisez la recherche.</p>}
        </>
      )}
      {nav.compare.length >= 2 && (
        <div className="compare-bar">
          <button type="button" className="btn ghost" onClick={nav.clearCompare}>Vider</button>
          <button type="button" className="btn accent" onClick={() => nav.open({ type: 'compare', ids: nav.compare })}>
            Comparer ({nav.compare.length})
          </button>
        </div>
      )}
    </div>
  );
}
