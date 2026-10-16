/**
 * CSP de l'app : `connect-src 'self'` plus l'origine du relais (VITE_RELAY_URL) quand il est configuré. Les téléphones ne
 * parlent plus à GitHub : le relais est la seule autre destination réseau. `index.html` porte le marqueur
 * `%RELAY_ORIGIN%`, remplacé à la construction.
 */
import type { Plugin } from 'vite';

/**
 * Origine (schéma + hôte + port) de l'adresse du relais, ou undefined si elle est vide. Seuls https:// et
 * http://localhost sont acceptés ; toute autre valeur lève une erreur plutôt que d'être injectée dans la CSP.
 */
export function relayOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const bad = () => new Error(`VITE_RELAY_URL invalide (https:// ou http://localhost attendu, sans espace ni caractère spécial) : ${JSON.stringify(raw)}`);
  // Pas d'espace, de point-virgule, de guillemet ni de joker : rien qui puisse ajouter une directive à la CSP.
  if (!/^[A-Za-z0-9:/._~-]+$/.test(raw)) throw bad();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad();
  }
  const secure = url.protocol === 'https:';
  const local = url.protocol === 'http:' && url.hostname === 'localhost';
  if ((!secure && !local) || url.username || url.password || !url.hostname) throw bad();
  return url.origin;
}

export function injectRelayOrigin(html: string, origin: string | undefined): string {
  return html.replace(/ ?%RELAY_ORIGIN%/g, origin ? ` ${origin}` : '');
}

/** `getUrl` : la valeur de VITE_RELAY_URL (lue à chaque page, pour que le fichier .env et l'environnement comptent). */
export function relayCspPlugin(getUrl: () => string | undefined): Plugin {
  return {
    name: 'la-carotte-relay-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => injectRelayOrigin(html, relayOrigin(getUrl())),
    },
  };
}
