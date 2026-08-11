/**
 * Évaluation du risque de passage ou d'impact près de la Guadeloupe.
 * Fonction pure, sans E/S. Produit un corridor INDICATIF — jamais un cône
 * officiel. Le cône officiel n'existe que lorsque le NHC en publie un, et il
 * est alors transporté tel quel, sans retouche.
 */

import { distanceKm, destination, distanceToTrackKm, compassFr } from './geo.js';
import { GUADELOUPE, LESSER_ANTILLES_ARC } from '../config.js';

/**
 * Rayon d'incertitude de position, en kilomètres, par échéance.
 * Ordre de grandeur des erreurs moyennes de prévision de trajectoire dans le
 * bassin atlantique. Volontairement large : mieux vaut un corridor honnête
 * qu'une ligne faussement précise.
 */
const RAYON_INCERTITUDE_KM = [
  { h: 0, km: 40 },
  { h: 12, km: 75 },
  { h: 24, km: 110 },
  { h: 36, km: 145 },
  { h: 48, km: 185 },
  { h: 72, km: 280 },
  { h: 96, km: 385 },
  { h: 120, km: 500 },
];

/** Rayon d'incertitude interpolé pour une échéance donnée. */
export function rayonIncertitudeKm(heures) {
  const pts = RAYON_INCERTITUDE_KM;
  if (heures <= pts[0].h) return pts[0].km;
  const dernier = pts[pts.length - 1];
  if (heures >= dernier.h) return dernier.km + (heures - dernier.h) * 4.5;
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (heures >= pts[i].h && heures <= pts[i + 1].h) {
      const t = (heures - pts[i].h) / (pts[i + 1].h - pts[i].h);
      return pts[i].km + t * (pts[i + 1].km - pts[i].km);
    }
  }
  return dernier.km;
}

/**
 * Extrapole un corridor indicatif à partir de la position et du mouvement.
 * Un mouvement inconnu produit `null` : on n'invente pas de trajectoire.
 *
 * @param {{lat:number, lon:number}} position
 * @param {{bearingDeg:number, speedKmh:number}} mouvement
 * @param {number} [horizonH=120]
 */
export function corridorIndicatif(position, mouvement, horizonH = 120) {
  if (!position || !mouvement) return null;
  const { bearingDeg, speedKmh } = mouvement;
  if (!Number.isFinite(bearingDeg) || !Number.isFinite(speedKmh) || speedKmh <= 0) return null;

  const pas = [0, 12, 24, 36, 48, 72, 96, 120].filter((h) => h <= horizonH);
  return pas.map((h) => {
    const p = h === 0 ? position : destination(position, bearingDeg, speedKmh * h);
    return {
      heure: h,
      lat: Math.round(p.lat * 1000) / 1000,
      lon: Math.round(p.lon * 1000) / 1000,
      rayonKm: Math.round(rayonIncertitudeKm(h)),
    };
  });
}

const NIVEAUX_RISQUE = [
  { code: 'aucun', label: 'Aucun', ordre: 0 },
  { code: 'veille', label: 'Veille', ordre: 1 },
  { code: 'surveillance', label: 'Surveillance rapprochée', ordre: 2 },
  { code: 'preparation', label: 'Préparation conseillée', ordre: 3 },
  { code: 'imminent', label: 'Impact possible à court terme', ordre: 4 },
];

const parCode = (code) => NIVEAUX_RISQUE.find((n) => n.code === code) ?? NIVEAUX_RISQUE[0];

/**
 * Évalue la menace d'un système pour la Guadeloupe.
 *
 * @param {object} systeme
 * @param {{lat:number,lon:number}} systeme.position
 * @param {{bearingDeg:number,speedKmh:number}} [systeme.mouvement]
 * @param {number} [systeme.intensiteKmh]  Vent maximal soutenu, si nommé.
 * @param {string} [systeme.statut]        Onde, dépression, tempête, ouragan…
 * @param {number} [systeme.potentielKdl]  Score 0-100 du moteur de potentiel.
 * @param {number} [systeme.probNhc7d]     Probabilité officielle NHC à 7 jours.
 * @param {Array}  [systeme.coneOfficiel]  Cône officiel NHC s'il existe.
 * @param {{lat:number,lon:number}} [cible=GUADELOUPE]
 */
export function evaluateThreat(systeme, cible = GUADELOUPE) {
  const { position, mouvement, intensiteKmh, statut, potentielKdl, probNhc7d } = systeme;
  if (!position) {
    return {
      niveau: 'aucun',
      niveauLabel: 'Aucun',
      score: 0,
      distanceKm: null,
      message: "Position inconnue : impossible d'évaluer une menace pour la Guadeloupe.",
      incertitude: 'Position du système non disponible.',
      nature: 'estimation_kdl',
    };
  }

  const distanceActuelle = Math.round(distanceKm(position, cible));
  const corridor = corridorIndicatif(position, mouvement);

  /**
   * Sans déplacement mesuré, il n'y a pas de corridor — et le calcul
   * géométrique donnerait alors un risque nul. Ce serait un contresens
   * dangereux : un système tout juste apparu, dont on ne connaît pas encore la
   * route, serait déclaré inoffensif précisément parce qu'on en sait peu.
   *
   * Dans le bassin atlantique tropical, la circulation générale porte les ondes
   * vers l'ouest, donc vers l'arc antillais. Tant que le déplacement est
   * inconnu, on retient un niveau plancher fondé sur la probabilité officielle
   * de formation et sur la position du système par rapport à l'archipel.
   */
  const enAmont = position.lat >= 4 && position.lat <= 27 && position.lon > cible.lon;
  const probOfficielle = Number.isFinite(probNhc7d) ? probNhc7d : null;
  let plancher = null;
  if (!corridor && enAmont) {
    if (probOfficielle !== null && probOfficielle >= 40) plancher = 'surveillance';
    else if (probOfficielle !== null && probOfficielle >= 15) plancher = 'veille';
    else if (Number.isFinite(potentielKdl) && potentielKdl >= 60) plancher = 'veille';
  }

  // Approche la plus proche prévue par le corridor indicatif.
  let approche = null;
  if (corridor && corridor.length > 1) {
    const pts = corridor.map((c) => ({ lat: c.lat, lon: c.lon }));
    const r = distanceToTrackKm(cible, pts);
    if (r) {
      const seg = corridor[r.segmentIndex];
      const segSuivant = corridor[Math.min(r.segmentIndex + 1, corridor.length - 1)];
      const heures = seg.heure + r.fraction * (segSuivant.heure - seg.heure);
      approche = {
        distanceKm: Math.round(r.distanceKm),
        dansHeures: Math.round(heures),
        rayonIncertitudeKm: Math.round(rayonIncertitudeKm(heures)),
      };
    }
  }

  // Le système s'éloigne-t-il ? On compare la distance actuelle à celle à 24 h.
  let tendance = 'indeterminee';
  if (corridor) {
    const p24 = corridor.find((c) => c.heure === 24);
    if (p24) {
      const d24 = distanceKm({ lat: p24.lat, lon: p24.lon }, cible);
      if (d24 < distanceActuelle - 50) tendance = 'se_rapproche';
      else if (d24 > distanceActuelle + 50) tendance = 'seloigne';
      else tendance = 'stable';
    }
  }

  // Probabilité géométrique de passage à proximité : le point cible tombe-t-il
  // dans le cercle d'incertitude au moment de l'approche la plus proche ?
  let probaApproche = 0;
  if (approche) {
    const ratio = approche.distanceKm / Math.max(approche.rayonIncertitudeKm, 1);
    // ratio 0 → 1 (au cœur du corridor) ; ratio ≥ 2,5 → quasi nul.
    probaApproche = Math.max(0, Math.min(1, 1 - ratio / 2.5));
  }

  // Intensité potentielle : ce que le système pourrait devenir.
  const intensiteConnue = Number.isFinite(intensiteKmh) ? intensiteKmh : null;
  const potentiel = Number.isFinite(potentielKdl) ? potentielKdl : null;
  const probaDeveloppement = Number.isFinite(probNhc7d)
    ? probNhc7d / 100
    : potentiel !== null
      ? potentiel / 100
      : 0.15;

  // Sévérité 0-1 : un système déjà nommé pèse plus qu'une onde à potentiel égal.
  let severite;
  if (intensiteConnue !== null) {
    severite = Math.min(1, intensiteConnue / 210); // 210 km/h ≈ ouragan majeur
    severite = Math.max(severite, 0.35);
  } else {
    severite = 0.25 + 0.5 * probaDeveloppement;
  }

  // Facteur de délai : un système à 5 jours n'appelle pas la même réaction
  // qu'un système à 24 h, à probabilité égale.
  const heuresAvant = approche?.dansHeures ?? null;
  const facteurDelai =
    heuresAvant === null ? 0.4
      : heuresAvant <= 24 ? 1
        : heuresAvant <= 48 ? 0.85
          : heuresAvant <= 72 ? 0.65
            : heuresAvant <= 96 ? 0.45
              : 0.3;

  const score = Math.round(
    100 * probaApproche * severite * facteurDelai * (0.4 + 0.6 * probaDeveloppement),
  );

  let niveau = 'aucun';
  if (score >= 45) niveau = 'imminent';
  else if (score >= 25) niveau = 'preparation';
  else if (score >= 10) niveau = 'surveillance';
  else if (score >= 3 || (approche && approche.distanceKm < 600)) niveau = 'veille';

  // Le plancher ne peut que relever le niveau, jamais l'abaisser.
  if (plancher && parCode(plancher).ordre > parCode(niveau).ordre) niveau = plancher;

  // Un système déjà nommé qui approche à moins de 48 h ne descend jamais
  // sous « surveillance rapprochée », quel que soit le calcul.
  if (intensiteConnue !== null && heuresAvant !== null && heuresAvant <= 48 && approche.distanceKm < 500) {
    if (parCode(niveau).ordre < 2) niveau = 'surveillance';
  }

  const n = parCode(niveau);
  return {
    niveau: n.code,
    niveauLabel: n.label,
    score,
    distanceKm: distanceActuelle,
    direction: mouvement?.bearingDeg != null ? compassFr(mouvement.bearingDeg) : null,
    tendance,
    approche,
    corridor,
    fenetre: fenetreFr(approche),
    incertitude: incertitudeFr(approche, tendance),
    message: messageFr({
      n, distanceActuelle, approche, statut, tendance, intensiteConnue,
      sansCorridor: !corridor, probOfficielle, enAmont,
      // Sans ce nom, le message annoncerait « de la Guadeloupe » en affichant
      // la distance d'un autre territoire.
      nomCible: cible.articleDe ? cible.articleDe + cible.nom : 'de la Guadeloupe',
    }),
    // Rendre explicite d'où vient le niveau : calcul de trajectoire, ou
    // prudence faute de trajectoire connue.
    fondement: corridor ? 'corridor_calcule' : (plancher ? 'prudence_sans_trajectoire' : 'aucun_element'),
    nature: 'estimation_kdl',
  };
}

function fenetreFr(approche) {
  if (!approche) return null;
  const h = approche.dansHeures;
  if (h <= 0) return "Passage au plus près en cours ou imminent.";
  if (h < 24) return `Passage au plus près estimé dans environ ${h} heures.`;
  const jours = Math.round(h / 24);
  return `Passage au plus près estimé dans environ ${jours} jour${jours > 1 ? 's' : ''} (± 1 jour).`;
}

function incertitudeFr(approche, tendance) {
  if (!approche) {
    return "Le déplacement du système n'est pas encore assez net pour tracer un corridor, "
      + "et aucune trajectoire n'est inventée tant que la donnée manque. "
      + "Cela ne veut pas dire que le système est sans danger : cela veut dire "
      + "qu'on ne sait pas encore où il va.";
  }
  const r = approche.rayonIncertitudeKm;
  const base = `À cette échéance, la position réelle peut s'écarter d'environ ${r} km du corridor tracé.`;
  if (tendance === 'seloigne') return `${base} La tendance actuelle éloigne le système de l'archipel.`;
  if (tendance === 'se_rapproche') return `${base} La tendance actuelle rapproche le système de l'archipel.`;
  return base;
}

function messageFr({
  n, distanceActuelle, approche, statut, tendance, intensiteConnue,
  sansCorridor, probOfficielle, enAmont, nomCible,
}) {
  const quoi = statut || 'Le système';
  const dist = `${distanceActuelle.toLocaleString('fr-FR')} km`;
  const cibleNom = nomCible || 'de la Guadeloupe';

  // Sans trajectoire connue, on dit ce qu'on sait et ce qu'on ignore, plutôt
  // que d'affirmer une absence de menace qui n'a pas été démontrée.
  if (sansCorridor && enAmont && probOfficielle !== null) {
    const route = "Les systèmes de ce secteur se déplacent généralement vers l'ouest, "
      + "donc en direction de l'arc antillais.";
    if (n.code === 'aucun') {
      return `${quoi} est à ${dist} ${cibleNom}. Le NHC lui donne ${probOfficielle} % de chances `
        + `de se former dans les sept prochains jours. Son déplacement n'est pas encore mesurable. ${route}`;
    }
    return `${quoi} est à ${dist} ${cibleNom}, avec ${probOfficielle} % de chances de formation `
      + `à sept jours selon le NHC. Son déplacement n'est pas encore mesurable, il est donc suivi `
      + `par prudence. ${route}`;
  }

  if (n.code === 'aucun') {
    return `${quoi} se trouve à ${dist} ${cibleNom} et ne présente pas de menace identifiée.`;
  }
  if (n.code === 'veille') {
    return `${quoi} est à ${dist}. Il est suivi par précaution, sans élément justifiant une préparation particulière à ce stade.`;
  }
  if (n.code === 'surveillance') {
    return `${quoi} est à ${dist} et ${tendance === 'se_rapproche' ? 'se rapproche' : 'reste à surveiller'}. Il est trop tôt pour conclure, mais l'évolution mérite un point régulier.`;
  }
  if (n.code === 'preparation') {
    return `${quoi} est à ${dist} et pourrait passer à environ ${approche?.distanceKm ?? '—'} km. C'est le moment de vérifier calmement son kit de préparation, avant toute décision des autorités.`;
  }
  return `${quoi}${intensiteConnue ? ` (${Math.round(intensiteConnue)} km/h)` : ''} est à ${dist} et son corridor passe à courte échéance. Suivez en priorité les consignes officielles de votre territoire.`;
}

/** Îles de l'arc concernées par le corridor, à moins de `seuilKm`. */
export function ilesConcernees(corridor, seuilKm = 250) {
  if (!corridor) return [];
  const pts = corridor.map((c) => ({ lat: c.lat, lon: c.lon }));
  return LESSER_ANTILLES_ARC
    .map((ile) => {
      const r = distanceToTrackKm(ile, pts);
      return r ? { ...ile, distanceKm: Math.round(r.distanceKm) } : null;
    })
    .filter((x) => x && x.distanceKm <= seuilKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Niveau de risque le plus élevé parmi plusieurs évaluations. */
export function risqueGlobal(evaluations) {
  if (!evaluations || evaluations.length === 0) return parCode('aucun');
  return evaluations
    .map((e) => parCode(e.niveau))
    .reduce((max, n) => (n.ordre > max.ordre ? n : max), parCode('aucun'));
}

export { NIVEAUX_RISQUE };
