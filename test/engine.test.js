/**
 * Tests du moteur. Aucun accès réseau, aucune base : tout tourne hors ligne.
 * Lancement : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distanceKm, bearingDeg, destination, compassFr,
  distanceToSegmentKm, distanceToTrackKm, pointInRing, ringCentroid, ktToKmh,
} from '../src/engine/geo.js';
import { analysePotential, rampe, verdictOf } from '../src/engine/potential.js';
import { evaluateThreat, corridorIndicatif, rayonIncertitudeKm, ilesConcernees, risqueGlobal } from '../src/engine/threat.js';
import { evolution } from '../src/store.js';
import { cisaillementKmh, rotationKmh, indiceAirSec } from '../src/sources/openmeteo.js';

const GP = { lat: 16.25, lon: -61.55 };
const DAKAR = { lat: 14.72, lon: -17.47 };

// ---------------------------------------------------------------- géodésie

test('distanceKm — Guadeloupe / Dakar cohérente avec la réalité', () => {
  const d = distanceKm(GP, DAKAR);
  assert.ok(d > 4600 && d < 4900, `distance inattendue : ${d} km`);
});

test('distanceKm — distance nulle sur le même point', () => {
  assert.equal(Math.round(distanceKm(GP, GP)), 0);
});

test('bearingDeg — plein est et plein nord', () => {
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }) - 90) < 0.5);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })) < 0.5);
});

test('destination — aller-retour cohérent avec la distance', () => {
  const p = destination(GP, 270, 500);
  assert.ok(Math.abs(distanceKm(GP, p) - 500) < 1);
  assert.ok(p.lon < GP.lon, 'un cap 270° doit aller vers l\'ouest');
});

test('destination — franchissement de l\'antiméridien borné à ±180', () => {
  const p = destination({ lat: 10, lon: 179 }, 90, 500);
  assert.ok(p.lon >= -180 && p.lon <= 180, `longitude hors bornes : ${p.lon}`);
});

test('compassFr — rose des vents en français', () => {
  assert.equal(compassFr(0), 'nord');
  assert.equal(compassFr(270), 'ouest');
  assert.equal(compassFr(315), 'nord-ouest');
  assert.equal(compassFr(360), 'nord');
});

test('distanceToSegmentKm — projection au milieu du segment', () => {
  const r = distanceToSegmentKm({ lat: 1, lon: 5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 10 });
  assert.ok(Math.abs(r.fraction - 0.5) < 0.02);
  assert.ok(Math.abs(r.distanceKm - 111) < 3);
});

test('distanceToSegmentKm — projection en dehors, bornée aux extrémités', () => {
  const r = distanceToSegmentKm({ lat: 0, lon: -5 }, { lat: 0, lon: 0 }, { lat: 0, lon: 10 });
  assert.equal(r.fraction, 0);
});

test('distanceToTrackKm — retient le segment le plus proche', () => {
  const track = [{ lat: 10, lon: -30 }, { lat: 12, lon: -45 }, { lat: 14, lon: -60 }];
  const r = distanceToTrackKm(GP, track);
  assert.equal(r.segmentIndex, 1);
  assert.ok(r.distanceKm > 0);
});

test('distanceToTrackKm — trajectoire vide ou à un point', () => {
  assert.equal(distanceToTrackKm(GP, []), null);
  assert.equal(Math.round(distanceToTrackKm(GP, [GP])), 0);
});

test('pointInRing — intérieur et extérieur d\'un carré', () => {
  const carre = [
    { lat: 10, lon: -50 }, { lat: 10, lon: -40 },
    { lat: 20, lon: -40 }, { lat: 20, lon: -50 },
  ];
  assert.equal(pointInRing({ lat: 15, lon: -45 }, carre), true);
  assert.equal(pointInRing({ lat: 5, lon: -45 }, carre), false);
});

test('ringCentroid — centre d\'un carré', () => {
  const c = ringCentroid([
    { lat: 10, lon: -50 }, { lat: 10, lon: -40 },
    { lat: 20, lon: -40 }, { lat: 20, lon: -50 },
  ]);
  assert.equal(c.lat, 15);
  assert.equal(c.lon, -45);
});

test('ktToKmh — conversion des nœuds', () => {
  assert.equal(ktToKmh(65), 120); // seuil ouragan
});

// ------------------------------------------------------- moteur de potentiel

const ENV_FAVORABLE = {
  lat: 14, sstC: 29.5, shearKmh: 12, rh700: 78, precipMmH: 6,
  lowLevelSpinKmh: 38, pressureHpa: 1006, dryAirIndex: 0.1, modelAgreement: 0.9,
};
const ENV_HOSTILE = {
  lat: 14, sstC: 25.8, shearKmh: 60, rh700: 28, precipMmH: 0.1,
  lowLevelSpinKmh: 3, pressureHpa: 1018, dryAirIndex: 0.8, modelAgreement: 0.3,
};

test('rampe — interpolation aux bornes et au milieu', () => {
  const pts = [[0, 0], [10, 100]];
  assert.equal(rampe(-5, pts), 0);
  assert.equal(rampe(15, pts), 100);
  assert.equal(rampe(5, pts), 50);
});

test('verdictOf — trois verdicts distincts', () => {
  assert.equal(verdictOf(0.8), 'favorable');
  assert.equal(verdictOf(0), 'neutre');
  assert.equal(verdictOf(-0.8), 'defavorable');
});

test('potentiel — environnement favorable noté haut', () => {
  const r = analysePotential(ENV_FAVORABLE);
  assert.ok(r.score >= 70, `score trop bas : ${r.score}`);
  assert.ok(['eleve', 'tres_eleve'].includes(r.niveau));
  assert.equal(r.bloquants.length, 0);
});

test('potentiel — environnement hostile noté bas', () => {
  const r = analysePotential(ENV_HOSTILE);
  assert.ok(r.score <= 30, `score trop haut : ${r.score}`);
  assert.ok(r.defavorables.length >= 4);
});

test('potentiel — la mer froide est éliminatoire à elle seule', () => {
  const r = analysePotential({ ...ENV_FAVORABLE, sstC: 24 });
  assert.ok(r.score <= 18, `verrou SST non appliqué : ${r.score}`);
  assert.ok(r.bloquants.includes('mer trop froide'));
});

test('potentiel — un cisaillement destructeur est éliminatoire', () => {
  const r = analysePotential({ ...ENV_FAVORABLE, shearKmh: 80 });
  assert.ok(r.score <= 20);
  assert.ok(r.bloquants.includes('cisaillement destructeur'));
});

test('potentiel — sous 5° de latitude, pas de cyclogenèse', () => {
  const r = analysePotential({ ...ENV_FAVORABLE, lat: 3 });
  assert.ok(r.score <= 12);
  assert.ok(r.bloquants.includes('latitude trop équatoriale'));
});

test('potentiel — une donnée manquante est déclarée, jamais inventée', () => {
  const r = analysePotential({ ...ENV_FAVORABLE, sstC: null, rh700: undefined });
  const sst = r.facteurs.find((f) => f.key === 'sst');
  assert.equal(sst.value, null);
  assert.equal(sst.verdict, 'inconnu');
  assert.ok(r.inconnus.includes('sst'));
  assert.ok(r.couverture < 100);
  assert.ok(r.confiance < 100);
});

test('potentiel — un NaN est traité comme une donnée manquante', () => {
  const r = analysePotential({ ...ENV_FAVORABLE, shearKmh: NaN });
  assert.equal(r.facteurs.find((f) => f.key === 'shear').verdict, 'inconnu');
});

test('potentiel — environnement entièrement vide reste sans exception', () => {
  const r = analysePotential({});
  assert.equal(r.inconnus.length, 9);
  assert.ok(r.confiance < 40);
  assert.match(r.resume, /indéterminé/i);
});

test('potentiel — chaque facteur porte une explication en français', () => {
  const r = analysePotential(ENV_FAVORABLE);
  for (const f of r.facteurs) {
    assert.ok(f.explanation.length > 30, `explication trop courte pour ${f.key}`);
    assert.ok(!/undefined|NaN|null/.test(f.explanation), `explication corrompue : ${f.key}`);
  }
});

test('potentiel — la confiance baisse avec des données anciennes', () => {
  const frais = analysePotential(ENV_FAVORABLE, { observedAgeMinutes: 0 });
  const vieux = analysePotential(ENV_FAVORABLE, { observedAgeMinutes: 1440 });
  assert.ok(vieux.confiance < frais.confiance);
});

test('potentiel — un écart marqué avec le NHC est signalé', () => {
  const r = analysePotential(ENV_FAVORABLE, { nhcProb7d: 10 });
  assert.ok(r.ecartNhc);
  assert.match(r.ecartNhc.message, /officielle fait foi/);
});

test('potentiel — pas de signalement pour un écart faible', () => {
  const r = analysePotential(ENV_FAVORABLE, { nhcProb7d: 78 });
  assert.equal(r.ecartNhc, null);
});

test('potentiel — la nature expérimentale est toujours portée par le résultat', () => {
  assert.equal(analysePotential(ENV_FAVORABLE).nature, 'analyse_kdl_experimentale');
});

// ----------------------------------------------------------- moteur de menace

test('rayonIncertitudeKm — croît avec l\'échéance', () => {
  assert.ok(rayonIncertitudeKm(24) < rayonIncertitudeKm(72));
  assert.ok(rayonIncertitudeKm(72) < rayonIncertitudeKm(120));
  assert.ok(rayonIncertitudeKm(0) > 0);
});

test('corridor — refusé sans mouvement connu', () => {
  assert.equal(corridorIndicatif({ lat: 14, lon: -45 }, null), null);
  assert.equal(corridorIndicatif({ lat: 14, lon: -45 }, { bearingDeg: 280, speedKmh: 0 }), null);
});

test('corridor — chaque point porte son rayon d\'incertitude', () => {
  const c = corridorIndicatif({ lat: 14, lon: -45 }, { bearingDeg: 280, speedKmh: 25 });
  assert.ok(c.length >= 6);
  assert.equal(c[0].heure, 0);
  assert.ok(c[c.length - 1].rayonKm > c[0].rayonKm);
});

test('menace — un système lointain qui s\'éloigne ne déclenche rien', () => {
  const r = evaluateThreat({
    position: { lat: 25, lon: -30 },
    mouvement: { bearingDeg: 45, speedKmh: 30 },
    potentielKdl: 60,
  });
  assert.equal(r.niveau, 'aucun');
  assert.equal(r.tendance, 'seloigne');
});

test('menace — un ouragan qui vise l\'archipel à 24 h est traité au plus haut', () => {
  const r = evaluateThreat({
    position: { lat: 15.6, lon: -57.5 },
    mouvement: { bearingDeg: 290, speedKmh: 26 },
    intensiteKmh: 165,
    statut: 'Ouragan Test',
    potentielKdl: 85,
    probNhc7d: 100,
  });
  assert.ok(['preparation', 'imminent'].includes(r.niveau), `niveau obtenu : ${r.niveau}`);
  assert.ok(r.approche.distanceKm < 250);
  // Le message ne nomme plus une autorité en dur : l'application couvre
  // désormais des territoires qui ne dépendent pas de Météo-France.
  assert.match(r.message, /consignes officielles|préparation/i);
});

test('menace — position inconnue : aucune invention', () => {
  const r = evaluateThreat({ position: null });
  assert.equal(r.niveau, 'aucun');
  assert.equal(r.distanceKm, null);
  assert.match(r.message, /Position inconnue/);
});

test('menace — sans mouvement, aucun corridor n\'est fabriqué', () => {
  const r = evaluateThreat({ position: { lat: 14, lon: -50 }, potentielKdl: 70 });
  assert.equal(r.corridor, null);
  assert.equal(r.fenetre, null);
  assert.match(r.incertitude, /pas encore assez net/);
});

test('menace — le résultat est toujours étiqueté comme estimation KDL', () => {
  const r = evaluateThreat({ position: { lat: 14, lon: -50 } });
  assert.equal(r.nature, 'estimation_kdl');
});

test('îles concernées — triées par distance au corridor', () => {
  const corridor = corridorIndicatif({ lat: 14.5, lon: -55 }, { bearingDeg: 285, speedKmh: 25 });
  const iles = ilesConcernees(corridor, 400);
  assert.ok(iles.length > 0);
  for (let i = 1; i < iles.length; i += 1) {
    assert.ok(iles[i].distanceKm >= iles[i - 1].distanceKm);
  }
});

test('risqueGlobal — retient le niveau le plus élevé', () => {
  const r = risqueGlobal([{ niveau: 'veille' }, { niveau: 'preparation' }, { niveau: 'aucun' }]);
  assert.equal(r.code, 'preparation');
});

test('risqueGlobal — liste vide = aucun risque', () => {
  assert.equal(risqueGlobal([]).code, 'aucun');
});

// ------------------------------------------------------------- météorologie

test('cisaillement — vents opposés donnent la somme des normes', () => {
  const v = cisaillementKmh({ vitesse: 20, direction: 90 }, { vitesse: 30, direction: 270 });
  assert.ok(Math.abs(v - 50) < 0.5);
});

test('cisaillement — vents alignés donnent la différence', () => {
  const v = cisaillementKmh({ vitesse: 20, direction: 90 }, { vitesse: 30, direction: 90 });
  assert.ok(Math.abs(v - 10) < 0.5);
});

test('cisaillement — donnée manquante propage null', () => {
  assert.equal(cisaillementKmh({ vitesse: null, direction: 90 }, { vitesse: 30, direction: 270 }), null);
});

test('rotation — un flux cyclonique donne une valeur positive', () => {
  // Hémisphère nord, rotation antihoraire : vent d'ouest au sud, d'est au nord.
  const spin = rotationKmh(
    { lat: 14, lon: -45 },
    { vitesse: 30, direction: 180 },  // est : vent du sud → v > 0
    { vitesse: 30, direction: 0 },    // ouest : vent du nord → v < 0
    { vitesse: 30, direction: 270 },  // nord : vent d'ouest → u > 0
    { vitesse: 30, direction: 90 },   // sud : vent d'est → u < 0
  );
  assert.ok(spin > 0, `rotation attendue positive, obtenue ${spin}`);
});

test('rotation — un flux rectiligne ne tourne pas', () => {
  const droit = { vitesse: 25, direction: 90 };
  const spin = rotationKmh({ lat: 14, lon: -45 }, droit, droit, droit, droit);
  assert.ok(spin < 1);
});

test('indice d\'air sec — atmosphère humide proche de zéro', () => {
  assert.ok(indiceAirSec(85, 80, 75) < 0.3);
});

test('indice d\'air sec — signature saharienne proche de un', () => {
  assert.ok(indiceAirSec(80, 20, 15) > 0.6);
});

test('indice d\'air sec — sans donnée haute, retourne null', () => {
  assert.equal(indiceAirSec(80, null, null), null);
});

// ----------------------------------------------------------------- historique

test('evolution — calcule la variation sur 24 h', () => {
  const t = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const serie = [
    { t: t(24), potentiel: 30 },
    { t: t(12), potentiel: 45 },
    { t: t(0), potentiel: 62 },
  ];
  const e = evolution(serie, 'potentiel', 24);
  assert.equal(e.delta, 32);
  assert.equal(e.sens, 'hausse');
});

test('evolution — refuse de conclure sans point assez ancien', () => {
  const t = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const serie = [{ t: t(1), potentiel: 30 }, { t: t(0), potentiel: 31 }];
  assert.equal(evolution(serie, 'potentiel', 24), null);
});

test('evolution — série trop courte ou champ absent', () => {
  assert.equal(evolution([], 'potentiel', 6), null);
  assert.equal(evolution([{ t: new Date().toISOString() }], 'potentiel', 6), null);
});

// -------------------------------------- couche saharienne mesurée

test('indice saharien — une mesure de poussière prime sur l\'humidité', async () => {
  const { indiceSaharien } = await import('../src/sources/openmeteo.js');
  // Poussière forte mais air humide : la mesure doit dominer.
  const r = indiceSaharien(100, 0.65, 0.1);
  assert.equal(r.mesure, true);
  assert.equal(r.source, 'aerosols');
  assert.ok(r.valeur > 0.6, `attendu > 0,6, obtenu ${r.valeur}`);
});

test('indice saharien — atmosphère propre donne une valeur basse', async () => {
  const { indiceSaharien } = await import('../src/sources/openmeteo.js');
  const r = indiceSaharien(1, 0.1, 0.1);
  assert.ok(r.valeur < 0.2, `attendu < 0,2, obtenu ${r.valeur}`);
});

test('indice saharien — sans mesure, repli sur l\'humidité, et c\'est signalé', async () => {
  const { indiceSaharien } = await import('../src/sources/openmeteo.js');
  const r = indiceSaharien(null, null, 0.55);
  assert.equal(r.mesure, false);
  assert.equal(r.source, 'humidite');
  assert.equal(r.valeur, 0.55);
});

test('indice saharien — sans rien du tout, aucune valeur inventée', async () => {
  const { indiceSaharien } = await import('../src/sources/openmeteo.js');
  assert.equal(indiceSaharien(null, null, null), null);
});

test('potentiel — l\'explication cite la mesure quand elle existe', () => {
  const r = analysePotential({
    lat: 14, sstC: 28, shearKmh: 20, rh700: 60, precipMmH: 2,
    lowLevelSpinKmh: 20, pressureHpa: 1010, dryAirIndex: 0.7, modelAgreement: 0.8,
    saharien: { mesure: true, source: 'aerosols', dustUgM3: 53, aod: 0.63 },
  });
  const f = r.facteurs.find((x) => x.key === 'dust');
  assert.match(f.explanation, /53 µg\/m³/);
  assert.match(f.explanation, /0,63/);
});

test('potentiel — l\'explication annonce l\'estimation indirecte sinon', () => {
  const r = analysePotential({
    lat: 14, sstC: 28, shearKmh: 20, rh700: 60, precipMmH: 2,
    lowLevelSpinKmh: 20, pressureHpa: 1010, dryAirIndex: 0.7, modelAgreement: 0.8,
  });
  const f = r.facteurs.find((x) => x.key === 'dust');
  assert.match(f.explanation, /indirecte/);
});
