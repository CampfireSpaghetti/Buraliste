import { useCallback, useEffect, useMemo, useState } from 'react';
import { missingGameLines, sortLines } from '../../domain/count';
import { effectiveFields, learnFdjCode, resolveScan, type ScanResult } from '../../domain/matching';
import { fold } from '../../domain/search';
import { formatEuro } from '../../domain/format';
import { normalizeCode } from '../../domain/barcode';
import type { CountLine, Product } from '../../domain/types';
import { addCountLines, newId } from '../../data/db';
import { actions, newUserProduct, notifyDataChanged, useCountLines, useProducts, useSettings } from '../../store';
import { Sheet } from '../../ui/Panel';
import { Toast } from '../../ui/Toast';
import { ScannerView } from '../scanner/ScannerView';
import { CountTable, type QtyField } from './CountTable';
import { NumericKeypad } from './NumericKeypad';
import { WhichGameDialog } from './WhichGameDialog';
import { ExportPanel } from './ExportPanel';
import { BackupReminder } from './BackupReminder';
import './count.css';

/** Saisie au pavé d'une quantité. `chain` : après le linéaire, le pavé enchaîne sur le stock (mode scan). */
type KeypadTarget = {
  field: QtyField; chain: boolean; snapshot?: CountLine;
  lineId?: string; gameId?: string; code: string; name: string; price?: number; initial: number;
};
const FIELD_LABEL: Record<QtyField, string> = { linearQty: 'Linéaire', stockQty: 'Stock' };
type LineForm = { mode: 'new' } | { mode: 'edit'; line: CountLine };
type ToastState = { message: string; undo?: CountLine };

export function CountScreen() {
  const products = useProducts();
  const rawLines = useCountLines();
  const settings = useSettings();
  const [scanning, setScanning] = useState(false);
  const [keypad, setKeypad] = useState<KeypadTarget | null>(null);
  const [lineForm, setLineForm] = useState<LineForm | null>(null);
  const [ask, setAsk] = useState<{ code: string; candidates: Product[] } | null>(null);
  const [newGame, setNewGame] = useState<{ code: string } | null>(null);
  const [hitId, setHitId] = useState<string>();
  const [last, setLast] = useState<{ name: string; linear: number; stock: number } | null>(null);
  const [counted, setCounted] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [exporting, setExporting] = useState(false);

  const sortBy = settings?.sortCount ?? 'name';
  const lines = useMemo(() => sortLines(rawLines ?? [], sortBy), [rawLines, sortBy]);
  const games = useMemo(() => (products ?? []).filter((p) => effectiveFields(p).kind === 'jeu-fdj'), [products]);
  const hidden = useMemo(() => settings?.hiddenGames ?? [], [settings]);

  // Tous les jeux de grattage du catalogue sont listés (à 0 / 0 tant qu'ils ne sont pas comptés).
  useEffect(() => {
    if (!products || !rawLines || !settings) return;
    const missing = missingGameLines(products, rawLines, hidden);
    if (missing.length) void addCountLines(missing).then(notifyDataChanged);
  }, [products, rawLines, settings, hidden]);

  /** Colonne Code : le code qui identifie le jeu (préfixe appris, sinon premier code connu, sinon le code scanné). */
  const openForGame = (game: Product, scanned: string) => {
    const f = effectiveFields(game);
    const code = f.fdjPrefix ?? f.barcodes?.[0] ?? scanned;
    const existing = (rawLines ?? []).find((l) => l.gameId === game.id);
    if (existing) setHitId(existing.id);
    setKeypad({
      field: 'linearQty', chain: true, snapshot: existing, lineId: existing?.id, gameId: game.id,
      code: existing?.code ?? code, name: existing?.name ?? f.name, price: f.ticketPrice, initial: existing?.linearQty ?? 0,
    });
  };

  const onScan = (r: ScanResult) => {
    if (r.type === 'product') {
      const f = effectiveFields(r.product);
      if (f.kind !== 'jeu-fdj') setToast({ message: `Ce n'est pas un jeu de grattage : ${f.name}` });
      else openForGame(r.product, '');
    } else if (r.type === 'ask-game') setAsk({ code: r.code, candidates: r.candidates });
    else setNewGame({ code: r.code });
  };

  // Chaque validation est enregistrée tout de suite : rien n'est perdu si un client interrompt le comptage.
  const validate = async (n: number) => {
    const k = keypad!;
    const existing = k.snapshot ?? (k.lineId ? (rawLines ?? []).find((l) => l.id === k.lineId) : undefined);
    const line: CountLine = {
      ...(existing ?? { id: newId(), gameId: k.gameId, code: k.code, name: k.name, linearQty: 0, stockQty: 0, updatedAt: 0 }),
      [k.field]: n,
    };
    const next = k.chain && k.field === 'linearQty';
    // Le pavé du stock remplace directement celui du linéaire : la caméra reste en pause entre les deux.
    setKeypad(next ? { ...k, field: 'stockQty', chain: false, snapshot: line, lineId: line.id, initial: line.stockQty } : null);
    const saved = await actions.upsertCountLine(line);
    setHitId(line.id);
    setTimeout(() => setHitId((h) => (h === line.id ? undefined : h)), 1500);
    if (scanning) {
      setLast({ name: saved.name, linear: saved.linearQty, stock: saved.stockQty });
      setCounted((c) => new Set(c).add(saved.id));
    }
  };

  const remove = async (line: CountLine) => {
    setLineForm(null);
    // Un jeu du catalogue enlevé de la liste n'y revient pas tout seul (marqué avant la suppression,
    // sinon la liste complète le recréerait aussitôt).
    if (line.gameId) await actions.saveSettings({ hiddenGames: [...new Set([...hidden, line.gameId])] });
    const removed = await actions.deleteCountLine(line.id);
    setToast({ message: 'Ligne supprimée', undo: removed });
  };

  const closeToast = useCallback(() => setToast(null), []);
  const paused = !!(keypad || ask || newGame || lineForm);

  const table = (
    <CountTable
      lines={lines}
      hitId={hitId}
      onQuantity={(l, field) => setKeypad({ field, chain: field === 'linearQty', snapshot: l, lineId: l.id, gameId: l.gameId, code: l.code, name: l.name, initial: l[field] })}
      onEdit={(l) => setLineForm({ mode: 'edit', line: l })}
      onDelete={remove}
    />
  );

  return (
    <div className="count">
      {scanning ? (
        <div className="scan-mode">
          <ScannerView
            mode="count"
            onResult={onScan}
            paused={paused}
            footer={
              <div className="last-card">
                <span>{last ? <><b>Dernier : {last.name} → {last.linear} · {last.stock}</b> · {counted.size} {counted.size > 1 ? 'jeux comptés' : 'jeu compté'}</> : 'Scannez un ticket du premier jeu.'}</span>
                <button type="button" className="btn primary" onClick={() => { setScanning(false); setLast(null); setCounted(new Set()); }}>Terminer</button>
              </div>
            }
          />
          {table}
        </div>
      ) : (
        <>
          {settings && <BackupReminder settings={settings} hasData={(rawLines ?? []).some((l) => l.updatedAt > 0)} />}
          <div className="count-actions">
            <button type="button" className="btn accent" onClick={() => setScanning(true)}>Scanner</button>
            <button type="button" className="btn" onClick={() => setLineForm({ mode: 'new' })}>+ Ligne</button>
            <button type="button" className="btn primary" disabled={lines.length === 0} onClick={() => setExporting(true)}>Export .jpg</button>
          </div>
          <div className="sortbar chips" role="group" aria-label="Trier">
            <span className="label">Trier :</span>
            <button type="button" className={'chip' + (sortBy === 'name' ? ' on' : '')} aria-pressed={sortBy === 'name'} onClick={() => actions.saveSettings({ sortCount: 'name' })}>Nom</button>
            <button type="button" className={'chip' + (sortBy === 'updatedAt' ? ' on' : '')} aria-pressed={sortBy === 'updatedAt'} onClick={() => actions.saveSettings({ sortCount: 'updatedAt' })}>Date</button>
          </div>
          {table}
        </>
      )}

      {keypad && (
        <Sheet label={`Quantité ${keypad.field === 'linearQty' ? 'linéaire' : 'stock'} — ${keypad.name}`} onClose={() => setKeypad(null)}>
          <NumericKeypad
            key={keypad.field}
            title={`${keypad.name} · ${FIELD_LABEL[keypad.field]}`}
            subtitle={`${keypad.price !== undefined ? formatEuro(keypad.price) + ' · ' : ''}avant : ${keypad.initial}`}
            initial={keypad.initial}
            onCancel={() => setKeypad(null)}
            onValidate={validate}
            hint={keypad.chain ? 'Valider, puis la quantité en stock' : scanning ? 'Valider relance la caméra' : undefined}
          />
        </Sheet>
      )}
      {lineForm && (
        <LineFormSheet
          form={lineForm}
          games={games}
          lines={rawLines ?? []}
          hiddenGames={hidden}
          onMerged={(l) => setToast({ message: `Ligne existante mise à jour : ${l.name}` })}
          products={products ?? []}
          onClose={() => setLineForm(null)}
          onDelete={remove}
        />
      )}
      {ask && (
        <WhichGameDialog
          code={ask.code}
          candidates={ask.candidates}
          games={games}
          onClose={() => setAsk(null)}
          onNewGame={() => { setNewGame({ code: ask.code }); setAsk(null); }}
          onPick={async (g) => {
            const code = ask.code;
            setAsk(null);
            const updated = await actions.patchUserFields(g.id, learnFdjCode(g, code, products ?? []));
            openForGame(updated, code);
          }}
        />
      )}
      {newGame && (
        <NewGameSheet
          code={newGame.code}
          onClose={() => setNewGame(null)}
          onCreated={(g) => { setNewGame(null); openForGame(g, newGame.code); }}
        />
      )}
      {exporting && settings && <ExportPanel lines={lines} settings={settings} onClose={() => setExporting(false)} />}
      {toast && (
        <Toast
          message={toast.message}
          action={toast.undo ? 'Annuler' : undefined}
          onAction={() => {
            const undo = toast.undo;
            if (undo) {
              void actions.restoreCountLine(undo);
              if (undo.gameId) void actions.saveSettings({ hiddenGames: hidden.filter((g) => g !== undo.gameId) });
            }
            setToast(null);
          }}
          onDone={closeToast}
        />
      )}
    </div>
  );
}

function LineFormSheet({ form, games, lines, hiddenGames, products, onClose, onDelete, onMerged }: { form: LineForm; games: Product[]; lines: CountLine[]; hiddenGames: string[]; products: Product[]; onClose: () => void; onDelete: (l: CountLine) => void; onMerged: (l: CountLine) => void }) {
  const editing = form.mode === 'edit' ? form.line : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [linear, setLinear] = useState(editing ? String(editing.linearQty) : '');
  const [stock, setStock] = useState(editing ? String(editing.stockQty) : '');
  const linearQty = Number(linear || 0);
  const stockQty = Number(stock || 0);
  const valid = name.trim() !== '' && (linear !== '' || stock !== '');

  const submit = async () => {
    if (!valid) return;
    const c = normalizeCode(code);
    if (editing) {
      await actions.upsertCountLine({ ...editing, name: name.trim(), code: c, linearQty, stockQty });
    } else {
      // Rattache la ligne à un jeu connu (même nom, ou code reconnu) pour que les scans la retrouvent.
      const byName = games.find((g) => fold(effectiveFields(g).name) === fold(name.trim()));
      const byCode = c ? resolveScan(c, products) : undefined;
      const gameId = byName?.id ?? (byCode?.type === 'product' && effectiveFields(byCode.product).kind === 'jeu-fdj' ? byCode.product.id : undefined);
      // Un jeu déjà dans la liste n'a qu'une ligne : on la met à jour au lieu d'en créer une seconde (total juste).
      const same = lines.find((l) => (gameId && l.gameId === gameId) || fold(l.name) === fold(name.trim()));
      if (gameId) await actions.saveSettings({ hiddenGames: hiddenGames.filter((g) => g !== gameId) });
      if (same) {
        const updated = await actions.upsertCountLine({ ...same, linearQty, stockQty, code: same.code || c });
        onMerged(updated);
      } else {
        await actions.upsertCountLine({ id: newId(), gameId, code: c, name: name.trim(), linearQty, stockQty, updatedAt: 0 });
      }
    }
    onClose();
  };

  return (
    <Sheet label={editing ? 'Modifier la ligne' : 'Nouvelle ligne'} onClose={onClose}>
      <form className="line-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h3 style={{ fontSize: 19 }}>{editing ? 'Modifier la ligne' : 'Nouvelle ligne'}</h3>
        <label className="field-label">Nom du jeu<input className="input" id="line-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!editing} /></label>
        <label className="field-label">{editing ? 'Code-barres' : 'Code-barres (facultatif)'}<input className="input" id="line-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <div className="row">
          <label className="field-label">Quantité linéaire<input className="input num" id="line-linear" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={linear} onChange={(e) => setLinear(e.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
          <label className="field-label">Quantité stock<input className="input num" id="line-stock" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
        </div>
        <div className="row">
          {editing && <button type="button" className="btn danger" onClick={() => onDelete(editing)}>Supprimer</button>}
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!valid}>{editing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Sheet>
  );
}

function NewGameSheet({ code, onClose, onCreated }: { code: string; onClose: () => void; onCreated: (g: Product) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const submit = async () => {
    const ticketPrice = Number(price.replace(',', '.'));
    const g = await actions.putProduct(
      newUserProduct({ kind: 'jeu-fdj', name: name.trim(), barcodes: [normalizeCode(code)], ...(price && Number.isFinite(ticketPrice) ? { ticketPrice } : {}) }),
    );
    onCreated(g);
  };
  return (
    <Sheet label="Nouveau jeu" onClose={onClose}>
      <form className="line-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void submit(); }}>
        <h3 style={{ fontSize: 19 }}>Nouveau jeu</h3>
        <p className="muted" style={{ margin: 0 }}>Code <span className="num">{code}</span></p>
        <label className="field-label">Nom du jeu<input className="input" id="newgame-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="field-label">Prix du ticket (€)<input className="input" id="newgame-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!name.trim()}>Continuer</button>
        </div>
      </form>
    </Sheet>
  );
}
