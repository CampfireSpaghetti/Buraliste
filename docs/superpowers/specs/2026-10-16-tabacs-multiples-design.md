# La Carotte : tabacs multiples et partage automatique (conception)

- **Date** : 16/10/2026
- **Statut** : à valider par le propriétaire
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

- **Registre** : une petite base `la-carotte-registre` liste les tabacs du téléphone. Pour chacun : identifiant local, nom, clé, identifiant de canal, date d'ajout, et lequel est en cours d'utilisation.
- **Une base par tabac** : `la-carotte-<id>`, avec la même structure qu'aujourd'hui (catalogue, comptage, réglages).
  - La base actuelle `la-carotte` devient le **premier tabac** du téléphone, au nom de son réglage « Nom du tabac ».
  - Aucune donnée n'est perdue. Ce tabac reste « non partagé » tant que le gérant n'active pas le partage.
- **Sélecteur** : toucher le nom du tabac dans l'en-tête ouvre une feuille avec :
  - la liste des tabacs du téléphone ;
  - « Créer un tabac » ;
  - « Rejoindre un tabac (scanner son QR code) ».
  - Changer de tabac recharge l'app sur la base de ce tabac.
- **Listes publiques** (Douane, FDJ, codes partagés) : elles sont fusionnées dans chaque base de tabac, comme aujourd'hui.

### 3.2 Créer, partager, rejoindre

- **Créer un tabac** :
  1. on saisit le nom ;
  2. le téléphone génère la clé, la nouvelle base reçoit les listes publiques, et le canal est ouvert sur le relais au premier envoi.
  - Pour le tabac existant (base `la-carotte`), « Activer le partage » fait la même chose et publie l'état actuel (photographie, voir §4.3).
- **Inviter un employé** : Réglages → « Inviter un employé » affiche le QR code `LACAROTTE2:<base64url {nom, clé}>`.
  - Avertissement affiché : « Toute personne qui scanne ce QR code accède aux données du tabac. »
- **Rejoindre** : n'importe quel scanner de l'app reconnaît ce QR code. L'app demande « Rejoindre le Tabac du Centre ? », puis :
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
- **Les listes publiques ne passent jamais par le canal** : chaque téléphone les reçoit lui-même.
- **Fusion** : chaque enregistrement garde l'horodatage de chacun de ses champs partagés (`_clock`). Une opération reçue ne remplace un champ que si son horodatage est **plus récent**. Le résultat est le même sur tous les téléphones, quel que soit l'ordre d'arrivée.
- **Suppression d'une ligne** : `deleted: true` avec son horodatage. La ligne disparaît de l'écran, et une modification plus ancienne arrivée en retard ne la fait pas réapparaître.
- **Prise en compte** : toutes les écritures existantes (`upsertCountLine`, `deleteCountLine`, `patchUserFields`, `setOutOfStock`, `setPinned`, `putProduct`, `saveSettings`, `clearUserField`) passent par une couche unique. Elle applique la modification localement et la met dans la file d'envoi du canal.

### 3.4 Synchronisation

- **Envoi** : la file d'opérations est chiffrée et envoyée par lots, 2 s après la dernière modification, au démarrage, au retour du réseau et au retour au premier plan.
- **Réception** :
  - toutes les **10 s** quand l'app est visible, ainsi qu'au démarrage, au retour au premier plan et juste après un envoi ;
  - l'app demande au relais les messages qui suivent le dernier numéro reçu.
- **Photographie** : quand plus de 500 messages se sont accumulés depuis la dernière photographie, un téléphone en publie une nouvelle (état complet chiffré). Un nouveau téléphone ne lit que la dernière photographie et les messages qui suivent.
- **Indicateur dans l'en-tête** : un petit point.
  - Vert : synchronisé.
  - Laiton : envoi en attente.
  - Gris : hors ligne.
  - Rouge : erreur. Le détail est dans Réglages.

### 3.5 Codes-barres de la liste commune

- La file de contributions déjà en place (« code → produit officiel ») est désormais envoyée **au relais**, sans clé. Le relais crée l'issue `[codes-barres]` sur GitHub avec la clé du propriétaire, et le robot actuel la traite.
- L'activation par clé GitHub sur le téléphone (Réglages, version précédente) est **retirée**. Le partage des codes est automatique dès que le relais est en service. Une clé déjà saisie est ignorée, puis effacée.

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
  - 64 Ko par requête et 200 messages par envoi ;
  - 120 requêtes par minute et par canal ;
  - `/v1/codes` : 20 requêtes par heure et par adresse IP, et 200 codes par requête.
- **Ménage** : les messages couverts par une photographie de plus de 30 jours sont supprimés.
- **CORS** : seule l'origine `https://wongmichel2048.github.io` est autorisée.

### 4.2 Base D1

```sql
CREATE TABLE canaux (canal TEXT PRIMARY KEY, ecriture_hash TEXT NOT NULL, cree INTEGER NOT NULL);
CREATE TABLE messages (n INTEGER PRIMARY KEY AUTOINCREMENT, canal TEXT NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL, recu INTEGER NOT NULL);
CREATE INDEX messages_canal ON messages (canal, n);
CREATE TABLE photos (canal TEXT PRIMARY KEY, jusqua INTEGER NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL, recu INTEGER NOT NULL);
```

Quotas gratuits de Cloudflare D1, à titre indicatif : 5 millions de lectures et 100 000 écritures de lignes par jour, 5 Go de stockage. Un tabac qui compte 33 jeux deux fois par jour, avec quelques changements, consomme quelques centaines d'écritures par jour.

### 4.3 Chiffrement (WebCrypto, côté téléphone)

- `cle` = 32 octets aléatoires (`crypto.getRandomValues`).
- `canal` = base64url des 16 premiers octets de SHA-256(`cle` ‖ « canal »).
- `ecriture` = base64url de HMAC-SHA256(`cle`, « ecriture »).
- Chaque message = AES-256-GCM(`cle`, IV aléatoire de 12 octets, JSON `{ v: 1, ops: Op[] }`). La photographie suit le même principe, avec `{ v: 1, etat }`.
- Un message qui ne se déchiffre pas (falsifié ou d'une autre version) est ignoré et noté dans la console.

### 4.4 Déploiement

- Code du relais dans `relay/` (TypeScript), testé avec Vitest sur une fausse base D1 en mémoire.
- Le workflow GitHub déploie le relais avec `wrangler`, avant l'app, quand les secrets du dépôt sont présents :
  - `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` ;
  - `RELAY_GITHUB_TOKEN` : clé fine-grained « Issues : lecture et écriture » sur Buraliste, transmise au relais comme secret.
- L'adresse du relais est donnée à l'app au moment de la construction : variable de dépôt `RELAY_URL`, lue comme `VITE_RELAY_URL`. La CSP n'autorise que cette adresse en plus.
- **Tant que le relais n'est pas configuré**, l'app fonctionne exactement comme aujourd'hui, et les options de partage affichent « Bientôt disponible ».

## 5. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Pas de réseau | Les opérations s'accumulent et partent au retour. Point gris. |
| Relais indisponible ou quota dépassé | Nouvelle tentative avec un délai croissant (10 s, puis jusqu'à 5 min). Point rouge, message dans Réglages. Le téléphone reste utilisable. |
| 403 (clé d'écriture refusée) | Le message « Ce téléphone n'a plus accès à ce tabac » s'affiche. Les données locales sont conservées. |
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
2. Créer une clé API Cloudflare « Edit Cloudflare Workers » (D1 inclus).
3. Coller dans GitHub (Settings → Secrets and variables → Actions) :
   - `CLOUDFLARE_API_TOKEN` ;
   - `CLOUDFLARE_ACCOUNT_ID` ;
   - `RELAY_GITHUB_TOKEN` : clé GitHub fine-grained « Issues : lecture et écriture » sur Buraliste.
4. Lancer le workflow. L'adresse du relais s'affiche à la fin ; il faut la coller dans la variable `RELAY_URL`, puis relancer le workflow.

Un guide pas à pas sera fourni dans le README.

## 8. Hors périmètre

- Retirer un employé sans recréer le tabac.
- Rôles (gérant ou employé) et droits différents.
- Historique des modifications consultable.
- Partage entre tabacs (au-delà de la liste publique des codes-barres).
