/**
 * Contrôle du rendu sur grand écran.
 *
 * L'application est pensée pour le téléphone d'abord ; ce script vérifie
 * qu'elle tient aussi sur un écran de bureau sans paraître perdue au milieu du
 * vide, et capture chaque vue pour un examen visuel.
 *
 *   node --experimental-websocket scripts/qa-grand-ecran.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9399;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const ECRANS = [
  { nom: '1366x768', l: 1366, h: 768 },
  { nom: '1920x1080', l: 1920, h: 1080 },
  { nom: '2560x1440', l: 2560, h: 1440 },
];

const constats = [];
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

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-ge-'));
let chrome;

try {
  fs.mkdirSync(SORTIE, { recursive: true });
  chrome = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profil}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--lang=fr-FR', 'about:blank',
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

  for (const e of ECRANS) {
    await envoyer('Emulation.setDeviceMetricsOverride', {
      width: e.l, height: e.h, deviceScaleFactor: 1, mobile: false,
    });
    await envoyer('Page.navigate', { url: BASE + '/' });
    await attendre(3800);

    // Une largeur de contenu bien inférieure à l'écran donne l'impression
    // d'une page mobile agrandie : c'est précisément ce qu'on veut éviter.
    const mesure = await ev(`(() => {
      const page = document.querySelector('.page');
      const r = page.getBoundingClientRect();
      return {
        contenu: Math.round(r.width),
        fenetre: window.innerWidth,
        ratio: Math.round((r.width / window.innerWidth) * 100),
        colonnes: getComputedStyle(document.querySelector('.grille--accueil')).gridTemplateColumns,
        debord: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);

    const nom = `écran ${e.nom}`;
    if (mesure.debord > 1) constats.push(['ECHEC', nom, `débordement de ${mesure.debord} px`]);
    else if (mesure.ratio < 55) {
      constats.push(['ECHEC', nom, `contenu sur ${mesure.ratio} % de la largeur : trop étroit`]);
    } else {
      constats.push(['ok', nom, `contenu ${mesure.contenu} px sur ${mesure.fenetre} (${mesure.ratio} %)`]);
    }

    const deuxColonnes = (mesure.colonnes || '').split(' ').filter(Boolean).length >= 2;
    constats.push([deuxColonnes ? 'ok' : 'ECHEC', `${nom} — accueil en colonnes`,
      deuxColonnes ? mesure.colonnes : 'une seule colonne, la place est gâchée']);

    const cap = await envoyer('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SORTIE, `22-bureau-${e.nom}-accueil.png`), Buffer.from(cap.data, 'base64'));
  }

  // Carte et fiche sur le plus grand format.
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
  for (const [route, fichier] of [
    ['/carte', '23-bureau-1920-carte.png'],
    ['/beta', '24-bureau-1920-beta.png'],
  ]) {
    await envoyer('Page.navigate', { url: BASE + route });
    await attendre(3500);
    const cap = await envoyer('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SORTIE, fichier), Buffer.from(cap.data, 'base64'));
  }

  // Une fiche système, en deux colonnes attendues.
  const slug = await ev(`fetch('/api/etat').then(r => r.json()).then(e => e.systemes[0].slug)`);
  await envoyer('Page.navigate', { url: `${BASE}/systemes/${slug}` });
  await attendre(3500);
  const colonnesFacteurs = await ev(`(() => {
    const f = document.querySelector('.facteurs');
    return f ? getComputedStyle(f).gridTemplateColumns : null;
  })()`);
  const multi = (colonnesFacteurs || '').split(' ').filter(Boolean).length >= 2;
  constats.push([multi ? 'ok' : 'ECHEC', 'fiche système en colonnes (1920)',
    multi ? colonnesFacteurs : 'colonne unique']);
  const cap = await envoyer('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SORTIE, '25-bureau-1920-fiche.png'), Buffer.from(cap.data, 'base64'));
} finally {
  if (chrome) chrome.kill();
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

console.log('\n=== GRAND ÉCRAN ===');
for (const [etat, quoi, detail] of constats) {
  console.log(`${etat === 'ok' ? '  ok  ' : 'ÉCHEC '} ${quoi} — ${detail}`);
}
const echecs = constats.filter((c) => c[0] === 'ECHEC');
console.log(`\n${constats.length - echecs.length} réussis, ${echecs.length} échec(s).`);
process.exit(echecs.length ? 1 : 0);
