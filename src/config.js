// Configuration centrale — aucune valeur secrète ici.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const CONFIG = {
  port: Number(process.env.KDL_CYCLONE_PORT || 4240),
  host: process.env.KDL_CYCLONE_HOST || '127.0.0.1',
  dataDir: process.env.KDL_CYCLONE_DATA || path.join(ROOT, 'data'),
  timezone: 'America/Guadeloupe',

  // Cadence de collecte. Le serveur interroge les sources ; jamais le navigateur.
  // Budget Open-Meteo : 10 000 req/jour. À 5 min, < 800/jour dans le pire cas —
  // le NHC (domaine public) n'a pas de quota et la détection de « 304 inchangé »
  // évite tout retraitement inutile.
  collectIntervalMs: 5 * 60 * 1000,       // 5 min
  environmentIntervalMs: 60 * 60 * 1000,  // 1 h (données de modèle : maille horaire)

  // Au-delà, une donnée est signalée « périmée » dans l'interface.
  stalenessWarnMs: 45 * 60 * 1000,
  stalenessCriticalMs: 3 * 60 * 60 * 1000,

  userAgent: 'KDLCyclone/0.1 (+https://kdl-tech.fr; veille tropicale non commerciale)',
  requestTimeoutMs: 20000,

  // Nombre d'analyses conservées par système (historique 6/12/24 h et courbes).
  historyDepth: 96,
};

// Repère géographique de référence.
export const GUADELOUPE = {
  name: 'Guadeloupe',
  lat: 16.25,
  lon: -61.55,
  // Enveloppe de l'archipel (Basse-Terre, Grande-Terre, dépendances).
  bbox: { north: 16.55, south: 15.83, west: -61.85, east: -61.0 },
};

// Arc des Petites Antilles — utilisé pour l'évaluation « passage dans l'arc ».
export const LESSER_ANTILLES_ARC = [
  { name: 'Anguilla', lat: 18.22, lon: -63.06 },
  { name: 'Saint-Martin', lat: 18.07, lon: -63.05 },
  { name: 'Saint-Barthélemy', lat: 17.9, lon: -62.83 },
  { name: 'Antigua', lat: 17.11, lon: -61.85 },
  { name: 'Montserrat', lat: 16.74, lon: -62.19 },
  { name: 'Guadeloupe', lat: 16.25, lon: -61.55 },
  { name: 'La Dominique', lat: 15.41, lon: -61.37 },
  { name: 'Martinique', lat: 14.64, lon: -61.02 },
  { name: 'Sainte-Lucie', lat: 13.91, lon: -60.98 },
  { name: 'Saint-Vincent', lat: 13.25, lon: -61.2 },
  { name: 'La Barbade', lat: 13.19, lon: -59.54 },
  { name: 'La Grenade', lat: 12.12, lon: -61.67 },
];

// Bassin surveillé : côte ouest-africaine → mer des Caraïbes.
export const BASIN = { north: 32, south: 4, west: -100, east: -14 };
