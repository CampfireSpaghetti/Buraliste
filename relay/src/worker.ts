import { handle, housekeeping } from './handlers.ts';
import type { Store } from './handlers.ts';
import { createD1Store } from './d1Store.ts';
import type { D1Database } from './d1Store.ts';

/** Liaisons du Worker (relay/wrangler.toml et secret GITHUB_TOKEN). */
export type WorkerEnv = {
  DB: D1Database;
  GITHUB_TOKEN?: string;
  /** Origines autorisées, séparées par des virgules (données par le workflow : l'adresse de l'app publiée). */
  ALLOWED_ORIGINS?: string;
  /** Projet GitHub qui reçoit les codes-barres (« compte/projet », donné par le workflow). */
  GITHUB_REPO?: string;
};

/** Sans origine donnée, aucune page web n'est acceptée. */
function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
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
        githubRepo: env.GITHUB_REPO?.trim() ?? '',
        now: () => Date.now(),
        // fetch appelé sans `this` (sinon « Illegal invocation » dans le Worker).
        fetch: (input, init) => fetch(input, init),
        allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
      });
    },
    /** Tâche planifiée (relay/wrangler.toml, chaque jour) : ménage des tabacs abandonnés et des vieux messages. */
    scheduled(_event: unknown, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }): void {
      store ??= createD1Store(env.DB);
      ctx.waitUntil(housekeeping(store, Date.now()).then((r) => console.log(`Ménage du relais : ${r.canaux} tabac(s) abandonné(s) supprimé(s).`)));
    },
  };
}
