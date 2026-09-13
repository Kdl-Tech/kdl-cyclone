import test from 'node:test';
import assert from 'node:assert/strict';
import { parserRisquesKml } from '../src/sources/sargasses.js';
import { CANAUX, SECTEURS } from '../src/sources/satellite.js';

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
