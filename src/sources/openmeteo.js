/**
 * Source Open-Meteo — modèles météorologiques ouverts.
 * API gratuite, sans clé et sans carte bancaire. Données sous licence CC-BY 4.0 :
 * l'attribution est affichée dans l'interface et dans docs/SOURCES.md.
 * Plafond de l'offre gratuite : 10 000 appels par jour. Seul le serveur appelle
 * l'API ; les navigateurs des utilisateurs interrogent uniquement KDL Cyclone.
 *
 * Budget réel : ~5 appels par système et par heure, soit très en deçà du plafond.
 */

import { fetchJson, estErreur } from '../util/http.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const API_MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const API_AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const NIVEAUX_PRESSION = [850, 700, 500, 200];
/** Décalage en degrés utilisé pour estimer la rotation autour d'un point. */
const DELTA_DEG = 1.5;

const moyenne = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Composantes u (est) et v (nord) d'un vent donné en vitesse + direction météo. */
function composantes(vitesse, directionDeg) {
  if (!Number.isFinite(vitesse) || !Number.isFinite(directionDeg)) return null;
  const r = (directionDeg * Math.PI) / 180;
  // Direction météo = provenance du vent, d'où le signe négatif.
  return { u: -vitesse * Math.sin(r), v: -vitesse * Math.cos(r) };
}

/** Cisaillement vertical : norme de la différence vectorielle 850 hPa → 200 hPa. */
export function cisaillementKmh(vent850, vent200) {
  const a = composantes(vent850?.vitesse, vent850?.direction);
  const b = composantes(vent200?.vitesse, vent200?.direction);
  if (!a || !b) return null;
  return Math.hypot(b.u - a.u, b.v - a.v);
}

/**
 * Vorticité relative en basses couches, par différences finies sur 5 points.
 * ζ = ∂v/∂x − ∂u/∂y, exprimée ensuite en « vitesse de rotation » équivalente
 * sur un rayon de 150 km, plus parlante qu'une valeur en s⁻¹.
 */
export function rotationKmh(centre, est, ouest, nord, sud) {
  const c = [est, ouest, nord, sud].map((p) => composantes(p?.vitesse, p?.direction));
  if (c.some((x) => !x)) return null;
  const [E, O, N, S] = c;

  const latRad = (centre.lat * Math.PI) / 180;
  const dx = 2 * DELTA_DEG * 111320 * Math.cos(latRad); // mètres
  const dy = 2 * DELTA_DEG * 110540;

  // Les vitesses arrivent en km/h ; on repasse en m/s pour la dérivée.
  const ms = (x) => x / 3.6;
  const dvdx = (ms(E.v) - ms(O.v)) / dx;
  const dudy = (ms(N.u) - ms(S.u)) / dy;
  const zeta = dvdx - dudy;

  // Dans l'hémisphère nord, seule la rotation cyclonique (positive) compte.
  const rayonM = 150000;
  return Math.max(0, zeta) * rayonM * 3.6;
}

/**
 * Indice d'air sec, à partir des seules humidités.
 *
 * Repli utilisé quand la mesure d'aérosols n'est pas disponible : la couche
 * saharienne se signale alors par un air très sec entre 700 et 500 hPa
 * au-dessus d'une couche limite humide. C'est un indicateur indirect.
 */
export function indiceAirSec(rh850, rh700, rh500) {
  const hauts = [rh700, rh500].filter(Number.isFinite);
  if (hauts.length === 0) return null;
  const secheresseHaute = 1 - moyenne(hauts) / 100;
  if (!Number.isFinite(rh850)) return Math.max(0, Math.min(1, secheresseHaute));
  // Contraste marqué (bas humide, haut sec) = signature typique du SAL.
  const contraste = Math.max(0, (rh850 - moyenne(hauts)) / 100);
  return Math.max(0, Math.min(1, secheresseHaute * 0.75 + contraste * 0.5));
}

/**
 * Indice de couche saharienne fondé sur une **mesure** d'aérosols, et non plus
 * sur un contraste d'humidité.
 *
 * `dust` est la concentration de poussière modélisée par CAMS, en µg/m³.
 * `aod` est l'épaisseur optique des aérosols : sans dimension, elle traduit la
 * quantité de particules sur toute la colonne d'air. Une couche saharienne
 * marquée se lit typiquement au-delà de 0,4 d'épaisseur optique, et les
 * concentrations de poussière y dépassent largement 50 µg/m³.
 *
 * L'air sec accompagne la poussière : il reste dans le calcul, mais en second
 * rôle. C'est la mesure qui décide désormais.
 */
export function indiceSaharien(dust, aod, indiceHumidite) {
  const mesures = [];
  if (Number.isFinite(dust)) mesures.push(Math.min(1, dust / 120));
  if (Number.isFinite(aod)) mesures.push(Math.min(1, Math.max(0, (aod - 0.08) / 0.62)));

  if (mesures.length === 0) {
    // Aucune mesure : on retombe sur l'indicateur indirect, et on le dit.
    return Number.isFinite(indiceHumidite)
      ? { valeur: indiceHumidite, source: 'humidite', mesure: false }
      : null;
  }

  const partMesuree = moyenne(mesures);
  const valeur = Number.isFinite(indiceHumidite)
    ? partMesuree * 0.75 + indiceHumidite * 0.25
    : partMesuree;

  return {
    valeur: Math.max(0, Math.min(1, valeur)),
    source: 'aerosols',
    mesure: true,
    dust: Number.isFinite(dust) ? Math.round(dust * 10) / 10 : null,
    aod: Number.isFinite(aod) ? Math.round(aod * 1000) / 1000 : null,
  };
}

/**
 * Aérosols au-dessus d'un point : poussière et épaisseur optique.
 * Source distincte des modèles de prévision — API qualité de l'air, CAMS.
 */
export async function fetchAerosols(point) {
  const url = `${API_AIR}?latitude=${point.lat}&longitude=${point.lon}`
    + '&hourly=dust,aerosol_optical_depth,pm10&forecast_days=1';
  const reponse = await fetchJson(url, { conditionnel: false });
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };

  const h = reponse.donnees.hourly || {};
  const i = indiceMaintenant(h.time);
  const at = (k) => (Array.isArray(h[k]) ? h[k][i] : null);
  return {
    ok: true,
    dust: at('dust'),
    aod: at('aerosol_optical_depth'),
    pm10: at('pm10'),
    heure: Array.isArray(h.time) ? `${h.time[i]}Z` : null,
    source: 'Open-Meteo — CAMS (qualité de l\'air)',
  };
}

function indiceMaintenant(temps) {
  if (!Array.isArray(temps) || temps.length === 0) return 0;
  const maintenant = Date.now();
  let best = 0;
  let ecart = Infinity;
  for (let i = 0; i < temps.length; i += 1) {
    const d = Math.abs(new Date(`${temps[i]}Z`).getTime() - maintenant);
    if (d < ecart) {
      ecart = d;
      best = i;
    }
  }
  return best;
}

/**
 * Environnement atmosphérique autour d'un point.
 * Une seule requête sert les 5 points (centre + 4 voisins) grâce au mode
 * multi-coordonnées de l'API.
 *
 * @param {{lat:number, lon:number}} point
 * @returns {Promise<object>} champs mesurés, chacun `null` si indisponible.
 */
export async function fetchEnvironnement(point) {
  const lats = [point.lat, point.lat, point.lat, point.lat + DELTA_DEG, point.lat - DELTA_DEG];
  const lons = [point.lon, point.lon + DELTA_DEG, point.lon - DELTA_DEG, point.lon, point.lon];

  const variables = [
    'pressure_msl',
    'precipitation',
    ...NIVEAUX_PRESSION.flatMap((n) => [`wind_speed_${n}hPa`, `wind_direction_${n}hPa`]),
    'relative_humidity_850hPa',
    'relative_humidity_700hPa',
    'relative_humidity_500hPa',
  ].join(',');

  const url =
    `${API}?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    `&hourly=${variables}&forecast_days=1&past_days=0&wind_speed_unit=kmh&cell_selection=sea`;

  // Les aérosols viennent d'un autre service : les deux requêtes partent
  // ensemble pour ne pas allonger la collecte.
  const [reponse, aerosols] = await Promise.all([
    fetchJson(url, { conditionnel: false }),
    fetchAerosols(point),
  ]);
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };
  const rep = reponse.donnees;

  const points = Array.isArray(rep) ? rep : [rep];
  if (points.length < 5) return { ok: false, erreur: 'réponse incomplète' };

  const lire = (p) => {
    const h = p.hourly || {};
    const i = indiceMaintenant(h.time);
    const at = (k) => (Array.isArray(h[k]) ? h[k][i] : null);
    return {
      pressureHpa: at('pressure_msl'),
      precipMmH: at('precipitation'),
      rh850: at('relative_humidity_850hPa'),
      rh700: at('relative_humidity_700hPa'),
      rh500: at('relative_humidity_500hPa'),
      vent850: { vitesse: at('wind_speed_850hPa'), direction: at('wind_direction_850hPa') },
      vent700: { vitesse: at('wind_speed_700hPa'), direction: at('wind_direction_700hPa') },
      vent200: { vitesse: at('wind_speed_200hPa'), direction: at('wind_direction_200hPa') },
      heure: Array.isArray(h.time) ? h.time[i] : null,
    };
  };

  const [c, est, ouest, nord, sud] = points.map(lire);

  const saharien = indiceSaharien(
    aerosols.ok ? aerosols.dust : null,
    aerosols.ok ? aerosols.aod : null,
    indiceAirSec(c.rh850, c.rh700, c.rh500),
  );

  return {
    ok: true,
    heureModele: c.heure ? `${c.heure}Z` : null,
    pressureHpa: c.pressureHpa,
    precipMmH: c.precipMmH,
    rh700: c.rh700,
    shearKmh: cisaillementKmh(c.vent850, c.vent200),
    lowLevelSpinKmh: rotationKmh(point, est.vent850, ouest.vent850, nord.vent850, sud.vent850),
    dryAirIndex: saharien ? saharien.valeur : null,
    // On expose d'où vient l'indice : une mesure d'aérosols ou un simple
    // indicateur d'humidité. L'interface doit pouvoir le dire à l'utilisateur.
    saharien: saharien
      ? {
        mesure: saharien.mesure,
        source: saharien.source,
        dustUgM3: saharien.dust ?? null,
        aod: saharien.aod ?? null,
      }
      : null,
    vent850Kmh: c.vent850.vitesse,
    source: 'Open-Meteo (GFS)',
  };
}

/** Température de surface de la mer et état de mer. */
export async function fetchMer(point) {
  const url =
    `${API_MARINE}?latitude=${point.lat}&longitude=${point.lon}` +
    `&hourly=sea_surface_temperature,wave_height,wave_period,wave_direction&forecast_days=1&cell_selection=sea`;
  const reponse = await fetchJson(url, { conditionnel: false });
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };
  const rep = reponse.donnees;

  const h = rep.hourly || {};
  const i = indiceMaintenant(h.time);
  const at = (k) => (Array.isArray(h[k]) ? h[k][i] : null);
  return {
    ok: true,
    sstC: at('sea_surface_temperature'),
    houleM: at('wave_height'),
    periodeS: at('wave_period'),
    directionHouleDeg: at('wave_direction'),
    source: 'Open-Meteo Marine',
  };
}

/**
 * Accord entre modèles : dispersion de la pression au niveau de la mer prévue
 * à +72 h par trois modèles indépendants. 1 = accord parfait, 0 = divergence.
 */
export async function fetchAccordModeles(point) {
  const url =
    `${API}?latitude=${point.lat}&longitude=${point.lon}` +
    `&hourly=pressure_msl&models=gfs_seamless,ecmwf_ifs025,icon_seamless&forecast_days=4&cell_selection=sea`;
  const reponse = await fetchJson(url, { conditionnel: false });
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };
  const rep = reponse.donnees;

  const h = rep.hourly || {};
  const series = Object.keys(h)
    .filter((k) => k.startsWith('pressure_msl'))
    .map((k) => h[k])
    .filter(Array.isArray);
  if (series.length < 2) return { ok: false, erreur: 'un seul modèle disponible' };

  const i = Math.min(72, (series[0]?.length ?? 1) - 1);
  const valeurs = series.map((s) => s[i]).filter(Number.isFinite);
  if (valeurs.length < 2) return { ok: false, erreur: 'échéance non couverte' };

  const m = moyenne(valeurs);
  const ecartType = Math.sqrt(moyenne(valeurs.map((v) => (v - m) ** 2)));
  // 0 hPa d'écart = accord total ; 8 hPa d'écart à +72 h = divergence franche.
  const accord = Math.max(0, Math.min(1, 1 - ecartType / 8));

  return {
    ok: true,
    modelAgreement: Math.round(accord * 100) / 100,
    ecartTypeHpa: Math.round(ecartType * 10) / 10,
    nbModeles: valeurs.length,
    source: 'Open-Meteo (GFS, ECMWF, ICON)',
  };
}

/** Conditions attendues sur un point terrestre — utilisé pour la page Guadeloupe. */
export async function fetchConditionsLocales(point, timezone = 'America/Guadeloupe') {
  const url =
    `${API}?latitude=${point.lat}&longitude=${point.lon}` +
    '&hourly=wind_speed_10m,wind_gusts_10m,precipitation,pressure_msl' +
    '&daily=precipitation_sum,wind_gusts_10m_max' +
    `&timezone=${encodeURIComponent(timezone)}&forecast_days=5&wind_speed_unit=kmh`;
  const reponse = await fetchJson(url, { conditionnel: false });
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };
  const rep = reponse.donnees;

  const h = rep.hourly || {};
  const d = rep.daily || {};
  const i = indiceMaintenant(h.time);
  return {
    ok: true,
    maintenant: {
      ventKmh: h.wind_speed_10m?.[i] ?? null,
      rafalesKmh: h.wind_gusts_10m?.[i] ?? null,
      pluieMmH: h.precipitation?.[i] ?? null,
      pressionHpa: h.pressure_msl?.[i] ?? null,
      heureLocale: h.time?.[i] ?? null,
    },
    jours: (d.time || []).map((jour, k) => ({
      date: jour,
      pluieMm: d.precipitation_sum?.[k] ?? null,
      rafalesMaxKmh: d.wind_gusts_10m_max?.[k] ?? null,
    })),
    source: 'Open-Meteo',
  };
}

export const ATTRIBUTION = 'Données météorologiques Open-Meteo — licence CC BY 4.0';
