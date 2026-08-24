/**
 * Direction de déplacement d'un système.
 *
 * Trois origines, dans l'ordre de confiance :
 *   1. le déplacement publié par le NHC pour un système nommé ;
 *   2. la ligne officielle du NHC (trajectoire prévue d'un système nommé, ou
 *      ligne de déplacement attendu d'une zone du TWO) ;
 *   3. les positions successives enregistrées par KDL.
 *
 * Aucune de ces fonctions n'invente une vitesse : une direction sans vitesse
 * reste une direction sans vitesse, et le corridor ne se trace pas.
 */
import { bearingDeg, compassFr, distanceKm } from './geo.js';

/**
 * Cap moyen d'une trace officielle `[[lon, lat], …]`, du premier au dernier
 * point. Retourne `null` si la trace est trop courte pour porter un sens.
 *
 * @param {Array<[number, number]>} trace
 * @param {number} [minKm=25]  En deçà, le tracé ne dit rien de fiable.
 */
export function directionDepuisTrace(trace, minKm = 25) {
  if (!Array.isArray(trace) || trace.length < 2) return null;
  const valides = trace.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (valides.length < 2) return null;
  const a = { lon: valides[0][0], lat: valides[0][1] };
  const b = { lon: valides[valides.length - 1][0], lat: valides[valides.length - 1][1] };
  if (distanceKm(a, b) < minKm) return null;
  return { bearingDeg: Math.round(bearingDeg(a, b)), speedKmh: null };
}

/**
 * Déduit le déplacement des positions successives enregistrées.
 * On compare la dernière position à la plus ancienne des 24 dernières heures,
 * à condition qu'au moins six heures les séparent : à la cadence de collecte
 * (cinq minutes), une fenêtre plus courte ne mesure que le bruit du NHC.
 *
 * @param {Array<{t:string, lat:number, lon:number}>} serie
 * @param {number} [maintenant=Date.now()]
 */
export function mouvementDepuisHistorique(serie, maintenant = Date.now()) {
  if (!Array.isArray(serie) || serie.length < 2) return null;
  const valides = serie.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.t);
  if (valides.length < 2) return null;

  const b = valides[valides.length - 1];
  const tB = new Date(b.t).getTime();
  if (!Number.isFinite(tB) || maintenant - tB > 6 * 3600 * 1000) return null;

  const fenetre = valides.filter((e) => tB - new Date(e.t).getTime() <= 24 * 3600 * 1000);
  const a = fenetre[0];
  const heures = (tB - new Date(a.t).getTime()) / 3600000;
  if (!(heures >= 6)) return null;

  const d = distanceKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
  if (d < 40) return null; // déplacement dans le bruit de la donnée

  return {
    bearingDeg: Math.round(bearingDeg(a, b)),
    speedKmh: Math.round(d / heures),
  };
}

/** « vers l'ouest », « vers le nord-est » : l'élision suit la voyelle. */
export function versFr(direction) {
  if (!direction) return null;
  return /^[aeiouy]/i.test(direction) ? `vers l'${direction}` : `vers le ${direction}`;
}

/**
 * Choisit la meilleure direction disponible et l'habille pour l'affichage.
 *
 * @param {object} p
 * @param {{bearingDeg:number, speedKmh:number}|null} [p.officiel]  Publié par le NHC.
 * @param {Array<[number, number]>|null} [p.trace]  Ligne officielle NHC.
 * @param {boolean} [p.nomme]  Système nommé (trajectoire prévue) ou zone (déplacement attendu).
 * @param {Array} [p.historique]  Positions enregistrées par KDL.
 */
export function choisirMouvement({ officiel = null, trace = null, nomme = false, historique = [] }) {
  let base = null;
  let origine = null;

  if (officiel && Number.isFinite(officiel.bearingDeg)) {
    base = { bearingDeg: officiel.bearingDeg, speedKmh: Number.isFinite(officiel.speedKmh) ? officiel.speedKmh : null };
    origine = 'NHC';
  } else {
    const depuisTrace = directionDepuisTrace(trace);
    if (depuisTrace) {
      base = depuisTrace;
      origine = nomme ? 'trajectoire prévue par le NHC' : 'déplacement attendu par le NHC';
    } else {
      const depuisHistorique = mouvementDepuisHistorique(historique);
      if (depuisHistorique) {
        base = depuisHistorique;
        origine = 'calculé par KDL';
      }
    }
  }
  if (!base) return null;

  const directionFr = compassFr(base.bearingDeg);
  return {
    ...base,
    directionFr,
    versFr: versFr(directionFr),
    origine,
    vitesseConnue: Number.isFinite(base.speedKmh) && base.speedKmh > 0,
  };
}
