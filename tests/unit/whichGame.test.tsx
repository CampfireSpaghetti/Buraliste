import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WhichGameDialog } from '../../src/features/count/WhichGameDialog';
import { ConfirmGameDialog } from '../../src/features/count/ConfirmGameDialog';
import type { Product } from '../../src/domain/types';

afterEach(cleanup);
const game = (id: string, name: string): Product => ({ id, source: 'fdj', base: { kind: 'jeu-fdj', name, ticketPrice: 5 }, user: {}, outOfStock: false, pinnedSubstitutes: [], updatedAt: 0 });
const games = [game('cash', 'CASH'), game('mg', 'Méga Goal'), game('mmc', 'Méga Mots Croisés'), game('astro', 'Astro')];

describe('WhichGameDialog', () => {
  it('recherche sans accents ni majuscules dans tous les jeux, « Nouveau jeu » en bas', () => {
    const onPick = vi.fn();
    render(<WhichGameDialog code="123456" candidates={[games[0]]} games={games} onPick={onPick} onNewGame={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Rechercher un jeu'), { target: { value: 'MEGA go' } });
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Méga Goal5,00 €', '+ Nouveau jeu']);
    fireEvent.click(buttons[0]);
    expect(onPick).toHaveBeenCalledWith(games[1]);
  });
  it('rien trouvé : le dit, et « Nouveau jeu » reste proposé', () => {
    render(<WhichGameDialog code="123456" candidates={[]} games={games} onPick={() => {}} onNewGame={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Rechercher un jeu'), { target: { value: 'zzz' } });
    expect(screen.getByText('Aucun jeu trouvé.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Nouveau jeu' })).toBeTruthy();
  });
});

describe('ConfirmGameDialog', () => {
  it('« Ce ticket est-il un CASH ? » : Oui / Autre jeu', () => {
    const onYes = vi.fn();
    const onOther = vi.fn();
    render(<ConfirmGameDialog game={games[0]} code="871050010001" onYes={onYes} onOther={onOther} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Ce ticket est-il un CASH ?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Autre jeu' }));
    expect(onOther).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(onYes).toHaveBeenCalled();
  });
});
