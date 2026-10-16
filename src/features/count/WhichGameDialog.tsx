import { useMemo, useState } from 'react';
import { effectiveFields } from '../../domain/matching';
import { searchProducts } from '../../domain/search';
import type { Product } from '../../domain/types';
import { Sheet } from '../../ui/Panel';
import { formatEuro } from '../../domain/format';

type Props = {
  code: string;
  candidates: Product[];
  games: Product[];
  onPick: (game: Product) => void;
  onNewGame: () => void;
  onClose: () => void;
};

export function WhichGameDialog({ code, candidates, games, onPick, onNewGame, onClose }: Props) {
  const [q, setQ] = useState('');
  const list = useMemo(() => (q.trim() ? searchProducts(games, q, { kinds: ['jeu-fdj'], limit: 30 }) : candidates.slice(0, 5)), [q, games, candidates]);
  return (
    <Sheet label="C'est quel jeu ?" onClose={onClose}>
      <h3 style={{ fontSize: 20 }}>C'est quel jeu ?</h3>
      <p className="muted" style={{ margin: 0 }}>
        Code <span className="num">{code}</span> — l'app retiendra votre réponse.
      </p>
      <input className="input" id="which-game-search" placeholder="Rechercher un jeu" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.map((g) => {
        const f = effectiveFields(g);
        return (
          <button key={g.id} type="button" className="card" onClick={() => onPick(g)}>
            <b>{f.name}</b>
            {f.ticketPrice !== undefined && <span className="muted">{formatEuro(f.ticketPrice)}</span>}
          </button>
        );
      })}
      <button type="button" className="btn" onClick={onNewGame}>+ Nouveau jeu</button>
    </Sheet>
  );
}
