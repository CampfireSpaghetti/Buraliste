import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { tabacDisplayName, TabacSwitcher } from '../../src/ui/TabacSwitcher';
import { renameTabac } from '../../src/tabacs/registry';
import { TabacSection } from '../../src/features/settings/TabacSection';
import { announcePairing, PairingPrompt } from '../../src/ui/PairingPrompt';
import { addTabac, listTabacs, resetRegistryMemoryForTests } from '../../src/tabacs/registry';

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
    expect(screen.queryByRole('img', { name: /Synchronisation/ })).toBeNull();
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
});

describe('avec relais', () => {
  beforeEach(() => vi.stubEnv('VITE_RELAY_URL', 'http://localhost:8787'));

  it('invitation : « Rejoindre le <nom> ? » ; Annuler ne change rien', () => {
    render(<PairingPrompt />);
    act(() => announcePairing({ kind: 'invitation', invite: { name: 'Tabac de la Gare', key: 'B'.repeat(43) } }));
    expect(screen.getByRole('dialog', { name: 'Rejoindre le Tabac de la Gare ?' })).toBeTruthy();
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

  it('« Mes tabacs » : coche sur le courant ; on ne peut retirer que les autres, après confirmation', async () => {
    const other = addTabac('Tabac du Centre');
    render(<TabacSwitcher name="Mon tabac" />);
    expect(screen.getByRole('img', { name: /^Synchronisation : / })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    expect(screen.getByRole('button', { name: 'Mon tabac' }).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Retirer Mon tabac' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Tabac du Centre' }));
    expect(screen.getByText(/Ses données sur ce téléphone seront effacées/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })); });
    expect(listTabacs().map((t) => t.id)).not.toContain(other.id);
    expect(screen.queryByRole('button', { name: 'Retirer Tabac du Centre' })).toBeNull();
  });

  it('un seul tabac : jamais de bouton Retirer', () => {
    render(<TabacSwitcher name="Mon tabac" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes tabacs : Mon tabac' }));
    expect(screen.queryByRole('button', { name: /^Retirer/ })).toBeNull();
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
