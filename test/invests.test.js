/**
 * Numéros d'investigation : lecture ATCF et rattachement aux zones du bulletin.
 * Lancement : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { lireAtcf, associerInvests } from '../src/engine/invests.js';

const ATCF = `AL, 95, 2026082406,   , BEST,   0, 294N,  613W,  25, 1016, DB,   0,    ,    0,    0,    0,    0, 1017,  130, 120,   0,
AL, 95, 2026082412,   , BEST,   0, 304N,  605W,  25, 1016, DB,  34, NEQ,    0,    0,    0,    0, 1017,  130, 120,   0,
AL, 95, 2026082412,   , BEST,   0, 304N,  605W,  25, 1016, DB,  50, NEQ,    0,    0,    0,    0, 1017,  130, 120,   0,
`;

test('lireAtcf — retient le dernier relevé, converti en unités lisibles', () => {
  const f = lireAtcf(ATCF);
  assert.equal(f.identifiant, 'AL952026');
  assert.equal(f.numero, '95L');
  assert.equal(f.fixeLe, '2026-08-24T12:00:00.000Z');
  assert.deepEqual(f.position, { lat: 30.4, lon: -60.5 });
  assert.equal(f.ventKmh, 46);
  assert.equal(f.pressionHpa, 1016);
  assert.equal(f.typeFr, 'Perturbation');
});

test('lireAtcf — texte vide, illisible ou d\'un autre bassin : rien', () => {
  assert.equal(lireAtcf(''), null);
  assert.equal(lireAtcf(null), null);
  assert.equal(lireAtcf('EP, 95, 2026082412, , BEST, 0, 120N, 1100W, 25, 1008, DB'), null);
  assert.equal(lireAtcf('AL, 95, pasunedate, , BEST, 0, 120N, 500W, 25, 1008, DB'), null);
});

const T = Date.UTC(2026, 7, 24, 14);
const zones = () => [
  { id: 'nhc-two-1', numero: '1', position: { lat: 29, lon: -61 }, polygone: [[-65, 27], [-57, 27], [-57, 33], [-65, 33]] },
  { id: 'nhc-two-2', numero: '2', position: { lat: 11.2, lon: -17.9 }, polygone: [[-24, 9], [-14, 9], [-14, 14], [-24, 14]] },
];

test('associerInvests — la zone dont le polygone contient le relevé reçoit l\'Invest', () => {
  const z = zones();
  const n = associerInvests(z, [lireAtcf(ATCF)], { maintenant: T });
  assert.equal(n, 1);
  assert.equal(z[0].invest.numero, '95L');
  assert.equal(z[0].identifiantNhc, 'AL952026');
  assert.equal(z[1].invest, null);
});

test('associerInvests — hors polygone, la zone la plus proche à moins de 600 km', () => {
  const z = zones();
  z[0].polygone = null;
  const n = associerInvests(z, [lireAtcf(ATCF)], { maintenant: T });
  assert.equal(n, 1);
  assert.equal(z[0].invest.numero, '95L');
});

test('associerInvests — un relevé lointain ou périmé n\'est rattaché à rien', () => {
  const z = zones();
  const loin = { ...lireAtcf(ATCF), position: { lat: 45, lon: -30 } };
  assert.equal(associerInvests(z, [loin], { maintenant: T }), 0);
  assert.equal(associerInvests(zones(), [lireAtcf(ATCF)], { maintenant: T + 3 * 24 * 3600 * 1000 }), 0);
});

test('associerInvests — un Invest par zone, le plus récent d\'abord ; les anciens rattachements sont effacés', () => {
  const z = zones();
  z[0].invest = { numero: '90L' };
  const vieux = { ...lireAtcf(ATCF), numero: '94L', identifiant: 'AL942026', fixeLe: '2026-08-24T06:00:00.000Z' };
  const n = associerInvests(z, [vieux, lireAtcf(ATCF)], { maintenant: T });
  assert.equal(n, 1);
  assert.equal(z[0].invest.numero, '95L');
  assert.equal(associerInvests(z, [], { maintenant: T }), 0);
  assert.equal(z[0].invest, null);
});
