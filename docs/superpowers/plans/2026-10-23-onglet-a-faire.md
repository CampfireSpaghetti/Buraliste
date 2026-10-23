# Onglet « À faire » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un onglet « À faire » (entre Catalogue et Grattage) : tâches du matin et de l'après-midi, cochées avec l'heure, partagées entre les téléphones du tabac, rangées à la poignée, remises à zéro chaque jour ou au bouton, exportées en .jpg.

**Architecture:** Nouvelle entité partagée `task` (table Dexie `tasks`, base v7) écrite par `writeShared` comme les lignes de comptage ; logique pure dans `src/domain/tasks.ts` ; écran dans `src/features/tasks/`. « Faite » = `doneAt` du jour : la remise à zéro quotidienne n'écrit rien.

**Tech Stack:** React 19, Dexie 4, Vitest + fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-onglet-a-faire-design.md`

## Global Constraints

- Textes en français, phrases courtes ; libellés exacts : onglet « À faire », services « Matin » / « Après-midi », boutons « + Tâche », « Export .jpg », « Remettre à zéro », « Annuler ».
- Liste de base, ids `base:1`…`base:9`, dans l'ordre : matin 1–6 = Vérifier stock grattage, Vérifier stock cigarettes, Vérifier stock tabletterie, Remplir le linéaire, Remplir la vitrine, Remplir la machine à café ; après-midi 7–9 = Vérifier stock grattage, Nettoyer l'espace de travail, Nettoyer l'espace client.
- Clés partagées `task` : `label`, `service`, `order`, `doneAt`, `deleted`. `doneAt` = 0 pour « pas faite » (jamais `null`).
- Cibles tactiles ≥ 48 px ; contrastes AA clair et sombre ; animations coupées si « réduire les animations ».
- Aucune dépendance ajoutée.

## Review Focus

- Tâche cochée hier soir, téléphone rouvert ce matin → elle apparaît décochée, sans heure (test domaine `isDoneToday` + e2e avec horloge avancée).
- Deux téléphones cochent deux tâches différentes en même temps → les deux restent cochées (test e2e deux téléphones).
- Tâche de base supprimée, app rouverte → elle ne revient pas (test base `seedTasks`).
- Texte vide ou fait d'espaces → « Enregistrer » / « Ajouter » désactivé (test e2e ajout).
- Déplacements répétés au même endroit → l'ordre reste juste (renumérotation, test domaine `orderAt`).

---

### Task 1: Domaine des tâches

**Files:**
- Create: `src/domain/tasks.ts`
- Modify: `src/domain/types.ts` (type `Task`, `Service`)
- Test: `tests/unit/tasks.test.ts`

**Interfaces:**
- Produces: `type Service = 'matin' | 'apres-midi'` ; `interface Task { id; label; service; order; doneAt; deleted? }` ; `SERVICES: { id: Service; label: string }[]` ; `BASE_TASKS: Task[]` ; `isDoneToday(t: Task, now: number): boolean` ; `serviceTasks(tasks: Task[], s: Service): Task[]` (non supprimées, triées par `order` puis `id`) ; `orderAt(list: Task[], movedId: string, toIndex: number): { order: number } | { renumber: { id: string; order: number }[] }` ; `nextOrder(list: Task[]): number` ; `doneCount(tasks: Task[], now: number): { done: number; total: number }`.

- [ ] Tests : `isDoneToday` vrai à 08:00 et 23:59 le jour même, faux le lendemain 00:01, faux pour 0 ; `serviceTasks` filtre le service et les supprimées, trie ; `BASE_TASKS` a 9 tâches, 6 matin, 3 après-midi, ids `base:1`…`base:9` ; `orderAt` donne le milieu des voisines, première − 1 en tête, dernière + 1 en fin, et `renumber` (1, 2, 3…) quand l'écart < 1e-6 ; `nextOrder` = max + 1 (1 si vide) ; `doneCount`.
- [ ] Lancer `npx vitest run tests/unit/tasks.test.ts` : échec (module absent).
- [ ] Implémenter ; relancer : succès. Commit.

### Task 2: Stockage et synchronisation des tâches

**Files:**
- Modify: `src/sync/merge.ts` (`Op.e` += `'task'`), `src/data/sharedRepo.ts` (SHARED_KEYS, tableFor, blank, ENTITIES, VALUE_TYPES, transactions de `applyRemoteOps` / `replayParkedOps`), `src/sync/snapshot.ts` (ENTITIES, Etat, readAll, stampLegacy, hasLocalData : une tâche `base:` jamais horodatée n'est pas une donnée), `src/data/db.ts` (v7 : `tasks: 'id'`, migration qui efface `lastN`, `lastPull`, `seen`, `photoTodo` de `syncState` pour rejoindre ; fonctions ci-dessous), `src/store.ts` (`useTasks`, actions)
- Test: `tests/unit/tasksDb.test.ts`, `tests/unit/sharedRepo.test.ts` (opération `task`), `tests/unit/engine.test.ts` ou `snapshot` (photographie avec tâches)

**Interfaces:**
- Consumes: Task 1.
- Produces (db.ts) : `listTasks(): Promise<Task[]>` (non supprimées) ; `seedTasks(): Promise<void>` (une fois, repère `syncState` `tasksSeeded`) ; `addTask(label, service): Promise<Task>` ; `updateTask(t: Task, base?: Task): Promise<Task>` ; `setTaskDone(id, done: boolean, now?): Promise<Task>` ; `deleteTask(id): Promise<Task>` (renvoie la tâche d'avant) ; `restoreTask(t): Promise<Task>` ; `resetTasks(now?): Promise<Task[]>` (tâches faites aujourd'hui, avant remise à 0) ; `moveTask(id, toIndex): Promise<void>`. store.ts : `useTasks()`, `actions.addTask/updateTask/setTaskDone/deleteTask/restoreTask/resetTasks/restoreTasks/moveTask`.

- [ ] Tests base : `seedTasks` crée les 9, ne recrée pas une tâche de base supprimée ; ajout en fin de service ; cocher met l'heure, décocher 0 ; `resetTasks` ne touche que les faites aujourd'hui, `restoreTask` rend l'heure ; `moveTask` range ; changer de service via `updateTask` met en fin du nouveau service.
- [ ] Tests synchro : `applyRemoteOps([{ e: 'task', … }])` crée/modifie la tâche ; champ de mauvais type ignoré ; `buildEtat` contient `task` ; migration v7 efface `lastN`.
- [ ] Lancer, voir échouer ; implémenter ; tous les tests unitaires passent (`npx vitest run`). Commit.

### Task 3: Sauvegarde

**Files:**
- Modify: `src/domain/backup.ts` (`tasks?: Task[]`, validation si présent), `src/data/backupData.ts` (export et restauration des tâches)
- Test: `tests/unit/backup.test.ts`

- [ ] Tests : sauvegarde avec tâches valide ; ancienne sauvegarde sans `tasks` valide ; tâche mal formée refusée (« Sauvegarde incomplète ou abîmée. »).
- [ ] Implémenter ; tests verts. Commit.

### Task 4: Écran « À faire » et export

**Files:**
- Create: `src/features/tasks/TasksScreen.tsx`, `src/features/tasks/TaskSheet.tsx`, `src/features/tasks/TasksExportPanel.tsx`, `src/features/tasks/exportTasksJpg.ts`, `src/domain/tasksExportLayout.ts`, `src/features/tasks/tasks.css`
- Modify: `src/ui/TabBar.tsx` (onglet `taches`, 5 colonnes), `src/ui/tabbar.css`, `src/App.tsx` (titre « À faire »), `src/main.tsx` ou démarrage (appel `seedTasks`)
- Test: `tests/unit/tasksExportLayout.test.ts`, `tests/e2e/tasks.spec.ts`

- [ ] Test mise en page export : en-tête « Tâches du jour », une ligne par tâche groupée par service, total « 4 / 9 faites », échelle réduite si trop haute.
- [ ] Tests e2e : ordre des onglets (Scanner, Catalogue, À faire, Grattage, Réglages) ; cocher affiche l'heure, décocher l'efface ; « + Tâche » (bouton désactivé si texte vide) ; feuille : renommer, changer de service, supprimer + « Annuler » ; « Remettre à zéro » + « Annuler » ; poignée au clavier (flèche bas) et au doigt (glisser) ; export ouvre l'image ; horloge avancée d'un jour → tout décoché.
- [ ] Implémenter ; e2e verts. Commit.

### Task 5: Partage entre deux téléphones, doc, mise en ligne

**Files:**
- Modify: `tests/e2e/tabacs.spec.ts` (deux téléphones), `README.md`
- [ ] Test e2e : A coche « Remplir la vitrine », B coche « Remplir le linéaire » → les deux voient les deux cochées ; A ajoute une tâche → B la voit.
- [ ] README : l'onglet et ce qui est partagé.
- [ ] `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npx playwright test` : tout vert. Commit, push, PR, fusion, vérification du déploiement.
