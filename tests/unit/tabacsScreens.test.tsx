import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TabacSwitcher } from '../../src/ui/TabacSwitcher';
import { TabacSection } from '../../src/features/settings/TabacSection';
import { announcePairing, PairingPrompt } from '../../src/ui/PairingPrompt';
import { addTabac, listTabacs, renameTabac, resetRegistryMemoryForTests } from '../../src/tabacs/registry';
import { tabacDisplayName } from '../../src/tabacs/pageTabac';
import { getSettings, openTabacDb } from '../../src/data/db';

beforeEach(() => {
  localStorage.clear();
  resetRegistryMemoryForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('sans relais (VITE_RELAY_URL vide) : partage « bientôt disponible »', () => {
  beforeEach(() => vi.stubEnv('VITE_RELAY_URL', ''));

  it('en-tête : pas de point de synchronisation ; « Rejoindre » dit bientôt disponible ; créer reste possible', () => {
    render(<TabacSwitcher name="Mon tabac" />);
    expect(screen.queryByRole('button', { name: /Synchronisation/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre un tabac' }));
    expect(screen.getByText('Rejoindre un tabac : bientôt disponible')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Créer un tabac' }));
    expect(screen.getByLabelText('Nom du nouveau tabac')).toBeTruthy();
  });

  it('Réglages : « Inviter un employé » n’affiche pas de QR code', () => {
    render(<TabacSection shopName="Mon tabac" />);
    expect(screen.getByText('Partage entre téléphones : bientôt disponible')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Bientôt disponible');
  });

  it('scan d’une invitation : « Bientôt disponible », aucun tabac ajouté', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation', invite: { name: 'Tabac de la Gare', key: 'B'.repeat(43) } }));
    expect(screen.getByRole('status').textContent).toContain('Bientôt disponible');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listTabacs()).toHaveLength(1);
  });

  it('retirer un tabac non partagé : ses données n’existent que sur ce téléphone', async () => {
    addTabac('Tabac du Centre');
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(await screen.findByText(/n’existent que sur ce téléphone/)).toBeTruthy();
  });
});

describe('avec relais', () => {
  beforeEach(() => vi.stubEnv('VITE_RELAY_URL', 'http://localhost:8787'));

  it('invitation : « Rejoindre « <nom> » ? » ; Annuler ne change rien', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation', invite: { name: 'Tabac de la Gare', key: 'B'.repeat(43) } }));
    expect(screen.getByRole('dialog', { name: 'Rejoindre « Tabac de la Gare » ?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listTabacs()).toHaveLength(1);
  });

  it('invitation illisible et ancien QR code : messages clairs', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation' }));
    expect(screen.getByRole('status').textContent).toMatch(/illisible/);
    act(() => announcePairing({ kind: 'ancien' }));
    expect(screen.getByRole('status').textContent).toBe('Ancien QR code : demandez une invitation de tabac');
  });

  it('« Mes tabacs » : coche sur le courant, date d’ajout ; on ne peut retirer que les autres, après confirmation honnête', async () => {
    const other = addTabac('Tabac du Centre');
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    expect(screen.getByRole('button', { name: /^Mon tabac/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByText(/^ajouté le \d{1,2}(er)? \S+ \d{4}$/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retirer Mon tabac' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(screen.getByText('Ses données seront effacées de ce téléphone. Si aucun autre téléphone n’a rejoint ce tabac, elles seront perdues.')).toBeTruthy();
    expect(screen.getByText(/Sauvegarde complète/)).toBeTruthy();
    expect(screen.queryByText(/Les autres téléphones du tabac les gardent/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })); });
    await waitFor(() => expect(listTabacs().map((t) => t.id)).not.toContain(other.id));
    expect(screen.queryByRole('button', { name: 'Retirer Tabac du Centre' })).toBeNull();
  });

  it('retirer un tabac dont des modifications n’ont pas été envoyées : avertissement', async () => {
    const other = addTabac('Tabac du Centre');
    const d = openTabacDb(other.id);
    await d.opsOut.add({ op: { e: 'settings', id: 'main', f: { shopName: 'X' }, t: '1' } });
    d.close();
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(await screen.findByText('Des modifications n’ont pas encore été envoyées.')).toBeTruthy();
  });

  it('retrait bloqué par un autre onglet : message, le tabac reste', async () => {
    const other = addTabac('Tabac du Centre');
    // Connexion ouverte qui ne se ferme pas d'elle-même (comme un autre onglet).
    const raw = await new Promise<IDBDatabase>((resolve) => {
      const o = indexedDB.open(`la-carotte-${other.id}`);
      o.onsuccess = () => resolve(o.result);
    });
    render(<TabacSwitcher name="Mon tabac" removeTimeoutMs={50} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })); });
    expect(await screen.findByText('Fermez les autres onglets de La Carotte puis réessayez.')).toBeTruthy();
    expect(listTabacs().map((t) => t.id)).toContain(other.id);
    raw.close();
  });

  it('un seul tabac : jamais de bouton Retirer', () => {
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    expect(screen.queryByRole('button', { name: /^Retirer/ })).toBeNull();
  });

  it('point de synchronisation : avant le moteur, « Connexion… » ; le toucher ouvre Réglages', () => {
    location.hash = '';
    render(<TabacSwitcher name="Mon tabac" />);
    const dot = screen.getByRole('button', { name: 'Synchronisation : connexion…' });
    fireEvent.click(dot);
    expect(location.hash).toBe('#reglages');
  });

  it('inviter avec le nom par défaut : on demande d’abord le nom du tabac', async () => {
    render(<TabacSection shopName="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Nom du tabac à afficher sur les téléphones'), { target: { value: 'Tabac du Port' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Afficher le QR code' })); });
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
    expect(screen.getByText(/« Tabac du Port »/)).toBeTruthy();
    expect((await getSettings()).shopName).toBe('Tabac du Port');
  });

  it('inviter avec un vrai nom : QR code tout de suite', () => {
    render(<TabacSection shopName="Tabac de la Gare" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un employé' }));
    expect(screen.getByRole('img', { name: /QR code/ })).toBeTruthy();
  });
});

describe('tabacDisplayName', () => {
  it('le nom des réglages ; « Mon tabac » par défaut (base neuve) cède la place au nom du registre', () => {
    expect(tabacDisplayName('Tabac du Centre')).toBe('Tabac du Centre');
    expect(tabacDisplayName('Mon tabac')).toBe('Mon tabac');
    renameTabac('principal', 'Tabac de la Gare');
    expect(tabacDisplayName('Mon tabac')).toBe('Tabac de la Gare');
    expect(tabacDisplayName(undefined)).toBe('Tabac de la Gare');
  });
});
