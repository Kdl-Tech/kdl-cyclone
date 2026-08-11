/**
 * Tests de la fraîcheur et de la détection de changements.
 * Aucun réseau, aucune écriture disque : seules les fonctions pures sont visées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fraicheur, formaterAge, detecterChangements, detecterDisparitions, ETATS } from '../src/journal.js';

const ilYA = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

// ----------------------------------------------------------------- fraîcheur

test('fraîcheur — un bulletin récent est à jour', () => {
  const f = fraicheur(ilYA(5), ilYA(2));
  assert.equal(f.etat, ETATS.A_JOUR);
  assert.equal(f.libelle, 'À jour');
  assert.ok(f.ageMinutes <= 6);
});

test('fraîcheur — au-delà de la cadence normale, actualisation en attente', () => {
  const f = fraicheur(ilYA(90), ilYA(1));
  assert.equal(f.etat, ETATS.EN_ATTENTE);
  assert.match(f.message, /se fait attendre/);
});

test('fraîcheur — au-delà du seuil, données anciennes et avertissement explicite', () => {
  const f = fraicheur(ilYA(400), ilYA(1));
  assert.equal(f.etat, ETATS.ANCIENNE);
  assert.match(f.message, /n'est plus d'actualité/);
  assert.match(f.message, /NHC/);
  assert.match(f.message, /Météo-France/);
});

test('fraîcheur — sans aucune heure, la donnée est déclarée non datable', () => {
  const f = fraicheur(null, null);
  assert.equal(f.etat, ETATS.ANCIENNE);
  assert.equal(f.ageMinutes, null);
  assert.match(f.message, /ne peut pas être datée/);
});

test('fraîcheur — seuils personnalisés respectés', () => {
  const strict = fraicheur(ilYA(20), ilYA(1), { attenduMin: 10, ancienMin: 15 });
  assert.equal(strict.etat, ETATS.ANCIENNE);
  const large = fraicheur(ilYA(20), ilYA(1), { attenduMin: 60, ancienMin: 180 });
  assert.equal(large.etat, ETATS.A_JOUR);
});

test('fraîcheur — l\'heure d\'émission prime sur l\'heure de réception', () => {
  // Un bulletin vieux de 5 h reçu à l'instant reste un bulletin vieux de 5 h.
  const f = fraicheur(ilYA(300), ilYA(0));
  assert.equal(f.etat, ETATS.ANCIENNE);
});

test('formaterAge — français correct au singulier et au pluriel', () => {
  assert.equal(formaterAge(0), "moins d'une minute");
  assert.equal(formaterAge(1), '1 minute');
  assert.equal(formaterAge(40), '40 minutes');
  assert.equal(formaterAge(60), '1 heure');
  assert.equal(formaterAge(180), '3 heures');
  assert.equal(formaterAge(2880), '2 jours');
});

// -------------------------------------------------------------- changements

const BASE = {
  id: 'nhc-two-1',
  designation: 'Zone surveillée 1',
  nom: null,
  statut: 'Zone surveillée par le NHC',
  statutCode: 'zone',
  prob48h: 10,
  prob7j: 30,
  distanceGuadeloupeKm: 3000,
  mouvement: { bearingDeg: 280, speedKmh: 25, directionFr: 'ouest' },
  menace: { niveau: 'aucun', niveauLabel: 'Aucun' },
};

test('changements — un système inconnu est signalé comme apparition', () => {
  const e = detecterChangements(null, BASE);
  assert.equal(e.length, 1);
  assert.equal(e[0].type, 'apparition');
  assert.equal(e[0].importance, 'majeur');
});

test('changements — aucune différence ne produit aucun événement', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  assert.deepEqual(detecterChangements(avant, BASE), []);
});

test('changements — hausse de probabilité à 7 jours détectée et datée', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, prob7j: 70 });
  const p = e.find((x) => x.champ === 'prob7j');
  assert.equal(p.type, 'probabilite_hausse');
  assert.equal(p.importance, 'majeur'); // écart de 40 points
  assert.match(p.texte, /relevé de 30 à 70 %/);
});

test('changements — une baisse modeste reste de gravité normale', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, prob7j: 20 });
  const p = e.find((x) => x.champ === 'prob7j');
  assert.equal(p.type, 'probabilite_baisse');
  assert.equal(p.importance, 'normal');
});

test('changements — passage en dépression tropicale', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, {
    ...BASE, statut: 'Dépression tropicale', statutCode: 'depression',
  });
  const c = e.find((x) => x.type === 'categorie');
  assert.equal(c.importance, 'majeur');
  assert.match(c.texte, /Dépression tropicale/);
});

test('changements — attribution d\'un nom', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, nom: 'Fiona' });
  const n = e.find((x) => x.type === 'nommage');
  assert.match(n.texte, /Fiona/);
});

test('changements — attribution d\'un numéro Invest', () => {
  const avant = { ...BASE, identifiantNhc: null, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, identifiantNhc: 'al95l' });
  const i = e.find((x) => x.type === 'invest');
  assert.match(i.texte, /95L/);
});

test('changements — un déplacement sous le seuil de bruit est ignoré', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, distanceGuadeloupeKm: 2950 });
  assert.equal(e.filter((x) => x.type === 'rapprochement').length, 0);
});

test('changements — un rapprochement net est signalé', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, distanceGuadeloupeKm: 1200 });
  const r = e.find((x) => x.type === 'rapprochement');
  assert.equal(r.importance, 'majeur');
  // `toLocaleString('fr-FR')` sépare les milliers par une espace insécable :
  // l'assertion doit l'accepter, sinon elle échoue sur un détail typographique.
  assert.match(r.texte, /1\s200\s?km/u);
});

test('changements — une inflexion de trajectoire est détectée', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, {
    ...BASE, mouvement: { bearingDeg: 330, speedKmh: 25, directionFr: 'nord-nord-ouest' },
  });
  assert.ok(e.some((x) => x.type === 'trajectoire'));
});

test('changements — élévation du niveau de menace', () => {
  const avant = { ...BASE, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, {
    ...BASE, menace: { niveau: 'preparation', niveauLabel: 'Préparation conseillée' },
  });
  const m = e.find((x) => x.type === 'menace');
  assert.equal(m.importance, 'majeur');
});

test('disparitions — un système absent du nouveau bulletin est signalé', () => {
  const d = detecterDisparitions(['nhc-two-1', 'nhc-two-2'], [{ id: 'nhc-two-2' }]);
  assert.equal(d.length, 1);
  assert.equal(d[0].id, 'nhc-two-1');
  assert.equal(d[0].type, 'disparition');
});

test('disparitions — aucun faux positif quand tout est présent', () => {
  assert.deepEqual(detecterDisparitions(['a'], [{ id: 'a' }]), []);
});

test('changements — aucune valeur manquante n\'est remplacée par zéro', () => {
  const avant = { ...BASE, prob7j: null, menaceNiveau: 'aucun' };
  const e = detecterChangements(avant, { ...BASE, prob7j: 40 });
  // Sans valeur de départ, on ne peut pas parler de hausse : rien n'est inventé.
  assert.equal(e.filter((x) => x.champ === 'prob7j').length, 0);
});

// --------------------------------------- prudence quand la route est inconnue

test('menace — un système à forte probabilité sans trajectoire connue n\'est jamais « aucun »', async () => {
  const { evaluateThreat } = await import('../src/engine/threat.js');
  // Cas réel du 2026-08-09 : zone donnée à 50 % par le NHC, en plein Atlantique
  // tropical, déplacement pas encore mesurable. Elle était classée « Aucun ».
  const r = evaluateThreat({
    position: { lat: 10.3, lon: -24.1 },
    mouvement: null,
    probNhc7d: 50,
    potentielKdl: 70,
    statut: 'Zone surveillée par le NHC',
  });
  assert.notEqual(r.niveau, 'aucun', 'une zone à 50 % ne doit pas être déclarée sans menace');
  assert.equal(r.niveau, 'surveillance');
  assert.equal(r.fondement, 'prudence_sans_trajectoire');
  assert.match(r.message, /50 %/);
  assert.match(r.message, /vers l'ouest/);
});

test('menace — probabilité modérée sans trajectoire : mise en veille', async () => {
  const { evaluateThreat } = await import('../src/engine/threat.js');
  const r = evaluateThreat({
    position: { lat: 12, lon: -38 }, mouvement: null, probNhc7d: 20, potentielKdl: 63,
  });
  assert.equal(r.niveau, 'veille');
});

test('menace — un système à l\'ouest de la cible n\'est pas en amont', async () => {
  const { evaluateThreat } = await import('../src/engine/threat.js');
  // Au large du Mexique : il s'éloigne, la prudence ne s'applique pas.
  const r = evaluateThreat({
    position: { lat: 15, lon: -95 }, mouvement: null, probNhc7d: 60,
  });
  assert.equal(r.niveau, 'aucun');
});

test('menace — le plancher ne peut jamais abaisser un niveau calculé', async () => {
  const { evaluateThreat } = await import('../src/engine/threat.js');
  const r = evaluateThreat({
    position: { lat: 15.6, lon: -57.5 },
    mouvement: { bearingDeg: 290, speedKmh: 26 },
    intensiteKmh: 165, probNhc7d: 100, potentielKdl: 85,
  });
  assert.ok(['preparation', 'imminent'].includes(r.niveau));
  assert.equal(r.fondement, 'corridor_calcule');
});

// ------------------------------------- heure réelle d'émission d'un bulletin

test('émission WMO — l\'en-tête du bulletin prime sur le pubDate du flux', async () => {
  const { emissionWmo } = await import('../src/sources/nhc.js');
  // Cas réel : le flux RSS annonçait 03:21 alors que le bulletin datait de 23:36.
  const r = emissionWmo('000\nABNT20 KNHC 092336\nTWOAT', new Date('2026-08-10T03:30:00Z'));
  assert.equal(r, '2026-08-09T23:36:00.000Z');
});

test('émission WMO — bulletin de fin de mois lu le mois suivant', async () => {
  const { emissionWmo } = await import('../src/sources/nhc.js');
  assert.equal(
    emissionWmo('ABNT20 KNHC 312336', new Date('2026-09-01T02:00:00Z')),
    '2026-08-31T23:36:00.000Z',
  );
});

test('émission WMO — un jour inexistant dans le mois ne déborde pas', async () => {
  const { emissionWmo } = await import('../src/sources/nhc.js');
  // Le 31 n'existe pas en septembre : la date doit tomber sur le 31 août.
  const r = emissionWmo('ABNT20 KNHC 312336', new Date('2026-09-15T02:00:00Z'));
  assert.ok(r.startsWith('2026-08-31'), `obtenu ${r}`);
});

test('émission WMO — en-tête absent ou aberrant', async () => {
  const { emissionWmo } = await import('../src/sources/nhc.js');
  assert.equal(emissionWmo('pas de bulletin ici'), null);
  assert.equal(emissionWmo('ABNT20 KNHC 992599'), null);
});

test('fraîcheur — un bulletin de 4 h reste normal au rythme du NHC', async () => {
  const { fraicheur, ETATS } = await import('../src/journal.js');
  // Le Tropical Weather Outlook paraît toutes les 6 h : 4 h n'est pas un retard.
  const f = fraicheur(
    new Date(Date.now() - 240 * 60000).toISOString(),
    new Date().toISOString(),
    { attenduMin: 400, ancienMin: 800 },
  );
  assert.equal(f.etat, ETATS.A_JOUR, 'ne doit pas annoncer un retard imaginaire');
});

test('fraîcheur — au-delà de deux cycles manqués, le retard est réel', async () => {
  const { fraicheur, ETATS } = await import('../src/journal.js');
  const f = fraicheur(
    new Date(Date.now() - 900 * 60000).toISOString(),
    new Date().toISOString(),
    { attenduMin: 400, ancienMin: 800 },
  );
  assert.equal(f.etat, ETATS.ANCIENNE);
});
