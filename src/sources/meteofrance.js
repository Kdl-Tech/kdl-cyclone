/**
 * Météo-France — vigilance officielle et observations.
 *
 * Ce module est le SEUL endroit du projet qui connaît le jeton d'accès. Il
 * s'exécute exclusivement côté serveur : le navigateur ne reçoit que le
 * résultat normalisé, jamais l'URL d'origine avec ses en-têtes, jamais le
 * jeton, jamais le document brut.
 *
 * ## Pourquoi cette source
 *
 * Le NHC publie son Tropical Weather Outlook quatre fois par jour. Météo-France
 * publie une vigilance **dès qu'elle change**. Sur un territoire français, c'est
 * elle qui fait autorité, et c'est elle qui bouge en premier. KDL Cyclone la
 * présente donc telle quelle, sans la retraiter : une vigilance officielle ne
 * s'interprète pas, elle se relaie.
 *
 * ## Ce qui a été vérifié sur le portail (14 août 2026)
 *
 * L'inventaire réel des API contredit une partie de la documentation publique :
 * il n'existe **pas** de point d'accès JSON par département pour les Antilles.
 * Seules la Polynésie et la Nouvelle-Calédonie ont le leur. Les départements
 * d'outre-mer — dont la Guadeloupe et la Martinique — passent par un flux
 * unique compressé :
 *
 *   GET /public/DPVigilance/v1/vigilanceom/flux/dernier      → archive ZIP
 *   GET /public/DPVigilance/v1/vigilanceom/controle/dernier  → fichier de contrôle
 *
 * L'archive est ouverte avec le lecteur ZIP maison déjà écrit pour les
 * shapefiles du NHC (`src/util/zip.js`), donc sans nouvelle dépendance.
 *
 * ## Prudence assumée sur le format
 *
 * Le contenu exact de l'archive n'est visible qu'avec un jeton valide. Plutôt
 * que d'écrire un analyseur sur un format supposé, celui d'en dessous cherche
 * les formes connues et, s'il ne reconnaît rien, le dit franchement : la source
 * est marquée indisponible avec le motif « format non reconnu », l'application
 * continue de fonctionner sur le NHC, et `scripts/mf-inspecter.mjs` permet de
 * relever la structure réelle pour finir le travail en une passe.
 *
 * Afficher une vigilance inventée serait pire que ne rien afficher.
 */
import { fetchBinaire, fetchTexte, estErreur, estInchange } from '../util/http.js';
import { unzip } from '../util/zip.js';
import { secret, secretPresent, assurerEnvCharge } from '../util/secrets.js';
import { Limiteur } from '../util/limiteur.js';

const BASE = 'https://public-api.meteofrance.fr';

export const POINTS = {
  vigilanceOutreMer: `${BASE}/public/DPVigilance/v1/vigilanceom/flux/dernier`,
  vigilanceControle: `${BASE}/public/DPVigilance/v1/vigilanceom/controle/dernier`,
  // Paquet d'observations d'un département entier. Vérifié le 14 août 2026 :
  // le format CSV pèse 709 Ko là où le JSON en fait 2 192 — trois fois moins,
  // pour des données identiques. Le séparateur est le point-virgule.
  paquetHoraire: `${BASE}/public/DPPaquetObs/v1/paquet/horaire`,
  listeStations: `${BASE}/public/DPPaquetObs/v1/liste-stations`,
};

/**
 * Départements d'observation par territoire.
 *
 * Saint-Martin et Saint-Barthélemy sont volontairement absents : leurs codes
 * ne figurent pas dans la liste des départements acceptés par l'API (vérifié
 * sur le schéma du portail, qui s'arrête à 971-975 et 984-988 pour l'outre-mer).
 * Mieux vaut ne rien afficher que d'afficher la mesure d'une autre île.
 */
export const DEPARTEMENTS = {
  guadeloupe: '971',
  'marie-galante': '971',
  'les-saintes': '971',
  'la-desirade': '971',
  martinique: '972',
};

/**
 * Quotas annoncés par Météo-France : 60 requêtes/minute pour la Vigilance,
 * 50 pour les observations. On se tient volontairement à la moitié : le serveur
 * n'a besoin que de quelques appels par période de cinq minutes, et cette marge
 * absorbe un redémarrage ou une collecte forcée sans jamais frôler le quota.
 */
const limiteurVigilance = new Limiteur(30, 60_000);
const limiteurObservation = new Limiteur(25, 60_000);

/** Durées de cache, par nature de donnée. */
const CACHE_MS = {
  vigilance: 5 * 60 * 1000,      // cadence de collecte de l'application
  // Les stations publient à l'heure ronde et le paquet pèse 709 Ko : le
  // rappeler plus souvent qu'une fois par heure ne donnerait rien de neuf et
  // téléchargerait 17 Mo par jour pour rien.
  observation: 55 * 60 * 1000,
};

/**
 * Au-delà de ce délai, une vigilance conservée n'est plus affichée du tout.
 *
 * C'est une règle de sécurité, pas de confort : une vigilance périmée présentée
 * comme courante peut envoyer quelqu'un dehors au mauvais moment. Entre-temps
 * elle reste visible, mais datée et signalée comme telle.
 */
const SURVIE_VIGILANCE_MS = 6 * 60 * 60 * 1000;

/**
 * Correspondance territoire KDL → zone de vigilance Météo-France.
 *
 * Les territoires non français sont volontairement absents : ils ne sont pas
 * couverts par Météo-France, et la règle du projet est qu'aucun d'eux ne doit
 * jamais se voir proposer une autorité française.
 */
/**
 * Correspondance territoire KDL → domaine de vigilance Météo-France.
 *
 * Relevé sur le flux réel le 14 août 2026. Chaque territoire d'outre-mer est
 * découpé en domaines : `VIGI971-01` est la zone principale de Guadeloupe,
 * `VIGI971-51` à `-57` sont des zones complémentaires. On retient la zone
 * principale, et surtout **pas** le maximum de toutes les zones : une
 * vigilance qui ne concerne qu'une zone maritime deviendrait sinon une alerte
 * générale sur toute l'île.
 *
 * Les territoires non français sont absents : ils ne relèvent pas de
 * Météo-France, et la règle vitale du projet interdit de leur présenter une
 * autorité française.
 */
export const ZONES = {
  guadeloupe: { principal: 'VIGI971-01', prefixe: 'VIGI971', libelle: 'Guadeloupe' },
  'marie-galante': { principal: 'VIGI971-01', prefixe: 'VIGI971', libelle: 'Guadeloupe' },
  'les-saintes': { principal: 'VIGI971-01', prefixe: 'VIGI971', libelle: 'Guadeloupe' },
  'la-desirade': { principal: 'VIGI971-01', prefixe: 'VIGI971', libelle: 'Guadeloupe' },
  martinique: { principal: 'VIGI972-01', prefixe: 'VIGI972', libelle: 'Martinique' },
  // Saint-Martin et Saint-Barthélemy partagent le domaine « Îles du Nord ».
  // Ils sont couverts par la vigilance, alors qu'ils ne le sont pas par les
  // observations : les deux périmètres ne se recouvrent pas.
  'saint-martin': { principal: 'VIGI978-977-01', prefixe: 'VIGI978-977', libelle: 'Îles du Nord' },
  'saint-barthelemy': { principal: 'VIGI978-977-01', prefixe: 'VIGI978-977', libelle: 'Îles du Nord' },
};

/**
 * Phénomènes de vigilance, identifiants Météo-France.
 *
 * Un identifiant inconnu n'est pas deviné : il est affiché tel quel. Mieux vaut
 * « phénomène n° 14 » qu'un nom inventé sur une alerte officielle.
 */
/*
 * Identifiants de phénomènes, tous établis sur les données réelles.
 *
 * 1, 9 et 12 ont été confirmés en recoupant, dans le flux lui-même, la carte de
 * Mayotte et son bulletin rédigé : celui-ci annonçait « Vagues-submersion
 * JAUNE, Vents forts néant, Fortes pluies/Orages néant » pendant que la carte
 * portait 9:2, 1:1 et 12:1.
 *
 * 10 a été établi par un test falsifiable. Météo-France documente quatre
 * phénomènes pour la vigilance outre-mer — vents violents, fortes
 * pluies-orages, vagues-submersion et cyclone — en précisant « sauf en
 * Guyane ». Si 10 était le cyclone, il devait donc manquer au seul fichier
 * guyanais. Relevé sur le flux : Guadeloupe, Martinique et Îles du Nord
 * portent 1, 2, 9, 10 ; la Réunion et Mayotte portent 1, 9, 10, 12 ; la Guyane
 * porte 1, 2, 9 — et elle seule est privée du 10. La prédiction se vérifie.
 *
 * Les DROM de l'océan Indien emploient 12 là où les Antilles emploient 2 pour
 * la même chose : les deux figurent donc ici.
 */
const PHENOMENES = {
  1: 'Vent violent',
  2: 'Fortes pluies-Orages',
  3: 'Orages',
  4: 'Inondation',
  5: 'Neige-verglas',
  6: 'Canicule',
  7: 'Grand froid',
  8: 'Avalanches',
  9: 'Vagues-submersion',
  10: 'Cyclone',
  12: 'Fortes pluies-Orages',
};

/** Couleurs de vigilance, identifiants Météo-France. */
const COULEURS = {
  1: { cle: 'vert', libelle: 'Vert', rang: 1 },
  2: { cle: 'jaune', libelle: 'Jaune', rang: 2 },
  3: { cle: 'orange', libelle: 'Orange', rang: 3 },
  4: { cle: 'rouge', libelle: 'Rouge', rang: 4 },
};

function nommerPhenomene(id) {
  const n = Number(id);
  return PHENOMENES[n] || `Phénomène n° ${id}`;
}

function nommerCouleur(id) {
  const n = Number(id);
  return COULEURS[n] || { cle: 'inconnu', libelle: `Niveau ${id}`, rang: 0 };
}

// ---------------------------------------------------------------- accès

/**
 * En-têtes d'authentification.
 *
 * Le portail délivre selon les cas une clé longue durée (en-tête `apikey`) ou
 * un jeton OAuth2 d'une heure (en-tête `Authorization: Bearer`). Un jeton OAuth
 * est un JWT, reconnaissable à ses trois segments séparés par des points : la
 * détection est automatique, et `METEOFRANCE_API_AUTH=apikey|bearer` permet de
 * forcer le choix si besoin.
 *
 * @returns {Record<string,string>|null} `null` si aucun jeton n'est configuré.
 */
function entetesAuth() {
  assurerEnvCharge();
  const jeton = secret('METEOFRANCE_API_TOKEN');
  if (!jeton) return null;

  const mode = String(process.env.METEOFRANCE_API_AUTH || 'auto').toLowerCase();
  const estJwt = jeton.split('.').length === 3;
  const bearer = mode === 'bearer' || (mode === 'auto' && estJwt);

  return bearer ? { Authorization: `Bearer ${jeton}` } : { apikey: jeton };
}

/** La source est-elle configurée ? Ne révèle rien de la valeur. */
export function configuree() {
  assurerEnvCharge();
  return secretPresent('METEOFRANCE_API_TOKEN');
}

/**
 * Traduit une erreur du client HTTP en message destiné à l'exploitant.
 * Aucun de ces textes ne contient d'élément secret.
 */
function expliquer(reponse) {
  switch (reponse.__statut) {
    case 401:
      return 'jeton refusé (401) — clé absente, expirée ou mal formée';
    case 403:
      return 'accès refusé (403) — la souscription à cette API manque sur le portail';
    case 404:
      return 'point d\'accès introuvable (404)';
    case 429:
      return 'quota dépassé (429) — appels suspendus le temps demandé';
    default:
      if (reponse.__statut >= 500) return `Météo-France indisponible (${reponse.__statut})`;
      return reponse.__error || 'source injoignable';
  }
}

// ------------------------------------------------- mémoire de la source

/**
 * Dernière donnée valide par clé, conservée pour survivre à une panne de la
 * source. Ce cache vit en mémoire : après un redémarrage, l'application repart
 * d'une collecte complète, ce qui est le comportement voulu.
 */
const memoire = new Map();

function lireCache(cle, dureeMs) {
  const entree = memoire.get(cle);
  if (!entree) return null;
  if (Date.now() - entree.recuLe > dureeMs) return null;
  return entree;
}

function ecrireCache(cle, valeur) {
  memoire.set(cle, { ...valeur, recuLe: Date.now() });
}

/** Dernière valeur connue, même périmée, tant qu'elle reste présentable. */
function derniereValide(cle, survieMs) {
  const entree = memoire.get(cle);
  if (!entree) return null;
  if (Date.now() - entree.recuLe > survieMs) return null;
  return entree;
}

/** Vide la mémoire — utilisé par les outils de diagnostic. */
export function oublierCache() {
  memoire.clear();
}

// ------------------------------------------------------ analyse du flux

/**
 * Choisit le domaine à retenir pour une zone.
 *
 * On privilégie la zone principale déclarée (`VIGI971-01`). Si elle manque, on
 * se rabat sur le domaine le plus court du même préfixe — le plus englobant —
 * plutôt que sur le plus sévère : additionner des vigilances de sous-zones
 * reviendrait à inventer une alerte que Météo-France n'a pas émise.
 */
function choisirDomaine(domaines, zone) {
  const principal = domaines.find((d) => d.domain_id === zone.principal);
  if (principal) return principal;

  const candidats = domaines
    .filter((d) => String(d.domain_id || '').startsWith(zone.prefixe))
    .sort((a, b) => String(a.domain_id).length - String(b.domain_id).length);
  return candidats[0] || null;
}

/**
 * Extrait la vigilance d'un document JSON du flux outre-mer.
 *
 * La forme attendue est celle de l'API Vigilance : des blocs portant
 * `domain_id`, `max_color_id` et une liste `phenomenon_items`. Les variantes de
 * nommage rencontrées d'un produit à l'autre sont acceptées.
 *
 * @returns {object|null} vigilance normalisée, ou `null` si rien ne correspond.
 */
export function vigilanceDepuisJson(document, zone) {
  const domaines = document?.timelaps?.domain_ids;
  if (!Array.isArray(domaines) || !domaines.length) return null;

  const bloc = choisirDomaine(domaines, zone);
  if (!bloc) return null;

  const phenomenes = (Array.isArray(bloc.phenomenon_items) ? bloc.phenomenon_items : [])
    .map((p) => ({
      nom: nommerPhenomene(p.phenomenon_id),
      ...nommerCouleur(p.phenomenon_max_color_id),
      // Le début de l'épisode est porté par la chronologie du phénomène.
      debut: p.timelaps_items?.[0]?.begin_time || null,
    }))
    // Les couleurs 0 et -1 signifient « non évalué » pour ce territoire :
    // les afficher ferait passer une absence d'évaluation pour un niveau vert.
    .filter((p) => p.rang > 0)
    .sort((a, b) => b.rang - a.rang);

  // Le niveau retenu est le plus fort annoncé, qu'il vienne du domaine ou du
  // phénomène le plus grave. Les deux concordent normalement ; en cas de
  // désaccord, on retient toujours le plus prudent.
  const niveauDomaine = nommerCouleur(bloc.max_color_id);
  const niveauPhenomene = phenomenes[0] || { rang: 0 };
  const niveau = niveauDomaine.rang >= niveauPhenomene.rang ? niveauDomaine : niveauPhenomene;
  if (niveau.rang === 0) return null;

  return {
    zone: zone.libelle,
    domaine: bloc.domain_id,
    niveau: niveau.cle,
    niveauLibelle: niveau.libelle,
    niveauRang: niveau.rang,
    phenomenes: phenomenes.map((p) => ({
      nom: p.nom, niveau: p.cle, niveauLibelle: p.libelle, debut: p.debut,
    })),
    // Seuls les phénomènes réellement en vigilance (au-dessus du vert)
    // méritent d'être mis en avant dans l'interface.
    phenomenesActifs: phenomenes.filter((p) => p.rang >= 2).map((p) => p.nom),
  };
}

/**
 * Analyse l'archive du flux outre-mer.
 *
 * @param {Map<string, Buffer>} entrees Contenu de l'archive.
 * @param {object} zone Zone recherchée.
 * @returns {{ vigilance: object|null, entrees: string[], emisLe: string|null }}
 *   `entrees` ne contient que des **noms de fichiers** : c'est ce qui permet de
 *   diagnostiquer un changement de format sans rien exposer.
 */
export function analyserFluxOutreMer(entrees, zone) {
  const noms = [...entrees.keys()];
  let emisLe = null;

  for (const nom of noms) {
    // L'extension ne dit rien du contenu : les cartes de vigilance arrivent
    // dans des fichiers `.txt` qui contiennent du JSON. On regarde donc le
    // premier caractère utile plutôt que le nom du fichier — c'est ce qui
    // avait fait échouer une première version de cet analyseur.
    if (/\.(pdf|png|jpg|jpeg|zip)$/i.test(nom)) continue;

    const texte = entrees.get(nom).toString('utf8').trim();
    if (!texte.startsWith('{')) continue;

    let document;
    try {
      document = JSON.parse(texte);
    } catch {
      continue; // fichier illisible : les autres restent exploitables
    }

    const vigilance = vigilanceDepuisJson(document, zone);
    if (vigilance) {
      return {
        vigilance: { ...vigilance, fichier: nom },
        entrees: noms,
        emisLe: document.update_time || emisLe,
      };
    }
    emisLe = emisLe || document.update_time || null;
  }

  return { vigilance: null, entrees: noms, emisLe };
}

// ---------------------------------------------------------- récupération

/**
 * Récupère la vigilance en cours pour un territoire.
 *
 * Ne lève jamais : renvoie toujours un objet décrivant l'état réel de la
 * source, y compris quand elle est absente ou en panne. Une couche de veille
 * cyclonique ne doit pas pouvoir faire tomber le reste de l'application.
 *
 * @param {string} cleTerritoire
 * @returns {Promise<object>}
 */
export async function vigilances() {
  const entetes = entetesAuth();
  if (!entetes) return { disponible: false, motif: 'jeton non configuré', parTerritoire: {} };

  const CLE = 'vigilance:outremer';
  const frais = lireCache(CLE, CACHE_MS.vigilance);
  if (frais) return { ...frais.valeur, cache: true };

  // Une seule requête sert tous les territoires : le flux outre-mer est un
  // document unique. Analyser zone par zone après coup coûte quelques
  // millisecondes ; le retélécharger trois fois coûterait du quota et du délai.
  const reponse = await fetchBinaire(POINTS.vigilanceOutreMer, {
    entetesSupplementaires: entetes,
    limiteur: limiteurVigilance,
  });

  if (estErreur(reponse) || estInchange(reponse)) {
    const secours = derniereValide(CLE, SURVIE_VIGILANCE_MS);
    if (estInchange(reponse) && secours) {
      return { ...secours.valeur, emisLe: reponse.emisLe || secours.valeur.emisLe };
    }
    return {
      disponible: Boolean(secours),
      motif: estInchange(reponse) ? 'document inchangé, rien en mémoire' : expliquer(reponse),
      definitif: Boolean(reponse.__definitif),
      parTerritoire: secours?.valeur?.parTerritoire || {},
      ...(secours
        ? { perime: true, conserveeDepuis: new Date(secours.recuLe).toISOString() }
        : {}),
    };
  }

  let entrees;
  try {
    entrees = unzip(reponse.corps);
  } catch (err) {
    return { disponible: false, motif: `archive illisible : ${err.message}`, parTerritoire: {} };
  }

  const parTerritoire = {};
  let emisLe = null;
  let reconnues = 0;
  let noms = [];

  for (const [cleTerritoire, zone] of Object.entries(ZONES)) {
    const analyse = analyserFluxOutreMer(entrees, zone);
    noms = analyse.entrees;
    emisLe = emisLe || analyse.emisLe;
    if (!analyse.vigilance) continue;
    reconnues += 1;
    parTerritoire[cleTerritoire] = {
      ...analyse.vigilance,
      source: 'Météo-France',
      licence: 'Licence Ouverte 2.0 (Etalab)',
      lien: 'https://vigilance.meteofrance.fr/fr',
    };
  }

  if (!reconnues) {
    return {
      disponible: false,
      motif: 'format non reconnu',
      // Noms de fichiers seulement : de quoi diagnostiquer, rien de sensible.
      fichiersRecus: noms.slice(0, 20),
      parTerritoire: {},
    };
  }

  // L'heure d'émission accompagne chaque territoire : l'interface l'affiche à
  // côté du niveau, et une vigilance sans heure ne vaut rien.
  const emission = emisLe || reponse.emisLe || null;
  for (const entree of Object.values(parTerritoire)) entree.emisLe = emission;

  const valeur = {
    disponible: true,
    parTerritoire,
    emisLe: emission,
    recuLe: reponse.recuLe,
    sha256: reponse.sha256,
    source: 'Météo-France',
    licence: 'Licence Ouverte 2.0 (Etalab)',
  };

  ecrireCache(CLE, { valeur });
  return valeur;
}

/**
 * Vigilance d'un seul territoire, depuis le flux commun.
 * @param {string} cleTerritoire
 */
export async function vigilancePour(cleTerritoire) {
  if (!ZONES[cleTerritoire]) {
    // Territoire non couvert par Météo-France — ce n'est pas une erreur.
    return { disponible: false, motif: 'territoire hors couverture Météo-France' };
  }
  const tout = await vigilances();
  const propre = tout.parTerritoire?.[cleTerritoire];
  if (!propre) return { disponible: false, motif: tout.motif || 'zone absente du flux' };
  return {
    disponible: true,
    ...propre,
    emisLe: tout.emisLe,
    recuLe: tout.recuLe,
    perime: Boolean(tout.perime),
  };
}

/**
 * Lecture d'un CSV Météo-France : séparateur point-virgule, une ligne d'entête,
 * champs vides pour les grandeurs non mesurées.
 *
 * Écrit à la main plutôt qu'importé : le projet n'a aucune dépendance, et ce
 * format est trop simple pour en justifier une.
 *
 * @param {string} texte
 * @returns {Array<Record<string,string>>}
 */
export function lireCsv(texte) {
  const lignes = String(texte || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lignes.length < 2) return [];

  const entete = lignes[0].split(';').map((c) => c.trim());
  const sortie = [];
  for (let i = 1; i < lignes.length; i += 1) {
    const cellules = lignes[i].split(';');
    // Une ligne mal formée est ignorée : elle ne doit pas décaler les autres.
    if (cellules.length !== entete.length) continue;
    const ligne = {};
    for (let c = 0; c < entete.length; c += 1) {
      const v = cellules[c].trim();
      ligne[entete[c]] = v === '' ? null : v;
    }
    sortie.push(ligne);
  }
  return sortie;
}

/**
 * Convertit une mesure brute Météo-France dans les unités de l'application.
 *
 * Les unités de la source sont celles du système international : kelvin pour
 * les températures, mètre par seconde pour le vent, pascal pour la pression.
 * L'application affiche des degrés Celsius, des km/h et des hectopascals.
 */
export function normaliserMesure(brut) {
  const t = nombreOuNull(brut.t);
  const ff = nombreOuNull(brut.ff);
  const fxi = nombreOuNull(brut.fxi);
  const pres = nombreOuNull(brut.pmer) ?? nombreOuNull(brut.pres);

  return {
    station: brut.geo_id_insee || null,
    lat: nombreOuNull(brut.lat),
    lon: nombreOuNull(brut.lon),
    mesureLe: brut.validity_time || null,
    temperatureC: t === null ? null : Math.round((t - 273.15) * 10) / 10,
    humiditePct: nombreOuNull(brut.u),
    ventMoyenKmh: ff === null ? null : Math.round(ff * 3.6),
    // Les rafales sont rarement renseignées sur le réseau antillais : le champ
    // reste présent, à null, plutôt que d'être masqué — une absence de mesure
    // n'est pas une absence de vent.
    rafaleKmh: fxi === null ? null : Math.round(fxi * 3.6),
    directionVentDeg: nombreOuNull(brut.dd),
    pressionHpa: pres === null ? null : Math.round(pres / 100),
    pluie1hMm: nombreOuNull(brut.rr1),
  };
}

/** Distance approchée en kilomètres, suffisante pour classer des stations. */
function distanceApprocheeKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ne conserve, pour chaque station, que sa mesure la plus récente.
 *
 * Le paquet départemental contient cinq jours d'historique — plus de 4 700
 * lignes pour 46 stations. L'application n'affiche que le temps qu'il fait
 * maintenant : tout le reste est écarté avant même d'entrer en mémoire.
 */
export function dernieresMesures(lignes) {
  const parStation = new Map();
  for (const ligne of lignes) {
    const id = ligne.geo_id_insee;
    if (!id || !ligne.validity_time) continue;
    const connue = parStation.get(id);
    if (!connue || ligne.validity_time > connue.validity_time) parStation.set(id, ligne);
  }
  return [...parStation.values()];
}

/**
 * Observations mesurées d'un département.
 *
 * Complément des modèles Open-Meteo, et non remplacement : ce sont des
 * **mesures**, pas des prévisions. La distinction est capitale dans une
 * interface qui sépare déjà le constaté de l'estimé.
 *
 * @param {string} departement Code INSEE du département (971, 972…).
 */
export async function observationsDepartement(departement) {
  const entetes = entetesAuth();
  if (!entetes) return { disponible: false, motif: 'jeton non configuré' };
  if (!departement) return { disponible: false, motif: 'département non renseigné' };

  const cleCache = `observation:${departement}`;
  const frais = lireCache(cleCache, CACHE_MS.observation);
  if (frais) return { ...frais.valeur, cache: true };

  const url = `${POINTS.paquetHoraire}?id-departement=${encodeURIComponent(departement)}&format=csv`;
  const reponse = await fetchTexte(url, {
    entetesSupplementaires: entetes,
    limiteur: limiteurObservation,
  });

  if (estErreur(reponse) || estInchange(reponse)) {
    // Une observation vieille de quelques heures reste utile pour situer une
    // tendance ; au-delà, elle ne dit plus rien du temps qu'il fait.
    const secours = derniereValide(cleCache, 6 * 60 * 60 * 1000);
    if (estInchange(reponse) && secours) return secours.valeur;
    return {
      disponible: Boolean(secours),
      motif: estInchange(reponse) ? 'paquet inchangé, rien en mémoire' : expliquer(reponse),
      definitif: Boolean(reponse.__definitif),
      ...(secours ? { ...secours.valeur, perime: true } : {}),
    };
  }

  const mesures = dernieresMesures(lireCsv(reponse.corps)).map(normaliserMesure);
  if (!mesures.length) return { disponible: false, motif: 'aucune mesure exploitable' };

  const valeur = {
    disponible: true,
    departement,
    stations: mesures.filter((m) => m.lat !== null && m.lon !== null),
    mesureLe: mesures.map((m) => m.mesureLe).filter(Boolean).sort().pop() || null,
    recuLe: reponse.recuLe,
    source: 'Météo-France',
    licence: 'Licence Ouverte 2.0 (Etalab)',
  };

  ecrireCache(cleCache, { valeur });
  return valeur;
}

/**
 * Synthèse des observations autour d'un territoire.
 *
 * Deux lectures complémentaires y figurent :
 *  - la station **la plus proche** qui mesure réellement la grandeur, pour
 *    répondre à « quel temps fait-il ici » ;
 *  - les **extrêmes du territoire** — pression la plus basse, vent le plus
 *    fort, pluie la plus forte — car en veille cyclonique, c'est le point le
 *    plus exposé qui compte, pas la moyenne.
 *
 * @param {string} cleTerritoire
 * @param {{lat:number, lon:number}} position
 * @param {number} [rayonKm] Distance au-delà de laquelle une station est écartée.
 */
export async function observationsTerritoire(cleTerritoire, position, rayonKm = 60) {
  const departement = DEPARTEMENTS[cleTerritoire];
  if (!departement) {
    return { disponible: false, motif: 'territoire hors couverture des observations' };
  }

  const paquet = await observationsDepartement(departement);
  if (!paquet.disponible) return paquet;

  const proches = paquet.stations
    .map((s) => ({ ...s, distanceKm: Math.round(distanceApprocheeKm(position, s)) }))
    .filter((s) => s.distanceKm <= rayonKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (!proches.length) {
    return { disponible: false, motif: `aucune station à moins de ${rayonKm} km` };
  }

  /** Valeur de la station la plus proche qui mesure vraiment cette grandeur. */
  const laPlusProcheAvec = (champ) => {
    const s = proches.find((x) => x[champ] !== null && x[champ] !== undefined);
    return s ? { valeur: s[champ], station: s.station, distanceKm: s.distanceKm } : null;
  };

  const extreme = (champ, choisir) => {
    const valeurs = proches.filter((s) => s[champ] !== null && s[champ] !== undefined);
    if (!valeurs.length) return null;
    const s = valeurs.reduce((a, b) => (choisir(a[champ], b[champ]) ? a : b));
    return { valeur: s[champ], station: s.station, distanceKm: s.distanceKm };
  };

  return {
    disponible: true,
    perime: Boolean(paquet.perime),
    stationsRetenues: proches.length,
    mesureLe: proches.map((s) => s.mesureLe).filter(Boolean).sort().pop() || paquet.mesureLe,
    recuLe: paquet.recuLe,
    temperatureC: laPlusProcheAvec('temperatureC'),
    humiditePct: laPlusProcheAvec('humiditePct'),
    ventMoyenKmh: laPlusProcheAvec('ventMoyenKmh'),
    rafaleKmh: laPlusProcheAvec('rafaleKmh'),
    pressionHpa: laPlusProcheAvec('pressionHpa'),
    pluie1hMm: laPlusProcheAvec('pluie1hMm'),
    // Les extrêmes disent où le territoire souffre le plus, maintenant.
    pressionMiniHpa: extreme('pressionHpa', (a, b) => a <= b),
    ventMaxKmh: extreme('ventMoyenKmh', (a, b) => a >= b),
    pluieMaxMm: extreme('pluie1hMm', (a, b) => a >= b),
    source: 'Météo-France',
    licence: 'Licence Ouverte 2.0 (Etalab)',
    lien: 'https://meteofrance.gp/fr/observations',
  };
}

/**
 * Convertit en nombre, ou rend `null` si la mesure est absente.
 *
 * Le test `Number.isFinite(Number(v))` seul ne suffit pas : `Number(null)` et
 * `Number('')` valent **zéro**. Une station qui ne mesure pas les rafales
 * affichait ainsi « rafale 0 km/h », et une station sans baromètre « pression
 * 0 hPa ». Sur une application de veille cyclonique, une absence de mesure
 * présentée comme une mesure nulle est un contresens dangereux : l'absence
 * doit rester une absence.
 */
function nombreOuNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** État du limiteur et de la configuration — pour `/api/sante`, sans secret. */
export function diagnostic() {
  return {
    configuree: configuree(),
    vigilance: limiteurVigilance.etat(),
    observation: limiteurObservation.etat(),
    entreesEnMemoire: memoire.size,
  };
}
