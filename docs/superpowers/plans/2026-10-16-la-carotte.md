# La Carotte : plan de développement

> **Pour les agents qui exécutent ce plan :** SOUS-COMPÉTENCE REQUISE : superpowers:subagent-driven-development (recommandée) ou superpowers:executing-plans, tâche par tâche. Les étapes sont des cases à cocher (`- [ ]`).

**But :** livrer la PWA « La Carotte » (scan, catalogue tabac et FDJ, remplaçants, comptage grattage avec export .jpg). Elle est hébergée gratuitement sur GitHub Pages et sa liste officielle Douane se met à jour chaque semaine.

**Architecture :**
- Une application React en une seule page, qui stocke tout dans IndexedDB sur le téléphone. Un service worker la rend utilisable hors ligne.
- La logique métier est faite de fonctions pures dans `src/domain/`, testées sans navigateur. L'interface dans `src/features/` ne fait que les appeler.
- Un script Node convertit le fichier ODS de la Douane en `public/data/references.json`. Un workflow GitHub Actions unique le lance chaque semaine, puis reconstruit et déploie l'app.

**Technologies :**
- Vite 8, React 19, TypeScript 5.9.3 ;
- Dexie 4, vite-plugin-pwa ;
- barcode-detector, qui s'appuie sur zxing-wasm ;
- fflate, pour lire l'ODS ;
- Vitest, avec fake-indexeddb et @testing-library/react ;
- Playwright.

**Spec :** `docs/superpowers/specs/2026-10-16-la-carotte-design.md`. À lire avant toute tâche : ce plan s'appuie sur elle.

## Contraintes globales

Elles s'appliquent à chaque tâche.

- **Langue** : toute l'interface et les messages sont en **français**.
- **Coût** : 0 €. Aucun service payant, aucun store.
- **Aucun appel réseau tiers depuis l'app** : CSP `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'`. Le `.wasm` de zxing est servi depuis l'app, jamais depuis un CDN.
- **Installation des dépendances** : le fichier `.npmrc` contient `before=2026-10-01`, pour n'installer que des versions publiées depuis au moins 2 semaines. TypeScript est figé à `5.9.3`. Toutes les versions sont exactes dans `package.json`, sans `^`.
- **Hébergement** : `base: '/buraliste/'` (site `https://wongmichel2048.github.io/buraliste/`), avec `scope` et `start_url` du manifest en `/buraliste/`.
- **Couleurs** (tokens CSS dans `src/theme/tokens.css`) :
  - `--bordeaux:#8e1b1f` ;
  - `--email:#f6f4ee` ;
  - `--encre:#1d2433` ;
  - `--laiton:#b8892e` ;
  - `--carotte:#d22a2f` ;
  - mode sombre : fond encre, texte émail, accents laiton et rouge éclairci. Contraste AA dans les deux modes.
- **Polices hébergées dans `src/theme/fonts/`** (woff2, licence OFL) : Alfa Slab One (titres), Barlow Semi Condensed 400/600/700 (texte, `font-variant-numeric: tabular-nums` sur les chiffres).
- **Zones à toucher** : 48 × 48 px minimum.
- **Animations** : toutes désactivées sous `prefers-reduced-motion: reduce`.
- **Date du tableau** : format `JJ/MM HH:MM` (`16/10 18:42`), heure locale.
- **Noms de fichiers** :
  - `comptage-grattage-AAAA-MM-JJ-HHMM.jpg` ;
  - `la-carotte-sauvegarde-AAAA-MM-JJ.json`.
- **Quantités** : entiers de 0 à 99 999.
- **Navigateur pour les tests** : Playwright avec `executablePath: '/opt/pw-browsers/chromium'` si la version installée ne correspond pas. Ne jamais lancer `playwright install`.

## Points d'attention en revue

Ce sont des cas que la spec implique sans les tester explicitement. Chacun est couvert par un test dans la tâche indiquée.

1. **Très longue liste à l'export** (200 lignes et plus). iOS refuse les canvas de plus de 16 777 216 pixels. L'image doit quand même contenir toutes les lignes, avec une échelle réduite. → Tâche 11, test `layoutExport réduit l'échelle au-delà de la limite iOS`.
2. **Libellés Douane irréguliers** : espaces insécables, doubles espaces, même libellé chez deux fabricants. La référence doit être stable et sans collision. → Tâche 4, tests `normalizeRef` et `doublons`.
3. **Scan reçu pendant que le pavé numérique est ouvert, ou même code relu tout de suite.** Il ne doit ni ouvrir un second pavé, ni modifier une autre ligne. → Tâche 2 (anti-doublon) et Tâche 10 (scan ignoré pendant que le pavé est ouvert).
4. **Restauration d'un fichier invalide** : JSON quelconque, version inconnue, champs manquants. Les données actuelles ne doivent pas bouger. → Tâche 12, test `parseBackup rejette…`.
5. **Saisie au pavé** : `007`, saisie vide, plus de 99 999. Doit donner 7, Valider désactivé, saisie bloquée à 5 chiffres. → Tâche 10, test `NumericKeypad`.

---

## Arborescence

```
.npmrc  package.json  tsconfig.json  vite.config.ts  playwright.config.ts  index.html
public/data/references.json        ← généré (Tâche 4), versionné dans git
public/zxing/zxing_reader.wasm     ← copié depuis node_modules (Tâche 6)
src/main.tsx  src/App.tsx          ← coquille, onglets, routage par hash (#scanner|#catalogue|#grattage|#reglages)
src/theme/  tokens.css  global.css  fonts/*.woff2
src/ui/     TabBar.tsx  Sheet.tsx  Carotte.tsx  Banner.tsx  Toast.tsx
src/domain/ types.ts  barcode.ts  matching.ts  catalog.ts  substitutes.ts  exportLayout.ts  backup.ts  format.ts
src/data/   db.ts  referencesSync.ts  seed/depart.json  seed/fdj.json
src/features/scanner/   useBarcodeScanner.ts  ScannerView.tsx  feedback.ts  scanRouter.ts
src/features/catalog/   CatalogScreen.tsx  ProductSheet.tsx  ProductForm.tsx  SubstitutesList.tsx  CompareView.tsx  AttachToReference.tsx
src/features/count/     CountScreen.tsx  CountTable.tsx  NumericKeypad.tsx  WhichGameDialog.tsx  exportJpg.ts
src/features/settings/  SettingsScreen.tsx  InstallGuide.tsx
docs/audits/maquette/index.html   ← maquette complète (Tâche 7)
src/share.ts
scripts/douane/  readOds.ts  parseNomenclature.ts  findLatest.ts  update.ts
tests/unit/*.test.ts(x)   tests/fixtures/douane-rows.json   tests/e2e/*.spec.ts
.github/workflows/deploy.yml
docs/audits/  (rapports d'audit)
```

---

### Tâche 1 : socle, coquille de l'app, thème, déploiement

**Fichiers :** tous les fichiers racine, `src/main.tsx`, `src/App.tsx`, `src/theme/*`, `src/ui/TabBar.tsx`, `src/ui/Carotte.tsx`, `public/icons/*`, `.github/workflows/deploy.yml`, `tests/e2e/shell.spec.ts`, `README.md`

**Interfaces produites :**
- `type Tab = 'scanner'|'catalogue'|'grattage'|'reglages'` ;
- `App` lit et écrit `location.hash` ;
- `<Carotte bounce?: boolean size?: number />` ;
- scripts npm `dev`, `build`, `preview`, `test` (vitest run), `e2e` (playwright), `refs:update`.

- [ ] **Étape 1 : initialiser le projet.** `.npmrc` avec `before=2026-10-01` et `save-exact=true`. Puis `npm i react react-dom dexie barcode-detector fflate` et `npm i -D vite @vitejs/plugin-react typescript@5.9.3 vite-plugin-pwa vitest jsdom fake-indexeddb @testing-library/react @playwright/test @types/react @types/react-dom @types/node`. Vérifier que `npm ls` ne signale aucun conflit de dépendances paires.
- [ ] **Étape 2 : écrire le test e2e qui échoue**, `tests/e2e/shell.spec.ts`. On ouvre `/buraliste/` et on attend :
  - 4 boutons d'onglet, de noms accessibles `Scanner`, `Catalogue`, `Grattage`, `Réglages` ;
  - un clic sur `Grattage` donne `location.hash === '#grattage'` et un titre `Comptage grattage`.
  - `playwright.config.ts` lance `npm run build && npm run preview -- --port 4173` en `webServer`, avec le viewport 390 × 844.
- [ ] **Étape 3 : vérifier l'échec** : `npm run e2e -- shell`. Attendu : ÉCHEC (pas d'app).
- [ ] **Étape 4 : implémenter la coquille.**
  - `vite.config.ts` : `base:'/buraliste/'`, plugin React, et `VitePWA` avec :
    - `registerType:'prompt'` ;
    - manifest `name:'La Carotte'`, `short_name:'La Carotte'`, `lang:'fr'`, `display:'standalone'`, `theme_color:'#8e1b1f'`, `background_color:'#f6f4ee'` ;
    - icônes 192/512 et maskable, carotte rouge sur fond bordeaux, générées en PNG depuis un SVG ;
    - précache de `**/*.{js,css,html,woff2,wasm,json,png,svg}`.
  - CSP en `<meta http-equiv>` dans `index.html`, selon les contraintes globales.
  - `TabBar` fixée en bas, avec `padding-bottom: env(safe-area-inset-bottom)`.
  - Écrans vides avec leur titre : « Scanner », « Catalogue », « Comptage grattage », « Réglages ».
  - Mode sombre par `prefers-color-scheme`.
- [ ] **Étape 5 : vérifier que le test passe** : `npm run e2e -- shell`. Attendu : SUCCÈS.
- [ ] **Étape 6 : workflow `.github/workflows/deploy.yml`.**
  - Déclencheurs : `push` sur `main`, `schedule: cron '17 4 * * 1'` (lundi 04:17 UTC), `workflow_dispatch`.
  - Permissions : `contents: write, pages: write, id-token: write`.
  - Étapes :
    1. checkout ;
    2. setup-node 22 ;
    3. `npm ci` ;
    4. **si** l'événement n'est pas `push` : `npm run refs:update`, puis commit et push de `public/data/references.json` s'il a changé, avec le message `chore: liste Douane <effectiveDate>` ;
    5. `npm test` ;
    6. `npm run build` ;
    7. `actions/upload-pages-artifact` (dist) ;
    8. `actions/deploy-pages`.
  - Un seul workflow fait tout, parce qu'un push fait avec `GITHUB_TOKEN` ne déclenche pas d'autre workflow.
- [ ] **Étape 7 : README** en français. Ce qu'est l'app, l'adresse d'installation, et les deux réglages GitHub à faire par le propriétaire : rendre le dépôt public, et choisir Settings → Pages → Source « GitHub Actions ».
- [ ] **Étape 8 : commit** `feat: socle PWA, coquille à 4 onglets, thème plaque émaillée, déploiement Pages`.

### Tâche 2 : codes-barres et reconnaissance des scans

**Fichiers :** `src/domain/types.ts`, `src/domain/barcode.ts`, `src/domain/matching.ts`, `tests/unit/barcode.test.ts`, `tests/unit/matching.test.ts`

**Interfaces produites :**
- `types.ts` : `Kind`, `ProductFields`, `Product`, `CountLine`, `Settings`, exactement comme aux §4.1 à 4.3 de la spec.
- Ajouts pour la Douane dans `ProductFields` :
  - `previousPrice?: number` ;
  - `effectiveDate?: string` (ISO) ;
  - `status?: 'nouveau'|'retrait'|'inchange'`.
- Ajout dans `Settings` : `fdjSeeded?: boolean`.
- `barcode.ts` :
  - `normalizeCode(raw: string): string` : chiffres et lettres, sans espaces ni tirets ;
  - `isValidEan(code: string): boolean` : longueur 8 ou 13 avec clé de contrôle valide ;
  - `commonPrefix(a: string, b: string): string`.
- `matching.ts` :
  - `effectiveFields(p: Product): ProductFields`. Définie ici, puis réexportée par `catalog.ts`.
  - `type ScanResult = {type:'product', product:Product} | {type:'unknown-ean', code:string} | {type:'ask-game', code:string, candidates:Product[]} | {type:'new-game', code:string}`.
  - `resolveScan(raw: string, products: Product[]): ScanResult`.
  - `learnFdjCode(game: Product, code: string, products: Product[]): Partial<ProductFields>`. Renvoie le patch à appliquer à `game.user` : `{fdjPrefix}` ou `{barcodes}`.
  - `createScanDebouncer(windowMs = 1500): (code: string, now: number) => boolean`. Renvoie `false` si le même code a été vu il y a moins de `windowMs`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - `isValidEan('3017620422003') === true` ;
  - `isValidEan('3017620422004') === false` ;
  - `isValidEan('96385074') === true` ;
  - `normalizeCode(' 3017-6204 22003 ') === '3017620422003'`.
  - Correspondance exacte sur les `barcodes` de la couche `user` ou de la couche `base` : résultat `product`.
  - EAN valide inconnu : `unknown-ean`.
  - Code ITF `'04170012345678'` avec un jeu `fdjPrefix:'0417'` : `product`.
  - Deux jeux aux préfixes `'0417'` et `'041700'` : on retient le plus long.
  - Code non EAN sans préfixe connu, mais des jeux FDJ existent : `ask-game`, candidats triés par longueur de préfixe commun décroissante.
  - Aucun jeu FDJ : `new-game`.
  - `learnFdjCode` :
    - jeu avec `barcodes:['04170012345678']` et nouveau code `'04170099999999'` : `{fdjPrefix:'041700'}` ;
    - préfixe commun de moins de 4 chiffres : `{barcodes:[...anciens, code]}` ;
    - préfixe qui correspondrait au code d'un autre jeu : `{barcodes:[...]}`.
  - Debouncer : `('A',0)` donne `true`, `('A',1000)` donne `false`, `('A',2600)` donne `true`, `('B',1100)` donne `true`.
- [ ] **Étape 2 : vérifier l'échec** : `npx vitest run tests/unit/barcode.test.ts tests/unit/matching.test.ts`. Attendu : ÉCHEC, modules absents.
- [ ] **Étape 3 : implémenter** selon le §5 de la spec. Les produits FDJ sont ceux où `effectiveFields(p).kind === 'jeu-fdj'`.
- [ ] **Étape 4 : vérifier que les tests passent.** Attendu : SUCCÈS.
- [ ] **Étape 5 : commit** `feat(domain): reconnaissance des codes et apprentissage des préfixes FDJ`.

### Tâche 3 : catalogue en deux couches et fusion de la liste officielle

**Fichiers :** `src/domain/catalog.ts`, `tests/unit/catalog.test.ts`

**Interfaces :**
- Consomme : les types de la Tâche 2.
- Produit :
  - `type RefItem = { ref: string; previousRef?: string; kind: Kind; name: string; brand?: string; format?: string; manufacturer: string; price?: number; previousPrice?: number; status: 'nouveau'|'retrait'|'inchange' }` ;
  - `type ReferenceFile = { version: string; effectiveDate: string; source: string; items: RefItem[] }` ;
  - `type DepartItem = { ref: string; origin?: string; strength?: 1|2|3|4|5; tasteTags?: string[]; nicotineMg?: number }` ;
  - `currentPrice(f: ProductFields, today: Date): number | undefined` ;
  - `officialState(f: ProductFields, today: Date): 'actif'|'bientot'|'retire'` ;
  - `type MergeOps = { put: Product[]; unchanged: number }` ;
  - `mergeReferences(existing: Product[], file: ReferenceFile, depart: DepartItem[], now: number, newId: () => string): MergeOps`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - `effectiveFields` : `user` l'emporte sur `base`, et `barcodes` est l'union sans doublon.
  - `currentPrice` : avec `price:13`, `previousPrice:12.5`, `effectiveDate:'2026-11-01'` :
    - au 2026-10-31 : `12.5` ;
    - au 2026-11-01 : `13`.
  - `officialState` :
    - `status:'nouveau'` avant la date : `'bientot'` ;
    - `status:'retrait'` à partir de la date : `'retire'`.
  - `mergeReferences` :
    1. un produit `douane` avec `user:{tasteTags:['doux'], barcodes:['3…']}` reçoit un nouveau prix : `base` est remplacé et `user` reste identique ;
    2. un nouveau `ref` crée un produit `source:'douane'` avec un id issu de `newId` ;
    3. une ligne avec `previousRef` met à jour le produit existant qui porte l'ancien `ref` : même id, `douaneRef` changé ;
    4. un produit absent du fichier n'est pas supprimé et reçoit `base.status:'retrait'` ;
    5. `depart` enrichit `base` (origine, force, goûts) quand le `ref` correspond ;
    6. les produits `source:'utilisateur'` et `'depart'` hors Douane ne sont jamais touchés ;
    7. deux appels de suite avec le même fichier : le second donne `put.length === 0`.
- [ ] **Étape 2 : vérifier l'échec.**
- [ ] **Étape 3 : implémenter.** On compare `base` champ par champ (égalité JSON) et on ne met dans `put` que les produits qui changent.
- [ ] **Étape 4 : vérifier que les tests passent.**
- [ ] **Étape 5 : commit** `feat(domain): catalogue en deux couches et fusion de la liste Douane`.

### Tâche 4 : robot Douane (ODS → references.json)

**Fichiers :** `scripts/douane/readOds.ts`, `parseNomenclature.ts`, `findLatest.ts`, `update.ts`, `tests/unit/douane.test.ts`, `tests/fixtures/douane-rows.json`, `tests/fixtures/douane-listing.html`, `public/data/references.json`

**Interfaces :**
- Consomme : `ReferenceFile` et `RefItem` de la Tâche 3 (`import type`).
- Produit :
  - `readOdsRows(buf: Uint8Array, sheet = 'Feuille1'): string[][]` : décompresse avec fflate et lit `content.xml`. Gère `number-columns-repeated`, plafonné à 6 colonnes, et `<text:s/>`.
  - `normalizeRef(manufacturer: string, label: string): string` : minuscules, NFKC, espaces insécables remplacés par des espaces, espaces multiples réduits, `fabricant|libellé`.
  - `parseNomenclature(rows: string[][], sourceUrl: string): ReferenceFile`.
  - `findLatestOdsUrl(html: string, base = 'https://www.douane.gouv.fr'): string`.
  - CLI `npm run refs:update` (= `node scripts/douane/update.ts`). Il télécharge la page `https://www.douane.gouv.fr/la-douane/opendata/categories/tabacs-manufactures/homologation-des-prix-arretes`, prend le dernier ODS, écrit `public/data/references.json` (JSON compact), puis affiche `N références, en vigueur le AAAA-MM-JJ`.

**Règles de lecture du fichier** (constatées sur le fichier du 1er novembre 2026, colonnes `c0` à `c5`) :

| Ligne | Traitement |
|---|---|
| `c0` commence par `Arrêté du` | `effectiveDate` = date de « applicable au 1er novembre 2026 », au format ISO |
| `c0` commence par `FOURNISSEUR` | ignorée |
| `c0` commence par `FABRICANT` | fabricant courant = texte après « : », nettoyé |
| `c0` seul, sans prix | en-tête de famille (voir la correspondance ci-dessous) |
| `c1` non vide et `c0` vide | **nouveau** produit, libellé `c1`, prix `c5` |
| `c1` non vide et `c0` non vide | **renommé**, `ref` calculé sur `c1`, `previousRef` sur `c0` |
| `c5 === 'Sans changement'` | `price` = `c3`, statut `inchange` |
| `c5` est un nombre | `price` = `c5`, `previousPrice` = `c3` si présent |
| `c5 === 'Retrait'` | `status:'retrait'`, `price` = `c3` |

Correspondance des en-têtes de famille :
- `Cigarettes` → `cigarette` ;
- `Tabac à rouler` et `Tabacs à rouler` → `tabac-rouler` ;
- `Cigares et cigarillos` → `cigarillo` si le libellé contient « cigarillo », sinon `cigare` ;
- tout autre en-tête → `autre-tabac`.

Autres conventions :
- Nombres au format `13,50`.
- `format` = ce qui suit `, en ` (par exemple `20 unités`, `30 g`, `10 cigares`).
- `brand` = premier mot du libellé.
- `version` = `effectiveDate` suivi des 8 premiers caractères du sha256 du JSON des items.
- Doublon de `ref` dans un même fichier : on garde la première occurrence et on affiche un avertissement avec le nombre de doublons.

- [ ] **Étape 1 : fixtures.**
  - `douane-rows.json` : environ 60 lignes réelles extraites de `Maquette JORF 1er novembre 2026.ods`, avec l'en-tête Arrêté, deux fabricants, chaque famille, un produit inchangé, un nouveau, un renommé, un prix modifié et un retrait. Ajouter à la main une ligne avec double espace et espace insécable (`'Philip Morris S À  tuber (pot), en 30 g'`), et une même étiquette présente chez deux fabricants.
  - `douane-listing.html` : un extrait de la page de liste contenant au moins les liens `.ods` de juin, septembre et novembre 2026.
- [ ] **Étape 2 : écrire les tests qui échouent.**
  - `parseNomenclature(fixture).effectiveDate === '2026-11-01'`.
  - Le produit « Lucky Strike Bleu, en 20 unités » a `kind:'cigarette'`, `price:13`, `status:'inchange'`, `format:'20 unités'`, `brand:'Lucky'`.
  - « Lucky Strike Cigarillos, en 10 cigares » donne `cigarillo`.
  - La ligne « Retrait » donne `status:'retrait'`.
  - Le nouveau produit a `status:'nouveau'` et le renommé a un `previousRef`.
  - `normalizeRef('PHILIP MORRIS', 'Philip Morris S À  tuber (pot), en 30 g') === 'philip morris|philip morris s à tuber (pot), en 30 g'`.
  - Une même étiquette chez deux fabricants donne deux `ref` différents (`doublons`).
  - `findLatestOdsUrl(listing)` se termine par `Maquette%20JORF%201er%20novembre%202026.ods` : on choisit la date la plus récente lue dans le nom du fichier, et non le premier lien.
  - `readOdsRows` sur un mini ODS généré dans le test avec fflate (2 lignes, dont une cellule `number-columns-repeated="3"`) renvoie la bonne grille.
- [ ] **Étape 3 : vérifier l'échec**, puis **implémenter**, puis **vérifier que les tests passent**.
- [ ] **Étape 4 : lancer pour de vrai** `npm run refs:update`. Attendu : plus de 5 000 références, en vigueur le 2026-11-01, et un fichier `public/data/references.json` de moins de 1,5 Mo.
- [ ] **Étape 5 : commit** `feat(douane): conversion automatique de la nomenclature officielle`, avec `references.json`.

### Tâche 5 : base de données locale, synchronisation de la liste, données de départ

**Fichiers :** `src/data/db.ts`, `src/data/referencesSync.ts`, `src/data/seed/depart.json`, `src/data/seed/fdj.json`, `tests/unit/db.test.ts`

**Interfaces :**
- Consomme : `mergeReferences` et `ReferenceFile` (Tâche 3).
- Produit, dans `db.ts` :
  - classe Dexie `CarotteDB`, nom `'la-carotte'`, version 1 ;
  - tables `products: 'id, douaneRef, source, updatedAt'`. La reconnaissance des scans se fait en mémoire avec `resolveScan` sur `listProducts()` : environ 5 000 produits, c'est instantané.
  - tables `countLines: 'id, gameId, updatedAt'` et `settings: 'key'` (un seul enregistrement, `key:'main'`) ;
  - repo :
    - `getSettings(): Promise<Settings>`, avec défauts `{shopName:'Mon tabac', sortCount:'name'}` ;
    - `saveSettings(patch)` ;
    - `listProducts()` ;
    - `putProduct(p)`, qui met `updatedAt` à jour ;
    - `patchUserFields(id, patch: Partial<ProductFields>)` ;
    - `clearUserField(id, key)` ;
    - `setOutOfStock(id, v)` ;
    - `setPinned(id, ids)` ;
    - `listCountLines()` ;
    - `upsertCountLine(line)`, qui met `updatedAt = Date.now()` ;
    - `deleteCountLine(id): Promise<CountLine>`, qui renvoie la ligne pour pouvoir annuler ;
    - `restoreCountLine(line)`, qui garde l'ancien `updatedAt`.
  - `requestPersistence(): Promise<boolean>`.
- Produit, dans `referencesSync.ts` :
  - `syncReferences(fetchFn = fetch): Promise<{updated:boolean, version:string}>`. Elle lit `import.meta.env.BASE_URL + 'data/references.json'`. Elle ne fait rien si `settings.referencesVersion` est identique. Sinon elle appelle `mergeReferences` avec `depart.json`, écrit le tout dans **une seule transaction**, puis enregistre la version.
  - `seedFdj(): Promise<void>` : insère `fdj.json` comme produits `source:'depart'`, `kind:'jeu-fdj'`, une seule fois (indicateur `settings.fdjSeeded`).

- [ ] **Étape 1 : données de départ.**
  - `depart.json` : environ 40 références parmi les plus vendues, chacune avec origine, force de 1 à 5 et étiquettes de goût prises dans le vocabulaire fermé `doux, léger, équilibré, corsé, intense, boisé, épicé, terreux, vanillé, fruité, crémeux, torréfié, herbacé`. `ref` doit correspondre exactement à une ligne de `references.json` : à vérifier par un test.
  - `fdj.json` : les jeux de grattage en vente d'après la gamme publiée sur fdj.fr au jour de l'implémentation, avec `name`, `ticketPrice`, `maxPrize` et `gameType ∈ {classique, gros lot, thématique, multi-chances}`. **Pas de codes-barres.** Noter la date de vérification dans `fdj.json` (`checkedAt`).
- [ ] **Étape 2 : écrire les tests qui échouent**, avec `fake-indexeddb/auto`.
  - `syncReferences` avec un fetch simulé (fichier de 3 références) : 3 produits ; un second appel donne `updated:false`.
  - Après `patchUserFields(id,{tasteTags:['doux']})`, un nouveau fichier avec un prix différent garde `user.tasteTags` et remplace `base.price`.
  - `deleteCountLine` puis `restoreCountLine` rendent la ligne avec son `updatedAt` d'origine.
  - Chaque `ref` de `depart.json` existe dans `public/data/references.json`.
  - `seedFdj()` appelée deux fois ne crée pas de doublons.
- [ ] **Étape 3 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent**.
- [ ] **Étape 4 : branchement au démarrage.** `main.tsx` lance `requestPersistence()`, `syncReferences()` et `seedFdj()` sans bloquer l'affichage. En cas d'échec, l'erreur est notée dans la console et l'app continue avec les données en place.
- [ ] **Étape 5 : commit** `feat(data): base IndexedDB, synchronisation de la liste officielle, jeux FDJ de départ`.

### Tâche 6 : moteur de remplaçants

**Fichiers :** `src/domain/substitutes.ts`, `tests/unit/substitutes.test.ts`

**Interfaces :**
- Consomme : `effectiveFields`, `currentPrice`, `officialState`.
- Produit :
  - `type Reason = 'épinglé'|'même force'|'force proche'|'même format'|'goût proche'|'prix ±0,50 €'|'même origine'|'même marque'|'même prix de ticket'|'même type de jeu'` ;
  - `type Suggestion = { product: Product; score: number; reasons: Reason[] }` ;
  - `suggestSubstitutes(target: Product, all: Product[], today: Date, limit = 5): Suggestion[]`.

- [ ] **Étape 1 : écrire les tests qui échouent.** Les barèmes sont ceux du §6 de la spec.
  - Même force, même format, goûts identiques, même prix : score 95, sans origine ni marque.
  - Une force sans valeur ne donne ni points ni raison.
  - Les produits `outOfStock`, la cible elle-même, les autres familles et les produits `officialState === 'retire'` sont exclus.
  - Entre cigare et cigarillo : le cigarillo est accepté avec une pénalité de 10 points.
  - Les épinglés viennent en tête, dans l'ordre de `pinnedSubstitutes`, avec la raison `'épinglé'`, même avec un score plus faible. Un épinglé en rupture reste exclu.
  - Jeux FDJ : même prix de ticket et même type donnent au moins 80 points. Gain maximum 500 000 contre 250 000 : la composante vaut 10.
  - Le résultat contient au plus `limit` éléments en plus des épinglés.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent**.
- [ ] **Étape 3 : commit** `feat(domain): moteur de remplaçants avec raisons`.

### Tâche 7 : maquette complète et audit UX/UI n° 1, avant le code des écrans

La spec (§12) demande un audit de la maquette **avant** le code. Les corrections retenues ici deviennent des exigences des Tâches 8 à 12.

**Fichiers :** `docs/audits/maquette/index.html` (publié en page Artifact), `docs/audits/2026-audit-1.md`

- [ ] **Étape 1 : maquette statique HTML** en style A, sur des téléphones de 390 × 844, en clair et en sombre, avec des données d'exemple réalistes (vrais libellés tirés de `references.json`, jeux de `fdj.json`). Elle contient tous les écrans clés :
  - Scanner, avec la caméra refusée ;
  - Nouveau produit, avec Créer ou Rattacher ;
  - Catalogue, avec les filtres ;
  - Fiche produit ;
  - Remplaçants ;
  - Comparer ;
  - Grattage avec 30 lignes ;
  - Pavé numérique ;
  - « C'est quel jeu ? » ;
  - aperçu d'export ;
  - Réglages ;
  - bandeau de rappel de sauvegarde.
- [ ] **Étape 2 : audit.**
  - Grille : heuristiques de Nielsen et contexte du comptoir (une main, reflets de la vitrine, interruptions par les clients, rapidité, erreurs de saisie).
  - Contrastes WCAG calculés sur les tokens, dans les deux modes.
  - Nombre de taps des 4 parcours clés : comptage de 30 jeux, remplaçant, export Drive, sauvegarde.
  - Chaque problème a une gravité (bloquant, majeur, mineur) et une correction proposée.
- [ ] **Étape 3 : corriger.** Intégrer à la maquette les corrections des problèmes bloquants et majeurs. Lister dans `2026-audit-1.md` les exigences qui en découlent, chacune rattachée à sa tâche (8 à 12). Les implémenteurs de ces tâches lisent ce fichier.
- [ ] **Étape 4 : publier** la maquette et le rapport en page Artifact, puis commit `docs: maquette complète et audit UX/UI n°1`.

### Tâche 8 : scanner

**Fichiers :** `src/features/scanner/useBarcodeScanner.ts`, `ScannerView.tsx`, `feedback.ts`, `scanRouter.ts`, `public/zxing/zxing_reader.wasm`, `tests/unit/scanRouter.test.ts`, `tests/e2e/scanner.spec.ts`

**Interfaces :**
- Consomme : `resolveScan`, `createScanDebouncer` (Tâche 2), `db` (Tâche 5), exigences de `docs/audits/2026-audit-1.md`.
- Produit :
  - `useBarcodeScanner(opts:{ active: boolean; onCode:(code:string)=>void }): { videoRef; state:'idle'|'starting'|'running'|'denied'|'unsupported'; torch?:{on:boolean; toggle():void} }`.
    - Il utilise `window.BarcodeDetector` si `getSupportedFormats()` contient `ean_13` ; sinon il importe `barcode-detector/ponyfill` et appelle `setZXingModuleOverrides({ locateFile: () => import.meta.env.BASE_URL + 'zxing/zxing_reader.wasm' })`.
    - Formats : `ean_13, ean_8, upc_a, code_128, itf, code_39`.
    - Détection sur une frame toutes les 150 ms.
    - Caméra `facingMode:'environment'`.
  - `<ScannerView mode:'lookup'|'count' onResult:(r:ScanResult)=>void paused?:boolean />` : vidéo plein cadre, bande de visée, bouton « Saisir le code », bouton lampe si disponible.
  - `beep(): void` (WebAudio, 1 200 Hz pendant 80 ms) et `vibrate(): void` (`navigator.vibrate?.(40)`).
  - `routeScan(result: ScanResult, tab: 'lookup'): Navigation`, avec `type Navigation = {to:'product', id} | {to:'create', code} | {to:'attach', code} | {to:'which-game', code, candidateIds}`.
  - **Point d'entrée pour les tests** : si `import.meta.env.MODE !== 'production'` ou si `localStorage['carotte:test'] === '1'`, alors `window.__carotteScan(code)` injecte un code comme s'il venait de la caméra.
- [ ] **Étape 1 : copier le wasm.** Script `postinstall` qui copie `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` vers `public/zxing/`. Vérifier le chemin réel dans le paquet installé.
- [ ] **Étape 2 : écrire les tests qui échouent.**
  - Tests unitaires de `routeScan`, un par variante de `ScanResult`.
  - E2E, avec le point d'entrée de test et une base vide :
    - `__carotteScan('3017620422003')` ouvre « Nouveau produit » avec le code pré-rempli et deux choix, « Créer la fiche » et « Rattacher à une référence officielle » ;
    - après création, le même scan ouvre la fiche ;
    - caméra refusée (contexte Playwright sans permission) : le texte « Autorisez l'appareil photo » et le bouton « Saisir le code » sont visibles.
- [ ] **Étape 3 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.** Quand le scan réussit, `<Carotte bounce>` est déclenché, ainsi que `beep()` et `vibrate()`.
- [ ] **Étape 4 : écran `AttachToReference`.** Recherche dans les produits `source:'douane'`. Choisir une référence ajoute le code à `user.barcodes`.
- [ ] **Étape 5 : commit** `feat(scanner): lecture caméra hors ligne, saisie manuelle, création et rattachement`.

### Tâche 9 : catalogue, fiche, remplaçants, comparaison

**Fichiers :** `src/features/catalog/*`, `src/ui/Sheet.tsx`, `tests/e2e/catalog.spec.ts`

**Interfaces :**
- Consomme : le repo de la Tâche 5, `suggestSubstitutes`, `currentPrice`, `officialState`.
- Produit :
  - `<ProductSheet id />` ;
  - `<ProductForm id? initialCode? />` : création en couche `user` ou modification. Chaque champ dont la valeur vient de `base` affiche la valeur officielle et un bouton « Revenir à la valeur officielle » quand `user` la remplace.
  - `<CompareView ids />`.

- [ ] **Étape 1 : écrire le test e2e qui échoue.** Base de départ injectée par `window.__carotteSeed(json)` (même condition que le point d'entrée de scan).
  - La recherche « dunhill » affiche les produits Dunhill. La pastille « Cigares » filtre.
  - Ouvrir un produit, activer « En rupture », toucher « Proposer un remplaçant » : au moins 1 suggestion, avec des pastilles de raisons visibles, et aucun produit en rupture. Le tout en **2 taps** au plus depuis la fiche (critère de réussite).
  - Épingler une suggestion : elle passe en tête avec « épinglé ».
  - Modifier le goût, puis toucher « Revenir à la valeur officielle » : la valeur `base` revient.
  - Cocher 2 produits puis « Comparer » : le tableau surligne les différences (classe `diff`).
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que le test passe.**
  - Recherche insensible aux accents (NFD), sur le nom, la marque et les codes, limitée à 100 résultats affichés.
  - Pastilles « Nouveau au 1er nov. » et « Retiré de la liste officielle » selon `officialState`.
- [ ] **Étape 3 : commit** `feat(catalogue): recherche, fiche, rupture, remplaçants épinglables, comparaison`.

### Tâche 10 : onglet Comptage grattage

**Fichiers :** `src/features/count/CountScreen.tsx`, `CountTable.tsx`, `NumericKeypad.tsx`, `WhichGameDialog.tsx`, `src/ui/Toast.tsx`, `src/domain/format.ts`, `tests/unit/keypad.test.tsx`, `tests/unit/format.test.ts`, `tests/e2e/count.spec.ts`

**Interfaces :**
- Consomme : le repo de la Tâche 5, `ScannerView` en mode `count` (Tâche 8), `resolveScan`, `learnFdjCode`.
- Produit :
  - `formatDateShort(ts: number): string` (`'16/10 18:42'`) ;
  - `formatStamp(ts: number): string` (`'2026-10-16-1842'`) ;
  - `<NumericKeypad initial:number onValidate:(n:number)=>void onCancel />` ;
  - `countTotal(lines: CountLine[]): number` ;
  - `sortLines(lines, by:'name'|'updatedAt'): CountLine[]`. Le tri par nom se fait avec `localeCompare(…,'fr')` ; le tri par date met les plus récentes d'abord.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - `formatDateShort(new Date(2026,9,16,18,42).getTime()) === '16/10 18:42'`.
  - `NumericKeypad` :
    - taper `0`, `0`, `7` puis Valider appelle `onValidate(7)` ;
    - tout effacer désactive le bouton Valider ;
    - une sixième touche est ignorée (plafond de 99 999) ;
    - la valeur initiale est affichée, et la première frappe la remplace.
  - E2E, la scène de départ contenant le jeu « Cash » avec le préfixe `0417` :
    1. « + Ligne » : nom « Millionnaire », quantité 12. La ligne apparaît avec la date du jour au format `JJ/MM HH:MM`.
    2. `__carotteScan('04170012345678')` : la ligne « Cash » est ajoutée et le pavé s'ouvre. Taper 38 puis Valider : quantité 38.
    3. Un deuxième scan du même jeu, 2 s plus tard : la ligne s'illumine (classe `hit`) et le pavé s'ouvre sur 38.
    4. **Pendant que le pavé est ouvert**, `__carotteScan('04170099999999')` n'ouvre pas de second pavé et ne change aucune ligne.
    5. Toucher le nom « Millionnaire » le rend modifiable : le nom devient « Millionnaire 10€ » et la date de la ligne change.
    6. Glisser pour supprimer : le toast « Ligne supprimée · Annuler » apparaît ; Annuler fait revenir la ligne.
    7. La ligne Total affiche la somme.
    8. Le tri « Date » met la ligne la plus récente en premier.
    9. Code non EAN inconnu, alors que des jeux existent : dialogue « C'est quel jeu ? ». Choisir « Cash » apprend le préfixe, et le code suivant au même préfixe est reconnu sans dialogue.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.**
  - En-tête collant.
  - Colonne Quantité alignée à droite, en gras, avec des zones à toucher de 48 px.
  - Le scan continu est **mis en pause** (`paused`) tant que le pavé ou un dialogue est ouvert.
- [ ] **Étape 3 : commit** `feat(grattage): tableau de comptage, pavé, scan continu, annulation`.

### Tâche 11 : export .jpg et partage

**Fichiers :** `src/domain/exportLayout.ts`, `src/features/count/exportJpg.ts`, `src/share.ts`, `tests/unit/exportLayout.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces :**
- Consomme : `CountLine`, `Settings`, `formatDateShort`, `formatStamp`, `sortLines`, `countTotal`.
- Produit :
  - `type ExportLayout = { width: number; height: number; scale: number; rows: {y:number; cells:[string,string,string,string]}[]; header:{shop:string; title:'Comptage grattage'; stamp:string}; totalY:number; footerY:number }` ;
  - `layoutExport(lines: CountLine[], s: Settings, now: number, maxPixels = 16_777_216): ExportLayout`. Largeur logique de 1080, `scale` 2 par défaut, réduit tant que `width*scale × height*scale > maxPixels`.
  - `renderExportJpg(layout: ExportLayout): Promise<Blob>` : dessin sur canvas, `toBlob('image/jpeg', 0.92)`.
  - `shareFile(file: File): Promise<'shared'|'cancelled'|'fallback'>`.
    - `navigator.canShare?.({files:[file]})` vrai : `navigator.share({files:[file], title:file.name})`. Une `AbortError` donne `'cancelled'`.
    - Sinon : un aperçu plein écran de l'image avec le texte « Appui long sur l'image pour l'enregistrer » et un lien de téléchargement `download=file.name`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - 5 lignes : `height` couvre l'en-tête, l'entête du tableau, 5 lignes, le total et le pied de page, et `rows.length === 5`.
  - Les cellules suivent le tri `settings.sortCount`.
  - `stamp` vaut `'16/10/2026 18:42'`.
  - **`layoutExport réduit l'échelle au-delà de la limite iOS`** : 300 lignes donnent `scale < 2`, `width*scale*height*scale <= 16_777_216`, et `rows.length === 300`.
  - E2E : avec 3 lignes, cliquer « Export .jpg » sans `navigator.share` (Chromium headless) affiche l'aperçu. L'image est un JPEG dont la largeur naturelle vaut 2160 (lue avec `img.naturalWidth`), et le lien a l'attribut `download` qui correspond à `^comptage-grattage-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$`.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.**
  - Contenu de l'image : bandeau bordeaux avec la carotte, nom du tabac, « Comptage grattage », date et heure, tableau de 4 colonnes, total, pied « Exporté avec La Carotte ».
  - Les polices sont chargées avant de dessiner (`document.fonts.load`).
  - Après le partage, un tampon « Comptage exporté ✓ » apparaît.
- [ ] **Étape 3 : commit** `feat(export): image .jpg de toute la page et menu Partager`.

### Tâche 12 : Réglages, sauvegarde, restauration, guide d'installation

**Fichiers :** `src/domain/backup.ts`, `src/features/settings/*`, `src/ui/Banner.tsx`, `tests/unit/backup.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces :**
- Produit :
  - `type BackupFile = { app:'la-carotte'; schema:1; exportedAt:number; products:Product[]; countLines:CountLine[]; settings:Settings }` ;
  - `serializeBackup(data): string` ;
  - `parseBackup(text: string): { ok:true; data:BackupFile } | { ok:false; error:string }` ;
  - `restoreBackup(data: BackupFile): Promise<void>` : remplacement complet en **une seule transaction** Dexie ;
  - `needsBackupReminder(s: Settings, now: number): boolean` : vrai si plus de 7 jours sont passés depuis `lastBackupAt`, ou s'il n'y a jamais eu de sauvegarde alors que des lignes de comptage existent.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Aller-retour serialize puis parse : les données sont identiques.
  - **`parseBackup rejette…`** :
    - un texte non JSON donne `error:'Ce fichier n’est pas une sauvegarde La Carotte.'` ;
    - `app` différent donne le même message ;
    - `schema:2` donne `'Cette sauvegarde vient d’une version plus récente de l’app.'` ;
    - `countLines` absent ou une quantité négative donnent `'Sauvegarde incomplète ou abîmée.'`.
  - Dans chacun de ces cas, la base reste identique (test avec fake-indexeddb).
  - Rappel : `needsBackupReminder` vaut vrai à 8 jours et faux à 6 jours.
  - E2E : « Sauvegarde complète » produit un fichier `la-carotte-sauvegarde-AAAA-MM-JJ.json` (par l'aperçu de repli) et met `lastBackupAt` à jour. « Restaurer » demande de confirmer « Remplacer toutes les données ? » ; après confirmation, les lignes du fichier apparaissent dans Grattage.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.**
  - L'écran contient :
    - le nom du tabac ;
    - la version de la liste officielle et sa date d'effet ;
    - « Installer sur mon téléphone » (étapes illustrées en SVG, pour Safari iPhone : Partager → Sur l'écran d'accueil ; pour Chrome Android : ⋮ → Installer l'application) ;
    - « Mise à jour disponible », qui recharge à l'aide de `useRegisterSW`.
  - Le bandeau de rappel de sauvegarde s'affiche en haut de Grattage.
- [ ] **Étape 3 : commit** `feat(reglages): sauvegarde, restauration, rappel, guide d'installation`.

### Tâche 13 : finitions ludiques et audit n° 2 de l'app terminée

**Fichiers :** `src/ui/*`, `src/theme/*`, `docs/audits/2026-audit-2.md`

- [ ] **Étape 1 : vérifier les moments ludiques** et les compléter au besoin :
  - rebond de la carotte au scan ;
  - surbrillance laiton de la ligne modifiée (0,6 s) ;
  - tampon « Comptage exporté ✓ » ;
  - aucun de ces effets sous `prefers-reduced-motion` (test e2e avec `reducedMotion:'reduce'` : aucune `animation-name` active sur `.carotte`).
- [ ] **Étape 2 : audit n° 2**, avec la même grille que l'audit n° 1, sur des captures Playwright de tous les écrans (`tests/e2e/audit-shots.spec.ts`, 390 × 844, clair et sombre), et la version de production (`npm run build && npm run preview`). On y ajoute :
  - le score Lighthouse PWA et accessibilité (Chromium local, `npx lighthouse` si disponible, sinon les contrôles manuels du manifest et du service worker) ;
  - un test hors ligne : passer le contexte Playwright en `offline` après le premier chargement, recharger, puis vérifier que Grattage fonctionne.
- [ ] **Étape 3 : corriger** les problèmes bloquants et majeurs, publier le rapport en Artifact, et commit `docs: audit UX/UI n°2`.

### Tâche 14 : mise en ligne

- [ ] **Étape 1 : vérification complète** : `npm test && npm run e2e && npm run build`, tout au vert.
- [ ] **Étape 2 :** demander au propriétaire de rendre le dépôt public et de choisir Settings → Pages → Source « GitHub Actions ». C'est une action de sa part : l'agent n'en a pas les droits.
- [ ] **Étape 3 :** avec l'accord du propriétaire, ouvrir la PR `claude/la-carotte-app → main`. Après la fusion, le workflow déploie le site. Vérifier que `https://wongmichel2048.github.io/buraliste/` répond et que `data/references.json` est servi.
- [ ] **Étape 4 :** test au comptoir par le propriétaire, sur iPhone et Android, avec la liste de contrôle du README :
  - installation ;
  - scan d'un paquet ;
  - 2 tickets d'un même jeu ;
  - export vers Drive ;
  - sauvegarde.

  Ses retours alimentent une V1.1.
