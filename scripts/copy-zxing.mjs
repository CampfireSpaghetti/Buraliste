// Copie le moteur de lecture des codes-barres (WebAssembly) dans public/ : l'app le sert elle-même, hors ligne, sans CDN.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/zxing', { recursive: true });
copyFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'public/zxing/zxing_reader.wasm');
