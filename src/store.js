/**
 * Persistance sur fichiers JSON, écriture atomique.
 *
 * Choix assumé : pas de SQLite. `better-sqlite3` demande une compilation native,
 * bloquée par la politique `ignore-scripts` de l'atelier, et `node:sqlite` n'existe
 * pas en Node 20. Le volume de données — quelques dizaines de systèmes, un
 * historique borné — ne justifie pas une base. Zéro dépendance, zéro build.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const F_ETAT = 'etat.json';
const F_HISTORIQUE = 'historique.json';
const F_BULLETINS = 'bulletins.json';

function assurerDossier() {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
}

async function ecrireAtomique(nom, donnees) {
  assurerDossier();
  const cible = path.join(CONFIG.dataDir, nom);
  const temporaire = `${cible}.${process.pid}.tmp`;
  await fsp.writeFile(temporaire, JSON.stringify(donnees), 'utf8');
  await fsp.rename(temporaire, cible);
}

async function lire(nom, defaut) {
  try {
    const brut = await fsp.readFile(path.join(CONFIG.dataDir, nom), 'utf8');
    return JSON.parse(brut);
  } catch {
    return defaut;
  }
}

/** Dernier état complet publié par le collecteur. */
export const etat = {
  lire: () => lire(F_ETAT, null),
  ecrire: (v) => ecrireAtomique(F_ETAT, v),
};

/**
 * Bulletins météo complets, rangés à part de l'état principal : ils pèsent
 * plusieurs centaines de kilooctets et n'intéressent que le territoire
 * réellement consulté.
 */
export const bulletins = {
  lire: () => lire(F_BULLETINS, {}),
  ecrire: (v) => ecrireAtomique(F_BULLETINS, v),
};

/**
 * Historique par système : une entrée par analyse, bornée à `historyDepth`.
 * Sert aux évolutions à 6, 12 et 24 heures et aux courbes de la fiche détaillée.
 */
export const historique = {
  async lire() {
    return lire(F_HISTORIQUE, {});
  },

  async ajouter(entreesParSysteme) {
    const h = await lire(F_HISTORIQUE, {});
    const horodatage = new Date().toISOString();
    for (const [id, valeur] of Object.entries(entreesParSysteme)) {
      if (!Array.isArray(h[id])) h[id] = [];
      h[id].push({ t: horodatage, ...valeur });
      if (h[id].length > CONFIG.historyDepth) h[id] = h[id].slice(-CONFIG.historyDepth);
    }
    // Purge des systèmes disparus depuis plus de 15 jours.
    const limite = Date.now() - 15 * 24 * 3600 * 1000;
    for (const [id, serie] of Object.entries(h)) {
      const dernier = serie[serie.length - 1];
      if (!dernier || new Date(dernier.t).getTime() < limite) delete h[id];
    }
    await ecrireAtomique(F_HISTORIQUE, h);
    return h;
  },
};

/**
 * Valeur d'un champ telle qu'elle était il y a `heures`, et son évolution.
 * Retourne `null` si l'historique ne remonte pas assez loin — jamais une
 * extrapolation.
 */
export function evolution(serie, champ, heures) {
  if (!Array.isArray(serie) || serie.length < 2) return null;
  const cible = Date.now() - heures * 3600 * 1000;
  const tolerance = Math.max(1.5, heures * 0.35) * 3600 * 1000;

  let candidat = null;
  let ecart = Infinity;
  for (const e of serie) {
    const d = Math.abs(new Date(e.t).getTime() - cible);
    if (d < ecart && d <= tolerance) {
      ecart = d;
      candidat = e;
    }
  }
  if (!candidat || !Number.isFinite(candidat[champ])) return null;

  const actuel = serie[serie.length - 1]?.[champ];
  if (!Number.isFinite(actuel)) return null;

  const delta = actuel - candidat[champ];
  return {
    heures,
    avant: candidat[champ],
    maintenant: actuel,
    delta: Math.round(delta * 10) / 10,
    sens: delta > 2 ? 'hausse' : delta < -2 ? 'baisse' : 'stable',
    mesureLe: candidat.t,
  };
}
