import { defineConfig } from '@playwright/test';

/** Faux relais local (scripts/mock-relay.ts) : l'app de test est construite pour lui parler. */
const RELAY_URL = 'http://localhost:8787';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173/Buraliste/',
    viewport: { width: 390, height: 844 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173/Buraliste/',
      env: { VITE_RELAY_URL: RELAY_URL },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'node scripts/mock-relay.ts',
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
