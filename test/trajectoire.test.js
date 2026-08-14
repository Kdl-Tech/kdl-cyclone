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
