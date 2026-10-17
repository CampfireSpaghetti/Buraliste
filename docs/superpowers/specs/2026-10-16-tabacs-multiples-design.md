# La Carotte : tabacs multiples et partage automatique (conception)

- **Date** : 16/10/2026
- **Statut** : validée, développée le 16–17/10/2026
- **S'appuie sur** : `2026-10-16-la-carotte-design.md` (V1 et évolutions §15–16)

## 1. Objectif

Plusieurs tabacs utilisent La Carotte, chacun avec ses employés. Le partage doit se faire **automatiquement**, sans manipulation, comme dans une messagerie privée.

- **Chaque gérant crée son tabac lui-même**, en un tap, sans compte ni clé.
- **Ses employés rejoignent le tabac en scannant un QR code.**
- **Au sein d'un tabac, tout se partage** :
  - le comptage grattage ;
  - les ruptures et les remplaçants épinglés ;
  - les fiches créées et les corrections ;
  - les jeux enlevés de la liste ;
  - le nom du tabac et les réglages.
- **Un même téléphone peut servir pour plusieurs tabacs**, avec un sélecteur de tabac.
- **Les codes-barres alimentent la liste commune publique**, déjà en place, à partir de tous les tabacs. Aucune clé GitHub n'est plus nécessaire sur les téléphones.

### Critères de réussite

- Une saisie faite sur un téléphone apparaît sur les autres téléphones du même tabac **en moins de 30 secondes**, quand ils sont ouverts et ont du réseau.
- **Aucune donnée d'un tabac n'est lisible hors de ses téléphones** : ni par le relais, ni par Cloudflare, ni par GitHub, ni par les autres tabacs.
- **Sans réseau, tout fonctionne comme aujourd'hui.** Les modifications partent au retour du réseau, et rien n'est perdu.
- **Coût : 0 €**, dans les limites de l'offre gratuite de Cloudflare.

## 2. Vue d'ensemble

```
 Téléphones du tabac A ──┐   messages chiffrés (AES-256-GCM)    ┌── Téléphones du tabac A
                         ├──►  Relais La Carotte (Cloudflare)  ◄┤
 Téléphones du tabac B ──┘   canal A │ canal B (illisibles)     └── Téléphones du tabac B
                                     │
                     codes-barres ──►│──► issue GitHub [codes-barres] ──► robot ──► codes-barres.json (public)
```

- **Le relais** est un Cloudflare Worker gratuit avec une base D1.
  - Il ne fait que **stocker et redistribuer** des messages chiffrés, par canal : un canal par tabac.
  - Il transmet aussi les codes-barres à GitHub, avec la clé GitHub du propriétaire, gardée en secret dans le relais.
- **La clé du tabac** (32 octets aléatoires) est créée sur le téléphone du gérant et ne quitte que par le QR code. Elle sert à :
  - **chiffrer** chaque message ;
  - **calculer l'identifiant du canal** (impossible de le deviner) ;
  - **calculer une clé d'écriture**, pour que seuls les membres puissent écrire dans le canal.

## 3. Côté téléphone

### 3.1 Plusieurs tabacs

- **Registre** : une petite liste dans le stockage local du navigateur (`carotte:tabacs`) recense les tabacs du téléphone ; elle est lue avant d'ouvrir la moindre base. Pour chacun : identifiant local, nom, clé, identifiant de canal, date d'ajout, et lequel est en cours d'utilisation.
- **Une base par tabac** : `la-carotte-<id>`, avec la même structure qu'aujourd'hui (catalogue, comptage, réglages).
  - La base actuelle `la-carotte` devient le **premier tabac** du téléphone, au nom de son réglage « Nom du tabac ».
  - Aucune donnée n'est perdue. Sa clé est créée automatiquement, comme pour tout tabac : il n'y a rien à activer.
- **Sélecteur** : toucher le nom du tabac dans l'en-tête ouvre une feuille avec :
  - la liste des tabacs du téléphone ;
  - « Créer un tabac » ;
  - « Rejoindre un tabac (scanner son QR code) ».
  - Changer de tabac recharge l'app sur la base de ce tabac.
- **Listes publiques** (Douane, FDJ, codes partagés) : elles sont fusionnées dans chaque base de tabac, comme aujourd'hui.
- **Identifiants de produits stables** : pour que les fiches officielles se retrouvent d'un téléphone à l'autre, leur identifiant ne dépend plus du téléphone.
  - Douane : `d:<référence Douane>` ; FDJ : `f:<référence FDJ>` ; liste de départ : `depart:<clé stable>`.
  - Fiche créée à la main : identifiant aléatoire, comme avant.
  - Une migration de la base (Dexie v5) renomme les identifiants existants et tout ce qui s'y réfère (lignes de comptage, remplaçants épinglés, jeux masqués, produits récents). Une sauvegarde ancienne est convertie à la restauration.

### 3.2 Créer, partager, rejoindre

- **Créer un tabac** :
  1. on saisit le nom ;
  2. le téléphone génère la clé, la nouvelle base reçoit les listes publiques, et le canal est ouvert sur le relais au premier envoi.
  - Pour le tabac existant (base `la-carotte`), la clé est créée automatiquement au premier lancement de la nouvelle version, et l'état actuel est publié (photographie, voir §3.4) dès que le relais est en service.
- **Aucune clé à saisir, aucun compte** : ni GitHub, ni Cloudflare, ni autre, pour les gérants comme pour les employés. Toutes les clés naissent sur le téléphone ; seul l'administrateur de l'app configure le relais une fois (§7).
- **Inviter un employé** : Réglages → « Inviter un employé » affiche le QR code `LACAROTTE2:<base64url {nom, clé}>`.
  - Avertissement affiché : « Toute personne qui scanne ce QR code accède aux données du tabac. »
- **Rejoindre** : n'importe quel scanner de l'app reconnaît ce QR code. L'app demande « Rejoindre « Tabac du Centre » ? » (la formulation « Rejoindre le … » sonnait faux avec des noms comme « La Civette »), puis :
  1. elle crée la base locale ;
  2. elle charge la dernière photographie et les messages suivants ;
  3. le téléphone est à jour.
- **Retirer un employé** : V1 sans révocation individuelle. Pour écarter quelqu'un, le gérant crée un nouveau tabac et réinvite les autres. C'est hors périmètre de ce chantier.

### 3.3 Ce qui se partage : opérations et règle « le plus récent gagne »

Chaque modification produit une **opération** :

```ts
type Op = {
  e: 'line' | 'product' | 'settings';  // entité
  id: string;                          // ligne de comptage, produit, ou 'main'
  f: Record<string, unknown>;          // champs modifiés (null = effacé)
  t: string;                           // horodatage « HLC » : heure ms + compteur + id appareil (ordre total)
};
```

| Entité | Champs partagés |
|---|---|
| `line` (comptage) | `gameId`, `code`, `name`, `linearQty`, `stockQty`, `updatedAt`, `deleted` |
| `product` | `user` (champ par champ : `user.name`, `user.tasteTags`…), `outOfStock`, `pinnedSubstitutes`, et pour une fiche créée à la main `source`, `base` |
| `settings` | `shopName`, `sortCount`, `hiddenGames` |

- **Jamais partagés** : la clé du tabac, l'état de sauvegarde, l'onglet ouvert.
- **Suppression d'une fiche** : non partagée. Seules les fiches créées à la main peuvent être supprimées ; elle reste locale, et une restauration de sauvegarde qui supprime des fiches est elle aussi locale. Cas rare, accepté.
- **Les listes publiques ne passent jamais par le canal** : chaque téléphone les reçoit lui-même.
- **Fusion** : chaque enregistrement garde l'horodatage de chacun de ses champs partagés (`_clock`). Une opération reçue ne remplace un champ que si son horodatage est **plus récent**. Le résultat est le même sur tous les téléphones, quel que soit l'ordre d'arrivée.
- **Suppression d'une ligne** : `deleted: true` avec son horodatage. La ligne disparaît de l'écran, et une modification plus ancienne arrivée en retard ne la fait pas réapparaître.
- **Seuls les champs modifiés partent** : un formulaire (comptage, fiche) part d'un état de départ, et seuls les champs que l'utilisateur a réellement changés produisent une opération. Un champ qu'il n'a pas touché ne peut donc pas écraser la saisie plus récente d'un collègue. Les jeux masqués passent par des gestes dédiés (masquer, afficher) qui lisent l'état courant ; deux masquages simultanés de jeux différents dans la même fenêtre de synchronisation peuvent encore s'écraser (liste complète, le plus récent gagne) : risque accepté.
- **Produit encore inconnu ici** : les téléphones d'un tabac n'ont pas toujours la même version des listes publiques (pendant plusieurs jours parfois). Une opération reçue pour un produit officiel que ce téléphone n'a pas encore n'est donc pas perdue : elle est **mise en attente** (table `parkedOps`), puis rejouée après chaque mise à jour des listes Douane et FDJ, même sans nouvelle version. Les ids des opérations en attente suivent la normalisation des ids et les renommages de la liste Douane (`previousRef`). Au plus 5 000 opérations en attente (les plus anciennes partent), et 60 jours au plus.
- **Jeu de départ et jeu FDJ** : `depart:<nom comparable>` et `f:fdj|<code>` désignent le même jeu quand la liste FDJ le reprend ; ils ne se déduisent pas l'un de l'autre, seul le nom du jeu les relie. Une opération qui vise l'un, absent ici, va à l'autre s'il est présent.
- **Données entrantes non fiables** : une opération n'écrit que les champs listés ci-dessus (et `user.*` seulement pour un produit), et une opération datée de plus de 24 h dans le futur est ignorée, pour qu'une horloge détraquée ne gagne pas pour toujours.
- **Prise en compte** : toutes les écritures existantes (`upsertCountLine`, `deleteCountLine`, `patchUserFields`, `setOutOfStock`, `setPinned`, `putProduct`, `saveSettings`, `clearUserField`) passent par une couche unique. Elle applique la modification localement et la met dans la file d'envoi du canal.
- **R29 : une version sans adresse du relais ne perd rien.** Si une version de l'app est construite sans l'adresse du relais alors que ce tabac a déjà été synchronisé (numéro du dernier message reçu connu), les opérations continuent d'être mises en file ; elles partent dès qu'une version avec l'adresse revient.

### 3.4 Synchronisation

- **Envoi** : la file d'opérations est chiffrée et envoyée par lots, 2 s après la dernière modification, au démarrage, au retour du réseau et au retour au premier plan.
- **Réception** :
  - toutes les **10 s** quand l'app est visible, ainsi qu'au démarrage, au retour au premier plan et juste après un envoi ;
  - l'app demande au relais les messages qui suivent le dernier numéro reçu.
- **Photographie** :
  - quand plus de 500 messages ont été vus depuis la dernière photographie, un téléphone en publie une nouvelle (état complet chiffré) ;
  - un nouveau téléphone ne lit que la dernière photographie et les messages qui suivent ;
  - **premier contact** : un téléphone qui a déjà des données locales au moment de rejoindre un canal publie une photographie de l'état fusionné, même s'il en existe déjà une, pour que les données du gérant arrivent aux autres sans attendre 500 messages ; une photographie est aussi publiée quand le canal n'en a pas encore et qu'il existe des données locales ;
  - **rattrapage** : un téléphone dont la dernière réception date de plus de 25 jours applique d'abord la dernière photographie, avant de lister les messages (le ménage de 30 jours a pu en supprimer) ;
  - une photographie appliquée fusionne champ par champ, avec l'horodatage de chaque champ ;
  - le relais refuse (409) une photographie plus ancienne que celle qu'il garde ; le téléphone comprend alors qu'un autre en a publié une et continue.
- **Relais remis à zéro** (base effacée, canal changé) : si le relais annonce un dernier numéro plus petit que celui déjà reçu ici, ou numérote un envoi sans dépasser ce numéro, le téléphone oublie sa position dans le canal et le rejoint comme au premier contact. Il republie donc son état fusionné, au lieu d'attendre pour toujours avec un point vert.
- **Indicateur dans l'en-tête** : un petit point.
  - Vert : synchronisé.
  - Laiton : envoi en attente.
  - Gris : hors ligne.
  - Rouge : erreur. Le détail est dans Réglages.

### 3.5 Codes-barres de la liste commune

- La file de contributions déjà en place (« code → produit officiel ») est désormais envoyée **au relais**, sans clé. Le relais crée l'issue `[codes-barres]` sur GitHub avec la clé du propriétaire, et le robot actuel la traite.
- **R28 : les contributions sont anonymes.** L'issue est toujours ouverte par le compte du propriétaire : son auteur ne dit rien de l'expéditeur. Le robot n'applique donc que les liens **nouveaux et sans conflit**. Une contribution qui changerait un lien publié (code-barres déjà attribué à un autre produit, code de jeu différent pour un jeu, code de jeu déjà pris par un autre jeu) n'est jamais appliquée : le robot répond en la listant, et le message reste ouvert avec l'étiquette « à vérifier ». Le propriétaire décide. Les messages « à vérifier » ne sont plus traités par le robot.
- L'activation par clé GitHub sur le téléphone (Réglages, version précédente) est **retirée**, ainsi que le jumelage par QR code `LACAROTTE1`. Le partage des codes est automatique dès que le relais est en service. Une clé déjà saisie est ignorée, puis effacée.
- Dans Réglages, il n'y a aucun bouton « Activer le partage » : la clé de chaque tabac naît toujours automatiquement, et l'envoi se met en route dès que le relais est en service.

## 4. Le relais (Cloudflare Worker + D1)

### 4.1 Interface

| Méthode | Chemin | Corps / réponse |
|---|---|---|
| `POST` | `/v1/canaux/:canal/messages` | `{ ecriture, messages: [{ iv, data }] }` → `{ dernier }` (numéro du dernier message enregistré) |
| `GET` | `/v1/canaux/:canal/messages?apres=N&max=500` | `{ messages: [{ n, iv, data }], dernier }` |
| `PUT` | `/v1/canaux/:canal/photo` | `{ ecriture, jusqua, iv, data }` |
| `GET` | `/v1/canaux/:canal/photo` | `{ jusqua, iv, data }` ou 404 |
| `POST` | `/v1/codes` | `{ items: Contribution[] }` → issue GitHub `[codes-barres]` |

- **Écriture** :
  - Le premier envoi dans un canal enregistre l'empreinte SHA-256 de `ecriture`, une clé d'écriture dérivée de la clé du tabac par HMAC.
  - Les envois suivants doivent présenter la même clé, sinon le relais répond 403.
  - Sans la clé du tabac, on ne peut donc ni lire (contenu chiffré) ni écrire.
- **Limites** :
  - 64 Ko par requête, sauf pour la photographie : 1 Mo (un état complet d'un tabac très actif dépasse 64 Ko ; D1 accepte jusqu'à environ 2 Mo par valeur) ;
  - 200 messages par envoi ;
  - 120 requêtes par minute et par canal ;
  - écritures (messages, photographie) : 300 par minute et par adresse IP ;
  - création de canal (nouveau tabac) : 20 par heure et par adresse IP, compteur commun à toutes les instances du relais (D1) ;
  - `/v1/codes` : en-tête `Origin` obligatoire et autorisé (403 sinon), 20 requêtes par heure et par adresse IP, 200 codes par requête, et **10 issues par heure au total** (R28, compteur D1) : au-delà, 429 et les codes restent en file sur le téléphone ;
  - une photographie ne peut pas couvrir des messages qui n'existent pas : `jusqua` au-delà du dernier numéro du canal → 400.
- **Ménage** : les messages couverts par une photographie de plus de 30 jours sont supprimés.
- **CORS** : seule l'origine `https://wongmichel2048.github.io` est autorisée.

### 4.2 Base D1

```sql
CREATE TABLE canaux (canal TEXT PRIMARY KEY, ecriture_hash TEXT NOT NULL, cree INTEGER NOT NULL, dernier INTEGER NOT NULL DEFAULT 0);
CREATE TABLE messages (n INTEGER PRIMARY KEY AUTOINCREMENT, canal TEXT NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL, recu INTEGER NOT NULL);
CREATE INDEX messages_canal ON messages (canal, n);
CREATE TABLE photos (canal TEXT PRIMARY KEY, jusqua INTEGER NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL, recu INTEGER NOT NULL);
CREATE TABLE quotas (cle TEXT PRIMARY KEY, n INTEGER NOT NULL, fenetre INTEGER NOT NULL);
```

`quotas` : compteurs partagés par toutes les instances du relais, sur une fenêtre fixe (`fenetre` = début de l'heure, en ms) : issues ouvertes par heure, canaux créés par adresse IP. Les compteurs de plus d'un jour sont supprimés au passage.

`canaux.dernier` est le numéro du dernier message du canal. Il ne recule jamais, même quand le ménage supprime des messages : un téléphone qui demande « les messages après N » ne reçoit donc jamais un numéro déjà vu. Les numéros sont partagés entre tous les canaux (compteur unique) et ne se suivent donc pas : un téléphone ne doit jamais raisonner sur des numéros consécutifs.

Quotas gratuits de Cloudflare D1, à titre indicatif : 5 millions de lectures et 100 000 écritures de lignes par jour, 5 Go de stockage. Un tabac qui compte 33 jeux deux fois par jour, avec quelques changements, consomme quelques centaines d'écritures par jour.

### 4.3 Chiffrement (WebCrypto, côté téléphone)

- `cle` = 32 octets aléatoires (`crypto.getRandomValues`).
- `canal` = base64url des 16 premiers octets de SHA-256(`cle` ‖ « canal »).
- `ecriture` = base64url de HMAC-SHA256(`cle`, « ecriture »).
- Chaque message = AES-256-GCM(`cle`, IV aléatoire de 12 octets, JSON `{ v: 1, ops: Op[] }`). La photographie suit le même principe, avec `{ v: 1, etat }`.
- Un message qui ne se déchiffre pas (falsifié ou d'une autre version) est ignoré et noté dans la console.

### 4.4 Déploiement

- Code du relais dans `relay/` (TypeScript), testé avec Vitest sur une fausse base D1 en mémoire.
- Le workflow GitHub (« Déploiement ») déploie le relais avec `wrangler`, avant l'app, quand les secrets du dépôt sont présents :
  - `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` ;
  - `RELAY_GITHUB_TOKEN` : clé fine-grained « Issues : lecture et écriture » sur Buraliste, transmise au relais comme secret.
- **Tout est automatique** :
  - le workflow réserve l'adresse `workers.dev` du compte si elle n'existe pas encore ;
  - il crée la base D1 `la-carotte` si elle manque, et injecte son identifiant dans `relay/wrangler.toml` au moment du déploiement (le fichier du dépôt garde un repère, aucun identifiant de compte n'est publié) ;
  - il rejoue le schéma (`relay/schema.sql`, sans effet si les tables existent).
- **L'adresse du relais n'est pas à recopier** : le workflow la lit dans le résultat du déploiement et la transmet à la construction de l'app (`VITE_RELAY_URL`). Une variable de dépôt `RELAY_URL` reste possible comme solution de repli. La CSP n'autorise que cette adresse en plus.
- **R29 : une construction ne perd jamais le relais.** Ordre : relais tout juste déployé, variable `RELAY_URL`, adresse `workers.dev` du compte (API Cloudflare), puis, si les secrets Cloudflare existent mais que rien n'a répondu, l'adresse du relais de la version en ligne, lue dans sa CSP (`connect-src`). Sinon, avertissement ; la publication n'est jamais bloquée.
- Le relais est déployé à chaque publication et **chaque lundi** (planification) : une modification du relais sautée par la file d'attente du workflow part au plus tard la semaine suivante.
- Le Worker connaît le dépôt cible (`wongmichel2048/Buraliste`) en dur : un seul dépôt est servi.
- **`/v1/codes`** : le relais reconstruit chaque contribution avec des longueurs plafonnées avant de l'envoyer à GitHub.
- **Tant que le relais n'est pas configuré**, l'app fonctionne exactement comme aujourd'hui, et les options de partage affichent « Bientôt disponible ».

## 5. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Pas de réseau | Les opérations s'accumulent et partent au retour. Point gris. |
| Relais indisponible ou quota dépassé | Nouvelle tentative avec un délai croissant (10 s, puis jusqu'à 5 min). Point rouge, message dans Réglages. Le téléphone reste utilisable. |
| 403 (clé d'écriture refusée) | Le message « Ce téléphone n’a plus accès à ce tabac » s'affiche dans Réglages (point rouge). Les données locales sont conservées. Plus aucune nouvelle tentative automatique : la synchronisation ne reprend qu'au prochain lancement. |
| 409 sur une photographie | Un autre téléphone en a publié une plus récente : ce n'est pas une erreur, la synchronisation continue. |
| Message illisible | Ignoré. |
| Deux employés modifient la même chose | La saisie la plus récente gagne, champ par champ. |
| Horloge d'un téléphone décalée | L'horodatage HLC ne recule jamais pour un appareil. L'écart entre appareils reste un risque accepté : la dernière saisie « à l'heure du téléphone » gagne. |

## 6. Tests

- **Unitaires** :
  - chiffrement aller-retour et message falsifié rejeté ;
  - dérivation canal / écriture déterministe ;
  - fusion « le plus récent gagne » : ordre d'arrivée indifférent, suppression, champs indépendants ;
  - horodatage HLC ;
  - registre des tabacs et migration de la base actuelle ;
  - relais (création de canal, écriture refusée, pagination, photographie, limites, `/v1/codes`), testé sur une fausse D1.
- **Bout en bout** :
  - un faux relais local (même interface) et **deux navigateurs**, soit deux téléphones ;
  - un employé rejoint par QR code ;
  - un comptage saisi sur l'un apparaît sur l'autre ;
  - suppression, rupture et nom du tabac partagés ;
  - fonctionnement hors ligne, puis rattrapage ;
  - sélecteur de tabac avec données séparées.

## 7. Ce que le propriétaire devra faire une fois

1. Créer un compte Cloudflare gratuit.
2. Créer une clé API Cloudflare avec le modèle « Edit Cloudflare Workers », **en ajoutant** l'autorisation « Compte → D1 → Modifier » (le modèle ne la contient pas toujours ; sans effet si elle y est déjà).
3. Créer la clé GitHub fine-grained « Issues : lecture et écriture » sur Buraliste.
4. Coller dans GitHub (Settings → Secrets and variables → Actions) :
   - `CLOUDFLARE_API_TOKEN` ;
   - `CLOUDFLARE_ACCOUNT_ID` ;
   - `RELAY_GITHUB_TOKEN` : la clé GitHub de l'étape 3.
5. Lancer le workflow « Déploiement » (Actions → Déploiement → Run workflow). **Rien à recopier** : l'adresse du relais est trouvée et transmise à l'app automatiquement (elle s'affiche seulement pour information dans le résumé du job).

Un guide pas à pas est fourni dans le README.

## 8. Écarts par rapport à la première version

Ce qui a changé en cours de développement, pour mémoire (le texte ci-dessus est à jour) :

- Pas de variable `RELAY_URL` à remplir : le déploiement trouve l'adresse tout seul (§4.4, §7).
- Photographie : limite de 1 Mo au lieu de 64 Ko (§4.1).
- Colonne `canaux.dernier` (§4.2).
- Identifiants de produits stables entre téléphones (§3.1).
- Seuls les champs modifiés partent ; la suppression d'une fiche n'est pas partagée (§3.3).
- Publication d'une photographie au premier contact, rattrapage après 25 jours, 409 sur une photographie plus ancienne (§3.4, §5).
- Invitation : « Rejoindre « <nom> » ? » (§3.2). Aucun bouton « Activer le partage » (§3.5).
- R28 : contributions de codes anonymes ; seuls les liens nouveaux sont appliqués, les conflits restent « à vérifier » ; plafond global de 10 issues par heure, limites par adresse IP, `Origin` obligatoire sur `/v1/codes` (§3.5, §4.1, §4.2).
- R29 : file d'envoi gardée sans adresse du relais pour un tabac déjà synchronisé ; adresse reprise de la version en ligne au déploiement (§3.3, §4.4).
- Opérations en attente pour un produit encore inconnu, rejoin du canal quand le relais est remis à zéro (§3.3, §3.4).

## 9. Hors périmètre

- Retirer un employé sans recréer le tabac.
- Rôles (gérant ou employé) et droits différents.
- Historique des modifications consultable.
- Partage entre tabacs (au-delà de la liste publique des codes-barres).
