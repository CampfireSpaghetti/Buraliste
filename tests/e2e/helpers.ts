import type { Page } from '@playwright/test';

/** Active les points d'entrée de test et coupe la synchronisation de la liste officielle au démarrage. */
export async function testMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('carotte:test', '1');
    if (!localStorage.getItem('carotte:nom')) localStorage.setItem('carotte:nom', 'Test');
    localStorage.setItem('carotte:nosync', '1');
  });
}

export async function seed(page: Page, data: unknown) {
  await page.waitForFunction(() => typeof (window as any).__carotteSeed === 'function');
  await page.evaluate((d) => (window as any).__carotteSeed(d), data);
}

export async function scan(page: Page, code: string, format?: string) {
  await page.waitForFunction(() => typeof (window as any).__carotteScan === 'function');
  await page.evaluate(([c, f]) => (window as any).__carotteScan(c, f), [code, format] as const);
}
