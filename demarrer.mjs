/**
 * Point d'entrée du service.
 *
 * Un fichier dédié plutôt qu'une détection sur `process.argv` : le comportement
 * est alors identique quel que soit le lanceur — node en direct, PM2, systemd.
 *
 *   node demarrer.mjs
 */
import { assurerEnvCharge } from './src/util/secrets.js';
import { demarrer } from './server.js';

// Les secrets sont lus avant tout le reste. Seuls des NOMS de variables sont
// journalisés ici — jamais une valeur, même tronquée.
const env = assurerEnvCharge();
if (env.charge) {
  console.log(`Secrets : ${env.cles.length} variable(s) lue(s) depuis .env — ${env.cles.join(', ')}`);
  if (env.permissive) {
    console.warn('Attention : le fichier .env est lisible au-delà de son propriétaire (chmod 600 attendu).');
  }
}

demarrer();
