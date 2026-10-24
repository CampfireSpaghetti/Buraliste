# Gestion des employés Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Liste des téléphones du tabac, rôles gérant / employé, retrait d'un employé par changement de clé automatique.

**Architecture:** Entité partagée `member` (base v10) ; paire ECDH par téléphone et par tabac dans `syncState` ; message de contrôle `rotation` dans le canal, traité par le moteur (`onRotation`) ; orchestration dans `src/tabacs/members.ts` ; écran `src/features/settings/EmployeesPanel.tsx`.

**Tech Stack:** WebCrypto (ECDH P-256, AES-GCM), Dexie, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-gestion-employes-design.md`

## Global Constraints

- Clés partagées `member` : `name`, `role`, `pub`, `joinedAt`, `lastSeen`, `removed`. `role` : `gerant` ou `employe`.
- Un gérant ne supprime jamais ses données sur « plus d'accès ».
- Libellés : « Employés · N », « Je suis le gérant », « Nommer gérant », « Retirer le rôle de gérant », « Retirer du tabac », « Vous n'avez plus accès au tabac « X » », « Réservé au gérant ».

## Review Focus

- Le gérant retire quelqu'un hors connexion → bouton désactivé, rien n'est changé : test e2e.
- Un téléphone qui n'a jamais lu le message de contrôle revient des jours plus tard → il bascule : test moteur.
- Dernier gérant → « Retirer le rôle de gérant » impossible : test domaine.
- Faux message de contrôle après le vrai → ignoré : test moteur.
- Employé : boutons réservés absents : test e2e.

---

### Task 1: Chiffrement et domaine — `src/sync/crypto.ts` (generateDeviceKeys, wrapKeyFor, unwrapKey), `src/domain/members.ts` ; tests unitaires.
### Task 2: Base et moteur — `src/domain/types.ts`, `src/sync/merge.ts`, `src/data/sharedRepo.ts`, `src/sync/snapshot.ts`, `src/data/db.ts` (v10, ensureMember, setMyName, setRole, removedPatch), `src/sync/engine.ts` (postControl, onRotation), `src/tabacs/registry.ts` (setTabacKey, forgetTabac) ; tests.
### Task 3: Orchestration — `src/tabacs/members.ts` (removeMember, handleRotation), `src/sync/engineInstance.ts`, démarrage ; tests.
### Task 4: Écrans — `EmployeesPanel.tsx`, nom au moment de rejoindre (`PairingPrompt.tsx`), demande du nom, écran « plus d'accès », droits (`useRole`) dans Réglages, historique, « À faire » ; tests e2e trois téléphones ; README ; mise en ligne.
