import { currentPrice } from '../../domain/catalog';
import { effectiveFields } from '../../domain/matching';
import { formatEuro } from '../../domain/format';
import type { ProductFields } from '../../domain/types';
import { useNav } from '../../nav';
import { useProducts } from '../../store';
import { Panel } from '../../ui/Panel';
import './catalog.css';

type Row = { label: string; value: (f: ProductFields, today: Date) => string };

const TOBACCO_ROWS: Row[] = [
  { label: 'Force', value: (f) => (f.strength ? `${f.strength}/5` : '—') },
  { label: 'Goût', value: (f) => f.tasteTags?.join(', ') || '—' },
  { label: 'Origine', value: (f) => f.origin ?? '—' },
  { label: 'Format', value: (f) => f.format ?? '—' },
  { label: 'Prix', value: (f, t) => { const p = currentPrice(f, t); return p !== undefined ? formatEuro(p) : '—'; } },
  { label: 'Marque', value: (f) => f.brand ?? '—' },
];
const GAME_ROWS: Row[] = [
  { label: 'Prix du ticket', value: (f) => (f.ticketPrice !== undefined ? formatEuro(f.ticketPrice) : '—') },
  { label: 'Gain maximum', value: (f) => (f.maxPrize !== undefined ? formatEuro(f.maxPrize) : '—') },
  { label: 'Type', value: (f) => f.gameType ?? '—' },
];

export function CompareView({ ids }: { ids: string[] }) {
  const nav = useNav();
  const products = useProducts();
  if (!products) return null;
  const fields = ids.map((id) => products.find((p) => p.id === id)).filter((p) => !!p).map((p) => effectiveFields(p!));
  const today = new Date();
  const rows = fields.every((f) => f.kind === 'jeu-fdj') ? GAME_ROWS : TOBACCO_ROWS;
  return (
    <Panel title={`Comparer · ${fields.length} produits`} onClose={nav.close}>
      <div className="table-scroll">
        <table className="compare-table" aria-label="Comparaison">
          <thead>
            <tr><th />{fields.map((f, i) => <th key={i} scope="col">{f.name}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const values = fields.map((f) => r.value(f, today));
              // Une valeur est surlignée quand elle diffère de la majorité (ou de l'autre, à deux).
              const counts = new Map<string, number>();
              values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
              const top = Math.max(...counts.values());
              const allDiffer = counts.size > 1 && top === 1;
              return (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {values.map((v, i) => (
                    <td key={i} className={counts.size > 1 && (allDiffer || counts.get(v)! < top) ? 'diff' : undefined}>{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">Les différences sont surlignées.</p>
    </Panel>
  );
}
