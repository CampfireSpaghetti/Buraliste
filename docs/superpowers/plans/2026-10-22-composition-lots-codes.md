# Composition, lots FDJ et codes-barres rattachés : plan de développement

> **Pour les agents qui exécutent ce plan :** SOUS-COMPÉTENCE REQUISE : superpowers:subagent-driven-development. Étapes en cases à cocher.

**But :**
- montrer les lots des jeux de grattage ;
- montrer la composition déclarée à l'ANSES des produits du tabac ;
- rattacher chaque code-barres scanné directement à une référence existante, avec plusieurs codes par produit.

**Architecture :**
- deux scripts Node mettent à jour chaque semaine deux fichiers publics, `public/data/fdj-lots.json` et `public/data/composition.json`, comme `scripts/fdj/update.ts` et `scripts/douane/update.ts` ;
- l'app les charge à la demande pour les fiches ;
- la reconnaissance des codes passe par `src/domain/matching.ts` (plusieurs préfixes par jeu, catalogue des codes de jeu FDJ, refus du code de traçabilité) ;
- l'UI de rattachement réutilise WhichGameDialog et AttachToReference.

**Technologies :** TypeScript, exécuté tel quel par Node (`.ts` dans les imports des scripts), Vitest, Playwright, Dexie.

**Spec :** `docs/superpowers/specs/2026-10-22-composition-lots-codes-design.md`. Rapport source : `reports/Composition tabac et lots grattage.md`, fichier non suivi par git, présent dans le dépôt local.

## Contraintes globales

- **Langue :** interface en français, mots simples.
- **Sources citées dans l'app :**
  - « D'après le règlement FDJ du jeu » (lots) ;
  - « Données ANSES (fichier de <mois année>) » (composition).
- **Robustesse des scripts :** un échec de téléchargement ou d'analyse ne casse jamais la publication. Le dernier fichier valide est gardé, avec `continue-on-error` et un échec visible en fin de workflow, comme Douane et FDJ.
- **Taille :** `composition.json` n'est jamais chargé au démarrage. Il est chargé à l'ouverture d'une fiche de tabac et mis en cache par le service worker (runtime caching, pas de precache).
- **Partage :** les champs partagés ajoutés sont `user.fdjPrefixes` (string[]) et `user.barcodes` (déjà partagé). Ils sont ajoutés dans `SHARED_KEYS` et dans la validation des types (`sharedRepo.ts`).
- **Données réelles de départ :**
  - CSV ANSES téléchargés : `/tmp/claude-0/-home-user-Buraliste/1a75b9a3-f3a2-59eb-a471-f72bacb22b8e/scratchpad/tabdata/` ;
  - pages de jeux fdj.fr enregistrées : `…/scratchpad/dl/` ;
  - script d'extraction du contenu Next.js : `…/scratchpad/scripts/rsc2.py`.

  Les fixtures de test sont des extraits réduits de ces fichiers, versionnés sous `tests/fixtures/`.

## Points d'attention en revue

1. **Code de traçabilité KPL2F scanné en comptage :** il ne doit ni créer de produit, ni demander un jeu. Un message clair s'affiche. → Tâche 1, test `code de traçabilité refusé`.
2. **Préfixe du catalogue faux** (le code-barres ne suit pas la règle des 5 chiffres) : on ne rattache jamais sans confirmation, et « Autre jeu » ne confirme pas le préfixe. → Tâche 1, test `préfixe catalogue non confirmé`.
3. **Page FDJ modifiée ou tableau incohérent :** l'ancien tableau est gardé. → Tâche 2, test `tableau incohérent ignoré`.
4. **Faux rapprochement ANSES ↔ Douane** (deux variantes d'une même marque) : aucune composition plutôt qu'une mauvaise. → Tâche 3, test `ambigu non rapproché`.
5. **Retirer un code ajouté par erreur :** la référence ne le reconnaît plus, et c'est partagé. → Tâche 1, test `retirer un code`.

---

### Task 1: Codes-barres rattachés (plusieurs préfixes, catalogue FDJ, traçabilité, liste des codes)

**Fichiers :**
- `src/domain/matching.ts`, `src/domain/types.ts`, `src/domain/barcode.ts`
- `src/data/sharedRepo.ts` (SHARED_KEYS, validation)
- `src/domain/sharing.ts` (contributions et fusion : `fdjPrefixes`)
- `scripts/codes/*`
- `src/features/count/WhichGameDialog.tsx`, `CountScreen.tsx`, `src/features/scanner/ScannerScreen.tsx`, `scanRouter.ts`
- `src/features/catalog/ProductSheet.tsx` (section « Codes-barres »), `AttachToReference.tsx`
- `scripts/fdj/update.ts` + `public/data/fdj-games.json` (`codes`)
- tests unitaires et e2e

**Interfaces :**
- `ProductFields.fdjPrefixes?: string[]`. L'ancien `fdjPrefix` reste lu (migration douce : `effectiveFields` les fusionne).
- `effectiveFields(p).fdjPrefixes` = union des préfixes `user`, `base` et partagés.
- `resolveScan(raw, products, opts?: { format?: string })` renvoie l'un de :
  - `{type:'product'}` ;
  - `{type:'unknown-ean'}` ;
  - `{type:'confirm-game'; code; product; prefix}` (nouveau : préfixe du catalogue non confirmé) ;
  - `{type:'ask-game'; code; candidates}` ;
  - `{type:'new-game'}` ;
  - `{type:'traceability'; code}` (nouveau).
- **Ordre de résolution :**
  1. traçabilité (`/^KPL2F/i` ou `format === 'data_matrix'`) ;
  2. code-barres exact ;
  3. EAN valide ;
  4. préfixe confirmé, le plus long gagnant (`fdjPrefixes` de `user`, `base` et partagés) ;
  5. préfixe du catalogue (`base.fdjCodes` à 5 chiffres, venus de `fdj-games.json`) → `confirm-game` ;
  6. `ask-game`.
- `learnFdjCode(game, code, products, opts?: { confirmedPrefix?: string })` renvoie un patch `{ barcodes, fdjPrefixes }` :
  - ajoute toujours le code complet ;
  - ajoute `confirmedPrefix` s'il est fourni ;
  - sinon, ajoute ou raccourcit un préfixe appris : préfixe commun ≥ 4 caractères avec un code ou un préfixe existant de ce jeu, sans collision avec un autre jeu ;
  - garde plusieurs préfixes.
- **UI :**
  - `confirm-game` affiche « Ce ticket est-il un <nom> ? » avec [Oui] et [Autre jeu]. « Autre jeu » ouvre WhichGameDialog avec recherche, sans confirmer le préfixe.
  - `traceability` affiche un toast : « Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet. »
  - Fiche produit, section « Codes-barres » : la liste des codes et préfixes, avec « Retirer » pour ceux qui sont dans `user` et « Ajouter un code » (scanner en mode rattachement de ce produit).
  - WhichGameDialog : champ de recherche, et « Nouveau jeu » relégué en bas.
- `scripts/fdj/update.ts` remplit `codes` (préfixes à 5 chiffres) par jeu, à partir d'une table versionnée `scripts/fdj/gameCodes.ts`. Elle est initialisée avec les codes du rapport (CASH 871 + émissions connues, etc.). L'avis mensuel n'est pas lu automatiquement : c'est hors périmètre, à noter.

- [ ] **Étape 1 : tests qui échouent.** Unitaires matching :
  - code de traçabilité refusé ;
  - préfixe catalogue → confirm-game ;
  - préfixe confirmé → product ;
  - « Autre jeu » ne confirme pas ;
  - plusieurs préfixes, le plus long gagne ;
  - learnFdjCode garde le code complet et raccourcit le préfixe appris ;
  - retirer un code.

  e2e : scanner un ticket inconnu en comptage → choisir CASH → un second ticket du même carnet est reconnu directement ; fiche CASH → code listé → Retirer → n'est plus reconnu.
- [ ] **Étape 2 : implémenter**, puis vérifier : `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run e2e`.
- [ ] **Étape 3 : commit** `feat(codes): codes-barres rattachés aux références, plusieurs préfixes par jeu, code de traçabilité refusé`.

### Task 2: Lots des jeux FDJ (script hebdomadaire et fiche)

**Fichiers :**
- `scripts/fdj/lots.ts` (+ `parseWinningTables.ts`), `scripts/fdj/blocs.ts`
- `public/data/fdj-lots.json`
- `src/data/lotsData.ts` (chargement à la demande)
- `src/features/catalog/LotsTable.tsx`, intégré dans `ProductSheet.tsx` pour `kind === 'jeu-fdj'`
- `package.json` (`fdj:lots`), `.github/workflows/deploy.yml` (étape après « liste FDJ », mêmes conditions)
- tests et fixtures

**Interfaces :**
- `parseWinningTables(html: string): { prix?: number; lots: {montant:number; nombre:number}[]; chance?: number; trj?: number } | undefined`. Elle tolère les espaces insécables, les BOM, le € manquant et les lignes vides.
- `checkLots(t)` renvoie false si :
  - l'écart entre la chance recalculée (bloc / somme des lots, quand le bloc est connu) et la chance publiée dépasse 1 % ;
  - ou aucune ligne n'est trouvée.
- Le script passe sur chaque jeu de `fdj-games.json` avec son slug. Un jeu en échec garde son ancienne entrée.
- **Fiche jeu, section « Lots » :**
  - « 1 chance sur X de gagner » ;
  - « Taux de retour aux joueurs : Y % » ;
  - « Gain maximal : Z € » ;
  - tableau Montant | Nombre de lots, avec le bloc indiqué quand il est connu (« pour 24 000 000 tickets ») ;
  - mention de la source.

- [ ] **Étape 1 : tests qui échouent.**
  - Analyse des fixtures CASH et Millionnaire : valeurs exactes du rapport (CASH : 6 289 005 lots par bloc de 24 M, 1 chance sur 3,82, TRJ 70 %).
  - `tableau incohérent ignoré`.
  - Test de composant de LotsTable.
- [ ] **Étape 2 : implémenter**, puis vérifier, en ajoutant `npm run fdj:lots` une fois en réel si le réseau le permet, sinon uniquement sur fixtures, ce qui sera noté.
- [ ] **Étape 3 : commit** `feat(lots): tableau des lots des jeux de grattage, mis à jour chaque semaine`.

### Task 3: Composition ANSES (script mensuel et fiche)

**Fichiers :**
- `scripts/anses/update.ts`, `parseAnses.ts`, `matchDouane.ts`
- `public/data/composition.json`
- `src/data/compositionData.ts`
- `src/features/catalog/CompositionSection.tsx`
- `vite.config.ts` (runtime caching de `composition.json`)
- `package.json` (`anses:update`), workflow (planning hebdomadaire, même logique)
- tests et fixtures (extraits CSV)

**Interfaces :**
- `parseCigarettes(csv)`, `parseAutres(csv)`, `parseComposition(csv)` : lignes typées. Elles gèrent les dates mixtes et la notation scientifique.
- `matchToDouane(ansesProducts, douaneRefs): Map<douaneRef, ansesRef>` :
  - normalisation (accents, casse, « by », formats « 20 », « 30 g », paquet rigide ou souple) ;
  - score sur la marque, puis la variante, puis le format ;
  - rattachement seulement si le meilleur score ≥ seuil et que l'écart avec le second est suffisant ;
  - le taux de rapprochement est écrit dans le journal.
- Les EAN valides du fichier ANSES sont ajoutés aux `base.barcodes` des références rapprochées, par le même chemin que la fusion Douane, sans jamais écraser `user`.
- **Fiche, section « Composition (déclaration ANSES) » :**
  - nicotine, goudron, CO en mg par cigarette (si présents) ;
  - liste des ingrédients repliable : nom, fonction, « brûlé » ;
  - date de la déclaration et mention de la source ;
  - rien si le produit n'est pas rapproché.

- [ ] **Étape 1 : tests qui échouent.**
  - Analyse des fixtures.
  - `ambigu non rapproché` : deux variantes « Marlboro Gold » et « Marlboro Gold Touch » ne se confondent pas.
  - Un rapprochement exact réussit.
  - Composant.
- [ ] **Étape 2 : implémenter**, puis vérifier, avec un passage réel sur les CSV téléchargés (taux de rapprochement noté dans le rapport).
- [ ] **Étape 3 : commit** `feat(composition): composition déclarée à l'ANSES sur les fiches tabac`.

### Task 4: Finitions, documentation, revue, mise en ligne

- [ ] **Documentation :** README (nouvelles sources et mentions) et Réglages (confidentialité, sources des données), spec au statut « développée ».
- [ ] **Vérification complète :** tsc, test, e2e, build.
- [ ] **Relecture de toute la branche.**
- [ ] **Demande de fusion, puis fusion** (le propriétaire a demandé de faire le nécessaire).
