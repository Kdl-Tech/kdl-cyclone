/**
 * Fabrique la liste des communes et lieux couverts par la météo locale.
 *
 * Les coordonnées ne sont pas écrites à la main : elles viennent du service de
 * géocodage d'Open-Meteo, qui s'appuie sur GeoNames. Inventer une latitude
 * serait la pire des erreurs pour une application météo — on afficherait un
 * bulletin qui ne correspond à rien.
 *
 * Le résultat est un fichier statique, `src/communes.js` : à l'exécution,
 * l'application n'interroge aucun service de géocodage.
 *
 *   node scripts/build-communes.mjs
 *
 * Relancer uniquement si la liste des territoires change.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const BASE = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * Ce qu'on cherche, territoire par territoire.
 *
 * `pays` est le code ISO attendu : il évite de ramener la commune homonyme
 * d'un autre pays — « Les Abymes » existe aussi en Martinique, « Saint-Pierre »
 * dans plusieurs îles.
 */
const RECHERCHES = [
  { territoire: 'guadeloupe', pays: 'GP', noms: [
    'Les Abymes', 'Pointe-à-Pitre', 'Baie-Mahault', 'Le Gosier', 'Petit-Bourg',
    'Sainte-Anne', 'Le Moule', 'Saint-François', 'Basse-Terre', 'Gourbeyre',
    'Trois-Rivières', 'Capesterre-Belle-Eau', 'Bouillante', 'Deshaies',
    'Sainte-Rose', 'Lamentin', 'Morne-à-l\'Eau', 'Port-Louis', 'Anse-Bertrand',
    'Petit-Canal', 'Saint-Claude', 'Vieux-Habitants', 'Pointe-Noire',
    'Baillif', 'Vieux-Fort', 'Goyave', 'Saint-Louis', 'Grand-Bourg',
    'Capesterre-de-Marie-Galante', 'Terre-de-Haut', 'Terre-de-Bas', 'La Désirade',
  ] },
  { territoire: 'martinique', pays: 'MQ', noms: [
    'Fort-de-France', 'Le Lamentin', 'Le Robert', 'Sainte-Marie', 'Le François',
    'Schoelcher', 'Ducos', 'Saint-Joseph', 'La Trinité', 'Rivière-Pilote',
    'Le Marin', 'Sainte-Anne', 'Sainte-Luce', 'Les Trois-Îlets', 'Le Diamant',
    'Saint-Pierre', 'Le Carbet', 'Le Prêcheur', 'Grand-Rivière', 'Le Lorrain',
    'Basse-Pointe', 'Le Vauclin', 'Le Morne-Rouge', 'Les Anses-d\'Arlet',
  ] },
  { territoire: 'saint-martin', pays: 'MF', noms: [
    'Marigot', 'Grand-Case', 'Quartier d\'Orléans', 'Terres Basses',
  ] },
  { territoire: 'saint-barthelemy', pays: 'BL', noms: [
    'Gustavia', 'Saint-Jean', 'Lorient', 'Corossol',
  ] },
  { territoire: 'dominique', pays: 'DM', noms: [
    'Roseau', 'Portsmouth', 'Marigot', 'Berekua', 'Saint Joseph', 'Castle Bruce',
  ] },
  { territoire: 'sainte-lucie', pays: 'LC', noms: [
    'Castries', 'Vieux Fort', 'Soufrière', 'Gros Islet', 'Micoud', 'Dennery',
  ] },
  { territoire: 'barbade', pays: 'BB', noms: [
    'Bridgetown', 'Speightstown', 'Oistins', 'Holetown', 'Bathsheba',
  ] },
  { territoire: 'antigua', pays: 'AG', noms: [
    "Saint John's", 'All Saints', 'Liberta', 'Codrington', 'English Harbour',
  ] },
  { territoire: 'trinite-tobago', pays: 'TT', noms: [
    'Port of Spain', 'San Fernando', 'Chaguanas', 'Arima', 'Scarborough',
    'Point Fortin',
  ] },
];

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function chercher(nom, pays) {
  const url = `${BASE}?name=${encodeURIComponent(nom)}&count=10&language=fr&format=json`;
  const reponse = await fetch(url, { headers: { 'User-Agent': 'KDL-Cyclone/build-communes' } });
  if (!reponse.ok) throw new Error(`géocodage ${reponse.status} pour ${nom}`);
  const donnees = await reponse.json();
  const candidats = (donnees.results || []).filter((r) => r.country_code === pays);
  if (!candidats.length) return null;
  // Le plus peuplé d'abord : entre deux homonymes du même pays, c'est celui
  // que l'utilisateur avait en tête.
  candidats.sort((a, b) => (b.population || 0) - (a.population || 0));
  const r = candidats[0];
  return {
    nom: r.name,
    lat: Math.round(r.latitude * 10000) / 10000,
    lon: Math.round(r.longitude * 10000) / 10000,
    altitude: r.elevation ?? null,
    population: r.population ?? null,
  };
}

function slug(nom) {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const communes = {};
let trouves = 0;
let manquants = [];

for (const bloc of RECHERCHES) {
  communes[bloc.territoire] = [];
  for (const nom of bloc.noms) {
    try {
      const lieu = await chercher(nom, bloc.pays);
      if (!lieu) {
        manquants.push(`${nom} (${bloc.pays})`);
      } else {
        communes[bloc.territoire].push({ cle: slug(nom), ...lieu });
        trouves += 1;
      }
    } catch (erreur) {
      manquants.push(`${nom} (${bloc.pays}) — ${erreur.message}`);
    }
    // Le service est gratuit et sans clé : on ne le brusque pas.
    await attendre(350);
  }
  communes[bloc.territoire].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  console.log(`  ${bloc.territoire.padEnd(18)} ${communes[bloc.territoire].length} lieux`);
}

const fichier = `/**
 * Communes et lieux couverts par la météo locale.
 *
 * Fichier produit par \`scripts/build-communes.mjs\` à partir du service de
 * géocodage d'Open-Meteo (données GeoNames). Ne pas modifier à la main : une
 * coordonnée saisie de travers donnerait un bulletin qui ne correspond à rien.
 *
 * Produit le ${new Date().toISOString().slice(0, 10)} — ${trouves} lieux.
 */

export const COMMUNES = ${JSON.stringify(communes, null, 2)};

/** Tous les lieux d'un territoire, le chef-lieu en premier. */
export function communesDe(territoire) {
  return COMMUNES[territoire] || [];
}

/** Retrouve un lieu par sa clé, dans un territoire donné. */
export function communePar(territoire, cle) {
  return communesDe(territoire).find((c) => c.cle === cle) || null;
}
`;

await fs.writeFile(path.join(ROOT, 'src', 'communes.js'), fichier);
console.log(`\n${trouves} lieux écrits dans src/communes.js`);
if (manquants.length) {
  console.log(`\n${manquants.length} introuvables — à vérifier :`);
  manquants.forEach((m) => console.log('  ·', m));
}
