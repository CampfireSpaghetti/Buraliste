import { handle } from './handlers.ts';
import type { Store } from './handlers.ts';
import { createD1Store } from './d1Store.ts';
import type { D1Database } from './d1Store.ts';

/** Liaisons du Worker (relay/wrangler.toml et secret GITHUB_TOKEN). */
export type WorkerEnv = {
  DB: D1Database;
  GITHUB_TOKEN?: string;
  /** Origines autorisées, séparées par des virgules. */
  ALLOWED_ORIGINS?: string;
};

const GITHUB_REPO = 'wongmichel2048/Buraliste';
const DEFAULT_ORIGINS = ['https://wongmichel2048.github.io'];

function parseOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

/**
 * Crée le gestionnaire du Worker. Le Store est créé une seule fois (à la première requête) et vit autant
 * que l'isolat, avec les compteurs de limites qui lui sont rattachés.
 */
export function createWorker() {
  let store: Store | undefined;
  return {
    fetch(req: Request, env: WorkerEnv): Promise<Response> {
      store ??= createD1Store(env.DB);
      return handle(req, {
        store,
        githubToken: env.GITHUB_TOKEN || undefined,
        githubRepo: GITHUB_REPO,
        now: () => Date.now(),
        // fetch appelé sans `this` (sinon « Illegal invocation » dans le Worker).
        fetch: (input, init) => fetch(input, init),
        allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
      });
    },
  };
}
