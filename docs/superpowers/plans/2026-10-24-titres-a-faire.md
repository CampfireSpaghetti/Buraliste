# Titres « À faire » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Titres de la liste « À faire » modifiables : renommer, ajouter (vide, en bas), supprimer avec leurs tâches (annulable), monter / descendre.

**Architecture:** Nouvelle entité partagée `section` (table `sections`, base v8) sur le modèle de `task` ; `Task.service` = id d'un titre ; logique pure dans `src/domain/tasks.ts` ; écran `src/features/tasks/`.

**Tech Stack:** React 19, Dexie 4, Vitest + fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-titres-a-faire-design.md`

## Global Constraints

- Ids des titres de départ : `matin` (« Matin », rang 1), `apres-midi` (« Après-midi », rang 2).
- Clés partagées `section` : `label`, `order`, `deleted`. `service` d'une tâche : texte non vide.
- Libellés : « + Titre », « Nouveau titre », « Modifier le titre », « Monter », « Descendre », « Supprimer le titre et ses N tâches » (« sa tâche » pour 1, « Supprimer le titre » pour 0).
- Titre : 1 à 40 caractères après nettoyage des espaces.

## Review Focus

- Titre supprimé sur un téléphone pendant qu'un autre coche une de ses tâches → la tâche reste cachée (titre supprimé) : test domaine `visibleTasks`.
- Monter le premier titre / descendre le dernier → bouton désactivé : test e2e.
- Tous les titres supprimés → message et « + Tâche » désactivé : test e2e.
- Restauration d'une ancienne sauvegarde sans titres → titres inchangés : test sauvegarde.
- Téléphone mis à jour après coup → rejoint le canal (v8) : test migration.

---

### Task 1: Domaine et stockage des titres
**Files:** `src/domain/types.ts` (Section ; `Task.service: string`), `src/domain/tasks.ts` (BASE_SECTIONS, visibleSections, visibleTasks, neighbour), `src/sync/merge.ts`, `src/data/sharedRepo.ts`, `src/sync/snapshot.ts`, `src/data/db.ts` (v8, seedSections, listSections, addSection, renameSection, moveSection, deleteSection → { section, tasks }, restoreSection), `src/store.ts`, `src/domain/backup.ts`, `src/data/backupData.ts`, `src/domain/tasksExportLayout.ts`.
- [ ] Tests unitaires (`tests/unit/tasks.test.ts`, `tests/unit/tasksDb.test.ts`, `tests/unit/backup.test.ts`, `tests/unit/tasksExportLayout.test.ts`) ; voir échouer ; implémenter ; `npx vitest run` vert ; commit.

### Task 2: Écran
**Files:** `src/features/tasks/TasksScreen.tsx`, `src/features/tasks/TaskSheet.tsx`, `src/features/tasks/SectionSheet.tsx`, `src/features/tasks/tasks.css`, `tests/e2e/tasks.spec.ts`, `tests/e2e/tabacs.spec.ts`.
- [ ] Tests e2e ; implémenter ; `npx playwright test` vert ; captures clair/sombre relues ; README ; commit, push, PR, fusion, vérification du déploiement.
