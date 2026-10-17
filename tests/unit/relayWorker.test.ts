// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWorker } from '../../relay/src/worker.ts';
import type { WorkerEnv } from '../../relay/src/worker.ts';
import { createFakeD1 } from './fakeD1.ts';

const ORIGIN = 'https://wongmichel2048.github.io';

function setup(over: Partial<WorkerEnv> = {}) {
  const env: WorkerEnv = { DB: createFakeD1().d1, ALLOWED_ORIGINS: ORIGIN, ...over };
  const worker = createWorker();
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request('https://la-carotte-relais.exemple.workers.dev' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  return { env, call };
}

afterEach(() => vi.unstubAllGlobals());

describe('Worker du relais', () => {
  it('enregistre dans D1 puis relit (même isolat)', async () => {
    const { call } = setup();
    const r = await call('POST', '/v1/canaux/c1/messages', { ecriture: 'w', messages: [{ iv: 'a', data: 'b' }] }, { Origin: ORIGIN });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const g = await call('GET', '/v1/canaux/c1/messages?apres=0', undefined, { Origin: ORIGIN });
    expect(await g.json()).toEqual({ messages: [{ n: 1, iv: 'a', data: 'b' }], dernier: 1 });
  });

  it('ALLOWED_ORIGINS : liste séparée par des virgules, autres origines refusées', async () => {
    const { call } = setup({ ALLOWED_ORIGINS: 'https://a.exemple, https://b.exemple' });
    expect((await call('GET', '/v1/canaux/c1/messages', undefined, { Origin: 'https://b.exemple' })).status).toBe(200);
    expect((await call('GET', '/v1/canaux/c1/messages', undefined, { Origin: ORIGIN })).status).toBe(403);
  });

  it('sans ALLOWED_ORIGINS : seule l’app publiée est autorisée', async () => {
    const { call } = setup({ ALLOWED_ORIGINS: undefined });
    expect((await call('GET', '/v1/canaux/c1/messages', undefined, { Origin: ORIGIN })).status).toBe(200);
    expect((await call('GET', '/v1/canaux/c1/messages', undefined, { Origin: 'http://localhost:4173' })).status).toBe(403);
  });

  it('les limites par minute durent d’une requête à l’autre (Store créé une fois par isolat)', async () => {
    const { call } = setup();
    for (let i = 0; i < 120; i++) expect((await call('GET', '/v1/canaux/c1/messages')).status).toBe(200);
    expect((await call('GET', '/v1/canaux/c1/messages')).status).toBe(429);
  });

  it('/v1/codes sans GITHUB_TOKEN : 503', async () => {
    const { call } = setup();
    expect((await call('POST', '/v1/codes', { items: [{ kind: 'barcode', code: '3000000000001', ref: 'r' }] }, { Origin: ORIGIN })).status).toBe(503);
  });

  it('/v1/codes : issue créée sur wongmichel2048/Buraliste avec le jeton du Worker', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { call } = setup({ GITHUB_TOKEN: 'secret-gh' });
    const r = await call('POST', '/v1/codes', { items: [{ kind: 'barcode', code: '3000000000001', ref: 'r' }] }, { Origin: ORIGIN });
    expect(r.status).toBe(202);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/wongmichel2048/Buraliste/issues');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-gh');
  });
});
