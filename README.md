# La Carotte

L'outil de poche du buraliste, pour iPhone et Android :

- **Scanner** un produit avec l'appareil photo et voir sa fiche (force, goût, origine, prix officiel) ;
- **Proposer un remplaçant** quand un produit manque ;
- **Compter les jeux de grattage** et envoyer le comptage en image .jpg sur Google Drive (par le menu Partager, sans accès de l'app au Drive).
- **Remettre le comptage à zéro** en un geste (avec confirmation, export proposé avant, et « Annuler »).
- **Suivre les tâches du jour** (onglet **À faire**) : la liste du matin et de l'après-midi, cochée avec l'heure, partagée entre les téléphones du tabac, et exportable en .jpg.

## Onglet « À faire »

- **Cocher** : toucher la tâche. L'heure s'affiche ; toucher de nouveau décoche.
- **Chaque jour**, la liste repart décochée toute seule (à minuit, heure du téléphone). **Remettre à zéro** décoche tout à n'importe quel moment, avec confirmation et « Annuler ».
- **+ Tâche** : texte et service (Matin ou Après-midi), ajoutée en fin de service. Le bouton **…** d'une tâche permet de la renommer, de changer son service ou de la supprimer (« Annuler » quelques secondes).
- **Ranger** : glisser la poignée ⠿ (ou, au clavier, flèches haut et bas sur la poignée).
- **Export .jpg** : les deux services, cochés ou non, avec les heures, par le menu Partager.
- Tout le monde dans le tabac peut cocher, ajouter, retirer et remettre à zéro. La liste de départ : vérifier stock grattage, cigarettes et tabletterie, remplir le linéaire, la vitrine et la machine à café (matin) ; vérifier stock grattage, nettoyer l'espace de travail et l'espace client (après-midi).

C'est une application web installable (PWA) : gratuite, sans App Store ni Play Store, elle fonctionne hors connexion. Les données sont enregistrées sur le téléphone. Dès que l'administrateur a mis le relais en service (voir plus bas), les données de chaque tabac sont envoyées automatiquement, **chiffrées**, pour être partagées avec les téléphones de ce tabac, et seulement eux.

## Installer l'app

Adresse : **https://wongmichel2048.github.io/Buraliste/**

- **iPhone (Safari, iOS 26 et suivants)** : ouvrir l'adresse dans Safari → bouton **Menu de la page** (•••, à côté de l'adresse) → **Partager** → faire défiler → **« Sur l'écran d'accueil »** → laisser **« Ouvrir comme app web »** activé → **Ajouter**. Si « Sur l'écran d'accueil » n'apparaît pas : tout en bas de la liste, « Modifier les actions ». Un lien ouvert depuis WhatsApp, Messages ou Gmail doit d'abord être ouvert dans Safari. iOS 18 et avant : bouton Partager en bas de l'écran → « Sur l'écran d'accueil ». Le guide pas à pas est aussi dans l'app : **Réglages** → **Installer sur mon téléphone**.
- **Android (Chrome)** : ouvrir l'adresse → menu ⋮ → « Installer l'application ».

## Plusieurs tabacs, plusieurs employés

Chaque gérant crée son tabac lui-même, sans compte ni mot de passe. Ses employés le rejoignent en scannant un QR code. Le partage se fait tout seul, comme dans une messagerie : une saisie faite sur un téléphone apparaît sur les autres, en général en moins de 30 secondes.

- **Créer un tabac** : toucher le nom du tabac en haut de l'écran → **Créer un tabac** → saisir le nom. Le tabac que vous aviez déjà devient votre premier tabac, sans rien perdre.
- **Inviter un employé** : **Réglages** → **Inviter un employé** → un QR code s'affiche. L'employé le scanne avec l'app (le scanner de l'app reconnaît ce QR code), puis confirme « Rejoindre « nom du tabac » ? ». Son téléphone se met à jour tout seul. Attention : **toute personne qui scanne ce QR code accède aux données du tabac**, ne le montrez qu'à vos employés.
- **Changer de tabac** : un même téléphone peut servir pour plusieurs tabacs. Toucher le nom du tabac en haut → choisir le tabac. Les données de chaque tabac restent séparées.
- **Ce qui est partagé dans un tabac** : le comptage des jeux de grattage, la liste « À faire » (tâches et cases cochées), les ruptures et remplaçants épinglés, les fiches créées ou corrigées, les jeux enlevés de la liste, le nom du tabac et les réglages. Si deux personnes modifient la même chose, la saisie la plus récente gagne.
- **Ce qui n'est jamais partagé** : la sauvegarde complète, l'écran ouvert, et tout ce qui concerne vos autres tabacs. Un employé qui n'a pas scanné votre QR code ne voit rien. Les fiches supprimées à la main restent supprimées seulement sur le téléphone où vous l'avez fait.
- **Confidentialité** : les données d'un tabac sont **chiffrées de bout en bout**. Elles sont chiffrées sur le téléphone avant d'être envoyées, avec une clé qui ne se trouve que sur les téléphones du tabac (elle voyage uniquement dans le QR code). **Personne ne peut lire les données d'un tabac** : ni le relais, ni Cloudflare qui l'héberge, ni GitHub, ni les autres tabacs, ni l'auteur de l'app.
- **Sans réseau**, tout fonctionne comme d'habitude. Les modifications partent au retour du réseau. Un petit point en haut indique l'état : vert, à jour ; laiton, envoi en attente ; gris, hors ligne ; rouge, problème (le détail est dans Réglages).
- **Retirer un employé** : il n'y a pas encore de retrait individuel. Pour écarter quelqu'un, créez un nouveau tabac et réinvitez les autres.
- **Téléphone réinstallé ou navigateur effacé (gérant)** : les données du tabac sont restées sur les téléphones des employés et sur le relais. Demandez à un employé d'ouvrir **Réglages** → **Inviter un employé** sur son téléphone, scannez son QR code : votre téléphone rejoint votre tabac et récupère tout.

Pour que tout cela fonctionne, l'administrateur de l'app doit mettre en service le relais une fois (voir ci-dessous).

## Mise en ligne (à faire une fois par le propriétaire du dépôt)

1. GitHub → Settings → General → *Danger Zone* → **Change visibility → Public**. Le code devient visible, mais aucune donnée du tabac n’est dans le dépôt.
2. GitHub → Settings → **Pages** → *Source* : **GitHub Actions**.

Ensuite, chaque modification fusionnée dans `main` est publiée automatiquement, et les listes officielles (tabacs Douane et jeux de grattage FDJ) sont mises à jour chaque lundi.

## Mettre en service le partage entre téléphones (administrateur)

Le partage permet aux téléphones d'un même tabac de voir les mêmes comptages, ruptures et réglages. Il passe par un petit relais gratuit chez Cloudflare. Tout est chiffré sur le téléphone avant l'envoi : Cloudflare ne peut rien lire. Seul l'administrateur a besoin d'un compte ; les gérants et les employés n'ont rien à créer.

À faire une seule fois, en 15 minutes environ :

1. **Créer un compte Cloudflare gratuit.** Aller sur <https://dash.cloudflare.com/sign-up>, saisir une adresse e-mail et un mot de passe, puis cliquer sur le lien reçu par e-mail. L'offre gratuite suffit.

2. **Créer une clé API Cloudflare.**
   1. Dans Cloudflare : icône de profil en haut à droite → **Profil** → **Jetons d'API** (*API Tokens*) → **Créer un jeton**.
   2. En face du modèle **Modifier Cloudflare Workers** (*Edit Cloudflare Workers*), cliquer sur **Utiliser le modèle**.
   3. **Ajouter la base de données D1**, que le modèle ne contient pas : dans la partie *Autorisations* (*Permissions*), cliquer sur **+ Ajouter** (*+ Add more*), puis choisir dans les trois listes **Compte** → **D1** → **Modifier** (*Account* → *D1* → *Edit*).
   4. Laisser les autres réglages proposés. Si une liste « Ressources de zone » demande un choix, prendre **Toutes les zones**.
   5. **Continuer vers le résumé** → **Créer le jeton**, puis **copier** le jeton affiché : il ne sera plus jamais montré.

3. **Coller les secrets dans GitHub.**
   1. Retrouver l'**identifiant du compte Cloudflare** : c'est la longue suite de 32 lettres et chiffres qui apparaît dans l'adresse de la page juste après `dash.cloudflare.com/` (elle est aussi affichée sur la page **Workers et Pages**, à droite, sous « ID du compte »).
   2. Créer une **clé GitHub** pour l'envoi des codes-barres : sur GitHub, photo de profil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
      - *Token name* : `La Carotte relais` ; *Expiration* : la durée la plus longue proposée ;
      - *Repository access* : **Only select repositories** → **Buraliste** ;
      - *Permissions* → *Repository permissions* → **Issues** : **Read and write** (rien d'autre) ;
      - **Generate token**, puis copier la clé.
   3. Dans le dépôt Buraliste sur GitHub : **Settings** → **Secrets and variables** → **Actions** → onglet **Secrets** → **New repository secret**. Créer ces trois secrets, en recopiant les noms exactement (en majuscules) :

      | Nom du secret | Valeur à coller |
      |---|---|
      | `CLOUDFLARE_API_TOKEN` | le jeton Cloudflare (étape 2) |
      | `CLOUDFLARE_ACCOUNT_ID` | l'identifiant du compte Cloudflare (étape 3.1) |
      | `RELAY_GITHUB_TOKEN` | la clé GitHub (étape 3.2) |

4. **Lancer le workflow « Déploiement ».** Dans le dépôt : onglet **Actions** → **Déploiement** (colonne de gauche) → bouton **Run workflow** → **Run workflow**. Attendre la coche verte, en quelques minutes.

C'est terminé : **il n'y a rien à recopier**. Le workflow crée la base de données, installe le relais et donne son adresse à l'app, qui est republiée aussitôt. L'adresse est affichée pour information dans le résumé du job `relay`.

Si le relais n'est pas mis en service, **l'app fonctionne exactement comme avant** : tout reste sur le téléphone, et les options de partage (« Inviter un employé », synchronisation) affichent « Bientôt disponible ».

Ensuite :

- chaque publication de l'app (et chaque lundi) met aussi le relais à jour, automatiquement ;
- quand la clé GitHub arrive à expiration, en créer une nouvelle (étape 3.2), remplacer le secret `RELAY_GITHUB_TOKEN`, puis relancer le workflow ;
- pour **retirer au relais la clé GitHub** (clé divulguée, ou arrêt de l'envoi des codes) : la révoquer sur GitHub (**Settings** → **Developer settings** → **Fine-grained tokens** → la clé → **Delete**), puis, soit la supprimer du relais (dans le dossier `relay/` : `npx wrangler secret delete GITHUB_TOKEN`) et supprimer le secret `RELAY_GITHUB_TOKEN` du dépôt, soit remplacer ce secret par une nouvelle clé et relancer le workflow « Déploiement » ;
- tant que ces secrets ne sont pas renseignés, l'app fonctionne comme avant et les options de partage affichent « Bientôt disponible ».

## Partage des codes-barres (liste commune)

Les codes-barres rattachés à un produit officiel (et les codes de jeux FDJ appris) sont partagés automatiquement avec tous les tabacs qui utilisent l'app.

Aucun compte et aucune clé sur les téléphones : l'app envoie les codes au relais, qui détient la clé GitHub (secret `RELAY_GITHUB_TOKEN`, voir plus haut). Tout est automatique :

- chaque code part tout seul vers le relais, qui ouvre un message (issue `[codes-barres]`) ;
- le robot vérifie que le code est valide et que la référence existe ;
- il ajoute le code à `public/data/codes-barres.json` (public) et republie l'app ;
- tous les téléphones le reçoivent à la prochaine ouverture.

Ces envois sont **anonymes** : le relais ouvre les messages avec la clé du propriétaire du dépôt, donc l'auteur affiché sur GitHub est toujours le propriétaire, quel que soit le téléphone qui a envoyé le code (le robot ne s'en sert que pour écarter les messages ouverts à la main par d'autres comptes). Pour limiter les abus, le relais n'accepte les codes que depuis l'app publiée et en nombre limité (10 messages par heure au total, et une limite par adresse). Surtout, le robot n'ajoute que des liens **nouveaux** : un envoi qui changerait un lien déjà publié (code-barres attribué à un autre produit, code de jeu FDJ différent) n'est jamais appliqué ; le message reste ouvert avec l'étiquette **« à vérifier »**, et c'est le propriétaire qui décide (corriger `public/data/codes-barres.json` à la main s'il le faut, puis fermer le message).

Sans relais configuré, les codes restent en attente sur le téléphone et Réglages affiche « Partage entre téléphones : bientôt disponible ».

Ne partent **que** les liens « code-barres → produit officiel ». Ils sont publics, sans nom de tabac. Les comptages, stocks, prix, ruptures et le nom du tabac ne partent jamais dans cette liste, et aucune clé n'est enregistrée sur le téléphone.

Résumé de ce qui quitte le téléphone : les données du tabac, **chiffrées**, vers le relais (illisibles pour lui) ; les liens « code-barres → produit officiel », vers la liste publique, par le relais ; les fichiers que vous partagez vous-même (export .jpg, sauvegarde). Rien d'autre.

## Données affichées et sources

- **Lots des jeux de grattage** : tableau des lots, chance de gagner et taux de retour, pris sur les pages des jeux de fdj.fr. Mise à jour chaque semaine, automatiquement. L'app indique « D'après le règlement FDJ du jeu » : ce sont des informations que la FDJ doit rendre publiques, sans accord écrit de sa part. Si une nouvelle valeur paraît incohérente (total des lots ou chance différents de ceux publiés), l'ancienne est gardée.
- **Composition du tabac** (nicotine, goudron, monoxyde de carbone, ingrédients) : déclarations des fabricants à l'ANSES, publiées sur data.gouv.fr (« Produits du tabac et produits connexes déclarés sur le marché français »), mises à jour environ chaque mois. L'ANSES n'a pas le même identifiant que la Douane : une fiche n'affiche la composition que si le rapprochement avec la liste Douane est sûr. Tous les produits ne sont donc pas couverts : environ 58 % des cigarettes, 40 % du tabac à rouler et 22 % des cigares. Ce sont des déclarations des fabricants, pas des mesures de l'app. La fiche indique « Données ANSES (fichier de <mois année>) » : c'est la date du fichier publié, la déclaration du fabricant peut être plus ancienne. Une déclaration « filtre » et une « sans filtre » ne sont jamais mélangées (« Gitanes » et « Gitanes Filtre » sont deux références).
- **Codes-barres** : un code inconnu se rattache à une fiche existante, au choix **produit du tabac** (une référence officielle de préférence, choisie par recherche) ou **jeu de grattage** (carnet, boîte, ticket : tous les jeux sont listés), et un produit peut avoir plusieurs codes (paquet, cartouche). Au comptage, un code-barres EAN inconnu demande aussi « C'est quel jeu ? » avant de proposer un nouveau jeu. Un EAN rattaché à un jeu reste sur ce tabac (partagé entre ses téléphones), il ne part pas dans la liste commune. Pour un ticket de jeu, l'app propose « Ce ticket est-il un … ? » au premier scan, puis le reconnaît seule ; chaque nouvelle émission d'un jeu se reconnaît de la même façon. Pour les jeux, seul le code du jeu part dans la liste commune, jamais le numéro complet d'un ticket (propre à chaque ticket, il reste sur ce tabac). La fiche liste les codes du produit : **Retirer** supprime un code ajouté sur le tabac et annule son envoi s'il est encore en attente, mais pas s'il est déjà publié dans la liste commune (le propriétaire le corrige alors à la main dans `public/data/codes-barres.json`) ; **Ajouter un code** ouvre le scanner. Le code de traçabilité imprimé sur les paquets (il commence par `KPL2F` ou se lit en DataMatrix) change à chaque paquet : l'app le refuse et demande de scanner le code-barres classique (EAN).
- **Prix et liste des tabacs** : Douane, mise à jour chaque semaine.

**Une tâche manuelle pour le propriétaire** : quand la FDJ annonce une nouvelle émission d'un jeu de grattage, ajouter son numéro (5 chiffres : code du jeu puis numéro d'émission) dans `scripts/fdj/gameCodes.ts`. Les numéros se trouvent sur fdj.fr/informations/reglements : l'« Avis relatif aux jeux de grattage » publié chaque mois, et le PDF « Validité des tickets vendus en points de vente ». Sans cette mise à jour, l'app fonctionne toujours : elle demande simplement de confirmer le jeu au premier scan d’une nouvelle émission. La modification de `scripts/fdj/gameCodes.ts` ne suffit pas à elle seule : elle est prise en compte au prochain passage du robot (le lundi), ou tout de suite avec **Actions → Déploiement → Run workflow** sur GitHub (un simple envoi du fichier ne relance pas `fdj:update`).

## Liste de contrôle du premier test au comptoir

- [ ] Installation sur l'écran d'accueil (iPhone et Android)
- [ ] Scan d'un paquet de cigarettes → créer ou rattacher la fiche
- [ ] Scan de 2 tickets d'un même jeu, puis d'un autre jeu → le jeu est bien reconnu
- [ ] Comptage complet du présentoir, puis export .jpg vers Drive
- [ ] Sauvegarde complète envoyée sur Drive

## Développement

```bash
npm install
npm run dev        # serveur local
npm test           # tests unitaires (Vitest)
npm run e2e        # tests de bout en bout (Playwright)
npm run refs:update  # récupère la dernière liste officielle Douane
npm run fdj:update   # récupère la gamme des jeux de grattage (fdj.fr)
npm run relay:mock   # faux relais de partage sur http://localhost:8787 (tests de bout en bout)
```

Conception : `docs/superpowers/specs/2026-10-16-la-carotte-design.md` et `docs/superpowers/specs/2026-10-16-tabacs-multiples-design.md` · Plan : `docs/superpowers/plans/2026-10-16-la-carotte.md`
