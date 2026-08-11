/**
 * Fabrique la liste des communes et lieux couverts par la météo locale.
 *
 * Deux sources, choisies selon le territoire :
 *
 *   1. **geo.api.gouv.fr** pour la Guadeloupe et la Martinique — le découpage
 *      administratif officiel de l'État. Gratuit, sans clé, exhaustif : les 32
 *      communes de Guadeloupe et les 34 de Martinique, ni une de plus, ni une
 *      de moins, avec leur centre géographique et leur population légale.
 *
 *   2. **Open-Meteo / GeoNames** pour les îles indépendantes et les quartiers
 *      des collectivités du Nord, que l'API française ne découpe pas.
 *
 * Pourquoi deux sources : GeoNames enregistre certains chefs-lieux sous le nom
 * de leur quartier. Une recherche de « Bouillante » y renvoie « Village », et
 * « Schoelcher » renvoie « Case Navire » — des noms de lieux-dits qui ne
 * correspondent à aucune commune. La première version de ce script prenait le
 * résultat le plus peuplé sans vérifier le nom : l'application proposait donc
 * une commune « Village » qui n'existe pas, et il manquait Bouillante.
 *
 * D'où la règle qui gouverne désormais tout ce fichier : **un résultat dont le
 * nom ne correspond pas à ce qui était demandé est rejeté**, et l'absence est
 * signalée en fin d'exécution plutôt que comblée par un à-peu-près. Pour une
 * application météo, une commune inventée est pire qu'une commune manquante.
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

const GEO_FR = 'https://geo.api.gouv.fr/communes';
const GEO_MONDE = 'https://geocoding-api.open-meteo.com/v1/search';

/** Territoires français : le département suffit, l'État fournit la liste. */
const DEPARTEMENTS = [
  { territoire: 'guadeloupe', departement: '971', attendu: 32 },
  { territoire: 'martinique', departement: '972', attendu: 34 },
];

/**
 * Le reste du monde, nom par nom.
 *
 * `pays` est le code ISO attendu : il écarte l'homonyme d'un autre pays —
 * « Marigot » existe en Dominique comme à Saint-Martin, « Saint-Pierre » dans
 * plusieurs îles.
 */
const RECHERCHES = [
  { territoire: 'saint-martin', pays: 'MF', noms: [
    'Marigot', 'Grand-Case', 'Terres Basses', 'Quartier d\'Orléans',
  ] },
  { territoire: 'saint-barthelemy', pays: 'BL', noms: [
    'Gustavia', 'Corossol', 'Saint-Jean', 'Lorient',
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
    'Saint John\'s', 'All Saints', 'Liberta', 'Codrington', 'English Harbour',
  ] },
  // La capitale de Trinité est enregistrée sous son nom français : la chercher
  // en anglais donne un résultat que le contrôle de nom rejette, à juste titre.
  { territoire: 'trinite-tobago', pays: 'TT', noms: [
    'Port-d\'Espagne', 'San Fernando', 'Chaguanas', 'Arima', 'Scarborough',
    'Point Fortin',
  ] },
];

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Forme comparable d'un nom de lieu : sans accents, sans articles, sans
 * ponctuation. « Le Moule » et « Moule » doivent se reconnaître, « Schœlcher »
 * et « Schoelcher » aussi.
 */
function aplati(nom) {
  return String(nom || '')
    .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(le|la|les|l')\s*/, '')
    .replace(/[''`-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le nom rendu par le service est-il bien celui qu'on cherchait ? */
function correspond(demande, rendu) {
  const a = aplati(demande);
  const b = aplati(rendu);
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

function slug(nom) {
  return String(nom)
    .replace(/œ/gi, 'oe')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[''\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** Communes d'un département français, d'après le découpage officiel. */
async function communesFrancaises(departement) {
  const url = `${GEO_FR}?codeDepartement=${departement}&fields=nom,centre,population&format=json`;
  const reponse = await fetch(url, { headers: { 'User-Agent': 'KDL-Cyclone/build-communes' } });
  if (!reponse.ok) throw new Error(`geo.api.gouv.fr ${reponse.status} pour ${departement}`);
  const donnees = await reponse.json();
  return donnees
    .filter((c) => c.centre && Array.isArray(c.centre.coordinates))
    .map((c) => ({
      cle: slug(c.nom),
      nom: c.nom,
      lat: Math.round(c.centre.coordinates[1] * 10000) / 10000,
      lon: Math.round(c.centre.coordinates[0] * 10000) / 10000,
      altitude: null,
      population: c.population ?? null,
    }));
}

/** Un lieu du reste du monde, refusé si le nom rendu ne correspond pas. */
async function lieuMondial(nom, pays) {
  const url = `${GEO_MONDE}?name=${encodeURIComponent(nom)}&count=10&language=fr&format=json`;
  const reponse = await fetch(url, { headers: { 'User-Agent': 'KDL-Cyclone/build-communes' } });
  if (!reponse.ok) throw new Error(`géocodage ${reponse.status} pour ${nom}`);
  const donnees = await reponse.json();
  const dansLePays = (donnees.results || []).filter((r) => r.country_code === pays);

  // Le contrôle qui manquait : on n'accepte que ce qui porte bien le nom
  // demandé. Un lieu-dit renvoyé à la place du chef-lieu est écarté.
  const valides = dansLePays.filter((r) => correspond(nom, r.name));
  if (!valides.length) {
    const vus = dansLePays.map((r) => r.name).join(', ');
    return { erreur: vus ? `nom non concordant (reçu : ${vus})` : 'aucun résultat' };
  }

  valides.sort((a, b) => (b.population || 0) - (a.population || 0));
  const r = valides[0];
  return {
    lieu: {
      cle: slug(r.name),
      nom: r.name,
      lat: Math.round(r.latitude * 10000) / 10000,
      lon: Math.round(r.longitude * 10000) / 10000,
      altitude: r.elevation ?? null,
      population: r.population ?? null,
    },
  };
}

const communes = {};
const manquants = [];
let trouves = 0;

for (const bloc of DEPARTEMENTS) {
  const liste = await communesFrancaises(bloc.departement);
  liste.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  communes[bloc.territoire] = liste;
  trouves += liste.length;
  const compte = liste.length === bloc.attendu ? '' : `  ⚠ attendu ${bloc.attendu}`;
  console.log(`  ${bloc.territoire.padEnd(18)} ${liste.length} communes (source officielle)${compte}`);
}

for (const bloc of RECHERCHES) {
  communes[bloc.territoire] = [];
  for (const nom of bloc.noms) {
    try {
      const { lieu, erreur } = await lieuMondial(nom, bloc.pays);
      if (lieu) { communes[bloc.territoire].push(lieu); trouves += 1; }
      else manquants.push(`${nom} (${bloc.pays}) — ${erreur}`);
    } catch (e) {
      manquants.push(`${nom} (${bloc.pays}) — ${e.message}`);
    }
    await attendre(350);            // service gratuit et sans clé : on y va doucement
  }
  communes[bloc.territoire].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  console.log(`  ${bloc.territoire.padEnd(18)} ${communes[bloc.territoire].length} lieux`);
}

const fichier = `/**
 * Communes et lieux couverts par la météo locale.
 *
 * Fichier produit par \`scripts/build-communes.mjs\`. Les territoires français
 * viennent du découpage administratif officiel (geo.api.gouv.fr), les autres du
 * géocodage Open-Meteo (données GeoNames), avec contrôle du nom rendu.
 *
 * Ne pas modifier à la main : une coordonnée saisie de travers donnerait un
 * bulletin qui ne correspond à rien.
 *
 * Produit le ${new Date().toISOString().slice(0, 10)} — ${trouves} lieux.
 */

export const COMMUNES = ${JSON.stringify(communes, null, 2)};

/** Tous les lieux d'un territoire, par ordre alphabétique. */
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
  console.log(`\n${manquants.length} écartés — aucun n'a été remplacé par un à-peu-près :`);
  manquants.forEach((m) => console.log('  ·', m));
}
