import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CarotteDB, db, REJOIN_ASKED, addTask, deleteTask, listTasks, moveTask, resetTasks, restoreTask, seedTasks, setTaskDone, updateTask,
} from '../../src/data/db';
import { applyRemoteOps } from '../../src/data/sharedRepo';
import { buildEtat, hasLocalData } from '../../src/sync/snapshot';
import { resetClockForTests } from '../../src/sync/clock';
import { LEGACY_BASE_TASKS, serviceTasks } from '../../src/domain/tasks';

const RELAY = 'https://relais.example.workers.dev';
const hlcAt = (ms: number, c = 0, dev = 'zzzzzzzz') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;
const labels = async (s: 'matin' | 'apres-midi') => serviceTasks(await listTasks(), s).map((t) => t.label);

beforeEach(async () => {
  localStorage.removeItem('carotte:hlc');
  resetClockForTests();
  vi.stubEnv('VITE_RELAY_URL', RELAY);
  await db.delete();
  await db.open();
});
afterEach(() => vi.unstubAllEnvs());

describe('liste « À faire » : base', () => {
  it('liste de base créée une fois, sans opération ; une tâche de base supprimée ne revient pas', async () => {
    await seedTasks();
    expect(await listTasks()).toHaveLength(18);
    expect(await db.opsOut.count()).toBe(0);
    expect(await hasLocalData(db)).toBe(false); // jamais modifiée : rien à publier
    await deleteTask('base:matin-5');
    await seedTasks();
    expect((await listTasks()).map((t) => t.id)).not.toContain('base:matin-5');
    expect(await hasLocalData(db)).toBe(true);
  });
  it('ajout en fin de service ; texte nettoyé ; opération partagée', async () => {
    await seedTasks();
    const t = await addTask('  Sortir les poubelles ', 'apres-midi');
    expect(t.label).toBe('Sortir les poubelles');
    expect((await labels('apres-midi')).at(-1)).toBe('Sortir les poubelles');
    const ops = (await db.opsOut.toArray()).map((r) => r.op);
    expect(ops).toEqual([expect.objectContaining({ e: 'task', id: t.id, f: expect.objectContaining({ label: 'Sortir les poubelles', service: 'apres-midi', doneAt: 0 }) })]);
  });
  it('cocher met l’heure, décocher la retire', async () => {
    await seedTasks();
    expect((await setTaskDone('base:matin-1', true, 1_000)).doneAt).toBe(1_000);
    expect((await setTaskDone('base:matin-1', false)).doneAt).toBe(0);
  });
  it('remise à zéro : seulement les tâches faites aujourd’hui ; « Annuler » rend les heures', async () => {
    await seedTasks();
    const now = new Date(2026, 9, 23, 15).getTime();
    await setTaskDone('base:matin-1', true, new Date(2026, 9, 23, 8).getTime());
    await setTaskDone('base:matin-2', true, new Date(2026, 9, 22, 18).getTime()); // hier : déjà décochée à l'écran
    const before = await resetTasks(now);
    expect(before.map((t) => t.id)).toEqual(['base:matin-1']);
    expect((await listTasks()).find((t) => t.id === 'base:matin-1')!.doneAt).toBe(0);
    for (const t of before) await restoreTask(t);
    expect((await listTasks()).find((t) => t.id === 'base:matin-1')!.doneAt).toBe(new Date(2026, 9, 23, 8).getTime());
  });
  it('supprimer puis annuler', async () => {
    await seedTasks();
    const removed = await deleteTask('base:apres-midi-9');
    expect(await listTasks()).toHaveLength(17);
    await restoreTask(removed);
    expect((await labels('apres-midi')).at(-1)).toBe("Nettoyer l'espace client");
  });
  it('déplacer dans le service ; changer de service met en fin du nouveau service', async () => {
    await seedTasks();
    await moveTask('base:matin-8', 0);
    expect((await labels('matin'))[0]).toBe('Remplir la machine à café');
    await moveTask('base:matin-8', 8);
    expect((await labels('matin')).at(-1)).toBe('Remplir la machine à café');
    await updateTask('base:matin-1', { label: 'Vérifier stock grattage (matin)', service: 'apres-midi' });
    expect((await labels('apres-midi')).at(-1)).toBe('Vérifier stock grattage (matin)');
    expect(await labels('matin')).toHaveLength(8);
  });
});

describe('liste « À faire » : nouvelle liste de base (même liste matin et après-midi)', () => {
  it('téléphone qui avait la première liste : ses tâches de base inchangées sont remplacées (partagé), les autres restent', async () => {
    // Première liste, telle que la version précédente l'a créée : base:1… base:9, sans horodatage ; repère `true`.
    await db.tasks.bulkPut(LEGACY_BASE_TASKS.map((t, i) => ({ ...t, order: i + 1, doneAt: 0 })));
    await db.syncState.put({ key: 'tasksSeeded', value: true });
    await setTaskDone('base:2', true, 7_000); // cochée : elle part quand même (texte inchangé)
    await updateTask('base:5', { label: 'Remplir la vitrine du fond', service: 'matin' }); // renommée : gardée
    await addTask('Arroser', 'matin'); // ajoutée : gardée
    await db.opsOut.clear();
    await seedTasks();
    const ids = (await listTasks()).map((t) => t.id);
    expect(ids.filter((id) => /^base:\d$/.test(id))).toEqual(['base:5']);
    expect(ids.filter((id) => id.startsWith('base:matin-') || id.startsWith('base:apres-midi-'))).toHaveLength(18);
    expect(await labels('matin')).toContain('Arroser');
    const deleted = (await db.opsOut.toArray()).map((r) => r.op);
    expect(deleted).toHaveLength(8);
    expect(deleted.every((op) => op.e === 'task' && op.f.deleted === true && /^base:\d$/.test(op.id))).toBe(true);
    // Une seule fois.
    await seedTasks();
    expect(await db.opsOut.count()).toBe(8);
  });
});

describe('liste « À faire » : synchronisation', () => {
  it('tâche reçue d’un autre téléphone : créée, puis cochée ; valeur de mauvais type ignorée', async () => {
    const now = Date.now();
    await applyRemoteOps([{ e: 'task', id: 't1', f: { label: 'Arroser les plantes', service: 'matin', order: 3, doneAt: 0, deleted: false }, t: hlcAt(now - 2000) }]);
    await applyRemoteOps([{ e: 'task', id: 't1', f: { doneAt: now, service: 'nuit' }, t: hlcAt(now - 1000) }]);
    expect(await listTasks()).toEqual([{ id: 't1', label: 'Arroser les plantes', service: 'matin', order: 3, doneAt: now, deleted: false }]);
  });
  it('la photographie contient les tâches', async () => {
    await seedTasks();
    await setTaskDone('base:matin-2', true, 5_000);
    const etat = await buildEtat(db);
    expect(etat.task.find((r) => r.id === 'base:matin-2')).toMatchObject({ label: 'Vérifier stock cigarettes', doneAt: 5_000 });
  });
  it('mise à niveau v7 d’une base déjà synchronisée : le téléphone rejoindra le canal', async () => {
    for (const [name, synced] of [['la-carotte-v6-synchro', true], ['la-carotte-v6-seule', false]] as const) {
      const old = new Dexie(name);
      old.version(6).stores({
        products: 'id, douaneRef, source, updatedAt', countLines: 'id, gameId, updatedAt', settings: 'key',
        outbox: '++id, createdAt', opsOut: '++seq', syncState: 'key', parkedOps: '++seq, at',
      });
      await old.open();
      if (synced) await old.table('syncState').put({ key: 'lastN', value: 42 });
      old.close();
      const up = new CarotteDB(name);
      await up.open();
      expect((await up.syncState.get(REJOIN_ASKED))?.value).toBe(synced ? true : undefined);
      expect((await up.syncState.get('lastN'))?.value).toBe(synced ? 42 : undefined);
      up.close();
      await up.delete();
    }
  });
});
