/**
 * La liste locale du client ne doit jamais dériver de celle du serveur.
 *
 * Le sélecteur de territoire s'affiche avant l'arrivée des données, à partir
 * d'une liste embarquée dans `public/js/app.js`. C'est ce qui garantit qu'un
 * lecteur voit tout de suite qu'il peut changer d'île — mais une liste figée
 * finirait par mentir si le serveur en ajoutait ou en retirait une. Ce test
 * échoue au premier écart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { territoiresEvalues } from '../src/territoires.js';

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

/** Extrait le tableau `TERRITOIRES_CONNUS` du script client. */
function listeDuClient() {
  const debut = source.indexOf('var TERRITOIRES_CONNUS = [');
  assert.notEqual(debut, -1, 'TERRITOIRES_CONNUS introuvable dans public/js/app.js');
  const fin = source.indexOf('];', debut);
  const bloc = source.slice(debut, fin);
  return [...bloc.matchAll(/cle:\s*'([^']+)'\s*,\s*nom:\s*'([^']*)'/g)]
    .map(([, cle, nom]) => ({ cle, nom }));
}

test('territoires — le client connaît exactement ceux que le serveur évalue', () => {
  const client = listeDuClient();
  const serveur = territoiresEvalues().map((t) => ({ cle: t.cle, nom: t.nom }));

  assert.deepEqual(
    client.map((t) => t.cle),
    serveur.map((t) => t.cle),
    'la liste locale du sélecteur ne correspond plus à celle du serveur',
  );
  assert.deepEqual(client, serveur, 'un nom de territoire diffère entre le client et le serveur');
});

test('territoires — les neuf territoires annoncés sont couverts', () => {
  const attendus = [
    'guadeloupe', 'saint-martin', 'saint-barthelemy', 'martinique', 'dominique',
    'sainte-lucie', 'barbade', 'antigua', 'trinite-tobago',
  ];
  const cles = territoiresEvalues().map((t) => t.cle);
  attendus.forEach((cle) => assert.ok(cles.includes(cle), `territoire manquant : ${cle}`));
});
