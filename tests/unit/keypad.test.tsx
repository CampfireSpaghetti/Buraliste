import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NumericKeypad } from '../../src/features/count/NumericKeypad';

afterEach(cleanup);
const press = (k: string) => fireEvent.click(screen.getByRole('button', { name: k }));
const display = () => screen.getByTestId('keypad-display').textContent;

describe('NumericKeypad', () => {
  it('affiche la valeur initiale ; la première frappe la remplace', () => {
    const onValidate = vi.fn();
    render(<NumericKeypad title="Cash" initial={38} onValidate={onValidate} onCancel={() => {}} />);
    expect(display()).toBe('38');
    press('4');
    expect(display()).toBe('4');
    press('2');
    press('Valider');
    expect(onValidate).toHaveBeenCalledWith(42);
  });
  it('« 007 » donne 7', () => {
    const onValidate = vi.fn();
    render(<NumericKeypad title="Cash" initial={0} onValidate={onValidate} onCancel={() => {}} />);
    ['0', '0', '7'].forEach(press);
    press('Valider');
    expect(onValidate).toHaveBeenCalledWith(7);
  });
  it('saisie vide : Valider désactivé', () => {
    render(<NumericKeypad title="Cash" initial={12} onValidate={() => {}} onCancel={() => {}} />);
    press('Effacer');
    expect(screen.getByRole('button', { name: 'Valider' })).toHaveProperty('disabled', true);
  });
  it('plafond de 5 chiffres (99 999)', () => {
    const onValidate = vi.fn();
    render(<NumericKeypad title="Cash" initial={0} onValidate={onValidate} onCancel={() => {}} />);
    ['9', '9', '9', '9', '9', '9'].forEach(press);
    expect(display()).toBe('99999');
    press('Valider');
    expect(onValidate).toHaveBeenCalledWith(99999);
  });
  it('retour arrière', () => {
    render(<NumericKeypad title="Cash" initial={0} onValidate={() => {}} onCancel={() => {}} />);
    ['1', '2'].forEach(press);
    press('Effacer le dernier chiffre');
    expect(display()).toBe('1');
  });
  it('Annuler', () => {
    const onCancel = vi.fn();
    render(<NumericKeypad title="Cash" initial={3} onValidate={() => {}} onCancel={onCancel} />);
    press('Annuler');
    expect(onCancel).toHaveBeenCalled();
  });
});
