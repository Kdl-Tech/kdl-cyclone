/**
 * Identifiants d'URL durables.
 *
 * Une perturbation change de nom au cours de sa vie : zone surveillée, puis
 * numéro d'investigation, puis dépression, puis tempête nommée. Chaque étape
 * mérite une URL lisible — mais un lien partagé sur WhatsApp trois jours plus
 * tôt doit continuer de fonctionner.
 *
 * D'où : un identifiant interne stable, un slug canonique courant, et tous les
 * anciens slugs conservés comme alias qui redirigent en 301.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const FICHIER = 'slugs.json';

/** Translitération sans dépendance : accents retirés, ponctuation normalisée. */
export function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Slug souhaité pour un système, selon ce qu'on sait de lui.
 * L'ordre reflète la vie d'une perturbation : le nom l'emporte sur l'Invest,
 * qui l'emporte sur la désignation de zone.
 */
export function slugSouhaite(systeme) {
  if (systeme.nom) return normaliser(systeme.nom);

  const invest = (systeme.identifiantNhc || '').match(/(9\d[lLeE])/)?.[1];
  if (invest) return `invest-${invest.toLowerCase()}`;

  if (systeme.identifiantNhc) return normaliser(systeme.identifiantNhc);

  if (systeme.numero) {
    // Numérotation stable dans la saison, préfixée pour rester lisible.
    return `onde-atlantique-${String(systeme.numero).padStart(2, '0')}`;
  }
  return normaliser(systeme.designation || systeme.id);
}

function chemin() {
  return path.join(CONFIG.dataDir, FICHIER);
}

export async function lireTable() {
  try {
    return JSON.parse(await fsp.readFile(chemin(), 'utf8'));
  } catch {
    return { parId: {}, alias: {} };
  }
}

async function ecrireTable(table) {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  const tmp = `${chemin()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(table), 'utf8');
  await fsp.rename(tmp, chemin());
}

/**
 * Met la table à jour à partir des systèmes courants.
 *
 * - un slug déjà attribué à un autre identifiant n'est jamais volé : on suffixe ;
 * - l'ancien slug d'un système renommé devient un alias, il ne disparaît pas ;
 * - les alias survivent à la disparition du système, pour que les liens
 *   partagés continuent d'aboutir.
 *
 * @returns {Promise<{table:object, renommages:Array}>}
 */
export async function mettreAJour(systemes) {
  const table = await lireTable();
  const renommages = [];

  for (const s of systemes) {
    const souhaite = slugSouhaite(s);
    const entree = table.parId[s.id] || { canonique: null, anciens: [] };

    if (entree.canonique === souhaite) {
      table.alias[souhaite] = s.id;
      table.parId[s.id] = entree;
      continue;
    }

    // Collision : le slug est déjà pris par un autre système.
    let canonique = souhaite;
    if (table.alias[canonique] && table.alias[canonique] !== s.id) {
      let n = 2;
      while (table.alias[`${souhaite}-${n}`] && table.alias[`${souhaite}-${n}`] !== s.id) n += 1;
      canonique = `${souhaite}-${n}`;
    }

    if (entree.canonique && entree.canonique !== canonique) {
      // L'ancien slug reste valable, en redirection.
      if (!entree.anciens.includes(entree.canonique)) entree.anciens.push(entree.canonique);
      table.alias[entree.canonique] = s.id;
      renommages.push({ id: s.id, de: entree.canonique, vers: canonique });
    }

    entree.canonique = canonique;
    entree.vuLe = new Date().toISOString();
    table.parId[s.id] = entree;
    table.alias[canonique] = s.id;
  }

  await ecrireTable(table);
  return { table, renommages };
}

/**
 * Résout un slug public.
 * @returns {{id:string, canonique:string, redirection:boolean}|null}
 */
export function resoudre(table, slug) {
  const propre = normaliser(slug);
  const id = table.alias?.[propre];
  if (!id) return null;
  const canonique = table.parId?.[id]?.canonique || propre;
  return { id, canonique, redirection: canonique !== propre };
}

/** Slug canonique d'un identifiant interne. */
export function slugDe(table, id) {
  return table.parId?.[id]?.canonique || null;
}

/** Purge les alias dont le système a disparu depuis plus de 120 jours. */
export async function purger(table, joursMax = 120) {
  const limite = Date.now() - joursMax * 86400000;
  let retires = 0;
  for (const [id, entree] of Object.entries(table.parId || {})) {
    if (entree.vuLe && new Date(entree.vuLe).getTime() < limite) {
      for (const a of [entree.canonique, ...(entree.anciens || [])]) delete table.alias[a];
      delete table.parId[id];
      retires += 1;
    }
  }
  if (retires) await ecrireTable(table);
  return retires;
}
