let ctx: AudioContext | undefined;

/** Bip court (1 200 Hz, 80 ms) après un scan réussi. */
export function beep(): void {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1200;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    /* son indisponible */
  }
}

/** Vibration courte (Android ; iOS ne la permet pas aux web-apps). */
export function vibrate(): void {
  try {
    navigator.vibrate?.(40);
  } catch {
    /* vibration indisponible */
  }
}

export const SCAN_OK_EVENT = 'carotte:scan-ok';
export const TEST_SCAN_EVENT = 'carotte:testscan';

export function signalScanOk(): void {
  beep();
  vibrate();
  window.dispatchEvent(new Event(SCAN_OK_EVENT));
}
