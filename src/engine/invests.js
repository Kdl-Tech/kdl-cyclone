/**
 * Numéros d'investigation (« Invest 95L ») publiés par le NHC.
 *
 * Le bulletin TWO ne les mentionne pas : ils viennent des fichiers ATCF de
 * meilleure trajectoire (`atcf/btk/bal9X{année}.dat`), où chaque ligne est un
 * relevé daté. On rattache un Invest à une zone du bulletin quand son dernier
 * relevé tombe dans le polygone de la zone, ou au plus près de son point de
 * référence. Un Invest sans relevé récent est ignoré : les fichiers restent en
 * ligne longtemps après la disparition du système.
 */
import { distanceKm, pointInRing } from './geo.js';

/** Types de système du format ATCF, en français. */
export const TYPES_ATCF = {
  DB: 'Perturbation',
  LO: 'Basse pression',
  WV: 'Onde tropicale',
  TD: 'Dépression tropicale',
  TS: 'Tempête tropicale',
  HU: 'Ouragan',
  SD: 'Dépression subtropicale',
  SS: 'Tempête subtropicale',
  EX: 'Extratropical',
  PT: 'Post-tropical',
};

function coordonnee(brut) {
  const m = String(brut || '').trim().match(/^(\d+)([NSEW])$/);
  if (!m) return null;
  const v = Number(m[1]) / 10;
  return m[2] === 'S' || m[2] === 'W' ? -v : v;
}

/**
 * Lit un fichier ATCF de meilleure trajectoire et retient le relevé le plus
 * récent. Retourne `null` si rien n'est lisible.
 *
 * @param {string} texte  Contenu du fichier `balNNAAAA.dat`.
 */
export function lireAtcf(texte) {
  if (typeof texte !== 'string') return null;
  let dernier = null;
  for (const ligne of texte.split(/\r?\n/)) {
    const c = ligne.split(',').map((x) => x.trim());
    if (c.length < 9 || c[0] !== 'AL') continue;
    const numero = Number(c[1]);
    const d = c[2].match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
    const lat = coordonnee(c[6]);
    const lon = coordonnee(c[7]);
    if (!Number.isFinite(numero) || !d || lat === null || lon === null) continue;
    const horodatage = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4])).toISOString();
    // Un même instant peut porter plusieurs lignes (rayons de vent) : la
    // première suffit, elle porte la position et l'intensité.
    if (dernier && dernier.fixeLe === horodatage) continue;
    const ventKt = Number(c[8]);
    const pression = Number(c[9]);
    const fixe = {
      identifiant: `AL${String(numero).padStart(2, '0')}${d[1]}`,
      numero: `${numero}L`,
      fixeLe: horodatage,
      position: { lat, lon },
      ventKmh: Number.isFinite(ventKt) && ventKt > 0 ? Math.round(ventKt * 1.852) : null,
      pressionHpa: Number.isFinite(pression) && pression > 0 ? pression : null,
      type: c[10] || null,
      typeFr: TYPES_ATCF[c[10]] || null,
    };
    if (!dernier || fixe.fixeLe > dernier.fixeLe) dernier = fixe;
  }
  return dernier;
}

/**
 * Rattache chaque Invest récent à la zone du bulletin qui lui correspond.
 * Modifie les zones en place (`invest`, `identifiantNhc`) et retourne le
 * nombre de rattachements.
 *
 * @param {Array<object>} zones  Zones brutes du TWO (polygone `[lon, lat]`, position).
 * @param {Array<object>} invests  Derniers relevés lus par `lireAtcf`.
 * @param {object} [opts]
 * @param {number} [opts.maintenant=Date.now()]
 * @param {number} [opts.maxAgeH=36]  Au-delà, le relevé est considéré périmé.
 * @param {number} [opts.maxKm=600]  Distance maximale hors polygone.
 */
export function associerInvests(zones, invests, { maintenant = Date.now(), maxAgeH = 36, maxKm = 600 } = {}) {
  if (!Array.isArray(zones) || !Array.isArray(invests)) return 0;
  for (const z of zones) { z.invest = null; }
  let n = 0;

  const recents = invests
    .filter((i) => i && i.position && maintenant - new Date(i.fixeLe).getTime() <= maxAgeH * 3600 * 1000)
    .sort((a, b) => (a.fixeLe < b.fixeLe ? 1 : -1));

  for (const inv of recents) {
    let meilleure = null;
    let meilleureDistance = Infinity;
    for (const z of zones) {
      if (z.invest || !z.position) continue;
      const ring = Array.isArray(z.polygone) && z.polygone.length >= 3
        ? z.polygone.map((p) => ({ lon: p[0], lat: p[1] }))
        : null;
      const dedans = ring ? pointInRing(inv.position, ring) : false;
      const d = distanceKm(inv.position, z.position);
      // Une zone qui contient le relevé l'emporte toujours ; sinon la plus proche.
      const score = dedans ? -1 : d;
      if (score < meilleureDistance && (dedans || d <= maxKm)) {
        meilleure = z;
        meilleureDistance = score;
      }
    }
    if (meilleure) {
      meilleure.invest = { ...inv };
      meilleure.identifiantNhc = inv.identifiant;
      n += 1;
    }
  }
  return n;
}
