/**
 * Moteur de potentiel KDL — analyse EXPÉRIMENTALE de l'environnement d'une onde
 * tropicale. Fonction pure : mêmes entrées, même sortie. Aucune E/S.
 *
 * Ce moteur ne prévoit rien. Il note l'environnement observé et modélisé au
 * regard des conditions classiques de la cyclogenèse tropicale, et il explique
 * chaque note en français courant. La probabilité officielle du NHC reste
 * toujours la référence affichée en premier dans l'interface.
 *
 * Seuils issus de la pratique opérationnelle courante :
 *   - température de surface de la mer : 26,5 °C est le seuil historique
 *   - cisaillement vertical 850-200 hPa : < 10 kt favorable, > 20 kt hostile
 *   - humidité de moyenne troposphère : < 40 % signe l'air sec ou saharien
 *   - latitude : sous 5°, la force de Coriolis ne permet pas la rotation
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Interpolation linéaire par paliers : rampe(v, [[x0,y0],[x1,y1],...]). */
function rampe(v, points) {
  if (v <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (v >= x0 && v <= x1) {
      const t = (v - x0) / (x1 - x0 || Number.EPSILON);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** Traduit un score (-1..+1) en verdict lisible. */
function verdictOf(score) {
  if (score >= 0.35) return 'favorable';
  if (score <= -0.35) return 'defavorable';
  return 'neutre';
}

/**
 * Définition des facteurs. Chaque entrée sait lire sa valeur dans `env`,
 * la noter de -1 (bloquant) à +1 (très favorable au développement), et
 * l'expliquer. `weight` pondère l'importance relative.
 */
const FACTEURS = [
  {
    key: 'sst',
    label: 'Température de la mer',
    unit: '°C',
    weight: 1.15,
    read: (env) => env.sstC,
    score: (v) => rampe(v, [[24.5, -1], [26, -0.5], [26.5, 0], [27.5, 0.5], [28.5, 0.85], [30, 1]]),
    explain: (v, s) => {
      const t = v.toFixed(1).replace('.', ',');
      if (s <= -0.35) return `L'eau est à ${t} °C, sous le seuil de 26,5 °C généralement nécessaire. Elle ne fournit pas assez de chaleur et d'humidité pour alimenter un système.`;
      if (s < 0.35) return `L'eau est à ${t} °C, juste autour du seuil de 26,5 °C. Elle peut entretenir un système existant, mais elle ne l'aide pas beaucoup à se renforcer.`;
      return `L'eau est à ${t} °C, nettement au-dessus du seuil de 26,5 °C. C'est le carburant principal d'un système tropical : la mer en fournit largement.`;
    },
  },
  {
    key: 'shear',
    label: 'Cisaillement vertical',
    unit: 'km/h',
    weight: 1.3,
    read: (env) => env.shearKmh,
    // Exprimé en km/h pour l'utilisateur ; les seuils opérationnels sont en nœuds
    // (10 kt ≈ 19 km/h, 20 kt ≈ 37 km/h, 30 kt ≈ 56 km/h).
    score: (v) => rampe(v, [[0, 1], [19, 0.7], [28, 0.15], [37, -0.4], [56, -0.9], [75, -1]]),
    explain: (v, s) => {
      const t = Math.round(v);
      if (s >= 0.35) return `Les vents soufflent dans le même sens en altitude et près de la mer (écart de ${t} km/h). Rien ne vient décapiter les orages : le système peut s'organiser en hauteur.`;
      if (s > -0.35) return `L'écart de vent entre la surface et la haute altitude atteint ${t} km/h. C'est gênant sans être bloquant : le système peut se développer, mais lentement et de travers.`;
      return `L'écart de vent entre la surface et la haute altitude atteint ${t} km/h. Ce cisaillement penche et disloque les orages : il empêche la machine de se mettre en place.`;
    },
  },
  {
    key: 'humidity',
    label: 'Humidité en moyenne altitude',
    unit: '%',
    weight: 1.0,
    read: (env) => env.rh700,
    score: (v) => rampe(v, [[20, -1], [35, -0.7], [45, -0.3], [55, 0.1], [65, 0.5], [80, 0.9], [95, 1]]),
    explain: (v, s) => {
      const t = Math.round(v);
      if (s <= -0.35) return `L'air à moyenne altitude est sec (${t} % d'humidité). Cet air sec s'infiltre dans le système et éteint les orages de l'intérieur — c'est souvent l'air saharien.`;
      if (s < 0.35) return `L'air à moyenne altitude est moyennement humide (${t} %). Le système n'est pas asséché, mais il n'est pas non plus porté.`;
      return `L'air à moyenne altitude est humide (${t} %). Les orages peuvent se maintenir et se regrouper sans être étouffés par de l'air sec.`;
    },
  },
  {
    key: 'convection',
    label: 'Activité orageuse',
    unit: 'mm/h',
    weight: 0.9,
    read: (env) => env.precipMmH,
    score: (v) => rampe(v, [[0, -0.8], [0.3, -0.3], [1, 0.2], [3, 0.6], [8, 0.95], [20, 1]]),
    explain: (v, s) => {
      const t = v.toFixed(1).replace('.', ',');
      if (s <= -0.35) return `Presque aucune pluie modélisée (${t} mm/h). Sans orages entretenus, il n'y a pas de moteur pour creuser une dépression.`;
      if (s < 0.35) return `Activité pluvieuse modeste (${t} mm/h). Les orages existent mais restent dispersés.`;
      return `Orages actifs et soutenus (${t} mm/h). C'est cette convection qui évacue la chaleur en altitude et fait baisser la pression au centre.`;
    },
  },
  {
    key: 'vorticity',
    label: 'Rotation en basses couches',
    unit: 'km/h',
    weight: 1.05,
    read: (env) => env.lowLevelSpinKmh,
    score: (v) => rampe(v, [[0, -0.6], [10, -0.2], [20, 0.3], [35, 0.75], [55, 1]]),
    explain: (v, s) => {
      const t = Math.round(v);
      if (s <= -0.35) return `Le flux en basses couches est presque rectiligne (${t} km/h de composante tourbillonnaire). Rien n'amorce l'enroulement nécessaire.`;
      if (s < 0.35) return `Un début de courbure du vent apparaît en basses couches (${t} km/h). L'amorce existe, sans centre de rotation net.`;
      return `Le vent s'enroule nettement en basses couches (${t} km/h). Un centre de rotation peut se former et se refermer sur lui-même.`;
    },
  },
  {
    key: 'pressure',
    label: 'Pression au niveau de la mer',
    unit: 'hPa',
    weight: 0.85,
    read: (env) => env.pressureHpa,
    score: (v) => rampe(v, [[995, 1], [1004, 0.6], [1009, 0.15], [1012, -0.2], [1016, -0.7], [1022, -1]]),
    explain: (v, s) => {
      const t = Math.round(v);
      if (s >= 0.35) return `La pression est descendue à ${t} hPa. Une pression basse signale que le système creuse déjà et aspire l'air vers son centre.`;
      if (s > -0.35) return `La pression reste proche de la normale (${t} hPa). Aucun creusement marqué pour l'instant.`;
      return `La pression est élevée (${t} hPa). L'air descend au lieu de monter, ce qui contrarie la formation d'orages organisés.`;
    },
  },
  {
    key: 'coriolis',
    label: 'Latitude et force de Coriolis',
    unit: '°N',
    weight: 0.8,
    read: (env) => env.lat,
    score: (v) => rampe(Math.abs(v), [[0, -1], [4, -0.9], [6, -0.4], [8, 0.2], [12, 0.7], [20, 0.8], [30, 0.2], [36, -0.6]]),
    explain: (v, s) => {
      const t = Math.abs(v).toFixed(1).replace('.', ',');
      if (Math.abs(v) < 7) return `Le système se trouve à ${t}° de latitude, trop près de l'équateur. La rotation de la Terre n'y est pas assez sensible pour faire tourner l'air autour d'un centre.`;
      if (Math.abs(v) > 30) return `À ${t}° de latitude, l'eau devient plus fraîche et l'air d'origine polaire s'invite. Le système sort de sa zone de vie tropicale.`;
      return `À ${t}° de latitude, la rotation de la Terre est suffisante pour enrouler l'air autour d'un centre de basse pression.`;
    },
  },
  {
    key: 'dust',
    label: 'Air sec ou poussières sahariennes',
    unit: '%',
    weight: 0.75,
    read: (env) => env.dryAirIndex,
    // Noté sur une échelle 0-1 en interne, affiché en pourcentage.
    versAffichage: (v) => Math.round(v * 100),
    // dryAirIndex : 0 = atmosphère propre et humide, 1 = couche saharienne marquée.
    score: (v) => rampe(v, [[0, 0.7], [0.25, 0.3], [0.45, -0.1], [0.6, -0.6], [0.85, -1]]),
    explain: (v, s, env) => {
      const pct = Math.round(v * 100);
      // Quand la poussière est mesurée, on cite la mesure : c'est plus parlant
      // et plus vérifiable qu'un indice composite.
      const m = env && env.saharien && env.saharien.mesure ? env.saharien : null;
      const preuve = m && Number.isFinite(m.dustUgM3)
        ? ` La concentration de poussière mesurée atteint ${Math.round(m.dustUgM3)} µg/m³`
          + (Number.isFinite(m.aod) ? `, pour une épaisseur optique de ${m.aod.toFixed(2).replace('.', ',')}` : '')
          + '.'
        : ' Estimation indirecte, à partir du contraste d\'humidité entre couches.';

      if (s <= -0.35) return `Les signes d'air saharien sont marqués (indice ${pct} %). Cette masse d'air chaude, sèche et chargée de poussière plafonne les orages et coupe l'alimentation du système.${preuve}`;
      if (s < 0.35) return `Des traces d'air sec d'origine saharienne sont détectées (indice ${pct} %). Elles freinent le développement sans l'interdire.${preuve}`;
      return `Peu ou pas d'air saharien détecté (indice ${pct} %). L'atmosphère autour du système reste propre et humide.${preuve}`;
    },
  },
  {
    key: 'agreement',
    label: 'Accord des modèles',
    unit: '%',
    weight: 0.95,
    read: (env) => env.modelAgreement,
    versAffichage: (v) => Math.round(v * 100),
    // modelAgreement : 0 = les scénarios divergent totalement, 1 = ils convergent.
    score: (v) => rampe(v, [[0, -0.5], [0.35, -0.2], [0.55, 0.1], [0.75, 0.5], [0.95, 0.8]]),
    explain: (v, s) => {
      const pct = Math.round(v * 100);
      if (s <= -0.2) return `Les scénarios des modèles divergent fortement (accord ${pct} %). Certains creusent le système, d'autres le dissipent : l'incertitude est réelle.`;
      if (s < 0.5) return `Les modèles s'accordent partiellement (accord ${pct} %). La tendance générale se dessine, le détail non.`;
      return `Les modèles racontent la même histoire (accord ${pct} %). Le scénario est cohérent d'un calcul à l'autre.`;
    },
  },
];

const NIVEAUX = [
  { max: 15, code: 'negligeable', label: 'Négligeable' },
  { max: 32, code: 'faible', label: 'Faible' },
  { max: 55, code: 'modere', label: 'Modéré' },
  { max: 75, code: 'eleve', label: 'Élevé' },
  { max: 101, code: 'tres_eleve', label: 'Très élevé' },
];

function niveauFor(score) {
  return NIVEAUX.find((n) => score < n.max) ?? NIVEAUX[NIVEAUX.length - 1];
}

/**
 * Analyse l'environnement d'un système.
 *
 * @param {object} env  Mesures et sorties de modèle. Toute valeur absente
 *   (null/undefined/NaN) est déclarée « inconnue » et retirée du calcul —
 *   jamais remplacée par une valeur par défaut inventée.
 * @param {object} [opts]
 * @param {number} [opts.observedAgeMinutes] Âge des données, pour la confiance.
 * @param {number} [opts.nhcProb7d] Probabilité officielle NHC à 7 jours (0-100),
 *   utilisée uniquement pour signaler un écart avec l'analyse KDL.
 * @returns {object} Résultat structuré, prêt pour l'interface.
 */
export function analysePotential(env = {}, opts = {}) {
  const facteurs = FACTEURS.map((f) => {
    const raw = f.read(env);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    if (value === null) {
      return {
        key: f.key,
        label: f.label,
        unit: f.unit,
        value: null,
        score: null,
        verdict: 'inconnu',
        weight: f.weight,
        explanation: `Donnée indisponible pour l'instant. Ce facteur est retiré du calcul plutôt qu'estimé au hasard.`,
      };
    }
    const score = clamp(f.score(value), -1, 1);
    // `value` est toujours exprimée dans l'unité affichée à l'utilisateur ;
    // le score, lui, se calcule sur la valeur interne.
    const affiche = f.versAffichage ? f.versAffichage(value) : Math.round(value * 100) / 100;
    return {
      key: f.key,
      label: f.label,
      unit: f.unit,
      value: affiche,
      score: Math.round(score * 100) / 100,
      verdict: verdictOf(score),
      weight: f.weight,
      explanation: f.explain(value, score, env),
    };
  });

  const connus = facteurs.filter((f) => f.score !== null);
  const poidsTotal = connus.reduce((s, f) => s + f.weight, 0);
  const poidsPossible = FACTEURS.reduce((s, f) => s + f.weight, 0);

  // Score brut pondéré, ramené sur 0-100 (0 = tout bloquant, 100 = tout optimal).
  const brut = poidsTotal > 0 ? connus.reduce((s, f) => s + f.score * f.weight, 0) / poidsTotal : 0;
  let score = Math.round(((brut + 1) / 2) * 100);

  // Verrous physiques : certains facteurs sont éliminatoires à eux seuls.
  const bloquants = [];
  const sst = facteurs.find((f) => f.key === 'sst');
  const shear = facteurs.find((f) => f.key === 'shear');
  const coriolis = facteurs.find((f) => f.key === 'coriolis');
  if (sst?.value !== null && sst?.value < 25.5) {
    score = Math.min(score, 18);
    bloquants.push("mer trop froide");
  }
  if (shear?.value !== null && shear?.value > 65) {
    score = Math.min(score, 20);
    bloquants.push("cisaillement destructeur");
  }
  if (coriolis?.value !== null && Math.abs(coriolis.value) < 5) {
    score = Math.min(score, 12);
    bloquants.push("latitude trop équatoriale");
  }
  score = clamp(score, 0, 100);

  // Confiance : couverture des facteurs, accord des modèles, fraîcheur.
  const couverture = poidsPossible > 0 ? poidsTotal / poidsPossible : 0;
  const accord = typeof env.modelAgreement === 'number' ? env.modelAgreement : 0.5;
  const ageMin = Number.isFinite(opts.observedAgeMinutes) ? opts.observedAgeMinutes : 0;
  const fraicheur = rampe(ageMin, [[0, 1], [60, 0.95], [180, 0.75], [360, 0.5], [720, 0.25], [1440, 0.1]]);
  const confianceBrute = couverture * 0.45 + accord * 0.35 + fraicheur * 0.2;
  const confiance = Math.round(clamp(confianceBrute, 0, 1) * 100);
  const confianceLabel = confiance >= 70 ? 'Bonne' : confiance >= 45 ? 'Moyenne' : 'Faible';

  const favorables = facteurs.filter((f) => f.verdict === 'favorable');
  const defavorables = facteurs.filter((f) => f.verdict === 'defavorable');
  const inconnus = facteurs.filter((f) => f.verdict === 'inconnu');
  const niveau = niveauFor(score);

  // Écart avec la position officielle du NHC, signalé sans jamais la contredire.
  let ecartNhc = null;
  if (Number.isFinite(opts.nhcProb7d)) {
    const delta = score - opts.nhcProb7d;
    if (Math.abs(delta) >= 25) {
      ecartNhc = {
        delta: Math.round(delta),
        message:
          delta > 0
            ? `L'analyse KDL est plus haute que la probabilité officielle du NHC (${opts.nhcProb7d} %). En cas de désaccord, la valeur officielle fait foi.`
            : `L'analyse KDL est plus basse que la probabilité officielle du NHC (${opts.nhcProb7d} %). En cas de désaccord, la valeur officielle fait foi.`,
      };
    }
  }

  return {
    score,
    niveau: niveau.code,
    niveauLabel: niveau.label,
    confiance,
    confianceLabel,
    couverture: Math.round(couverture * 100),
    bloquants,
    facteurs,
    favorables: favorables.map((f) => f.key),
    defavorables: defavorables.map((f) => f.key),
    inconnus: inconnus.map((f) => f.key),
    ecartNhc,
    resume: resumeFr({ score, niveau, favorables, defavorables, inconnus, bloquants }),
    nature: 'analyse_kdl_experimentale',
  };
}

/** Formulations courtes pour le résumé — les labels complets restent en tableau. */
const NOMS_COURTS = {
  sst: 'la chaleur de la mer',
  shear: 'le faible cisaillement',
  humidity: "l'air humide en altitude",
  convection: 'les orages actifs',
  vorticity: 'la rotation en basses couches',
  pressure: 'la pression basse',
  coriolis: 'la latitude',
  dust: "l'absence d'air saharien",
  agreement: "l'accord des modèles",
};
const NOMS_COURTS_NEGATIFS = {
  sst: 'la mer trop fraîche',
  shear: 'le cisaillement',
  humidity: "l'air sec en altitude",
  convection: 'le manque d\'orages',
  vorticity: "l'absence de rotation",
  pressure: 'la pression élevée',
  coriolis: 'la latitude',
  dust: "l'air saharien",
  agreement: 'le désaccord des modèles',
};

function resumeFr({ score, niveau, favorables, defavorables, inconnus, bloquants }) {
  // Trois facteurs au plus par camp : une phrase qui se lit, pas un inventaire.
  const parPoids = (a, b) => Math.abs(b.score) * b.weight - Math.abs(a.score) * a.weight;
  const nomsF = [...favorables].sort(parPoids).slice(0, 3).map((f) => NOMS_COURTS[f.key] || f.label);
  const nomsD = [...defavorables].sort(parPoids).slice(0, 3).map((f) => NOMS_COURTS_NEGATIFS[f.key] || f.label);
  const liste = (arr) =>
    arr.length <= 1 ? arr[0] : `${arr.slice(0, -1).join(', ')} et ${arr[arr.length - 1]}`;

  if (bloquants.length > 0) {
    return `Potentiel ${niveau.label.toLowerCase()} (${score}/100) : ${liste(bloquants)} — un seul de ces facteurs suffit à empêcher le développement.`;
  }
  if (nomsF.length && nomsD.length) {
    return `Potentiel ${niveau.label.toLowerCase()} (${score}/100) : ${liste(nomsF)} ${nomsF.length > 1 ? 'jouent' : 'joue'} en faveur du développement, mais ${liste(nomsD)} ${nomsD.length > 1 ? 'le freinent' : 'le freine'}.`;
  }
  if (nomsF.length) {
    return `Potentiel ${niveau.label.toLowerCase()} (${score}/100) : l'environnement est globalement porteur (${liste(nomsF)}), sans facteur nettement défavorable.`;
  }
  if (nomsD.length) {
    return `Potentiel ${niveau.label.toLowerCase()} (${score}/100) : l'environnement est globalement hostile (${liste(nomsD)}).`;
  }
  if (inconnus.length >= 5) {
    return `Potentiel indéterminé : trop de facteurs sont indisponibles pour se prononcer honnêtement.`;
  }
  return `Potentiel ${niveau.label.toLowerCase()} (${score}/100) : aucun facteur ne se détache nettement, l'environnement est neutre.`;
}

export { FACTEURS, NIVEAUX, rampe, verdictOf };
