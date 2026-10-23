# Onglet « À faire » : liste de tâches du tabac

Date : 23/10/2026. Demande du gérant : un onglet entre Catalogue et Grattage, avec la liste des tâches à faire par
l'employé, une case à cocher et l'heure à laquelle la tâche a été faite, séparée en service du matin et de
l'après-midi, avec ajout, retrait, remise à zéro, export, et des poignées pour ranger les tâches dans l'ordre.

## Décisions du gérant

| Question | Réponse |
|---|---|
| Qui peut modifier la liste | Tout le monde (comme le reste de l'app, pas de code gérant) |
| Remise à zéro | Automatique chaque jour, plus un bouton « Remettre à zéro » |
| Liste de base | Répartie matin / après-midi (voir plus bas), chaque tâche peut changer de service |
| Export | Image .jpg par le menu Partager, comme le comptage grattage |
| Ordre | Poignée sur chaque tâche pour la déplacer dans son service |

## Liste de base

Matin : Vérifier stock grattage · Vérifier stock cigarettes · Vérifier stock tabletterie · Remplir le linéaire ·
Remplir la vitrine · Remplir la machine à café.

Après-midi : Vérifier stock grattage · Nettoyer l'espace de travail · Nettoyer l'espace client.

Les ids sont fixes (`base:1` à `base:9`) : chaque téléphone crée la même liste de son côté, sans opération partagée
(comme les lignes de jeu « jamais comptées »). La liste de base n'est créée qu'une fois par tabac et par téléphone
(repère local `tasksSeeded`) : une tâche de base supprimée ne revient pas.

## Données

`Task` (table `tasks`, base de chaque tabac, version 7 de la base) :

| Champ | Type | Partagé | Sens |
|---|---|---|---|
| `id` | texte | — | `base:<n>` ou id au hasard |
| `label` | texte | oui | texte de la tâche |
| `service` | `'matin'` ou `'apres-midi'` | oui | service |
| `order` | nombre | oui | rang dans le service (nombres à virgule : un déplacement n'écrit que la tâche déplacée) |
| `doneAt` | nombre (ms) | oui | heure où la tâche a été cochée ; 0 = pas faite |
| `deleted` | booléen | oui | supprimée (gardée pour la synchronisation, jamais affichée) |

Règles :
- **Faite aujourd'hui** = `doneAt` tombe le jour courant (heure du téléphone). La remise à zéro quotidienne n'écrit
  rien : à minuit, tous les téléphones voient la liste décochée en même temps, sans conflit.
- **Cocher** écrit `doneAt = maintenant` ; **décocher** écrit `doneAt = 0`.
- **Remettre à zéro** écrit `doneAt = 0` sur les tâches faites aujourd'hui ; « Annuler » rend les heures.
- **Ajouter** : en fin de service (`order` = plus grand + 1). **Changer de service** : en fin du nouveau service.
- **Déplacer** : `order` = milieu des deux voisines de la nouvelle place (avant la première : première − 1 ; après la
  dernière : dernière + 1). Si l'écart devient trop petit (< 1e-6), le service est renuméroté 1, 2, 3…
- Deux téléphones qui touchent des tâches différentes ne s'écrasent jamais ; sur la même tâche, la plus récente gagne
  (champ par champ, comme le reste).

## Synchronisation

- Nouvelle entité `task` dans la couche partagée (`sharedRepo.ts`) : clés partagées, types attendus, table, entité
  acceptée par `applyRemoteOps`, photographie (`snapshot.ts`) comprise.
- Une ancienne version de l'app ignore les opérations `task` (entité inconnue) sans erreur. Pour qu'un téléphone mis à
  jour après les autres récupère les tâches déjà créées, la migration v7 lui fait **rejoindre de nouveau le canal**
  (comme après une remise à zéro du relais) : il relit la dernière photographie et les messages qui la suivent, puis
  publie son état fusionné.
- Limite connue : une tâche modifiée avant cette mise à jour, et seulement présente dans des messages déjà couverts
  par une photographie publiée par une ancienne version, n'est pas récupérée. Elle se corrige en la modifiant de
  nouveau sur un téléphone à jour. Risque limité à la période de mise à jour.
- Une tâche de base jamais modifiée n'est pas une donnée à publier (comme une ligne de jeu jamais comptée).

## Sauvegarde

La sauvegarde complète contient les tâches (`tasks`, champ facultatif : les anciennes sauvegardes restent valides).
Restaurer une sauvegarde qui contient des tâches les remplace (les absentes sont supprimées, partagé) ; une sauvegarde
sans tâches laisse la liste telle quelle.

## Écran

```
 Scanner  Catalogue  [À faire]  Grattage  Réglages
 À faire · jeudi 23 octobre                 4 / 9
 [ + Tâche ]  [ Export .jpg ]   (Remettre à zéro)
 Matin                                       3 / 6
 ⠿ ☑ Vérifier stock grattage            08:12
 ⠿ ☐ Vérifier stock tabletterie
 Après-midi                                  1 / 3
 ⠿ ☑ Vérifier stock grattage            14:05
```

- Ligne : poignée ⠿ (glisser pour ranger dans le service), case + texte (toute la zone coche ou décoche, cible
  ≥ 48 px, vibration courte), heure à droite, bouton « … » qui ouvre la feuille de la tâche.
- Feuille de la tâche : texte modifiable, service (Matin / Après-midi), Enregistrer, Supprimer (« Annuler » quelques
  secondes).
- « + Tâche » : texte et service, ajoutée en fin de service.
- Poignée : glisser au doigt ou à la souris (pointer events, `touch-action: none`) ; au clavier, flèches haut et bas
  sur la poignée (accessible).
- « Remettre à zéro » : désactivé si rien n'est fait ; confirmation (« Exporter d'abord (.jpg) », Annuler, Remettre à
  zéro) puis « Annuler » dans le message.
- Export .jpg : nom du tabac, « Tâches du jour », date et heure, les deux services, ✓ ou case vide, heure faite, total
  « 4 / 9 faites ». Même panneau que le comptage (Partager, Télécharger).
- Service vide : « Aucune tâche. Touchez « + Tâche ». »

## Tests

- Domaine (`domain/tasks.ts`) : faite aujourd'hui, tri, rang entre deux voisines, renumérotation, comptes, liste de
  base, mise en page de l'export.
- Base : ajout, cocher/décocher, remise à zéro + annulation, suppression + annulation, déplacement, changement de
  service, liste de base créée une fois et pas recréée après suppression.
- Synchronisation : opération `task` reçue appliquée ; photographie avec tâches ; migration v7 qui fait rejoindre.
- Bout en bout : onglet entre Catalogue et Grattage, cocher (heure affichée), ajout, suppression + annuler, remise à
  zéro + annuler, déplacement au clavier et au doigt, export, liste décochée le lendemain, partage entre deux téléphones.
