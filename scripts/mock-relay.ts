// Faux relais local pour les tests de bout en bout : même interface que le Worker, données en mémoire.
// Lancement : node scripts/mock-relay.ts  (port 8787, ou PORT=…). MOCK_GITHUB=1 accepte /v1/codes et
// affiche l'issue au lieu de l'envoyer à GitHub ; sinon /v1/codes répond 503.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../relay/src/handlers.ts';
import type { RelayEnv } from '../relay/src/handlers.ts';
import { createMemoryStore } from '../relay/src/memoryStore.ts';

const port = Number(process.env.PORT ?? 8787);
const mockGithub = process.env.MOCK_GITHUB === '1';

const env: RelayEnv = {
  store: createMemoryStore(),
  githubToken: mockGithub ? 'faux-jeton' : undefined,
  githubRepo: 'exemple/Buraliste',
  now: () => Date.now(),
  fetch: async (_url, init) => {
    console.log('[faux relais] issue GitHub (non envoyée) :', init?.body);
    return new Response('{}', { status: 201 });
  },
  allowedOrigins: ['http://localhost:4173'],
  // Toutes les requêtes des tests viennent de la même adresse : limites par IP et plafond global relevés.
  limits: { requetesParCanalMinute: 100_000, ecrituresParIpMinute: 100_000, canauxParIpHeure: 100_000, codesParIpHeure: 100_000, issuesParHeure: 100_000 },
};

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://localhost:${port}${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  try {
    await send(await handle(await toRequest(req), env), res);
  } catch (e) {
    console.error('[faux relais]', e);
    res.writeHead(500).end();
  }
}).listen(port, () => {
  console.log(`[faux relais] http://localhost:${port} (origine autorisée : http://localhost:4173)`);
});
