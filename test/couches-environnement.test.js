import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parserRisquesKml } from '../src/sources/sargasses.js';
import { CANAUX, SECTEURS } from '../src/sources/satellite.js';

const satelliteClient = fs.readFileSync(new URL('../public/js/satellite.js', import.meta.url), 'utf8');
const carteClient = fs.readFileSync(new URL('../public/js/carte.js', import.meta.url), 'utf8');
const appClient = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const cssClient = fs.readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');

test('la couche NOAA agrège les segments côtiers sans publier les millions de points', () => {
  const kml = `<Placemark><SimpleData name="risk">3</SimpleData><SimpleData name="date">20260911</SimpleData><LineString><coordinates>-61.6,16.2 -61.5,16.3</coordinates></LineString></Placemark>
  <Placemark><SimpleData name="risk">1</SimpleData><SimpleData name="date">20260911</SimpleData><LineString><coordinates>-61.55,16.25 -61.45,16.35</coordinates></LineString></Placemark>`;
  const resultat = parserRisquesKml(kml);
  assert.equal(resultat.date, '2026-09-11');
  assert.equal(resultat.points.length, 1);
  assert.equal(resultat.points[0].risque, 3);
});

test('la brume de sable utilise le produit satellite NOAA sur tout l Atlantique', () => {
  assert.equal(CANAUX.dust.code, 'Dust');
  assert.equal(SECTEURS.atlantique.code, 'taw');
  assert.ok(SECTEURS.atlantique.emprise.ouest <= -100);
  assert.ok(SECTEURS.atlantique.emprise.est >= 5);
});

test('la brume de sable reçoit une palette jaune ocre dédiée', () => {
  const contexte = { window: {} };
  vm.runInNewContext(satelliteClient, contexte);
  assert.equal(typeof contexte.window.KdlSatellite.filtrePalette, 'function');
  assert.equal(
    contexte.window.KdlSatellite.filtrePalette('sable'),
    'sepia(1) saturate(1.55) hue-rotate(350deg) brightness(.96) contrast(1.08)',
  );
  assert.equal(contexte.window.KdlSatellite.ratioImageUtile('sable'), 0.92);
  assert.equal(contexte.window.KdlSatellite.ratioImageUtile(null), 1);
});

test('le premier chargement active réellement le calque sable', () => {
  const debut = appClient.indexOf('  function chargerSable()');
  const fin = appClient.indexOf('\n\n  function chargerSargasses()', debut);
  const bloc = appClient.slice(debut, fin);
  assert.match(bloc, /carte\.attacherBoucle\('sable', boucleSable\)/);
  assert.match(bloc, /carte\.definirCalque\('sable', true\)/);
});

test('les sargasses restent dans une gamme vert foncé', () => {
  const debut = carteClient.indexOf('  Carte.prototype._dessinerSargasses');
  const fin = carteClient.indexOf('\n\n  Carte.prototype.definirCalque', debut);
  const bloc = carteClient.slice(debut, fin);
  assert.match(bloc, /#2f6b3c/);
  assert.match(bloc, /#1f5935/);
  assert.match(bloc, /#123f2b/);
  assert.doesNotMatch(bloc, /#d2a13a|#e56f2f/);
});

test('les commandes distinguent sable et sargasses avec leur provenance', () => {
  assert.match(appClient, /calques__pastille--sable/);
  assert.match(appClient, /calques__pastille--sargasses/);
  assert.match(appClient, /data-calque-info="sable"/);
  assert.match(appClient, /data-calque-info="sargasses"/);
  assert.match(cssClient, /\.calques__pastille--sable/);
  assert.match(cssClient, /\.calques__pastille--sargasses/);
});
