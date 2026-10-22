import { useCallback, useState } from 'react';
import { currentPrice, officialState } from '../../domain/catalog';
import { codeRows, effectiveFields } from '../../domain/matching';
import { Toast } from '../../ui/Toast';
import { formatEuro, formatIsoDateFr } from '../../domain/format';
import { KIND_LABELS } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, useProducts } from '../../store';
import { Panel } from '../../ui/Panel';
import { SubstitutesList } from './SubstitutesList';
import { LotsSection } from './LotsTable';
import { CompositionSection } from './CompositionSection';
import { rangeProfile } from '../../domain/rangeProfile';
import type { Product } from '../../domain/types';
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
            {(f.kind === 'cigarette' || f.kind === 'tabac-rouler') && (() => {
              const r = rangeProfile(f);
              const goût = r.color ? `${r.color}${r.rank ? ` (${['', 'très léger', 'léger', 'équilibré', 'corsé'][r.rank]})` : ''}` : 'non précisé';
              const format = [r.count && `${r.count} cigarettes`, r.weight && `${r.weight} g`, r.length === 'long' && 'longues (100s)', r.length === 'slim' && 'slim', r.pack && `paquet ${r.pack}`].filter(Boolean).join(', ');
              return (<><dt>Gamme</dt><dd>{r.brand} · {goût}{r.type === 'brun' ? ' · tabac brun' : ''}{format ? ` · ${format}` : ''}</dd></>);
            })()}
            {f.strength && (<><dt>Force</dt><dd>{'●'.repeat(f.strength)}{'○'.repeat(5 - f.strength)} {f.strength}/5</dd></>)}
            {f.nicotineMg !== undefined && (<><dt>Nicotine</dt><dd>{f.nicotineMg} mg</dd></>)}
            {f.tasteTags?.length ? (<><dt>Goût</dt><dd>{f.tasteTags.join(' · ')}</dd></>) : null}
            {f.origin && (<><dt>Origine</dt><dd>{f.origin}</dd></>)}
            {f.format && (<><dt>Format</dt><dd>{f.format}</dd></>)}
          </>
        )}
        {f.notes && (<><dt>Notes</dt><dd>{f.notes}</dd></>)}
      </dl>
      {game && <LotsSection fdjRef={product.fdjRef} />}
      {!game && product.douaneRef && <CompositionSection douaneRef={product.douaneRef} />}
      <CodesSection id={id} product={product} />
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

const ORIGIN: Record<string, string> = { officiel: 'officiel', partagé: 'liste commune', 'ajouté ici': 'ajouté ici' };

/** Codes-barres de la fiche : officiels et partagés (lecture seule), ajoutés ici (avec « Retirer »), et « Ajouter un code ». */
function CodesSection({ id, product }: { id: string; product: Product }) {
  const nav = useNav();
  const [notice, setNotice] = useState<string | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const rows = codeRows(product);
  const remove = async (code: string) => {
    const after = await actions.removeUserCode(id, code);
    // Retiré, mais encore reconnu par un préfixe (plus court) de la fiche : on le dit.
    const still = (effectiveFields(after).fdjPrefixes ?? []).find((k) => k !== code && code.startsWith(k));
    if (still) setNotice(`Ce ticket reste reconnu par « Tickets ${still}… ».`);
  };
  const catalog = product.base.fdjCodes ?? [];
  return (
    <section className="codes" aria-label="Codes-barres">
      <h3>Codes-barres</h3>
      {rows.length === 0 && <p className="muted">Aucun code pour l'instant.</p>}
      {rows.length > 0 && (
        <ul className="code-list">
          {rows.map((r) => (
            <li key={r.type + r.code} className="code-row">
              <span>
                <span className="num">{r.type === 'prefix' ? `Tickets ${r.code}…` : r.code}</span>
                <span className="muted"> · {ORIGIN[r.origin]}</span>
              </span>
              {r.removable && (
                <button type="button" className="btn" aria-label={`Retirer ${r.code}`} onClick={() => void remove(r.code)}>Retirer</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {catalog.length > 0 && (
        <p className="muted">Numéros FDJ en vente : <span className="num">{catalog.join(', ')}</span> (demandé au premier ticket scanné).</p>
      )}
      {rows.some((r) => r.removable) && (
        <p className="muted">« Retirer » l'enlève sur les téléphones de ce tabac. Si ce code a déjà été envoyé à la liste commune, il y reste : prévenez l'administrateur.</p>
      )}
      <button type="button" className="btn" onClick={() => nav.open({ type: 'add-code', id })}>Ajouter un code</button>
      {notice && <Toast message={notice} onDone={closeNotice} />}
    </section>
  );
}
