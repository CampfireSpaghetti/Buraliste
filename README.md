# La Carotte

L'outil de poche du buraliste, pour iPhone et Android :

- **Scanner** un produit avec l'appareil photo et voir sa fiche (force, goût, origine, prix officiel) ;
- **Proposer un remplaçant** quand un produit manque ;
- **Compter les jeux de grattage** et envoyer le comptage en image .jpg sur Google Drive (par le menu Partager, sans accès de l'app au Drive).

C'est une application web installable (PWA) : gratuite, sans App Store ni Play Store, elle fonctionne hors connexion. Toutes les données restent sur le téléphone.

## Installer l'app

Adresse : **https://wongmichel2048.github.io/Buraliste/**

- **iPhone (Safari)** : ouvrir l'adresse → bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : ouvrir l'adresse → menu ⋮ → « Installer l'application ».

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

Ensuite :

- chaque publication de l'app met aussi le relais à jour, automatiquement ;
- quand la clé GitHub arrive à expiration, en créer une nouvelle (étape 3.2), remplacer le secret `RELAY_GITHUB_TOKEN`, puis relancer le workflow ;
- tant que ces secrets ne sont pas renseignés, l'app fonctionne comme avant et les options de partage affichent « Bientôt disponible ».

## Partage des codes-barres (liste commune)

Les codes-barres rattachés à un produit officiel (et les codes de jeux FDJ appris) peuvent être partagés automatiquement entre vos téléphones, et avec tous les buralistes qui utilisent l'app :

1. **Réglages › Partage des codes-barres › Activer le partage** : collez une clé GitHub « fine-grained » limitée au dépôt Buraliste avec le seul droit **Issues : lecture et écriture** (guide pas à pas dans l'app).
2. **Autres téléphones** : Réglages › *Jumeler un autre téléphone* affiche un QR code. L'autre téléphone le scanne dans l'onglet Scanner.
3. Ensuite tout est automatique :
   - chaque code part tout seul dans un message (issue `[codes-barres]`) ;
   - le robot vérifie que l'expéditeur est bien le propriétaire du dépôt, que le code est valide et que la référence existe ;
   - il ajoute le code à `public/data/codes-barres.json` (public) et republie l'app ;
   - tous les téléphones le reçoivent à la prochaine ouverture.

Ne partent **que** les liens « code-barres → produit officiel ». Les comptages, stocks, prix, ruptures et le nom du tabac ne partent jamais, et la clé n'est jamais incluse dans les sauvegardes.

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

Conception : `docs/superpowers/specs/2026-10-16-la-carotte-design.md` · Plan : `docs/superpowers/plans/2026-10-16-la-carotte.md`
