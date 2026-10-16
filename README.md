# La Carotte

L'outil de poche du buraliste, pour iPhone et Android :

- **Scanner** un produit avec l'appareil photo et voir sa fiche (force, goût, origine, prix officiel) ;
- **Proposer un remplaçant** quand un produit manque ;
- **Compter les jeux de grattage** et envoyer le comptage en image .jpg sur Google Drive (par le menu Partager, sans accès de l'app au Drive).

C'est une application web installable (PWA) : gratuite, sans App Store ni Play Store, elle fonctionne hors connexion. Toutes les données restent sur le téléphone.

## Installer l'app

Adresse : **https://wongmichel2048.github.io/buraliste/**

- **iPhone (Safari)** : ouvrir l'adresse → bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : ouvrir l'adresse → menu ⋮ → « Installer l'application ».

## Mise en ligne (à faire une fois par le propriétaire du dépôt)

1. GitHub → Settings → General → *Danger Zone* → **Change visibility → Public**. Le code devient visible, mais aucune donnée du tabac n'est dans le dépôt.
2. GitHub → Settings → **Pages** → *Source* : **GitHub Actions**.

Ensuite, chaque modification fusionnée dans `main` est publiée automatiquement, et la liste officielle des tabacs (Douane) est mise à jour chaque lundi.

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
```

Conception : `docs/superpowers/specs/2026-10-16-la-carotte-design.md` · Plan : `docs/superpowers/plans/2026-10-16-la-carotte.md`
