/**
 * Captures de contrôle de la direction artistique.
 *
 * Le rendu se juge sur des images, pas sur une intention : ce script parcourt
 * les vues principales dans les deux thèmes, en écran de bureau et en
 * téléphone, et dépose les captures sur le Bureau.
 *
 *   node --experimental-websocket scripts/qa-refonte-visuelle.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9401;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures', 'refonte');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const PLANS = [
  { vue: 'accueil', l: 1440, h: 1000, nom: 'accueil-bureau' },
  { vue: 'carte', l: 1440, h: 1000, nom: 'carte-bureau', satellite: true },
  { vue: 'accueil', l: 1440, h: 1400, nom: 'fiche-bureau', fiche: true },
  { vue: 'guadeloupe', l: 1440, h: 1200, nom: 'guadeloupe-bureau' },
  { vue: 'meteo', l: 1440, h: 1400, nom: 'meteo-bureau' },
  { vue: 'preparation', l: 1440, h: 1100, nom: 'preparation-bureau' },
  { vue: 'accueil', l: 390, h: 844, nom: 'accueil-mobile' },
  { vue: 'meteo', l: 390, h: 900, nom: 'meteo-mobile' },
];

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
const ev = async (x) => (await envoyer('Runtime.evaluate',
  { expression: x, returnByValue: true, awaitPromise: true })).result.value;

/** Attend qu'aucun squelette de chargement ne subsiste, ou renonce. */
async function attendreRendu(limiteMs = 20000) {
  const fin = Date.now() + limiteMs;
  for (;;) {
    const restants = await ev('document.querySelectorAll(\'.squelette\').length');
    if (restants === 0) return true;
    if (Date.now() > fin) return false;
    await attendre(500);
  }
}

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-refonte-'));
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

  for (const theme of ['clair', 'sombre']) {
    for (const plan of PLANS) {
      await envoyer('Emulation.setDeviceMetricsOverride', {
        width: plan.l, height: plan.h, deviceScaleFactor: 2, mobile: plan.l < 500,
      });
      await envoyer('Page.navigate', { url: `${BASE}/?vue=${plan.vue}` });
      await attendre(1200);
      // Les données arrivent par des requêtes successives : on attend la
      // disparition des squelettes plutôt que de parier sur un délai fixe.
      await attendreRendu();
      await ev(`localStorage.setItem('kdl-cyclone-theme','${theme}');`
        + `document.documentElement.dataset.theme='${theme}';`);
      await attendre(600);

      if (plan.satellite) {
        await ev(`(function(){var c=document.querySelector('#calques input[value="satellite"]');`
          + `if(c&&!c.checked){c.click();}return !!c;})()`);
        await attendre(800);
        await ev(`(function(){var b=document.querySelector('#charger-satellite');if(b)b.click();return !!b;})()`);
        await attendre(1200);
        await ev(`(function(){var b=document.querySelector('#confirmer-satellite');if(b)b.click();return !!b;})()`);
        await attendre(6000);
      }

      if (plan.fiche) {
        await ev(`(function(){var b=document.querySelector('.systeme');if(b)b.click();return !!b;})()`);
        await attendre(900);
      }

      const nom = `${plan.nom}-${theme}.png`;
      const shot = await envoyer('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SORTIE, nom), Buffer.from(shot.result.data, 'base64'));
      console.log('capture', nom);
    }
  }

  console.log('\nCaptures déposées dans', SORTIE);
} catch (e) {
  console.error('échec :', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* déjà fermé */ }
  chrome?.kill();
  // Le navigateur écrit encore dans son profil pendant qu'il se ferme :
  // l'effacement peut échouer sans que la campagne de captures soit en cause.
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil résiduel */ }
}
