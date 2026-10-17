# La Carotte : application mobile du buraliste (conception)

- **Date** : 16/10/2026
- **Statut** : validé par le propriétaire le 16/10/2026
- **Nom de travail** : « La Carotte », d'après l'enseigne rouge des bureaux de tabac. Le nom reste modifiable.

---

## 1. Objectif

Donner au buraliste un outil de poche pour le comptoir, qui sert à trois choses :

1. **Identifier un produit en le scannant** : tabac (cigarettes, tabac à rouler, cigares, cigarillos) ou jeu de grattage FDJ. L'app affiche alors sa fiche : référence, force ou nicotine, goût, origine, prix.
2. **Proposer un remplaçant** quand un client demande un produit en rupture. Les choix sont classés et chaque choix affiche ses raisons.
3. **Compter les jeux de grattage** dans un tableau à 4 colonnes, rempli par scan ou à la main. Le tableau s'exporte en image .jpg vers Google Drive, sans que l'app ait accès au Drive.

### Critères de réussite

- Compter tout le présentoir de grattage (une trentaine de jeux) en **moins de 5 minutes**.
- Devant le client, voir **un remplaçant en 2 taps au plus** à partir de la fiche du produit manquant.
- Exporter le comptage en .jpg et l'envoyer sur Drive en **moins de 15 secondes**.
- Ne **jamais perdre un comptage** : stockage persistant, annulation des suppressions, sauvegarde complète.

## 2. Contraintes décidées avec le propriétaire

| Contrainte | Décision |
|---|---|
| Plateformes | iPhone et Android |
| Budget | **0 €** : pas d'App Store ni de Play Store, pas de compte développeur payant |
| Forme | **Application web installable (PWA)** : on ouvre un lien, puis « Ajouter à l'écran d'accueil ». Plein écran, fonctionne hors ligne |
| Données | Stockées **uniquement sur le téléphone**. Pas de serveur, pas de compte utilisateur |
| Google Drive | Les .jpg partent par le **menu Partager natif** du téléphone. L'app n'a **aucune permission Google** et ne peut ni lire ni lister le Drive |
| Utilisateurs | Un seul téléphone en V1. Sauvegarde et restauration complètes par fichier pour changer d'appareil |
| Langue | Français |
| Hébergement | **GitHub Pages**, gratuit. Le dépôt doit être public : le code est visible, mais aucune donnée du tabac n'est dans le dépôt |
| Style | **A · Plaque émaillée** (maquette : https://claude.ai/artifact/9Xg3WMS8gxeHoSnZixcbwW), avec une variante sombre automatique |

## 3. Architecture

```
┌──────────────────────── Téléphone (PWA installée) ────────────────────────┐
│  Interface (React + TypeScript)                                           │
│   ├─ Scanner ── module de lecture (BarcodeDetector natif ou zxing-wasm)   │
│   ├─ Catalogue ── moteur de remplaçants · comparateur                     │
│   ├─ Grattage ── tableau de comptage · export .jpg (canvas) → Partager    │
│   └─ Réglages ── sauvegarde / restauration (fichier .json) → Partager     │
│  Données : IndexedDB (Dexie), stockage persistant demandé                 │
│  Service worker : app et données de référence disponibles hors ligne      │
└───────────────────────────────────────────────────────────────────────────┘
        ▲ télécharge uniquement ses propres fichiers (app + references.json)
┌───────┴──────────── Hébergement statique gratuit ─────────────────────────┐
│  GitHub Pages (dépôt public ; aucune donnée du tabac n'y est stockée)     │
└───────────────────────────────────────────────────────────────────────────┘
        ▲ publie chaque semaine
┌───────┴──────────── Robot GitHub Actions (gratuit, hebdomadaire) ─────────┐
│  1. lit la page open data « homologation des prix » de douane.gouv.fr     │
│  2. télécharge la dernière nomenclature (ODS/XLSX)                        │
│  3. la convertit en public/data/references.json (avec n° de version)      │
│  4. reconstruit et republie l'app si la liste a changé                    │
└───────────────────────────────────────────────────────────────────────────┘
```

### Choix techniques

- **Vite + React + TypeScript**.
- **Dexie** pour IndexedDB. Au premier lancement, l'app appelle `navigator.storage.persist()` pour demander un stockage persistant.
- **vite-plugin-pwa** (Workbox) pour le fonctionnement hors ligne et les mises à jour automatiques. Quand une nouvelle version est prête, un bandeau « Nouvelle version prête » permet de recharger.
- **Lecture des codes-barres** : on utilise l'API `BarcodeDetector` native quand elle existe (Chrome Android). Sinon, on passe par le polyfill `barcode-detector`, qui repose sur zxing-wasm. Le fichier `.wasm` est **hébergé avec l'app** : pas d'appel à un CDN, ça marche hors ligne et rien ne part chez un tiers. Formats lus : EAN-13, EAN-8, UPC-A, Code 128, ITF, Code 39.
- **Export .jpg** : on dessine nous-mêmes le tableau sur un `<canvas>`. On n'utilise **pas** de capture d'écran du DOM, peu fiable sous iOS. Le rendu est ainsi identique sur tous les téléphones, quelle que soit la longueur de la liste.
- **Partage** : Web Share API niveau 2 (`navigator.share({ files })`), prise en charge par Safari iOS et Chrome Android. Si elle manque, un repli est prévu (voir §9).
- **Polices hébergées avec l'app** (licence OFL) : Alfa Slab One (titres) et Barlow Semi Condensed (texte).
- **Aucune analyse d'audience** et aucun appel réseau tiers. Une Content-Security-Policy stricte limite le site à sa propre origine (`default-src 'self'`).

## 4. Modèle de données

### 4.1 Catalogue en deux couches

Chaque produit a :

- une couche **`base`** : données de référence, remplacées lors des mises à jour automatiques ;
- une couche **`user`** : ajouts et corrections du buraliste, **jamais écrasés**.

```ts
type Kind = 'cigarette' | 'tabac-rouler' | 'cigare' | 'cigarillo' | 'autre-tabac' | 'jeu-fdj';

interface ProductFields {
  kind: Kind;
  name: string;            // « Marlboro Gold 20 », « Cash »
  brand?: string;
  format?: string;         // « 20 cig. », « king size », « 30 g », « robusto »
  barcodes?: string[];     // codes EAN exacts (paquet, cartouche…)
  fdjPrefix?: string;      // jeux FDJ : préfixe appris (voir §5)
  origin?: string;         // pays
  nicotineMg?: number;     // si connue de façon fiable
  strength?: 1 | 2 | 3 | 4 | 5;   // force ressentie (paquet neutre : nicotine non imprimée)
  tasteTags?: string[];    // « doux », « corsé », « boisé », « épicé », « vanillé », « fruité »…
  price?: number;          // € ; prix officiel Douane ou saisi
  ticketPrice?: number;    // jeux FDJ : 1, 2, 3, 5, 10, 20 €
  maxPrize?: number;       // jeux FDJ : gain maximum en €
  gameType?: string;       // jeux FDJ : « classique », « gros lot », « thématique »…
  notes?: string;
}

interface Product {
  id: string;
  source: 'douane' | 'depart' | 'utilisateur';
  douaneRef?: string;           // clé stable de la ligne Douane (marque + désignation + conditionnement)
  base: Partial<ProductFields>; // remplacé par les mises à jour
  user: Partial<ProductFields>; // ajouts du buraliste, jamais écrasé
  outOfStock: boolean;
  pinnedSubstitutes: string[];  // ids épinglés en tête des suggestions
  updatedAt: number;
}
```

**Valeur affichée** = `{ ...base, ...user }`. Il y a une exception pour `barcodes` : on fait l'**union** des deux couches, sans doublon.

**Mise à jour de la référence Douane** :

- On rapproche chaque ligne Douane d'un produit existant par `douaneRef`, puis on remplace seulement `base`.
- Une référence qui disparaît de la liste Douane n'est **pas supprimée**. Elle reçoit l'indicateur « retiré de la liste officielle ».

**Dates d'effet des prix** : chaque fichier de la Douane annonce une date d'entrée en vigueur (par exemple le 1er novembre 2026) et contient à la fois les anciens et les nouveaux prix. Le fichier `references.json` conserve donc pour chaque référence :

- `effectiveDate` : la date d'effet du fichier ;
- `price` : le nouveau prix ;
- `previousPrice` : l'ancien prix, s'il change ;
- `status` : `nouveau`, `retrait` ou `inchange`.

L'app affiche l'ancien prix jusqu'à la date d'effet, puis le nouveau. Une référence « nouveau » est marquée « en vente au 1er nov. » avant cette date. Une référence « retrait » passe en « retirée de la liste officielle » à partir de cette date.

### 4.2 Comptage grattage (liste unique, mise à jour en continu)

```ts
interface CountLine {
  id: string;
  gameId?: string;   // lien vers le jeu du catalogue (sert à reconnaître un re-scan)
  code: string;      // colonne 1, modifiable
  name: string;      // colonne 2, modifiable
  quantity: number;  // colonne 3, entier ≥ 0
  updatedAt: number; // colonne 4, mise à jour à chaque modification de la ligne
}
```

Le code et le nom sont **copiés** dans la ligne au moment de sa création. Les modifier dans le tableau ne change pas le catalogue : le tableau se comporte comme une feuille de calcul.

### 4.3 Réglages

```ts
interface Settings {
  shopName: string;          // affiché en tête des exports
  lastBackupAt?: number;
  referencesVersion?: string;
  sortCount: 'name' | 'updatedAt';
}
```

## 5. Reconnaissance des codes scannés

On normalise d'abord le code : chiffres seulement, espaces supprimés. Puis on applique ces étapes dans l'ordre :

1. **Correspondance exacte** sur les `barcodes` d'un produit : on ouvre ce produit.
2. **EAN-13 ou EAN-8 avec clé de contrôle valide**, sans correspondance exacte : c'est un **code de produit inconnu**. L'app propose « Créer la fiche » ou « Rattacher à une référence » (recherche dans la liste Douane). Pas de reconnaissance par préfixe pour les EAN.
3. **Autre code** (tickets FDJ : ITF, Code 128…) : on cherche le jeu dont le `fdjPrefix` est le **plus long préfixe** du code. Si on le trouve : on ouvre ce jeu.
4. **Code proche sans certitude** : l'app demande « C'est quel jeu ? ».
   - Les jeux sont triés par longueur du préfixe commun avec le code scanné.
   - Le bouton « Nouveau jeu » reste disponible.
   - Quand le buraliste rattache le code à un jeu, `fdjPrefix` devient le préfixe commun entre l'ancien préfixe (ou le premier code connu) et le nouveau code.
   - **Garde-fous** : le préfixe doit faire **au moins 4 chiffres**, et il ne doit pas correspondre à un code déjà connu d'un autre jeu. Sinon, le code est simplement ajouté aux `barcodes` du jeu, sans généralisation.
5. **Anti-doublon** : un même code relu dans les 1,5 s est ignoré.

> Le format exact des codes-barres des tickets FDJ n'est pas documenté publiquement. C'est pourquoi l'app apprend la règle au lieu de la supposer. Le premier test au comptoir (deux tickets d'un même jeu, deux jeux différents) servira à vérifier ce comportement.

## 6. Moteur de remplaçants

Le moteur ne compare qu'avec des produits **de la même famille** :

- cigarette ↔ cigarette ;
- tabac à rouler ↔ tabac à rouler ;
- cigare ↔ cigare, et cigarillo avec une pénalité ;
- jeu ↔ jeu.

Il exclut le produit lui-même et les produits « En rupture ».

**Score tabac, sur 100 points :**

| Critère | Points | Raison affichée |
|---|---|---|
| Force : écart 0 / 1 / 2+ | 30 / 15 / 0 | « même force » ou « force proche » |
| Format identique | 20 | « même format » |
| Goût : similarité de Jaccard des étiquettes × 25 | 0–25 | « goût proche » si ≥ 0,5 |
| Prix : écart ≤ 0,50 € / ≤ 1,50 € | 15 / 7 | « prix ±0,50 € » |
| Même origine | 5 | « même origine » |
| Même marque | 5 | « même marque » |

**Score jeu FDJ :**

| Critère | Points |
|---|---|
| Même prix de ticket | 50 |
| Même type de jeu | 30 |
| Gain maximum : ratio entre les deux gains, × 20 | 0–20 |

**Affichage :**

- Les produits **épinglés** viennent d'abord, dans l'ordre choisi par le buraliste.
- Ensuite les 5 meilleurs scores, chacun avec ses étiquettes de raison.
- Un critère sans donnée (force inconnue, par exemple) ne rapporte pas de points et ne pénalise pas.

## 7. Écrans

Une barre d'onglets en bas de l'écran, avec des zones à toucher de 48 px minimum : **Scanner · Catalogue · Grattage · Réglages**.

### 7.1 Scanner

- Caméra plein écran avec une bande de visée.
- Bouton lampe quand le téléphone le permet (souvent Android seulement).
- Bouton « Saisir le code », pour taper le code à la main.
- Bip à chaque scan réussi (Web Audio). Vibration sur Android ; iOS ne permet pas la vibration.
- Résultat :
  - produit connu : sa fiche s'ouvre ;
  - produit inconnu : l'écran de création ou de rattachement s'ouvre (§5).
- Caméra refusée : un écran explique comment l'autoriser, et la saisie manuelle reste possible.

### 7.2 Catalogue

- Recherche instantanée par nom, marque ou code.
- Filtres par famille, sous forme de pastilles. Filtre « En rupture ».
- **Fiche produit**, avec dans l'ordre :
  - les infos ;
  - l'interrupteur « En rupture » ;
  - le bouton **« Proposer un remplaçant »** ;
  - le bouton « Modifier » ;
  - le bouton « Ajouter à la comparaison ».
- **Comparer** : 2 ou 3 produits côte à côte, différences surlignées.
- Création et modification de fiche. Les champs `base` restent visibles mais ne sont pas modifiables : une modification va dans `user`. Un bouton « Revenir à la valeur officielle » efface la valeur `user`.

### 7.3 Grattage

- Tableau : **Code-barres · Nom du jeu · Quantité · Modifié le** (format `16/10 18:42`).
- En-tête collant, ligne **Total tickets** en bas, tri par nom ou par date.
- **Toucher la quantité** : un grand pavé numérique s'ouvre en feuille, avec Valider et Annuler.
- **Toucher le code ou le nom** : modification sur place.
- **« + Ligne »** : saisie manuelle du nom, du code (facultatif) et de la quantité.
- **« Scanner »** : mode scan continu. À chaque lecture :
  - le jeu est déjà dans la liste : la ligne s'illumine et le pavé s'ouvre ;
  - le jeu est au catalogue mais pas dans la liste : la ligne est ajoutée et le pavé s'ouvre ;
  - le jeu est inconnu : mini-fiche (nom, prix du ticket), puis le pavé s'ouvre.
- **Supprimer** : glisser la ligne vers la gauche, ou passer par le menu de la ligne. Une barre « Ligne supprimée · Annuler » reste affichée 5 s.
- **« Export .jpg »** : export de la page entière (§8), puis menu Partager.

### 7.4 Réglages

- Nom du tabac.
- **Sauvegarde complète** : un fichier `la-carotte-sauvegarde-AAAA-MM-JJ.json` envoyé par le menu Partager.
- **Restaurer** : choisir un fichier, puis confirmer explicitement le remplacement des données.
- Version de la liste officielle et date de mise à jour.
- Page **« Installer sur mon téléphone »**, illustrée pour Safari iPhone et Chrome Android.
- Si la dernière sauvegarde a plus de 7 jours, un bandeau de rappel s'affiche sur l'onglet Grattage.

## 8. Export .jpg du comptage

- L'image est dessinée sur un canvas de **1080 px de large** à l'échelle ×2, et sa hauteur s'adapte au nombre de lignes. **Toutes** les lignes y figurent, même celles qu'il faudrait faire défiler à l'écran.
- **Contenu, de haut en bas :**
  - bandeau bordeaux avec la carotte ;
  - nom du tabac ;
  - « Comptage grattage » ;
  - date et heure de l'export ;
  - le tableau de 4 colonnes, trié comme à l'écran ;
  - la ligne Total ;
  - en pied de page, « Exporté avec La Carotte ».
- JPEG qualité 0,92, nommé `comptage-grattage-AAAA-MM-JJ-HHMM.jpg`.
- Envoi par `navigator.share({ files: [jpg] })` (voir §9 pour le repli).
- La mise en page de l'image est calculée par une fonction pure (`layoutExport(lines, settings) → mesures`), testable sans navigateur.

## 9. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Caméra refusée ou absente | Explication pas à pas pour autoriser la caméra, plus la saisie manuelle |
| iOS redemande l'autorisation caméra dans l'app installée | Comportement connu d'iOS, signalé dans la page d'aide. Rien de bloquant |
| Partage de fichier indisponible | Affichage de l'image en plein écran avec « Appui long pour enregistrer » (iOS) ou téléchargement direct (Android) |
| Stockage persistant refusé | Bandeau qui conseille d'installer l'app sur l'écran d'accueil et de faire une sauvegarde |
| Fichier de restauration invalide | Message clair, et aucune donnée modifiée |
| Liste Douane introuvable ou changée de format (robot) | Le robot échoue de façon visible (e-mail GitHub) et l'app garde la liste précédente |
| Quantité saisie invalide | Le pavé n'accepte que des entiers de 0 à 99 999 |

## 10. Données de départ

- **Liste officielle Douane** (automatique) : noms, marques, conditionnements et prix homologués de tous les produits du tabac.
- **Fichier d'enrichissement `depart.json`**, écrit à la main pour les références les plus vendues, avec l'origine, la force (1 à 5) et les étiquettes de goût. Il est rapproché de la liste Douane par `douaneRef`.
- **Pas de codes-barres pré-remplis** : je ne peux pas garantir qu'ils soient exacts. L'app les apprend au premier scan.
- **Nicotine** : renseignée seulement quand une source fiable existe. Sinon, seule la force est indiquée.
- **Jeux FDJ** : liste des jeux de grattage en vente au moment du développement, avec leur prix de ticket. La liste sera **vérifiée à la date de livraison**. Les nouveaux jeux s'apprennent au scan.

## 11. Style visuel : A · Plaque émaillée

- **Couleurs** :
  - bordeaux `#8e1b1f` ;
  - blanc émail `#f6f4ee` ;
  - encre `#1d2433` ;
  - laiton `#b8892e` ;
  - rouge carotte `#d22a2f`.
- **Variante sombre automatique** : fond encre, texte émail, accents laiton et rouge éclairci. Contraste AA vérifié dans les deux modes.
- **Typographie** : Alfa Slab One pour les titres (avec retenue), Barlow Semi Condensed pour le texte et les chiffres (chiffres tabulaires).
- **Moments ludiques**, désactivés si l'utilisateur a demandé « réduire les animations » :
  - la carotte rebondit à chaque scan réussi ;
  - la ligne modifiée s'illumine en jaune laiton ;
  - un petit tampon « Comptage exporté ✓ » apparaît après l'export.
- **Icône d'écran d'accueil** : une carotte rouge sur fond bordeaux.

## 12. Audits UX et UI

1. **Audit de la maquette, avant le code**. Grille : heuristiques de Nielsen plus contexte du comptoir (usage à une main, reflets de la vitrine, interruptions par les clients, rapidité, erreurs de saisie). Livrable : une page avec les problèmes classés par gravité et les corrections intégrées à la maquette.
2. **Audit de l'app terminée**. Parcours réels testés : comptage complet de 30 jeux, produit manquant puis remplaçant, export Drive, sauvegarde et restauration. On mesure les taps et le temps. Contrôles UI : contrastes, tailles, cohérence, mode sombre. Livrable : un rapport illustré de captures d'écran.
3. **Corrections** des problèmes graves et majeurs avant la livraison.

## 13. Tests

- **Tests unitaires (Vitest)** :
  - normalisation des codes et clé EAN ;
  - reconnaissance par préfixe et ses garde-fous ;
  - fusion `base`/`user` ;
  - mise à jour Douane sans écrasement ;
  - scores de remplacement ;
  - mise en page de l'export ;
  - analyse du fichier Douane (sur un extrait réel conservé comme exemple).
- **Tests de bout en bout (Playwright, Chromium)** :
  - comptage complet (ajout manuel, re-scan simulé, pavé, suppression et annulation) ;
  - export (vérification de l'image générée) ;
  - sauvegarde et restauration ;
  - parcours remplaçant.
  - Le scanner est simulé en injectant des codes. Si possible, un test utilise un faux flux caméra contenant un vrai code-barres.
- **Test réel au comptoir par le propriétaire** : iPhone et Android, éclairage du magasin, tickets réels.

## 14. Hors périmètre de la V1

- Synchronisation entre plusieurs téléphones.
- Envoi direct vers Drive par l'API Google (option `drive.file` possible plus tard).
- Gestion de stock tabac et statistiques de ventes.
- Version .apk Android (la même app pourra être emballée plus tard, gratuitement).
- Comptes utilisateurs et vente de l'app à d'autres buralistes.

## 15. Évolutions validées le 16/10/2026 (après la V1)

- **Comptage : quantité linéaire et quantité stock.**
  - La colonne Quantité est remplacée par deux colonnes, **Linéaire** (au présentoir) et **Stock** (en réserve), toutes deux en tickets.
  - Il n'y a pas de colonne Total : seuls les totaux Linéaire et Stock figurent en bas du tableau et de l'export.
  - Au scan, le pavé demande le linéaire, puis le stock. Chaque validation est enregistrée.
  - Toucher une quantité ouvre le pavé pour cette seule quantité.
  - Migration : l'ancienne quantité devient le linéaire, le stock part de 0. Concerne la base (v2) et les sauvegardes (schéma 2) ; les sauvegardes de schéma 1 restent lisibles.
- **Liste des jeux FDJ mise à jour chaque semaine.**
  - Le robot du lundi lit la page des jeux de fdj.fr (`npm run fdj:update`), qui n'est pas une API officielle.
  - Il garde les jeux de grattage vendus en point de vente et écrit `public/data/fdj-games.json`.
  - L'app fusionne ces jeux comme la liste Douane :
    - produits `source:'fdj'` ;
    - seule `base` est remplacée et la couche `user` est conservée ;
    - un jeu absent passe en « retiré » ;
    - les jeux de l'ancienne liste de départ sont repris par leur nom, avec le même id.
  - Le type de jeu est déduit : « gros lot » à partir de 5 € avec un gain d'au moins 500 000 €, sinon « classique ».
  - Si une source ne peut pas être lue, le robot déploie quand même ce qui a réussi, puis termine en échec visible.
- **Hébergement** : le dépôt s'appelle `Buraliste`, donc l'app est servie sous `/Buraliste/`.

## 16. Partage des codes-barres (validé le 16/10/2026)

> **Mis à jour** : l'envoi ne se fait plus depuis les téléphones avec une clé GitHub, ni par jumelage QR code `LACAROTTE1`. Les téléphones envoient les contributions au relais La Carotte, qui détient la clé GitHub. Voir `2026-10-16-tabacs-multiples-design.md` (§3.5 et §4). Les points « Envoi automatique », « Jumelage » et « Clé » ci-dessous décrivent la première version et sont remplacés ; le reste (contenu envoyé, robot, réception) est inchangé.

- **But** : partager entre plusieurs téléphones, et constituer une base commune publique pour d'autres buralistes.
- **Ce qui part** : uniquement les contributions `{code → ref officielle}` (liste Douane ou FDJ) et `{préfixe de jeu → ref FDJ}`.
  - Une fiche créée à la main n'est pas partagée.
  - Ne partent jamais : comptages, stocks, prix, ruptures, nom du tabac, clé.
- **Envoi automatique** :
  - Une file d'attente (Dexie v3, table `outbox`) est alimentée à chaque modification d'un produit officiel qui ajoute un code (`contributionsFor`).
  - La file est envoyée regroupée 15 s après le dernier ajout, au démarrage et au retour du réseau, par `POST <relais>/v1/codes` (le relais ouvre l'issue GitHub `[codes-barres] N codes` avec un corps JSON).
  - ~~L'envoi utilise une clé fine-grained sur le téléphone~~ : remplacé, voir la nouvelle spec (la clé est dans le relais ; la CSP autorise l'adresse du relais).
- ~~**Jumelage** par QR code `LACAROTTE1`~~ : retiré, plus aucune clé sur les téléphones.
- **Robot** (workflow sur `issues: opened`, sur le planning hebdomadaire et à la main) :
  - il traite **tous** les messages `[codes-barres]` ouverts du propriétaire du dépôt ;
  - il vérifie le code (6 à 24 caractères), le préfixe (au moins 4 chiffres) et l'existence de la référence ;
  - un code déjà attribué à un autre produit est refusé ;
  - il met à jour `public/data/codes-barres.json`, lance les tests, publie, déploie, puis répond et ferme chaque message.
- **Réception** :
  - `syncSharedCodes` remplit `sharedBarcodes` et `sharedFdjPrefix` sur les produits officiels ;
  - priorité : `user` d'abord, puis `base`, puis `shared` ;
  - la réception est réappliquée après une mise à jour des listes.
- **Clé** : ~~gardée sur le téléphone~~ : elle est désormais un secret du relais (`RELAY_GITHUB_TOKEN`). Quand elle expire, l'administrateur la remplace dans GitHub et relance le déploiement (voir le README).

## 17. Remplaçants des cigarettes et du tabac à rouler (validé le 16/10/2026)

L'ancien score (force et goût estimés, prix) ne permettait pas d'expliquer un choix au client. Il reste utilisé pour les cigares, les cigarillos et les jeux.

Pour les **cigarettes** et le **tabac à rouler**, le raisonnement suit le **nom officiel** (`src/domain/rangeProfile.ts`) :
- la **marque** (dont les marques en plusieurs mots, et sans le « by … ») ;
- la **couleur de gamme** et son niveau :
  - rouge, noir, classique → corsé (4) ;
  - bleu, gold, blond → équilibré (3) ;
  - argent, clair, vert → léger (2) ;
  - blanc → très léger (1) ;
- le **type** : blond ou brun. Il vient du nom (« brunes ») ou de la marque (Gitanes) ;
- le **format** : nombre de cigarettes ou poids, longueur (100s, longues, slims), paquet rigide ou souple ;
- le **prix officiel**.

L'ordre des propositions (`suggestSubstitutes`) :
1. même marque, même couleur, format le plus proche ;
2. même marque, couleur voisine, avec « un cran plus léger » ou « plus corsé » ;
3. même marque, couleur non précisée ;
4. autre marque, même niveau de goût, même format, prix le plus proche ;
5. autre marque, même niveau de goût, autre format.

Règles :
- au plus 3 propositions de la même marque, puis d'autres marques, 5 propositions au total ;
- les épinglés restent en tête ;
- jamais de brun pour un blond, ni de produit retiré, pas encore en vente ou en rupture.

Chaque proposition affiche une phrase, par exemple : « Même marque, même goût (Rouge), paquet de 25 au lieu de 20 · +0,20 € ». La fiche affiche une ligne « Gamme » : marque, couleur, niveau, format.
