/**
 * Direction de déplacement : officielle d'abord, déduite ensuite, jamais inventée.
 * Lancement : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  directionDepuisTrace, mouvementDepuisHistorique, versFr, choisirMouvement,
} from '../src/engine/mouvement.js';
import { evaluateThreat } from '../src/engine/threat.js';

const H = 3600 * 1000;
const T0 = Date.UTC(2026, 7, 24, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

test('directionDepuisTrace — une ligne vers l\'ouest donne un cap ouest, sans vitesse', () => {
  const m = directionDepuisTrace([[-18, 11], [-19, 11.1], [-22, 11.5]]);
  assert.ok(m);
  assert.ok(m.bearingDeg > 265 && m.bearingDeg < 290, `cap ${m.bearingDeg}`);
  assert.equal(m.speedKmh, null);
});

test('directionDepuisTrace — trace trop courte ou trop brève : rien', () => {
  assert.equal(directionDepuisTrace(null), null);
  assert.equal(directionDepuisTrace([[-18, 11]]), null);
  assert.equal(directionDepuisTrace([[-18, 11], [-18.05, 11.01]]), null);
  assert.equal(directionDepuisTrace([[-18, 11], [null, 12]]), null);
});

test('mouvementDepuisHistorique — 12 h de positions vers l\'ouest-nord-ouest', () => {
  const serie = [];
  for (let h = 0; h <= 12; h += 1) {
    serie.push({ t: iso(T0 + h * H), lat: 11 + h * 0.02, lon: -18 - h * 0.15, potentiel: 50 });
  }
  const m = mouvementDepuisHistorique(serie, T0 + 12 * H);
  assert.ok(m);
  assert.ok(m.bearingDeg > 270 && m.bearingDeg < 300, `cap ${m.bearingDeg}`);
  assert.ok(m.speedKmh >= 14 && m.speedKmh <= 20, `vitesse ${m.speedKmh}`);
});

test('mouvementDepuisHistorique — moins de six heures : le bruit du NHC ne fait pas une direction', () => {
  const serie = [];
  for (let m = 0; m <= 25; m += 5) serie.push({ t: iso(T0 + m * 60000), lat: 11, lon: -18 - m * 0.05 });
  assert.equal(mouvementDepuisHistorique(serie, T0 + 25 * 60000), null);
});

test('mouvementDepuisHistorique — un système qui n\'a pas bougé n\'a pas de direction', () => {
  const serie = [0, 6, 12].map((h) => ({ t: iso(T0 + h * H), lat: 11.1, lon: -18.02 }));
  assert.equal(mouvementDepuisHistorique(serie, T0 + 12 * H), null);
});

test('mouvementDepuisHistorique — un historique périmé ne sert plus', () => {
  const serie = [0, 12].map((h) => ({ t: iso(T0 + h * H), lat: 11, lon: -18 - h * 0.2 }));
  assert.equal(mouvementDepuisHistorique(serie, T0 + 30 * H), null);
});

test('versFr — élision devant une voyelle', () => {
  assert.equal(versFr('ouest'), "vers l'ouest");
  assert.equal(versFr('est-nord-est'), "vers l'est-nord-est");
  assert.equal(versFr('nord-ouest'), 'vers le nord-ouest');
  assert.equal(versFr('sud'), 'vers le sud');
  assert.equal(versFr(null), null);
});

test('choisirMouvement — le NHC prime, avec sa vitesse', () => {
  const m = choisirMouvement({
    officiel: { bearingDeg: 285, speedKmh: 24 },
    trace: [[-18, 11], [-25, 14]],
  });
  assert.equal(m.origine, 'NHC');
  assert.equal(m.speedKmh, 24);
  assert.equal(m.vitesseConnue, true);
  assert.equal(m.versFr, "vers l'ouest-nord-ouest");
});

test('choisirMouvement — zone du TWO : sens officiel, vitesse inconnue, corridor refusé', () => {
  const m = choisirMouvement({ trace: [[-18, 11], [-25, 14]], nomme: false });
  assert.equal(m.origine, 'déplacement attendu par le NHC');
  assert.equal(m.vitesseConnue, false);
  assert.equal(m.speedKmh, null);
  assert.equal(m.directionFr, 'ouest-nord-ouest');

  const menace = evaluateThreat({
    position: { lat: 11, lon: -18 }, mouvement: m, probNhc7d: 60, statut: 'La zone surveillée',
  });
  assert.equal(menace.corridor, null, 'pas de corridor sans vitesse');
  assert.equal(menace.direction, 'ouest-nord-ouest');
  assert.match(menace.message, /vers l'ouest-nord-ouest/);
  assert.match(menace.message, /sans vitesse publiée/);
  assert.doesNotMatch(menace.message, /pas encore mesurable/);
  assert.match(menace.incertitude, /on connaît le sens, pas l'échéance/);
});

test('choisirMouvement — système nommé sans déplacement publié : trajectoire prévue', () => {
  const m = choisirMouvement({ trace: [[-50, 14], [-58, 17]], nomme: true });
  assert.equal(m.origine, 'trajectoire prévue par le NHC');
});

test('choisirMouvement — en dernier recours, les positions enregistrées', () => {
  const historique = [0, 6, 12].map((h) => ({ t: iso(Date.now() - (12 - h) * H), lat: 11, lon: -18 - h * 0.2 }));
  const m = choisirMouvement({ historique });
  assert.equal(m.origine, 'calculé par KDL');
  assert.equal(m.vitesseConnue, true);
});

test('choisirMouvement — sans aucune donnée : null, rien n\'est inventé', () => {
  assert.equal(choisirMouvement({}), null);
  assert.equal(choisirMouvement({ trace: [[-18, 11]], historique: [] }), null);
});
