import { createWorker } from './worker.ts';

// Point d'entrée du Worker Cloudflare (relay/wrangler.toml) : un seul gestionnaire par isolat.
export default createWorker();
