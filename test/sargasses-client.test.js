import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const carteSource = fs.readFileSync(new URL('../public/js/carte.js', import.meta.url), 'utf8');
const debut = source.indexOf('  function chargerSargasses() {');
const fin = source.indexOf('\n\n  // ------------------------------------------------------------------ météo', debut);
assert.ok(debut >= 0 && fin > debut);
const bloc = source.slice(debut, fin);

test('le premier chargement active réellement la couche sargasses', async () => {
  const appels = [];
  const contexte = {
    Promise,
    fetch: async () => ({
      ok: true,
      json: async () => ({ date: '2026-09-12', points: [{ lat: 16, lon: -61, risque: 2 }] }),
    }),
    carte: {
      definirSargasses: () => appels.push('donnees'),
      definirCalque: (nom, actif) => appels.push(`calque:${nom}:${actif}`),
    },
    document: { querySelector: () => null },
    mettreAJourInfoCalque() {},
    signaler() {},
  };

  vm.runInNewContext('var sargassesChargees = false;\n' + bloc, contexte);
  assert.equal(await contexte.chargerSargasses(), true);
  assert.deepEqual(appels, ['donnees', 'calque:sargasses:true']);
});

test('les sargasses sont actives dès la création de la carte et dans la commande', () => {
  const debutCarte = source.indexOf('  function initialiserCarte() {');
  const finCarte = source.indexOf('\n\n  // ---------------------------------------------------------------- thème', debutCarte);
  assert.match(carteSource, /sargasses:\s*true/);
  assert.match(source, /\['sargasses', 'Sargasses', true\]/);
  assert.match(source.slice(debutCarte, finCarte), /chargerSargasses\(\)/);
});

test('un échec désactive la commande et la couche sargasses', async () => {
  const caseSargasses = { checked: true };
  const appels = [];
  const contexte = {
    Promise,
    fetch: async () => ({ ok: false }),
    carte: {
      definirSargasses() {},
      definirCalque: (nom, actif) => appels.push([nom, actif]),
    },
    document: { querySelector: () => caseSargasses },
    mettreAJourInfoCalque() {},
    signaler() {},
  };

  vm.runInNewContext('var sargassesChargees = false;\n' + bloc, contexte);
  assert.equal(await contexte.chargerSargasses(), false);
  assert.equal(caseSargasses.checked, false);
  assert.deepEqual(appels, [['sargasses', false]]);
});
