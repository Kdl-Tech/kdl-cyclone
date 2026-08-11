/**
 * Territoires suivis — l'arc antillais.
 *
 * Chaque territoire porte ses propres autorités. C'est le point le plus
 * important de ce fichier : renvoyer un habitant de Sainte-Lucie vers la
 * préfecture de Guadeloupe un jour d'alerte serait une faute grave. Météo-France
 * ne couvre que les territoires français ; les autres États ont leurs propres
 * services météorologiques et leurs propres agences de gestion de crise.
 *
 * Tous les liens ci-dessous ont été vérifiés le 2026-08-09 : seuls ceux qui
 * répondaient ont été retenus. Un lien mort vaut moins que pas de lien.
 */

/**
 * `article` et `articleDe` évitent les tournures fautives : « pour Martinique »
 * au lieu de « pour la Martinique », « de Guadeloupe » au lieu de « de la
 * Guadeloupe ». Le français ne se devine pas depuis un nom propre.
 *
 * @typedef {object} Territoire
 * @property {string} cle        identifiant stable, utilisé dans les URL
 * @property {string} nom        nom affiché
 * @property {number} lat
 * @property {number} lon
 * @property {string} fuseau     fuseau IANA
 * @property {string} pays
 * @property {boolean} [francais] soumis à la vigilance Météo-France
 * @property {Array}  liens      autorités officielles, vérifiées
 * @property {string} [rattache] territoire dont il partage les autorités
 */

const MF_GUADELOUPE = [
  { libelle: 'Vigilance Météo-France Guadeloupe', url: 'https://vigilance.meteofrance.fr/fr/guadeloupe', type: 'meteo' },
  { libelle: 'Météo-France Guadeloupe', url: 'https://meteofrance.gp/fr/vigilance', type: 'meteo' },
  { libelle: 'Préfecture de la Guadeloupe', url: 'https://www.guadeloupe.gouv.fr/', type: 'autorite' },
];

export const TERRITOIRES = [
  {
    cle: 'guadeloupe',
    article: 'la ',
    articleDe: 'de la ',
    nom: 'Guadeloupe',
    nomLong: 'Guadeloupe (Basse-Terre et Grande-Terre)',
    lat: 16.25,
    lon: -61.55,
    fuseau: 'America/Guadeloupe',
    pays: 'France',
    francais: true,
    principal: true,
    liens: MF_GUADELOUPE,
  },
  {
    cle: 'marie-galante',
    article: '',
    articleDe: 'de ',
    nom: 'Marie-Galante',
    lat: 15.94,
    lon: -61.28,
    fuseau: 'America/Guadeloupe',
    pays: 'France',
    francais: true,
    rattache: 'guadeloupe',
    liens: MF_GUADELOUPE,
  },
  {
    cle: 'les-saintes',
    article: 'les ',
    articleDe: 'des ',
    nom: 'Saintes',
    nomLong: 'Les Saintes',
    lat: 15.87,
    lon: -61.58,
    fuseau: 'America/Guadeloupe',
    pays: 'France',
    francais: true,
    rattache: 'guadeloupe',
    liens: MF_GUADELOUPE,
  },
  {
    cle: 'la-desirade',
    article: 'la ',
    articleDe: 'de la ',
    nom: 'Désirade',
    lat: 16.32,
    lon: -61.03,
    fuseau: 'America/Guadeloupe',
    pays: 'France',
    francais: true,
    rattache: 'guadeloupe',
    liens: MF_GUADELOUPE,
  },
  {
    cle: 'saint-martin',
    article: '',
    articleDe: 'de ',
    nom: 'Saint-Martin',
    lat: 18.07,
    lon: -63.05,
    fuseau: 'America/Marigot',
    pays: 'France',
    francais: true,
    liens: [
      // Météo-France ne publie pas de page vigilance dédiée à cette collectivité :
      // on renvoie vers le portail vigilance, puis vers la préfecture compétente.
      { libelle: 'Vigilance Météo-France', url: 'https://vigilance.meteofrance.fr/fr', type: 'meteo' },
      { libelle: 'Préfecture de Saint-Barthélemy et Saint-Martin', url: 'https://www.saint-barth-saint-martin.gouv.fr/', type: 'autorite' },
    ],
  },
  {
    cle: 'saint-barthelemy',
    article: '',
    articleDe: 'de ',
    nom: 'Saint-Barthélemy',
    lat: 17.9,
    lon: -62.83,
    fuseau: 'America/St_Barthelemy',
    pays: 'France',
    francais: true,
    liens: [
      { libelle: 'Vigilance Météo-France', url: 'https://vigilance.meteofrance.fr/fr', type: 'meteo' },
      { libelle: 'Préfecture de Saint-Barthélemy et Saint-Martin', url: 'https://www.saint-barth-saint-martin.gouv.fr/', type: 'autorite' },
    ],
  },
  {
    cle: 'martinique',
    article: 'la ',
    articleDe: 'de la ',
    nom: 'Martinique',
    lat: 14.64,
    lon: -61.02,
    fuseau: 'America/Martinique',
    pays: 'France',
    francais: true,
    liens: [
      { libelle: 'Météo-France Martinique', url: 'https://meteofrance.mq/fr/vigilance', type: 'meteo' },
      { libelle: 'Préfecture de la Martinique', url: 'https://www.martinique.gouv.fr/', type: 'autorite' },
    ],
  },
  {
    cle: 'dominique',
    article: 'la ',
    articleDe: 'de la ',
    nom: 'Dominique',
    lat: 15.41,
    lon: -61.37,
    fuseau: 'America/Dominica',
    pays: 'Dominique',
    langue: 'en',
    liens: [
      { libelle: 'Dominica Meteorological Service', url: 'http://www.weather.gov.dm/', type: 'meteo' },
      { libelle: 'Office of Disaster Management', url: 'https://odm.gov.dm/', type: 'autorite' },
    ],
  },
  {
    cle: 'sainte-lucie',
    article: '',
    articleDe: 'de ',
    nom: 'Sainte-Lucie',
    lat: 13.91,
    lon: -60.98,
    fuseau: 'America/St_Lucia',
    pays: 'Sainte-Lucie',
    langue: 'en',
    liens: [
      { libelle: 'Saint Lucia Meteorological Services', url: 'https://www.slumet.gov.lc/', type: 'meteo' },
      { libelle: 'NEMO Saint Lucia', url: 'http://www.nemo.gov.lc/', type: 'autorite' },
    ],
  },
  {
    cle: 'barbade',
    article: 'la ',
    articleDe: 'de la ',
    nom: 'Barbade',
    lat: 13.19,
    lon: -59.54,
    fuseau: 'America/Barbados',
    pays: 'Barbade',
    langue: 'en',
    liens: [
      { libelle: 'Barbados Meteorological Services', url: 'https://www.barbadosweather.org/', type: 'meteo' },
      { libelle: 'Department of Emergency Management', url: 'https://dem.gov.bb/', type: 'autorite' },
    ],
  },
  {
    cle: 'antigua',
    article: '',
    articleDe: "d'",
    nom: 'Antigua-et-Barbuda',
    lat: 17.11,
    lon: -61.85,
    fuseau: 'America/Antigua',
    pays: 'Antigua-et-Barbuda',
    langue: 'en',
    liens: [
      { libelle: 'Antigua & Barbuda Meteorological Service', url: 'https://www.antiguamet.com/', type: 'meteo' },
      { libelle: 'National Office of Disaster Services', url: 'http://nods.gov.ag/', type: 'autorite' },
    ],
  },
  {
    cle: 'trinite-tobago',
    article: '',
    articleDe: 'de ',
    nom: 'Trinité-et-Tobago',
    lat: 10.69,
    lon: -61.22,
    fuseau: 'America/Port_of_Spain',
    pays: 'Trinité-et-Tobago',
    langue: 'en',
    liens: [
      { libelle: 'Trinidad and Tobago Meteorological Service', url: 'https://www.metoffice.gov.tt/', type: 'meteo' },
    ],
  },
];

/** Lien régional, valable pour toute la Caraïbe. */
export const LIEN_REGIONAL = {
  libelle: 'CDEMA — agence caribéenne de gestion des catastrophes',
  url: 'https://www.cdema.org/',
  type: 'autorite',
};

export const TERRITOIRE_DEFAUT = 'guadeloupe';

const PAR_CLE = new Map(TERRITOIRES.map((t) => [t.cle, t]));

/** Territoire par sa clé, ou la Guadeloupe si la clé est inconnue. */
export function territoire(cle) {
  return PAR_CLE.get(cle) || PAR_CLE.get(TERRITOIRE_DEFAUT);
}

/**
 * Territoires pour lesquels une évaluation complète est calculée.
 * Les dépendances rattachées ne sont pas recalculées séparément : elles sont à
 * moins de 60 km de la Guadeloupe, l'écart de menace n'aurait pas de sens à
 * l'échelle d'incertitude d'une trajectoire cyclonique.
 */
export function territoiresEvalues() {
  return TERRITOIRES.filter((t) => !t.rattache);
}

/** Liens officiels d'un territoire, complétés du lien régional hors France. */
export function liensOfficiels(cle) {
  const t = territoire(cle);
  return t.francais ? t.liens : [...t.liens, LIEN_REGIONAL];
}

/**
 * Phrase d'avertissement adaptée : elle doit nommer la bonne autorité.
 * C'est le texte que lira quelqu'un au moment de décider s'il se prépare.
 */
export function avertissementOfficiel(cle) {
  const t = territoire(cle);
  if (t.francais) {
    return 'En cas d\'alerte, seules la vigilance de Météo-France et les consignes '
      + 'de la préfecture font autorité.';
  }
  const meteo = t.liens.find((l) => l.type === 'meteo');
  const autorite = t.liens.find((l) => l.type === 'autorite');
  const noms = [meteo?.libelle, autorite?.libelle].filter(Boolean).join(' et ');
  return `En cas d'alerte, seules les consignes de ${noms || 'vos autorités nationales'} `
    + 'font autorité. Météo-France ne couvre pas ce territoire.';
}
