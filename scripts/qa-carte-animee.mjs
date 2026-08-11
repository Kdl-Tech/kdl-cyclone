/**
 * Contrôle de la carte animée : boucle satellite, contrôles temporels, flux
 * d'événements, performances et comportement dégradé.
 *
 *   node --experimental-websocket scripts/qa-carte-animee.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9388;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const constats = [];
const mesures = {};
const ok = (q, d) => constats.push({ etat: 'ok', q, d });
const ko = (q, d) => constats.push({ etat: 'ECHEC', q, d });
const note = (q, d) => constats.push({ etat: 'note', q, d });

let ws; let id = 0;
const attente = new Map();

function envoyer(methode, params = {}) {
  id += 1;
  const i = id;
  return new Promise((res, rej) => {
    attente.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: methode, params }));
    setTimeout(() => {
      if (attente.has(i)) { attente.delete(i); rej(new Error('délai ' + methode)); }
    }, 40000);
  });
}
const ev = async (x) => {
  const r = await envoyer('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};

async function cliquer(sel) {
  const b = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; e.scrollIntoView({block:'center'});
    const r = e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
  if (!b) throw new Error('introuvable : ' + sel);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await envoyer('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
  }
  await attendre(500);
}

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-anim-'));
let chrome;

try {
  fs.mkdirSync(SORTIE, { recursive: true });
  chrome = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profil}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--lang=fr-FR',
    '--enable-precise-memory-info', 'about:blank',
  ], { stdio: 'ignore' });

  let urlWs;
  for (let i = 0; i < 40 && !urlWs; i += 1) {
    try {
      const c = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
      urlWs = c.find((x) => x.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* démarrage */ }
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
  await envoyer('Network.enable');
  await envoyer('Performance.enable');
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 393, height: 873, deviceScaleFactor: 2, mobile: true,
  });

  const t0 = Date.now();
  await envoyer('Page.navigate', { url: BASE + '/carte' });
  await attendre(4500);
  mesures.chargementInitialMs = Date.now() - t0;

  // ------------------------------------------------------ poids annoncé
  await cliquer('#charger-satellite');
  await attendre(2500);
  const annonce = await ev("document.querySelector('.satellite-invite b')?.textContent || ''");
  if (/\d+\s*images.*Ko/i.test(annonce)) ok('poids annoncé avant chargement', annonce.trim());
  else ko('poids annoncé', `texte inattendu : « ${annonce} »`);

  // ------------------------------------------------------ chargement réel
  const octetsAvant = await ev(`performance.getEntriesByType('resource')
    .filter(r => r.name.includes('/satellite/')).reduce((t, r) => t + (r.transferSize || 0), 0)`);
  const tCharge = Date.now();
  await cliquer('#confirmer-satellite');
  await attendre(9000);
  mesures.chargementBoucleMs = Date.now() - tCharge;

  const nbImages = await ev('window.__boucleTest ? 0 : (document.querySelectorAll(".satellite").length)');
  const etatBoucle = await ev(`(() => {
    const t = document.querySelector('.satellite__heure b');
    const src = document.querySelector('.satellite__source');
    return { heure: t ? t.textContent : null, source: src ? src.textContent.slice(0, 90) : null };
  })()`);
  if (etatBoucle.heure && etatBoucle.heure !== '—') ok('boucle chargée', 'image affichée : ' + etatBoucle.heure);
  else ko('boucle', 'aucune image affichée après chargement');
  if (/GOES-19/.test(etatBoucle.source || '')) ok('source affichée', etatBoucle.source.slice(0, 60));
  else ko('source', 'la source du satellite n\'est pas indiquée');

  const octetsApres = await ev(`performance.getEntriesByType('resource')
    .filter(r => r.name.includes('/satellite/')).reduce((t, r) => t + (r.transferSize || 0), 0)`);
  mesures.octetsSatellite = octetsApres - octetsAvant;

  // ------------------------------------------------------ pixels réellement peints
  const peint = await ev(`(() => {
    const c = document.querySelector('#carte');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const s = new Set();
    for (let i = 0; i < d.length; i += 2000) s.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return s.size;
  })()`);
  mesures.nuancesCarte = peint;
  if (peint > 40) ok('image satellite peinte sur la carte', peint + ' nuances distinctes');
  else ko('rendu satellite', 'la carte semble ne rien afficher de nouveau');

  // ------------------------------------------------------ lecture et pause
  const idx1 = await ev("document.querySelector('#sat-curseur')?.value");
  await attendre(2200);
  const idx2 = await ev("document.querySelector('#sat-curseur')?.value");
  if (idx1 !== idx2) ok('lecture automatique', `image ${idx1} → ${idx2}`);
  else note('lecture automatique', 'aucun changement observé (mouvement réduit ?)');

  await cliquer('#sat-play');
  const p1 = await ev("document.querySelector('#sat-curseur')?.value");
  await attendre(1800);
  const p2 = await ev("document.querySelector('#sat-curseur')?.value");
  if (p1 === p2) ok('pause effective', 'la boucle reste sur la même image');
  else ko('pause', 'la boucle continue malgré la pause');

  // ------------------------------------------------------ navigation manuelle
  await cliquer('#sat-prec');
  const apresPrec = await ev("document.querySelector('#sat-curseur')?.value");
  if (Number(apresPrec) === Number(p2) - 1) ok('image précédente', `${p2} → ${apresPrec}`);
  else ko('image précédente', `attendu ${Number(p2) - 1}, obtenu ${apresPrec}`);

  const badgeDirect = await ev(`!!document.querySelector('#sat-direct')`);
  if (badgeDirect) ok('sortie du direct signalée', 'bouton « Revenir au direct » affiché');
  else ko('badge direct', 'aucun retour au direct proposé alors qu\'on est dans le passé');

  await cliquer('#sat-direct');
  const auDirect = await ev(`!!document.querySelector('.satellite .etiquette--officiel')`);
  if (auDirect) ok('retour au direct', 'badge « Direct » rétabli');
  else ko('retour au direct', 'le badge Direct n\'est pas revenu');

  // ------------------------------------------------------ vitesse
  await cliquer('[data-vitesse="2"]');
  const vitesseActive = await ev(`document.querySelector('[data-vitesse="2"]')?.classList.contains('est-actif')`);
  if (vitesseActive) ok('changement de vitesse', '2× sélectionné');
  else ko('vitesse', 'le réglage 2× ne s\'applique pas');

  // ------------------------------------------------------ curseur temporel
  await ev(`(() => { const c = document.querySelector('#sat-curseur');
    c.value = 2; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await attendre(600);
  const apresCurseur = await ev("document.querySelector('#sat-curseur')?.value");
  if (String(apresCurseur) === '2') ok('curseur temporel', 'position 2 atteinte');
  else ko('curseur', `position ${apresCurseur} au lieu de 2`);

  // ------------------------------------------------------ résumé accessible
  const resume = await ev("document.querySelector('.satellite__resume')?.textContent || ''");
  if (resume.length > 40) ok('résumé textuel accessible', resume.slice(0, 70) + '…');
  else ko('résumé accessible', 'absent : la couleur serait le seul moyen de comprendre');

  // ------------------------------------------------------ performances
  const perf = await envoyer('Performance.getMetrics');
  const metrique = (n) => perf.metrics.find((m) => m.name === n)?.value;
  mesures.memoireJsMo = Math.round((metrique('JSHeapUsedSize') || 0) / 1048576 * 10) / 10;
  mesures.noeudsDom = metrique('Nodes');

  // Fluidité : on compte les images rendues pendant deux secondes de lecture.
  await cliquer('[data-vitesse="1"]');
  await cliquer('#sat-play');
  const fps = await ev(`new Promise(r => {
    let n = 0; const t0 = performance.now();
    function tic() { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tic); else r(Math.round(n / 2)); }
    requestAnimationFrame(tic);
  })`);
  mesures.fps = fps;
  if (fps >= 30) ok('fluidité', fps + ' images par seconde');
  else note('fluidité', fps + ' images par seconde (headless, sans accélération matérielle)');

  // ------------------------------------------------------ onglet masqué
  await envoyer('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  const avantCache = await ev("document.querySelector('#sat-curseur')?.value");
  await ev(`Object.defineProperty(document, 'hidden', { value: true, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'))`);
  await attendre(1800);
  const apresCache = await ev("document.querySelector('#sat-curseur')?.value");
  if (avantCache === apresCache) ok('pause quand l\'onglet est masqué', 'aucune image consommée pour rien');
  else ko('onglet masqué', 'l\'animation continue en arrière-plan');

  // ------------------------------------------------------ fuite mémoire
  const memAvant = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
  await ev(`(() => { for (let i = 0; i < 60; i++) {
    const c = document.querySelector('#carte'); if (c) c.dispatchEvent(new Event('mousemove')); } })()`);
  await attendre(1500);
  const memApres = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
  mesures.deriveMemoireMo = Math.round((memApres - memAvant) / 1048576 * 10) / 10;
  if (mesures.deriveMemoireMo < 12) ok('pas de dérive mémoire notable', mesures.deriveMemoireMo + ' Mo');
  else ko('mémoire', 'dérive de ' + mesures.deriveMemoireMo + ' Mo');

  await envoyer('Page.captureScreenshot', { format: 'png' })
    .then((r) => fs.writeFileSync(path.join(SORTIE, '21-carte-satellite-mobile.png'), Buffer.from(r.data, 'base64')));

  // ------------------------------------------------------ largeurs d'écran
  for (const largeur of [320, 360, 390, 412, 768, 1920]) {
    await envoyer('Emulation.setDeviceMetricsOverride', {
      width: largeur, height: largeur < 500 ? 780 : 1000,
      deviceScaleFactor: 1, mobile: largeur < 500,
    });
    await attendre(700);
    const debord = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    if (debord > 1) ko(`largeur ${largeur} px`, `débordement de ${debord} px`);
    else ok(`largeur ${largeur} px`, 'aucun débordement');
  }

  // ------------------------------------------------------ mouvement réduit
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 393, height: 873, deviceScaleFactor: 2, mobile: true,
  });
  await envoyer('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await envoyer('Page.navigate', { url: BASE + '/carte' });
  await attendre(4000);
  await cliquer('#charger-satellite');
  await attendre(2200);
  await cliquer('#confirmer-satellite');
  await attendre(9000);
  const r1 = await ev("document.querySelector('#sat-curseur')?.value");
  await attendre(2500);
  const r2 = await ev("document.querySelector('#sat-curseur')?.value");
  if (r1 === r2) ok('mouvement réduit respecté', 'aucune lecture automatique');
  else ko('prefers-reduced-motion', 'la boucle démarre malgré la préférence');
  const mention = await ev("document.body.innerText.includes('Animations réduites')");
  if (mention) ok('mouvement réduit expliqué', 'la commande manuelle reste proposée');
  else note('mouvement réduit', 'aucune mention affichée');
  await envoyer('Emulation.setEmulatedMedia', { features: [] });
} finally {
  if (chrome) chrome.kill();
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

console.log('\n=== CARTE ANIMÉE ===');
for (const c of constats) {
  const marque = c.etat === 'ok' ? '  ok  ' : c.etat === 'note' ? ' note ' : 'ÉCHEC ';
  console.log(`${marque} ${c.q}${c.d ? ' — ' + c.d : ''}`);
}
console.log('\n=== MESURES ===');
console.log(`  chargement initial de la page : ${mesures.chargementInitialMs} ms`);
console.log(`  chargement de la boucle       : ${mesures.chargementBoucleMs} ms`);
console.log(`  données satellite téléchargées: ${Math.round((mesures.octetsSatellite || 0) / 1024)} Ko`);
console.log(`  mémoire JS utilisée           : ${mesures.memoireJsMo} Mo`);
console.log(`  dérive mémoire après usage    : ${mesures.deriveMemoireMo} Mo`);
console.log(`  nœuds DOM                     : ${mesures.noeudsDom}`);
console.log(`  fluidité                      : ${mesures.fps} img/s`);

const echecs = constats.filter((c) => c.etat === 'ECHEC');
console.log(`\n${constats.filter((c) => c.etat === 'ok').length} contrôles réussis, ${echecs.length} échec(s).`);
process.exit(echecs.length ? 1 : 0);
