/**
 * Horloge logique hybride (HLC) : "<ms 13 chiffres>-<compteur 4 chiffres>-<appareil>".
 * Comparer deux horodatages comme des chaînes respecte l'ordre chronologique.
 *
 * Restauration après redémarrage (tâche 6) : appeler `observe(dernierHorodatageEnregistré)`
 * juste après `createHlc(deviceId)` ; le tick suivant sera strictement supérieur.
 * La persistance (localStorage) et l'identifiant d'appareil ne sont pas gérés ici.
 */

export type Hlc = { tick(): string; observe(t: string): void };

const MAX_COUNTER = 9999;
const PATTERN = /^(\d{13})-(\d{4})-(.+)$/;

const format = (ms: number, counter: number, deviceId: string) =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${deviceId}`;

export function createHlc(deviceId: string, now: () => number = Date.now): Hlc {
  let ms = 0;
  let counter = 0;
  return {
    tick() {
      const wall = Math.floor(now());
      if (wall > ms) {
        ms = wall;
        counter = 0;
      } else if (counter >= MAX_COUNTER) {
        ms += 1;
        counter = 0;
      } else {
        counter += 1;
      }
      return format(ms, counter, deviceId);
    },
    observe(t) {
      const m = typeof t === 'string' ? PATTERN.exec(t) : null;
      if (!m) return;
      const rms = Number(m[1]);
      const rc = Number(m[2]);
      if (rms > ms || (rms === ms && rc > counter)) {
        ms = rms;
        counter = rc;
      }
    },
  };
}
