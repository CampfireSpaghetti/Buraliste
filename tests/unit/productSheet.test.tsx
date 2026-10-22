import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { Product } from '../../src/domain/types';
import type { LotsFile } from '../../src/domain/lots';

// Magasin simulé : la fiche affichée et les actions observées.
const state = vi.hoisted(() => ({ products: [] as Product[] }));
const actions = vi.hoisted(() => ({
  removeUserCode: vi.fn(),
  putProduct: vi.fn(async (p: Product) => p),
  setOutOfStock: vi.fn(),
  clearUserField: vi.fn(),
}));
vi.mock('../../src/store', () => ({
  useProducts: () => state.products,
  actions,
  pushRecent: () => {},
  newUserProduct: (user: object) => ({ id: 'new', source: 'utilisateur', base: {}, user, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 }),
}));

import { NavProvider } from '../../src/nav';
import { ProductSheet } from '../../src/features/catalog/ProductSheet';
import { ProductForm } from '../../src/features/catalog/ProductForm';
import { resetLotsCache } from '../../src/data/lotsData';

const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');
const cig = (over: Partial<Product> = {}): Product => ({
  id: 'cig', source: 'douane', douaneRef: 'pmi|marlboro', base: { kind: 'cigarette', name: 'Marlboro', barcodes: ['3017620422003'] },
  user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0, ...over,
});
const cash: Product = {
  id: 'cash', source: 'fdj', fdjRef: 'fdj|ITGC9K', base: { kind: 'jeu-fdj', name: 'CASH', ticketPrice: 5, maxPrize: 500000 },
  user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0,
};
const lots: LotsFile = {
  version: 'v', fetchedAt: '2026-10-22', jeux: {
    'fdj|ITGC9K': { prix: 5, gainMax: 500000, lots: [{ montant: 500000, nombre: 4 }, { montant: 5, nombre: 100 }], source: 'https://www.fdj.fr/x', majLe: '2026-10-22' },
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).endsWith('fdj-lots.json')) return new Response(JSON.stringify(lots), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetLotsCache();
  vi.clearAllMocks();
});

const renderIn = (node: React.ReactNode) => render(<NavProvider>{node}</NavProvider>);

describe('ProductSheet', () => {
  it('« Retirer » qui échoue : message d’erreur, pas d’exception', async () => {
    state.products = [cig({ user: { barcodes: ['4006381333931'] } })];
    actions.removeUserCode.mockRejectedValueOnce(new Error('base indisponible'));
    renderIn(<ProductSheet id="cig" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer 4006381333931' }));
    const toast = await screen.findByRole('status');
    expect(toast.textContent).toContain('Le code n’a pas pu être retiré');
  });

  it('jeu avec tableau des lots : « Gain maximum » de la liste FDJ n’est pas répété', async () => {
    state.products = [cash];
    renderIn(<ProductSheet id="cash" />);
    const section = await screen.findByRole('region', { name: 'Lots' });
    expect(plain(section.textContent)).toContain('Gain maximal : 500 000 €');
    expect(screen.queryByText('Gain maximum')).toBeNull();
  });

  it('jeu sans tableau des lots : « Gain maximum » reste affiché', async () => {
    state.products = [{ ...cash, fdjRef: 'fdj|AUTRE' }];
    renderIn(<ProductSheet id="cash" />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Gain maximum')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Lots' })).toBeNull();
  });
});

describe('ProductForm : enregistrer', () => {
  it('les codes de la liste commune (codes et codes de jeu) ne sont jamais recopiés dans la couche user', async () => {
    state.products = [cig({ sharedBarcodes: ['4006381333931'], sharedFdjPrefixes: ['87104'], user: { barcodes: ['96385074'] } })];
    renderIn(<ProductForm id="cig" />);
    const codes = screen.getByLabelText('Codes-barres') as HTMLInputElement;
    expect(codes.value.split(' ').sort()).toEqual(['3017620422003', '4006381333931', '96385074']);
    // Ajout d'un code partagé comme code de jeu, et d'un nouveau code.
    fireEvent.change(codes, { target: { value: `${codes.value} 87104 5449000000996` } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => expect(actions.putProduct).toHaveBeenCalled());
    const saved = actions.putProduct.mock.calls[0][0] as Product;
    expect(saved.user.barcodes).toEqual(['96385074', '5449000000996']);
  });
});
