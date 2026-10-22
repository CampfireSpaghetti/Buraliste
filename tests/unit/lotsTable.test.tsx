import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { LotsSection, LotsTable } from '../../src/features/catalog/LotsTable';
import { cleanLotsEntry, loadLots, resetLotsCache } from '../../src/data/lotsData';
import type { LotsEntry, LotsFile } from '../../src/domain/lots';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetLotsCache();
});

/** Les nombres français utilisent des espaces insécables : comparés ici avec des espaces simples. */
const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');

const cash: LotsEntry = {
  prix: 5, chance: 3.82, trj: 70, gainMax: 500000, bloc: 24000000, source: 'https://www.fdj.fr/jeux-illiko/cash', majLe: '2026-10-22',
  // Volontairement dans le désordre : l'affichage trie du plus gros au plus petit.
  lots: [{ montant: 5, nombre: 2439968 }, { montant: 500000, nombre: 4 }, { montant: 100, nombre: 178000 }, { montant: 10000, nombre: 5 }],
};

describe('LotsTable (fiche d’un jeu)', () => {
  it('chance, taux de retour, gain maximal, bloc, tableau Montant | Nombre de lots trié, source et date', () => {
    render(<LotsTable entry={cash} />);
    const section = screen.getByRole('region', { name: 'Lots' });
    const text = plain(section.textContent);
    expect(text).toContain('1 chance sur 3,82 de gagner');
    expect(text).toContain('Taux de retour aux joueurs : 70 %');
    expect(text).toContain('Gain maximal : 500 000 €');
    expect(text).toContain('pour 24 000 000 tickets');
    expect(text).toContain("D'après le règlement FDJ du jeu · mis à jour le 22 octobre 2026");
    const table = within(section).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Montant', 'Nombre de lots']);
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => plain(c.textContent)));
    expect(rows).toEqual([['500 000 €', '4'], ['10 000 €', '5'], ['100 €', '178 000'], ['5 €', '2 439 968']]);
  });

  it('TRJ décimal, montant en centimes ; sans bloc ni chance connus : ni « pour … tickets » ni ligne de chance', () => {
    render(<LotsTable entry={{ ...cash, chance: undefined, bloc: undefined, trj: 68.5, gainMax: 3000, lots: [{ montant: 3000, nombre: 2 }, { montant: 0.5, nombre: 280600 }] }} />);
    const text = plain(screen.getByRole('region', { name: 'Lots' }).textContent);
    expect(text).toContain('Taux de retour aux joueurs : 68,5 %');
    expect(text).toContain('0,50 €');
    expect(text).not.toContain('tickets');
    expect(text).not.toContain('chance sur');
  });
});

describe('LotsSection (chargement à la demande de fdj-lots.json)', () => {
  const file: LotsFile = { version: 'v1', fetchedAt: '2026-10-22', jeux: { 'fdj|ITGC9K': cash } };
  const stubFetch = () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(file), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('jeu connu : la section « Lots » apparaît ; le fichier n’est téléchargé qu’une fois', async () => {
    const fetchMock = stubFetch();
    const { unmount } = render(<LotsSection fdjRef="fdj|ITGC9K" />);
    expect(await screen.findByRole('region', { name: 'Lots' })).toBeTruthy();
    unmount();
    render(<LotsSection fdjRef="fdj|ITGC9K" />);
    expect(await screen.findByRole('region', { name: 'Lots' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/data\/fdj-lots\.json$/);
  });

  it('jeu sans entrée, ou fiche sans référence FDJ : pas de section', async () => {
    const fetchMock = stubFetch();
    render(<LotsSection fdjRef="fdj|ITGXXX" />);
    render(<LotsSection />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('region', { name: 'Lots' })).toBeNull();
  });

  it('fichier indisponible (hors ligne, pas encore en cache) : pas de section, nouvel essai à la fiche suivante', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<LotsSection fdjRef="fdj|ITGC9K" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('region', { name: 'Lots' })).toBeNull();
    unmount();
    stubFetch();
    render(<LotsSection fdjRef="fdj|ITGC9K" />);
    expect(await screen.findByRole('region', { name: 'Lots' })).toBeTruthy();
  });
});

describe('fichier des lots mal formé : jamais d’erreur sur la fiche', () => {
  it('seuls les paliers aux montant et nombre finis sont gardés ; plus aucun : le jeu disparaît', async () => {
    const bad = {
      version: 'v', fetchedAt: '', jeux: {
        'fdj|A': { ...cash, chance: 'beaucoup', trj: null, lots: [{ montant: '5', nombre: 2 }, { montant: 10, nombre: null }, null, { montant: 20, nombre: 3 }] },
        'fdj|B': { ...cash, lots: [{ montant: 'x', nombre: 1 }] },
        'fdj|C': { ...cash, lots: 'aucun' },
        'fdj|D': null,
      },
    };
    const f = await loadLots((async () => new Response(JSON.stringify(bad), { status: 200 })) as unknown as typeof fetch);
    expect(Object.keys(f!.jeux)).toEqual(['fdj|A']);
    expect(f!.jeux['fdj|A'].lots).toEqual([{ montant: 20, nombre: 3 }]);
    expect(f!.jeux['fdj|A'].chance).toBeUndefined();
    expect(f!.jeux['fdj|A'].trj).toBeUndefined();
    expect(cleanLotsEntry({ lots: [{ montant: 7, nombre: 1 }], gainMax: 'NaN' })).toMatchObject({ gainMax: 7, lots: [{ montant: 7, nombre: 1 }] });
  });
  it('la section s’affiche avec ce qui reste, sans planter', async () => {
    const bad = { version: 'v', fetchedAt: '', jeux: { 'fdj|ITGC9K': { ...cash, bloc: 'x', lots: [{ montant: 100, nombre: 2 }, { montant: {}, nombre: 1 }] } } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bad), { status: 200 })));
    render(<LotsSection fdjRef="fdj|ITGC9K" />);
    const section = await screen.findByRole('region', { name: 'Lots' });
    expect(within(section).getAllByRole('row')).toHaveLength(2); // en-tête + un palier
    expect(plain(section.textContent)).not.toContain('tickets');
  });
});
