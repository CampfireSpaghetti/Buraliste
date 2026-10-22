// Téléchargement d'une page pour les robots FDJ : délai d'attente (une page qui ne répond pas ne bloque pas le
// passage hebdomadaire) et un nouvel essai après un échec réseau, un délai dépassé ou une erreur serveur.
type Options = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fetchFn?: typeof fetch;
};

/** Erreur définitive (page absente, accès refusé…) : un nouvel essai n'y changerait rien. */
class FinalError extends Error {}

export async function fetchText(url: string, { headers, timeoutMs = 20_000, retries = 1, retryDelayMs = 2_000, fetchFn = fetch }: Options = {}): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const msg = `${url} → HTTP ${res.status}`;
        throw res.status >= 500 || res.status === 429 ? new Error(msg) : new FinalError(msg);
      }
      return await res.text();
    } catch (e) {
      if (e instanceof FinalError || attempt >= retries) throw e;
      console.warn(`${url} : ${e instanceof Error ? e.message : String(e)}, nouvel essai`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}
