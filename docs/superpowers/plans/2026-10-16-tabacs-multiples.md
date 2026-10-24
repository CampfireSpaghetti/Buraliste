# Tabacs multiples et partage automatique : plan de développement

> **Pour les agents qui exécutent ce plan :** SOUS-COMPÉTENCE REQUISE : superpowers:subagent-driven-development (recommandée) ou superpowers:executing-plans, tâche par tâche. Les étapes sont des cases à cocher (`- [ ]`).

**But :**
- Plusieurs tabacs sur l'app, chacun avec ses employés.
- Au sein d'un tabac, tout se partage automatiquement et en chiffrement de bout en bout, par un relais Cloudflare gratuit.
- Aucun compte pour les utilisateurs.

**Architecture :**
- **Le relais** (`relay/`) est un Worker avec une base D1. Il stocke des messages chiffrés, un canal par tabac, et transmet les codes-barres à GitHub.
- **Le téléphone :**
  - un registre de tabacs, avec une base IndexedDB par tabac ;
  - une couche d'écriture unique qui produit des opérations horodatées (HLC) ;
  - une fusion « le plus récent gagne », champ par champ ;
  - un moteur de synchronisation (envoi par lots, réception toutes les 10 s, photographie).

**Technologies :**
- WebCrypto (AES-256-GCM, HMAC-SHA256, SHA-256) ;
- Dexie (bases par tabac) ;
- Cloudflare Workers et D1, déployés avec `wrangler` ;
- Vitest et Playwright, avec un faux relais local pour les tests de bout en bout.

**Spec :** `docs/superpowers/specs/2026-10-16-tabacs-multiples-design.md`, approche B validée le 16/10/2026. Pour les règles générales, voir aussi `2026-10-16-la-carotte-design.md`.

## Contraintes globales

- **Langue** : interface en français.
- **Comptes** : aucun pour les gérants et les employés ; seul l'administrateur a un compte Cloudflare.
- **Coût** : 0 €, dans les quotas gratuits.
- **Chiffrement côté téléphone uniquement** :
  - `cle` = 32 octets aléatoires ;
  - `canal` = base64url des 16 premiers octets de SHA-256(`cle` ‖ « canal ») ;
  - `ecriture` = base64url de HMAC-SHA256(`cle`, « ecriture ») ;
  - messages AES-256-GCM avec un IV aléatoire de 12 octets.
- **Le relais ne voit jamais** la clé ni un contenu en clair. Il ne stocke que SHA-256(`ecriture`).
- **Limites du relais** :
  - 64 Ko par requête, 200 messages par envoi ;
  - 120 requêtes par minute et par canal ;
  - `/v1/codes` : 20 requêtes par heure et par IP, 200 codes par requête.
- **CORS du relais** : le Worker déployé n'autorise que `https://exemple.github.io`. Seul le faux relais local des tests autorise `http://localhost:4173`.
- **CSP de l'app** : `connect-src 'self' <VITE_RELAY_URL>`, sans aucune autre origine. `api.github.com` est retiré, car les téléphones ne parlent plus à GitHub.
- **Partagé dans un tabac** :
  - `line` : `gameId`, `code`, `name`, `linearQty`, `stockQty`, `updatedAt`, `deleted` ;
  - `product` : `user.<champ>`, `outOfStock`, `pinnedSubstitutes`, et `source`/`base` pour les fiches créées à la main ;
  - `settings` : `shopName`, `sortCount`, `hiddenGames`.
- **Jamais partagés** : la clé, `shareToken`, l'état de sauvegarde, l'onglet ouvert, les versions des listes publiques.
- **Délais** :
  - envoi 2 s après la dernière écriture, plus au démarrage, au retour du réseau et au retour au premier plan ;
  - réception toutes les 10 s quand l'app est visible ;
  - photographie au-delà de 500 messages depuis la précédente.
- **Sans `VITE_RELAY_URL`** (relais non configuré) : l'app se comporte comme aujourd'hui, et les options de partage affichent « Bientôt disponible ».
- **Le tabac actuel du téléphone** (base `la-carotte`) devient le tabac `principal`, sans aucune perte de données.

## Points d'attention en revue

1. **Deux téléphones modifient la même ligne hors ligne, puis se reconnectent.** Les deux doivent converger vers la valeur la plus récente, champ par champ, quel que soit l'ordre d'arrivée. → Tâche 7, test `deux moteurs convergent`.
2. **Message illisible** (mauvaise clé ou contenu falsifié) : il est ignoré, et la synchronisation continue avec les messages suivants. → Tâche 7, test `message falsifié ignoré`.
3. **Relais en panne** (500, 429, réseau coupé) : les opérations restent en file, l'attente croît jusqu'à 5 minutes, l'indicateur passe au rouge, et rien n'est perdu. → Tâche 7, test `relais en panne`.
4. **Un nouveau téléphone rejoint un tabac qui a un long historique** : il lit la photographie, puis seulement les messages qui suivent. → Tâche 7, test `rejoindre après photographie`.
5. **Une ligne supprimée reçoit ensuite une modification plus ancienne** : elle reste supprimée. → Tâche 4, test `suppression gagne sur plus ancien`.

---

## Arborescence

```
relay/src/handlers.ts      ← logique du relais (indépendante de Cloudflare), interface Store
relay/src/memoryStore.ts   ← Store en mémoire (tests, faux relais local)
relay/src/d1Store.ts       ← Store D1
relay/src/index.ts         ← point d'entrée du Worker (fetch → handlers)
relay/schema.sql  relay/wrangler.toml
scripts/mock-relay.ts      ← faux relais local sur le port 8787 (tests de bout en bout)
src/sync/crypto.ts  src/sync/hlc.ts  src/sync/merge.ts  src/sync/relayClient.ts  src/sync/engine.ts
src/tabacs/registry.ts     ← registre des tabacs (localStorage) et QR code LACAROTTE2
src/data/db.ts             ← base du tabac courant ; tables opsOut et syncState (v4)
src/data/sharedRepo.ts     ← écritures partagées : appliquer localement + mettre en file l'opération
src/ui/TabacSwitcher.tsx  src/ui/SyncDot.tsx  src/features/settings/TabacSection.tsx
tests/unit/relay.test.ts  tests/unit/syncCrypto.test.ts  tests/unit/merge.test.ts  tests/unit/registry.test.ts
tests/unit/sharedRepo.test.ts  tests/unit/engine.test.ts
tests/e2e/tabacs.spec.ts   ← deux navigateurs, soit deux téléphones
```

---

### Tâche 1 : logique du relais et Store en mémoire

**Fichiers :** `relay/src/handlers.ts`, `relay/src/memoryStore.ts`, `tests/unit/relay.test.ts`

**Interfaces produites :**
- `interface Store` :
  - `getChannel(canal): Promise<{ ecritureHash: string } | null>` ;
  - `createChannel(canal, ecritureHash, now)` ;
  - `appendMessages(canal, msgs: {iv: string; data: string}[], now): Promise<number>`, qui renvoie le dernier `n` ;
  - `listMessages(canal, after: number, max: number): Promise<{ n: number; iv: string; data: string }[]>` ;
  - `lastN(canal): Promise<number>` ;
  - `putPhoto(canal, {jusqua, iv, data}, now)` ;
  - `getPhoto(canal): Promise<{ jusqua; iv; data } | null>` ;
  - `pruneBefore(canal, n: number, olderThan: number)`, qui supprime les messages `≤ n` reçus avant `olderThan`.
- `createMemoryStore(): Store`.
- `handle(req: Request, env: { store: Store; githubToken?: string; githubRepo: string; now: () => number; fetch: typeof fetch; allowedOrigins: string[] }): Promise<Response>`. Il implémente les routes du §4.1 de la spec, le CORS (y compris la requête de pré-vérification `OPTIONS`) et les limites des contraintes globales. Les compteurs de limites sont gardés en mémoire du Worker, ce qui suffit pour la V1.

- [ ] **Étape 1 : écrire les tests qui échouent** (`tests/unit/relay.test.ts`).
  - Premier `POST /v1/canaux/c1/messages` avec `{ ecriture:'w1', messages:[{iv:'a',data:'b'}] }` : 200 `{dernier:1}`.
  - Puis `GET /v1/canaux/c1/messages?apres=0` : `{messages:[{n:1,iv:'a',data:'b'}], dernier:1}`.
  - `POST` avec `ecriture:'autre'` : 403.
  - `GET` sur un canal inconnu : `{messages:[], dernier:0}`.
  - Pagination : 600 messages, `max=500`, donne 500 messages et `dernier` = 600.
  - Plus de 200 messages ou un corps de plus de 64 Ko : 413.
  - Plus de 120 requêtes par minute sur un canal : 429.
  - `PUT /photo`, puis `GET /photo` : renvoie l'objet ; `GET /photo` sur un canal sans photographie : 404.
  - `PUT /photo` avec une mauvaise clé d'écriture : 403.
  - `POST /v1/codes` avec 2 items : appelle `env.fetch('https://api.github.com/repos/exemple/Buraliste/issues', …)`, avec l'en-tête `Authorization: Bearer <githubToken>` et un titre `[codes-barres] 2 codes`. Réponse 202.
  - Sans `githubToken` : 503. Plus de 200 items : 413. Plus de 20 requêtes par heure depuis la même IP (`CF-Connecting-IP`) : 429.
  - Ménage : un `PUT /photo` supprime les messages couverts par la photographie précédente et reçus il y a plus de 30 jours ; ceux de moins de 30 jours restent lisibles.
  - CORS : `Origin: https://exemple.github.io` est renvoyé dans `Access-Control-Allow-Origin`. Une autre origine donne 403. `OPTIONS` donne 204.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent** : `npx vitest run tests/unit/relay.test.ts`.
  - `buildIssue` est réutilisé depuis `src/domain/sharing.ts` (import `.ts`).
  - L'empreinte de la clé d'écriture se calcule avec `crypto.subtle.digest('SHA-256')`.
- [ ] **Étape 3 : commit** `feat(relais): logique du relais (canaux chiffrés, photographie, codes-barres)`.

### Tâche 2 : Worker Cloudflare, D1, déploiement et faux relais local

**Fichiers :** `relay/src/d1Store.ts`, `relay/src/index.ts`, `relay/schema.sql`, `relay/wrangler.toml`, `scripts/mock-relay.ts`, `.github/workflows/deploy.yml`, `README.md`, `tests/unit/d1Store.test.ts`

**Interfaces :**
- Consomme : `Store` et `handle` (Tâche 1).
- Produit :
  - `createD1Store(db: D1Database): Store` ;
  - export par défaut `{ fetch(req, env) }`. L'`env` du Worker contient `DB`, `GITHUB_TOKEN` et `ALLOWED_ORIGINS`.
  - `scripts/mock-relay.ts`, lancé par `node scripts/mock-relay.ts`, sert `handle` avec `createMemoryStore()` sur `http://localhost:8787`, avec les origines `http://localhost:4173`.

- [ ] **Étape 1 :** `relay/schema.sql` reprend le SQL du §4.2 de la spec. `relay/wrangler.toml` contient `name = "la-carotte-relais"`, `main = "src/index.ts"`, `compatibility_date = "2026-09-01"` et `[[d1_databases]] binding = "DB", database_name = "la-carotte"`.
- [ ] **Étape 2 : test.** `tests/unit/d1Store.test.ts` vérifie que `createD1Store` passe les mêmes tests de contrat que le Store en mémoire, sur une fausse D1 construite avec `sql.js` (dépendance de développement). Sinon, on factorise les tests de contrat en `storeContract(makeStore)`, appelés pour les deux.
- [ ] **Étape 3 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent**.
- [ ] **Étape 4 : workflow.** Ajouter le job `relay`, qui tourne si le secret `CLOUDFLARE_API_TOKEN` existe :
  1. `npx wrangler d1 create la-carotte` (sans effet s'il existe déjà) ;
  2. `wrangler d1 execute --file relay/schema.sql` ;
  3. `wrangler secret put GITHUB_TOKEN` à partir de `RELAY_GITHUB_TOKEN` ;
  4. `wrangler deploy` ;
  5. affichage de l'adresse dans le résumé du job.

  Le job `build-deploy` dépend de `relay` quand il existe, et passe `VITE_RELAY_URL: ${{ vars.RELAY_URL }}` au build.
- [ ] **Étape 5 : README.** Section « Mettre en service le partage entre téléphones (administrateur) », reprenant le §7 de la spec pas à pas.
- [ ] **Étape 6 : commit** `feat(relais): Worker Cloudflare, base D1, déploiement et faux relais local`.

### Tâche 3 : chiffrement, horloge HLC, QR code de tabac

**Fichiers :** `src/sync/crypto.ts`, `src/sync/hlc.ts`, `src/tabacs/registry.ts` (partie QR code), `tests/unit/syncCrypto.test.ts`

**Interfaces produites :**
- `generateTabacKey(): string`, qui renvoie la clé en base64url ;
- `deriveChannel(key: string): Promise<{ canal: string; ecriture: string }>` ;
- `encryptJson(key: string, value: unknown): Promise<{ iv: string; data: string }>` ;
- `decryptJson(key: string, msg: { iv: string; data: string }): Promise<unknown | undefined>`, qui renvoie `undefined` si le déchiffrement échoue ;
- `createHlc(deviceId: string, now?: () => number): { tick(): string; observe(t: string): void }`. Le format est `"<ms 13 chiffres>-<compteur 4 chiffres>-<deviceId>"` : comparer deux horodatages comme des chaînes respecte l'ordre ;
- `encodeTabacInvite(t: { name: string; key: string }): string`, qui commence par `LACAROTTE2:` ;
- `decodeTabacInvite(text): { name; key } | undefined`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Chiffrement aller-retour, et une IV différente à chaque appel.
  - Un `data` modifié d'un caractère donne `undefined`, comme une autre clé.
  - `deriveChannel` est déterministe : même clé, même résultat ; deux clés, deux canaux. `canal` fait 22 caractères.
  - HLC :
    - `tick()` est strictement croissant, même si `now()` recule ;
    - après `observe` d'un horodatage plus grand, `tick()` reste supérieur.
  - Invitation : aller-retour ; un texte `LACAROTTE1:…` ou quelconque donne `undefined`.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent**.
- [ ] **Étape 3 : commit** `feat(sync): chiffrement de bout en bout, horloge HLC, invitation de tabac`.

### Tâche 4 : fusion « le plus récent gagne »

**Fichiers :** `src/sync/merge.ts`, `tests/unit/merge.test.ts`

**Interfaces :**
- Consomme : le format HLC (Tâche 3).
- Produit :
  - `type Op = { e: 'line' | 'product' | 'settings'; id: string; f: Record<string, unknown>; t: string }` ;
  - `type Clocked<T> = T & { _clock?: Record<string, string> }` ;
  - `applyFields<T extends object>(record: Clocked<T> | undefined, f: Record<string, unknown>, t: string): { record: Clocked<T>; changed: boolean }`. Les clés `user.<champ>` écrivent dans `record.user`, et `null` efface le champ ;
  - `diffFields(before: object | undefined, after: object, keys: string[]): Record<string, unknown>`. Il sert à produire `f` lors d'une écriture locale et aplatit `user` en `user.<champ>`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Appliquer `{linearQty: 5}` à `t1`, puis `{linearQty: 3}` à `t0 < t1` : il reste 5. Dans l'autre ordre, c'est pareil.
  - Deux champs différents modifiés par deux opérations concurrentes : les deux sont conservés.
  - **`suppression gagne sur plus ancien`** : `{deleted:true}` à `t2`, puis `{linearQty: 9}` à `t1` : il reste `deleted: true`, et `linearQty` vaut 9, car ce champ est plus récent que son propre horodatage précédent.
  - `user.tasteTags: null` efface le champ.
  - `diffFields` :
    - entre `{user:{name:'A'}, outOfStock:false}` et `{user:{name:'B'}, outOfStock:true}`, il donne `{'user.name':'B', outOfStock:true}` ;
    - un champ retiré de `user` donne `null`.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent**.
- [ ] **Étape 3 : commit** `feat(sync): fusion champ par champ (le plus récent gagne)`.

### Tâche 5 : registre des tabacs et une base par tabac

**Fichiers :** `src/tabacs/registry.ts`, `src/data/db.ts`, `src/main.tsx`, `tests/unit/registry.test.ts`

**Interfaces produites :**
- `type TabacEntry = { id: string; name: string; key: string; addedAt: number }`. La clé est **toujours** générée automatiquement (`generateTabacKey`, Tâche 3) : à la création, et par `ensureRegistry` pour `principal`. Aucun écran ne demande de clé.
- Le registre est stocké dans `localStorage['carotte:tabacs']` sous la forme `{ current: string; tabacs: TabacEntry[] }`.
  - `listTabacs()`, `currentTabac(): TabacEntry`.
  - `addTabac(name, key?: string): TabacEntry`, avec un `id` aléatoire ; sans `key` (création), une clé neuve est générée ; avec `key` (rejoindre), elle est reprise.
  - `setCurrentTabac(id)`, `renameTabac(id, name)`, `removeTabac(id)`.
  - `ensureRegistry(defaultName: string)` : au premier lancement, crée l'entrée `{ id: 'principal', name: defaultName }` pour la base existante.
- `dbNameFor(id): string` : `'la-carotte'` pour `principal`, sinon `la-carotte-${id}`.
- `db.ts` : `export let db = openTabacDb(currentTabac().id)`. Version **4** de la base, avec les tables `opsOut: '++seq'` et `syncState: 'key'`.
- **Changer de tabac** : `setCurrentTabac(id)`, puis `location.reload()`. Au démarrage, la synchronisation des listes publiques (Douane, FDJ, codes partagés) s'applique à la base du tabac courant : un tabac neuf les reçoit donc à son premier lancement.

- [ ] **Étape 1 : écrire les tests qui échouent** (fake-indexeddb et `localStorage` de jsdom).
  - `ensureRegistry('Mon tabac')` crée `principal` comme tabac courant, avec une clé de 43 caractères ; un second appel ne change rien (même clé).
  - `dbNameFor('principal') === 'la-carotte'`.
  - Deux tabacs ont deux bases distinctes : une ligne écrite dans l'une est absente de l'autre.
  - `removeTabac(current)` est refusé tant qu'il n'y a pas d'autre tabac.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.** `main.tsx` appelle `ensureRegistry` avant tout accès à `db`.
- [ ] **Étape 3 : commit** `feat(tabacs): registre des tabacs et une base par tabac`.

### Tâche 6 : couche d'écriture partagée

**Fichiers :** `src/data/sharedRepo.ts`, `src/store.ts`, `src/data/db.ts`, `tests/unit/sharedRepo.test.ts`

**Interfaces :**
- Consomme : `Op`, `applyFields`, `diffFields` (Tâche 4) ; `createHlc` (Tâche 3) ; `db` (Tâche 5).
- Produit :
  - `SHARED_KEYS = { line: [...], product: [...], settings: ['shopName', 'sortCount', 'hiddenGames'] }`, comme dans les contraintes globales ;
  - `writeShared(e, id, next: object): Promise<void>`. Il calcule `f = diffFields(actuel, next, SHARED_KEYS[e])`, l'applique localement avec `t = hlc.tick()` (champs partagés horodatés, champs non partagés écrits tels quels), puis, si le relais est configuré (`VITE_RELAY_URL`), ajoute `{e,id,f,t}` à `opsOut` ;
  - `applyRemoteOps(ops: Op[]): Promise<number>`, qui applique les opérations et renvoie le nombre de changements ;
  - les `actions` de `store.ts` passent toutes par `writeShared` ;
  - `deleteCountLine` écrit `{deleted:true}`, et `listCountLines` filtre les lignes supprimées.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Relais configuré : `upsertCountLine` ajoute une opération `line` à `opsOut`, avec seulement les champs modifiés. Relais non configuré : rien n'est ajouté (la première photographie couvrira ces données).
  - `setOutOfStock` donne une opération `{outOfStock:true}`. `patchUserFields({tasteTags})` donne `{'user.tasteTags': [...]}`.
  - `saveSettings({lastBackupAt})` ne produit **aucune** opération, car ce champ n'est pas partagé. `saveSettings({shopName})` en produit une.
  - `applyRemoteOps` sur une ligne inconnue la crée ; sur une opération plus ancienne qu'un champ local, rien ne change.
  - `deleteCountLine` fait disparaître la ligne de `listCountLines`, et l'annulation la fait revenir.
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.** Toute la suite existante doit rester verte (`npm test`).
- [ ] **Étape 3 : commit** `feat(sync): toutes les écritures produisent des opérations partagées`.

### Tâche 7 : moteur de synchronisation

**Fichiers :** `src/sync/relayClient.ts`, `src/sync/engine.ts`, `tests/unit/engine.test.ts`

**Interfaces :**
- Consomme : `handle` et `createMemoryStore` (Tâche 1, pour un faux relais en mémoire dans les tests) ; Tâches 3 à 6.
- Produit :
  - `createRelayClient(base: string, fetchFn?)`, avec les méthodes `post`, `list`, `putPhoto`, `getPhoto` et `postCodes`, qui renvoient des `Response` ou du JSON ;
  - `createSyncEngine({ relay, key, now?, intervalMs = 10_000 }): { start(); stop(); syncNow(): Promise<void>; status(): 'ok'|'attente'|'hors-ligne'|'erreur'|'refuse' }`.
    - `start()` déclenche une synchronisation immédiate, puis toutes les `intervalMs` quand la page est visible, et aussi sur `online` et `visibilitychange` ; un envoi part 2 s après chaque ajout dans `opsOut` (événement `carotte:ops-queued`).
    - Il envoie `opsOut` par lots de 200 opérations au plus par message.
    - Il reçoit `apres = syncState.lastN`, déchiffre et applique les messages, puis met `lastN` à jour.
    - Au premier lancement, il lit la photographie, puis les messages qui la suivent.
    - Il publie une photographie quand `lastN - photoN > 500`, et aussi quand le canal est vide et sans photographie alors que la base locale a des données : c'est le cas de `principal` à la première mise en service du relais, sans aucune action du gérant.
    - Un 403 met le statut à `'refuse'` (« Ce téléphone n'a plus accès à ce tabac ») et arrête les tentatives ; les données locales restent.
    - En cas d'échec, il attend de plus en plus longtemps (10 s, 20 s, 40 s… jusqu'à 5 min).
    - Il émet l'événement `carotte:sync-status`.

- [ ] **Étape 1 : écrire les tests qui échouent.** Un faux relais : `fetchFn` appelle `handle` sur un Store en mémoire.
  - **`deux moteurs convergent`** :
    - deux bases A et B, même clé ;
    - A écrit `linearQty: 5` à `t1`, B écrit `linearQty: 7` à `t2`, alors que tous deux sont « hors ligne » ;
    - puis `syncNow()` sur A, sur B, puis sur A : les deux ont 7.
  - **`message falsifié ignoré`** : un message ajouté au canal avec un `data` invalide est sauté, et le suivant, valide, est appliqué.
  - **`relais en panne`** : avec un `fetchFn` qui renvoie 500, `status()` vaut `'erreur'`, `opsOut` est intact, et le délai suivant est de 20 s. Ensuite, un 200 vide la file.
  - **`rejoindre après photographie`** :
    - 510 messages sont écrits, et A publie une photographie ;
    - le relais supprime les anciens messages (`pruneBefore`) ;
    - une base C neuve avec la même clé obtient tout l'état à jour.
  - **`premier partage publie l'état`** : une base avec 3 lignes, jamais synchronisée ; après `syncNow()`, une base neuve avec la même clé obtient les 3 lignes.
  - **`accès refusé`** : un canal créé avec une autre clé d'écriture donne `status() === 'refuse'`, et aucune nouvelle tentative n'est programmée.
  - Le contenu stocké par le faux relais ne contient jamais de texte en clair (rechercher « Cash » dans les données donne 0 résultat).
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que les tests passent.**
- [ ] **Étape 3 : commit** `feat(sync): moteur de synchronisation (envoi, réception, photographie, reprise)`.

### Tâche 8 : codes-barres par le relais, retrait de la clé GitHub

**Fichiers :** `src/data/sharingData.ts`, `src/features/settings/SharingSection.tsx` (supprimé), `src/ui/PairingPrompt.tsx`, `index.html` / `vite.config.ts` (CSP), `tests/unit/shareData.test.ts`, `tests/e2e/sharing.spec.ts`

**Interfaces :**
- `flushOutbox(fetchFn?)` envoie la file à `POST <relais>/v1/codes` sans clé. Sans relais configuré, la file reste en attente (statut `'inactif'`).
- La CSP est injectée au build par un petit plugin Vite qui remplace `%RELAY_ORIGIN%` dans `index.html`. `api.github.com` est retiré.
- Le QR code `LACAROTTE1` n'est plus proposé. S'il est scanné, l'app répond « Ancien QR code : demandez une invitation de tabac ». `shareToken` est effacé au démarrage.

- [ ] **Étape 1 : adapter les tests existants** : `shareData.test.ts` vérifie l'envoi vers `<relais>/v1/codes`, sans en-tête `Authorization`. `sharing.spec.ts` est réécrit pour l'invitation de tabac en Tâche 9. Vérifier l'échec.
- [ ] **Étape 2 : implémenter**, **vérifier que les tests passent** (`npm test`).
- [ ] **Étape 3 : commit** `feat(partage): codes-barres envoyés par le relais, sans clé sur les téléphones`.

### Tâche 9 : interface (sélecteur, créer, inviter, rejoindre, indicateur)

**Fichiers :** `src/ui/TabacSwitcher.tsx`, `src/ui/SyncDot.tsx`, `src/features/settings/TabacSection.tsx`, `src/App.tsx`, `src/ui/PairingPrompt.tsx`, `playwright.config.ts`, `tests/e2e/tabacs.spec.ts`

**Interfaces :**
- Consomme : le registre (Tâche 5) ; le moteur (Tâche 7) ; `encodeTabacInvite` et `decodeTabacInvite` (Tâche 3).
- Le nom du tabac dans l'en-tête devient un bouton, qui ouvre « Mes tabacs » :
  - la liste des tabacs, avec une coche sur le tabac courant ;
  - « Créer un tabac » : on saisit le nom, et le tabac est partagé d'office ;
  - « Rejoindre un tabac » : explication, puis ouverture du Scanner.
- Réglages, section « Tabac » :
  - « Inviter un employé », qui affiche le QR code avec l'avertissement de la spec §3.2 ;
  - l'état de la synchronisation.
- `SyncDot` dans l'en-tête : vert, laiton, gris ou rouge, avec un `aria-label` de la forme « Synchronisation : à jour ».
- Le scan d'une invitation propose « Rejoindre le <nom> ? ». Après « Rejoindre » : `addTabac`, `setCurrentTabac`, rechargement, puis le moteur récupère l'état.
- `playwright.config.ts` :
  - le build utilise `VITE_RELAY_URL=http://localhost:8787` ;
  - un second `webServer` lance `node scripts/mock-relay.ts`.

- [ ] **Étape 1 : écrire le test e2e qui échoue** (`tests/e2e/tabacs.spec.ts`, deux contextes de navigateur A et B).
  - A crée « Tabac de la Gare », affiche « Inviter un employé », et le test lit la charge du QR code par `data-invite` (attribut présent seulement en mode test).
  - B scanne l'invitation (`__carotteScan`), accepte « Rejoindre le Tabac de la Gare ? », et le nom apparaît dans son en-tête.
  - A saisit `Cash` linéaire 38, stock 120. En moins de 15 s, B voit `Linéaire Cash : 38` (`syncNow` est déclenché en mode test par `window.__carotteSync()`).
  - B met un produit « En rupture » : A le voit.
  - A renomme le tabac : B voit le nouveau nom.
  - Avec B hors ligne (`context.setOffline(true)`), B modifie le stock de Cash à 90 ; de retour en ligne, A voit 90.
  - Le sélecteur de B permet de revenir au tabac `principal`, dont les données sont séparées (pas de « Linéaire Cash : 38 » dans `principal` si on n'y a rien saisi).
- [ ] **Étape 2 : vérifier l'échec**, **implémenter**, **vérifier que le test passe**, puis toute la suite (`npm test && npm run e2e`).
- [ ] **Étape 3 : commit** `feat(tabacs): sélecteur, création, invitation par QR code, synchronisation visible`.

### Tâche 10 : finitions, documentation, revue, mise en ligne

- [ ] **Étape 1 :** la spec passe au statut « validée » ; le README décrit les tabacs et le guide administrateur ; mise à jour de la page Réglages, dont le texte de confidentialité.
- [ ] **Étape 2 :** vérification complète : `npx tsc --noEmit -p tsconfig.json && npm test && npm run e2e && npm run build`, et `wrangler deploy --dry-run` dans `relay/`.
- [ ] **Étape 3 :** relecture indépendante de toute la branche, en insistant sur la sécurité : chiffrement, CORS, limites, secrets dans le workflow.
- [ ] **Étape 4 :** demande de fusion, fusion après accord. Expliquer au propriétaire les étapes du §7 de la spec (compte Cloudflare et secrets).
