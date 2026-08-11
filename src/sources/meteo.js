/**
 * Météo courante et prévisions — au-delà du seul suivi cyclonique.
 *
 * KDL Cyclone reste une application de veille tropicale : cette partie répond
 * au besoin quotidien — « quel temps fait-il, que va-t-il faire » — sans
 * prendre la place du sujet principal.
 *
 * Toutes les données viennent d'Open-Meteo (CC BY 4.0), du même service déjà
 * utilisé pour l'analyse des systèmes. Aucun appel supplémentaire depuis le
 * navigateur : le serveur collecte, l'application sert.
 */

import { fetchJson, estErreur } from '../util/http.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const API_AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Codes météo de l'OMM, tels que renvoyés par `weather_code`.
 * Traduction française et pictogramme maison — aucun jeu d'icônes tiers, dont
 * les droits seraient à vérifier.
 */
export const CODES_METEO = {
  0: { texte: 'Ciel dégagé', icone: 'soleil', nuit: 'lune' },
  1: { texte: 'Généralement dégagé', icone: 'soleil-voile', nuit: 'lune-voile' },
  2: { texte: 'Partiellement nuageux', icone: 'soleil-nuage', nuit: 'lune-nuage' },
  3: { texte: 'Couvert', icone: 'nuage' },
  45: { texte: 'Brouillard', icone: 'brume' },
  48: { texte: 'Brouillard givrant', icone: 'brume' },
  51: { texte: 'Bruine légère', icone: 'bruine' },
  53: { texte: 'Bruine', icone: 'bruine' },
  55: { texte: 'Bruine dense', icone: 'bruine' },
  56: { texte: 'Bruine verglaçante', icone: 'bruine' },
  57: { texte: 'Bruine verglaçante dense', icone: 'bruine' },
  61: { texte: 'Pluie faible', icone: 'pluie' },
  63: { texte: 'Pluie', icone: 'pluie' },
  65: { texte: 'Pluie forte', icone: 'pluie-forte' },
  66: { texte: 'Pluie verglaçante', icone: 'pluie' },
  67: { texte: 'Pluie verglaçante forte', icone: 'pluie-forte' },
  71: { texte: 'Neige faible', icone: 'neige' },
  73: { texte: 'Neige', icone: 'neige' },
  75: { texte: 'Neige forte', icone: 'neige' },
  77: { texte: 'Grains de neige', icone: 'neige' },
  80: { texte: 'Averses faibles', icone: 'averse' },
  81: { texte: 'Averses', icone: 'averse' },
  82: { texte: 'Averses violentes', icone: 'averse-forte' },
  85: { texte: 'Averses de neige', icone: 'neige' },
  86: { texte: 'Fortes averses de neige', icone: 'neige' },
  95: { texte: 'Orage', icone: 'orage' },
  96: { texte: 'Orage avec grêle', icone: 'orage' },
  99: { texte: 'Orage violent avec grêle', icone: 'orage' },
};

export function decrireCode(code, estNuit) {
  const c = CODES_METEO[code];
  if (!c) return { texte: 'Conditions indéterminées', icone: 'nuage' };
  return { texte: c.texte, icone: (estNuit && c.nuit) || c.icone };
}

/**
 * Seuils d'alerte locale, pensés pour les Antilles.
 * Ils ne remplacent aucune vigilance officielle : ils signalent simplement
 * qu'une valeur mérite un coup d'œil, et l'interface le dit ainsi.
 */
export const SEUILS = {
  rafales: [
    { min: 90, niveau: 'fort', texte: 'Rafales très fortes : arrimez ce qui peut s\'envoler.' },
    { min: 60, niveau: 'modere', texte: 'Rafales soutenues : prudence en mer et sur la route.' },
    { min: 40, niveau: 'faible', texte: 'Vent sensible en rafales.' },
  ],
  pluie: [
    { min: 30, niveau: 'fort', texte: 'Pluies intenses : risque de ruissellement et de routes coupées.' },
    { min: 10, niveau: 'modere', texte: 'Fortes pluies attendues.' },
    { min: 4, niveau: 'faible', texte: 'Averses marquées.' },
  ],
  houle: [
    { min: 3, niveau: 'fort', texte: 'Forte houle : baignade et navigation dangereuses.' },
    { min: 2, niveau: 'modere', texte: 'Mer agitée.' },
    { min: 1.5, niveau: 'faible', texte: 'Mer peu agitée à agitée.' },
  ],
  uv: [
    { min: 11, niveau: 'fort', texte: 'Indice UV extrême : évitez le soleil entre 10 h et 16 h.' },
    { min: 8, niveau: 'modere', texte: 'Indice UV très élevé : protection indispensable.' },
    { min: 6, niveau: 'faible', texte: 'Indice UV élevé.' },
  ],
  poussiere: [
    { min: 100, niveau: 'fort', texte: 'Brume de sable dense : gêne respiratoire possible.' },
    { min: 50, niveau: 'modere', texte: 'Brume de sable sensible.' },
    { min: 25, niveau: 'faible', texte: 'Poussières en suspension.' },
  ],
};

/** Niveau atteint par une valeur, ou null si aucun seuil n'est franchi. */
export function niveauSeuil(type, valeur) {
  if (!Number.isFinite(valeur)) return null;
  const seuils = SEUILS[type];
  if (!seuils) return null;
  const atteint = seuils.find((s) => valeur >= s.min);
  return atteint ? { ...atteint, valeur } : null;
}

function indiceProche(temps) {
  if (!Array.isArray(temps) || temps.length === 0) return 0;
  const maintenant = Date.now();
  let best = 0;
  let ecart = Infinity;
  for (let i = 0; i < temps.length; i += 1) {
    const d = Math.abs(new Date(temps[i]).getTime() - maintenant);
    if (d < ecart) { ecart = d; best = i; }
  }
  return best;
}

/**
 * Bulletin météo complet d'un territoire : conditions actuelles, prévisions
 * horaires, tendance sur dix jours, mer, air et UV.
 */
export async function fetchBulletin(point, fuseau) {
  const commun = `latitude=${point.lat}&longitude=${point.lon}&timezone=${encodeURIComponent(fuseau)}`;

  const urlTerre = `${API}?${commun}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,'
    + 'weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,is_day'
    + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,'
    + 'weather_code,wind_speed_10m,wind_gusts_10m,uv_index,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,'
    + 'precipitation_probability_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset'
    + '&forecast_days=10&wind_speed_unit=kmh';

  const urlAir = `${API_AIR}?latitude=${point.lat}&longitude=${point.lon}`
    + `&timezone=${encodeURIComponent(fuseau)}&hourly=pm10,pm2_5,dust,uv_index&forecast_days=2`;

  const [terre, air] = await Promise.all([
    fetchJson(urlTerre, { conditionnel: false }),
    fetchJson(urlAir, { conditionnel: false }),
  ]);
  if (estErreur(terre)) return { ok: false, erreur: terre.__error };

  const d = terre.donnees;
  const cur = d.current || {};
  const h = d.hourly || {};
  const j = d.daily || {};
  const iH = indiceProche(h.time);

  const estNuit = cur.is_day === 0;
  const description = decrireCode(cur.weather_code, estNuit);

  // Les 24 prochaines heures, une entrée par heure.
  const heures = (h.time || []).slice(iH, iH + 24).map((t, k) => {
    const i = iH + k;
    return {
      heure: t,
      temperature: h.temperature_2m?.[i] ?? null,
      ressenti: h.apparent_temperature?.[i] ?? null,
      pluieProbabilite: h.precipitation_probability?.[i] ?? null,
      pluieMm: h.precipitation?.[i] ?? null,
      ventKmh: h.wind_speed_10m?.[i] ?? null,
      rafalesKmh: h.wind_gusts_10m?.[i] ?? null,
      uv: h.uv_index?.[i] ?? null,
      code: h.weather_code?.[i] ?? null,
      nuit: h.is_day?.[i] === 0,
    };
  });

  const jours = (j.time || []).map((date, i) => ({
    date,
    code: j.weather_code?.[i] ?? null,
    tempMax: j.temperature_2m_max?.[i] ?? null,
    tempMin: j.temperature_2m_min?.[i] ?? null,
    pluieMm: j.precipitation_sum?.[i] ?? null,
    pluieProbabilite: j.precipitation_probability_max?.[i] ?? null,
    rafalesMaxKmh: j.wind_gusts_10m_max?.[i] ?? null,
    uvMax: j.uv_index_max?.[i] ?? null,
    leverSoleil: j.sunrise?.[i] ?? null,
    coucherSoleil: j.sunset?.[i] ?? null,
  }));

  let qualiteAir = null;
  if (!estErreur(air)) {
    const ha = air.donnees.hourly || {};
    const ia = indiceProche(ha.time);
    qualiteAir = {
      pm10: ha.pm10?.[ia] ?? null,
      pm25: ha.pm2_5?.[ia] ?? null,
      poussiere: ha.dust?.[ia] ?? null,
      uv: ha.uv_index?.[ia] ?? null,
      heure: ha.time?.[ia] ?? null,
    };
  }

  // Alertes locales : uniquement des seuils dépassés, avec leur valeur.
  const pointes = {
    rafales: Math.max(...heures.map((x) => x.rafalesKmh ?? 0), 0),
    pluie: Math.max(...heures.map((x) => x.pluieMm ?? 0), 0),
    uv: Math.max(...heures.map((x) => x.uv ?? 0), 0),
  };
  const alertes = [
    niveauSeuil('rafales', pointes.rafales),
    niveauSeuil('pluie', pointes.pluie),
    niveauSeuil('uv', pointes.uv),
    niveauSeuil('poussiere', qualiteAir?.poussiere),
  ].filter(Boolean).map((a, i) => ({
    ...a,
    type: ['rafales', 'pluie', 'uv', 'poussiere'].filter((t, k) => {
      const vals = [pointes.rafales, pointes.pluie, pointes.uv, qualiteAir?.poussiere];
      return niveauSeuil(t, vals[k]);
    })[i],
  }));

  return {
    ok: true,
    maintenant: {
      temperature: cur.temperature_2m ?? null,
      ressenti: cur.apparent_temperature ?? null,
      humidite: cur.relative_humidity_2m ?? null,
      pluieMm: cur.precipitation ?? null,
      ventKmh: cur.wind_speed_10m ?? null,
      rafalesKmh: cur.wind_gusts_10m ?? null,
      ventDirection: cur.wind_direction_10m ?? null,
      pressionHpa: cur.pressure_msl ?? null,
      code: cur.weather_code ?? null,
      nuit: estNuit,
      description: description.texte,
      icone: description.icone,
      heure: cur.time ?? null,
    },
    heures,
    jours,
    qualiteAir,
    alertes,
    source: 'Open-Meteo',
    licence: 'CC BY 4.0',
    recuLe: new Date().toISOString(),
  };
}
