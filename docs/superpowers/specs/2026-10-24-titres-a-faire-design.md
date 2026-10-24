# Titres de la liste « À faire » : renommer, ajouter, supprimer, ranger

Date : 24/10/2026. Demande du gérant : pouvoir modifier, renommer, ajouter et supprimer les titres « Matin » et
« Après-midi » de l'onglet « À faire ». Complète `2026-10-23-onglet-a-faire-design.md`.

## Décisions du gérant

| Question | Réponse |
|---|---|
| Supprimer un titre qui a des tâches | Ses tâches sont supprimées avec lui : confirmation (« … et ses 9 tâches »), puis « Annuler » |
| Nouveau titre | Toujours vide, ajouté en bas |
| Ordre des titres | « Monter » / « Descendre » dans la feuille du titre |

## Données

`Section` (table `sections`, base v8, entité partagée `section`) :

| Champ | Type | Partagé | Sens |
|---|---|---|---|
| `id` | texte | — | `matin`, `apres-midi` (titres de départ) ou id au hasard |
| `label` | texte | oui | titre affiché (1 à 40 caractères, espaces retirés aux bouts) |
| `order` | nombre | oui | rang des titres |
| `deleted` | booléen | oui | supprimé (gardé pour la synchronisation) |

- `Task.service` devient l'id d'un titre (texte quelconque). Les tâches existantes gardent `matin` / `apres-midi`.
- Titres de départ `matin` (« Matin », 1) et `apres-midi` (« Après-midi », 2) : créés sur chaque téléphone sans
  opération, une seule fois (repère `sectionsSeeded`), comme la liste de base. Un titre de départ supprimé ne revient pas.
- Une tâche dont le titre n'existe pas (ou est supprimé) n'est pas affichée ; elle est supprimée avec son titre.
- Monter / Descendre : échange les rangs avec le titre voisin (deux écritures).
- Supprimer : `deleted` sur le titre et sur chacune de ses tâches (partagé) ; « Annuler » rend le titre et ces tâches
  telles qu'elles étaient.
- Comptes, remise à zéro, export : sur tous les titres visibles, dans leur ordre.

## Synchronisation et versions

- Entité `section` acceptée par la couche partagée et la photographie. Un titre de départ jamais modifié n'est pas une
  donnée à publier.
- Une version précédente de l'app ignore les titres et refuse un `service` autre que `matin` / `apres-midi` : une tâche
  d'un nouveau titre y apparaît sous Matin. À la mise à jour (base v8), un téléphone déjà synchronisé rejoint de
  nouveau le canal (comme en v7) pour récupérer titres et services.
- Sauvegarde : champ `sections` facultatif ; restaurer une sauvegarde qui en contient les remplace.

## Écran

- Boutons du haut : « + Tâche », « + Titre », « Export .jpg » ; « Remettre à zéro » en dessous.
- Chaque titre : bouton « … » (« Modifier le titre « Matin » ») qui ouvre sa feuille : texte, Monter, Descendre,
  « Supprimer le titre et ses N tâches », Enregistrer.
- « + Titre » : feuille « Nouveau titre » (texte), ajouté en bas.
- Feuilles des tâches : le titre se choisit parmi tous les titres (boutons, plusieurs lignes si besoin).
- Aucun titre : « Aucun titre. Touchez « + Titre » pour commencer. » ; « + Tâche » désactivé.

## Tests

- Domaine : titres visibles triés, voisin pour Monter / Descendre, comptes et mise en page de l'export sur N titres.
- Base : titres de départ créés une fois ; ajouter, renommer, monter, descendre ; supprimer avec ses tâches puis
  annuler ; opération `section` reçue ; photographie ; migration v8 (rejoindre) ; sauvegarde.
- Bout en bout : renommer « Matin », ajouter « Fermeture » (vide, en bas), y ajouter une tâche, monter le titre,
  supprimer « Après-midi » et ses tâches puis annuler, texte vide refusé ; deux téléphones voient le titre ajouté.
