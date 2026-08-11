/**
 * Contrôle du fonctionnement hors connexion — le vrai.
 *
 * L'émulation réseau du protocole de débogage ne s'applique pas au service
 * worker, qui a son propre contexte réseau : un test fondé dessus ne prouve
 * rien. Ici, on coupe réellement le serveur, ce qui reproduit exactement ce que
 * vit un utilisateur dont la connexion tombe.
 *
 *   node --experimental-websocket scripts/qa-hors-ligne.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_APP = 4249;          // port dédié au test, pour ne pas gêner l'instance en cours
const PORT_CDP = 9355;
const BASE = `http://127.0.0.1:${PORT_APP}`;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const constats = [];

let id = 0;
const attente = new Map();
let ws;

function envoyer(methode, params = {}) {
  id += 1;
  const i = id;
  return new Promise((res, rej) => {
    attente.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: methode, params }));
    setTimeout(() => {
      if (attente.has(i)) { attente.delete(i); rej(new Error('délai dépassé : ' + methode)); }
    }, 25000);
  });
}

const evaluer = async (expr) => (await envoyer('Runtime.evaluate', {
  expression: expr, returnByValue: true, awaitPromise: true,
})).result.value;

async function attendreServeur(actif) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/version`);
      if (actif && r.ok) return true;
    } catch {
      if (!actif) return true;
    }
    await attendre(300);
  }
  return false;
}

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-offline-'));
let serveur = null;
let chrome = null;

try {
  fs.mkdirSync(SORTIE, { recursive: true });

  // `server.js` expose le serveur mais ne l'écoute pas : le point d'entrée
  // réel est `demarrer.mjs`, comme sous PM2.
  serveur = spawn('node', ['demarrer.mjs'], {
    cwd: RACINE,
    stdio: 'ignore',
    env: { ...process.env, KDL_CYCLONE_PORT: String(PORT_APP) },
  });
  if (!await attendreServeur(true)) throw new Error("le serveur de test n'a pas démarré");
  // Laisser la première collecte aboutir : sans données, le test ne veut rien dire.
  await attendre(6000);

  chrome = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profil}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--lang=fr-FR', 'about:blank',
  ], { stdio: 'ignore' });

  let urlWs;
  for (let i = 0; i < 40 && !urlWs; i += 1) {
    try {
      const cibles = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
      urlWs = cibles.find((c) => c.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* démarrage en cours */ }
    if (!urlWs) await attendre(250);
  }
  ws = new WebSocket(urlWs);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) {
      const { res, rej } = attente.get(m.id);
      attente.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });

  await envoyer('Page.enable');
  await envoyer('Runtime.enable');
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 393, height: 873, deviceScaleFactor: 2, mobile: true,
  });

  // 1. Deux visites en ligne : le service worker s'installe et prend la main.
  await envoyer('Page.navigate', { url: BASE });
  await attendre(4000);
  await envoyer('Page.navigate', { url: BASE });
  await attendre(3500);

  const controle = await evaluer('!!navigator.serviceWorker.controller');
  if (!controle) constats.push("le service worker ne contrôle pas la page après deux visites");

  const systemesEnLigne = await evaluer("document.querySelectorAll('.systeme').length");
  console.log('Systèmes affichés en ligne :', systemesEnLigne);

  // 2. Coupure réelle du serveur.
  console.log('Arrêt du serveur…');
  serveur.kill('SIGTERM');
  await attendreServeur(false);
  serveur = null;
  await attendre(1200);

  // 3. Rechargement complet, serveur éteint.
  await envoyer('Page.navigate', { url: BASE });
  await attendre(4500);

  const rendu = await evaluer("!!document.querySelector('.entete__titre')");
  if (!rendu) constats.push("l'application ne se charge pas du tout sans serveur");

  const systemesHorsLigne = await evaluer("document.querySelectorAll('.systeme').length");
  console.log('Systèmes affichés hors ligne :', systemesHorsLigne);
  if (systemesEnLigne > 0 && systemesHorsLigne !== systemesEnLigne) {
    constats.push(`systèmes perdus hors connexion : ${systemesEnLigne} → ${systemesHorsLigne}`);
  }

  const bandeau = await evaluer(
    "document.getElementById('bandeau-connexion').innerText",
  );
  if (!/hors connexion/i.test(bandeau || '')) {
    constats.push('aucun avertissement « hors connexion » affiché');
  } else {
    console.log('Avertissement :', bandeau.trim().slice(0, 130));
  }

  // La date des données doit rester visible : sans elle, l'information devient fausse.
  if (!/\d{2}:\d{2}/.test(bandeau || '')) {
    constats.push("l'avertissement hors connexion ne date pas les données affichées");
  }

  // 4. Le mode préparation doit rester entièrement utilisable.
  await evaluer(`document.querySelector('.nav__lien[data-vue="preparation"]').click()`);
  await attendre(900);
  const points = await evaluer("document.querySelectorAll('.prep-item').length");
  console.log('Points de préparation disponibles hors ligne :', points);
  if (points < 30) constats.push(`liste de préparation incomplète hors connexion : ${points} points`);

  await evaluer("document.querySelector('.prep-item input').click()");
  await attendre(400);
  const enregistre = await evaluer("localStorage.getItem('kdl-cyclone-preparation')");
  if (!enregistre || enregistre === '{}') {
    constats.push("l'avancement de la préparation ne s'enregistre pas hors connexion");
  }

  // 5. La carte doit encore se dessiner : son fond est embarqué.
  await evaluer(`document.querySelector('.nav__lien[data-vue="carte"]').click()`);
  await attendre(2000);
  const carte = await evaluer(`(() => {
    const c = document.querySelector('#carte');
    if (!c || !c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const s = new Set();
    for (let i = 0; i < d.length; i += 4000) s.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return s.size;
  })()`);
  console.log('Nuances sur la carte hors ligne :', carte);
  if (carte < 6) constats.push('la carte ne se dessine plus hors connexion');

  const { data } = await envoyer('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SORTIE, '15-hors-ligne-reel-carte.png'), Buffer.from(data, 'base64'));

  await evaluer(`document.querySelector('.nav__lien[data-vue="accueil"]').click()`);
  await attendre(700);
  const m = await envoyer('Page.getLayoutMetrics');
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 393, height: Math.min(Math.ceil(m.cssContentSize.height), 4000),
    deviceScaleFactor: 2, mobile: true,
  });
  await attendre(500);
  const cap = await envoyer('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SORTIE, '16-hors-ligne-reel-accueil.png'), Buffer.from(cap.data, 'base64'));
} finally {
  if (chrome) chrome.kill();
  if (serveur) serveur.kill('SIGTERM');
  await attendre(500);
  try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

console.log('\n=== HORS CONNEXION ===');
console.log(constats.length ? constats.map((c) => '[majeur] ' + c).join('\n') : 'Aucun défaut relevé.');
process.exit(constats.length ? 1 : 0);
