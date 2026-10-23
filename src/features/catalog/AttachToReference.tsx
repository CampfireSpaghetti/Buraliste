import { useMemo, useState } from 'react';
import { attachCodePatch, effectiveFields } from '../../domain/matching';
import { currentPrice } from '../../domain/catalog';
import { searchProducts } from '../../domain/search';
import { formatEuro } from '../../domain/format';
import type { Product } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, currentProduct, useProducts } from '../../store';
import { Panel } from '../../ui/Panel';
import { Segmented } from '../../ui/Segmented';

type Target = 'tabac' | 'jeu';
const TARGET_KEY = 'carotte:attach-target';

/** Dernier choix sur ce téléphone : qui rattache des carnets de jeux en rattache souvent plusieurs d'affilée. */
function readTarget(): Target {
  try {
    return localStorage.getItem(TARGET_KEY) === 'jeu' ? 'jeu' : 'tabac';
  } catch {
    return 'tabac';
  }
}
function rememberTarget(t: Target) {
  try {
    localStorage.setItem(TARGET_KEY, t);
  } catch {
    /* stockage indisponible */
  }
}

const isGame = (p: Product) => effectiveFields(p).kind === 'jeu-fdj';

/**
 * Écran « Code inconnu » : rattacher le code à une fiche existante, produit du tabac (référence officielle
 * recommandée) ou jeu de grattage, sinon créer une fiche.
 */
export function AttachToReference({ code }: { code: string }) {
  const nav = useNav();
  const products = useProducts();
  const [target, setTarget] = useState<Target>(readTarget);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = products ?? [];
  const games = useMemo(() => all.filter(isGame), [all]);
  // Références officielles d'abord ; les fiches créées dans ce tabac viennent après.
  const tobacco = useMemo(() => all.filter((p) => !isGame(p)).sort((a, b) => Number(b.source === 'douane') - Number(a.source === 'douane')), [all]);
  const query = q.trim();
  const results = useMemo(() => {
    if (target === 'jeu') return searchProducts(games, query, { limit: 60 });
    if (query.length < 2) return [];
    const found = searchProducts(tobacco, query, { limit: 40 });
    return [...found.filter((p) => p.source === 'douane'), ...found.filter((p) => p.source !== 'douane')];
  }, [target, games, tobacco, query]);
  const today = new Date();

  const choose = (t: Target) => {
    setTarget(t);
    rememberTarget(t);
    setQ('');
  };

  const attach = async (p: Product) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const current = await currentProduct(p);
      await actions.patchUserFields(p.id, attachCodePatch(current, code, all));
      nav.replace({ type: 'product', id: p.id, notice: `Code ajouté à ${effectiveFields(p).name}. Il sera reconnu au prochain scan.` });
    } catch (e) {
      console.error('Rattachement du code', e);
      setError("Le code n'a pas pu être ajouté. Réessayez.");
      setBusy(false);
    }
  };

  return (
    <Panel title="Code inconnu" onClose={nav.close}>
      <div className="unknown-code">
        <span className="muted">Code lu</span>
        <span className="num unknown-code-value">{code}</span>
      </div>
      <h3 className="attach-question">À quoi correspond ce code ?</h3>
      <Segmented
        label="Type de fiche"
        value={target}
        onChange={choose}
        options={[
          { id: 'tabac', label: 'Produit du tabac' },
          { id: 'jeu', label: 'Jeu de grattage' },
        ]}
      />
      <p className="muted attach-help">
        {target === 'tabac'
          ? 'Choisissez de préférence une référence officielle : nom et prix mis à jour chaque semaine.'
          : 'Carnet, boîte ou ticket : le code rejoint la fiche du jeu, et ce jeu sera reconnu au prochain scan.'}
      </p>
      <input
        className="input"
        id="attach-search"
        type="search"
        placeholder={target === 'tabac' ? 'Rechercher une référence' : 'Rechercher un jeu'}
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <p className="alert-text" role="alert">{error}</p>}
      <div className="attach-results" aria-busy={busy}>
        {results.map((p) => {
          const f = effectiveFields(p);
          const price = f.kind === 'jeu-fdj' ? f.ticketPrice : currentPrice(f, today);
          return (
            <button key={p.id} type="button" className="card attach-card" disabled={busy} onClick={() => void attach(p)}>
              <b>{f.name}</b>
              <span className="muted">
                {[price !== undefined ? formatEuro(price) : '', p.source === 'douane' ? 'référence officielle' : !isGame(p) ? 'fiche du tabac' : '']
                  .filter(Boolean).join(' · ')}
              </span>
            </button>
          );
        })}
        {target === 'tabac' && query.length < 2 && <p className="muted">Tapez au moins deux lettres : la marque suffit souvent.</p>}
        {target === 'tabac' && query.length >= 2 && results.length === 0 && <p className="muted">Aucune référence trouvée. Essayez la marque seule.</p>}
        {target === 'jeu' && games.length === 0 && <p className="muted">Aucun jeu dans le catalogue pour l'instant.</p>}
        {target === 'jeu' && games.length > 0 && results.length === 0 && <p className="muted">Aucun jeu trouvé.</p>}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => nav.replace(target === 'jeu' ? { type: 'create', code, kind: 'jeu-fdj' } : { type: 'create', code })}
      >
        {target === 'jeu' ? '+ Nouveau jeu' : 'Créer une fiche à la main'}
      </button>
    </Panel>
  );
}
