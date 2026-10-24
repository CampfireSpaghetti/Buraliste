/**
 * Client du relais (spec §4.1) : JSON en entrée et en sortie. Une réponse hors 2xx lève une `RelayError` qui porte
 * le code HTTP (`status`) ; une panne réseau laisse passer l'erreur de `fetch` (sans `status`).
 */
import type { Contribution } from '../domain/sharing';

export type Sealed = { iv: string; data: string };
export type RelayMessage = Sealed & { n: number };
export type RelayPhoto = Sealed & { jusqua: number };

export class RelayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RelayError';
    this.status = status;
  }
}

export type RelayClient = {
  /** `nouveau` : le canal vient d'être créé par cet envoi (le relais l'avait perdu, ou premier envoi du tabac). */
  post(canal: string, body: { ecriture: string; messages: Sealed[] }): Promise<{ dernier: number; nouveau?: boolean }>;
  list(canal: string, apres: number, max?: number): Promise<{ messages: RelayMessage[]; dernier: number }>;
  putPhoto(canal: string, body: { ecriture: string; jusqua: number } & Sealed): Promise<{ ok: boolean }>;
  /** `null` quand le canal n'a pas de photographie (404). */
  getPhoto(canal: string): Promise<RelayPhoto | null>;
  postCodes(items: Contribution[]): Promise<{ ok: boolean }>;
};

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createRelayClient(base: string, fetchFn: FetchFn = (input, init) => fetch(input, init)): RelayClient {
  const root = base.replace(/\/+$/, '');
  const canalPath = (canal: string, sub: string) => `${root}/v1/canaux/${encodeURIComponent(canal)}/${sub}`;

  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchFn(url, init);
    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { erreur?: unknown };
        if (typeof j?.erreur === 'string') detail = ` : ${j.erreur}`;
      } catch {
        /* corps illisible */
      }
      throw new RelayError(res.status, `Relais : HTTP ${res.status}${detail}`);
    }
    return (await res.json()) as T;
  }

  return {
    post: (canal, body) => call('POST', canalPath(canal, 'messages'), body),
    list: (canal, apres, max = 500) => call('GET', `${canalPath(canal, 'messages')}?apres=${apres}&max=${max}`),
    putPhoto: (canal, body) => call('PUT', canalPath(canal, 'photo'), body),
    async getPhoto(canal) {
      try {
        return await call<RelayPhoto>('GET', canalPath(canal, 'photo'));
      } catch (e) {
        if (e instanceof RelayError && e.status === 404) return null;
        throw e;
      }
    },
    postCodes: (items) => call('POST', `${root}/v1/codes`, { items }),
  };
}
