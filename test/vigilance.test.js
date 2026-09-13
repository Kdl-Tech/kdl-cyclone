import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyserFluxOutreMer,
  construireSecoursVigilance,
  marquerVigilancesPerimees,
  vigilanceDepuisJson,
  ZONES,
} from '../src/sources/meteofrance.js';

const zone = ZONES.guadeloupe;
function vigilance(couleur, cyclone, autres = []) {
  return vigilanceDepuisJson({ timelaps: { domain_ids: [{
    domain_id: zone.principal, max_color_id: couleur,
    phenomenon_items: [
      { phenomenon_id: 10, phenomenon_max_color_id: cyclone },
      ...autres.map(([id, niveau]) => ({ phenomenon_id: id, phenomenon_max_color_id: niveau })),
    ],
  }] } }, zone);
}

for (const [id, niveau] of [[1, 'vert'], [2, 'jaune'], [3, 'orange'], [4, 'rouge'], [5, 'violet'], [6, 'gris']]) {
  test('vigilance : conserve la couleur officielle ' + niveau, () => {
    const v = vigilance(id, id);
    assert.equal(v.niveau, niveau);
    assert.equal(v.phenomenes[0].niveau, niveau);
  });
}
test('un cyclone violet ne disparaît pas derrière un domaine vert', () => {
  const v = vigilance(1, 5, [[1, 1]]);
  assert.equal(v.niveau, 'violet');
  assert.ok(v.phenomenesActifs.includes('Cyclone'));
});
test('le gris est une phase après cyclone, sans rang de gravité numérique', () => {
  const v = vigilance(6, 6);
  assert.equal(v.niveau, 'gris');
  assert.equal(v.niveauRang, null);
  assert.equal(v.phase, 'post-cyclone');
  assert.ok(v.phenomenesActifs.includes('Cyclone'));
});
test('un cyclone gris ne disparaît pas derrière un domaine vert', () => {
  assert.equal(vigilance(1, 6, [[1, 1]]).niveau, 'gris');
});
test('une alerte rouge reste visible pendant la phase grise du cyclone', () => {
  const v = vigilance(6, 6, [[1, 4]]);
  assert.equal(v.niveau, 'rouge');
  assert.equal(v.phenomenes.find(p => p.nom === 'Cyclone').niveau, 'gris');
});
for (const valeur of [99, null, undefined, '', ' ', false]) {
  test('un niveau non interprétable ne devient jamais vert : ' + String(valeur), () => {
    const v = vigilance(1, valeur, [[1, 1]]);
    assert.equal(v.niveau, 'inconnu');
    assert.equal(v.incomplete, true);
    assert.equal(v.phenomenes.find(p => p.nom === 'Cyclone').niveau, 'inconnu');
  });
}
test('un domaine inconnu ne devient pas vert à partir des autres phénomènes', () => {
  assert.equal(vigilance(99, 1).niveau, 'inconnu');
});
test('une alerte connue reste visible si un autre phénomène est inconnu', () => {
  const v = vigilance(4, 99, [[1, 4]]);
  assert.equal(v.niveau, 'rouge');
  assert.equal(v.incomplete, true);
});
test('les codes explicitement non évalués ne sont pas assimilés au vert', () => {
  assert.equal(vigilance(0, -1), null);
});
test('les identifiants numériques sous forme de texte sont acceptés', () => {
  assert.equal(vigilance('5', '5').niveau, 'violet');
});
test('une sous-zone ne remplace pas la zone principale', () => {
  const v = vigilanceDepuisJson({ timelaps: { domain_ids: [
    { domain_id: 'VIGI971-51', max_color_id: 5 },
    { domain_id: zone.principal, max_color_id: 2 },
  ] } }, zone);
  assert.equal(v.niveau, 'jaune');
});

test('chaque vigilance conserve sa propre heure d’émission', () => {
  const emisLe = '2026-09-13T00:30:00Z';
  const document = {
    update_time: emisLe,
    timelaps: { domain_ids: [{
      domain_id: zone.principal,
      max_color_id: 2,
      phenomenon_items: [{ phenomenon_id: 10, phenomenon_max_color_id: 2 }],
    }] },
  };
  const analyse = analyserFluxOutreMer(new Map([
    ['vigilance.txt', Buffer.from(JSON.stringify(document))],
  ]), zone);
  assert.equal(analyse.vigilance.emisLe, emisLe);
});

test('une panne marque chaque territoire conservé comme périmé', () => {
  const verifieLe = '2026-09-13T00:40:00Z';
  const parTerritoire = marquerVigilancesPerimees({
    guadeloupe: { niveau: 'orange', emisLe: '2026-09-13T00:00:00Z' },
    martinique: { niveau: 'vert', emisLe: '2026-09-12T23:50:00Z' },
  }, verifieLe);
  assert.equal(parTerritoire.guadeloupe.perime, true);
  assert.equal(parTerritoire.martinique.perime, true);
  assert.equal(parTerritoire.guadeloupe.verifieLe, verifieLe);
  assert.equal(parTerritoire.guadeloupe.emisLe, '2026-09-13T00:00:00Z');
});

test('une archive illisible conserve la dernière vigilance avec son motif', () => {
  const secours = construireSecoursVigilance({
    valeur: {
      parTerritoire: { guadeloupe: { niveau: 'orange', emisLe: '2026-09-13T00:00:00Z' } },
      emisLe: '2026-09-13T00:00:00Z',
    },
    recuLe: Date.parse('2026-09-13T00:01:00Z'),
  }, 'archive illisible', { recuLe: '2026-09-13T00:55:00Z' });
  assert.equal(secours.disponible, true);
  assert.equal(secours.inchange, true);
  assert.equal(secours.motif, 'archive illisible');
  assert.equal(secours.parTerritoire.guadeloupe.niveau, 'orange');
  assert.equal(secours.parTerritoire.guadeloupe.perime, true);
});
