import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const debut = source.indexOf('  function rendreBandeauVigilance()');
const fin = source.indexOf('  function rendreBandeauConnexion()', debut);
assert.ok(debut >= 0 && fin > debut);
const fonction = source.slice(debut, fin);

function rendre(vig, cle = 'guadeloupe') {
  const zone = { className: '', innerHTML: '' };
  const contexte = {
    $: () => zone,
    territoireActif: () => ({ cle, nom: cle, vigilanceOfficielle: vig }),
    cleTerritoire: () => cle,
    ICONES: { alerte: '<svg ></svg>', bouclier: '<svg ></svg>', externe: '' },
    echapper: s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    heureLocale: () => '12:00', horsLigne: false, ageDonnees: () => 0,
  };
  vm.runInNewContext(fonction + '\nrendreBandeauVigilance();', contexte);
  return zone;
}
const vigilance = (niveau, extra = {}) => ({
  niveau, niveauLibelle: niveau, zone: 'Guadeloupe', emisLe: '2026-09-12T16:00:00Z',
  phenomenes: [{ nom: 'Cyclone', niveau }], ...extra,
});

test('le bandeau violet affiche le confinement en toutes lettres', () => {
  const zone = rendre(vigilance('violet'));
  assert.match(zone.className, /vigi--violet/);
  assert.match(zone.innerHTML, /confinement/i);
});
test('le bandeau gris explique les dangers subsistants', () => {
  const zone = rendre(vigilance('gris'));
  assert.match(zone.className, /vigi--gris/);
  assert.match(zone.innerHTML, /dangers subsistants/i);
  assert.doesNotMatch(zone.innerHTML, /Aucune vigilance/);
});
test('un niveau inconnu affiche une indisponibilité explicite', () => {
  const zone = rendre(vigilance('inconnu', { incomplete: true }));
  assert.match(zone.innerHTML, /indisponible/i);
  assert.doesNotMatch(zone.innerHTML, /Aucune vigilance|aucun phénomène dangereux/);
});
test('une vigilance absente reste visible sur un territoire français', () => {
  const zone = rendre(null);
  assert.doesNotMatch(zone.className, /est-cache/);
  assert.match(zone.innerHTML, /indisponible/i);
  assert.match(zone.innerHTML, /Météo-France/);
});
test('pas de vigilance française sur un territoire hors couverture', () => {
  const zone = rendre(null, 'dominique');
  assert.match(zone.className, /est-cache/);
  assert.equal(zone.innerHTML, '');
});
test('une vigilance verte périmée ne décrit pas la situation actuelle', () => {
  const zone = rendre(vigilance('vert', { perime: true }));
  assert.match(zone.innerHTML, /dernière vigilance connue/i);
  assert.doesNotMatch(zone.innerHTML, /Aucune vigilance en cours|à cette heure/);
});
test('une alerte connue signale aussi les informations incomplètes', () => {
  const zone = rendre(vigilance('rouge', { incomplete: true }));
  assert.match(zone.innerHTML, /Vigilance rouge/);
  assert.match(zone.innerHTML, /incomplète/i);
});
