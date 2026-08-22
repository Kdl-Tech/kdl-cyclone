/**
 * Mesure d'audience minimale et sans profilage.
 *
 * Ce qui est enregistré : des compteurs agrégés par jour et par page, rien de plus.
 * Ce qui n'est JAMAIS enregistré : adresse IP, identifiant d'appareil, cookie,
 * empreinte de navigateur, position géographique, parcours individuel, référent.
 *
 * Il n'existe aucun moyen, à partir de ce fichier, de reconstituer la visite
 * d'une personne : on ne sait pas qui, ni d'où, ni dans quel ordre.
 *
 * Désactivation complète : KDL_CYCLONE_MESURE=off
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const ACTIVE = process.env.KDL_CYCLONE_MESURE !== 'off';
const FICHIER = 'mesure.json';
const RETENTION_JOURS = 90;

// Seuls ces événements sont acceptés. Tout autre nom est rejeté : impossible
// de faire passer une donnée arbitraire par cette voie.
const EVENEMENTS = new Set([
  'visite',
  'installation_pwa',
  'clic_kdltech',
  'partage',
  'erreur_technique',
]);

const PAGES_VALIDES = new Set([
  'accueil', 'carte', 'guadeloupe', 'preparation', 'sources', 'apropos', 'mentions', 'systeme',
]);

let compteurs = null;
let ecritureEnAttente = false;

function chemin() {
  return path.join(CONFIG.dataDir, FICHIER);
}

function charger() {
  if (compteurs) return compteurs;
  try {
    compteurs = JSON.parse(fs.readFileSync(chemin(), 'utf8'));
  } catch {
    compteurs = { depuis: new Date().toISOString().slice(0, 10), jours: {} };
  }
  return compteurs;
}

/** Écriture différée : un seul passage disque par minute au maximum. */
function planifierEcriture() {
  if (ecritureEnAttente) return;
  ecritureEnAttente = true;
  setTimeout(async () => {
    ecritureEnAttente = false;
    try {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
      const tmp = `${chemin()}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(compteurs), 'utf8');
      await fsp.rename(tmp, chemin());
    } catch { /* la mesure ne doit jamais faire échouer une requête */ }
  }, 60000).unref();
}

function purger(c) {
  const limite = new Date(Date.now() - RETENTION_JOURS * 86400000).toISOString().slice(0, 10);
  for (const jour of Object.keys(c.jours)) {
    if (jour < limite) delete c.jours[jour];
  }
}

/**
 * Enregistre un événement agrégé.
 * @param {string} evenement  Doit appartenir à la liste blanche.
 * @param {string} [page]     Doit appartenir à la liste blanche.
 */
export function enregistrer(evenement, page) {
  if (!ACTIVE) return false;
  if (!EVENEMENTS.has(evenement)) return false;

  const c = charger();
  const jour = new Date().toISOString().slice(0, 10);
  if (!c.jours[jour]) c.jours[jour] = { evenements: {}, pages: {} };

  const j = c.jours[jour];
  j.evenements[evenement] = (j.evenements[evenement] || 0) + 1;
  if (evenement === 'visite' && page && PAGES_VALIDES.has(page)) {
    j.pages[page] = (j.pages[page] || 0) + 1;
  }

  purger(c);
  planifierEcriture();
  return true;
}

/** Synthèse lisible — publique, puisqu'elle ne contient aucune donnée personnelle. */
export function synthese() {
  if (!ACTIVE) return { active: false, message: 'La mesure d\'audience est désactivée.' };
  const c = charger();
  const jours = Object.keys(c.jours).sort();
  const total = { evenements: {}, pages: {} };
  for (const jour of jours) {
    for (const [k, v] of Object.entries(c.jours[jour].evenements)) {
      total.evenements[k] = (total.evenements[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(c.jours[jour].pages)) {
      total.pages[k] = (total.pages[k] || 0) + v;
    }
  }
  return {
    active: true,
    politique: 'Compteurs agrégés uniquement. Aucune adresse IP, aucun cookie, aucun profilage.',
    retentionJours: RETENTION_JOURS,
    depuis: jours[0] || null,
    total,
    parJour: c.jours,
  };
}

export const mesure = { enregistrer, synthese, active: ACTIVE, evenements: [...EVENEMENTS] };
