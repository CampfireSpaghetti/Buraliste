import { useEffect, useRef, useState } from 'react';

export type ScannerState = 'idle' | 'starting' | 'running' | 'denied' | 'unsupported';

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format?: string }[]> };

// data_matrix : seulement pour reconnaître le code de traçabilité d'un paquet et demander l'EAN à la place.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'itf', 'code_39', 'qr_code', 'data_matrix'] as const;
const FRAME_MS = 150;

let detectorPromise: Promise<Detector> | undefined;

/** Détecteur natif (Chrome Android) si disponible, sinon zxing-wasm servi par l'app. */
function getDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const Native = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
    if (Native) {
      try {
        const supported: string[] = await Native.getSupportedFormats();
        if (supported.includes('ean_13')) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
      } catch {
        /* on bascule sur zxing */
      }
    }
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? import.meta.env.BASE_URL + 'zxing/zxing_reader.wasm' : prefix + path,
      },
    });
    return new BarcodeDetector({ formats: [...FORMATS] }) as Detector;
  })();
  return detectorPromise;
}

export function useBarcodeScanner(opts: { active: boolean; onCode: (code: string, format?: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(opts.onCode);
  onCodeRef.current = opts.onCode;
  const [state, setState] = useState<ScannerState>('idle');
  const [torch, setTorch] = useState<{ on: boolean; available: boolean }>({ on: false, available: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!opts.active) {
      setState('idle');
      return;
    }
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unsupported');
        return;
      }
      setState('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        const name = (e as DOMException).name;
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ on: false, available: !!caps.torch });

      const detector = await getDetector();
      if (stopped) return;
      setState('running');
      let busy = false;
      timer = setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const codes = (await detector.detect(video)).filter((c) => c.rawValue);
          // Paquet de tabac : l'EAN et le DataMatrix de traçabilité sont souvent vus ensemble ; l'EAN passe d'abord.
          const code = codes.find((c) => c.format !== 'data_matrix') ?? codes[0];
          if (code) onCodeRef.current(code.rawValue, code.format);
        } catch {
          /* image illisible : on réessaie à la frame suivante */
        } finally {
          busy = false;
        }
      }, FRAME_MS);
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [opts.active, attempt]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ on, available: true });
    } catch {
      setTorch({ on: false, available: false });
    }
  };

  return { videoRef, state, torch: torch.available ? { on: torch.on, toggle: toggleTorch } : undefined, retry: () => setAttempt((n) => n + 1) };
}
