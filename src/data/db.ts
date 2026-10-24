import Dexie, { type Table, type Transaction } from 'dexie';
import type { CountLine, CountSnapshot, Product, ProductFields, Section, Service, Settings, Task } from '../domain/types';
import { overflow, takeSnapshot, visibleHistory } from '../domain/history';
import { BASE_SECTIONS, BASE_TASKS, LEGACY_BASE_TASKS, isDoneToday, nextOrder, orderAt, sectionNeighbour, serviceTasks, visibleSections, visibleTasks } from '../domain/tasks';
import { officialRef, type Contribution } from '../domain/sharing';
import { productIdMap, remapIdList, remapOp, remapProductIds, type IdMap } from '../domain/productId';
import { withoutClock, type Clocked, type Op } from '../sync/merge';
import { withoutUserCode } from '../domain/matching';
import { currentTabac, DEFAULT_TABAC_NAME, dbNameFor, ensureRegistry, listTabacs, syncRegistryName } from '../tabacs/registry';
// Import circulaire voulu avec sharedRepo.ts : chacun n'utilise l'autre que dans des fonctions (voir sharedRepo.ts).
import { writeShared } from './sharedRepo';

export type OutboxItem = Contribution & { id?: number; createdAt: number };

export type OpOut = { seq?: number; op: Op };
/** Opération reçue pour un produit inconnu ici (liste plus récente ailleurs), gardée pour plus tard ; `at` : reçue le. */
export type ParkedOp = { seq?: number; op: Op; at: number };
export type SyncStateRow = { key: string; value: unknown };

type SettingsRow = Settings & { key: 'main' };

/** Demande au moteur de synchronisation de rejoindre le canal à sa prochaine synchronisation (voir engine.ts). */
export const REJOIN_ASKED = 'rejoindre';

/** Base déjà synchronisée : le moteur rejoindra le canal (opérations qu'une version précédente a ignorées). */
async function askRejoin(tx: Transaction): Promise<void> {
  if ((await tx.table('syncState').get('lastN')) !== undefined) await tx.table('syncState').put({ key: REJOIN_ASKED, value: true });
}

export const DEFAULT_SETTINGS: Settings = { shopName: DEFAULT_TABAC_NAME, sortCount: 'name' };

export class CarotteDB extends Dexie {
  // Enregistrements partagés : `_clock` garde l'horodatage HLC de chaque champ partagé (voir sharedRepo.ts).
  products!: Table<Clocked<Product>, string>;
  countLines!: Table<Clocked<CountLine>, string>;
  settings!: Table<Clocked<SettingsRow>, string>;
  outbox!: Table<OutboxItem, number>;
  opsOut!: Table<OpOut, number>;
  syncState!: Table<SyncStateRow, string>;
  parkedOps!: Table<ParkedOp, number>;
  tasks!: Table<Clocked<Task>, string>;
  sections!: Table<Clocked<Section>, string>;
  countHistory!: Table<Clocked<CountSnapshot>, string>;
  constructor(name = 'la-carotte') {
    super(name);
    this.version(1).stores({
      products: 'id, douaneRef, source, updatedAt',
      countLines: 'id, gameId, updatedAt',
      settings: 'key',
    });
    // v2 : « quantity » devient linéaire + stock.
    this.version(2).stores({}).upgrade((tx) =>
      tx.table('countLines').toCollection().modify((l: Record<string, unknown>) => {
        if ('quantity' in l) {
          l.linearQty = l.quantity;
          l.stockQty = 0;
          delete l.quantity;
        }
      }),
    );
    // v3 : file d'attente des codes à partager.
    this.version(3).stores({ outbox: '++id, createdAt' });
    // v4 : opérations à envoyer et état de la synchronisation entre téléphones.
    this.version(4).stores({ opsOut: '++seq', syncState: 'key' });
    // v5 : ids stables des fiches officielles (R20), et tout ce qui les désigne. Ne doit jamais empêcher l'ouverture.
    this.version(5).stores({}).upgrade(async (tx) => {
      try {
        const map = await normalizeProductIds({
          products: tx.table('products'), countLines: tx.table('countLines'), settings: tx.table('settings'), opsOut: tx.table('opsOut'),
        });
        tx.on('complete', () => remapRecent(map));
      } catch (e) {
        console.error('Ids stables des produits : migration non faite', e);
      }
    });
    // v6 : opérations reçues pour des produits encore inconnus ici, rejouées après chaque mise à jour des listes.
    this.version(6).stores({ parkedOps: '++seq, at' });
    // v7 : liste « À faire ». Une version précédente de l'app ignorait les opérations des tâches : ce téléphone rejoint
    // de nouveau le canal (photographie puis messages qui la suivent) pour récupérer celles déjà créées ailleurs.
    this.version(7).stores({ tasks: 'id' }).upgrade(askRejoin);
    // v8 : titres de la liste « À faire » (Matin, Après-midi, ajoutés). La version d'avant les ignorait : on rejoint.
    this.version(8).stores({ sections: 'id' }).upgrade(askRejoin);
    // v9 : historique des comptages du grattage (« Fin comptage »), ignoré par la version d'avant : on rejoint.
    this.version(9).stores({ countHistory: 'id, at' }).upgrade(askRejoin);
  }
}

export type IdTables = {
  products: Table<Clocked<Product>, string>;
  countLines: Table<Clocked<CountLine>, string>;
  settings: Table<Clocked<SettingsRow>, string>;
  opsOut: Table<OpOut, number>;
  /** Absente pendant la migration v5 (la table naît en v6). */
  parkedOps?: Table<ParkedOp, number>;
};

/**
 * Passe chaque fiche à son id stable (`stableProductId`) et réécrit tout ce qui la désigne : remplaçants, lignes de
 * comptage, jeux enlevés, opérations en file. Horodatages gardés, aucune opération produite : chaque téléphone fait
 * la même chose de son côté. Les opérations en attente (`parkedOps`) sont réécrites avec la même table des ids.
 * À appeler dans une transaction qui inclut ces tables ; renvoie la table des ids,
 * à passer à `remapRecent` une fois la transaction validée (la liste des récents n'est pas dans la base).
 *
 * Toutes les écritures passent avant tout effacement : si l'une échoue (et que l'appelant rattrape l'erreur), le pire
 * est un doublon (ancien id + nouvel id), que la prochaine normalisation fusionne ; jamais une donnée perdue.
 * Relancée, elle ne fait rien (les ids sont déjà stables).
 */
export async function normalizeProductIds(t: IdTables): Promise<IdMap> {
  const products = await t.products.toArray();
  const map = productIdMap(products);
  if (map.size === 0) return map;
  const [lines, settings, ops] = await Promise.all([t.countLines.toArray(), t.settings.get('main'), t.opsOut.toArray()]);
  const c = remapProductIds({ products, lines, hiddenGames: settings?.hiddenGames, ops }, map);
  await t.products.bulkPut(c.productPut);
  await t.countLines.bulkPut(c.linePut);
  if (settings && c.hiddenChanged) await t.settings.put({ ...settings, hiddenGames: c.hiddenGames });
  if (c.ops.length) await t.opsOut.bulkPut(c.ops);
  if (t.parkedOps) await remapParkedOps(t.parkedOps, map);
  await t.products.bulkDelete(c.productDel);
  await t.countLines.bulkDelete(c.lineDel);
  if (c.opDel.length) await t.opsOut.bulkDelete(c.opDel);
  return map;
}

/** Réécrit les opérations en attente avec une table des ids (produit visé, remplaçants, lignes de jeu, jeux enlevés). */
export async function remapParkedOps(table: Table<ParkedOp, number>, map: IdMap): Promise<void> {
  if (map.size === 0) return;
  const changed: ParkedOp[] = [];
  for (const row of await table.toArray()) {
    const op = remapOp(row.op, map);
    if (op !== row.op) changed.push({ ...row, op });
  }
  if (changed.length) await table.bulkPut(changed);
}

/** Produits consultés récemment (sur ce téléphone). */
export const RECENT_KEY = 'carotte:recent';

/** Liste des produits récents (localStorage) réécrite avec les nouveaux ids : seulement après la transaction validée. */
export function remapRecent(map: IdMap) {
  if (map.size === 0) return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : undefined;
    if (Array.isArray(ids) && ids.some((id) => map.has(id))) localStorage.setItem(RECENT_KEY, JSON.stringify(remapIdList(ids, map)));
  } catch {
    /* stockage indisponible : les ids inconnus sont ignorés à la lecture */
  }
}

/** Ouvre la base d'un tabac (« la-carotte » pour `principal`, sinon « la-carotte-<id> »). */
export const openTabacDb = (id: string): CarotteDB => new CarotteDB(dbNameFor(id));

// Ce module est évalué avant main.tsx : le registre doit exister avant d'ouvrir la base.
// Changer de tabac recharge la page, donc `db` reste constant pour la durée de la page.
ensureRegistry(DEFAULT_TABAC_NAME);
/** Tabac dont cette page a ouvert la base (un autre onglet peut changer le tabac courant du registre). */
export const dbTabacId = currentTabac().id;
export const db = openTabacDb(dbTabacId);

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main');
  if (!row) return { ...DEFAULT_SETTINGS };
  const { key: _key, _clock: _c, ...s } = row;
  return { ...DEFAULT_SETTINGS, ...s };
}

/** Réglages : `shopName`, `sortCount`, `hiddenGames` sont partagés ; le reste reste sur ce téléphone. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = await db.transaction('rw', db.settings, db.opsOut, db.syncState, async () => {
    const merged = { ...(await getSettings()), ...patch };
    await writeShared('settings', 'main', merged);
    return merged;
  });
  if (patch.shopName !== undefined) syncRegistryName(dbTabacId, next.shopName);
  return next;
}

/** Jeux enlevés de la liste : lus dans la transaction, jamais reconstruits depuis une copie de l'écran (R21). */
async function updateHiddenGames(fn: (ids: string[]) => string[]): Promise<Settings> {
  return db.transaction('rw', db.settings, db.opsOut, db.syncState, async () => {
    const current = await getSettings();
    const before = current.hiddenGames ?? [];
    const after = fn(before);
    if (after.length === before.length && after.every((g, i) => g === before[i])) return current;
    return saveSettings({ hiddenGames: after });
  });
}

export const hideGame = (gameId: string) => updateHiddenGames((ids) => (ids.includes(gameId) ? ids : [...ids, gameId]));
export const unhideGame = (gameId: string) => updateHiddenGames((ids) => ids.filter((g) => g !== gameId));

/**
 * Au démarrage : le nom du tabac dans le registre suit `settings.shopName`. Dans une base neuve (tabac créé ou
 * rejoint), il n'y a pas encore de réglages : on y écrit le nom du registre, sans horloge, pour que les
 * réglages venus des autres téléphones l'emportent ensuite.
 */
export async function syncSettingsNameAtStartup(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('main');
    if (row) {
      syncRegistryName(dbTabacId, row.shopName);
      return;
    }
    const entry = listTabacs().find((t) => t.id === dbTabacId);
    if (entry) await db.settings.put({ ...DEFAULT_SETTINGS, shopName: entry.name, key: 'main' });
  });
}

export const listProducts = () => db.products.toArray();
export const getProduct = (id: string) => db.products.get(id);

/** `base` : la fiche dont le formulaire est parti (R21) ; seuls les champs changés depuis sont écrits. */
export async function putProduct(p: Product, base?: Product): Promise<Product> {
  const next = { ...withoutClock<Product>(p), updatedAt: Date.now() };
  return writeShared('product', next.id, next, base && withoutClock<Product>(base));
}

async function update(id: string, fn: (p: Product) => Product): Promise<Product> {
  return db.transaction('rw', db.products, db.opsOut, db.syncState, async () => {
    const p = await db.products.get(id);
    if (!p) throw new Error(`Produit introuvable : ${id}`);
    return putProduct(fn(withoutClock<Product>(p)));
  });
}

export const patchUserFields = (id: string, patch: Partial<ProductFields>) =>
  update(id, (p) => ({ ...p, user: { ...p.user, ...patch } }));

/**
 * Retire un code-barres ou un préfixe de jeu ajouté ici (couche user, partagée dans le tabac). Sa contribution à la liste
 * commune, si elle n'est pas encore partie, est effacée de la file d'envoi (R3) ; une contribution déjà envoyée reste.
 */
export const removeUserCode = (id: string, code: string) =>
  db.transaction('rw', db.products, db.opsOut, db.syncState, db.outbox, async () => {
    const after = await update(id, (p) => ({ ...p, user: withoutUserCode(p.user, code) }));
    const ref = officialRef(after);
    if (ref) {
      const stale = (await db.outbox.toArray()).filter((i) => i.ref === ref && (i.kind === 'barcode' ? i.code === code : i.prefix === code));
      if (stale.length) await db.outbox.bulkDelete(stale.map((i) => i.id!));
    }
    return after;
  });

export const clearUserField = (id: string, key: keyof ProductFields) =>
  update(id, (p) => {
    const user = { ...p.user };
    delete user[key];
    return { ...p, user };
  });

export const setOutOfStock = (id: string, v: boolean) => update(id, (p) => ({ ...p, outOfStock: v }));
export const setPinned = (id: string, ids: string[]) => update(id, (p) => ({ ...p, pinnedSubstitutes: ids }));

/** Lignes visibles : une ligne supprimée (`deleted: true`) est gardée comme pierre tombale, mais n'apparaît plus. */
export const listCountLines = async (): Promise<CountLine[]> =>
  (await db.countLines.toArray()).filter((l) => l.deleted !== true).map((l) => withoutClock<CountLine>(l));

/** `base` : la ligne dont le pavé ou le formulaire est parti (R21) ; seuls les champs changés depuis sont écrits. */
export async function upsertCountLine(line: CountLine, base?: CountLine): Promise<CountLine> {
  const next = { ...withoutClock<CountLine>(line), updatedAt: Date.now(), deleted: false };
  return writeShared('line', next.id, next, base && { ...withoutClock<CountLine>(base), deleted: false });
}

/** Marque la ligne supprimée (partagé) et la renvoie telle qu'elle était, pour l'annulation. */
export async function deleteCountLine(id: string): Promise<CountLine> {
  return db.transaction('rw', db.countLines, db.opsOut, db.syncState, async () => {
    const stored = await db.countLines.get(id);
    if (!stored || stored.deleted === true) throw new Error(`Ligne introuvable : ${id}`);
    const line = withoutClock<CountLine>(stored);
    await writeShared('line', id, { ...line, deleted: true });
    return line;
  });
}

/**
 * Lignes « jamais comptées » des jeux du catalogue : une ligne neuve est ajoutée telle quelle, sans opération
 * (chaque téléphone les déduit de son catalogue). Une ligne supprimée du même id revient (`deleted: false`,
 * partagé) : `missingGameLines` ne la propose que si le jeu n'est pas enlevé de la liste.
 */
export async function addCountLines(lines: CountLine[]): Promise<void> {
  await db.transaction('rw', db.countLines, db.opsOut, db.syncState, async () => {
    for (const l of lines) {
      const current = await db.countLines.get(l.id);
      if (!current) await db.countLines.put(l);
      else if (current.deleted === true) await writeShared('line', l.id, { ...l, deleted: false });
    }
  });
}

/**
 * Remise à zéro du comptage (partagée) : chaque ligne comptée repasse à 0 / 0, « jamais comptée » (updatedAt 0). Les
 * lignes restent dans la liste. Renvoie les lignes telles qu'elles étaient, pour « Annuler » (restoreCountLine).
 */
export async function resetCountLines(): Promise<CountLine[]> {
  return db.transaction('rw', db.countLines, db.opsOut, db.syncState, async () => {
    const counted = (await db.countLines.toArray()).filter((l) => l.deleted !== true && (l.linearQty !== 0 || l.stockQty !== 0 || l.updatedAt !== 0));
    const previous = counted.map((l) => withoutClock<CountLine>(l));
    for (const l of previous) await writeShared('line', l.id, { ...l, linearQty: 0, stockQty: 0, updatedAt: 0 });
    return previous;
  });
}

/** Remet une ligne supprimée telle quelle (garde sa date de modification). */
export async function restoreCountLine(line: CountLine): Promise<CountLine> {
  return writeShared('line', line.id, { ...withoutClock<CountLine>(line), deleted: false });
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- liste « À faire »

const TASKS_SEEDED = 'tasksSeeded';
const SECTIONS_SEEDED = 'sectionsSeeded';
const taskTx = <T>(fn: () => Promise<T>) => db.transaction('rw', db.tasks, db.opsOut, db.syncState, fn);

/** Tâches visibles (une tâche supprimée reste comme pierre tombale pour la synchronisation). */
export const listTasks = async (): Promise<Task[]> =>
  (await db.tasks.toArray()).filter((t) => t.deleted !== true).map((t) => withoutClock<Task>(t));

/** Version de la liste de base créée sur ce téléphone (`true` : la première, 6 le matin et 3 l'après-midi). */
const SEED_VERSION = 2;

/**
 * Liste de base, une fois par tabac et par téléphone : ajoutée telle quelle, sans opération (chaque téléphone la crée
 * de son côté, avec les mêmes ids). Une tâche de base déjà connue (supprimée comprise) n'est jamais remplacée.
 * Téléphone qui avait la première liste : ses tâches de base dont le texte et le service n'ont pas été changés sont
 * supprimées (partagé : les autres téléphones les perdent aussi, sans qu'elles reviennent) ; les tâches ajoutées ou
 * renommées restent.
 */
export async function seedTasks(): Promise<void> {
  await db.transaction('rw', [db.tasks, db.sections, db.opsOut, db.syncState], async () => {
    // Titres de départ, une seule fois (un titre de départ supprimé ne revient pas).
    if ((await db.syncState.get(SECTIONS_SEEDED)) === undefined) {
      for (const s of BASE_SECTIONS) if (!(await db.sections.get(s.id))) await db.sections.put({ ...s });
      await db.syncState.put({ key: SECTIONS_SEEDED, value: true });
    }
    const seeded = (await db.syncState.get(TASKS_SEEDED))?.value;
    if (seeded === SEED_VERSION) return;
    if (seeded === true) {
      for (const old of LEGACY_BASE_TASKS) {
        const t = await db.tasks.get(old.id);
        if (t && t.deleted !== true && t.label === old.label && t.service === old.service) {
          await writeShared<Task>('task', old.id, { ...withoutClock<Task>(t), deleted: true });
        }
      }
    }
    for (const t of BASE_TASKS) if (!(await db.tasks.get(t.id))) await db.tasks.put({ ...t });
    await db.syncState.put({ key: TASKS_SEEDED, value: SEED_VERSION });
  });
}

async function storedTask(id: string): Promise<Task> {
  const t = await db.tasks.get(id);
  if (!t || t.deleted === true) throw new Error(`Tâche introuvable : ${id}`);
  return withoutClock<Task>(t);
}

/** Nouvelle tâche, en fin de service. */
export const addTask = (label: string, service: Service): Promise<Task> =>
  taskTx(async () => {
    const order = nextOrder(serviceTasks(await listTasks(), service));
    const id = newId();
    return writeShared<Task>('task', id, { id, label: label.trim(), service, order, doneAt: 0 });
  });

/** Texte et service (un changement de service place la tâche en fin du nouveau service). */
export const updateTask = (id: string, patch: { label: string; service: Service }): Promise<Task> =>
  taskTx(async () => {
    const t = await storedTask(id);
    const order = patch.service === t.service ? t.order : nextOrder(serviceTasks(await listTasks(), patch.service));
    return writeShared<Task>('task', id, { ...t, label: patch.label.trim(), service: patch.service, order });
  });

/** Cocher (heure de maintenant) ou décocher (0). */
export const setTaskDone = (id: string, done: boolean, now = Date.now()): Promise<Task> =>
  taskTx(async () => writeShared<Task>('task', id, { ...(await storedTask(id)), doneAt: done ? now : 0 }));

/** Supprime (partagé) et renvoie la tâche telle qu'elle était, pour « Annuler ». */
export const deleteTask = (id: string): Promise<Task> =>
  taskTx(async () => {
    const t = await storedTask(id);
    await writeShared<Task>('task', id, { ...t, deleted: true });
    return t;
  });

/** Remet une tâche telle qu'elle était (annulation d'une suppression ou d'une remise à zéro). */
export const restoreTask = (t: Task): Promise<Task> => taskTx(() => writeShared<Task>('task', t.id, { ...withoutClock<Task>(t), deleted: false }));

/** Décoche les tâches faites aujourd'hui (titres visibles) ; renvoie-les telles qu'elles étaient, pour « Annuler ». */
export const resetTasks = (now = Date.now()): Promise<Task[]> =>
  db.transaction('rw', [db.tasks, db.sections, db.opsOut, db.syncState], async () => {
    const done = visibleTasks(await listTasks(), await listSections()).filter((t) => isDoneToday(t, now));
    for (const t of done) await writeShared<Task>('task', t.id, { ...t, doneAt: 0 });
    return done;
  });

/** Place la tâche à l'index `toIndex` de son service (n'écrit que la tâche déplacée, sauf renumérotation). */
export const moveTask = (id: string, toIndex: number): Promise<void> =>
  taskTx(async () => {
    const t = await storedTask(id);
    const list = serviceTasks(await listTasks(), t.service);
    const r = orderAt(list, id, toIndex);
    if ('order' in r) {
      if (r.order !== t.order) await writeShared<Task>('task', id, { ...t, order: r.order });
      return;
    }
    for (const { id: other, order } of r.renumber) {
      const o = list.find((x) => x.id === other)!;
      if (o.order !== order) await writeShared<Task>('task', other, { ...o, order });
    }
  });

// ---------------------------------------------------------------- titres de la liste « À faire »

const sectionTx = <T>(fn: () => Promise<T>) => db.transaction('rw', [db.sections, db.tasks, db.opsOut, db.syncState], fn);

/** Titres visibles, dans l'ordre. */
export const listSections = async (): Promise<Section[]> => visibleSections((await db.sections.toArray()).map((s) => withoutClock<Section>(s)));

const cleanLabel = (label: string) => label.trim().slice(0, 40);

async function storedSection(id: string): Promise<Section> {
  const s = await db.sections.get(id);
  if (!s || s.deleted === true) throw new Error(`Titre introuvable : ${id}`);
  return withoutClock<Section>(s);
}

/** Nouveau titre, vide, en bas. */
export const addSection = (label: string): Promise<Section> =>
  sectionTx(async () => {
    const id = newId();
    return writeShared<Section>('section', id, { id, label: cleanLabel(label), order: nextOrder(await listSections()) });
  });

export const renameSection = (id: string, label: string): Promise<Section> =>
  sectionTx(async () => writeShared<Section>('section', id, { ...(await storedSection(id)), label: cleanLabel(label) }));

/** Monter (-1) ou descendre (1) : échange de rang avec le titre voisin (rien au bord). */
export const moveSection = (id: string, dir: -1 | 1): Promise<void> =>
  sectionTx(async () => {
    const s = await storedSection(id);
    const other = sectionNeighbour(await listSections(), id, dir);
    if (!other) return;
    // Rangs égaux (titres créés en même temps sur deux téléphones) : on les écarte d'un rang.
    const [a, b] = other.order === s.order ? [s.order + dir, s.order] : [other.order, s.order];
    await writeShared<Section>('section', id, { ...s, order: a });
    await writeShared<Section>('section', other.id, { ...other, order: b });
  });

/** Supprime le titre et ses tâches (partagé) ; renvoie-les tels qu'ils étaient, pour « Annuler ». */
export const deleteSection = (id: string): Promise<{ section: Section; tasks: Task[] }> =>
  sectionTx(async () => {
    const section = await storedSection(id);
    const tasks = (await listTasks()).filter((t) => t.service === id);
    for (const t of tasks) await writeShared<Task>('task', t.id, { ...t, deleted: true });
    await writeShared<Section>('section', id, { ...section, deleted: true });
    return { section, tasks };
  });

/** Annule une suppression : le titre et ses tâches reviennent tels qu'ils étaient. */
export const restoreSection = (section: Section, tasks: Task[]): Promise<void> =>
  sectionTx(async () => {
    await writeShared<Section>('section', section.id, { ...withoutClock<Section>(section), deleted: false });
    for (const t of tasks) await writeShared<Task>('task', t.id, { ...withoutClock<Task>(t), deleted: false });
  });

// ---------------------------------------------------------------- historique du grattage

const historyTx = <T>(fn: () => Promise<T>) => db.transaction('rw', [db.countHistory, db.countLines, db.opsOut, db.syncState], fn);

/** Comptages enregistrés, les plus récents d'abord (8 au plus). */
export const listHistory = async (): Promise<CountSnapshot[]> => visibleHistory((await db.countHistory.toArray()).map((s) => withoutClock<CountSnapshot>(s)));

/**
 * « Fin comptage » : enregistre le tableau tel qu'il est (partagé). Au-delà de 8 comptages, les plus anciens sont
 * supprimés ; ils sont renvoyés avec le nouveau, pour « Annuler ».
 */
export const saveSnapshot = (at = Date.now()): Promise<{ snapshot: CountSnapshot; pruned: CountSnapshot[] }> =>
  historyTx(async () => {
    const snapshot = takeSnapshot(await listCountLines(), at, newId());
    await writeShared<CountSnapshot>('snapshot', snapshot.id, snapshot);
    const all = (await db.countHistory.toArray()).map((s) => withoutClock<CountSnapshot>(s));
    const pruned = overflow(all);
    for (const s of pruned) await writeShared<CountSnapshot>('snapshot', s.id, { ...s, deleted: true });
    return { snapshot, pruned };
  });

/** Supprime un comptage de l'historique (partagé) et le renvoie, pour « Annuler ». */
export const deleteSnapshot = (id: string): Promise<CountSnapshot> =>
  historyTx(async () => {
    const s = await db.countHistory.get(id);
    if (!s || s.deleted === true) throw new Error(`Comptage introuvable : ${id}`);
    const before = withoutClock<CountSnapshot>(s);
    await writeShared<CountSnapshot>('snapshot', id, { ...before, deleted: true });
    return before;
  });

/** Remet des comptages tels qu'ils étaient (ou les retire : `deleted: true`), pour « Annuler ». */
export const putSnapshots = (list: CountSnapshot[]): Promise<void> =>
  historyTx(async () => {
    for (const s of list) await writeShared<CountSnapshot>('snapshot', s.id, { ...withoutClock<CountSnapshot>(s), deleted: s.deleted === true });
  });
