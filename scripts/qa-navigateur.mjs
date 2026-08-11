/**
 * Contrôle qualité en navigateur réel, sans dépendance.
 *
 * Pilote Google Chrome en mode headless via le Chrome DevTools Protocol
 * (WebSocket natif de Node). Évite d'installer Playwright et ses 300 Mo de
 * navigateurs, et reste conforme à la politique KDL sur les paquets tiers.
 *
 *   node --experimental-websocket scripts/qa-navigateur.mjs
 *
 * Les captures sont écrites dans ~/Bureau/kdl-cyclone-captures/.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const SORTIE = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures');
const PORT_CDP = 9333;

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------- Chrome

function lancerChrome(profil) {
  return spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${PORT_CDP}`,
    `--user-data-dir=${profil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--lang=fr-FR',
    'about:blank',
  ], { stdio: 'ignore' });
}

async function cibleWs() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
      const cibles = await r.json();
      const page = cibles.find((c) => c.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* le navigateur démarre encore */ }
    await attendre(250);
  }
  throw new Error("Chrome n'a pas exposé de cible de débogage");
}

/** Client CDP minimal : envoi de commandes et attente des réponses. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.enAttente = new Map();
    this.journalConsole = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.enAttente.has(msg.id)) {
        const { resoudre, rejeter } = this.enAttente.get(msg.id);
        this.enAttente.delete(msg.id);
        msg.error ? rejeter(new Error(msg.error.message)) : resoudre(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        this.journalConsole.push(`[console ${msg.params.type}] ` +
          msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.journalConsole.push(`[exception] ${d.exception?.description || d.text}`);
      }
    });
  }

  envoyer(methode, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resoudre, rejeter) => {
      this.enAttente.set(id, { resoudre, rejeter });
      this.ws.send(JSON.stringify({ id, method: methode, params }));
      setTimeout(() => {
        if (this.enAttente.has(id)) {
          this.enAttente.delete(id);
          rejeter(new Error(`délai dépassé sur ${methode}`));
        }
      }, 30000);
    });
  }

  async evaluer(expression) {
    const r = await this.envoyer('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }

  async ecran(largeur, hauteur, mobile) {
    await this.envoyer('Emulation.setDeviceMetricsOverride', {
      width: largeur, height: hauteur, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile,
    });
  }

  async capturer(nom, pleinePage) {
    if (pleinePage) {
      const m = await this.envoyer('Page.getLayoutMetrics');
      const h = Math.min(Math.ceil(m.cssContentSize.height), 12000);
      await this.envoyer('Emulation.setDeviceMetricsOverride', {
        width: Math.ceil(m.cssLayoutViewport.clientWidth), height: h,
        deviceScaleFactor: 2, mobile: true,
      });
      await attendre(400);
    }
    const { data } = await this.envoyer('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SORTIE, nom), Buffer.from(data, 'base64'));
    return nom;
  }

  async naviguer(url) {
    await this.envoyer('Page.navigate', { url });
    await attendre(2600);
  }

  /** Clic réel au centre d'un élément : teste aussi la zone tactile. */
  async cliquer(selecteur) {
    const boite = await this.evaluer(`(() => {
      const el = document.querySelector(${JSON.stringify(selecteur)});
      if (!el) return null;
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
    })()`);
    if (!boite) throw new Error(`élément introuvable : ${selecteur}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.envoyer('Input.dispatchMouseEvent', {
        type, x: boite.x, y: boite.y, button: 'left', clickCount: 1,
      });
    }
    await attendre(650);
    return boite;
  }
}

// -------------------------------------------------------------------- suite

const constats = [];
const noter = (gravite, message) => constats.push({ gravite, message });

async function main() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-qa-'));
  const chrome = lancerChrome(profil);

  let cdp;
  try {
    const url = await cibleWs();
    const ws = new WebSocket(url);
    await new Promise((r, j) => {
      ws.addEventListener('open', r);
      ws.addEventListener('error', () => j(new Error('WebSocket CDP refusée')));
    });
    cdp = new Cdp(ws);

    await cdp.envoyer('Page.enable');
    await cdp.envoyer('Runtime.enable');
    await cdp.envoyer('Network.enable');
    await cdp.envoyer('Emulation.setTouchEmulationEnabled', { enabled: true });

    // ---------------------------------------------------- téléphone (Redmi)
    await cdp.ecran(393, 873, true);
    await cdp.naviguer(BASE);

    const titre = await cdp.evaluer("document.querySelector('.situation__titre')?.textContent || ''");
    if (!titre) noter('bloquant', "l'écran d'accueil n'affiche aucun titre de situation");
    else console.log('Titre de situation :', titre);

    const nbSystemes = await cdp.evaluer("document.querySelectorAll('.systeme').length");
    console.log('Systèmes affichés :', nbSystemes);
    if (nbSystemes === 0) noter('majeur', 'aucune carte de système rendue alors que l\'API en renvoie');

    await cdp.capturer('01-mobile-accueil-clair.png', true);

    // Débordement horizontal : l'anti-pattern à ne jamais laisser passer.
    await cdp.ecran(360, 760, true);
    await attendre(500);
    const debord = await cdp.evaluer(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    if (debord > 1) noter('majeur', `débordement horizontal de ${debord} px à 360 px de large`);
    await cdp.capturer('02-mobile-360.png', true);

    // Contrôle du thème sombre, sans flash.
    await cdp.ecran(393, 873, true);
    await cdp.cliquer('#bouton-theme');
    const theme = await cdp.evaluer('document.documentElement.dataset.theme');
    if (theme !== 'sombre') noter('majeur', 'le bouton de thème ne bascule pas en sombre');
    const aria = await cdp.evaluer("document.querySelector('#bouton-theme').getAttribute('aria-label')");
    if (!/clair/i.test(aria || '')) noter('mineur', `aria-label du thème non mis à jour : « ${aria} »`);
    await cdp.capturer('03-mobile-accueil-sombre.png', true);

    // Le thème doit survivre au rechargement, sans clignotement.
    await cdp.naviguer(BASE);
    const themeApres = await cdp.evaluer('document.documentElement.dataset.theme');
    if (themeApres !== 'sombre') noter('majeur', 'le thème choisi n\'est pas restauré au rechargement');

    // ------------------------------------------------------------- la carte
    await cdp.ecran(393, 873, true);
    await cdp.cliquer('.nav__lien[data-vue="carte"]');
    await attendre(1800);
    const carteDessinee = await cdp.evaluer(`(() => {
      const c = document.querySelector('#carte');
      if (!c || !c.width) return 0;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const couleurs = new Set();
      for (let i = 0; i < d.length; i += 4000) couleurs.add(d[i]+','+d[i+1]+','+d[i+2]);
      return couleurs.size;
    })()`);
    console.log('Nuances distinctes sur la carte :', carteDessinee);
    if (carteDessinee < 6) noter('bloquant', 'la carte semble vide ou uniforme');
    await cdp.capturer('04-mobile-carte-sombre.png', false);

    await cdp.cliquer('#bouton-theme');
    await attendre(700);
    await cdp.capturer('05-mobile-carte-clair.png', false);

    // ---------------------------------------------------- fiche d'un système
    await cdp.cliquer('.nav__lien[data-vue="accueil"]');
    if (nbSystemes > 0) {
      await cdp.cliquer('.systeme');
      const titreFiche = await cdp.evaluer(
        "document.querySelector('section.vue[data-vue=\"systeme\"] h2')?.textContent || ''",
      );
      if (!titreFiche) noter('majeur', "la fiche détaillée ne s'ouvre pas");
      else console.log('Fiche ouverte :', titreFiche);

      const nbFacteurs = await cdp.evaluer("document.querySelectorAll('.facteur').length");
      if (nbFacteurs < 9) noter('majeur', `seulement ${nbFacteurs} facteurs affichés, 9 attendus`);

      await cdp.cliquer('.facteur__tete');
      const ouvert = await cdp.evaluer(
        "document.querySelector('.facteur')?.dataset.ouvert === 'true'",
      );
      if (!ouvert) noter('mineur', "l'explication d'un facteur ne se déplie pas");
      await cdp.capturer('06-mobile-fiche.png', true);
    }

    // ------------------------------------------------------------ les vues
    for (const [vue, fichier, selecteur] of [
      ['guadeloupe', '07-mobile-guadeloupe.png', '.nav__lien[data-vue="guadeloupe"]'],
      ['preparation', '08-mobile-preparation.png', '.nav__lien[data-vue="preparation"]'],
      ['meteo', '09-mobile-meteo.png', '.nav__lien[data-vue="meteo"]'],
      // Sources n'est plus dans la barre : l'onglet a laissé la place à Météo,
      // le lien vit désormais dans le pied de page.
      ['sources', '09b-mobile-sources.png', '.pied [data-vers="sources"]'],
      ['apropos', '14-mobile-apropos.png', '.pied [data-vers="apropos"]'],
    ]) {
      await cdp.ecran(393, 873, true);
      await cdp.cliquer(selecteur);
      const vide = await cdp.evaluer(
        `document.querySelector('section.vue[data-vue="${vue}"]').innerText.trim().length < 60`,
      );
      if (vide) noter('majeur', `la vue « ${vue} » est vide`);
      await cdp.capturer(fichier, true);
    }

    // Cocher un point de préparation doit persister.
    await cdp.ecran(393, 873, true);
    await cdp.cliquer('.nav__lien[data-vue="preparation"]');
    await cdp.cliquer('.prep-item input');
    const stocke = await cdp.evaluer("localStorage.getItem('kdl-cyclone-preparation')");
    if (!stocke || stocke === '{}') noter('majeur', "le mode préparation n'enregistre pas l'avancement");

    // Le fonctionnement hors connexion n'est PAS testé ici : l'émulation réseau
    // du protocole de débogage ne s'applique pas au service worker, qui a son
    // propre contexte réseau, et un test fondé dessus donnerait un faux verdict
    // dans un sens comme dans l'autre. Il est vérifié en coupant réellement le
    // serveur — voir scripts/qa-hors-ligne.mjs.

    // --------------------------------------------------------------- bureau
    await cdp.ecran(1440, 940, false);
    await cdp.naviguer(BASE);
    await cdp.capturer('11-bureau-accueil.png', false);
    await cdp.cliquer('.nav__lien[data-vue="carte"]');
    await attendre(1600);
    await cdp.capturer('12-bureau-carte.png', false);
    await cdp.cliquer('#bouton-theme');
    await attendre(800);
    await cdp.capturer('13-bureau-carte-sombre.png', false);

    // ------------------------------------------------------- accessibilité
    const a11y = await cdp.evaluer(`(() => {
      const soucis = [];
      document.querySelectorAll('img').forEach(i => {
        if (i.alt === null) soucis.push('image sans attribut alt : ' + i.src);
      });
      document.querySelectorAll('button').forEach(b => {
        const t = (b.innerText || '').trim();
        if (!t && !b.getAttribute('aria-label')) soucis.push('bouton sans nom accessible');
      });
      document.querySelectorAll('a[target="_blank"]').forEach(a => {
        if (!/noopener/.test(a.rel || '')) soucis.push('lien externe sans rel=noopener : ' + a.href);
      });
      if (!document.querySelector('main')) soucis.push('pas de repère <main>');
      if (document.querySelectorAll('h1').length !== 1) {
        soucis.push('nombre de <h1> = ' + document.querySelectorAll('h1').length);
      }
      return soucis;
    })()`);
    a11y.forEach((s) => noter('mineur', `accessibilité : ${s}`));

    cdp.journalConsole.forEach((l) => noter('majeur', l));
  } finally {
    chrome.kill();
    // Chrome peut encore écrire dans son profil à l'instant où il meurt :
    // un échec de nettoyage ne doit jamais masquer le résultat du contrôle.
    await attendre(400);
    try {
      fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { /* dossier temporaire laissé en place, sans conséquence */ }
  }

  console.log(`\nCaptures écrites dans ${SORTIE}`);
  console.log('\n=== CONSTATS ===');
  if (constats.length === 0) {
    console.log('Aucun défaut relevé.');
  } else {
    for (const g of ['bloquant', 'majeur', 'mineur']) {
      constats.filter((c) => c.gravite === g).forEach((c) => console.log(`[${g}] ${c.message}`));
    }
  }
  process.exit(constats.some((c) => c.gravite === 'bloquant') ? 1 : 0);
}

main().catch((e) => {
  console.error('Échec du contrôle :', e.message);
  process.exit(2);
});
