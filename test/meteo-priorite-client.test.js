import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const debut = source.indexOf('  function strategieSourcesMeteo(terr) {');
const fin = source.indexOf('\n\n  function rendreGuadeloupe()', debut);

function chargerStrategie() {
  assert.ok(debut >= 0 && fin > debut, 'strategieSourcesMeteo doit exister');
  const contexte = { Boolean };
  vm.runInNewContext(source.slice(debut, fin), contexte);
  return contexte.strategieSourcesMeteo;
}

function chargerConditionsActuelles() {
  const contexte = { Boolean };
  vm.runInNewContext(source.slice(debut, fin), contexte);
  return contexte.conditionsActuellesMeteo;
}

test('des observations Météo-France fraîches restent la source principale', () => {
  const strategieSourcesMeteo = chargerStrategie();
  assert.deepEqual(
    { ...strategieSourcesMeteo({ observations: { disponible: true, perime: false } }) },
    { observationsMf: true, secoursConditions: false },
  );
});

test('Open-Meteo devient un secours explicite sans observation officielle', () => {
  const strategieSourcesMeteo = chargerStrategie();
  assert.equal(strategieSourcesMeteo({ observations: null }).secoursConditions, true);
});

test('une observation Météo-France périmée déclenche le secours sans être effacée', () => {
  const strategieSourcesMeteo = chargerStrategie();
  assert.deepEqual(
    { ...strategieSourcesMeteo({ observations: { disponible: true, perime: true } }) },
    { observationsMf: true, secoursConditions: true },
  );
});

test('la vue météo remplace les valeurs actuelles du modèle par les mesures Météo-France fraîches', () => {
  const choisir = chargerConditionsActuelles();
  const resultat = choisir({ observations: {
    disponible: true,
    perime: false,
    mesureLe: '2026-09-13T20:00:00Z',
    temperatureC: { valeur: 28.4 },
    humiditePct: { valeur: 76 },
    pressionHpa: { valeur: 1013 },
    ventMoyenKmh: { valeur: 18 },
  } }, { temperature: 31, humidite: 60, pressionHpa: 1008, ventKmh: 9 });
  assert.equal(resultat.officielle, true);
  assert.equal(resultat.source, 'Météo-France');
  assert.equal(resultat.temperature, 28.4);
  assert.equal(resultat.humidite, 76);
  assert.equal(resultat.pressionHpa, 1013);
  assert.equal(resultat.ventKmh, 18);
});

test('la vue météo garde Open-Meteo comme secours si les mesures officielles sont périmées', () => {
  const choisir = chargerConditionsActuelles();
  const resultat = choisir(
    { observations: { disponible: true, perime: true, temperatureC: { valeur: 28 } } },
    { temperature: 31, source: 'Open-Meteo' },
  );
  assert.equal(resultat.officielle, false);
  assert.equal(resultat.temperature, 31);
});
