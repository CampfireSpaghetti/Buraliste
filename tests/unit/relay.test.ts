// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { handle } from '../../relay/src/handlers.ts';
import type { RelayEnv, Store } from '../../relay/src/handlers.ts';
import { createMemoryStore } from '../../relay/src/memoryStore.ts';

const ORIGIN = 'https://wongmichel2048.github.io';
const DAY = 24 * 3600 * 1000;

function makeEnv(over: Partial<RelayEnv> = {}) {
  const clock = { t: 1_000_000 };
  const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response('{}', { status: 201 }));
  const env: RelayEnv = {
    store: createMemoryStore(),
    githubToken: 'tok',
    githubRepo: 'wongmichel2048/Buraliste',
    now: () => clock.t,
    fetch: fetchMock as unknown as typeof fetch,
    allowedOrigins: [ORIGIN],
    ...over,
  };
  return { env, clock, fetchMock };
}

function call(env: RelayEnv, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handle(new Request('https://relais.test' + path, init), env);
}

const post = (env: RelayEnv, canal: string, ecriture: string, messages: unknown[]) =>
  call(env, 'POST', `/v1/canaux/${canal}/messages`, { ecriture, messages });

describe('relais : messages', () => {
  it('enregistre le premier envoi puis le relit', async () => {
    const { env } = makeEnv();
    const r = await post(env, 'c1', 'w1', [{ iv: 'a', data: 'b' }]);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ dernier: 1 });
    const g = await call(env, 'GET', '/v1/canaux/c1/messages?apres=0');
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ messages: [{ n: 1, iv: 'a', data: 'b' }], dernier: 1 });
  });

  it('refuse une autre clé d’écriture (403)', async () => {
    const { env } = makeEnv();
    await post(env, 'c1', 'w1', [{ iv: 'a', data: 'b' }]);
    expect((await post(env, 'c1', 'autre', [{ iv: 'a', data: 'b' }])).status).toBe(403);
    expect((await post(env, 'c1', 'w1', [{ iv: 'c', data: 'd' }])).status).toBe(200);
  });

  it('ne stocke que l’empreinte SHA-256 de la clé d’écriture', async () => {
    const { env } = makeEnv();
    await post(env, 'c1', 'w1', [{ iv: 'a', data: 'b' }]);
    const ch = await env.store.getChannel('c1');
    expect(ch?.ecritureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ch?.ecritureHash).not.toContain('w1');
  });

  it('canal inconnu : liste vide', async () => {
    const { env } = makeEnv();
    const g = await call(env, 'GET', '/v1/canaux/inconnu/messages?apres=0');
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ messages: [], dernier: 0 });
  });

  it('pagine : 600 messages, max=500', async () => {
    const { env } = makeEnv();
    for (let i = 0; i < 3; i++) {
      const msgs = Array.from({ length: 200 }, (_, k) => ({ iv: 'i' + k, data: 'd' + k }));
      expect((await post(env, 'c1', 'w1', msgs)).status).toBe(200);
    }
    const g = await call(env, 'GET', '/v1/canaux/c1/messages?apres=0&max=500');
    const j = (await g.json()) as { messages: { n: number }[]; dernier: number };
    expect(j.messages).toHaveLength(500);
    expect(j.messages[0].n).toBe(1);
    expect(j.dernier).toBe(600);
    const g2 = await call(env, 'GET', '/v1/canaux/c1/messages?apres=500&max=500');
    const j2 = (await g2.json()) as { messages: { n: number }[]; dernier: number };
    expect(j2.messages).toHaveLength(100);
    expect(j2.dernier).toBe(600);
  });

  it('plus de 200 messages : 413', async () => {
    const { env } = makeEnv();
    const msgs = Array.from({ length: 201 }, () => ({ iv: 'a', data: 'b' }));
    expect((await post(env, 'c1', 'w1', msgs)).status).toBe(413);
  });

  it('corps de plus de 64 Ko : 413', async () => {
    const { env } = makeEnv();
    const r = await post(env, 'c1', 'w1', [{ iv: 'a', data: 'x'.repeat(70_000) }]);
    expect(r.status).toBe(413);
  });

  it('100 Ko de messages : 413 (la limite de 1 Mo ne vaut que pour la photographie)', async () => {
    const { env } = makeEnv();
    const r = await post(env, 'c1', 'w1', [{ iv: 'a', data: 'x'.repeat(100_000) }]);
    expect(r.status).toBe(413);
  });

  it('premier envoi simultané : celui qui perd la création est comparé à l’empreinte enregistrée', async () => {
    // getChannel répond « inconnu » (lu avant l'insertion concurrente), createChannel répond false.
    const base = createMemoryStore();
    const { env } = makeEnv({ store: base });
    await post(env, 'c1', 'w1', [{ iv: 'a', data: 'b' }]);
    let stale = 0;
    const racing: Store = {
      ...base,
      getChannel: async (canal) => (stale-- > 0 ? null : base.getChannel(canal)),
    };
    const env2: RelayEnv = { ...env, store: racing };
    stale = 1;
    expect((await post(env2, 'c1', 'autre', [{ iv: 'x', data: 'y' }])).status).toBe(403);
    stale = 1;
    expect((await post(env2, 'c1', 'w1', [{ iv: 'c', data: 'd' }])).status).toBe(200);
    const list = await base.listMessages('c1', 0, 10);
    expect(list.map((m) => m.iv)).toEqual(['a', 'c']);
  });

  it('plus de 120 requêtes par minute sur un canal : 429, puis reprise après la minute', async () => {
    const { env, clock } = makeEnv();
    for (let i = 0; i < 120; i++) expect((await call(env, 'GET', '/v1/canaux/c1/messages')).status).toBe(200);
    expect((await call(env, 'GET', '/v1/canaux/c1/messages')).status).toBe(429);
    // un autre canal n'est pas touché
    expect((await call(env, 'GET', '/v1/canaux/c2/messages')).status).toBe(200);
    clock.t += 61_000;
    expect((await call(env, 'GET', '/v1/canaux/c1/messages')).status).toBe(200);
  });

  it('entrées invalides : 400', async () => {
    const { env } = makeEnv();
    expect((await call(env, 'POST', '/v1/canaux/c1/messages', '{pas du json')).status).toBe(400);
    expect((await call(env, 'POST', '/v1/canaux/c1/messages', { messages: [{ iv: 'a', data: 'b' }] })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/canaux/c1/messages', { ecriture: 5, messages: [{ iv: 'a', data: 'b' }] })).status).toBe(400);
    expect((await post(env, 'c1', 'w1', [{ iv: 1, data: 'b' }])).status).toBe(400);
    expect((await post(env, 'c1', 'w1', [{ iv: 'a', data: null }])).status).toBe(400);
    expect((await post(env, 'c1', 'w1', [])).status).toBe(400);
    expect((await call(env, 'POST', '/v1/canaux/c1/messages', { ecriture: 'w1', messages: 'x' })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/canaux/c1/messages', 'null')).status).toBe(400);
    // aucun canal n'a été créé par ces requêtes invalides
    expect(await env.store.getChannel('c1')).toBeNull();
  });

  it('route inconnue : 404', async () => {
    const { env } = makeEnv();
    expect((await call(env, 'GET', '/v1/inconnu')).status).toBe(404);
    expect((await call(env, 'DELETE', '/v1/canaux/c1/messages')).status).toBe(404);
  });
});

describe('relais : photographie', () => {
  it('PUT puis GET renvoie l’objet', async () => {
    const { env } = makeEnv();
    const put = await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 7, iv: 'i', data: 'd' });
    expect(put.status).toBe(200);
    const g = await call(env, 'GET', '/v1/canaux/c1/photo');
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ jusqua: 7, iv: 'i', data: 'd' });
  });

  it('GET sans photographie : 404', async () => {
    const { env } = makeEnv();
    expect((await call(env, 'GET', '/v1/canaux/c1/photo')).status).toBe(404);
  });

  it('mauvaise clé d’écriture : 403', async () => {
    const { env } = makeEnv();
    await post(env, 'c1', 'w1', [{ iv: 'a', data: 'b' }]);
    const put = await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'autre', jusqua: 1, iv: 'i', data: 'd' });
    expect(put.status).toBe(403);
    expect((await call(env, 'GET', '/v1/canaux/c1/photo')).status).toBe(404);
  });

  it('entrées invalides : 400', async () => {
    const { env } = makeEnv();
    expect((await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 'x', iv: 'i', data: 'd' })).status).toBe(400);
    expect((await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 1, iv: 2, data: 'd' })).status).toBe(400);
    expect((await call(env, 'PUT', '/v1/canaux/c1/photo', { jusqua: 1, iv: 'i', data: 'd' })).status).toBe(400);
  });

  it('photographie de 100 Ko : acceptée (limite propre à la photographie : 1 Mo)', async () => {
    const { env } = makeEnv();
    const data = 'x'.repeat(100_000);
    const r = await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 1, iv: 'i', data });
    expect(r.status).toBe(200);
    expect(((await (await call(env, 'GET', '/v1/canaux/c1/photo')).json()) as { data: string }).data).toBe(data);
  });

  it('corps de plus de 1 Mo : 413', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 1, iv: 'i', data: 'x'.repeat(1024 * 1024) });
    expect(r.status).toBe(413);
    expect(await env.store.getChannel('c1')).toBeNull();
  });

  it('Content-Length annoncé au-delà de 1 Mo : 413', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 1, iv: 'i', data: 'd' }, {
      'Content-Length': String(1024 * 1024 + 1),
    });
    expect(r.status).toBe(413);
  });

  it('ménage : une nouvelle photographie supprime les messages couverts par la précédente et vieux de plus de 30 jours', async () => {
    const { env, clock } = makeEnv();
    const t0 = clock.t;
    await post(env, 'c1', 'w1', [{ iv: 'a1', data: 'b1' }, { iv: 'a2', data: 'b2' }]); // n=1,2 à t0
    clock.t = t0 + 25 * DAY;
    await post(env, 'c1', 'w1', [{ iv: 'a3', data: 'b3' }]); // n=3 à t0+25j
    await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 3, iv: 'i1', data: 'd1' });
    // première photographie : pas de photographie précédente, rien à supprimer
    expect(((await (await call(env, 'GET', '/v1/canaux/c1/messages?apres=0')).json()) as { messages: unknown[] }).messages).toHaveLength(3);

    clock.t = t0 + 31 * DAY;
    await post(env, 'c1', 'w1', [{ iv: 'a4', data: 'b4' }]); // n=4 à t0+31j
    await call(env, 'PUT', '/v1/canaux/c1/photo', { ecriture: 'w1', jusqua: 4, iv: 'i2', data: 'd2' });
    const j = (await (await call(env, 'GET', '/v1/canaux/c1/messages?apres=0')).json()) as { messages: { n: number }[]; dernier: number };
    // 1 et 2 : couverts par la photographie précédente (jusqua 3) et reçus il y a 31 jours -> supprimés
    // 3 : couvert mais reçu il y a 6 jours -> reste ; 4 : non couvert par la précédente -> reste
    expect(j.messages.map((m) => m.n)).toEqual([3, 4]);
    expect(j.dernier).toBe(4);
  });
});

describe('relais : codes-barres', () => {
  const items = [
    { kind: 'barcode', code: '3000000000001', ref: 'r1' },
    { kind: 'fdjPrefix', prefix: '12345678', ref: 'r2' },
  ];

  it('crée une issue GitHub', async () => {
    const { env, fetchMock } = makeEnv();
    const r = await call(env, 'POST', '/v1/codes', { items });
    expect(r.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/wongmichel2048/Buraliste/issues');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe('[codes-barres] 2 codes');
    expect(body.body).toContain('3000000000001');
  });

  it('sans jeton GitHub : 503', async () => {
    const { env, fetchMock } = makeEnv({ githubToken: undefined });
    expect((await call(env, 'POST', '/v1/codes', { items })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('plus de 200 codes : 413', async () => {
    const { env, fetchMock } = makeEnv();
    const many = Array.from({ length: 201 }, () => items[0]);
    expect((await call(env, 'POST', '/v1/codes', { items: many })).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('plus de 20 requêtes par heure depuis la même IP : 429', async () => {
    const { env, clock } = makeEnv();
    const ip = { 'CF-Connecting-IP': '1.2.3.4' };
    for (let i = 0; i < 20; i++) expect((await call(env, 'POST', '/v1/codes', { items }, ip)).status).toBe(202);
    expect((await call(env, 'POST', '/v1/codes', { items }, ip)).status).toBe(429);
    expect((await call(env, 'POST', '/v1/codes', { items }, { 'CF-Connecting-IP': '5.6.7.8' })).status).toBe(202);
    clock.t += 3600_000 + 1;
    expect((await call(env, 'POST', '/v1/codes', { items }, ip)).status).toBe(202);
  });

  it('éléments invalides : 400', async () => {
    const { env } = makeEnv();
    expect((await call(env, 'POST', '/v1/codes', { items: [] })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/codes', { items: 'x' })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/codes', { items: [{ kind: 'barcode', code: 5, ref: 'r' }] })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/codes', { items: [{ kind: 'autre' }] })).status).toBe(400);
    expect((await call(env, 'POST', '/v1/codes', 'pas du json')).status).toBe(400);
  });

  it('seuls les champs connus partent dans l’issue', async () => {
    const { env, fetchMock } = makeEnv();
    const r = await call(env, 'POST', '/v1/codes', {
      items: [
        { kind: 'barcode', code: '3000000000001', ref: 'r1', pirate: '<script>', extra: { a: 1 } },
        { kind: 'fdjPrefix', prefix: '12345678', ref: 'r2', code: 'intrus' },
      ],
    });
    expect(r.status).toBe(202);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).body as string;
    expect(body).not.toContain('pirate');
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('extra');
    expect(body).not.toContain('intrus');
    const payload = JSON.parse(/```json\s*([\s\S]*?)```/.exec(body)![1]);
    expect(payload.items).toEqual([
      { kind: 'barcode', code: '3000000000001', ref: 'r1' },
      { kind: 'fdjPrefix', prefix: '12345678', ref: 'r2' },
    ]);
  });

  it('chaînes trop longues : 400 (code ≤ 32, préfixe ≤ 32, référence ≤ 64)', async () => {
    const { env, fetchMock } = makeEnv();
    const ok = await call(env, 'POST', '/v1/codes', {
      items: [
        { kind: 'barcode', code: '1'.repeat(32), ref: 'r'.repeat(64) },
        { kind: 'fdjPrefix', prefix: '2'.repeat(32), ref: 'r' },
      ],
    });
    expect(ok.status).toBe(202);
    for (const item of [
      { kind: 'barcode', code: '1'.repeat(33), ref: 'r' },
      { kind: 'barcode', code: '1', ref: 'r'.repeat(65) },
      { kind: 'fdjPrefix', prefix: '2'.repeat(33), ref: 'r' },
      { kind: 'fdjPrefix', prefix: '2', ref: 'r'.repeat(65) },
    ]) {
      expect((await call(env, 'POST', '/v1/codes', { items: [items[0], item] })).status).toBe(400);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GitHub en erreur ou injoignable : 502', async () => {
    const a = makeEnv();
    a.fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    expect((await call(a.env, 'POST', '/v1/codes', { items })).status).toBe(502);
    const b = makeEnv();
    b.fetchMock.mockRejectedValueOnce(new Error('réseau'));
    expect((await call(b.env, 'POST', '/v1/codes', { items })).status).toBe(502);
  });
});

describe('relais : CORS', () => {
  it('renvoie l’origine autorisée', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'GET', '/v1/canaux/c1/messages', undefined, { Origin: ORIGIN });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('autre origine : 403', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'GET', '/v1/canaux/c1/messages', undefined, { Origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const p = await call(env, 'OPTIONS', '/v1/canaux/c1/messages', undefined, { Origin: 'https://evil.example' });
    expect(p.status).toBe(403);
  });

  it('OPTIONS : 204 avec les en-têtes de pré-vérification', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'OPTIONS', '/v1/canaux/c1/messages', undefined, { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });

  it('sans en-tête Origin (serveur à serveur) : autorisé', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'GET', '/v1/canaux/c1/messages');
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('les erreurs portent aussi l’en-tête CORS', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'GET', '/v1/inconnu', undefined, { Origin: ORIGIN });
    expect(r.status).toBe(404);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});
