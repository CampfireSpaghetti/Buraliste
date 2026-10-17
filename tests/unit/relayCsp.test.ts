import { describe, it, expect } from 'vitest';
import { relayOrigin, injectRelayOrigin, relayCspPlugin } from '../../scripts/relayCsp.ts';

const HTML = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' %RELAY_ORIGIN%" />`;

describe('relayOrigin', () => {
  it('vide ou absent : pas de relais', () => {
    expect(relayOrigin(undefined)).toBeUndefined();
    expect(relayOrigin('')).toBeUndefined();
    expect(relayOrigin('   ')).toBeUndefined();
  });
  it('garde l’origine seule (schéma, hôte, port), sans chemin', () => {
    expect(relayOrigin('https://la-carotte-relais.example.workers.dev')).toBe('https://la-carotte-relais.example.workers.dev');
    expect(relayOrigin(' https://relais.example.dev:8443/v1/ ')).toBe('https://relais.example.dev:8443');
    expect(relayOrigin('http://localhost:8787')).toBe('http://localhost:8787');
  });
  it.each([
    'http://relais.example.dev', 'ftp://relais.example.dev', 'relais.example.dev', "https://x.dev; script-src *", 'https://x.dev https://evil.example',
    'https://', 'javascript:alert(1)', 'https://user:pass@relais.example.dev', "https://x.dev'", 'http://localhost.evil.example', 'https://*.workers.dev',
  ])('valeur mal formée refusée : %s', (bad) => {
    expect(() => relayOrigin(bad)).toThrow(/VITE_RELAY_URL/);
  });
});

describe('injectRelayOrigin', () => {
  it('avec relais : l’origine est ajoutée à connect-src, après \'self\'', () => {
    expect(injectRelayOrigin(HTML, 'https://r.example.dev')).toContain("connect-src 'self' https://r.example.dev\"");
  });
  it('sans relais : connect-src \'self\' seul, sans espace ni marqueur restant', () => {
    const out = injectRelayOrigin(HTML, undefined);
    expect(out).toContain("connect-src 'self'\"");
    expect(out).not.toContain('%RELAY_ORIGIN%');
  });
  it('api.github.com n’apparaît plus dans la page source', async () => {
    const { readFile } = await import('node:fs/promises');
    const html = await readFile('index.html', 'utf8'); // vitest tourne à la racine du dépôt
    expect(html).toContain("connect-src 'self' %RELAY_ORIGIN%");
    expect(html).not.toContain('github');
  });
});

describe('relayCspPlugin', () => {
  it('lit VITE_RELAY_URL et transforme la page ; une valeur mal formée fait échouer la construction', () => {
    const run = (url: string | undefined) => {
      const plugin = relayCspPlugin(() => url) as unknown as { transformIndexHtml: { handler: (h: string) => string } };
      return plugin.transformIndexHtml.handler(HTML);
    };
    expect(run('https://r.example.dev')).toContain('https://r.example.dev');
    expect(run(undefined)).not.toContain('%RELAY_ORIGIN%');
    expect(() => run('http://pas-securise.example.dev')).toThrow(/VITE_RELAY_URL/);
  });
});
