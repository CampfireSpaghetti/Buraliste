import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { CompositionSection } from '../../src/features/catalog/CompositionSection';
import { loadComposition, resetCompositionCache } from '../../src/data/compositionData';
import { emissionsLine, monthYearFr } from '../../src/domain/composition';
import type { CompositionFile } from '../../src/domain/composition';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetCompositionCache();
});

const plain = (s: string | null) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');

const file: CompositionFile = {
  version: '2026-07-01-abcdef12', fetchedAt: '2026-10-22', date: '2026-07-01', source: 'https://www.data.gouv.fr/x',
  produits: {
    'pmi|marlboro red, en 20 unités': {
      nicotine: 0.8, goudron: 10, co: 10, ean: [],
      ingredients: [
        { nom: 'Tabac (type: virginie)', fonction: 'Tabac', brule: true },
        { nom: 'Cellulose acetate', fonction: 'Matériau de filtration', brule: false },
        { nom: 'Autres additifs', fonction: 'Divers' },
      ],
    },
    'seita|drum bleu (blague), en 30 g': { ingredients: [{ nom: 'Glycerol', fonction: 'Humectant', brule: true }], ean: [] },
  },
};

function stubFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body }) as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('composition (domaine)', () => {
  it('mois et année de la déclaration ; ligne des émissions', () => {
    expect(monthYearFr('2026-07-01')).toBe('juillet 2026');
    expect(monthYearFr('n/a')).toBe('');
    expect(plain(emissionsLine({ nicotine: 0.8, goudron: 10, co: 10 }))).toBe('Nicotine 0,8 mg · Goudron 10 mg · Monoxyde de carbone 10 mg');
    expect(emissionsLine({})).toBe('');
  });
});

describe('CompositionSection (fiche tabac)', () => {
  it('émissions par cigarette, ingrédients repliés avec fonction et « brûlé », source et date', async () => {
    stubFetch(file);
    render(<CompositionSection douaneRef="pmi|marlboro red, en 20 unités" />);
    const section = await screen.findByRole('region', { name: 'Composition' });
    const text = plain(section.textContent);
    expect(text).toContain('Composition (déclaration ANSES)');
    expect(text).toContain('Nicotine 0,8 mg · Goudron 10 mg · Monoxyde de carbone 10 mg (par cigarette)');
    const details = section.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(plain(within(section).getByText(/Ingrédients déclarés/).textContent)).toBe('Ingrédients déclarés (3)');
    const items = within(details).getAllByRole('listitem').map((li) => plain(li.textContent));
    expect(items).toEqual([
      'Tabac (type: virginie) · Tabac · brûlé',
      'Cellulose acetate · Matériau de filtration · non brûlé',
      'Autres additifs · Divers',
    ]);
    expect(text).toContain("Déclaration du fabricant à l'ANSES, juillet 2026");
  });

  it('liste limitée : « (60 premiers sur N) »', async () => {
    const ingredients = Array.from({ length: 60 }, (_, i) => ({ nom: `Ingrédient ${i}`, fonction: 'Humectant', brule: true }));
    stubFetch({ ...file, produits: { 'fab|long': { ingredients, ingredientsTotal: 72, ean: [] } } });
    render(<CompositionSection douaneRef="fab|long" />);
    const section = await screen.findByRole('region', { name: 'Composition' });
    expect(plain(within(section).getByText(/Ingrédients déclarés/).textContent)).toBe('Ingrédients déclarés (60 premiers sur 72)');
  });

  it('tabac à rouler : ingrédients seulement (pas de ligne d’émissions)', async () => {
    stubFetch(file);
    render(<CompositionSection douaneRef="seita|drum bleu (blague), en 30 g" />);
    const section = await screen.findByRole('region', { name: 'Composition' });
    expect(section.textContent).not.toContain('par cigarette');
    expect(plain(section.textContent)).toContain('Ingrédients déclarés (1)');
  });

  it('produit non rapproché, fichier absent ou illisible : rien', async () => {
    const fetchFn = stubFetch(file);
    const { container } = render(<CompositionSection douaneRef="fab|inconnu" />);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
    cleanup();
    resetCompositionCache();
    stubFetch(null, false);
    const r2 = render(<CompositionSection douaneRef="pmi|marlboro red, en 20 unités" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(r2.container.innerHTML).toBe('');
  });

  it('chargé une seule fois (cache en mémoire), nouvel essai après un échec', async () => {
    const fail = vi.fn(async () => { throw new Error('hors ligne'); });
    expect(await loadComposition(fail as unknown as typeof fetch)).toBeNull();
    const ok = vi.fn(async () => ({ ok: true, status: 200, json: async () => file }) as Response);
    expect(await loadComposition(ok as unknown as typeof fetch)).toBe(file);
    expect(await loadComposition(ok as unknown as typeof fetch)).toBe(file);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
