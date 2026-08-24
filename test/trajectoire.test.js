import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trajectoireDepuisCouche } from '../src/sources/nhc.js';

test('trajectoire : une PolyLine devient une liste [lon, lat]', () => {
  const couche = [{
    geometry: { type: 'PolyLine', rings: [[
      { lon: -52.8712, lat: 11.6754 },
      { lon: -55.10, lat: 12.30 },
      { lon: -58.00, lat: 13.10 },
    ]] },
  }];
  const t = trajectoireDepuisCouche(couche);
  assert.deepEqual(t, [[-52.871, 11.675], [-55.1, 12.3], [-58, 13.1]]);
});

test('trajectoire : plusieurs parties sont concaténées', () => {
  const couche = [{
    geometry: { type: 'PolyLine', rings: [
      [{ lon: -50, lat: 10 }, { lon: -51, lat: 11 }],
      [{ lon: -52, lat: 12 }],
    ] },
  }];
  assert.deepEqual(trajectoireDepuisCouche(couche), [[-50, 10], [-51, 11], [-52, 12]]);
});

test('trajectoire : moins de 2 points ou absence -> null', () => {
  assert.equal(trajectoireDepuisCouche([]), null);
  assert.equal(trajectoireDepuisCouche(null), null);
  assert.equal(trajectoireDepuisCouche([{ geometry: { type: 'Point', coordinates: { lon: 1, lat: 2 } } }]), null);
  assert.equal(trajectoireDepuisCouche([{ geometry: { type: 'PolyLine', rings: [[{ lon: -50, lat: 10 }]] } }]), null);
});

// ---- Cône officiel : lecture des couches `_pgn` et `_pts` de l'archive 5day.
import { coneDepuisCouches } from '../src/sources/nhc.js';

const pgn = [{ geometry: { type: 'Polygon', rings: [[{ lon: -60, lat: 15 }, { lon: -62, lat: 16 }, { lon: -61, lat: 17 }]] }, properties: {} }];
const pts = [
  { geometry: { type: 'Point', coordinates: { lat: 16, lon: -62 } }, properties: { TAU: 24, MAXWIND: 65, DVLBL: 'H', FLDATELBL: '2026-08-25 5:00 AM Tue' } },
  { geometry: { type: 'Point', coordinates: { lat: 15, lon: -60 } }, properties: { TAU: 0, MAXWIND: 55, DVLBL: 'S' } },
];

test('cône : polygone et points d\'échéance, triés par échéance, en km/h et en français', () => {
  const c = coneDepuisCouches(pgn, pts);
  assert.equal(c.polygones.length, 1);
  assert.deepEqual(c.polygones[0][1], [-62, 16]);
  assert.equal(c.pointsPrevus.length, 2);
  assert.equal(c.pointsPrevus[0].echeanceH, 0);
  assert.equal(c.pointsPrevus[1].intensiteKmh, 120);
  assert.equal(c.pointsPrevus[1].stade, 'Ouragan');
  assert.equal(c.pointsPrevus[1].echeance, '2026-08-25 5:00 AM Tue');
});

test('cône : une couche ligne seule (le premier shapefile de l\'archive) ne fait pas un cône', () => {
  const lin = [{ geometry: { type: 'PolyLine', rings: [[{ lon: -60, lat: 15 }, { lon: -62, lat: 16 }]] }, properties: {} }];
  assert.equal(coneDepuisCouches(lin, []), null);
  assert.equal(coneDepuisCouches([], []), null);
});
