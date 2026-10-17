import { useState } from 'react';
import { effectiveFields } from '../../domain/matching';
import { normalizeCode } from '../../domain/barcode';
import { GAME_TYPES, KIND_LABELS, TASTES, type Kind, type Product, type ProductFields } from '../../domain/types';
import { useNav } from '../../nav';
import { actions, newUserProduct, useProducts } from '../../store';
import { Panel } from '../../ui/Panel';

type Draft = {
  name: string; kind: Kind; codes: string; brand: string; format: string; origin: string;
  strength: string; tasteTags: string[]; price: string; ticketPrice: string; maxPrize: string; gameType: string; notes: string;
};

const num = (s: string) => {
  const n = Number(s.replace(',', '.').replace(/\s/g, ''));
  return s.trim() && Number.isFinite(n) ? n : undefined;
};
const txt = (s: string) => s.trim() || undefined;

function toDraft(f: Partial<ProductFields>, code?: string): Draft {
  return {
    name: f.name ?? '', kind: f.kind ?? 'cigarette', codes: code ?? (f.barcodes ?? []).join(' '), brand: f.brand ?? '', format: f.format ?? '',
    origin: f.origin ?? '', strength: f.strength ? String(f.strength) : '', tasteTags: f.tasteTags ?? [],
    price: f.price !== undefined ? String(f.price).replace('.', ',') : '', ticketPrice: f.ticketPrice !== undefined ? String(f.ticketPrice).replace('.', ',') : '',
    maxPrize: f.maxPrize !== undefined ? String(f.maxPrize) : '', gameType: f.gameType ?? '', notes: f.notes ?? '',
  };
}

function toFields(d: Draft): Partial<ProductFields> {
  const game = d.kind === 'jeu-fdj';
  return {
    name: d.name.trim(), kind: d.kind,
    barcodes: d.codes.split(/[\s,;]+/).map(normalizeCode).filter(Boolean),
    brand: game ? undefined : txt(d.brand), format: game ? undefined : txt(d.format), origin: game ? undefined : txt(d.origin),
    strength: game || !d.strength ? undefined : (Number(d.strength) as 1 | 2 | 3 | 4 | 5),
    tasteTags: game || d.tasteTags.length === 0 ? undefined : d.tasteTags,
    price: game ? undefined : num(d.price),
    ticketPrice: game ? num(d.ticketPrice) : undefined, maxPrize: game ? num(d.maxPrize) : undefined,
    gameType: game ? txt(d.gameType) : undefined, notes: txt(d.notes),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function ProductForm({ id, initialCode, initialKind }: { id?: string; initialCode?: string; initialKind?: Kind }) {
  const nav = useNav();
  const products = useProducts();
  const existing: Product | undefined = id ? products?.find((p) => p.id === id) : undefined;
  const [draft, setDraft] = useState<Draft | null>(id ? null : toDraft({ kind: initialKind ?? 'cigarette' }, initialCode));
  // La fiche telle qu'au début de la saisie (R21) : à l'enregistrement, seuls les champs changés depuis sont écrits,
  // une modification faite entre-temps sur un autre téléphone n'est pas défaite.
  const [start, setStart] = useState<Product>();
  if (id && !existing) return null;
  const snap = start ?? existing;
  const d = draft ?? toDraft(effectiveFields(existing!));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    if (!start && existing) setStart(existing);
    setDraft({ ...d, [k]: v });
  };
  const game = d.kind === 'jeu-fdj';
  const base = existing?.base ?? {};
  const isOfficial = (k: keyof ProductFields) => existing !== undefined && base[k] !== undefined;
  const overridden = (k: keyof ProductFields) => isOfficial(k) && existing!.user[k] !== undefined;

  // Le brouillon est remis à jour tout de suite (pas d'attente) : un « Enregistrer » enchaîné voit la valeur officielle.
  const revert = (k: keyof ProductFields) => {
    const p = { ...existing!, user: { ...existing!.user } };
    delete p.user[k];
    const from = snap ?? existing!;
    const fromUser = { ...from.user };
    delete fromUser[k];
    setStart({ ...from, user: fromUser });
    setDraft(toDraft(effectiveFields(p)));
    void actions.clearUserField(existing!.id, k);
  };

  const save = async () => {
    const fields = toFields(d);
    if (!existing) {
      const p = await actions.putProduct(newUserProduct(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))));
      nav.replace({ type: 'product', id: p.id });
      return;
    }
    // On part de la couche user existante (préfixe FDJ appris, nicotine… restent intacts) et on ne
    // réécrit que les champs du formulaire : une valeur égale à l'officielle n'est pas dupliquée.
    const user: Record<string, unknown> = { ...(snap ?? existing).user };
    for (const [k, v] of Object.entries(fields) as [keyof ProductFields, unknown][]) {
      if (k === 'barcodes') {
        const baseCodes = base.barcodes ?? [];
        const extra = (v as string[]).filter((c) => !baseCodes.includes(c));
        if (extra.length) user.barcodes = extra;
        else delete user.barcodes;
        continue;
      }
      if (v === undefined || same(base[k], v)) delete user[k];
      else user[k] = v;
    }
    // On ferme d'abord : l'écriture locale est immédiate et la fiche se met à jour d'elle-même.
    nav.close();
    await actions.putProduct({ ...existing, user }, snap);
  };

  const officialHint = (k: keyof ProductFields) =>
    overridden(k) ? (
      <button type="button" className="btn ghost revert" onClick={() => revert(k)}>
        Revenir à la valeur officielle ({String(Array.isArray(base[k]) ? (base[k] as string[]).join(', ') : base[k])})
      </button>
    ) : null;

  return (
    <Panel title={existing ? 'Modifier la fiche' : 'Nouvelle fiche'} onClose={nav.close}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) void save(); }}>
        <label className="field-label">Nom<input className="input" id="f-name" required value={d.name} onChange={(e) => set('name', e.target.value)} /></label>
        {officialHint('name')}
        <label className="field-label">
          Famille
          <select className="input" id="f-kind" value={d.kind} onChange={(e) => set('kind', e.target.value as Kind)}>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="field-label">
          {existing ? 'Codes-barres' : 'Code-barres'}
          <input className="input" id="f-code" inputMode="numeric" value={d.codes} onChange={(e) => set('codes', e.target.value)} />
        </label>
        {game ? (
          <>
            <label className="field-label">Prix du ticket (€)<input className="input" id="f-ticket" inputMode="decimal" value={d.ticketPrice} onChange={(e) => set('ticketPrice', e.target.value)} /></label>
            <label className="field-label">Gain maximum (€)<input className="input" id="f-maxprize" inputMode="numeric" value={d.maxPrize} onChange={(e) => set('maxPrize', e.target.value)} /></label>
            <label className="field-label">
              Type de jeu
              <select className="input" id="f-gametype" value={d.gameType} onChange={(e) => set('gameType', e.target.value)}>
                <option value="">—</option>
                {GAME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="field-label">Marque<input className="input" id="f-brand" value={d.brand} onChange={(e) => set('brand', e.target.value)} /></label>
            <label className="field-label">Format<input className="input" id="f-format" placeholder="20 unités, 30 g, robusto…" value={d.format} onChange={(e) => set('format', e.target.value)} /></label>
            <label className="field-label">Origine<input className="input" id="f-origin" value={d.origin} onChange={(e) => set('origin', e.target.value)} /></label>
            {officialHint('origin')}
            <label className="field-label">
              Force
              <select className="input" id="f-strength" value={d.strength} onChange={(e) => set('strength', e.target.value)}>
                <option value="">Inconnue</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </select>
            </label>
            {officialHint('strength')}
            <fieldset className="field-label tastes">
              <legend>Goût</legend>
              <div className="chips">
                {TASTES.map((t) => {
                  const on = d.tasteTags.includes(t);
                  return (
                    <button key={t} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on}
                      onClick={() => set('tasteTags', on ? d.tasteTags.filter((x) => x !== t) : [...d.tasteTags, t])}>{t}</button>
                  );
                })}
              </div>
            </fieldset>
            {officialHint('tasteTags')}
            <label className="field-label">Prix (€)<input className="input" id="f-price" inputMode="decimal" value={d.price} onChange={(e) => set('price', e.target.value)} /></label>
            {officialHint('price')}
          </>
        )}
        <label className="field-label">Notes<textarea className="input" id="f-notes" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div className="row">
          <button type="button" className="btn" onClick={nav.close}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!d.name.trim()}>Enregistrer</button>
        </div>
      </form>
    </Panel>
  );
}
