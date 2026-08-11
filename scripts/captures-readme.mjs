/**
 * Refait les captures qui illustrent le README et le dépôt public.
 *
 * Elles étaient prises à la main, donc elles vieillissaient en silence : après
 * la refonte du choix de commune, le README montrait encore l'ancienne
 * interface. Une capture périmée sur une page publique est un mensonge poli.
 *
 *   node --experimental-websocket scripts/captures-readme.mjs [url]
 *
 * Par défaut sur la production, pour montrer ce que voit réellement un
 * visiteur. Passer `http://127.0.0.1:4240/` pour illustrer un travail en cours.
 */

import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const BASE = (process.argv[2] || 'https://cyclone.kdl-tech.fr/').replace(/\/$/, '');
const SORTIE = path.join(ROOT, 'public', 'screenshots');
const PORT = 9350;

/** Les vues qui illustrent le projet, et ce qu'on veut y voir. */
const VUES = [
  { fichier: 'apercu-accueil-clair', chemin: '/', theme: 'clair', large: true },
  { fichier: 'apercu-accueil-sombre', chemin: '/', theme: 'sombre', large: true },
  { fichier: 'apercu-meteo-clair', chemin: '/meteo?lieu=deshaies', theme: 'clair', large: true },
  { fichier: 'apercu-carte-sombre', chemin: '/carte', theme: 'sombre', large: true },
  { fichier: 'apercu-mobile-clair', chemin: '/meteo?lieu=sainte-anne', theme: 'clair', large: false },
  { fichier: 'apercu-mobile-sombre', chemin: '/carte', theme: 'sombre', large: false },
];

const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--user-data-dir=/tmp/captures-readme', 'about:blank'], { stdio: 'ignore' });
await pause(2600);

const cible = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((c) => c.type === 'page');
const sock = new globalThis.WebSocket(cible.webSocketDebuggerUrl);
let id = 0;
const attentes = new Map();
sock.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attentes.has(m.id)) { attentes.get(m.id)(m.result); attentes.delete(m.id); }
});
await new Promise((r) => sock.addEventListener('open', r));
const cmd = (methode, params = {}) => new Promise((res) => {
  const n = ++id; attentes.set(n, res); sock.send(JSON.stringify({ id: n, method: methode, params }));
});
const js = (expr) => cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
  .then((r) => r?.result?.value);

await cmd('Page.enable');
await cmd('Runtime.enable');
await fs.mkdir(SORTIE, { recursive: true });

for (const vue of VUES) {
  const largeur = vue.large ? 1280 : 390;
  const hauteur = vue.large ? 900 : 844;
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: largeur, height: hauteur, deviceScaleFactor: 2, mobile: !vue.large,
  });
  await cmd('Page.navigate', { url: BASE + vue.chemin });
  await pause(7000);

  // Le thème se force explicitement : suivre le réglage système donnerait des
  // captures différentes d'une machine à l'autre.
  await js(`document.documentElement.setAttribute('data-theme', '${vue.theme}')`);
  await pause(1200);

  // La carte a besoin d'un instant de plus : elle se dessine après ses données.
  if (vue.chemin.startsWith('/carte')) await pause(4000);

  const img = await cmd('Page.captureScreenshot', { format: 'png' });
  const dest = path.join(SORTIE, `${vue.fichier}.png`);
  await fs.writeFile(dest, Buffer.from(img.data, 'base64'));
  const { size } = await fs.stat(dest);
  console.log(`  ${vue.fichier.padEnd(24)} ${largeur}×${hauteur}  ${Math.round(size / 1024)} Ko`);
}

sock.close();
chrome.kill();
console.log(`\n${VUES.length} captures écrites dans public/screenshots/`);
