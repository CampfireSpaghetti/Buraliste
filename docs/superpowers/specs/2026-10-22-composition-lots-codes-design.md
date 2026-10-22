# Composition du tabac, lots des jeux de grattage, codes-barres rattachés (conception)

- **Date** : 22/10/2026
- **Statut** : développée le 22/10/2026 (validée par le propriétaire, « Fais le nécessaire »), sans accord écrit de la FDJ ni de l'ANSES. Les passages « Réalisé » ci-dessous indiquent ce qui diffère de la conception initiale.
- **S'appuie sur** : rapport `reports/Composition tabac et lots grattage.md` (recherche du 22/10/2026), spec `2026-10-16-tabacs-multiples-design.md`

## 1. Objectifs

1. **Fiche d'un jeu de grattage** :
   - tableau des lots (montant × nombre de lots, par bloc de tickets) ;
   - chance de gagner, taux de retour aux joueurs, gain maximal ;
   - mise à jour automatique chaque semaine.
2. **Fiche d'une cigarette ou d'un tabac** : composition déclarée à l'ANSES (nicotine, goudron, monoxyde de carbone, ingrédients), mise à jour automatique.
3. **Codes-barres rattachés aux références existantes** :
   - un code scanné s'ajoute directement à la référence choisie (ex. un ticket CASH → la référence CASH) ;
   - un produit garde plusieurs codes ;
   - la fiche liste ces codes et permet d'en retirer ou d'en ajouter.

## 2. Données et sources

### 2.1 Lots FDJ

- **Source** : les pages de jeux de fdj.fr (`https://www.fdj.fr/jeux-illiko/<slug>`). Elles contiennent dans leur contenu Next.js :
  - `winningTables`, des lignes [nombre de lots, montant] ;
  - `winningDescription`, du type « 1 chance sur X … Y % » ;
  - le prix (`bet`).
- **Réalisé** : la source est bien les pages de jeux de fdj.fr (et non les règlements PDF) ; robot `scripts/fdj/updateLots.ts`, mis à jour chaque semaine.
- **Fiabilité** : les tableaux sont identiques à ceux des règlements des tickets papier, vérifié sur 5 jeux. C'est la même méthode que la liste des jeux déjà utilisée par l'app.
- **Contrôles** :
  - somme des lots = total publié quand il existe ;
  - chance recalculée ≈ chance publiée (écart < 1 %) ;
  - sinon, la nouvelle valeur est ignorée et l'ancienne est gardée.
- **Taille de bloc** : elle vient des règlements. Elle n'est pas dans la page. Elle est affichée seulement quand elle est connue : table `blocs` dans le script, à partir du rapport, par exemple CASH = 24 000 000.
- **Juridique** : l'app cite la source (« D'après le règlement FDJ du jeu ») et ne reproduit pas les pages. Ce sont des données que la FDJ et l'ANJ doivent rendre publiques. Le propriétaire a accepté ce risque sans accord écrit.
- **Fichier** : `public/data/fdj-lots.json`
  ```
  { version, fetchedAt, jeux: { [fdjRef]: { prix, chance, trj, gainMax, bloc?, lots: [{ montant, nombre }], source } } }
  ```
  La clé `fdjRef` est le même identifiant que `fdj-games.json`.

### 2.2 Composition ANSES

- **Source** : jeu de données data.gouv.fr « Produits du tabac et produits connexes déclarés sur le marché français ». On utilise les URL permanentes `https://www.data.gouv.fr/api/1/datasets/r/<uuid>` :
  - cigarettes `782aeeef-b2d3-4781-b0bf-a23f72a1c798` ;
  - autres produits `2e50e0a2-e81e-45bb-9fe9-3f8a1c835e57` ;
  - composition `ebbd0a65-703f-41e5-a566-1adb012c9bb4`.
  Format CSV `;` en UTF-8, mis à jour environ chaque mois.
- **Rapprochement avec les références Douane** :
  - aucun identifiant commun ;
  - comparaison sur la marque, la variante, le nombre de cigarettes ou le poids, et le paquet ;
  - un produit n'est rattaché que si la correspondance est sûre (score ≥ seuil, une seule candidate) ;
  - le taux de rapprochement est affiché dans le journal du workflow.
- **Codes-barres** : les EAN valides du fichier ANSES sont ajoutés aux codes officiels des références rapprochées.
  - **Réalisé** : seuls les numéros déclarés comme EAN, GTIN ou UPC sont gardés ; un numéro de type SKU ou interne qui passe la clé EAN est exclu. Un EAN déclaré pour deux produits ANSES différents est écarté partout. Un UPC-A (12 chiffres) et un GTIN-14 en « 0… » sont rangés en EAN-13 ; au scan, un UPC-A et son EAN-13 « 0… » sont le même code. Résultat sur les fichiers de juillet 2026 : 108 EAN sur 88 références.
- **Fichier** : `public/data/composition.json`
  ```
  { version, fetchedAt, source, produits: { [douaneRef]: { nicotine?, goudron?, co?, ingredients: [{ nom, fonction, brule }], ean: [] } } }
  ```
  Le fichier est chargé seulement quand une fiche s'ouvre : il est trop gros pour le démarrage.
  - **Réalisé** : si deux déclarations du même jour sont en désaccord sur les émissions, aucune émission n'est affichée (les ingrédients restent). La liste des ingrédients est limitée (« 60 premiers sur N », champ `ingredientsTotal`). Robot : `npm run anses:update`, étape du workflow hebdomadaire ; en cas d'échec ou de fichier illisible, le dernier fichier valide est gardé et le robot Douane continue.
- **Juridique** : données publiques sans licence indiquée. L'app cite la source : « Déclaration du fabricant à l'ANSES, <date> ».

### 2.3 Codes-barres des tickets FDJ

- **Ce que dit le règlement général FDJ** : le numéro d'un ticket commence par 5 chiffres, le code du jeu (3) puis l'émission (2). Exemple : 87105 = CASH, émission 05.
- **Ce qui n'est pas prouvé** : que le code-barres reprenne ce numéro.
- **Catalogue** : `fdj-games.json` reçoit `codes: string[]`, les préfixes à 5 chiffres connus pour chaque jeu. **Réalisé** : ils viennent de la table `scripts/fdj/gameCodes.ts`, **tenue à la main** par le propriétaire (avis FDJ mensuels et `Forclos.pdf`) ; rien n'est lu automatiquement.
- **Reconnaissance d'un ticket** :
  1. code connu exactement, ou commence par un préfixe déjà confirmé → le jeu ;
  2. commence par un préfixe du catalogue jamais confirmé sur ce téléphone → « Ce ticket est-il un CASH ? » avec [Oui] et [Autre jeu]. « Oui » confirme ce préfixe : la reconnaissance est ensuite directe et partagée avec les autres téléphones du tabac ;
  3. sinon → « Quel jeu ? », avec la liste des jeux existants et une recherche.
  - **Réalisé** : un numéro du catalogue FDJ d'un autre jeu bloque les préfixes appris ou reçus des autres téléphones (le ticket garde son jeu du catalogue) ; l'app et le robot refusent un préfixe qui empiète sur le numéro d'un autre jeu (message « à vérifier » côté robot).
- **Rattachement** :
  - le choix ajoute le code complet à la référence ;
  - l'app apprend un préfixe comme aujourd'hui (préfixe commun d'au moins 4 caractères, sans collision) ;
  - un produit peut avoir **plusieurs préfixes** (`fdjPrefixes`), un par émission ou par carnet.
- **Code de traçabilité** : un code qui commence par `KPL2F`, ou lu en DataMatrix non numérique, est refusé avec le message « Ce code change à chaque paquet : scannez le code-barres classique (EAN) du paquet. »

### 2.4 Codes-barres du tabac

- Un EAN inconnu ouvre « Associer à une référence » (écran existant), avec recherche dans les références officielles. Le code s'ajoute à la référence choisie, qui peut en avoir plusieurs (paquet, cartouche).
- La fiche produit affiche la liste des codes :
  - officiels, partagés et ajoutés ici ;
  - chacun avec « Retirer » s'il a été ajouté ici ;
  - un bouton « Ajouter un code » qui ouvre le scanner pour ce produit.
- **Réalisé** : « Retirer » efface aussi la contribution encore en attente d'envoi, mais pas un code déjà publié dans la liste commune (il reste à corriger à la main dans `public/data/codes-barres.json`). La fiche le précise dans une note.

## 3. Partage

- Les codes ajoutés et les préfixes confirmés passent par la couche partagée : champs `user.barcodes` et `user.fdjPrefixes`, partagés dans le tabac.
- Ils alimentent aussi la liste commune publique (contributions existantes). Les préfixes de jeu deviennent `fdjPrefixes` côté robot. Le robot accepte plusieurs préfixes par jeu, avec ses règles de conflit (R28) inchangées.

## 4. Hors périmètre

- Le goût des cigarettes : aucune source. On garde la logique par nom (rangeProfile).
- Les fiches de cigares tirées des sites spécialisés : ils interdisent la collecte automatique.
- Le nombre de tickets par émission : il n'est publié nulle part.
