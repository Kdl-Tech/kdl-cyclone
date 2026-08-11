/**
 * Contrôle du choix de territoire.
 *
 * Le point critique : chaque territoire doit afficher **ses** autorités.
 * Renvoyer un habitant de Sainte-Lucie vers la préfecture de Guadeloupe un
 * jour d'alerte serait une faute grave, et c'est exactement ce que ce script
 * cherche à prendre en défaut.
 *
 *   node --experimental-websocket scripts/qa-territoires.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9412;
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const constats = [];
const ok = (q, d) => constats.push(['ok', q, d]);
const ko = (q, d) => constats.push(['ECHEC', q, d]);

let ws; let id = 0;
const attente = new Map();
function env(m, p = {}) {
  id += 1;
  const i = id;
  return new Promise((res, rej) => {
    attente.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => { if (attente.has(i)) { attente.delete(i); rej(new Error('délai ' + m)); } }, 30000);
  });
}
const ev = async (x) => {
  const r = await env('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-terr-'));
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

  await env('Page.enable');
  await env('Runtime.enable');
  await env('Emulation.setDeviceMetricsOverride', {
    width: 393, height: 873, deviceScaleFactor: 2, mobile: true,
  });
  await env('Page.navigate', { url: BASE });
  await attendre(4500);

  // ------------------------------------------------- le sélecteur existe
  const options = await ev(`[...document.querySelectorAll('#choix-territoire option')]
    .map(o => o.value)`);
  if (options && options.length >= 8) ok('sélecteur de territoire', options.length + ' territoires');
  else ko('sélecteur', `seulement ${options ? options.length : 0} territoire(s)`);

  const defaut = await ev("document.querySelector('#choix-territoire')?.value");
  defaut === 'guadeloupe'
    ? ok('Guadeloupe par défaut', '')
    : ko('territoire par défaut', `« ${defaut} » au lieu de guadeloupe`);

  // ------------------------------- les autorités changent avec le territoire
  const attendus = {
    guadeloupe: { doit: /Météo-France|Préfecture de la Guadeloupe/i, jamais: /Saint Lucia|Barbados|Dominica/i },
    'sainte-lucie': { doit: /Saint Lucia Meteorological/i, jamais: /Préfecture de la Guadeloupe/i },
    barbade: { doit: /Barbados Meteorological/i, jamais: /Préfecture/i },
    dominique: { doit: /Dominica Meteorological/i, jamais: /Préfecture/i },
    martinique: { doit: /Préfecture de la Martinique/i, jamais: /Préfecture de la Guadeloupe/i },
  };

  for (const [cle, regles] of Object.entries(attendus)) {
    await ev(`(() => { const s = document.querySelector('#choix-territoire');
      s.value = ${JSON.stringify(cle)};
      s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await attendre(900);

    const bloc = await ev("document.querySelector('#liens-officiels')?.innerText || ''");
    if (!regles.doit.test(bloc)) {
      ko(`autorités de ${cle}`, "l'autorité attendue n'est pas affichée");
    } else if (regles.jamais.test(bloc)) {
      ko(`autorités de ${cle}`, 'une autorité d\'un AUTRE territoire est affichée');
    } else {
      const premier = await ev("document.querySelector('#liens-officiels .lien-officiel__nom')?.textContent || ''");
      ok(`autorités de ${cle}`, premier.trim().slice(0, 46));
    }

    // Le libellé du risque doit nommer le territoire choisi.
    const nomAffiche = await ev(`[...document.querySelectorAll('.situation__pied div')]
      .map(d => d.textContent).join(' ')`);
    const nomAttendu = await ev(`document.querySelector('#choix-territoire option[value=${JSON.stringify(cle)}]').textContent`);
    nomAffiche.includes(nomAttendu)
      ? ok(`libellé du risque pour ${cle}`, nomAttendu)
      : ko(`libellé du risque pour ${cle}`, `« ${nomAttendu} » absent du bandeau`);
  }

  // ------------------------------- les distances changent avec le territoire
  await ev(`(() => { const s = document.querySelector('#choix-territoire');
    s.value = 'guadeloupe'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await attendre(800);
  const dGp = await ev("document.querySelector('.systeme__meta b')?.textContent || ''");
  await ev(`(() => { const s = document.querySelector('#choix-territoire');
    s.value = 'trinite-tobago'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await attendre(800);
  const dTt = await ev("document.querySelector('.systeme__meta b')?.textContent || ''");
  dGp !== dTt
    ? ok('distances recalculées', `Guadeloupe ${dGp} → Trinité ${dTt}`)
    : ko('distances', `identiques (${dGp}) : le territoire n'est pas pris en compte`);

  // ------------------------------------------- le choix survit au rechargement
  await env('Page.navigate', { url: BASE });
  await attendre(4200);
  const apresRechargement = await ev("document.querySelector('#choix-territoire')?.value");
  apresRechargement === 'trinite-tobago'
    ? ok('choix mémorisé', 'conservé après rechargement')
    : ko('mémorisation', `« ${apresRechargement} » après rechargement`);

  // --------------------------------------------- le cadran nomme le territoire
  const centre = await ev(`(() => {
    const c = document.querySelector('#cadran');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4000) if (d[i] < 250) n++;
    return n;
  })()`);
  centre > 10 ? ok('cadran redessiné', centre + ' points') : ko('cadran', 'vide');

  await ev(`(() => { const s = document.querySelector('#choix-territoire');
    s.value = 'martinique'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await attendre(1000);
  const cap = await env('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SORTIE, '29-territoire-martinique.png'), Buffer.from(cap.data, 'base64'));

  // ------------------------------------------------- aucun débordement ajouté
  for (const largeur of [320, 360, 393]) {
    await env('Emulation.setDeviceMetricsOverride', {
      width: largeur, height: 780, deviceScaleFactor: 2, mobile: true,
    });
    await attendre(600);
    const deb = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    deb > 1 ? ko(`largeur ${largeur}`, `débordement ${deb} px`) : ok(`largeur ${largeur}`, '');
  }
} finally {
  if (chrome) chrome.kill();
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

console.log('\n=== TERRITOIRES ===');
for (const [etat, q, d] of constats) {
  console.log(`${etat === 'ok' ? '  ok  ' : 'ÉCHEC '} ${q}${d ? ' — ' + d : ''}`);
}
const echecs = constats.filter((c) => c[0] === 'ECHEC');
console.log(`\n${constats.length - echecs.length} réussis, ${echecs.length} échec(s).`);
process.exit(echecs.length ? 1 : 0);
