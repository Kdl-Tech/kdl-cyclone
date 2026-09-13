import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluerVeilleOfficielle, reutiliserDerniereListe } from '../src/direct.js';

test('une veille entièrement inchangée ne déclenche pas de collecte lourde', () => {
  const resultat = evaluerVeilleOfficielle({
    mf: { disponible: true, inchange: true },
    zones: { ok: true, inchange: true },
    texte: { ok: true, inchange: true },
    actifs: { ok: true, inchange: true },
  });
  assert.equal(resultat.modifie, false);
});

test('un nouveau bulletin Météo-France déclenche immédiatement la collecte', () => {
  assert.equal(evaluerVeilleOfficielle({
    mf: { disponible: true, inchange: false },
    zones: { ok: true, inchange: true }, texte: { ok: true, inchange: true }, actifs: { ok: true, inchange: true },
  }).modifie, true);
});

test('un nouveau document NHC déclenche immédiatement la collecte', () => {
  assert.equal(evaluerVeilleOfficielle({
    mf: { disponible: false, inchange: true },
    zones: { ok: true, inchange: true }, texte: { ok: true, inchange: true }, actifs: { ok: true, systemes: [] },
  }).modifie, true);
});

test('une panne de source ne crée pas un faux changement', () => {
  assert.equal(evaluerVeilleOfficielle({
    mf: { disponible: false, motif: 'réseau' },
    zones: { ok: false }, texte: { ok: false }, actifs: { ok: false },
  }).modifie, false);
});

test('une réponse absente conserve la dernière liste connue', () => {
  const ancienne = [{ id: 'al01' }];
  assert.deepEqual(reutiliserDerniereListe(null, ancienne), ancienne);
  assert.deepEqual(reutiliserDerniereListe(undefined, ancienne), ancienne);
});

test('une liste vide confirmée remplace la précédente', () => {
  assert.deepEqual(reutiliserDerniereListe([], [{ id: 'al01' }]), []);
});
