import { useComposition } from '../../data/compositionData';
import { emissionsLine, monthYearFr, type CompositionEntry } from '../../domain/composition';

/** Section « Composition (déclaration ANSES) » : émissions par cigarette, ingrédients repliés, source et date. */
export function CompositionView({ entry, date }: { entry: CompositionEntry; date: string }) {
  const emissions = emissionsLine(entry);
  const ingredients = Array.isArray(entry.ingredients) ? entry.ingredients.filter((i) => i && typeof i.nom === 'string') : [];
  if (!emissions && !ingredients.length) return null;
  const when = monthYearFr(date);
  const total = typeof entry.ingredientsTotal === 'number' && entry.ingredientsTotal > ingredients.length ? entry.ingredientsTotal : undefined;
  return (
    <section className="composition" aria-label="Composition">
      <h3>Composition (déclaration ANSES)</h3>
      {emissions && <p>{emissions} <span className="muted">(par cigarette)</span></p>}
      {ingredients.length > 0 && (
        <details>
          <summary>Ingrédients déclarés ({total ? `${ingredients.length} premiers sur ${total}` : ingredients.length})</summary>
          <ul className="ingredients">
            {ingredients.map((i, k) => (
              <li key={k}>
                {i.nom}
                {i.fonction && <span className="muted"> · {i.fonction}</span>}
                {i.brule === true && <span className="muted"> · brûlé</span>}
                {i.brule === false && <span className="muted"> · non brûlé</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted">Déclaration du fabricant à l'ANSES{when && `, ${when}`}</p>
    </section>
  );
}

/** Composition de la référence Douane, chargée à l'ouverture de la fiche ; rien si le produit n'est pas rapproché. */
export function CompositionSection({ douaneRef }: { douaneRef?: string }) {
  const found = useComposition(douaneRef);
  return found ? <CompositionView entry={found.entry} date={found.date} /> : null;
}
