/**
 * Journal des changements et états de fraîcheur.
 *
 * Deux rôles :
 *  1. comparer chaque nouveau bulletin au précédent et enregistrer ce qui a
 *     bougé, pour offrir une chronologie lisible et permettre, plus tard, de
 *     confronter l'analyse KDL à ce qui s'est réellement passé ;
 *  2. qualifier la fraîcheur de chaque donnée, sans jamais présenter une
 *     information ancienne comme actuelle.
 *
 * Fonctions pures et E/S de fichier séparées : la détection est testable seule.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const FICHIER = 'journal.json';
const MAX_EVENEMENTS = 400;

// ---------------------------------------------------------------- fraîcheur

/**
 * Trois états, et trois seulement. Une donnée ancienne reste consultable, mais
 * elle est signalée : elle ne doit jamais passer pour actuelle.
 */
export const ETATS = {
  A_JOUR: 'a_jour',
  EN_ATTENTE: 'actualisation_en_attente',
  ANCIENNE: 'donnees_anciennes',
};

const LIBELLES = {
  [ETATS.A_JOUR]: 'À jour',
  [ETATS.EN_ATTENTE]: 'Actualisation en attente',
  [ETATS.ANCIENNE]: 'Données anciennes',
};

/**
 * Qualifie la fraîcheur d'une donnée.
 *
 * @param {string|null} emisLe    heure d'émission officielle, en ISO
 * @param {string|null} recuLe    heure de réception par KDL Cyclone
 * @param {object} [seuils]       durées en minutes
 */
export function fraicheur(emisLe, recuLe, seuils = {}) {
  const attendu = seuils.attenduMin ?? 60;    // cadence normale des bulletins
  const ancien = seuils.ancienMin ?? 180;     // au-delà, la donnée est ancienne

  const maintenant = Date.now();
  const emis = emisLe ? new Date(emisLe).getTime() : null;
  const recu = recuLe ? new Date(recuLe).getTime() : null;

  if (!emis && !recu) {
    return {
      etat: ETATS.ANCIENNE,
      libelle: LIBELLES[ETATS.ANCIENNE],
      ageMinutes: null,
      message: "Heure de publication inconnue : cette information ne peut pas être datée.",
    };
  }

  const reference = emis ?? recu;
  const ageMinutes = Math.max(0, Math.round((maintenant - reference) / 60000));

  let etat = ETATS.A_JOUR;
  if (ageMinutes > ancien) etat = ETATS.ANCIENNE;
  else if (ageMinutes > attendu) etat = ETATS.EN_ATTENTE;

  // L'âge se mesure sur l'heure d'émission officielle, pas sur celle de la
  // collecte : dire « reçu il y a deux heures » juste après une collecte
  // réussie était contradictoire à l'écran.
  const messages = {
    [ETATS.A_JOUR]: `Bulletin publié il y a ${formaterAge(ageMinutes)}.`,
    [ETATS.EN_ATTENTE]: `Publié il y a ${formaterAge(ageMinutes)} ; le prochain bulletin se fait attendre.`,
    [ETATS.ANCIENNE]: `Publié il y a ${formaterAge(ageMinutes)}. Cette information n'est plus d'actualité : vérifiez directement auprès du NHC et de Météo-France.`,
  };

  return {
    etat,
    libelle: LIBELLES[etat],
    ageMinutes,
    ageTexte: formaterAge(ageMinutes),
    emisLe: emisLe || null,
    recuLe: recuLe || null,
    message: messages[etat],
  };
}

export function formaterAge(minutes) {
  if (minutes === null || minutes === undefined) return 'durée inconnue';
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `${heures} heure${heures > 1 ? 's' : ''}`;
  const jours = Math.round(heures / 24);
  return `${jours} jour${jours > 1 ? 's' : ''}`;
}

// ------------------------------------------------------ détection de changement

const CATEGORIES = ['zone', 'potentiel', 'depression', 'tempete', 'ouragan', 'ouragan_majeur'];

/**
 * Compare deux photographies d'un même système et décrit ce qui a changé.
 * Fonction pure. Retourne un tableau d'événements, vide si rien n'a bougé.
 *
 * @param {object|null} avant  état précédent (null = système nouveau)
 * @param {object} apres       état courant
 */
export function detecterChangements(avant, apres) {
  const evts = [];
  const nom = apres.nom || apres.designation || apres.id;

  if (!avant) {
    evts.push({
      type: 'apparition',
      importance: 'majeur',
      texte: `${nom} entre dans la surveillance du NHC.`,
    });
    return evts;
  }

  // Probabilités officielles : le changement le plus important à suivre.
  for (const [champ, echeance] of [['prob48h', '48 heures'], ['prob7j', '7 jours']]) {
    const a = avant[champ];
    const b = apres[champ];
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      const sens = b > a ? 'relevé' : 'abaissé';
      evts.push({
        type: b > a ? 'probabilite_hausse' : 'probabilite_baisse',
        importance: Math.abs(b - a) >= 20 ? 'majeur' : 'normal',
        champ,
        avant: a,
        apres: b,
        texte: `Potentiel officiel à ${echeance} ${sens} de ${a} à ${b} %.`,
      });
    }
  }

  // Changement de catégorie : onde → dépression → tempête → ouragan.
  if (avant.statutCode !== apres.statutCode) {
    const monte = CATEGORIES.indexOf(apres.statutCode) > CATEGORIES.indexOf(avant.statutCode);
    evts.push({
      type: 'categorie',
      importance: 'majeur',
      avant: avant.statut,
      apres: apres.statut,
      texte: monte
        ? `Le système est classé « ${apres.statut} » (précédemment « ${avant.statut} »).`
        : `Le système est rétrogradé en « ${apres.statut} ».`,
    });
  }

  // Attribution d'un nom : moment marquant pour le public.
  if (!avant.nom && apres.nom) {
    evts.push({
      type: 'nommage',
      importance: 'majeur',
      apres: apres.nom,
      texte: `Le système reçoit le nom « ${apres.nom} ».`,
    });
  }

  // Numéro Invest attribué par le NHC.
  const investAvant = (avant.identifiantNhc || '').match(/9\d[LE]/i)?.[0];
  const investApres = (apres.identifiantNhc || '').match(/9\d[LE]/i)?.[0];
  if (!investAvant && investApres) {
    evts.push({
      type: 'invest',
      importance: 'majeur',
      apres: investApres.toUpperCase(),
      texte: `Le système reçoit le numéro d'investigation ${investApres.toUpperCase()}.`,
    });
  }

  // Déplacement de la position : seuil de 120 km pour ignorer le bruit.
  if (Number.isFinite(avant.distanceGuadeloupeKm) && Number.isFinite(apres.distanceGuadeloupeKm)) {
    const delta = apres.distanceGuadeloupeKm - avant.distanceGuadeloupeKm;
    if (Math.abs(delta) >= 120) {
      evts.push({
        type: delta < 0 ? 'rapprochement' : 'eloignement',
        importance: delta < 0 && apres.distanceGuadeloupeKm < 1500 ? 'majeur' : 'normal',
        avant: avant.distanceGuadeloupeKm,
        apres: apres.distanceGuadeloupeKm,
        texte: delta < 0
          ? `Le système s'est rapproché : ${apres.distanceGuadeloupeKm.toLocaleString('fr-FR')} km de la Guadeloupe.`
          : `Le système s'est éloigné : ${apres.distanceGuadeloupeKm.toLocaleString('fr-FR')} km de la Guadeloupe.`,
      });
    }
  }

  // Changement net de déplacement : direction ou vitesse.
  const mvA = avant.mouvement;
  const mvB = apres.mouvement;
  if (mvA && mvB) {
    const ecartCap = Math.abs(((mvB.bearingDeg - mvA.bearingDeg + 540) % 360) - 180);
    if (ecartCap > 35) {
      evts.push({
        type: 'trajectoire',
        importance: 'normal',
        texte: `Le déplacement s'infléchit : le système se dirige désormais vers le ${mvB.directionFr}.`,
      });
    }
  } else if (!mvA && mvB) {
    evts.push({
      type: 'trajectoire',
      importance: 'normal',
      texte: `Un déplacement mesurable apparaît : vers le ${mvB.directionFr}, à ${mvB.speedKmh} km/h.`,
    });
  }

  // Niveau de menace pour la Guadeloupe.
  if (avant.menaceNiveau && apres.menace && avant.menaceNiveau !== apres.menace.niveau) {
    evts.push({
      type: 'menace',
      importance: apres.menace.niveau === 'aucun' ? 'normal' : 'majeur',
      avant: avant.menaceNiveau,
      apres: apres.menace.niveau,
      texte: `Niveau pour la Guadeloupe : ${apres.menace.niveauLabel}.`,
    });
  }

  return evts;
}

/** Systèmes disparus entre deux collectes. */
export function detecterDisparitions(idsAvant, systemesApres) {
  const presents = new Set(systemesApres.map((s) => s.id));
  return idsAvant
    .filter((id) => !presents.has(id))
    .map((id) => ({
      id,
      type: 'disparition',
      importance: 'normal',
      texte: `Le système ${id} n'est plus suivi par le NHC.`,
    }));
}

// -------------------------------------------------------------- persistance

function chemin() {
  return path.join(CONFIG.dataDir, FICHIER);
}

export async function lireJournal() {
  try {
    return JSON.parse(await fsp.readFile(chemin(), 'utf8'));
  } catch {
    return { evenements: [], parSysteme: {} };
  }
}

async function ecrire(journal) {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  const tmp = `${chemin()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(journal), 'utf8');
  await fsp.rename(tmp, chemin());
}

/**
 * Enregistre des événements datés, sans doublon : un même changement déjà
 * consigné dans les six dernières heures n'est pas réécrit à chaque collecte.
 */
export async function consigner(evenementsParSysteme) {
  const journal = await lireJournal();
  const maintenant = new Date().toISOString();
  const limiteDoublon = Date.now() - 6 * 3600 * 1000;
  let ajoutes = 0;

  for (const [id, evts] of Object.entries(evenementsParSysteme)) {
    if (!Array.isArray(journal.parSysteme[id])) journal.parSysteme[id] = [];
    for (const e of evts) {
      const deja = journal.parSysteme[id].some(
        (x) => x.type === e.type
          && x.texte === e.texte
          && new Date(x.t).getTime() > limiteDoublon,
      );
      if (deja) continue;
      const entree = { ...e, t: maintenant, systeme: id };
      journal.parSysteme[id].push(entree);
      journal.evenements.push(entree);
      ajoutes += 1;
    }
    if (journal.parSysteme[id].length > 120) {
      journal.parSysteme[id] = journal.parSysteme[id].slice(-120);
    }
  }

  if (journal.evenements.length > MAX_EVENEMENTS) {
    journal.evenements = journal.evenements.slice(-MAX_EVENEMENTS);
  }

  if (ajoutes > 0) await ecrire(journal);
  return { ajoutes, journal };
}

/** Chronologie d'un système, du plus récent au plus ancien. */
export function chronologie(journal, id, limite = 20) {
  return (journal.parSysteme?.[id] || []).slice(-limite).reverse();
}
