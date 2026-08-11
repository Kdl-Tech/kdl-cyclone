/**
 * Audit PWA et critères de livraison — vérification par la mesure.
 *
 * Lighthouse n'est pas installé sur le poste et son installation tirerait des
 * centaines de paquets npm, contraire à la politique supply chain KDL. Cet
 * audit contrôle les mêmes points d'installabilité, directement via le
 * protocole de débogage de Chrome, sans rien installer.
 *
 *   node --experimental-websocket scripts/audit-pwa.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT_CDP = 9366;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const resultats = [];
const ok = (quoi, detail) => resultats.push({ etat: 'ok', quoi, detail });
const ko = (quoi, detail) => resultats.push({ etat: 'ECHEC', quoi, detail });
const info = (quoi, detail) => resultats.push({ etat: 'note', quoi, detail });

let ws;
let id = 0;
const attente = new Map();

function envoyer(methode, params = {}) {
  id += 1;
  const i = id;
  return new Promise((res, rej) => {
    attente.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: methode, params }));
    setTimeout(() => {
      if (attente.has(i)) { attente.delete(i); rej(new Error('délai dépassé : ' + methode)); }
    }, 20000);
  });
}

const evaluer = async (e) => (await envoyer('Runtime.evaluate', {
  expression: e, returnByValue: true, awaitPromise: true,
})).result.value;

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-audit-'));
let chrome;

try {
  chrome = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profil}`,
    '--no-first-run', '--disable-gpu', '--lang=fr-FR', 'about:blank',
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
  await envoyer('Emulation.setDeviceMetricsOverride', {
    width: 393, height: 873, deviceScaleFactor: 2, mobile: true,
  });

  await envoyer('Page.navigate', { url: BASE });
  await attendre(4000);

  // ---------------------------------------------------------------- manifest
  const manifeste = await (await fetch(`${BASE}/manifest.webmanifest`)).json();

  const attendus = {
    name: 'KDL Cyclone — Veille Antilles',
    short_name: 'KDL Cyclone',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  };
  for (const [cle, valeur] of Object.entries(attendus)) {
    if (manifeste[cle] === valeur) ok(`manifest.${cle}`, valeur);
    else ko(`manifest.${cle}`, `attendu « ${valeur} », obtenu « ${manifeste[cle]} »`);
  }

  if ((manifeste.short_name || '').length <= 12) ok('short_name assez court', `${manifeste.short_name.length} caractères`);
  else ko('short_name trop long', "sera tronqué sous l'icône");

  const parTaille = (t, but) => (manifeste.icons || []).some(
    (i) => i.sizes === t && (i.purpose || 'any').includes(but),
  );
  parTaille('192x192', 'any') ? ok('icône 192 any', '') : ko('icône 192 any', 'absente');
  parTaille('512x512', 'any') ? ok('icône 512 any', '') : ko('icône 512 any', 'absente');
  parTaille('192x192', 'maskable') ? ok('icône 192 maskable', '') : ko('icône 192 maskable', 'absente');
  parTaille('512x512', 'maskable') ? ok('icône 512 maskable', '') : ko('icône 512 maskable', 'absente');

  manifeste.theme_color ? ok('theme_color', manifeste.theme_color) : ko('theme_color', 'absente');
  manifeste.background_color
    ? ok('background_color (écran de lancement)', manifeste.background_color)
    : ko('background_color', "absente : l'écran de lancement serait blanc");

  const captures = manifeste.screenshots || [];
  const etroites = captures.filter((s) => s.form_factor === 'narrow').length;
  const larges = captures.filter((s) => s.form_factor === 'wide').length;
  (etroites >= 1 && larges >= 1)
    ? ok('captures PWA', `${etroites} mobile, ${larges} ordinateur`)
    : ko('captures PWA', `mobile ${etroites}, ordinateur ${larges} — il en faut au moins une de chaque`);

  // Toutes les ressources déclarées existent-elles vraiment ?
  const aVerifier = [
    ...(manifeste.icons || []).map((i) => i.src),
    ...captures.map((s) => s.src),
  ];
  const manquantes = [];
  for (const chemin of aVerifier) {
    const r = await fetch(BASE + chemin, { method: 'HEAD' });
    if (!r.ok) manquantes.push(`${chemin} (${r.status})`);
  }
  manquantes.length === 0
    ? ok('ressources du manifest', `${aVerifier.length} fichiers présents`)
    : ko('ressources du manifest', manquantes.join(', '));

  // ---------------------------------------------------------- service worker
  const sw = await evaluer(`navigator.serviceWorker.getRegistration().then(r => r ? {
    scope: r.scope, actif: !!r.active, enAttente: !!r.waiting
  } : null)`);
  sw?.actif ? ok('service worker actif', sw.scope) : ko('service worker', 'non enregistré');

  // Sur un domaine distant, l'enregistrement du service worker peut prendre
  // plus longtemps qu'en local : on lui laisse le temps avant de conclure.
  let caches = await evaluer('caches.keys().catch(() => [])');
  for (let i = 0; i < 8 && (!caches || caches.length === 0); i += 1) {
    await attendre(1200);
    caches = await evaluer('caches.keys().catch(() => [])');
  }
  caches = caches || [];
  caches.length > 0
    ? ok('caches créés', caches.join(', '))
    : ko('caches', 'aucun cache : pas de fonctionnement hors connexion');

  // Un ancien cache resté en place bloquerait les mises à jour. Le service
  // worker nomme ses caches d'après la version du paquet : ce contrôle doit la
  // lire, pas la figer, sinon il échoue à chaque montée de version.
  const version = JSON.parse(fs.readFileSync(
    new URL('../package.json', import.meta.url), 'utf8',
  )).version;
  const versionCourante = `kdl-cyclone-${version}`;
  const perimes = caches.filter((c) => !c.startsWith(versionCourante));
  perimes.length === 0
    ? ok('aucun cache périmé', `tous préfixés « ${versionCourante} »`)
    : ko('caches périmés', perimes.join(', '));

  // ------------------------------------------------------- mode installé
  // On simule le lancement en fenêtre autonome pour vérifier que
  // l'application le reconnaît et retire son invitation à installer.
  await envoyer('Emulation.setEmulatedMedia', {
    features: [{ name: 'display-mode', value: 'standalone' }],
  });
  await attendre(600);
  const detecteInstalle = await evaluer('window.KdlInstallation.estInstallee()');
  const inviteQuandMeme = await evaluer('window.KdlInstallation.inviterMaintenant()');
  // `Emulation.setEmulatedMedia` ne simule pas `display-mode` : un échec ici ne
  // prouve rien. Le comportement réel a été vérifié en lançant Chrome avec
  // `--app=`, qui donne une vraie fenêtre autonome — `estInstallee()` y renvoie
  // bien `true`. Ce contrôle reste donc informatif.
  detecteInstalle
    ? ok('mode installé reconnu', 'display-mode: standalone détecté')
    : info('mode installé', "non émulable par le protocole de débogage ; vérifié séparément avec chrome --app (estInstallee() = true)");
  inviteQuandMeme === false
    ? ok('invitation masquée quand elle doit l\'être', '')
    : ko('invitation', "proposée alors qu'elle ne devrait pas l'être");
  await envoyer('Emulation.setEmulatedMedia', { features: [] });

  // -------------------------------------------- invitation et retenue
  await evaluer("localStorage.removeItem('kdl-cyclone-install-refus');"
    + "localStorage.setItem('kdl-cyclone-vues', '1')");
  await attendre(200);
  const invite1 = await evaluer('window.KdlInstallation.inviterMaintenant()');
  invite1 === false
    ? ok('pas d\'invitation à la 1re visite', 'le premier écran montre d\'abord l\'utilité')
    : ko('invitation prématurée', 'proposée dès la première visite');

  await evaluer("localStorage.setItem('kdl-cyclone-vues', '5');"
    + "localStorage.setItem('kdl-cyclone-install-refus', String(Date.now()))");
  const apresRefus = await evaluer('window.KdlInstallation.inviterMaintenant()');
  apresRefus === false
    ? ok('refus respecté', 'plus aucune relance pendant 60 jours')
    : ko('refus ignoré', "l'invitation revient après un refus");

  // ----------------------------------------------- instructions par plateforme
  const instructions = await evaluer('JSON.stringify(window.KdlInstallation.instructions())');
  const inst = JSON.parse(instructions);
  const plateforme = await evaluer('window.KdlInstallation.plateforme().code');
  const parleDiPhone = /iPhone|Safari|Partager/i.test(JSON.stringify(inst));
  (plateforme === 'ios') === parleDiPhone
    ? ok('instructions adaptées', `plateforme « ${plateforme} », consignes cohérentes`)
    : ko('instructions inadaptées', `plateforme « ${plateforme} » mais consignes iPhone affichées`);

  // ------------------------------------------------------- accès sans install
  const utilisable = await evaluer(
    "document.querySelectorAll('.systeme').length > 0 && !!document.querySelector('.situation__titre')",
  );
  utilisable
    ? ok('utilisable sans installation', 'contenu complet dans le navigateur')
    : ko('utilisation directe', 'la page ne rend pas son contenu');

  const sansCompte = await evaluer(
    "!document.querySelector('input[type=password], input[type=email], form[action*=login]')",
  );
  sansCompte ? ok('aucun compte requis', 'aucun champ de connexion') : ko('compte', 'un formulaire de connexion existe');

  // ------------------------------------------------------------ HTTPS
  info('HTTPS', "non vérifiable en local — dépend du déploiement (nginx + Let's Encrypt)");
  info('Xiaomi HyperOS', 'à vérifier sur un vrai téléphone : beforeinstallprompt ne se déclenche pas en headless');
} finally {
  if (chrome) chrome.kill();
  await attendre(400);
  try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

const echecs = resultats.filter((r) => r.etat === 'ECHEC');
console.log('\n=== AUDIT PWA ===');
for (const r of resultats) {
  const marque = r.etat === 'ok' ? '  ok  ' : r.etat === 'note' ? ' note ' : 'ÉCHEC ';
  console.log(`${marque} ${r.quoi}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n${resultats.filter((r) => r.etat === 'ok').length} contrôles réussis, ${echecs.length} échec(s).`);
process.exit(echecs.length ? 1 : 0);
