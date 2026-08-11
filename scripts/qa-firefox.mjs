/**
 * Contrôle Firefox.
 *
 * Toute la QA passe par Chrome et son protocole de débogage ; or Firefox a son
 * propre moteur de rendu, ses propres règles sur les `<select>`, les
 * `color-mix()`, les masques CSS et les fontes woff2. Ce script ouvre
 * l'application dans Firefox et vérifie l'essentiel via Marionette, le
 * protocole d'automatisation intégré au navigateur.
 *
 *   node scripts/qa-firefox.mjs
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.KDL_QA_BASE || 'http://127.0.0.1:4240';
const PORT = 2828;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const constats = [];
const verifier = (condition, quoi, detail = '') =>
  constats.push({ etat: condition ? 'ok' : 'ko', quoi, detail });

/** Marionette parle en « longueur:corps », un JSON par message. */
function creerClient(socket) {
  let tampon = '';
  const attentes = [];
  socket.on('data', (morceau) => {
    tampon += morceau.toString();
    for (;;) {
      const sep = tampon.indexOf(':');
      if (sep === -1) return;
      const taille = Number(tampon.slice(0, sep));
      if (!Number.isFinite(taille) || tampon.length < sep + 1 + taille) return;
      const message = tampon.slice(sep + 1, sep + 1 + taille);
      tampon = tampon.slice(sep + 1 + taille);
      const suivant = attentes.shift();
      if (suivant) suivant(JSON.parse(message));
    }
  });

  let identifiant = 0;
  return {
    premier: () => new Promise((res) => attentes.push(res)),
    envoyer(commande, parametres = {}) {
      identifiant += 1;
      const charge = JSON.stringify([0, identifiant, commande, parametres]);
      socket.write(`${Buffer.byteLength(charge)}:${charge}`);
      return new Promise((res, rej) => {
        attentes.push((reponse) => {
          if (Array.isArray(reponse) && reponse[2]) rej(new Error(JSON.stringify(reponse[2]).slice(0, 160)));
          else res(Array.isArray(reponse) ? reponse[3] : reponse);
        });
        setTimeout(() => rej(new Error('délai ' + commande)), 40000);
      });
    },
  };
}

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-ff-'));
let firefox;

try {
  fs.writeFileSync(path.join(profil, 'user.js'), [
    'user_pref("marionette.enabled", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
  ].join('\n'));

  firefox = spawn('firefox', [
    '--marionette', '--headless', '--no-remote', '--profile', profil, 'about:blank',
  ], { stdio: 'ignore' });

  // Attendre que Marionette écoute.
  let socket = null;
  for (let i = 0; i < 60 && !socket; i += 1) {
    await attendre(500);
    socket = await new Promise((res) => {
      const essai = net.connect(PORT, '127.0.0.1');
      essai.once('connect', () => res(essai));
      essai.once('error', () => res(null));
    });
  }
  if (!socket) throw new Error('Marionette injoignable — Firefox n\'a pas démarré');

  const client = creerClient(socket);
  await client.premier();                       // message d'accueil du serveur
  await client.envoyer('WebDriver:NewSession', { capabilities: {} });
  await client.envoyer('WebDriver:SetWindowRect', { width: 1280, height: 900 });
  await client.envoyer('WebDriver:Navigate', { url: BASE });
  await attendre(4000);

  const lire = async (script) => {
    const r = await client.envoyer('WebDriver:ExecuteScript', { script: 'return ' + script, args: [] });
    return r && r.value;
  };

  verifier(await lire("document.documentElement.dataset.theme === 'clair'"),
    'ouverture en mode clair');
  verifier(await lire("!!document.querySelector('#choix-territoire')"),
    'sélecteur de territoire présent');
  verifier(await lire("document.querySelectorAll('#choix-territoire option').length") === 9,
    'neuf territoires proposés');
  verifier(await lire('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'),
    'aucun débordement horizontal');

  // Les fontes : Firefox refuse un woff2 mal formé, le test le dirait.
  const fontes = await lire(`(function(){
    var n = 0; document.fonts.forEach(function(f){ if (f.status === 'loaded') n += 1; }); return n;
  })()`);
  verifier(fontes >= 1, 'fontes web chargées par Firefox', String(fontes) + ' graisses');

  // color-mix() : la palette entière en dépend.
  const fondCarte = await lire(`(function(){
    var e = document.querySelector('.stat') || document.querySelector('.carte-bloc');
    return e ? getComputedStyle(e).backgroundColor : '';
  })()`);
  verifier(!!fondCarte && fondCarte !== 'rgba(0, 0, 0, 0)', 'couleurs calculées correctement', fondCarte);

  await client.envoyer('WebDriver:ExecuteScript', {
    script: "document.querySelector('.nav__lien[data-vue=\"meteo\"]').click(); return 1;", args: [],
  });
  await attendre(5000);
  verifier(await lire("!!document.querySelector('.meteo-actuel')"), 'page météo rendue');
  verifier(await lire("!!document.querySelector('.graphe svg')"), 'graphique horaire tracé');

  await client.envoyer('WebDriver:ExecuteScript', {
    script: "document.querySelector('.nav__lien[data-vue=\"carte\"]').click(); return 1;", args: [],
  });
  await attendre(3500);
  verifier(await lire("(function(){var c=document.querySelector('#carte');return !!c && c.width > 100;})()"),
    'carte dessinée');

  await client.envoyer('WebDriver:DeleteSession', {});
  socket.end();

  console.log('\n=== FIREFOX ===');
  constats.forEach((c) => {
    console.log(`  ${c.etat === 'ok' ? 'ok  ' : 'ÉCHEC'} ${c.quoi}${c.detail ? ' — ' + c.detail : ''}`);
  });
  const echecs = constats.filter((c) => c.etat === 'ko').length;
  console.log(`\n${constats.length - echecs} réussis, ${echecs} échec(s).`);
  if (echecs) process.exitCode = 1;
} catch (e) {
  console.error('échec :', e.message);
  process.exitCode = 1;
} finally {
  firefox?.kill();
  await attendre(500);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil résiduel */ }
}
