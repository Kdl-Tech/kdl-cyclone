// Calculs géodésiques. Aucune dépendance, aucune E/S : testable seul.

const R_EARTH_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Distance grand-cercle en kilomètres. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap initial de a vers b, en degrés (0 = nord, sens horaire). */
export function bearingDeg(a, b) {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point atteint depuis `origin` en suivant `bearing` sur `dist` km. */
export function destination(origin, bearingDegrees, distKm) {
  const d = distKm / R_EARTH_KM;
  const brg = toRad(bearingDegrees);
  const la1 = toRad(origin.lat);
  const lo1 = toRad(origin.lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  const lo2 =
    lo1 +
    Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lon: ((toDeg(lo2) + 540) % 360) - 180 };
}

/** Rose des vents en français, à partir d'un cap en degrés. */
export function compassFr(bearingDegrees) {
  const noms = [
    'nord', 'nord-nord-est', 'nord-est', 'est-nord-est',
    'est', 'est-sud-est', 'sud-est', 'sud-sud-est',
    'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest',
    'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest',
  ];
  const i = Math.round((((bearingDegrees % 360) + 360) % 360) / 22.5) % 16;
  return noms[i];
}

/**
 * Distance d'un point à un segment de grand-cercle, approximée en plan local.
 * Suffisamment juste sur quelques centaines de kilomètres aux latitudes tropicales,
 * et sans dépendance. Retourne { distanceKm, fraction } où `fraction` situe
 * la projection sur le segment (0 = début, 1 = fin).
 */
export function distanceToSegmentKm(point, segStart, segEnd) {
  const lat0 = toRad((segStart.lat + segEnd.lat) / 2);
  const kx = R_EARTH_KM * Math.cos(lat0) * (Math.PI / 180);
  const ky = R_EARTH_KM * (Math.PI / 180);

  const px = (point.lon - segStart.lon) * kx;
  const py = (point.lat - segStart.lat) * ky;
  const vx = (segEnd.lon - segStart.lon) * kx;
  const vy = (segEnd.lat - segStart.lat) * ky;

  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { distanceKm: distanceKm(point, segStart), fraction: 0 };

  let t = (px * vx + py * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - t * vx;
  const dy = py - t * vy;
  return { distanceKm: Math.sqrt(dx * dx + dy * dy), fraction: t };
}

/** Distance minimale d'un point à une polyligne (trajectoire). */
export function distanceToTrackKm(point, track) {
  if (!track || track.length === 0) return null;
  if (track.length === 1) return distanceKm(point, track[0]);
  let best = Infinity;
  let bestIndex = 0;
  let bestFraction = 0;
  for (let i = 0; i < track.length - 1; i += 1) {
    const r = distanceToSegmentKm(point, track[i], track[i + 1]);
    if (r.distanceKm < best) {
      best = r.distanceKm;
      bestIndex = i;
      bestFraction = r.fraction;
    }
  }
  return { distanceKm: best, segmentIndex: bestIndex, fraction: bestFraction };
}

/** Point dans un polygone (anneau [{lat,lon}]), algorithme du rayon. */
export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Centroïde d'un anneau de points. */
export function ringCentroid(ring) {
  const n = ring.length;
  if (n === 0) return null;
  const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), { lat: 0, lon: 0 });
  return { lat: sum.lat / n, lon: sum.lon / n };
}

/** Conversion nœuds → km/h, arrondie à l'entier. */
export const ktToKmh = (kt) => Math.round(kt * 1.852);
/** Conversion km/h → nœuds. */
export const kmhToKt = (kmh) => kmh / 1.852;

export { R_EARTH_KM, toRad, toDeg };
