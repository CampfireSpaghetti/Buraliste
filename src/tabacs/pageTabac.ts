/**
 * Le tabac de la page (celui dont elle a ouvert la base) : son nom affiché, et le changement de tabac qui laisse
 * d'abord partir les modifications en file.
 */
import { dbTabacId } from '../data/db';
import { syncEngine } from '../sync/engineInstance';
import { DEFAULT_TABAC_NAME, listTabacs, switchTabac } from './registry';

/**
 * Nom du tabac ouvert par la page : celui des réglages (partagé). Dans la base neuve d'un tabac créé ou rejoint, tant
 * que ses réglages ne sont pas écrits (ils valent alors « Mon tabac » par défaut), celui du registre.
 */
export function tabacDisplayName(shopName: string | undefined): string {
  if (shopName && shopName !== DEFAULT_TABAC_NAME) return shopName;
  return listTabacs().find((t) => t.id === dbTabacId)?.name || shopName || '';
}

const SYNC_CAP_MS = 3_000;

/**
 * Change de tabac (rechargement) après une dernière synchronisation du tabac quitté, pour que ses modifications en
 * file partent d'abord. Jamais plus de 3 s d'attente : le changement se fait de toute façon.
 */
export async function switchAfterSync(
  id: string,
  deps: { engine?: { syncNow(): Promise<void> }; go?: (id: string) => void; capMs?: number } = {},
): Promise<void> {
  const engine = 'engine' in deps ? deps.engine : syncEngine();
  if (engine) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      engine.syncNow().catch(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, deps.capMs ?? SYNC_CAP_MS); }),
    ]);
    clearTimeout(timer);
  }
  (deps.go ?? switchTabac)(id);
}
