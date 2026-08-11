/**
 * Contrôle responsive — huit formats, deux thèmes, toutes les vues.
 *
 * Redimensionner une fenêtre à la main ne prouve rien : ce script mesure, à
 * chaque format, ce qui casse réellement une interface mobile — un débordement
 * horizontal, un bouton trop petit pour un doigt, un texte illisible, une
 * commande qui sort de l'écran. Il capture aussi chaque format pour comparaison.
 *
 *   node --experimental-websocket scripts/qa-responsive.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9411;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures', 'responsive');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const FORMATS = [
  { nom: '320x568', l: 320, h: 568, mobile: true },
  { nom: '360x800', l: 360, h: 800, mobile: true },
  { nom: '390x844', l: 390, h: 844, mobile: true },
  { nom: '412x915', l: 412, h: 915, mobile: true },
  { nom: 'tablette-portrait', l: 768, h: 1024, mobile: true },
  { nom: 'tablette-paysage', l: 1024, h: 768, mobile: true },
  { nom: '1366x768', l: 1366, h: 768, mobile: false },
  { nom: '1440x900', l: 1440, h: 900, mobile: false },
  { nom: '1920x1080', l: 1920, h: 1080, mobile: false },
];

const VUES = ['accueil', 'carte', 'guadeloupe', 'meteo', 'preparation'];

const constats = [];
const ok = (quoi, detail = '') => constats.push({ etat: 'ok', quoi, detail });
const ko = (quoi, detail = '') => constats.push({ etat: 'ko', quoi, detail });
const verifier = (condition, quoi, detail) => (condition ? ok(quoi, detail) : ko(quoi, detail));

let ws; let id = 0;
const attente = new Map();

function envoyer(m, p = {}) {
  id += 1;
  const i = id;
  return new Promise((res, rej) => {
    attente.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => { if (attente.has(i)) { attente.delete(i); rej(new Error('délai ' + m)); } }, 30000);
  });
}

async function ev(expression) {
  const r = await envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.result ? r.result.result.value : null;
}

/**
 * Navigation tolérante.
 *
 * Depuis que le document est servi réseau d'abord, `Page.navigate` peut mettre
 * un long moment à rendre la main sur une page déjà chargée. On ne veut pas
 * faire échouer toute une campagne pour cela : on lance la navigation et on
 * juge sur ce qui s'affiche ensuite, pas sur l'accusé de réception.
 */
async function naviguer(url) {
  try {
    await envoyer('Page.navigate', { url });
  } catch {
    await attendre(1500);
  }
}

async function attendreRendu(limiteMs = 15000) {
  const fin = Date.now() + limiteMs;
  for (;;) {
    const restants = await ev("document.querySelectorAll('.squelette').length");
    if (restants === 0) return true;
    if (Date.now() > fin) return false;
    await attendre(400);
  }
}

/**
 * Mesure ce qui compte vraiment sur un petit écran. Tout est relevé dans la
 * page elle-même : c'est la géométrie réelle, pas une estimation.
 */
const AUDIT = `(function () {
  var doc = document.documentElement;
  var largeur = doc.clientWidth;

  // Éléments qui dépassent horizontalement : la cause d'un défilement latéral.
  var deborde = [];
  var visibles = document.querySelectorAll('main *, header *, nav *');
  for (var i = 0; i < visibles.length; i += 1) {
    var e = visibles[i];
    var r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > largeur + 1.5 || r.left < -1.5) {
      var style = getComputedStyle(e);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      var parent = e.closest('[style*="overflow"], .meteo-heures, .graphe, .replis');
      if (parent && parent !== e) continue;
      deborde.push((e.className && String(e.className).slice(0, 40)) || e.tagName);
      if (deborde.length > 4) break;
    }
  }

  // Cibles tactiles des commandes principales.
  var petites = [];
  var cibles = document.querySelectorAll(
    '.nav__lien, .bouton-icone, .territoire, .bouton, .calques__bascule, .systeme'
  );
  for (var j = 0; j < cibles.length; j += 1) {
    var c = cibles[j];
    var rc = c.getBoundingClientRect();
    if (rc.width === 0 || rc.height === 0) continue;
    if (rc.height < 40 || rc.width < 40) {
      petites.push(((c.className && String(c.className).slice(0, 28)) || c.tagName)
        + ' ' + Math.round(rc.width) + 'x' + Math.round(rc.height));
      if (petites.length > 4) break;
    }
  }

  // Textes trop petits pour être lus au soleil.
  var minuscules = 0;
  var textes = document.querySelectorAll('main p, main span, main div, main li, main dd, main dt');
  for (var k = 0; k < textes.length; k += 1) {
    var t = textes[k];
    if (!t.textContent || !t.textContent.trim()) continue;
    if (t.children.length) continue;
    var taille = parseFloat(getComputedStyle(t).fontSize);
    if (taille && taille < 11) minuscules += 1;
  }

  return JSON.stringify({
    largeur: largeur,
    defilementLateral: doc.scrollWidth - largeur,
    deborde: deborde,
    petites: petites,
    minuscules: minuscules,
    selecteur: !!document.querySelector('#choix-territoire'),
    nav: document.querySelectorAll('.nav__lien').length,
  });
})()`;

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-resp-'));
let chrome;

try {
  fs.mkdirSync(SORTIE, { recursive: true });
  chrome = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profil}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--lang=fr-FR', 'about:blank',
  ], { stdio: 'ignore' });

  let cible = null;
  for (let i = 0; i < 40 && !cible; i += 1) {
    await attendre(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
      cible = (await r.json()).find((t) => t.type === 'page');
    } catch { /* le navigateur n'écoute pas encore */ }
  }
  if (!cible) throw new Error('navigateur injoignable');

  ws = new WebSocket(cible.webSocketDebuggerUrl);
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && attente.has(d.id)) {
      const { res, rej } = attente.get(d.id);
      attente.delete(d.id);
      if (d.error) rej(new Error(d.error.message)); else res(d);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await envoyer('Page.enable');
  await envoyer('Runtime.enable');

  for (const format of FORMATS) {
    for (const theme of ['clair', 'sombre']) {
      await envoyer('Emulation.setDeviceMetricsOverride', {
        width: format.l, height: format.h, deviceScaleFactor: 2, mobile: format.mobile,
      });

      for (const vue of VUES) {
        await naviguer(`${BASE}/?vue=${vue}`);
        await attendre(1100);
        await ev(`localStorage.setItem('kdl-cyclone-theme','${theme}');`
          + `document.documentElement.dataset.theme='${theme}';`);
        await attendreRendu();
        await attendre(400);

        const brut = await ev(AUDIT);
        const a = JSON.parse(brut);
        const ou = `${vue} en ${format.nom} ${theme}`;

        verifier(a.defilementLateral <= 1, `aucun défilement latéral — ${ou}`,
          a.defilementLateral > 1 ? `${a.defilementLateral} px de trop` : '');
        verifier(a.deborde.length === 0, `aucun élément hors cadre — ${ou}`,
          a.deborde.join(', '));
        verifier(a.petites.length === 0, `commandes atteignables au doigt — ${ou}`,
          a.petites.join(', '));
        verifier(a.minuscules === 0, `aucun texte minuscule — ${ou}`,
          a.minuscules ? `${a.minuscules} éléments sous 11 px` : '');
        verifier(a.selecteur, `sélecteur de territoire présent — ${ou}`);

        // Une capture par format et par thème, sur la vue la plus dense.
        if (vue === 'meteo' || vue === 'carte') {
          const shot = await envoyer('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(
            path.join(SORTIE, `${vue}-${format.nom}-${theme}.png`),
            Buffer.from(shot.result.data, 'base64'),
          );
        }
      }
    }
    console.log('format vérifié :', format.nom);
  }

  const echecs = constats.filter((c) => c.etat === 'ko');
  console.log('\n=== RESPONSIVE ===');
  if (echecs.length === 0) {
    console.log(`  ${constats.length} contrôles, aucun défaut.`);
  } else {
    echecs.forEach((c) => console.log(`  ÉCHEC ${c.quoi}${c.detail ? ' — ' + c.detail : ''}`));
    console.log(`\n${constats.length - echecs.length} réussis, ${echecs.length} échec(s).`);
    process.exitCode = 1;
  }
  console.log('Captures :', SORTIE);
} catch (e) {
  console.error('échec :', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* déjà fermé */ }
  chrome?.kill();
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil résiduel */ }
}
