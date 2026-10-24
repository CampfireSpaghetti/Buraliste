# Historique du grattage et Réglages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Fin comptage » enregistre le comptage dans un historique partagé des 8 derniers (détail, écart, suppression) ; Réglages en blocs.

**Architecture:** Nouvelle entité partagée `snapshot` (table `countHistory`, base v9) sur le modèle de `task` ; logique pure `src/domain/history.ts` ; écrans `src/features/count/` ; Réglages `src/features/settings/SettingsScreen.tsx`.

**Tech Stack:** React 19, Dexie 4, Vitest + fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-historique-grattage-reglages-design.md`

## Global Constraints

- `HISTORY_MAX = 8`. Clés partagées `snapshot` : `at`, `lines`, `deleted`.
- Libellés : « Fin comptage », « Enregistrer et remettre à zéro », « Enregistrer seulement », « Comptage enregistré », « Historique · N comptages », « Historique du grattage », « Supprimer ce comptage ».
- Écart affiché signé (« −12 », « +30 », « 0 »), « nouveau » si le jeu n'était pas dans le précédent.

## Review Focus

- Deux téléphones font « Fin comptage » en même temps → au plus 8 visibles après synchro (élagage par date, déterministe) : test base.
- Jeu renommé ou ligne libre (sans jeu) → écart par nom sans accents : test domaine `lineKey`.
- Comptage le plus ancien : pas de précédent → colonne Écart vide : test e2e.
- « Annuler » après « Enregistrer et remettre à zéro » → quantités et historique rendus : test e2e.
- Opération `snapshot` mal formée (lignes de mauvais type) → ignorée : test base.

---

### Task 1: Domaine, stockage, synchronisation, sauvegarde
**Files:** `src/domain/types.ts`, `src/domain/history.ts`, `src/sync/merge.ts`, `src/data/sharedRepo.ts`, `src/sync/snapshot.ts`, `src/data/db.ts`, `src/store.ts`, `src/domain/backup.ts`, `src/data/backupData.ts`
**Interfaces:** `lineKey(l: CountLine): string` ; `takeSnapshot(lines: CountLine[], at: number, id: string): CountSnapshot` ; `visibleHistory(list): CountSnapshot[]` (récents d'abord, 8 au plus) ; `overflow(list): CountSnapshot[]` ; `snapshotDiff(s, prev?): { byKey: Map<string, number | 'nouveau'>; total?: number }` ; db : `listHistory`, `saveSnapshot(lines, at?) → { snapshot, pruned }`, `deleteSnapshot(id) → CountSnapshot`, `restoreSnapshots(list)`.
- [ ] Tests (`tests/unit/history.test.ts`, `tests/unit/historyDb.test.ts`, backup) ; échec ; implémenter ; `npx vitest run` vert ; commit.

### Task 2: Écrans du grattage
**Files:** `src/features/count/CountScreen.tsx`, `src/features/count/HistoryPanel.tsx`, `src/features/count/count.css`, `tests/e2e/history.spec.ts`
- [ ] Tests e2e ; implémenter ; verts ; commit.

### Task 3: Réglages en blocs, deux téléphones, mise en ligne
**Files:** `src/features/settings/SettingsScreen.tsx`, `src/features/settings/TabacSection.tsx`, `src/features/settings/settings.css`, `tests/e2e/settings.spec.ts`, `tests/e2e/tabacs.spec.ts`, `README.md`
- [ ] Tests e2e ; implémenter ; captures clair/sombre ; suite complète ; commit, push, PR, fusion, vérification du déploiement.
