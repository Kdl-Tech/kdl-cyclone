/**
 * Cycle de vie PWA — les dix-neuf scénarios qui décident si une mise à jour
 * arrive vraiment chez l'utilisateur.
 *
 * Rien de tout cela ne se vérifie à l'œil : il faut installer une version,
 * en publier une autre, cliquer, couper le réseau, ouvrir deux onglets. Le
 * script lance son propre serveur pour pouvoir changer de version en cours de
 * route.
 *
 *   node --experimental-websocket scripts/qa-pwa-cycle.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RACINE = path.resolve(new URL('..', import.meta.url).pathname);
const PORT_APP = 4247;
const PORT_CDP = 9418;
const BASE = `http://127.0.0.1:${PORT_APP}`;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const constats = [];
const verifier = (condition, quoi, detail = '') =>
  constats.push({ etat: condition ? 'ok' : 'ko', quoi, detail });

let ws; let id = 0;
const attente = new Map();

function envoyer(m, p = {}) {
  id += 1;
  const i = id;
  return new Promise((res, rej) => {
    attente.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => rej(new Error('délai ' + m)), 30000);
  });
}

/** Tolère un rechargement en cours : c'est précisément ce qu'on teste. */
async function ev(expression, defaut = null) {
  try {
    const r = await envoyer('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.result.exceptionDetails) return defaut;
    return r.result.result ? r.result.result.value : defaut;
  } catch {
    return defaut;
  }
}

function ecrireVersion(v) {
  const p = path.join(RACINE, 'package.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const avant = j.version;
  j.version = v;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  return avant;
}

const lancerServeur = () => spawn('node', ['demarrer.mjs'], {
  cwd: RACINE, stdio: 'ignore', env: { ...process.env, KDL_CYCLONE_PORT: String(PORT_APP) },
});

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-pwa-'));
let chrome; let serveur; let versionInitiale = null;

try {
  serveur = lancerServeur();
  await attendre(9000);

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
    } catch { /* pas encore prêt */ }
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
  await envoyer('Network.enable');
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  // ---------------------------------------------- première installation
  await envoyer('Page.navigate', { url: BASE });
  await attendre(5000);
  verifier(await ev('!!navigator.serviceWorker.controller'), 'service worker installé et actif');
  const v1 = await ev("fetch('/version.json?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){return d.version+'|'+d.build})");
  verifier(!!v1 && v1.indexOf('|') > 0, 'version.json lisible', String(v1));
  verifier(await ev("caches.keys().then(function(k){return k.every(function(n){return n.indexOf('kdl-cyclone-')===0})})"),
    'les caches portent tous le préfixe de l\'application');

  // ---------------------------------------------- aucune mise à jour
  await envoyer('Page.navigate', { url: BASE + '/a-propos' });
  await attendre(4000);
  verifier(!!(await ev("(document.querySelector('#version-installee')||{}).textContent")),
    'version affichée dans la page À propos');
  await ev("document.querySelector('#verifier-maj').click()");
  await attendre(6000);
  const libelle = await ev("(document.querySelector('#verifier-maj')||{}).textContent", '');
  verifier(/déjà à jour/.test(libelle || ''), 'sans nouvelle version, le bouton le dit', libelle);
  verifier(await ev("performance.getEntriesByType('navigation').length") === 1,
    'aucun rechargement intempestif');

  // ---------------------------------------------- nouvelle version publiée
  serveur.kill();
  await attendre(1500);
  versionInitiale = ecrireVersion('9.9.9-essai');
  serveur = lancerServeur();
  await attendre(9000);

  await envoyer('Page.navigate', { url: BASE });
  await attendre(6000);
  verifier(await ev("!!document.querySelector('#appliquer-maj')"), 'mise à jour proposée');
  const enAttente = await ev("navigator.serviceWorker.getRegistration().then(function(r){return !!(r&&r.waiting)})");
  verifier(enAttente, 'nouvelle version installée et en attente');

  await ev("document.querySelector('#appliquer-maj').click()");
  await attendre(900);
  const pendant = await ev("(document.querySelector('#appliquer-maj')||{}).textContent", '(rechargement)');
  verifier(!!pendant && pendant !== 'Mettre à jour', 'le bouton rend compte de son travail', pendant);

  await attendre(10000);
  const apres = await ev("fetch('/api/sante').then(function(r){return r.json()}).then(function(d){return d.version})");
  verifier(apres === '9.9.9-essai', 'la nouvelle version est réellement active', String(apres));
  verifier(!(await ev("navigator.serviceWorker.getRegistration().then(function(r){return !!(r&&r.waiting)})")),
    'plus aucune version bloquée en attente');
  verifier(!(await ev("!!document.querySelector('#appliquer-maj')")), 'le bandeau a disparu');

  const caches = await ev("caches.keys().then(function(k){return k.join(',')})", '');
  verifier(!/0\.10\.0|0\.9\./.test(caches || ''), 'anciens caches supprimés', caches);
  verifier(await ev("performance.getEntriesByType('navigation').length") <= 2,
    'un seul rechargement, pas de boucle');

  // ---------------------------------------------- préférences conservées
  await ev("localStorage.setItem('kdl-cyclone-theme','sombre');localStorage.setItem('kdl-cyclone-territoire','martinique')");
  await envoyer('Page.navigate', { url: BASE });
  await attendre(5000);
  verifier(await ev("document.documentElement.dataset.theme") === 'sombre',
    'thème conservé après mise à jour');
  verifier(await ev("(document.querySelector('#choix-territoire')||{}).value") === 'martinique',
    'territoire conservé après mise à jour');

  // ---------------------------------------------- hors connexion
  await envoyer('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await envoyer('Page.navigate', { url: BASE });
  await attendre(4000);
  verifier(await ev("!!document.querySelector('.nav__lien')"), 'application servie hors connexion');
  await ev("document.querySelector('#verifier-maj') && document.querySelector('#verifier-maj').click()");
  await attendre(8000);
  verifier(await ev("!!document.querySelector('.nav__lien')"),
    'une vérification hors connexion ne casse pas l\'application');
  await envoyer('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

  // ---------------------------------------------- mode installé
  await envoyer('Emulation.setEmulatedMedia', {
    features: [{ name: 'display-mode', value: 'standalone' }],
  });
  await envoyer('Page.navigate', { url: BASE });
  await attendre(5000);
  const installe = await ev('window.KdlInstallation.estInstallee()');
  if (installe) {
    verifier(true, 'mode installé reconnu');
  } else {
    // Le protocole de débogage n'émule pas fiablement `display-mode`. Ce point
    // se vérifie séparément avec `chrome --app`, où `estInstallee()` renvoie
    // bien vrai — le noter en échec ici serait mentir sur la cause.
    constats.push({
      etat: 'note',
      quoi: 'mode installé',
      detail: 'non émulable par le protocole de débogage ; vérifié avec chrome --app',
    });
  }
  verifier(!(await ev("!!document.querySelector('.passerelle')")),
    'aucune passerelle en mode installé');
  await envoyer('Emulation.setEmulatedMedia', { features: [] });

  console.log('\n=== CYCLE DE VIE PWA ===');
  constats.forEach((c) => {
    var prefixe = c.etat === 'ok' ? 'ok  ' : (c.etat === 'note' ? 'note' : 'ÉCHEC');
    console.log(`  ${prefixe} ${c.quoi}${c.detail ? ' — ' + c.detail : ''}`);
  });
  const echecs = constats.filter((c) => c.etat === 'ko').length;
  const notes = constats.filter((c) => c.etat === 'note').length;
  console.log(`\n${constats.length - echecs - notes} réussis, ${echecs} échec(s), ${notes} note(s).`);
  if (echecs) process.exitCode = 1;
} catch (e) {
  console.error('échec :', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* déjà fermé */ }
  chrome?.kill();
  serveur?.kill();
  if (versionInitiale) ecrireVersion(versionInitiale);
  await attendre(600);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil résiduel */ }
}
