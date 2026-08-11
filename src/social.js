/**
 * Cartes sociales par système.
 *
 * Le rendu est délégué à un script Python utilisant Pillow et la police Inter
 * embarquée dans le dépôt. Pillow n'existe pas en JavaScript sans dépendance
 * npm, et dessiner du texte sans moteur de police donnerait un résultat indigne
 * d'un partage public : c'est le seul endroit du projet où une dépendance
 * externe est acceptée, et elle reste **facultative**.
 *
 * Si Python, Pillow ou la police manquent, la génération échoue proprement et
 * l'image statique de marque prend le relais — le partage n'est jamais cassé.
 *
 * Le cache est indexé sur l'empreinte du bulletin : une image n'est régénérée
 * que lorsque la donnée a réellement changé.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG, ROOT } from './config.js';

const SCRIPT = path.join(ROOT, 'scripts', 'carte-sociale.py');
const IMAGE_REPLI = '/media/og-kdl-cyclone.png';
const FORMATS = ['horizontal', 'carre', 'vertical'];

/** Interpréteurs candidats : l'environnement du projet d'abord. */
const INTERPRETEURS = [
  path.join(ROOT, '.venv', 'bin', 'python3'),
  process.env.KDL_CYCLONE_PYTHON,
  'python3',
].filter(Boolean);

let interpreteurRetenu = null;
let diagnostic = { verifie: false, disponible: false, raison: null, interpreteur: null };

function dossierCartes() {
  return path.join(CONFIG.dataDir, 'social');
}

/** Vérifie une fois pour toutes qu'un interpréteur avec Pillow est utilisable. */
export async function verifierGenerateur() {
  if (diagnostic.verifie) return diagnostic;

  const police = path.join(ROOT, 'assets', 'fonts', 'Inter-Bold.otf');
  if (!fs.existsSync(police)) {
    diagnostic = {
      verifie: true, disponible: false, interpreteur: null,
      raison: `police embarquée absente : ${police}`,
    };
    return diagnostic;
  }

  for (const py of INTERPRETEURS) {
    const ok = await new Promise((resoudre) => {
      let sortie = '';
      const p = spawn(py, ['-c', 'import PIL; print(PIL.__version__)'], { stdio: ['ignore', 'pipe', 'ignore'] });
      p.stdout.on('data', (d) => { sortie += d; });
      p.on('error', () => resoudre(null));
      p.on('close', (code) => resoudre(code === 0 ? sortie.trim() : null));
      setTimeout(() => { p.kill(); resoudre(null); }, 8000);
    });
    if (ok) {
      interpreteurRetenu = py;
      diagnostic = { verifie: true, disponible: true, interpreteur: py, versionPillow: ok, raison: null };
      return diagnostic;
    }
  }

  diagnostic = {
    verifie: true, disponible: false, interpreteur: null,
    raison: 'Pillow introuvable — voir docs/DEPLOIEMENT.md pour créer l\'environnement Python du projet',
  };
  return diagnostic;
}

/** Clé de cache : elle change dès que l'une des valeurs affichées change. */
export function cleCache(systeme, genereLe) {
  const signature = JSON.stringify([
    systeme.id,
    systeme.nom,
    systeme.statut,
    systeme.prob48h,
    systeme.prob7j,
    systeme.distanceGuadeloupeKm,
    systeme.potentiel?.score,
    systeme.fraicheur?.etat,
    // L'heure du bulletin fait partie de l'image : elle en fait partie aussi.
    systeme.fraicheur?.emisLe || genereLe,
  ]);
  return crypto.createHash('sha256').update(signature).digest('hex').slice(0, 16);
}

function heureLocaleFr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: CONFIG.timezone,
  }).replace(':', ' h ');
}

/** Traduit un système en données d'affichage — aucune valeur inventée. */
function pourImage(systeme) {
  const evo = systeme.evolutions?.potentiel24h || systeme.evolutions?.potentiel12h;
  return {
    id: systeme.id,
    nom: systeme.nom || systeme.designation,
    designation: systeme.designation,
    classification: systeme.statut,
    prob48h: Number.isFinite(systeme.prob48h) ? systeme.prob48h : null,
    prob7j: Number.isFinite(systeme.prob7j) ? systeme.prob7j : null,
    distanceKm: Number.isFinite(systeme.distanceGuadeloupeKm) ? systeme.distanceGuadeloupeKm : null,
    potentiel: Number.isFinite(systeme.potentiel?.score) ? systeme.potentiel.score : null,
    source: 'NHC',
    heureLocale: heureLocaleFr(systeme.fraicheur?.emisLe || systeme.misAJourLe),
    tendance: evo && Number.isFinite(evo.delta) ? { delta: Math.round(evo.delta) } : null,
    ancienne: systeme.fraicheur?.etat === 'donnees_anciennes',
  };
}

/**
 * Produit les trois formats pour un système, ou retourne le repli statique.
 * @returns {Promise<{ok:boolean, prefixe?:string, formats?:object, repli?:string, raison?:string}>}
 */
export async function genererCartes(systeme, genereLe) {
  const diag = await verifierGenerateur();
  if (!diag.disponible) {
    return { ok: false, repli: IMAGE_REPLI, raison: diag.raison };
  }

  const cle = cleCache(systeme, genereLe);
  const prefixe = `${systeme.id}-${cle}`;
  const dossier = dossierCartes();

  // Déjà en cache pour cette version exacte du bulletin : rien à refaire.
  const existant = FORMATS.every((f) => fs.existsSync(path.join(dossier, `${prefixe}-${f}.png`)));
  if (existant) {
    return { ok: true, prefixe, cache: true, formats: FORMATS };
  }

  const entree = JSON.stringify({ dossier, prefixe, systeme: pourImage(systeme) });

  const resultat = await new Promise((resoudre) => {
    let sortie = '';
    let erreur = '';
    const p = spawn(interpreteurRetenu, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { sortie += d; });
    p.stderr.on('data', (d) => { erreur += d; });
    p.on('error', (e) => resoudre({ ok: false, erreur: e.message }));
    p.on('close', () => {
      try {
        resoudre(JSON.parse(sortie));
      } catch {
        resoudre({ ok: false, erreur: erreur.slice(0, 200) || 'sortie illisible' });
      }
    });
    const minuteur = setTimeout(() => { p.kill(); resoudre({ ok: false, erreur: 'délai dépassé' }); }, 25000);
    p.on('close', () => clearTimeout(minuteur));
    p.stdin.end(entree);
  });

  if (!resultat.ok) {
    return { ok: false, repli: IMAGE_REPLI, raison: resultat.erreur };
  }
  return { ok: true, prefixe, cache: false, formats: FORMATS };
}

/** Génère les cartes de tous les systèmes et purge les versions périmées. */
export async function rafraichirCartes(systemes, genereLe) {
  const diag = await verifierGenerateur();
  if (!diag.disponible) {
    return { disponible: false, raison: diag.raison, generees: 0 };
  }

  const prefixesActifs = new Set();
  let generees = 0;
  let echecs = 0;

  for (const s of systemes) {
    const r = await genererCartes(s, genereLe);
    if (r.ok) {
      prefixesActifs.add(r.prefixe);
      s.carteSociale = {
        prefixe: r.prefixe,
        horizontal: `/social/${r.prefixe}-horizontal.png`,
        carre: `/social/${r.prefixe}-carre.png`,
        vertical: `/social/${r.prefixe}-vertical.png`,
      };
      if (!r.cache) generees += 1;
    } else {
      s.carteSociale = { repli: IMAGE_REPLI, raison: r.raison };
      echecs += 1;
    }
  }

  // Purge : une image dont le bulletin n'est plus d'actualité n'a plus lieu d'être.
  try {
    const dossier = dossierCartes();
    for (const fichier of await fsp.readdir(dossier)) {
      const prefixe = fichier.replace(/-(horizontal|carre|vertical)\.png$/, '');
      if (!prefixesActifs.has(prefixe)) await fsp.unlink(path.join(dossier, fichier));
    }
  } catch { /* dossier absent : rien à purger */ }

  return { disponible: true, generees, echecs, versionPillow: diag.versionPillow };
}

export { IMAGE_REPLI, FORMATS };
