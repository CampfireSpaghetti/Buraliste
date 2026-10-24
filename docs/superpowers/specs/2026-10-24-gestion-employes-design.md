# Gestion des employés : liste, rôles, retrait avec changement de clé

Date : 24/10/2026. Point 3 de l'audit de sécurité : un employé qui quitte le tabac garde l'accès (la clé du tabac est
dans le QR code d'invitation et ne change jamais). Choix du gérant : gestion complète.

## Décisions du gérant

| Question | Réponse |
|---|---|
| Solution | Liste des téléphones, retrait avec changement de clé automatique, rôles gérant / employé, second gérant |
| Gérant d'un tabac déjà en service | Le premier qui touche « Je suis le gérant » ; aucun nom affiché d'office : chacun tape le sien |
| Réservé au gérant | Inviter / retirer / rôles ; nom du tabac ; supprimer un comptage de l'historique ; modifier la liste « À faire » (ajouter, renommer, supprimer, ranger tâches et titres, remettre à zéro) |
| Ouvert à tous | Scanner, compter, « Fin comptage », cocher les tâches, consulter |

## Membres

`Member` (table `members`, base v10, entité partagée `member`, id = identifiant de l'appareil) :
`name` (texte, peut être vide), `role` (`gerant` | `employe`), `pub` (clé publique ECDH P-256 de ce téléphone pour ce
tabac, base64url), `joinedAt`, `lastSeen` (ms), `removed` (booléen).

- Chaque téléphone crée au démarrage sa paire de clés ECDH pour le tabac (gardée dans `syncState`, jamais partagée) et
  publie son membre. `lastSeen` est rafraîchi au plus tous les quarts d'heure.
- Le nom de la personne est gardé sur le téléphone (`carotte:nom`), repris pour chaque tabac ; demandé en rejoignant
  un tabac, et une fois après la mise à jour (« Plus tard » possible) ; modifiable dans « Employés ».
- Aucun gérant : tout le monde garde tous les droits, et « Employés » propose « Je suis le gérant » (le nom est
  demandé s'il manque). Un gérant peut nommer un autre gérant, ou retirer ce rôle (jamais au dernier gérant).
- Les rôles sont appliqués par l'app : ce n'est pas une barrière contre un employé qui modifierait son app. Le retrait,
  lui, est garanti par le chiffrement.

## Retrait d'un employé (changement de clé)

Sur le téléphone du gérant, relais joignable :
1. dernière synchronisation sur le canal actuel ; le membre retiré reçoit `removed: true` (partagé) ;
2. nouvelle clé de tabac K2 ; pour chaque membre restant ayant une clé publique (le gérant compris), K2 est chiffrée
   pour lui : clé éphémère ECDH, AES-256-GCM, id du membre en données associées ;
3. message de contrôle `{ v: 1, rotation: { epub, wraps: { <id>: { iv, data } } } }` envoyé sur l'ancien canal ;
4. le registre du tabac prend K2, la position dans le canal est oubliée : le téléphone rejoint le nouveau canal et y
   publie son état complet (photographie). La page est rechargée.

Sur chaque autre téléphone, en lisant l'ancien canal : les opérations avant le message sont appliquées ; au message de
contrôle, la lecture de l'ancien canal s'arrête.
- Sa clé y est : K2 remplace la clé, il rejoint le nouveau canal et y publie son état (rien ne se perd des
  modifications faites entre-temps), la page est rechargée.
- Sa clé n'y est pas, ou son membre est `removed` : écran « Vous n'avez plus accès au tabac « X » ».
  - Employé : « OK » supprime la base de ce tabac sur le téléphone (un tabac neuf la remplace si c'était le seul).
  - Gérant (cas d'un téléphone piraté qui l'aurait exclu) : les données restent, avec « Sauvegarde complète ».
- Une ancienne invitation (QR code, lien) mène à l'ancien canal : « plus d'accès ».
- Un téléphone pas encore à jour n'a pas de clé publique : il perd l'accès et doit être réinvité (annoncé dans la
  confirmation).
- Le message de contrôle est lu dans l'ordre : un faux message envoyé ensuite par le retiré sur l'ancien canal arrive
  après le vrai et n'est jamais lu.

## Écran « Employés » (Réglages, bloc « Mon tabac »)

- Bouton « Employés · N ».
- Liste : gérants d'abord, puis par nom ; « Téléphone sans nom » si vide ; « (ce téléphone) » ; rôle ; « actif il y a
  2 h ».
- Gérant, sur un autre membre : « Nommer gérant » / « Retirer le rôle de gérant », « Retirer du tabac »
  (confirmation, connexion nécessaire, « Changement de la clé… »).
- Chacun : « Modifier mon nom ». Sans gérant : « Je suis le gérant ».
- Employé : « Inviter un employé », nom du tabac (lecture seule), suppression d'un comptage, modifications de la liste
  « À faire » masqués, avec « Réservé au gérant » là où c'est utile.

## Tests

- Chiffrement : clé emballée pour chaque membre, lue par lui seul, refusée à un autre ou avec un autre id.
- Base : membre et clés créés une fois, nom, rôles (dernier gérant), opération `member` reçue, migration v10.
- Moteur : message de contrôle → nouvelle clé pour un membre restant, « plus d'accès » pour le retiré ; opérations
  d'avant appliquées, suivantes ignorées.
- Bout en bout, trois téléphones : gérant déclaré, rôles appliqués chez l'employé, retrait d'un employé ; le retiré
  perd l'accès, l'autre employé continue de recevoir les modifications du gérant sur la nouvelle clé.
