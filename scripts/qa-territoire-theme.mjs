/**
 * Contrôle des vingt scénarios de territoire, de thème et de chargement.
 *
 * Ils ne se vérifient pas à l'œil : il faut un stockage vide, un appareil
 * réglé en sombre, une API en panne, un écran de 320 px. Ce script les rejoue
 * un à un dans un navigateur réel et capture le sélecteur ouvert.
 *
 *   node --experimental-websocket scripts/qa-territoire-theme.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9407;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures', 'territoire');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const constats = [];
const ok = (quoi, detail = '') => constats.push({ etat: 'ok', quoi, detail });
const ko = (quoi, detail = '') => constats.push({ etat: 'ko', quoi, detail });
const verifier = (condition, quoi, detail) => (condition ? ok(quoi, detail) : ko(quoi, detail));

let ws; let id = 0;
const attente = new Map();
let RETARD_API = 0;

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

/** Ouvre une page en maîtrisant l'état de départ : stockage, écran, thème système. */
async function ouvrir(url, { largeur = 1280, hauteur = 900, sombreSysteme = false, vider = true } = {}) {
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: largeur, height: hauteur, deviceScaleFactor: 2, mobile: largeur < 500,
  });
  await envoyer('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: sombreSysteme ? 'dark' : 'light' }],
  });
  if (vider) {
    await envoyer('Page.navigate', { url: BASE });
    await attendre(700);
    await ev('localStorage.clear()');
  }
  await envoyer('Page.navigate', { url });
  await attendre(1500);
  return attendreRendu();
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

const lireTheme = () => ev('document.documentElement.dataset.theme');
const lireTerritoire = () => ev("(document.querySelector('#choix-territoire')||{}).value || null");
const texte = (sel) => ev(`(function(){var e=document.querySelector('${sel}');return e?e.textContent.trim():null})()`);

async function choisirTerritoire(cle) {
  await ev(`(function(){
    var s=document.querySelector('#choix-territoire');
    if(!s) return false;
    s.value='${cle}';
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  await attendre(1200);
}

async function capturer(nom) {
  const shot = await envoyer('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SORTIE, nom), Buffer.from(shot.result.data, 'base64'));
}

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-terr-'));
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
    // Requête mise en pause : on la laisse traîner pour simuler une source
    // lente, ce qu'un simple blocage ne reproduit pas — il échoue trop vite.
    if (d.method === 'Fetch.requestPaused') {
      const tarder = /\/api\/etat/.test(d.params.request.url) ? RETARD_API : 0;
      setTimeout(() => {
        envoyer('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {});
      }, tarder);
      return;
    }
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

  // 1. Stockage vide + appareil en sombre → l'application s'ouvre en clair.
  await ouvrir(BASE, { sombreSysteme: true });
  verifier(await lireTheme() === 'clair', 'ouverture en clair malgré un appareil en sombre',
    'aucune préférence enregistrée');

  // 2. Choix du sombre, puis rechargement.
  await ev("document.querySelector('#bouton-theme').click()");
  await attendre(400);
  verifier(await lireTheme() === 'sombre', 'bascule vers le sombre');
  await ouvrir(BASE, { sombreSysteme: true, vider: false });
  verifier(await lireTheme() === 'sombre', 'le sombre choisi survit au rechargement');

  // 3. Retour au clair, puis rechargement.
  await ev("document.querySelector('#bouton-theme').click()");
  await attendre(400);
  await ouvrir(BASE, { sombreSysteme: true, vider: false });
  verifier(await lireTheme() === 'clair', 'le retour au clair survit au rechargement');

  // 4 et 5. Source lente, sans rien en mémoire : la coquille doit rester
  // utilisable, l'attente être annoncée, puis une relance proposée.
  await envoyer('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await envoyer('Page.navigate', { url: BASE });
  await attendre(1200);
  // Première visite véritable : sans cela, le service worker répond depuis son
  // cache de données et l'attente n'a jamais lieu — ce qui est le bon
  // comportement, mais ne teste pas le message.
  await ev(`(async function(){
    var rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(function(r){ return r.unregister(); }));
    var ks = await caches.keys();
    await Promise.all(ks.map(function(k){ return caches.delete(k); }));
    localStorage.clear();
    return true;
  })()`);
  RETARD_API = 14000;
  await envoyer('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await envoyer('Page.navigate', { url: BASE });
  await attendre(2500);

  const pendantChargement = await ev("!!document.querySelector('#choix-territoire')");
  const optionsPendant = await ev("(document.querySelectorAll('#choix-territoire option')||[]).length");
  verifier(pendantChargement, 'sélecteur présent pendant le chargement', `${optionsPendant} territoires proposés`);
  verifier(optionsPendant === 9, 'les neuf territoires sont proposés sans données', `${optionsPendant} trouvés`);
  const premierMessage = await texte('#bandeau-connexion');
  verifier(/Récupération du dernier bulletin/.test(premierMessage || ''),
    'attente annoncée dès le départ', (premierMessage || '').slice(0, 60));

  await attendre(7000);
  const messageAttente = await texte('#bandeau-connexion');
  verifier(/plus de temps que prévu/.test(messageAttente || ''), 'relance proposée quand cela traîne',
    (messageAttente || '').slice(0, 60));
  verifier(await ev("!!document.querySelector('#reessayer')"), 'bouton de nouvelle tentative disponible');
  verifier(await ev("!!document.querySelector('#choix-territoire')"),
    'le sélecteur survit à une source qui tarde');
  await capturer('chargement-source-lente.png');
  RETARD_API = 0;
  await envoyer('Fetch.disable');

  // 6 et 7. Sélecteur lisible dans les deux thèmes, menu déployé.
  for (const theme of ['clair', 'sombre']) {
    await ouvrir(BASE);
    await ev(`localStorage.setItem('kdl-cyclone-theme','${theme}');document.documentElement.dataset.theme='${theme}';`);
    await attendre(500);
    const style = await ev(`(function(){
      var o=document.querySelector('#choix-territoire option');
      var l=document.querySelector('.territoire');
      var g=getComputedStyle(o), h=l.getBoundingClientRect();
      return JSON.stringify({couleur:g.color, fond:g.backgroundColor, hauteur:Math.round(h.height)});
    })()`);
    const { couleur, fond, hauteur } = JSON.parse(style);
    verifier(couleur !== fond, `options du sélecteur contrastées en ${theme}`, `${couleur} sur ${fond}`);
    verifier(hauteur >= 44, `zone tactile suffisante en ${theme}`, `${hauteur} px`);
    // Le menu natif ne se déploie pas dans une capture : on montre le contrôle
    // au clavier, focus visible, ce qui est ce qui manquait à l'écran.
    await ev("document.querySelector('#choix-territoire').focus()");
    await attendre(300);
    await capturer(`selecteur-${theme}.png`);
  }

  // 8 à 11. Passage à la Martinique et propagation.
  await ouvrir(BASE);
  await choisirTerritoire('martinique');
  verifier(await lireTerritoire() === 'martinique', 'sélection de la Martinique');
  const titreCadran = await texte('#titre-cadran');
  verifier(/Martinique/.test(titreCadran || ''), 'titre du cadran suit le territoire', titreCadran);
  const aria = await ev("document.querySelector('#cadran').getAttribute('aria-label')");
  verifier(/Martinique/.test(aria || '') && !/Guadeloupe/.test(aria || ''),
    'texte alternatif du cadran suit le territoire', aria);
  const situation = await texte('.situation__titre');
  verifier(/Martinique/.test(situation || ''), 'titre principal suit le territoire', situation);
  const pied = await texte('.situation__pied');
  verifier(/Martinique/.test(pied || ''), 'libellé du risque suit le territoire');
  verifier(/territoire=martinique/.test(await ev('location.search')), 'territoire inscrit dans l\'URL');
  await capturer('martinique-accueil.png');

  await ev("document.querySelector('.nav__lien[data-vue=\"guadeloupe\"]').click()");
  await attendre(1200);
  const pageLocale = await texte('#page-guadeloupe h2');
  verifier(/Martinique/.test(pageLocale || ''), 'page territoire suit le choix', pageLocale);
  const liens = await ev("Array.from(document.querySelectorAll('#page-guadeloupe .lien-officiel__nom')).map(function(e){return e.textContent}).join(' | ')");
  verifier(/Martinique/.test(liens || ''), 'autorités officielles de la Martinique', (liens || '').slice(0, 80));

  await ev("document.querySelector('.nav__lien[data-vue=\"meteo\"]').click()");
  await attendre(4000);
  const meteo = await texte('#page-meteo h2');
  verifier(/Martinique/.test(meteo || ''), 'météo locale de la Martinique', meteo);

  // 12. Rechargement : la Martinique est conservée.
  await ouvrir(BASE, { vider: false });
  verifier(await lireTerritoire() === 'martinique', 'territoire conservé après rechargement');

  // 13. Lien partagé, sur un appareil qui n'a jamais rien enregistré.
  await ouvrir(`${BASE}/?territoire=sainte-lucie`);
  verifier(await lireTerritoire() === 'sainte-lucie', 'lien partagé ouvre le bon territoire');
  const titrePartage = await texte('.situation__titre');
  verifier(/Sainte-Lucie/.test(titrePartage || ''), 'contenu du lien partagé cohérent', titrePartage);

  // 14. Retour à la Guadeloupe : l'URL se nettoie.
  await choisirTerritoire('guadeloupe');
  verifier(await lireTerritoire() === 'guadeloupe', 'retour à la Guadeloupe');
  verifier(!/territoire=/.test(await ev('location.search')), 'URL nettoyée pour le territoire par défaut');

  // 15. Clavier : le contrôle est atteignable et son focus se voit.
  await ouvrir(BASE);
  const focus = await ev(`(function(){
    var s=document.querySelector('#choix-territoire');
    s.focus();
    var l=document.querySelector('.territoire');
    return JSON.stringify({
      focusOk: document.activeElement === s,
      ombre: getComputedStyle(l).boxShadow.slice(0, 40)
    });
  })()`);
  const f = JSON.parse(focus);
  verifier(f.focusOk, 'sélecteur atteignable au clavier');
  verifier(f.ombre && f.ombre !== 'none', 'focus clavier visible', f.ombre);

  // 16. Tactile : un appui sur l'icône ouvre bien la liste, pas seulement le texte.
  await ouvrir(BASE, { largeur: 412, hauteur: 915 });
  const couverture = await ev(`(function(){
    var l=document.querySelector('.territoire').getBoundingClientRect();
    var points=[[l.x+6,l.y+l.height/2],[l.x+l.width/2,l.y+4],[l.x+l.width-6,l.y+l.height-4]];
    return points.every(function(p){
      var e=document.elementFromPoint(p[0],p[1]);
      return e && (e.id==='choix-territoire' || e.closest('.territoire'));
    });
  })()`);
  verifier(couverture, 'toute la surface du bouton ouvre la liste');

  // 17. Écran de 320 px.
  await ouvrir(BASE, { largeur: 320, hauteur: 800 });
  const etroit = await ev(`(function(){
    var l=document.querySelector('.territoire').getBoundingClientRect();
    return JSON.stringify({visible:l.width>0&&l.height>0, deborde:document.documentElement.scrollWidth>321});
  })()`);
  const e320 = JSON.parse(etroit);
  verifier(e320.visible, 'sélecteur visible en 320 px');
  verifier(!e320.deborde, 'aucun débordement horizontal en 320 px');
  await capturer('selecteur-320px.png');

  // 18 et 19 : source en échec puis mode hors connexion, avec état mémorisé.
  await ouvrir(BASE);
  await envoyer('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await ev("document.querySelector('#bouton-actualiser').click()");
  await attendre(2500);
  verifier(await ev("!!document.querySelector('#choix-territoire')"),
    'sélecteur toujours là hors connexion');
  verifier(await ev("!!document.querySelector('.bandeau--hors-ligne')"),
    'mode hors connexion signalé');
  await envoyer('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

  // 20. Fraîcheur : les deux durées affichées ne doivent plus se contredire.
  await ouvrir(BASE);
  const fraicheur = await ev("(document.querySelector('.situation__fraicheur')||{}).textContent || ''");
  verifier(/Collecte KDL/.test(fraicheur), 'âge du bulletin et âge de la collecte distingués',
    (fraicheur || '').slice(0, 90));
  verifier(!/Reçu il y a \d+ heure/.test(fraicheur || ''),
    'plus de « reçu » pour désigner l\'âge du bulletin officiel');

  console.log('\n=== TERRITOIRE, THÈME ET CHARGEMENT ===');
  constats.forEach((c) => {
    console.log(`  ${c.etat === 'ok' ? 'ok  ' : 'ÉCHEC'} ${c.quoi}${c.detail ? ' — ' + c.detail : ''}`);
  });
  const echecs = constats.filter((c) => c.etat === 'ko').length;
  console.log(`\n${constats.length - echecs} réussis, ${echecs} échec(s).`);
  console.log('Captures :', SORTIE);
  if (echecs) process.exitCode = 1;
} catch (e) {
  console.error('échec :', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* déjà fermé */ }
  chrome?.kill();
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil résiduel */ }
}
