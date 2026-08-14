/**
 * Chargement des secrets d'environnement — sans dépendance.
 *
 * Règles tenues par ce module, dans l'ordre d'importance :
 *
 * 1. **Une valeur de secret n'est jamais journalisée.** Aucune fonction d'ici
 *    n'écrit une valeur, ni en clair, ni tronquée, ni « masquée ». Les seules
 *    choses qui sortent sont des noms de variables et des booléens.
 * 2. **L'environnement du processus prime sur le fichier.** Si PM2 ou systemd a
 *    déjà posé la variable, le fichier ne l'écrase pas : on ne veut pas qu'un
 *    `.env` oublié sur une machine prenne le pas sur la configuration réelle.
 * 3. **Le fichier reste optionnel.** Son absence n'est pas une erreur : elle
 *    veut simplement dire que la source qui en dépend restera désactivée.
 *
 * Le format accepté est volontairement pauvre — `CLE=valeur`, une par ligne,
 * `#` en commentaire, guillemets optionnels. Pas d'interpolation, pas
 * d'exécution : un fichier de secrets ne doit jamais être un programme.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

const CHEMIN_DEFAUT = process.env.KDL_CYCLONE_ENV_FILE || path.join(ROOT, '.env');

/** Découpe une ligne `CLE=valeur`. Retourne `null` si la ligne n'en est pas une. */
function ligneVersPaire(ligne) {
  const net = ligne.trim();
  if (!net || net.startsWith('#')) return null;

  const sansExport = net.startsWith('export ') ? net.slice(7).trim() : net;
  const egal = sansExport.indexOf('=');
  if (egal <= 0) return null;

  const cle = sansExport.slice(0, egal).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cle)) return null;

  let valeur = sansExport.slice(egal + 1).trim();
  const guillemet = valeur[0];
  if ((guillemet === '"' || guillemet === "'") && valeur.endsWith(guillemet) && valeur.length >= 2) {
    valeur = valeur.slice(1, -1);
  }
  return [cle, valeur];
}

/**
 * Charge le fichier de secrets dans `process.env`.
 *
 * @param {string} [chemin] Fichier à lire. Par défaut `.env` à la racine.
 * @returns {{ charge: boolean, cles: string[], permissive: boolean }}
 *   `cles` ne contient que des **noms**, jamais de valeurs.
 */
export function chargerEnv(chemin = CHEMIN_DEFAUT) {
  let contenu;
  let permissive = false;

  try {
    const info = fs.statSync(chemin);
    // 0o077 : un droit quelconque accordé au groupe ou aux autres.
    permissive = (info.mode & 0o077) !== 0;
    contenu = fs.readFileSync(chemin, 'utf8');
  } catch {
    return { charge: false, cles: [], permissive: false };
  }

  const cles = [];
  for (const ligne of contenu.split(/\r?\n/)) {
    const paire = ligneVersPaire(ligne);
    if (!paire) continue;
    const [cle, valeur] = paire;
    cles.push(cle);
    // L'environnement réel gagne toujours.
    if (process.env[cle] === undefined) process.env[cle] = valeur;
  }

  return { charge: true, cles, permissive };
}

let dejaCharge = false;

/**
 * Garantit que le fichier de secrets a été lu, quel que soit le point d'entrée
 * — serveur, collecte en ligne de commande, script de diagnostic. Idempotent.
 * @returns {{ charge: boolean, cles: string[], permissive: boolean }}
 */
export function assurerEnvCharge() {
  if (dejaCharge) return { charge: true, cles: [], permissive: false };
  dejaCharge = true;
  return chargerEnv();
}

/**
 * Lit un secret sans jamais le divulguer ailleurs que dans la valeur retournée.
 * @param {string} nom
 * @returns {string|null}
 */
export function secret(nom) {
  const brut = process.env[nom];
  if (typeof brut !== 'string') return null;
  const net = brut.trim();
  return net.length ? net : null;
}

/**
 * Indique si un secret est présent — utilisable dans un journal ou une réponse
 * d'API sans rien révéler.
 * @param {string} nom
 * @returns {boolean}
 */
export function secretPresent(nom) {
  return secret(nom) !== null;
}

/**
 * Retire toute occurrence des secrets connus d'un texte destiné à un journal,
 * à un message d'erreur ou à une réponse HTTP.
 *
 * Filet de sécurité, pas une permission : le code ne doit pas écrire un secret
 * en comptant sur ce nettoyage. Il existe parce qu'une bibliothèque tierce, un
 * message d'erreur réseau ou une URL mal construite peut en recopier un sans
 * qu'on l'ait voulu.
 *
 * @param {string} texte
 * @param {string[]} [noms] Noms des variables à masquer.
 * @returns {string}
 */
export function expurger(texte, noms = NOMS_SENSIBLES) {
  let sortie = String(texte ?? '');
  for (const nom of noms) {
    const valeur = secret(nom);
    if (valeur && valeur.length >= 8) {
      sortie = sortie.split(valeur).join('«secret masqué»');
    }
  }
  return sortie;
}

/** Variables considérées comme secrètes par l'application. */
export const NOMS_SENSIBLES = ['METEOFRANCE_API_TOKEN'];
