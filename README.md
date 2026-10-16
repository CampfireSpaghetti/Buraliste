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
```

Conception : `docs/superpowers/specs/2026-10-16-la-carotte-design.md` · Plan : `docs/superpowers/plans/2026-10-16-la-carotte.md`
