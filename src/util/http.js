/**
 * Client HTTP traçable.
 *
 * Chaque récupération conserve de quoi prouver d'où vient la donnée et quand
 * elle a été émise : URL exacte, heure d'émission annoncée par la source, heure
 * de réception, empreinte SHA-256 du document brut, ETag et Last-Modified.
 *
 * Les requêtes conditionnelles évitent de retélécharger un bulletin inchangé :
 * c'est à la fois plus respectueux du fournisseur et plus rapide.
 */
import crypto from 'node:crypto';
import { CONFIG } from '../config.js';
import { expurger } from './secrets.js';

class HttpError extends Error {
  constructor(message, status, url, retryAfter = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    /** Valeur de l'en-tête `Retry-After`, en secondes, si la source en donne une. */
    this.retryAfter = retryAfter;
  }
}

/**
 * Faut-il réessayer après cette erreur ?
 *
 * Le raisonnement tient en une phrase : on ne réessaie que ce qu'un réessai
 * peut réparer. Insister sur un jeton refusé ne le rendra pas valide, et une
 * source qui répond « trop de requêtes » à une requête de trop n'a pas besoin
 * qu'on recommence tout de suite.
 *
 * - 401 / 403 : jeton absent, faux, expiré, ou souscription manquante. Aucun
 *   réessai — c'est une erreur de configuration, pas un incident réseau.
 * - 404 : la ressource n'existe pas. Aucun réessai.
 * - 429 : quota dépassé. Un seul réessai, et seulement après le délai demandé.
 * - 5xx, coupures, délais dépassés : incident passager, réessais avec attente
 *   croissante.
 */
function reessayable(err) {
  if (!(err instanceof HttpError)) return true; // réseau, DNS, délai dépassé
  if (err.status === 401 || err.status === 403 || err.status === 404) return false;
  if (err.status === 429) return true;
  return err.status >= 500;
}

/** Lit `Retry-After`, qui peut être un nombre de secondes ou une date HTTP. */
function lireRetryAfter(res) {
  const brut = res.headers.get('retry-after');
  if (!brut) return null;
  const secondes = Number(brut);
  if (Number.isFinite(secondes)) return Math.max(0, secondes);
  const date = Date.parse(brut);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

/**
 * Validateurs par URL, pour les requêtes conditionnelles.
 * En mémoire : après un redémarrage, une récupération complète est faite, ce
 * qui est exactement ce qu'on veut.
 */
const validateurs = new Map();

function empreinte(donnees) {
  return crypto.createHash('sha256').update(donnees).digest('hex');
}

async function une_fois(url, {
  accept, binary, conditionnel = true, entetesSupplementaires, delaiMs, limiteur,
} = {}) {
  // Le limiteur passe avant tout le reste : il doit compter les requêtes
  // effectivement émises, y compris celles issues d'un réessai.
  if (limiteur) await limiteur.reserver();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), delaiMs || CONFIG.requestTimeoutMs);
  const envoye = Date.now();

  try {
    const entetes = {
      'User-Agent': CONFIG.userAgent,
      Accept: accept || '*/*',
      'Accept-Language': 'en,fr;q=0.8',
      // Les en-têtes d'authentification arrivent ici. Ils ne sont jamais
      // journalisés : rien dans ce module n'écrit le contenu de `entetes`.
      ...(entetesSupplementaires || {}),
    };

    const connu = conditionnel ? validateurs.get(url) : null;
    if (connu?.etag) entetes['If-None-Match'] = connu.etag;
    if (connu?.lastModified) entetes['If-Modified-Since'] = connu.lastModified;

    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: entetes });

    // 304 : le document n'a pas changé. On le dit, on ne retélécharge pas.
    if (res.status === 304 && connu) {
      return {
        inchange: true,
        url,
        emisLe: connu.emisLe,
        recuLe: new Date().toISOString(),
        sha256: connu.sha256,
        dureeMs: Date.now() - envoye,
      };
    }

    if (!res.ok) {
      const retryAfter = lireRetryAfter(res);
      // Quota dépassé : on fait taire l'application aussi longtemps que la
      // source le demande, plutôt que de continuer à frapper une porte fermée.
      if (res.status === 429 && limiteur) limiteur.pauser(retryAfter ?? 60);
      throw new HttpError(`HTTP ${res.status}`, res.status, url, retryAfter);
    }

    const brut = binary
      ? Buffer.from(await res.arrayBuffer())
      : Buffer.from(await res.arrayBuffer());

    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    const date = res.headers.get('date');

    // Heure d'émission : Last-Modified fait foi, sinon l'en-tête Date du serveur.
    const emisLe = lastModified
      ? new Date(lastModified).toISOString()
      : date ? new Date(date).toISOString() : null;

    const sha256 = empreinte(brut);
    if (conditionnel) validateurs.set(url, { etag, lastModified, sha256, emisLe });

    return {
      inchange: false,
      url,
      corps: binary ? brut : brut.toString('utf8'),
      octets: brut.length,
      sha256,
      etag,
      lastModified,
      emisLe,
      recuLe: new Date().toISOString(),
      dureeMs: Date.now() - envoye,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Récupère une ressource avec réessais espacés.
 * Retourne toujours un objet : soit une réponse tracée, soit `{ __error }`.
 */
export async function recuperer(url, opts = {}, tentatives = 3) {
  let derniere;
  for (let i = 0; i < tentatives; i += 1) {
    try {
      return await une_fois(url, opts);
    } catch (err) {
      derniere = err;
      if (!reessayable(err)) break;
      if (i >= tentatives - 1) break;

      // Attente croissante — 800 ms, 1,6 s, 2,4 s — sauf si la source a dit
      // elle-même combien de temps attendre, auquel cas c'est elle qui décide.
      const parDefaut = 800 * (i + 1);
      const demande = err instanceof HttpError && err.retryAfter != null
        ? Math.min(err.retryAfter * 1000, 120_000)
        : 0;
      await new Promise((r) => setTimeout(r, Math.max(parDefaut, demande)));
    }
  }

  const statut = derniere instanceof HttpError ? derniere.status : null;
  return {
    // `expurger` est un filet : le message vient d'une erreur réseau, donc d'un
    // texte que nous ne contrôlons pas et qui pourrait recopier une URL.
    __error: expurger(derniere?.message || 'échec réseau'),
    __statut: statut,
    __definitif: derniere ? !reessayable(derniere) : false,
    __url: expurger(url),
    recuLe: new Date().toISOString(),
  };
}

export const estErreur = (r) => r && typeof r === 'object' && '__error' in r;
export const estInchange = (r) => r && typeof r === 'object' && r.inchange === true;

/** Récupération JSON tracée : la réponse porte ses métadonnées de provenance. */
export async function fetchJson(url, opts = {}) {
  const r = await recuperer(url, { accept: 'application/json', ...opts });
  if (estErreur(r) || estInchange(r)) return r;
  try {
    return { ...r, donnees: JSON.parse(r.corps) };
  } catch {
    return { __error: 'JSON illisible', __url: url, recuLe: r.recuLe };
  }
}

export async function fetchTexte(url, opts = {}) {
  return recuperer(url, { accept: 'text/plain, text/xml, application/xml', ...opts });
}

export async function fetchBinaire(url, opts = {}) {
  return recuperer(url, { binary: true, ...opts });
}

/** Vide les validateurs — utilisé par les tests et par une collecte forcée. */
export function oublierValidateurs() {
  validateurs.clear();
}

export { HttpError, empreinte };
