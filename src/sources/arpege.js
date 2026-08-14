/**
 * ARPEGE — couches de prévision en image, servies par Météo-France.
 *
 * ## Pourquoi cette source, alors qu'Open-Meteo fournit déjà des modèles
 *
 * Pour une raison précise : **les rafales**. Le réseau de stations antillais ne
 * les mesure pas — vérifié, zéro station sur quarante-six — et c'est pourtant
 * la grandeur qui décide de la mise à l'abri. ARPEGE les prévoit, sur une
 * maille globale qui couvre l'arc antillais.
 *
 * ## Pourquoi c'est faisable ici alors que le radar ne l'était pas
 *
 * Le radar arrive en BUFR, avec des tables locales que nous n'avons pas : le
 * décoder à la main donnerait des valeurs fausses. ARPEGE, lui, expose un
 * service WMS qui **rend l'image lui-même**, en PNG, sur l'emprise demandée.
 * Il n'y a donc rien à décoder : Météo-France calcule, colorie et légende ; on
 * se contente de relayer, en citant la source. Aucune dépendance ajoutée.
 *
 * ## Ce que le navigateur reçoit
 *
 * L'image, et rien d'autre. La requête part du serveur, avec le jeton en
 * en-tête ; le navigateur ne voit qu'une image servie par notre propre origine,
 * ce qui la rend compatible avec la politique de contenu de l'application.
 */
import { fetchBinaire, estErreur } from '../util/http.js';
import { secret, assurerEnvCharge } from '../util/secrets.js';
import { Limiteur } from '../util/limiteur.js';

const BASE = 'https://public-api.meteofrance.fr/public/arpege/1.0';

/**
 * Service global d'ARPEGE. Les autres services du portail — EUROPE, EURAT,
 * ATOURX — s'arrêtent bien avant l'Atlantique ouest : vérifié sur leurs
 * emprises déclarées, seul GLOBE contient la Guadeloupe.
 */
const SERVICE = 'MF-NWP-GLOBAL-ARPEGE-025-GLOBE-WMS';

/** Emprise de l'arc antillais, en EPSG:4326 (latitudes puis longitudes). */
export const EMPRISE = { sud: 10, ouest: -70, nord: 22, est: -55 };

/**
 * Couches proposées. Volontairement peu nombreuses : une couche qui n'apporte
 * rien à la décision encombre l'écran sans aider.
 */
export const COUCHES = {
  rafales: {
    id: 'WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND',
    style: 'FF_RAF__HEIGHT__SHADING',
    libelle: 'Rafales prévues',
    note: 'Vitesse maximale des rafales à 10 mètres, prévue par le modèle ARPEGE.',
  },
};

/** Échéances proposées, en heures depuis l'heure ronde courante. */
export const ECHEANCES = [0, 6, 12, 24];

// Quota annoncé : 50 requêtes par minute. On s'en tient à la moitié, largement
// suffisant puisque chaque image est ensuite gardée une heure en mémoire.
const limiteur = new Limiteur(25, 60_000);

/** Une image par couche et par échéance, renouvelée toutes les heures. */
const cache = new Map();
const DUREE_CACHE_MS = 60 * 60 * 1000;

/**
 * Heure ronde UTC, décalée de `heures`.
 * Le modèle ne publie qu'aux heures rondes : demander 14 h 37 n'aurait pas de
 * sens et ferait échouer la requête.
 */
export function echeanceIso(heures = 0, maintenant = Date.now()) {
  const d = new Date(maintenant);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + heures);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function entetesAuth() {
  assurerEnvCharge();
  const jeton = secret('METEOFRANCE_API_TOKEN');
  if (!jeton) return null;
  const mode = String(process.env.METEOFRANCE_API_AUTH || 'auto').toLowerCase();
  const bearer = mode === 'bearer' || (mode === 'auto' && jeton.split('.').length === 3);
  return bearer ? { Authorization: `Bearer ${jeton}` } : { apikey: jeton };
}

/** La source est-elle utilisable ? Ne révèle rien du jeton. */
export function configuree() {
  assurerEnvCharge();
  return Boolean(secret('METEOFRANCE_API_TOKEN'));
}

/**
 * Récupère une couche en PNG pour une échéance donnée.
 *
 * @param {string} cleCouche Clé dans `COUCHES`.
 * @param {number} heures Échéance, en heures depuis maintenant.
 * @param {{largeur?: number, hauteur?: number}} [taille]
 * @returns {Promise<{ok: boolean, image?: Buffer, echeance?: string, motif?: string}>}
 */
export async function couche(cleCouche, heures = 0, taille = {}) {
  const definition = COUCHES[cleCouche];
  if (!definition) return { ok: false, motif: 'couche inconnue' };
  if (!ECHEANCES.includes(Number(heures))) return { ok: false, motif: 'échéance non proposée' };

  const entetes = entetesAuth();
  if (!entetes) return { ok: false, motif: 'jeton non configuré' };

  const echeance = echeanceIso(Number(heures));
  const largeur = Math.min(Math.max(Number(taille.largeur) || 760, 200), 1200);
  const hauteur = Math.min(Math.max(Number(taille.hauteur) || 600, 200), 1200);
  const cle = `${cleCouche}:${echeance}:${largeur}x${hauteur}`;

  const connu = cache.get(cle);
  if (connu && Date.now() - connu.lu < DUREE_CACHE_MS) {
    return { ok: true, image: connu.image, echeance, cache: true };
  }

  const parametres = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: definition.id,
    styles: definition.style,
    crs: 'EPSG:4326',
    // En WMS 1.3.0 et EPSG:4326, l'ordre est latitude puis longitude.
    bbox: `${EMPRISE.sud},${EMPRISE.ouest},${EMPRISE.nord},${EMPRISE.est}`,
    width: String(largeur),
    height: String(hauteur),
    format: 'image/png',
    transparent: 'true',
    time: echeance,
  });

  const reponse = await fetchBinaire(`${BASE}/wms/${SERVICE}/GetMap?${parametres}`, {
    entetesSupplementaires: entetes,
    limiteur,
    // Une image de prévision n'a pas d'ETag utile : elle change avec l'échéance,
    // qui fait déjà partie de la clé de cache.
    conditionnel: false,
  });

  if (estErreur(reponse)) return { ok: false, motif: reponse.__error, echeance };

  // Le service répond en 200 même lorsqu'il refuse : l'erreur arrive alors sous
  // forme de rapport XML. Sans ce contrôle, on servirait du XML en guise
  // d'image, et l'application afficherait un cadre vide sans savoir pourquoi.
  const estPng = reponse.corps.length > 8 && reponse.corps.subarray(1, 4).toString('latin1') === 'PNG';
  if (!estPng) {
    const texte = reponse.corps.toString('utf8');
    const message = (texte.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/) || [])[1];
    return { ok: false, motif: (message || 'réponse illisible').trim().slice(0, 160), echeance };
  }

  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(cle, { image: reponse.corps, lu: Date.now() });

  return { ok: true, image: reponse.corps, echeance, octets: reponse.corps.length };
}

/** Métadonnées destinées à l'interface — aucune donnée sensible. */
export function description() {
  return {
    disponible: configuree(),
    emprise: EMPRISE,
    echeances: ECHEANCES,
    couches: Object.entries(COUCHES).map(([cle, c]) => ({
      cle, libelle: c.libelle, note: c.note,
    })),
    source: 'Météo-France',
    modele: 'ARPEGE 0,25° (maille globale)',
    licence: 'Licence Ouverte 2.0 (Etalab)',
  };
}
