/**
 * Boucle satellite — images réelles GOES-19 (GOES-East), NOAA/NESDIS STAR.
 *
 * Domaine public des États-Unis, sans clé ni quota déclaré.
 * Cadence de l'imageur : une image toutes les dix minutes.
 *
 * Deux principes tenus ici :
 *
 *  1. **Aucune image n'est fabriquée.** Chaque vignette de la boucle est un
 *     fichier réellement publié par la NOAA, avec son horodatage d'acquisition.
 *     Aucune image intermédiaire n'est interpolée puis présentée comme une
 *     observation.
 *
 *  2. **Le serveur proxifie.** Le navigateur ne contacte jamais la NOAA : la
 *     politique de sécurité du contenu interdit tout domaine tiers, et cela
 *     évite que chaque visiteur martèle le service public américain. Les images
 *     sont téléchargées une fois, mises en cache, puis servies localement.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { recuperer, estErreur, estInchange } from '../util/http.js';
import { CONFIG } from '../config.js';

const BASE = 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR';

/**
 * Secteurs retenus. `car` cadre les Petites Antilles et la mer des Caraïbes ;
 * `taw` remonte jusqu'à l'Afrique et sert à suivre les ondes à leur départ.
 */
export const SECTEURS = {
  caraibes: { code: 'car', libelle: 'Caraïbes et Petites Antilles', taille: '500x500' },
  atlantique: { code: 'taw', libelle: 'Atlantique tropical', taille: '450x270' },
};

/**
 * Canaux. GEOCOLOR est un composite (visible le jour, infrarouge la nuit) ;
 * les autres sont des canaux instrumentaux bruts.
 */
export const CANAUX = {
  geocolor: { code: 'GEOCOLOR', libelle: 'Visible et infrarouge', description: 'Composite GeoColor : couleurs naturelles le jour, infrarouge la nuit.' },
  ir: { code: '13', libelle: 'Infrarouge', description: 'Canal 13 : température des sommets nuageux, de jour comme de nuit.' },
  vapeur: { code: '09', libelle: "Vapeur d'eau", description: "Canal 9 : humidité de moyenne troposphère, révèle l'air sec." },
};

// Douze images, soit deux heures de boucle : assez pour lire un mouvement,
// assez léger pour une connexion mobile antillaise. Le mode économie de données
// n'en affiche que la moitié côté navigateur.
const IMAGES_MAX = 12;
const RETENTION_MS = 6 * 3600 * 1000;

function dossier() {
  return path.join(CONFIG.dataDir, 'satellite');
}

/**
 * Convertit l'horodatage NOAA `AAAAJJJHHMM` (jour julien) en date ISO.
 * Exemple : 20262220200 → 2026-08-10T02:00:00Z
 */
export function horodatageVersIso(brut) {
  const m = String(brut).match(/^(\d{4})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, annee, jourJulien, heure, minute] = m;
  const d = new Date(Date.UTC(Number(annee), 0, 1));
  d.setUTCDate(d.getUTCDate() + Number(jourJulien) - 1);
  d.setUTCHours(Number(heure), Number(minute), 0, 0);
  return d.toISOString();
}

/**
 * Liste les images récentes d'un secteur et d'un canal.
 * Le listing est volumineux : la requête est conditionnelle, et un document
 * inchangé n'est pas retéléchargé.
 */
export async function listerImages(secteur, canal) {
  const s = SECTEURS[secteur];
  const c = CANAUX[canal];
  if (!s || !c) return { ok: false, erreur: 'secteur ou canal inconnu' };

  const url = `${BASE}/${s.code}/${c.code}/`;
  const reponse = await recuperer(url, { accept: 'text/html' });
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };
  if (estInchange(reponse)) return { ok: true, inchange: true };

  const motif = new RegExp(
    `(\\d{11})_GOES19-ABI-${s.code}-${c.code}-${s.taille}\\.jpg`, 'g',
  );
  const vues = new Set();
  const images = [];
  let m;
  while ((m = motif.exec(reponse.corps)) !== null) {
    if (vues.has(m[1])) continue;
    vues.add(m[1]);
    images.push({
      horodatage: m[1],
      instant: horodatageVersIso(m[1]),
      fichier: m[0],
      url: url + m[0],
    });
  }

  images.sort((a, b) => (a.horodatage < b.horodatage ? -1 : 1));
  const recentes = images.slice(-IMAGES_MAX);

  return {
    ok: true,
    inchange: false,
    secteur,
    canal,
    images: recentes,
    total: images.length,
    listeRecuLe: reponse.recuLe,
  };
}

/** Nom local d'une image : il porte le secteur, le canal et l'heure réelle. */
function nomLocal(secteur, canal, horodatage) {
  return `${secteur}-${canal}-${horodatage}.jpg`;
}

/** Télécharge une image si elle n'est pas déjà en cache. */
async function assurerImage(secteur, canal, image) {
  const cible = path.join(dossier(), nomLocal(secteur, canal, image.horodatage));
  try {
    const stat = await fsp.stat(cible);
    if (stat.size > 1024) return { ok: true, cache: true, octets: stat.size };
  } catch { /* absente : on la télécharge */ }

  const reponse = await recuperer(image.url, { binary: true, conditionnel: false }, 2);
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };

  // Une image tronquée ou une page d'erreur déguisée n'entre pas dans le cache.
  const estJpeg = reponse.corps.length > 2
    && reponse.corps[0] === 0xff && reponse.corps[1] === 0xd8;
  if (!estJpeg || reponse.corps.length < 4096) {
    return { ok: false, erreur: 'image invalide ou tronquée' };
  }

  fs.mkdirSync(dossier(), { recursive: true });
  const tmp = `${cible}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, reponse.corps);
  await fsp.rename(tmp, cible);
  return { ok: true, cache: false, octets: reponse.corps.length, sha256: reponse.sha256 };
}

/** Retire les images plus vieilles que la fenêtre de rétention. */
async function purger() {
  const limite = Date.now() - RETENTION_MS;
  let retirees = 0;
  try {
    for (const fichier of await fsp.readdir(dossier())) {
      const horodatage = fichier.match(/-(\d{11})\.jpg$/)?.[1];
      const instant = horodatage ? horodatageVersIso(horodatage) : null;
      if (instant && new Date(instant).getTime() < limite) {
        await fsp.unlink(path.join(dossier(), fichier));
        retirees += 1;
      }
    }
  } catch { /* dossier absent */ }
  return retirees;
}

/**
 * Rafraîchit la boucle d'un secteur et d'un canal.
 * Retourne la liste servable, chaque entrée portant son heure réelle.
 */
export async function rafraichirBoucle(secteur = 'caraibes', canal = 'geocolor', precedent = null) {
  const liste = await listerImages(secteur, canal);

  if (!liste.ok) {
    // Source injoignable : la boucle précédente reste valable, et son âge sera
    // affiché. Mieux vaut une image datée qu'un écran vide.
    return {
      ok: false,
      erreur: liste.erreur,
      secteur,
      canal,
      images: precedent?.images || [],
      degrade: true,
    };
  }
  if (liste.inchange && precedent) {
    return { ...precedent, inchange: true };
  }

  const disponibles = [];
  let telechargees = 0;
  let octets = 0;
  const echecs = [];

  for (const image of liste.images) {
    const r = await assurerImage(secteur, canal, image);
    if (!r.ok) {
      echecs.push(`${image.horodatage} : ${r.erreur}`);
      continue;
    }
    if (!r.cache) {
      telechargees += 1;
      octets += r.octets;
    }
    disponibles.push({
      instant: image.instant,
      horodatage: image.horodatage,
      chemin: `/satellite/${nomLocal(secteur, canal, image.horodatage)}`,
      octets: r.octets,
    });
  }

  await purger();

  const derniere = disponibles[disponibles.length - 1];
  return {
    ok: disponibles.length > 0,
    secteur,
    canal,
    libelleSecteur: SECTEURS[secteur].libelle,
    libelleCanal: CANAUX[canal].libelle,
    descriptionCanal: CANAUX[canal].description,
    images: disponibles,
    derniereImage: derniere?.instant || null,
    telechargees,
    octetsTelecharges: octets,
    echecs,
    source: 'NOAA / NESDIS — GOES-19 (GOES-East)',
    licence: 'Domaine public (gouvernement des États-Unis)',
    nature: 'observation_satellite',
    majLe: new Date().toISOString(),
  };
}

/** Chemin disque d'une image de la boucle, pour la servir. */
export function cheminImage(nom) {
  if (!/^[a-z]+-[a-z]+-\d{11}\.jpg$/.test(nom)) return null;
  return path.join(dossier(), nom);
}

export { IMAGES_MAX };
