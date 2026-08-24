/**
 * Le titre de l'accueil doit rester à l'échelle de la distance.
 *
 * Signalé par Karim le 2026-08-24 : « Un système est à surveiller pour la
 * Guadeloupe » s'affichait pour une zone à 4 669 km, pas encore formée, juste
 * sous un bandeau « aucune vigilance en cours ». Les deux informations étaient
 * exactes, mais leur juxtaposition ne l'était pas.
 *
 * ⚠️ Ces tests portent UNIQUEMENT sur le vocabulaire affiché. Le niveau de
 * risque calculé par `evaluateThreat` n'est volontairement pas modifié : le
 * garde-fou de prudence issu de l'incident du 2026-08-09 — un système lointain
 * à forte probabilité n'est jamais classé « aucun » — reste intact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeSituation } from '../src/collector.js';

const risqueSurveillance = { code: 'surveillance', label: 'Surveillance rapprochée' };

function systeme(distanceKm, id = 's1') {
  return {
    id,
    nom: null,
    type: 'zone_surveillee',
    menace: { niveau: 'surveillance', distanceKm, message: 'message de test' },
  };
}

test('système lointain : on parle de suivi, pas de surveillance rapprochée', () => {
  const r = resumeSituation([systeme(4669)], risqueSurveillance);
  assert.match(r.titre, /lointain est suivi/);
  assert.doesNotMatch(r.titre, /à surveiller/);
});

test('système proche : le titre d\'origine est conservé', () => {
  const r = resumeSituation([systeme(900)], risqueSurveillance);
  assert.match(r.titre, /est à surveiller/);
});

test('la limite est franche à 2 500 km', () => {
  assert.match(resumeSituation([systeme(2501)], risqueSurveillance).titre, /lointain/);
  assert.doesNotMatch(resumeSituation([systeme(2500)], risqueSurveillance).titre, /lointain/);
});

test('c\'est le système le PLUS PROCHE qui décide du vocabulaire', () => {
  // Un système lointain ne doit pas adoucir le titre si un autre est proche.
  const r = resumeSituation([systeme(4669, 'a'), systeme(700, 'b')], risqueSurveillance);
  assert.match(r.titre, /est à surveiller/);
});

test('une menace imminente garde son titre, quelle que soit la distance', () => {
  const r = resumeSituation([systeme(4669)], { code: 'imminent', label: 'Impact possible' });
  assert.match(r.titre, /approche des Petites Antilles/);
});

test('distance inconnue : on ne devine pas, on garde le titre d\'origine', () => {
  const r = resumeSituation([systeme(null)], risqueSurveillance);
  assert.match(r.titre, /est à surveiller/);
});
