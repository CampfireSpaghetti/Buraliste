import { useLots } from '../../data/lotsData';
import { formatIsoDateFr } from '../../domain/format';
import { formatChance, formatCount, formatGain, formatTrj, type LotsEntry } from '../../domain/lots';

/** Section « Lots » de la fiche d'un jeu : chance, taux de retour, gain maximal et tableau des lots, avec la source. */
export function LotsTable({ entry }: { entry: LotsEntry }) {
  const lots = [...entry.lots].sort((a, b) => b.montant - a.montant);
  const gainMax = lots.length ? Math.max(entry.gainMax ?? 0, lots[0].montant) : entry.gainMax;
  return (
    <section className="lots" aria-label="Lots">
      <h3>Lots</h3>
      <ul className="lots-facts">
        {entry.chance !== undefined && <li><b>1 chance sur {formatChance(entry.chance)}</b> de gagner</li>}
        {entry.trj !== undefined && <li>Taux de retour aux joueurs : {formatTrj(entry.trj)}</li>}
        <li>Gain maximal : <b>{formatGain(gainMax)}</b></li>
      </ul>
      <div className="table-scroll">
        <table className="lots-table">
          {entry.bloc !== undefined && <caption>Nombre de lots pour {formatCount(entry.bloc)} tickets</caption>}
          <thead>
            <tr><th scope="col">Montant</th><th scope="col">Nombre de lots</th></tr>
          </thead>
          <tbody>
            {lots.map((l, i) => (
              <tr key={i}>
                <td>{formatGain(l.montant)}</td>
                <td className="num">{formatCount(l.nombre)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        D'après le règlement FDJ du jeu{/^\d{4}-\d{2}-\d{2}$/.test(String(entry.majLe)) && ` · mis à jour le ${formatIsoDateFr(entry.majLe)}`}
      </p>
    </section>
  );
}

/** Lots du jeu `fdjRef`, chargés à l'ouverture de la fiche ; rien si le jeu n'a pas de tableau connu. */
export function LotsSection({ fdjRef }: { fdjRef?: string }) {
  const entry = useLots(fdjRef);
  return entry ? <LotsTable entry={entry} /> : null;
}
