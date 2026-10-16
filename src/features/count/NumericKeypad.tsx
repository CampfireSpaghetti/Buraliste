import { useState } from 'react';

const MAX_DIGITS = 5;

type Props = { title: string; subtitle?: string; initial: number; onValidate: (n: number) => void; onCancel: () => void; hint?: string };

/** Grand pavé numérique : la valeur initiale s'affiche, la première frappe la remplace. */
export function NumericKeypad({ title, subtitle, initial, onValidate, onCancel, hint }: Props) {
  const [value, setValue] = useState(String(initial));
  const [fresh, setFresh] = useState(true);
  const digit = (d: string) => {
    const next = fresh ? d : value + d;
    setFresh(false);
    if (next.replace(/^0+(?=\d)/, '').length > MAX_DIGITS) return;
    setValue(next.replace(/^0+(?=\d)/, ''));
  };
  const back = () => { setFresh(false); setValue((v) => v.slice(0, -1)); };
  const clear = () => { setFresh(false); setValue(''); };
  const valid = value !== '';
  return (
    <div className="keypad">
      <div className="keypad-head">
        <b>{title}</b>
        {subtitle && <span className="muted">{subtitle}</span>}
      </div>
      <div className="keypad-display num" data-testid="keypad-display" aria-live="polite">{value}</div>
      <div className="keypad-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => digit(d)}>{d}</button>
        ))}
        <button type="button" className="small" onClick={clear}>Effacer</button>
        <button type="button" onClick={() => digit('0')}>0</button>
        <button type="button" onClick={back} aria-label="Effacer le dernier chiffre">⌫</button>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn accent" disabled={!valid} onClick={() => onValidate(Number(value))}>Valider</button>
      </div>
      {hint && <p className="muted keypad-hint">{hint}</p>}
    </div>
  );
}
