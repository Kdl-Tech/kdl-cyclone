/**
 * Construit le fond de carte embarqué à partir de Natural Earth (domaine public).
 *
 * À lancer une seule fois : `npm run geo:build`. Le résultat est versionné dans
 * public/geo/ et servi par KDL Cyclone. L'application n'appelle jamais de
 * service cartographique en ligne — aucun coût, aucune fuite de position, et
 * la carte reste disponible hors connexion.
 *
 * Deux niveaux de détail :
 *   - monde  : 110 m, suffisant pour l'Afrique et les continents
 *   - antilles : 10 m sur l'arc, sinon les petites îles disparaissent
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SORTIE = path.join(ICI, '..', 'public', 'geo');

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

const COUCHES = [
  {
    fichier: 'monde.json',
    url: `${NE}/ne_110m_land.geojson`,
    bbox: { west: -104, east: -8, south: 0, north: 40 },
    tolerance: 0.12,
    minPoints: 4,
  },
  {
    // Arc antillais : assez de détail pour reconnaître chaque île, pas plus.
    fichier: 'antilles.json',
    url: `${NE}/ne_10m_land.geojson`,
    bbox: { west: -68, east: -58, south: 10, north: 20 },
    tolerance: 0.02,
    minPoints: 4,
    etendueMinDeg: 0.02,
  },
  {
    fichier: 'guadeloupe.json',
    url: `${NE}/ne_10m_land.geojson`,
    bbox: { west: -62.1, east: -60.8, south: 15.7, north: 16.7 },
    tolerance: 0.002,
    minPoints: 4,
    etendueMinDeg: 0.005,
  },
];

/** Étendue d'un contour en degrés — sert à écarter récifs et rochers isolés. */
function etendue(ring) {
  let minLon = Infinity; let maxLon = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return Math.max(maxLon - minLon, maxLat - minLat);
}

/** Simplification Douglas-Peucker sur des coordonnées [lon, lat]. */
function simplifier(points, tolerance) {
  if (points.length <= 2) return points;

  const distancePerpendiculaire = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const norme = Math.hypot(dx, dy);
    if (norme === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / norme;
  };

  let indexMax = 0;
  let distMax = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = distancePerpendiculaire(points[i], points[0], points[points.length - 1]);
    if (d > distMax) {
      distMax = d;
      indexMax = i;
    }
  }

  if (distMax > tolerance) {
    const gauche = simplifier(points.slice(0, indexMax + 1), tolerance);
    const droite = simplifier(points.slice(indexMax), tolerance);
    return [...gauche.slice(0, -1), ...droite];
  }
  return [points[0], points[points.length - 1]];
}

const dansBbox = (ring, b) =>
  ring.some(([lon, lat]) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north);

const arrondir = (ring, decimales) => {
  const f = 10 ** decimales;
  return ring.map(([lon, lat]) => [Math.round(lon * f) / f, Math.round(lat * f) / f]);
};

async function construire(couche) {
  process.stdout.write(`→ ${couche.fichier} … `);
  const res = await fetch(couche.url, { headers: { 'User-Agent': 'KDLCyclone/0.1 build-geo' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${couche.url}`);
  const geo = await res.json();

  const decimales = couche.tolerance < 0.01 ? 4 : 2;
  const polygones = [];

  for (const feature of geo.features || []) {
    const g = feature.geometry;
    if (!g) continue;
    const groupes = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const polygone of groupes) {
      for (const ring of polygone) {
        if (!dansBbox(ring, couche.bbox)) continue;
        if (couche.etendueMinDeg && etendue(ring) < couche.etendueMinDeg) continue;
        const simplifie = simplifier(ring, couche.tolerance);
        if (simplifie.length < couche.minPoints) continue;
        polygones.push(arrondir(simplifie, decimales));
      }
    }
  }

  const sortie = {
    source: 'Natural Earth (domaine public)',
    url: couche.url,
    bbox: couche.bbox,
    tolerance: couche.tolerance,
    polygones,
  };

  fs.mkdirSync(SORTIE, { recursive: true });
  const cible = path.join(SORTIE, couche.fichier);
  fs.writeFileSync(cible, JSON.stringify(sortie));
  const ko = Math.round(fs.statSync(cible).size / 1024);
  const pts = polygones.reduce((s, p) => s + p.length, 0);
  console.log(`${polygones.length} contours, ${pts} points, ${ko} Ko`);
}

for (const couche of COUCHES) {
  await construire(couche);
}
console.log('Fond de carte construit dans public/geo/');
