import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { SettingsScreen } from '../../src/features/settings/SettingsScreen';
import { db, getSettings, saveSettings } from '../../src/data/db';
import { notifyDataChanged } from '../../src/store';

beforeEach(async () => {
  vi.stubEnv('VITE_RELAY_URL', '');
  await db.delete();
  await db.open();
  await saveSettings({ shopName: 'Tabac du Port' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Réglages : nom du tabac', () => {
  it('nom changé par un autre téléphone pendant que le champ a le focus : quitter le champ sans rien saisir ne le réécrit pas', async () => {
    render(<SettingsScreen />);
    const input = (await screen.findByLabelText('Nom du tabac')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Tabac du Port'));
    act(() => input.focus());
    // renommage reçu d'un autre téléphone pendant que le champ a le focus
    await act(async () => {
      await saveSettings({ shopName: 'Tabac de la Gare' });
      notifyDataChanged();
    });
    expect(input.value).toBe('Tabac du Port');
    await act(async () => input.blur());
    await new Promise((r) => setTimeout(r, 20));
    expect((await getSettings()).shopName).toBe('Tabac de la Gare');
    await waitFor(() => expect(input.value).toBe('Tabac de la Gare'));
  });

  it('nom saisi puis champ quitté : enregistré', async () => {
    render(<SettingsScreen />);
    const input = (await screen.findByLabelText('Nom du tabac')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Tabac du Port'));
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Le Balto' } });
    await act(async () => input.blur());
    await waitFor(async () => expect((await getSettings()).shopName).toBe('Le Balto'));
  });
});
