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

class HttpError extends Error {
  constructor(message, status, url) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
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

async function une_fois(url, { accept, binary, conditionnel = true } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  const envoye = Date.now();

  try {
    const entetes = {
      'User-Agent': CONFIG.userAgent,
      Accept: accept || '*/*',
      'Accept-Language': 'en,fr;q=0.8',
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

    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, url);

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
      // Une 404 ne se réessaie pas : la ressource n'existe pas.
      if (err instanceof HttpError && err.status === 404) break;
      if (i < tentatives - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return {
    __error: derniere?.message || 'échec réseau',
    __url: url,
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
