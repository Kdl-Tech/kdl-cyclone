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
