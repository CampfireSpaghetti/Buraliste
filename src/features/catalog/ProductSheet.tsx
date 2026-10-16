import { useState } from 'react';
import { currentPrice, officialState } from '../../domain/catalog';
import { effectiveFields } from '../../domain/matching';
import { formatEuro, formatIsoDateFr } from '../../domain/format';
import { KIND_LABELS } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, useProducts } from '../../store';
import { Panel } from '../../ui/Panel';
import { SubstitutesList } from './SubstitutesList';
import './catalog.css';

export function ProductSheet({ id }: { id: string }) {
  const nav = useNav();
  const products = useProducts();
  const [showSubs, setShowSubs] = useState(false);
  const product = products?.find((p) => p.id === id);
  if (!products) return null;
  if (!product) return <Panel title="Fiche introuvable" onClose={nav.close}><p>Cette fiche n'existe plus.</p></Panel>;
  const f = effectiveFields(product);
  const today = new Date();
  const price = currentPrice(f, today);
  const state = officialState(f, today);
  const game = f.kind === 'jeu-fdj';
  const official = product.source === 'douane';
  const upcoming = official && f.previousPrice !== undefined && price === f.previousPrice && f.price !== undefined && f.effectiveDate;
  const estimated = official && (product.base.strength !== undefined || product.base.tasteTags !== undefined)
    && (product.user.strength === undefined || product.user.tasteTags === undefined);
  const inCompare = nav.compare.includes(id);

  return (
    <Panel title={f.name} onClose={nav.close}>
      <div className="chips">
        <span className="chip">{KIND_LABELS[f.kind]}</span>
        {state === 'bientot' && f.effectiveDate && <span className="pill">En vente au {formatIsoDateFr(f.effectiveDate)}</span>}
        {state === 'retire' && <span className="pill alert">Retiré de la liste officielle</span>}
        {f.isNew && state !== 'retire' && <span className="pill">Nouveau jeu</span>}
      </div>
      <div className="row">
        <button type="button" className={'btn' + (product.outOfStock ? ' stock-out' : '')} aria-pressed={product.outOfStock}
          onClick={() => actions.setOutOfStock(id, !product.outOfStock)}>
          {product.outOfStock ? '● En rupture' : 'En stock'}
        </button>
        {!product.outOfStock && (
          <button type="button" className="btn accent" onClick={() => { setShowSubs(true); setTimeout(() => document.getElementById('substitutes')?.scrollIntoView({ behavior: 'smooth' }), 0); }}>
            Proposer un remplaçant
          </button>
        )}
      </div>
      {(product.outOfStock || showSubs) && <SubstitutesList target={product} all={products} />}
      <dl className="kv">
        {game ? (
          <>
            {f.ticketPrice !== undefined && (<><dt>Prix du ticket</dt><dd><b>{formatEuro(f.ticketPrice)}</b></dd></>)}
            {f.maxPrize !== undefined && (<><dt>Gain maximum</dt><dd>{formatEuro(f.maxPrize)}</dd></>)}
            {f.gameType && (<><dt>Type</dt><dd>{f.gameType}</dd></>)}
          </>
        ) : (
          <>
            {price !== undefined && (
              <>
                <dt>Prix</dt>
                <dd>
                  <b>{formatEuro(price)}</b>
                  {official && f.effectiveDate && !upcoming && <span className="muted"> (officiel, au {formatIsoDateFr(f.effectiveDate)})</span>}
                  {upcoming && <span className="muted"> → {formatEuro(f.price!)} au {formatIsoDateFr(f.effectiveDate!)}</span>}
                </dd>
              </>
            )}
            {f.strength && (<><dt>Force</dt><dd>{'●'.repeat(f.strength)}{'○'.repeat(5 - f.strength)} {f.strength}/5</dd></>)}
            {f.nicotineMg !== undefined && (<><dt>Nicotine</dt><dd>{f.nicotineMg} mg</dd></>)}
            {f.tasteTags?.length ? (<><dt>Goût</dt><dd>{f.tasteTags.join(' · ')}</dd></>) : null}
            {f.origin && (<><dt>Origine</dt><dd>{f.origin}</dd></>)}
            {f.format && (<><dt>Format</dt><dd>{f.format}</dd></>)}
          </>
        )}
        {f.barcodes?.length ? (<><dt>Codes</dt><dd className="num">{f.barcodes.join(', ')}</dd></>) : null}
        {f.notes && (<><dt>Notes</dt><dd>{f.notes}</dd></>)}
      </dl>
      {estimated && <p className="estimate">Force et goût : estimations de départ, modifiables.</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => nav.open({ type: 'edit', id })}>Modifier</button>
        <button type="button" className="btn" aria-pressed={inCompare} onClick={() => nav.toggleCompare(id)}>
          {inCompare ? 'Retirer de la comparaison' : 'Ajouter à la comparaison'}
        </button>
      </div>
    </Panel>
  );
}
