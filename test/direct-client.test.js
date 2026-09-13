import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const debut = source.indexOf('  var fluxErreurs = 0;');
const fin = source.indexOf('  function rafraichirBoucleSatellite()', debut);
assert.ok(debut >= 0 && fin > debut);
const bloc = source.slice(debut, fin);

test('le flux SSE se recrée après des erreurs répétées', () => {
  const instances = [];
  const minuteries = [];
  class FauxEventSource {
    constructor() { this.closed = false; instances.push(this); }
    addEventListener() {}
    close() { this.closed = true; }
  }
  const contexte = {
    window: { EventSource: FauxEventSource }, EventSource: FauxEventSource,
    setTimeout: (fn, delai) => { minuteries.push({ fn, delai }); return 1; },
    clearTimeout() {}, etat: null, boucle: null, charger: () => Promise.resolve(),
    signaler() {}, rafraichirBoucleSatellite() {}, JSON,
  };
  vm.runInNewContext(bloc + '\nouvrirFlux();', contexte);
  for (let i = 0; i < 7; i += 1) instances[0].onerror();
  assert.equal(instances[0].closed, true);
  assert.equal(minuteries.length, 1);
  assert.ok(minuteries[0].delai <= 60_000);
  minuteries[0].fn();
  assert.equal(instances.length, 2);
});
