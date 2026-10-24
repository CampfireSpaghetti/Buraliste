# Historique du comptage grattage, et Réglages en blocs

Date : 24/10/2026. Demandes du gérant : un bouton « Fin comptage » en bas de l'onglet Grattage qui enregistre le
comptage dans un historique des 8 derniers comptages, accessible par un bouton en haut de la page ; la page Réglages
mise à jour.

## Décisions du gérant

| Question | Réponse |
|---|---|
| Après « Fin comptage » | Au choix : « Enregistrer et remettre à zéro » ou « Enregistrer seulement » |
| Dans l'historique | Voir le détail, comparer au comptage précédent, supprimer (avec « Annuler ») |
| Réglages | Réorganiser en blocs ; textes à jour (liste « À faire », titres, historique) |

## Historique

`CountSnapshot` (table `countHistory`, base v9, entité partagée `snapshot`) :

| Champ | Type | Partagé | Sens |
|---|---|---|---|
| `id` | texte | — | id au hasard |
| `at` | nombre (ms) | oui | date et heure de « Fin comptage » |
| `lines` | liste de `{ key, name, code, linearQty, stockQty }` | oui | tableau complet au moment de l'enregistrement |
| `deleted` | booléen | oui | supprimé |

- `key` relie un jeu d'un comptage à l'autre : `gameId` de la ligne, sinon `nom:<nom sans accents ni majuscules>`.
- Au plus **8** comptages visibles : en enregistrer un 9e supprime (partagé) les plus anciens au-delà de 8.
- Écart avec le précédent (le comptage visible juste avant, par date) : pour chaque jeu, (linéaire + stock) − (linéaire
  + stock du précédent) ; jeu absent du précédent : « nouveau » ; total des écarts. Négatif = tickets vendus, positif =
  livraison.
- « Fin comptage » : confirmation avec « Enregistrer et remettre à zéro », « Enregistrer seulement », « Annuler » ;
  puis message « Comptage enregistré » avec « Annuler » (retire le comptage, rend ceux supprimés pour faire de la place,
  et rend les quantités si elles ont été remises à zéro). Désactivé si le tableau est vide.
- Bouton « Historique · N comptages » en haut de l'onglet Grattage (« Historique » sans comptage, désactivé).
- Panneau « Historique du grattage » : un comptage par ligne, le plus récent en haut : date et heure, nombre de jeux,
  totaux, écart total. Toucher ouvre le détail : tableau Jeu / Linéaire / Stock / Écart, totaux, « Supprimer ce
  comptage » (confirmation, puis « Annuler »).
- Sauvegarde complète : champ `history` facultatif.
- Version précédente de l'app : ignore l'historique ; la migration v9 fait rejoindre le canal (comme v7, v8).

## Réglages

Blocs (cartes), dans cet ordre :
1. **Mon tabac** : nom, « Inviter un employé », état de la synchronisation, ce qui est partagé (comptage et son
   historique, liste « À faire » et ses titres, ruptures, fiches, réglages).
2. **Sauvegarde** : « Sauvegarde complète », « Restaurer… », dernière sauvegarde, ce qu'elle contient (catalogue,
   comptage et historique, liste « À faire »).
3. **Installer l'app** : « Installer sur mon téléphone ».
4. **Données et sources** (repliée) : listes officielles, jeux FDJ, codes-barres, ce qui quitte le téléphone, sources.

## Tests

- Domaine : clé de jeu, photo du comptage, 8 au plus, écart avec le précédent (jeu nouveau, jeu disparu).
- Base : enregistrer, élaguer au-delà de 8, supprimer / annuler, réception d'une opération `snapshot`, photographie,
  migration v9, sauvegarde.
- Bout en bout : « Fin comptage » enregistrer seulement / avec remise à zéro, « Annuler », historique (liste, détail,
  écart, supprimer + annuler), 8 au plus ; Réglages en blocs ; deux téléphones voient le comptage enregistré.
