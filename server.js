/**
 * KDL Cyclone — serveur.
 *
 * Node natif seul : aucune dépendance, donc aucune surface d'attaque héritée
 * d'un paquet tiers. Écoute sur 127.0.0.1 ; la publication passe par le reverse
 * proxy nginx du VPS, jamais par une écoute directe sur 0.0.0.0.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

import { CONFIG, ROOT } from './src/config.js';
import { collecter } from './src/collector.js';
import { etat as storeEtat, bulletins as storeBulletins } from './src/store.js';
import { PAGES, metaSysteme, balises, sitemap, robots } from './src/seo.js';
import { lireTable as lireSlugs, resoudre as resoudreSlug } from './src/slugs.js';
import { valider, enregistrer, verifierDebit, synthese as syntheseRetours, LIMITES } from './src/feedback.js';
import { mesure } from './src/mesure.js';
import { cheminImage, SECTEURS, CANAUX } from './src/sources/satellite.js';
import { COMMUNES, communePar } from './src/communes.js';
import { territoire as territoirePar } from './src/territoires.js';
import { fetchBulletin } from './src/sources/meteo.js';

const PUBLIC = path.join(ROOT, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/**
 * Identifiant de build : empreinte courte des fichiers de la coquille.
 *
 * La version seule ne suffit pas — on peut corriger un script sans monter de
 * version, et les visiteurs garderaient alors l'ancien cache. Cet identifiant
 * change dès qu'un octet change, ce qui renomme le cache du service worker et
 * force sa réinstallation.
 */
const BUILD = (() => {
  const fichiers = [
    'index.html', 'sw.js', 'css/app.css',
    'js/app.js', 'js/carte.js', 'js/cadran.js', 'js/satellite.js',
    'js/graphiques.js', 'js/installation.js', 'js/beta.js', 'js/preparation.js',
  ];
  const empreinte = crypto.createHash('sha256');
  fichiers.forEach((f) => {
    try { empreinte.update(fs.readFileSync(path.join(ROOT, 'public', f))); }
    catch { empreinte.update(f); }   // fichier absent : l'empreinte le note quand même
  });
  return empreinte.digest('hex').slice(0, 8);
})();

const DEMARRE_LE = new Date().toISOString();

/**
 * Version minimale encore compatible avec les données servies. En dessous,
 * l'application invitera à se mettre à jour plutôt que d'afficher des champs
 * qu'elle ne sait pas lire.
 */
const VERSION_MINIMALE = '0.9.0';

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * En-têtes de sécurité. La politique de contenu interdit toute ressource
 * externe : c'est la traduction technique de la promesse « aucun appel tiers
 * depuis le navigateur de l'utilisateur ».
 */
/**
 * Le thème est appliqué par un script inline, avant le premier rendu, pour
 * éviter le flash blanc au chargement. Plutôt que d'ouvrir la politique avec
 * 'unsafe-inline', on autorise exactement ce script par son empreinte.
 */
function hashScriptsInline(html) {
  const empreintes = [];
  const motif = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = motif.exec(html)) !== null) {
    const sha = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
    empreintes.push(`'sha256-${sha}'`);
  }
  return empreintes;
}

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${hashScriptsInline(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')).join(' ')}`,
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  'upgrade-insecure-requests',
].join('; ');

function enTetesSecurite(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

/** Coquille HTML lue une fois, puis complétée par route. */
const GABARIT = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

/**
 * Rend la page pour une route donnée, avec ses propres métadonnées.
 * L'application reste une page unique côté navigateur ; seul le `<head>`
 * change, ce qui suffit au référencement et aux aperçus de partage.
 */
function pageHtml(chemin, etatCourantValeur, canoniqueForcee) {
  let page = PAGES[chemin];

  if (!page && chemin.startsWith('/systeme/')) {
    const id = decodeURIComponent(chemin.slice('/systeme/'.length));
    const systeme = etatCourantValeur?.systemes?.find((s) => s.id === id);
    page = metaSysteme(systeme);
  }
  if (!page) page = PAGES['/'];

  return GABARIT
    .replace('<!--KDL_META-->', balises(page, canoniqueForcee || chemin))
    .replace('<html lang="fr"', `<html lang="fr" data-route="${page.vue}"`);
}

/**
 * Bulletins par commune, gardés dix minutes en mémoire.
 *
 * Sans ce cache, chaque visiteur consultant la même commune déclencherait un
 * appel : le quota gratuit d'Open-Meteo dépendrait alors du trafic, ce que
 * l'architecture évite depuis le premier jour. Ici, une commune consultée cent
 * fois en cinq minutes coûte une seule requête.
 */
const cacheLieux = new Map();
const DUREE_CACHE_LIEU = 5 * 60 * 1000;

async function bulletinDuLieu(territoire, lieu) {
  const cle = `${territoire}:${lieu.cle}`;
  const garde = cacheLieux.get(cle);
  if (garde && Date.now() - garde.lu < DUREE_CACHE_LIEU) return garde.valeur;

  const fuseau = (territoirePar(territoire) || {}).fuseau || 'America/Guadeloupe';
  const brut = await fetchBulletin({ lat: lieu.lat, lon: lieu.lon }, fuseau);
  const valeur = {
    ...brut,
    lieu: { cle: lieu.cle, nom: lieu.nom, lat: lieu.lat, lon: lieu.lon },
    territoire,
  };
  cacheLieux.set(cle, { valeur, lu: Date.now() });

  // Le cache ne grandit pas indéfiniment : 88 lieux au total, on borne large.
  if (cacheLieux.size > 120) {
    const plusAncien = [...cacheLieux.entries()].sort((a, b) => a[1].lu - b[1].lu)[0];
    cacheLieux.delete(plusAncien[0]);
  }
  return valeur;
}

/** Cache mémoire du dernier état, pour ne pas relire le disque à chaque requête. */
let cacheEtat = { valeur: null, etag: null, lu: 0 };

async function etatCourant() {
  if (cacheEtat.valeur && Date.now() - cacheEtat.lu < 15000) return cacheEtat;
  const valeur = await storeEtat.lire();
  const etag = valeur
    ? `"${crypto.createHash('sha1').update(valeur.genereLe).digest('hex').slice(0, 16)}"`
    : null;
  cacheEtat = { valeur, etag, lu: Date.now() };
  return cacheEtat;
}

function repondre(req, res, { statut = 200, corps, type, cache = 'no-cache', etag }) {
  enTetesSecurite(res);
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  if (etag) res.setHeader('ETag', etag);

  if (etag && req.headers['if-none-match'] === etag) {
    res.writeHead(304).end();
    return;
  }

  const buf = Buffer.isBuffer(corps) ? corps : Buffer.from(corps);
  const accepteGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const compressible = /text|json|javascript|svg|manifest/.test(type);

  if (accepteGzip && compressible && buf.length > 1024) {
    const gz = zlib.gzipSync(buf, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.writeHead(statut).end(req.method === 'HEAD' ? undefined : gz);
    return;
  }
  res.writeHead(statut).end(req.method === 'HEAD' ? undefined : buf);
}

const json = (req, res, donnees, statut = 200, cache = 'no-cache', etag) =>
  repondre(req, res, {
    statut,
    corps: JSON.stringify(donnees),
    type: TYPES_MIME['.json'],
    cache,
    etag,
  });

async function servirFichier(req, res, cheminRelatif) {
  // Anti-traversée : le chemin résolu doit rester sous public/.
  const cible = path.resolve(PUBLIC, `.${path.posix.normalize(cheminRelatif)}`);
  if (!cible.startsWith(PUBLIC)) {
    return json(req, res, { erreur: 'Chemin refusé' }, 403);
  }

  let stat;
  try {
    stat = await fsp.stat(cible);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const ext = path.extname(cible).toLowerCase();
  const contenu = await fsp.readFile(cible);
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(36)}"`;

  // Le fond de carte, les icônes et les fontes ne changent qu'à la publication :
  // cache long. Les fontes sont sous-ensemblées, leur nom change avec elles.
  const immuable = /^\/(geo|icons|fonts)\//.test(cheminRelatif);
  return repondre(req, res, {
    corps: contenu,
    type: TYPES_MIME[ext] || 'application/octet-stream',
    cache: immuable ? 'public, max-age=604800' : 'no-cache',
    etag,
  });
}

const serveur = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const chemin = url.pathname;

    // Une seule route accepte l'écriture, et elle est nommée explicitement.
    // Tout le reste de l'application est en lecture seule.
    if (req.method === 'POST') {
      if (chemin === '/api/feedback') return traiterRetour(req, res, url);
      return json(req, res, { erreur: 'Méthode non autorisée' }, 405);
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      return json(req, res, { erreur: 'Méthode non autorisée' }, 405);
    }

    // ---- API
    if (chemin === '/api/etat') {
      const { valeur, etag } = await etatCourant();
      if (!valeur) {
        return json(req, res, {
          erreur: 'Aucune donnée collectée pour le moment.',
          conseil: 'La première collecte est en cours. Réessayez dans une minute.',
        }, 503);
      }
      return json(req, res, valeur, 200, 'no-cache', etag);
    }

    if (chemin.startsWith('/api/systemes/')) {
      const { valeur } = await etatCourant();
      const id = decodeURIComponent(chemin.slice('/api/systemes/'.length));
      const systeme = valeur?.systemes?.find((s) => s.id === id);
      if (!systeme) return json(req, res, { erreur: 'Système inconnu ou disparu.' }, 404);
      return json(req, res, { systeme, genereLe: valeur.genereLe });
    }

    if (chemin === '/api/sante') {
      const { valeur } = await etatCourant();
      const ageMs = valeur ? Date.now() - new Date(valeur.genereLe).getTime() : null;
      const perime = ageMs === null || ageMs > CONFIG.stalenessCriticalMs;
      return json(req, res, {
        service: 'kdl-cyclone',
        version: VERSION,
        demarreLe: DEMARRE_LE,
        derniereCollecte: valeur?.genereLe || null,
        ageDonneesMinutes: ageMs === null ? null : Math.round(ageMs / 60000),
        etat: perime ? 'degrade' : 'ok',
        systemesSuivis: valeur?.systemes?.length ?? 0,
        degradations: valeur?.degradations ?? [],
      }, perime ? 503 : 200);
    }

    if (chemin === '/api/version') {
      return json(req, res, { nom: 'KDL Cyclone', version: VERSION }, 200, 'public, max-age=300');
    }

    // Mesure d'audience : compteurs agrégés, aucune donnée personnelle.
    // Le GET suffit — pas de corps de requête, donc rien à exfiltrer.
    if (chemin === '/api/mesure') {
      const ok = mesure.enregistrer(url.searchParams.get('e'), url.searchParams.get('p'));
      return json(req, res, { enregistre: ok }, 200, 'no-store');
    }
    if (chemin === '/api/audience') {
      return json(req, res, mesure.synthese(), 200, 'public, max-age=600');
    }

    // Bulletin météo d'un territoire, servi à la demande : il ne voyage pas
    // dans l'état principal, qui est chargé à chaque visite.
    // Lieux couverts par la météo locale. Liste statique, produite hors ligne :
    // aucun service de géocodage n'est interrogé pendant l'exécution.
    if (chemin === '/api/communes') {
      return json(req, res, COMMUNES, 200, 'public, max-age=86400');
    }

    if (chemin.startsWith('/api/meteo/')) {
      const cle = decodeURIComponent(chemin.slice('/api/meteo/'.length));
      if (!/^[a-z-]{2,32}$/.test(cle)) return json(req, res, { erreur: 'Territoire invalide' }, 400);

      // Bulletin d'une commune précise, à la demande. Le lieu doit figurer
      // dans la liste : on ne prend jamais de coordonnées arbitraires, ce qui
      // ferait de l'application un relais de requêtes ouvert.
      const lieuDemande = url.searchParams.get('lieu');
      if (lieuDemande) {
        if (!/^[a-z0-9-]{2,48}$/.test(lieuDemande)) {
          return json(req, res, { erreur: 'Lieu invalide' }, 400);
        }
        const lieu = communePar(cle, lieuDemande);
        if (!lieu) return json(req, res, { erreur: 'Lieu inconnu pour ce territoire' }, 404);
        try {
          const bulletin = await bulletinDuLieu(cle, lieu);
          return json(req, res, bulletin, 200, 'public, max-age=600');
        } catch {
          return json(req, res, { erreur: 'Météo momentanément indisponible pour ce lieu' }, 503);
        }
      }

      const tous = await storeBulletins.lire();
      const b = tous[cle];
      if (!b) return json(req, res, { erreur: 'Bulletin indisponible pour ce territoire' }, 404);
      return json(req, res, b, 200, 'no-cache');
    }

    if (chemin === '/api/retours') {
      return json(req, res, await syntheseRetours(), 200, 'no-store');
    }

    // ---- Cartes sociales générées : immuables, leur nom porte l'empreinte.
    if (chemin.startsWith('/social/')) {
      const nom = path.basename(chemin);
      if (!/^[\w.-]+\.png$/.test(nom)) return json(req, res, { erreur: 'Nom refusé' }, 400);
      const cible = path.join(CONFIG.dataDir, 'social', nom);
      try {
        const contenu = await fsp.readFile(cible);
        return repondre(req, res, {
          corps: contenu,
          type: TYPES_MIME['.png'],
          cache: 'public, max-age=604800, immutable',
        });
      } catch {
        // Image absente : on renvoie la bannière de marque plutôt qu'une 404,
        // pour qu'un aperçu social ne se retrouve jamais sans visuel.
        const repli = await servirFichier(req, res, '/media/og-kdl-cyclone.png');
        if (repli !== null) return repli;
        return json(req, res, { erreur: 'Image introuvable' }, 404);
      }
    }

    // ---- Slugs publics : /systemes/<slug>, avec redirection permanente
    // vers le slug canonique pour que les anciens liens restent valables.
    if (chemin.startsWith('/systemes/')) {
      const slug = decodeURIComponent(chemin.slice('/systemes/'.length)).replace(/\/$/, '');
      const table = await lireSlugs();
      const trouve = resoudreSlug(table, slug);
      if (!trouve) {
        const { valeur: etatPourPage } = await etatCourant();
        return repondre(req, res, {
          statut: 404,
          corps: pageHtml('/', etatPourPage),
          type: TYPES_MIME['.html'],
          cache: 'no-cache',
        });
      }
      if (trouve.redirection) {
        enTetesSecurite(res);
        res.setHeader('Location', `/systemes/${trouve.canonique}`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.writeHead(301).end();
      }
      const { valeur } = await etatCourant();
      return repondre(req, res, {
        corps: pageHtml(`/systeme/${trouve.id}`, valeur, `/systemes/${trouve.canonique}`),
        type: TYPES_MIME['.html'],
        cache: 'no-cache',
      });
    }

    // ---- Images satellite proxifiées. Leur nom porte l'heure d'acquisition :
    // elles ne changent jamais, donc cache long et immuable.
    if (chemin.startsWith('/satellite/')) {
      const cible = cheminImage(path.basename(chemin));
      if (!cible) return json(req, res, { erreur: 'Nom refusé' }, 400);
      try {
        const contenu = await fsp.readFile(cible);
        return repondre(req, res, {
          corps: contenu,
          type: 'image/jpeg',
          cache: 'public, max-age=86400, immutable',
        });
      } catch {
        return json(req, res, { erreur: 'Image expirée du cache' }, 404);
      }
    }

    if (chemin === '/api/satellite') {
      const { valeur } = await etatCourant();
      const s = valeur?.satellite;
      if (!s) return json(req, res, { erreur: 'Boucle non disponible' }, 503);
      return json(req, res, {
        ...s,
        secteurs: SECTEURS,
        canaux: CANAUX,
        poidsTotalKo: Math.round((s.images || []).reduce((t, i) => t + (i.octets || 0), 0) / 1024),
      }, 200, 'no-cache');
    }

    // ---- Flux d'événements : la carte se met à jour sans rechargement.
    if (chemin === '/api/flux') return fluxEvenements(req, res);

    // ---- Référencement
    if (chemin === '/sitemap.xml') {
      const { valeur } = await etatCourant();
      return repondre(req, res, {
        corps: sitemap(valeur?.systemes || []),
        type: 'application/xml; charset=utf-8',
        cache: 'public, max-age=3600',
      });
    }
    if (chemin === '/robots.txt') {
      return repondre(req, res, {
        corps: robots(),
        type: TYPES_MIME['.txt'],
        cache: 'public, max-age=86400',
      });
    }

    // ---- Routes de l'application : HTML complété selon la page demandée.
    const estRouteApp = PAGES[chemin] || chemin.startsWith('/systeme/');
    if (estRouteApp) {
      const { valeur } = await etatCourant();
      return repondre(req, res, {
        corps: pageHtml(chemin, valeur),
        type: TYPES_MIME['.html'],
        cache: 'no-cache',
      });
    }

    // Le service worker porte la version de l'application : c'est ce qui
    // déclenche sa réinstallation et la mise à jour de la coquille chez les
    // visiteurs déjà venus.
    if (chemin === '/sw.js') {
      const source = await fsp.readFile(path.join(PUBLIC, 'sw.js'), 'utf8');
      return repondre(req, res, {
        corps: source
          .replace(/__VERSION__/g, VERSION)
          .replace(/__BUILD__/g, BUILD),
        type: TYPES_MIME['.js'],
        // Un service worker servi depuis un cache périmé fige l'application
        // chez le visiteur : celui-ci ne doit jamais être mis en cache.
        cache: 'no-cache, no-store, must-revalidate',
      });
    }

    // ---- Version installée, lisible sans passer par le service worker.
    if (chemin === '/version.json') {
      return json(req, res, {
        version: VERSION,
        build: BUILD,
        deployeLe: DEMARRE_LE,
        versionMinimale: VERSION_MINIMALE,
        cache: `kdl-cyclone-${VERSION}-${BUILD}`,
      }, 200, 'no-store');
    }

    // ---- Fichiers statiques
    if (chemin !== '/index.html') {
      const servi = await servirFichier(req, res, chemin);
      if (servi !== null) return servi;
    }

    // ---- Repli : toute route inconnue hors API rend l'application, pour que
    // la navigation hors ligne et les liens partagés aboutissent toujours.
    if (!chemin.startsWith('/api/')) {
      const { valeur } = await etatCourant();
      return repondre(req, res, {
        corps: pageHtml('/', valeur),
        type: TYPES_MIME['.html'],
        cache: 'no-cache',
        statut: chemin === '/index.html' ? 200 : 404,
      });
    }

    return json(req, res, { erreur: 'Ressource introuvable' }, 404);
  } catch (err) {
    console.error('[kdl-cyclone] erreur serveur :', err);
    if (!res.headersSent) return json(req, res, { erreur: 'Erreur interne' }, 500);
    return res.end();
  }
});

/**
 * Réception d'un retour de testeur. Le corps est lu par morceaux et la
 * connexion est coupée dès que la taille dépasse la limite : une requête
 * volumineuse n'est jamais chargée en mémoire.
 */
async function traiterRetour(req, res, url) {
  const origine = req.headers.origin;
  const hote = req.headers.host;
  // Contrôle d'origine : une origine étrangère est refusée. Une requête sans
  // origine (client en ligne de commande) reste acceptée, elle n'est pas un
  // risque de falsification depuis un autre site.
  if (origine) {
    let origineValide = false;
    try {
      origineValide = new URL(origine).host === hote;
    } catch { origineValide = false; }
    if (!origineValide) return json(req, res, { erreur: 'Origine refusée' }, 403);
  }

  const typeContenu = req.headers['content-type'] || '';
  if (!typeContenu.includes('application/json')) {
    return json(req, res, { erreur: 'Format attendu : application/json' }, 415);
  }

  const annonce = Number(req.headers['content-length']);
  if (Number.isFinite(annonce) && annonce > LIMITES.corpsMaxOctets) {
    return json(req, res, { erreur: 'Retour trop volumineux.' }, 413);
  }

  const debit = verifierDebit(req.socket.remoteAddress);
  if (!debit.ok) return json(req, res, { erreur: debit.raison }, 429);

  let corps = '';
  let trop = false;
  for await (const morceau of req) {
    corps += morceau;
    if (corps.length > LIMITES.corpsMaxOctets) { trop = true; break; }
  }
  if (trop) {
    req.destroy();
    return json(req, res, { erreur: 'Retour trop volumineux.' }, 413);
  }

  let brut;
  try {
    brut = JSON.parse(corps);
  } catch {
    return json(req, res, { erreur: 'Contenu illisible.' }, 400);
  }

  const resultat = valider(brut, {
    plateforme: (req.headers['user-agent'] || '').slice(0, 120),
    versionApp: VERSION,
  });

  // Un piège déclenché ne dit jamais qu'il l'a été : le robot croit avoir réussi.
  if (resultat.piege) {
    return json(req, res, { ok: true, id: 'KC-000000' }, 200, 'no-store');
  }
  if (!resultat.ok) {
    return json(req, res, { ok: false, erreurs: resultat.erreurs }, 400, 'no-store');
  }

  const id = await enregistrer(resultat.retour, debit.cle);
  // Journal volontairement pauvre : ni message, ni adresse, ni identifiant client.
  console.log(`[kdl-cyclone] retour ${id} (${resultat.retour.categorie})`);
  return json(req, res, {
    ok: true,
    id,
    message: `Merci. Votre retour est enregistré sous la référence ${id}.`,
  }, 201, 'no-store');
}

/**
 * Flux d'événements (Server-Sent Events).
 *
 * Le serveur pousse un signal quand une collecte publie du neuf : le navigateur
 * rafraîchit alors ses données sans recharger la page, et sans interroger le
 * serveur en boucle. Un client déconnecté se reconnecte seul ; un client qui
 * n'y a pas droit — trop de connexions — retombe sur son interrogation
 * périodique existante.
 */
const abonnes = new Set();
const MAX_ABONNES = 200;

function fluxEvenements(req, res) {
  if (abonnes.size >= MAX_ABONNES) {
    return json(req, res, { erreur: 'Trop de connexions simultanées' }, 503);
  }

  enTetesSecurite(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Empêche la mise en tampon par un reverse proxy, qui figerait le flux.
    'X-Accel-Buffering': 'no',
  });

  const client = { res, vivant: true };
  abonnes.add(client);

  res.write('retry: 10000\n\n');
  res.write(`event: bonjour\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);

  // Battement régulier : sans lui, un intermédiaire coupe la connexion inactive.
  const battement = setInterval(() => {
    try { res.write(': battement\n\n'); } catch { fermer(); }
  }, 25000);

  function fermer() {
    if (!client.vivant) return;
    client.vivant = false;
    clearInterval(battement);
    abonnes.delete(client);
    try { res.end(); } catch { /* déjà fermée */ }
  }

  req.on('close', fermer);
  req.on('error', fermer);
  return undefined;
}

/** Diffuse un événement à tous les abonnés encore connectés. */
function diffuser(type, donnees) {
  const charge = `event: ${type}\ndata: ${JSON.stringify(donnees)}\n\n`;
  for (const client of [...abonnes]) {
    try {
      client.res.write(charge);
    } catch {
      abonnes.delete(client);
    }
  }
}

// ---- Boucle de collecte
let collecteEnCours = false;
async function tourDeCollecte(raison) {
  if (collecteEnCours) return;
  collecteEnCours = true;
  try {
    const r = await collecter();
    cacheEtat = { valeur: null, etag: null, lu: 0 };

    // On annonce ce qui a réellement changé : le client décide quoi recharger.
    diffuser('maj', {
      genereLe: r.genereLe,
      systemes: r.systemes.length,
      risque: r.situation.risque.niveau,
      derniereImageSatellite: r.satellite?.derniereImage || null,
      changements: (r.changements || []).length,
    });
    console.log(
      `[kdl-cyclone] collecte ${raison} : ${r.systemes.length} système(s), risque ${r.situation.risque.label}, ${r.dureeCollecteMs} ms` +
        (r.degradations.length ? ` — dégradations : ${r.degradations.length}` : ''),
    );
  } catch (err) {
    console.error('[kdl-cyclone] échec de collecte :', err.message);
  } finally {
    collecteEnCours = false;
  }
}

/**
 * Démarrage explicite.
 *
 * La version précédente devinait si le module était le point d'entrée en
 * comparant `process.argv[1]`. Sous PM2 en mode fork, cet argument pointe vers
 * le lanceur de PM2 et non vers ce fichier : le serveur restait donc vivant
 * sans jamais écouter. On expose une fonction, et `demarrer.mjs` l'appelle.
 */
export function demarrer() {
  serveur.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`KDL Cyclone ${VERSION} — http://${CONFIG.host}:${CONFIG.port}`);
    tourDeCollecte('initiale');
  });

  const minuteur = setInterval(() => tourDeCollecte('planifiée'), CONFIG.collectIntervalMs);

  const arret = (signal) => {
    console.log(`\n[kdl-cyclone] arrêt (${signal})`);
    clearInterval(minuteur);
    serveur.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => arret('SIGINT'));
  process.on('SIGTERM', () => arret('SIGTERM'));

  return serveur;
}

export { serveur };
