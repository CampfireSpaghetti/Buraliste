import Dexie from 'dexie';

/**
 * Anciennes adresses de l'app, rangées par empreinte (FNV-1a du nom d'hôte) pour ne pas écrire l'ancien nom en clair.
 * Le compte GitHub qui héberge l'app a changé de nom : l'ancienne adresse peut être reprise par quelqu'un d'autre, qui
 * lirait alors ce que les téléphones y ont gardé (clés des tabacs comprises). Ouverte une dernière fois, l'app y efface tout.
 */
const RETIRED_HOSTS = new Set([0xeff49aa3]);

export function hostHash(host: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) h = Math.imul(h ^ host.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export const isRetiredHost = (host: string, retired: ReadonlySet<number> = RETIRED_HOSTS): boolean => retired.has(hostHash(host));

/** Efface tout ce que l'app a gardé à cette adresse : bases, préférences, fichiers en cache, service worker. */
export async function wipeEverything(): Promise<void> {
  const steps: Promise<unknown>[] = [];
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage bloqué : rien à effacer */ }
  steps.push(Dexie.getDatabaseNames().then((names) => Promise.all(names.map((n) => Dexie.delete(n)))));
  if ('caches' in self) steps.push(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  if ('serviceWorker' in navigator) steps.push(navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))));
  const res = await Promise.allSettled(steps);
  const failed = res.find((r) => r.status === 'rejected');
  if (failed) throw (failed as PromiseRejectedResult).reason;
}

/** Écran de l'ancienne adresse (sans React ni styles de l'app : rien d'autre n'est chargé ici). */
export async function retire(root: HTMLElement): Promise<void> {
  const box = document.createElement('main');
  Object.assign(box.style, { maxWidth: '28rem', margin: '15vh auto 0', padding: '0 16px', font: '17px/1.45 system-ui, sans-serif', color: '#1d2230' });
  const title = document.createElement('h1');
  title.textContent = "La Carotte a changé d'adresse";
  Object.assign(title.style, { fontSize: '24px', margin: '0 0 12px', color: '#8e1b1f' });
  const text = document.createElement('p');
  text.textContent = 'Effacement des données de ce téléphone…';
  box.append(title, text);
  root.replaceChildren(box);
  try {
    await wipeEverything();
    text.textContent = "Les données de l'app ont été effacées de ce téléphone. Vous pouvez supprimer cette icône de l'écran d'accueil, puis demander la nouvelle adresse à votre gérant.";
  } catch (e) {
    console.error('Effacement incomplet', e);
    text.textContent = "L'effacement n'a pas pu se terminer. Fermez l'app, rouvrez-la pour réessayer, ou effacez les données du site dans les réglages du navigateur.";
  }
}
