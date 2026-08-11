/**
 * Point d'entrée du service.
 *
 * Un fichier dédié plutôt qu'une détection sur `process.argv` : le comportement
 * est alors identique quel que soit le lanceur — node en direct, PM2, systemd.
 *
 *   node demarrer.mjs
 */
import { demarrer } from './server.js';

demarrer();
