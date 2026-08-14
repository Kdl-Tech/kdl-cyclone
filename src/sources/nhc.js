/**
 * Source NHC (National Hurricane Center, NOAA).
 * Données du domaine public des États-Unis, sans clé ni quota déclaré.
 * L'attribution reste affichée dans l'interface.
 *
 *  - CurrentStorms.json : systèmes actifs nommés ou numérotés
 *  - xml/TWOAT.xml      : Tropical Weather Outlook, texte officiel
 *  - xgtwo/*.zip        : zones, points et lignes du TWO en shapefile
 */

import { fetchJson, fetchTexte, fetchBinaire, estErreur, estInchange } from '../util/http.js';
import { unzip } from '../util/zip.js';
import { readLayer } from '../util/shapefile.js';
import { ringCentroid } from '../engine/geo.js';

const BASE = 'https://www.nhc.noaa.gov';
export const URLS = {
  currentStorms: `${BASE}/CurrentStorms.json`,
  twoAtlantiqueXml: `${BASE}/xml/TWOAT.xml`,
  gtwoShapefiles: `${BASE}/xgtwo/gtwo_shapefiles.zip`,
  pageTwo: `${BASE}/gtwo.php?basin=atlc`,
};

/** Convertit « 10% » ou « near 0 percent » en nombre, sinon null. */
function pourcentage(v) {
  if (v == null) return null;
  const m = String(v).match(/(\d{1,3})\s*%?/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

const RISQUE_FR = { Low: 'faible', Medium: 'moyen', High: 'élevé' };

/**
 * Zones du Tropical Weather Outlook, avec probabilités officielles.
 * @returns {Promise<{ok:boolean, zones:Array, erreur?:string, recuperePar?:string}>}
 */
export async function fetchOutlookZones() {
  const reponse = await fetchBinaire(URLS.gtwoShapefiles);
  if (estErreur(reponse)) return { ok: false, zones: [], erreur: reponse.__error };
  // Document inchangé depuis la dernière fois : le collecteur réutilisera les
  // zones déjà connues plutôt que de retélécharger et de reparser pour rien.
  if (estInchange(reponse)) {
    // Même inchangé, la réponse 304 porte l'heure d'émission mémorisée
    // (Last-Modified) : on la propage pour que la fraîcheur reste juste.
    return { ok: true, inchange: true, zones: null, emisLe: reponse.emisLe, tracabilite: reponse };
  }

  let fichiers;
  try {
    fichiers = unzip(reponse.corps);
  } catch (e) {
    return { ok: false, zones: [], erreur: `archive illisible : ${e.message}` };
  }
  if (fichiers.size === 0) return { ok: false, zones: [], erreur: 'archive vide' };

  const couche = (motif) => {
    const nom = [...fichiers.keys()].find((n) => n.includes(motif) && n.endsWith('.shp'));
    if (!nom) return [];
    return readLayer(fichiers.get(nom), fichiers.get(nom.replace('.shp', '.dbf')));
  };

  const areas = couche('gtwo_areas');
  const points = couche('gtwo_points');
  const lines = couche('gtwo_lines');

  const cle = (p) => `${p.BASIN || ''}#${p.AREA || ''}`;
  const parZone = new Map();

  for (const a of areas) {
    if ((a.properties.BASIN || '').toLowerCase() !== 'atlantic') continue;
    const ring = a.geometry.rings?.[0] || [];
    parZone.set(cle(a.properties), {
      id: `nhc-two-${(a.properties.AREA || '?').toLowerCase()}`,
      source: 'NHC',
      type: 'zone_surveillee',
      numero: a.properties.AREA || null,
      prob48h: pourcentage(a.properties.PROB2DAY),
      prob7j: pourcentage(a.properties.PROB7DAY),
      risque48h: RISQUE_FR[a.properties.RISK2DAY] || null,
      risque7j: RISQUE_FR[a.properties.RISK7DAY] || null,
      polygone: ring.map((p) => [
        Math.round(p.lon * 1000) / 1000,
        Math.round(p.lat * 1000) / 1000,
      ]),
      centre: ring.length ? ringCentroid(ring) : null,
      position: null,
      trajectoireIndicative: null,
    });
  }

  // Le point du TWO est la position de référence retenue par le NHC.
  for (const p of points) {
    const z = parZone.get(cle(p.properties));
    if (z && p.geometry.coordinates) {
      z.position = {
        lat: Math.round(p.geometry.coordinates.lat * 1000) / 1000,
        lon: Math.round(p.geometry.coordinates.lon * 1000) / 1000,
      };
    }
  }

  // Les lignes du TWO existent seulement pour les systèmes que le NHC suit
  // explicitement dans le temps : c'est une donnée officielle, pas une estimation.
  for (const l of lines) {
    const z = parZone.get(cle(l.properties));
    const ring = l.geometry.rings?.[0];
    if (z && ring?.length) {
      z.trajectoireIndicative = ring.map((pt) => [
        Math.round(pt.lon * 1000) / 1000,
        Math.round(pt.lat * 1000) / 1000,
      ]);
    }
  }

  const zones = [...parZone.values()].map((z) => ({
    ...z,
    position: z.position || z.centre,
  }));

  // Horodatage porté par le nom des fichiers : gtwo_areas_AAAAMMJJHHMM
  // Le nom des fichiers porte l'heure d'émission officielle : gtwo_areas_AAAAMMJJHHMM
  const nom = [...fichiers.keys()].find((n) => n.includes('gtwo_areas'));
  const m = nom?.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const emisLe = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : reponse.emisLe;

  return {
    ok: true,
    inchange: false,
    zones,
    emisLe,
    tracabilite: {
      source: 'NHC',
      produit: 'Tropical Weather Outlook — zones GIS',
      url: URLS.gtwoShapefiles,
      emisLe,
      recuLe: reponse.recuLe,
      sha256: reponse.sha256,
      octets: reponse.octets,
      etag: reponse.etag || null,
      lastModified: reponse.lastModified || null,
      fichier: nom || null,
    },
  };
}

/** Texte intégral du Tropical Weather Outlook Atlantique. */
export async function fetchOutlookTexte() {
  const reponse = await fetchTexte(URLS.twoAtlantiqueXml);
  if (estErreur(reponse)) return { ok: false, erreur: reponse.__error };
  if (estInchange(reponse)) return { ok: true, inchange: true, emisLe: reponse.emisLe, tracabilite: reponse };

  const xml = reponse.corps;
  const pub = xml.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] || null;
  const cdata = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || '';
  const texte = cdata
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // L'en-tête WMO porte l'heure réelle d'émission : « ABNT20 KNHC 092336 »
  // signifie jour 09 du mois courant, 23 h 36 UTC. Le `pubDate` du flux, lui,
  // est l'heure de republication RSS : il peut avoir plusieurs heures de retard
  // sur le bulletin, et donner l'illusion d'une donnée plus fraîche qu'elle
  // ne l'est.
  const emisLe = emissionWmo(texte) || (pub ? new Date(pub).toISOString() : reponse.emisLe);
  return {
    ok: texte.length > 0,
    inchange: false,
    emisLe,
    texte,
    // Le bulletin brut est conservé : c'est la pièce justificative de ce qui
    // est affiché, et elle permet de rejouer une analyse a posteriori.
    brut: xml,
    url: URLS.pageTwo,
    tracabilite: {
      source: 'NHC',
      produit: 'Tropical Weather Outlook — texte officiel',
      url: URLS.twoAtlantiqueXml,
      emisLe,
      recuLe: reponse.recuLe,
      sha256: reponse.sha256,
      octets: reponse.octets,
      etag: reponse.etag || null,
      lastModified: reponse.lastModified || null,
    },
  };
}

/**
 * Extrait l'heure d'émission de l'en-tête WMO d'un bulletin NHC.
 * Format : « ABNT20 KNHC JJHHMM », en UTC, sans le mois ni l'année.
 * On les déduit de la date courante, en tenant compte d'un passage de mois.
 */
export function emissionWmo(texte, maintenant = new Date()) {
  const m = String(texte || '').match(/\b[A-Z]{4}\d{2}\s+KNHC\s+(\d{2})(\d{2})(\d{2})\b/);
  if (!m) return null;
  const [, jour, heure, minute] = m.map(Number);
  if (jour < 1 || jour > 31 || heure > 23 || minute > 59) return null;

  // On essaie le mois courant puis le précédent, et on retient la date valide
  // la plus proche dans le passé. Construire directement « le 31 septembre »
  // déborderait sur octobre : il faut vérifier que le jour existe vraiment.
  const candidats = [0, -1]
    .map((decalage) => {
      const d = new Date(Date.UTC(
        maintenant.getUTCFullYear(), maintenant.getUTCMonth() + decalage, jour, heure, minute, 0,
      ));
      // Si le jour a débordé sur le mois suivant, la date n'existe pas.
      return d.getUTCDate() === jour ? d : null;
    })
    .filter(Boolean)
    // Un bulletin est publié dans le passé ; on tolère une petite avance
    // d'horloge, pas davantage.
    .filter((d) => d.getTime() - maintenant.getTime() < 3 * 3600 * 1000)
    .sort((a, b) => b - a);

  return candidats.length ? candidats[0].toISOString() : null;
}

const CLASSIFICATIONS = {
  TD: { statut: 'Dépression tropicale', code: 'depression' },
  TS: { statut: 'Tempête tropicale', code: 'tempete' },
  HU: { statut: 'Ouragan', code: 'ouragan' },
  MH: { statut: 'Ouragan majeur', code: 'ouragan_majeur' },
  PTC: { statut: 'Cyclone potentiel', code: 'potentiel' },
  STD: { statut: 'Dépression subtropicale', code: 'depression' },
  STS: { statut: 'Tempête subtropicale', code: 'tempete' },
  PC: { statut: 'Cyclone post-tropical', code: 'post_tropical' },
  LO: { statut: 'Basse pression', code: 'basse_pression' },
};

/** Systèmes actifs officiellement suivis par le NHC (bassin atlantique). */
export async function fetchSystemesActifs() {
  const reponse = await fetchJson(URLS.currentStorms);
  if (estErreur(reponse)) return { ok: false, systemes: [], erreur: reponse.__error };
  if (estInchange(reponse)) return { ok: true, inchange: true, systemes: null, tracabilite: reponse };

  const data = reponse.donnees;
  const bruts = Array.isArray(data.activeStorms) ? data.activeStorms : [];
  const systemes = bruts
    .filter((s) => /^(al|AL)/.test(s.id || '') || (s.binNumber || '').startsWith('AT'))
    .map((s) => {
      const cls = CLASSIFICATIONS[s.classification] || { statut: s.classification || 'Système', code: 'autre' };
      const ventKt = Number.parseFloat(s.intensity);
      const vitesseKt = Number.parseFloat(s.movementSpeed);
      return {
        id: `nhc-${(s.id || s.binNumber || 'inconnu').toLowerCase()}`,
        source: 'NHC',
        type: 'systeme_officiel',
        nom: s.name || null,
        identifiantNhc: s.id || null,
        statut: cls.statut,
        statutCode: cls.code,
        position:
          Number.isFinite(s.latitudeNumeric) && Number.isFinite(s.longitudeNumeric)
            ? { lat: s.latitudeNumeric, lon: s.longitudeNumeric }
            : null,
        intensiteKmh: Number.isFinite(ventKt) ? Math.round(ventKt * 1.852) : null,
        pressionHpa: Number.isFinite(Number.parseFloat(s.pressure)) ? Number.parseFloat(s.pressure) : null,
        mouvement:
          Number.isFinite(s.movementDir) && Number.isFinite(vitesseKt)
            ? { bearingDeg: s.movementDir, speedKmh: Math.round(vitesseKt * 1.852) }
            : null,
        misAJourLe: s.lastUpdate ? new Date(s.lastUpdate).toISOString() : null,
        liens: {
          avisPublic: s.publicAdvisory?.url || null,
          cone: s.forecastCone?.zipFile ? `${BASE}/${s.forecastCone.zipFile}`.replace('//storm', '/storm') : null,
          trajectoire: s.forecastTrack?.zipFile ? `${BASE}/${s.forecastTrack.zipFile}`.replace('//storm', '/storm') : null,
        },
      };
    });

  return {
    ok: true,
    inchange: false,
    systemes,
    tracabilite: {
      source: 'NHC',
      produit: 'Systèmes actifs (CurrentStorms)',
      url: URLS.currentStorms,
      emisLe: reponse.emisLe,
      recuLe: reponse.recuLe,
      sha256: reponse.sha256,
      octets: reponse.octets,
      etag: reponse.etag || null,
      lastModified: reponse.lastModified || null,
    },
  };
}

/**
 * Cône officiel et trajectoire prévue d'un système nommé.
 * Retourne `null` si le NHC n'en publie pas : aucun cône n'est jamais fabriqué.
 */
export async function fetchConeOfficiel(urlZip) {
  if (!urlZip) return null;
  const reponse = await fetchBinaire(urlZip, { conditionnel: false });
  if (estErreur(reponse)) return null;

  let fichiers;
  try {
    fichiers = unzip(reponse.corps);
  } catch {
    return null;
  }

  const nomShp = [...fichiers.keys()].find((n) => /\.shp$/i.test(n));
  if (!nomShp) return null;

  const couche = readLayer(fichiers.get(nomShp), fichiers.get(nomShp.replace(/\.shp$/i, '.dbf')));
  const polygones = couche
    .filter((f) => f.geometry.type === 'Polygon' && f.geometry.rings?.length)
    .map((f) => f.geometry.rings[0].map((p) => [
      Math.round(p.lon * 1000) / 1000,
      Math.round(p.lat * 1000) / 1000,
    ]));

  const pointsPrevus = couche
    .filter((f) => f.geometry.type === 'Point' && f.geometry.coordinates)
    .map((f) => ({
      lat: f.geometry.coordinates.lat,
      lon: f.geometry.coordinates.lon,
      echeance: f.properties.FLDATELBL || f.properties.TAU || null,
      intensiteKt: f.properties.MAXWIND ?? null,
      typeDev: f.properties.DVLBL || f.properties.TCDVLP || null,
    }));

  if (!polygones.length && !pointsPrevus.length) return null;
  return {
    polygones,
    pointsPrevus,
    source: 'NHC',
    officiel: true,
    recuLe: reponse.recuLe,
    sha256: reponse.sha256,
  };
}

/**
 * Trajectoire prévue d'un système nommé : la polyligne officielle du NHC.
 * Le zip `forecastTrack` porte une couche ligne (`..._lin.shp`) reliant les
 * positions prévues. Retourne un tableau de points `[lon, lat]` (le format
 * attendu par la carte), ou `null` si le NHC n'en publie pas.
 */
export async function fetchTrajectoireOfficielle(urlZip) {
  if (!urlZip) return null;
  const reponse = await fetchBinaire(urlZip, { conditionnel: false });
  if (estErreur(reponse)) return null;

  let fichiers;
  try {
    fichiers = unzip(reponse.corps);
  } catch {
    return null;
  }

  // La ligne prévue est la couche `_lin` ; à défaut, le premier shapefile.
  const nomShp = [...fichiers.keys()].find((n) => /lin\.shp$/i.test(n))
    || [...fichiers.keys()].find((n) => /\.shp$/i.test(n));
  if (!nomShp) return null;

  const couche = readLayer(fichiers.get(nomShp), fichiers.get(nomShp.replace(/\.shp$/i, '.dbf')));
  return trajectoireDepuisCouche(couche);
}

/**
 * Convertit une couche shapefile de type ligne en polyligne `[lon, lat]`.
 * Fonction pure, isolée pour être testable sans réseau ni binaire.
 */
export function trajectoireDepuisCouche(couche) {
  const points = [];
  (couche || [])
    .filter((f) => f?.geometry?.type === 'PolyLine' && f.geometry.rings?.length)
    .forEach((f) => f.geometry.rings.forEach((partie) => partie.forEach((p) => {
      points.push([
        Math.round(p.lon * 1000) / 1000,
        Math.round(p.lat * 1000) / 1000,
      ]);
    })));

  return points.length >= 2 ? points : null;
}

/**
 * Collecte complète NHC.
 * Aucune exception ne remonte : le rapport dit ce qui a échoué et ce qui n'a
 * pas changé depuis la dernière fois.
 */
export async function collecterNhc() {
  const [zones, texte, actifs] = await Promise.all([
    fetchOutlookZones(),
    fetchOutlookTexte(),
    fetchSystemesActifs(),
  ]);

  const systemes = actifs.ok && !actifs.inchange ? actifs.systemes : null;

  // Cône et trajectoire ne sont demandés que pour les systèmes qui en publient.
  if (systemes) {
    await Promise.all(
      systemes.map(async (s) => {
        const [cone, trajectoire] = await Promise.all([
          s.liens.cone ? fetchConeOfficiel(s.liens.cone) : null,
          s.liens.trajectoire ? fetchTrajectoireOfficielle(s.liens.trajectoire) : null,
        ]);
        if (cone) s.coneOfficiel = cone;
        if (trajectoire) s.trajectoireOfficielle = trajectoire;
      }),
    );
  }

  return {
    zones: zones.ok && !zones.inchange ? zones.zones : null,
    zonesInchangees: !!zones.inchange,
    systemes,
    systemesInchanges: !!actifs.inchange,
    outlookTexte: texte.ok && !texte.inchange ? texte : null,
    outlookInchange: !!texte.inchange,
    emisLe: zones.emisLe || texte.emisLe || null,
    tracabilite: [zones.tracabilite, texte.tracabilite, actifs.tracabilite].filter(Boolean),
    erreurs: [
      !zones.ok && `zones TWO : ${zones.erreur}`,
      !texte.ok && `texte TWO : ${texte.erreur}`,
      !actifs.ok && `systèmes actifs : ${actifs.erreur}`,
    ].filter(Boolean),
  };
}
