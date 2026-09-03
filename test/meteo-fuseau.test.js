/**
 * Non-régression du décalage horaire des « Prochaines heures ».
 *
 * Le 2026-08-24, l'application affichait la première heure à 19:00 alors qu'il
 * était 15:00 en Guadeloupe. Cause : Open-Meteo, interrogé avec
 * `timezone=America/Guadeloupe`, renvoie des heures locales SANS suffixe de
 * fuseau ("2026-08-24T15:00") ; `new Date(...)` les interprétait dans le fuseau
 * du serveur — le VPS tourne en UTC — d'où quatre heures d'écart.
 *
 * Le bug était invisible en développement : le poste de travail est déjà à
 * l'heure de la Guadeloupe. Ces tests forcent donc les deux situations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indiceProche } from '../src/sources/meteo.js';

const FUSEAU = 'America/Guadeloupe';

/** Une journée d'horaires locaux, tels qu'Open-Meteo les écrit. */
function horaires(jour) {
  const out = [];
  for (let h = 0; h < 24; h += 1) out.push(`${jour}T${String(h).padStart(2, '0')}:00`);
  return out;
}

/**
 * Date du jour (AAAA-MM-JJ) dans le fuseau demandé, décalée de `delta` jours.
 * Les dates ne sont plus figées : le test restait valable jusqu'au 25/08/2026
 * puis cassait mécaniquement (constat de l'audit du 2026-09-03).
 */
function jourLocal(delta = 0) {
  const d = new Date(Date.now() + delta * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

test('l\'heure retenue est celle du fuseau demandé, pas celle du serveur', () => {
  const temps = [...horaires(jourLocal(0)), ...horaires(jourLocal(1))];
  // `indiceProche` retient l'heure la PLUS PROCHE : passé la demi-heure, c'est
  // l'heure suivante (à 30 min pile, l'égalité garde la première rencontrée).
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())) parts[type] = value;
  const heure = Number(parts.hour) % 24;
  const attendue = Number(parts.minute) > 30 ? (heure + 1) % 24 : heure;

  const i = indiceProche(temps, FUSEAU);
  assert.equal(Number(temps[i].slice(11, 13)), attendue);
});

test('une entrée illisible ne fait pas dérailler le choix', () => {
  const temps = ['pas une date', null, ...horaires('2026-08-24')];
  assert.doesNotThrow(() => indiceProche(temps, FUSEAU));
  assert.ok(indiceProche(temps, FUSEAU) >= 2);
});

test('sans fuseau, la fonction reste utilisable', () => {
  assert.equal(typeof indiceProche(horaires('2026-08-24')), 'number');
});

test('liste vide ou absente : index 0, jamais d\'exception', () => {
  assert.equal(indiceProche([], FUSEAU), 0);
  assert.equal(indiceProche(null, FUSEAU), 0);
});
