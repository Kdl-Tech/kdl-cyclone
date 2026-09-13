/** Risque côtier de sargasses NOAA/USF, produit expérimental SIR. */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchTexte, fetchBinaire, estErreur } from '../util/http.js';

const executer = promisify(execFile);
const INDEX = 'https://cwcgom.aoml.noaa.gov/SIR/index.php?compact=1';
const DUREE_CACHE = 60 * 60 * 1000;
let memoire = null;

export function parserRisquesKml(kml) {
  const cellules = new Map();
  let dateBrute = null;
  const placemarks = String(kml).match(/<Placemark\b[\s\S]*?<\/Placemark>/g) || [];
  for (const bloc of placemarks) {
    const risque = Number((bloc.match(/<SimpleData name="risk">(\d+)<\/SimpleData>/) || [])[1]);
    if (!risque) continue;
    dateBrute ||= (bloc.match(/<SimpleData name="date">(\d{8})<\/SimpleData>/) || [])[1] || null;
    const texte = (bloc.match(/<coordinates>([\s\S]*?)<\/coordinates>/) || [])[1];
    if (!texte) continue;
    const coordonnees = texte.trim().split(/\s+/);
    let lon = 0; let lat = 0; let n = 0;
    const pas = Math.max(1, Math.floor(coordonnees.length / 30));
    for (let i = 0; i < coordonnees.length; i += pas) {
      const [x, y] = coordonnees[i].split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      lon += x; lat += y; n += 1;
    }
    if (!n) continue;
    lon /= n; lat /= n;
    if (lon < -105 || lon > 15 || lat < -5 || lat > 45) continue;
    const cle = `${Math.round(lat * 2) / 2}:${Math.round(lon * 2) / 2}`;
    const precedent = cellules.get(cle);
    if (!precedent || risque > precedent.risque) {
      cellules.set(cle, { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2, risque });
    }
  }
  const date = dateBrute ? `${dateBrute.slice(0, 4)}-${dateBrute.slice(4, 6)}-${dateBrute.slice(6, 8)}` : null;
  return { date, points: [...cellules.values()] };
}

function dateDepuisIndex(html) {
  const texte = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const brut = (texte.match(/Status:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/) || [])[1];
  if (!brut) return null;
  const d = new Date(`${brut} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function sargasses() {
  if (memoire && Date.now() - memoire.lu < DUREE_CACHE) return memoire.valeur;
  try {
    const page = await fetchTexte(INDEX, { conditionnel: false });
    if (estErreur(page)) throw new Error(page.__error);
    const date = dateDepuisIndex(page.corps);
    if (!date) throw new Error('date NOAA introuvable');
    if (memoire?.valeur?.date === date) {
      memoire.lu = Date.now();
      return memoire.valeur;
    }
    const compacte = date.replaceAll('-', '');
    const url = `https://cwcgom.aoml.noaa.gov/SIR/KMZ/sargassum_risk_${compacte}.kmz`;
    const archive = await fetchBinaire(url, { conditionnel: false });
    if (estErreur(archive)) throw new Error(archive.__error);
    const fichier = path.join(os.tmpdir(), `kdl-sargasses-${process.pid}.kmz`);
    await fsp.writeFile(fichier, archive.corps);
    let stdout;
    try {
      ({ stdout } = await executer('unzip', ['-p', fichier, 'KML/*.kml'], { maxBuffer: 24 * 1024 * 1024, encoding: 'utf8' }));
    } finally {
      await fsp.unlink(fichier).catch(() => {});
    }
    const reduit = parserRisquesKml(stdout);
    const valeur = { ok: true, date: reduit.date || date, points: reduit.points, source: 'NOAA/AOML SIR v1.5', url, experimental: true };
    memoire = { lu: Date.now(), valeur };
    return valeur;
  } catch (e) {
    if (memoire?.valeur) return { ...memoire.valeur, perime: true, erreur: e.message };
    return { ok: false, erreur: e.message, points: [] };
  }
}
