-- Base D1 du relais La Carotte. Rejouée à chaque déploiement : chaque instruction est sans effet si l'objet existe déjà.
-- canaux.dernier : numéro du dernier message du canal ; il ne recule pas quand le ménage supprime des messages.
CREATE TABLE IF NOT EXISTS canaux (canal TEXT PRIMARY KEY, ecriture_hash TEXT NOT NULL, cree INTEGER NOT NULL, dernier INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages (n INTEGER PRIMARY KEY AUTOINCREMENT, canal TEXT NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL, recu INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS messages_canal ON messages (canal, n);
CREATE TABLE IF NOT EXISTS photos (canal TEXT PRIMARY KEY, jusqua INTEGER NOT NULL, iv TEXT NOT NULL, data TEXT NOT NULL, recu INTEGER NOT NULL);
