/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { relayCspPlugin } from './scripts/relayCsp.ts';

export default defineConfig(({ mode }) => ({
  base: '/Buraliste/',
  plugins: [
    react(),
    // CSP : l'origine de VITE_RELAY_URL (variable d'environnement ou fichier .env) rejoint `connect-src`.
    relayCspPlugin(() => process.env.VITE_RELAY_URL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_RELAY_URL),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'La Carotte',
        short_name: 'La Carotte',
        description: "L'outil de poche du buraliste : scan, catalogue, remplaçants, comptage grattage.",
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/Buraliste/',
        scope: '/Buraliste/',
        theme_color: '#8e1b1f',
        background_color: '#f6f4ee',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,wasm,json,png,svg}'],
        // Composition ANSES : trop grosse pour le précache (téléchargée à la première fiche de tabac ouverte), gardée
        // ensuite par le service worker pour le hors-ligne, et rafraîchie en arrière-plan.
        globIgnores: ['**/data/composition.json'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/data/composition.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'composition-anses', cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 1 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
}));
