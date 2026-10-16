import { useEffect, useMemo, useRef, useState } from 'react';
import { createScanDebouncer, resolveScan, type ScanResult } from '../../domain/matching';
import { useProducts } from '../../store';
import { Sheet } from '../../ui/Panel';
import { signalScanOk, TEST_SCAN_EVENT } from './feedback';
import { useBarcodeScanner } from './useBarcodeScanner';
import './scanner.css';

type Props = {
  mode: 'lookup' | 'count';
  onResult: (r: ScanResult) => void;
  paused?: boolean;
  footer?: React.ReactNode;
};

export function ScannerView({ mode, onResult, paused = false, footer }: Props) {
  const products = useProducts();
  const productsRef = useRef(products);
  productsRef.current = products;
  const accept = useMemo(() => createScanDebouncer(), []);
  const [manual, setManual] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused || manual;

  const handle = (raw: string, bypassDebounce = false) => {
    if (!bypassDebounce) {
      // Pendant une pause (pavé, fiche), on note quand même les codes vus : un ticket resté
      // devant la caméra ne sera pas relu à la reprise.
      const fresh = accept(raw, Date.now());
      if (pausedRef.current || !fresh) return;
    }
    signalScanOk();
    onResult(resolveScan(raw, productsRef.current ?? []));
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // La caméra reste allumée pendant les pauses (pavé, fiche) : un ticket resté devant l'objectif est vu en continu
  // et l'anti-doublon l'ignore à la reprise. Cela évite aussi de redemander l'autorisation caméra à chaque ticket.
  const { videoRef, state, torch, retry } = useBarcodeScanner({ active: !manual, onCode: (c) => handleRef.current(c) });

  useEffect(() => {
    const onTest = (e: Event) => handleRef.current((e as CustomEvent<string>).detail);
    window.addEventListener(TEST_SCAN_EVENT, onTest);
    return () => window.removeEventListener(TEST_SCAN_EVENT, onTest);
  }, []);

  const blocked = state === 'denied' || state === 'unsupported';
  return (
    <div className={'scanner ' + mode}>
      <div className="scanner-cam">
        <video ref={videoRef} muted playsInline aria-hidden="true" />
        {!blocked && <div className="scanner-vise" aria-hidden="true" />}
        {state === 'starting' && <p className="scanner-msg">Démarrage de l'appareil photo…</p>}
        {blocked && (
          <div className="scanner-blocked">
            <h3>{state === 'denied' ? "Autorisez l'appareil photo" : 'Appareil photo indisponible'}</h3>
            {state === 'denied' ? (
              <p>
                iPhone : Réglages › Safari › Appareil photo › Autoriser.
                <br />
                Android : touchez le cadenas à côté de l'adresse › Autorisations › Appareil photo.
              </p>
            ) : (
              <p>Ce téléphone ne donne pas accès à l'appareil photo. Vous pouvez saisir le code à la main.</p>
            )}
            {state === 'denied' && (
              <button type="button" className="btn accent" onClick={retry}>
                Réessayer
              </button>
            )}
          </div>
        )}
      </div>
      <div className="scanner-bar">
        {footer}
        <div className="row">
          <button type="button" className="btn" onClick={() => setManual(true)}>
            ⌨ Saisir le code
          </button>
          {torch && (
            <button type="button" className="btn" aria-pressed={torch.on} onClick={torch.toggle}>
              {torch.on ? 'Éteindre la lampe' : 'Lampe'}
            </button>
          )}
        </div>
      </div>
      {manual && <ManualEntry onClose={() => setManual(false)} onSubmit={(c) => { setManual(false); handle(c, true); }} />}
    </div>
  );
}

function ManualEntry({ onClose, onSubmit }: { onClose: () => void; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <Sheet label="Saisir le code" onClose={onClose}>
      <form
        className="manual"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onSubmit(code.trim());
        }}
      >
        <label className="field-label">
          Code-barres
          <input className="input" id="manual-code" inputMode="numeric" autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn accent" disabled={!code.trim()}>Valider</button>
        </div>
      </form>
    </Sheet>
  );
}
