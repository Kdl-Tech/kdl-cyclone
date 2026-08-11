/**
 * Produit le tutoriel PDF de KDL Cyclone.
 *
 * Le document est écrit en HTML puis imprimé par Chrome (`--print-to-pdf`) :
 * aucune bibliothèque PDF n'est nécessaire, et la mise en page est celle,
 * fidèle, d'un moteur de rendu web.
 *
 * Toutes les illustrations sont de vraies captures de l'application, prises
 * par les scripts de contrôle qualité — aucune maquette, aucun montage.
 *
 *   node --experimental-websocket scripts/tutoriel-pdf.mjs
 */

import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CAPTURES = path.join(os.homedir(), 'Bureau', 'kdl-cyclone-captures');
const BUREAU = path.join(os.homedir(), 'Bureau');
const SORTIE_PDF = path.join(BUREAU, 'KDL_Cyclone_Tutoriel.pdf');
const HTML = path.join(CAPTURES, '_tutoriel.html');
const URL_APP = 'https://cyclone.kdl-tech.fr';

/** Encode une capture en base64 pour que le PDF soit autonome. */
function image(nom, hauteurMax) {
  const chemin = path.join(CAPTURES, nom);
  if (!fs.existsSync(chemin)) return '<p class="manquant">Capture indisponible : ' + nom + '</p>';
  const b64 = fs.readFileSync(chemin).toString('base64');
  return `<img src="data:image/png;base64,${b64}" alt=""${hauteurMax ? ` style="max-height:${hauteurMax}"` : ''}>`;
}

function logo(taille) {
  const chemin = path.join(os.homedir(), 'Bureau', 'kdl-cyclone', 'public', 'icons', 'logo-96.png');
  if (!fs.existsSync(chemin)) return '';
  return `<img class="logo" style="width:${taille}px;height:${taille}px" src="data:image/png;base64,${fs.readFileSync(chemin).toString('base64')}" alt="">`;
}

const dateFr = new Date().toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Guadeloupe',
});

const version = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), 'Bureau', 'kdl-cyclone', 'package.json'), 'utf8'),
).version;

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>KDL Cyclone — mode d'emploi</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Inter", system-ui, "Segoe UI", Roboto, sans-serif;
    color: #12263a; line-height: 1.6; font-size: 10.8pt; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1, h2, h3 { line-height: 1.2; letter-spacing: -0.02em; margin: 0; }
  p { margin: 0 0 0.7em; }

  .garde {
    page-break-after: always;
    background: linear-gradient(155deg, #1f5278 0%, #123c5c 50%, #061a2a 100%);
    color: #eaf4fa; margin: -16mm -14mm 0; padding: 40mm 20mm 20mm;
    height: 265mm; display: flex; flex-direction: column;
  }
  .garde .logo { border-radius: 12px; background: #eef4f9; padding: 5px; }
  .garde h1 { font-size: 40pt; font-weight: 800; margin: 14mm 0 4mm; }
  .garde .sous { font-size: 15pt; color: #8fd6f2; font-weight: 600; }
  .garde .signature { font-size: 12pt; color: rgba(234,244,250,.72); margin-top: 5mm; font-style: italic; }
  .garde .pied { margin-top: auto; font-size: 10pt; color: rgba(234,244,250,.7); }
  .garde .pied strong { color: #fff; }
  .badge-beta {
    display: inline-block; background: rgba(240,182,92,.16); color: #f0b65c;
    border: 1px solid rgba(240,182,92,.4); border-radius: 999px;
    padding: 3px 11px; font-size: 9pt; font-weight: 700; letter-spacing: .09em;
  }

  /* Une capture pleine page fait plusieurs milliers de pixels de haut :
     sans cadrage, elle occuperait une page entière et séparerait le titre
     de son texte. On montre le haut de l'écran, qui porte l'information. */
  section { margin-bottom: 9mm; }
  h2 { page-break-after: avoid; }
  .duo, .large { page-break-inside: avoid; }
  .num {
    display: inline-block; width: 24px; height: 24px; line-height: 24px;
    text-align: center; border-radius: 7px; background: #1f5278; color: #fff;
    font-weight: 700; font-size: 11pt; margin-right: 8px;
  }
  h2 { font-size: 17pt; font-weight: 750; color: #0a2133; margin-bottom: 3mm; }
  h3 { font-size: 12pt; font-weight: 700; margin: 4mm 0 2mm; color: #1f5278; }

  .duo { display: flex; gap: 7mm; align-items: flex-start; }
  .duo .texte { flex: 1; }
  .duo .visuel { flex: 0 0 56mm; }
  .duo .visuel img {
    height: 118mm; width: 100%;
    object-fit: cover; object-position: top center;
  }
  img { max-width: 100%; border-radius: 6px; border: 1px solid #d3e0ec; display: block; }
  .large img {
    max-height: 105mm; width: auto; margin: 0 auto;
    object-fit: cover; object-position: top center;
  }
  .large--entier img { max-height: none; width: 100%; object-fit: contain; }
  .manquant { color: #b8342a; font-size: 9pt; }

  ul { margin: 0 0 0.7em; padding-left: 1.1em; }
  li { margin-bottom: 0.3em; }

  .encart {
    background: #f2f7fb; border-left: 3px solid #0b8fb8;
    padding: 3.5mm 5mm; border-radius: 0 6px 6px 0; margin: 3mm 0;
    font-size: 10pt;
  }
  .encart--attention { background: #fdf6ec; border-left-color: #d99a2b; }
  .encart--danger { background: #fbf0ef; border-left-color: #b8342a; }
  .encart b { display: block; margin-bottom: 1mm; }

  .legende { font-size: 8.6pt; color: #5b7590; text-align: center; margin-top: 1.5mm; }

  table { width: 100%; border-collapse: collapse; font-size: 9.6pt; margin: 3mm 0; }
  th { text-align: left; font-size: 8.4pt; letter-spacing: .07em; text-transform: uppercase;
       color: #5b7590; border-bottom: 1.5px solid #d3e0ec; padding: 2mm 2mm 1.5mm; }
  td { padding: 2mm; border-bottom: 1px solid #e6eef5; vertical-align: top; }

  .etiq { display: inline-block; padding: 1px 7px; border-radius: 5px;
          font-size: 8pt; font-weight: 700; letter-spacing: .05em; }
  .etiq--off { background: #e2f2f8; color: #0b6d8c; }
  .etiq--kdl { background: #fbf0dc; color: #8a5100; }
  .etiq--mod { background: #eef3f7; color: #4a6480; }

  .fin {
    page-break-before: always; text-align: center;
    background: linear-gradient(155deg, #1f5278, #061a2a); color: #eaf4fa;
    margin: -16mm -14mm 0; padding: 45mm 20mm; height: 265mm;
    display: flex; flex-direction: column; justify-content: center;
  }
  .fin .url {
    font-size: 26pt; font-weight: 800; color: #fff; margin: 6mm 0 3mm;
    letter-spacing: -0.02em; word-break: break-all;
  }
  .fin .gages { font-size: 12pt; color: #8fd6f2; font-weight: 600; margin-bottom: 12mm; }
  .fin .contact { font-size: 11pt; line-height: 1.9; color: rgba(234,244,250,.85); }
  .fin .contact b { color: #fff; }
  .fin .avert { margin-top: 14mm; font-size: 9.4pt; color: rgba(234,244,250,.65);
                max-width: 120mm; margin-left: auto; margin-right: auto; }
</style></head>
<body>

<div class="garde">
  ${logo(64)}
  <span class="badge-beta" style="align-self:flex-start;margin-top:8mm">BÊTA PUBLIQUE · KDL LAB</span>
  <h1>KDL Cyclone</h1>
  <div class="sous">Veille tropicale pour la Guadeloupe<br>et les Petites Antilles</div>
  <div class="signature">« Comprendre tôt. Se préparer calmement. »</div>
  <div class="pied">
    <strong>Mode d'emploi</strong> · version ${version} · ${dateFr}<br>
    Un service gratuit conçu en Guadeloupe par KDLTech
  </div>
</div>

<section>
  <h2><span class="num">1</span>À quoi sert cette application</h2>
  <p>Chaque saison, une onde tropicale quitte l'Afrique et les questions reviennent :
  est-ce que ça va se renforcer ? est-ce que ça vient sur nous ? L'information officielle
  existe, mais elle est en anglais, technique, et éparpillée entre plusieurs sites.</p>
  <p><strong>KDL Cyclone rassemble ces sources et les explique en français.</strong>
  Pour chaque système suivi, vous voyez sa distance à la Guadeloupe, la probabilité
  officielle du National Hurricane Center, et surtout <em>pourquoi</em> : la mer est-elle
  assez chaude, les vents vont-ils casser les orages, l'air saharien est-il en train
  d'assécher le système.</p>
  <div class="encart encart--danger">
    <b>Ce que l'application ne fait pas</b>
    Elle ne déclenche aucune alerte et ne remplace ni Météo-France, ni la préfecture,
    ni la sécurité civile. En cas d'alerte, suivez exclusivement les consignes officielles.
    KDLTech n'est pas un organisme météorologique.
  </div>
</section>

<section>
  <h2><span class="num">2</span>L'écran d'accueil</h2>
  <div class="duo">
    <div class="texte">
      <p>Tout part d'une phrase claire, en haut : la situation générale pour la Guadeloupe.
      Quand rien ne menace, l'application le dit simplement.</p>
      <h3>Le cadran de relèvement</h3>
      <p>C'est le repère principal. La Guadeloupe est au centre. Chaque point est un système,
      placé à sa <strong>direction réelle</strong> et à sa <strong>distance réelle</strong>.
      Les cercles marquent 500, 1 000, 2 000 et 4 000 km. La taille du point indique le
      potentiel de développement.</p>
      <h3>La liste des systèmes</h3>
      <p>Sous le cadran, chaque système affiche son potentiel sur 100, sa distance et la
      probabilité officielle du NHC. Touchez une carte pour ouvrir sa fiche complète.</p>
    </div>
    <div class="visuel">
      ${image('01-mobile-accueil-clair.png')}
      <div class="legende">Écran d'accueil sur téléphone</div>
    </div>
  </div>
</section>

<section>
  <h2><span class="num">3</span>Lire les étiquettes de provenance</h2>
  <p>C'est le point le plus important pour bien utiliser l'application. Toute information
  affichée porte son origine, et ces origines ne se valent pas.</p>
  <table>
    <tr><th style="width:30mm">Étiquette</th><th>Ce que cela signifie</th></tr>
    <tr><td><span class="etiq etiq--off">Officiel</span></td>
        <td>Publié tel quel par le National Hurricane Center ou Météo-France.
        <strong>Fait foi</strong>, et affiché avant tout le reste.</td></tr>
    <tr><td><span class="etiq etiq--mod">Modèle</span></td>
        <td>Sortie brute d'un modèle météorologique. C'est une prévision, pas une observation.</td></tr>
    <tr><td><span class="etiq etiq--kdl">Analyse KDL</span></td>
        <td>Calcul de l'application. <strong>Expérimental</strong>, non validé par un
        organisme météorologique. Cela explique, cela ne prévoit pas.</td></tr>
    <tr><td><span class="etiq etiq--mod">Non disponible</span></td>
        <td>La donnée manque. Elle n'est jamais remplacée par une estimation déguisée.</td></tr>
  </table>
  <div class="encart">
    <b>Une règle simple</b>
    Si l'analyse KDL et le NHC ne disent pas la même chose, <strong>c'est le NHC qui a
    raison</strong>. L'application vous le rappelle elle-même à l'écran.
  </div>
</section>

<section>
  <h2><span class="num">4</span>La fiche d'un système</h2>
  <div class="duo">
    <div class="visuel">
      ${image('06-mobile-fiche.png')}
      <div class="legende">Fiche détaillée</div>
    </div>
    <div class="texte">
      <p>La fiche donne d'abord la position, la distance et le déplacement, puis les
      probabilités officielles du NHC, et seulement ensuite l'analyse KDL.</p>
      <h3>« Pourquoi ce niveau de potentiel ? »</h3>
      <p>Neuf facteurs sont mesurés et expliqués en une phrase chacun. Touchez un facteur
      pour lire son explication :</p>
      <ul>
        <li>température de la mer ;</li>
        <li>cisaillement des vents en altitude ;</li>
        <li>humidité de l'air ;</li>
        <li>activité orageuse ;</li>
        <li>rotation en basses couches ;</li>
        <li>pression ;</li>
        <li>latitude ;</li>
        <li>air sec ou poussières sahariennes ;</li>
        <li>accord entre les modèles.</li>
      </ul>
      <p>Plus bas, « Ce qui a changé » retrace l'évolution du système, bulletin après
      bulletin, avec l'heure de chaque changement.</p>
    </div>
  </div>
</section>

<section>
  <h2><span class="num">5</span>La carte et la boucle satellite</h2>
  <div class="large">${image('21-carte-satellite-mobile.png', '110mm')}
  <div class="legende">La carte avec les commandes de la boucle satellite</div></div>
  <p>La carte couvre l'Atlantique, de l'Afrique aux Caraïbes. Vous pouvez la déplacer au
  doigt, zoomer, et activer ou masquer les calques avec le bouton <strong>Calques</strong>.</p>
  <h3>Comment lire les tracés</h3>
  <ul>
    <li><strong>Trait plein</strong> : donnée officielle du NHC (zone surveillée, cône, trajectoire).</li>
    <li><strong>Pointillés</strong> : corridor indicatif calculé par KDL, entouré de sa marge
    d'incertitude. <strong>Ce n'est pas un cône officiel.</strong></li>
  </ul>
  <h3>La boucle satellite</h3>
  <p>Touchez <strong>Charger la boucle</strong> : l'application vous annonce d'abord le poids
  (environ 1,8 Mo) avant de télécharger quoi que ce soit. Vous obtenez alors deux heures
  d'images réelles du satellite GOES-19, avec lecture, pause, curseur temporel et vitesses
  0,5× à 2×. L'heure de chaque image est affichée. Dès que vous remontez dans le passé, le
  badge <strong>Direct</strong> disparaît et un bouton vous propose d'y revenir.</p>
  <div class="encart">
    <b>Connexion limitée ?</b>
    L'application le détecte et ne charge qu'une image sur deux. Vous pouvez aussi ne
    jamais activer la boucle : le reste de la carte fonctionne sans elle.
  </div>
</section>

<section>
  <h2><span class="num">6</span>La page Guadeloupe</h2>
  <div class="duo">
    <div class="texte">
      <p>Le résumé local : niveau de risque, vent, rafales, pluie, houle, température de la
      mer, et les rafales maximales attendues sur cinq jours.</p>
      <p>Vous y trouvez aussi les <strong>liens directs vers la vigilance de Météo-France</strong>
      et la préfecture. Ce sont eux qui font autorité en cas d'alerte : l'application les met
      en avant plutôt que de les paraphraser.</p>
      <p>Toutes les heures sont données en heure de Guadeloupe, avec l'heure UTC en complément.</p>
    </div>
    <div class="visuel">
      ${image('07-mobile-guadeloupe.png')}
      <div class="legende">Situation locale</div>
    </div>
  </div>
</section>

<section>
  <h2><span class="num">7</span>Le mode préparation</h2>
  <div class="duo">
    <div class="visuel">
      ${image('08-mobile-preparation.png')}
      <div class="legende">Liste de préparation, 37 points</div>
    </div>
    <div class="texte">
      <p>Trente-sept points répartis en neuf thèmes : eau, alimentation, santé, documents,
      énergie, habitation, autonomie, contacts, et l'après-passage — la phase la plus
      sous-estimée.</p>
      <p>Cochez au fur et à mesure : votre avancement reste <strong>sur votre appareil</strong>,
      rien n'est envoyé nulle part.</p>
      <div class="encart encart--attention">
        <b>Cette liste fonctionne sans connexion</b>
        C'est fait exprès : le jour où il y a vraiment un problème, il n'y a souvent plus
        de réseau. Préparez-la hors saison, pas à l'annonce d'un système.
      </div>
    </div>
  </div>
</section>

<section>
  <h2><span class="num">8</span>Installer l'application</h2>
  <div class="duo">
    <div class="texte">
      <p>L'installation n'est <strong>pas obligatoire</strong> : tout fonctionne dans le
      navigateur. Elle raccourcit simplement le chemin et permet de consulter les dernières
      informations hors connexion.</p>
      <h3>Android</h3>
      <p>Touchez <strong>Installer gratuitement</strong>. Si le bouton n'apparaît pas :
      menu du navigateur (⋮) → « Installer l'application ».</p>
      <h3>iPhone et iPad</h3>
      <p>Safari ne propose pas d'installation automatique. Touchez le bouton Partager (le
      carré avec une flèche), puis « Sur l'écran d'accueil », puis « Ajouter ».</p>
      <h3>Ordinateur</h3>
      <p>Sur Chrome ou Edge, une icône d'installation apparaît dans la barre d'adresse.
      L'application s'ouvre alors dans sa propre fenêtre.</p>
      <p>Elle se désinstalle comme n'importe quelle autre application.</p>
    </div>
    <div class="visuel">
      ${image('19-installer.png')}
      <div class="legende">Page d'installation</div>
    </div>
  </div>
</section>

<section>
  <h2><span class="num">9</span>Sur ordinateur</h2>
  <div class="large large--entier">${image('22-bureau-1920x1080-accueil.png')}
  <div class="legende">L'application sur un écran de bureau</div></div>
  <p>Sur grand écran, la mise en page s'élargit : le cadran et la liste des systèmes se
  placent côte à côte, la carte gagne en hauteur et les facteurs se lisent sur plusieurs
  colonnes. Le contenu est strictement le même que sur téléphone.</p>
</section>

<section>
  <h2><span class="num">10</span>Partager et donner votre avis</h2>
  <p>Chaque fiche dispose d'un bouton <strong>Partager</strong>. Le texte produit contient
  toujours la <strong>date des données</strong> : une information météo sans son heure
  devient fausse en quelques heures.</p>
  <p>La page <strong>Bêta</strong> rassemble les textes prêts à publier, les visuels à
  télécharger, et un formulaire pour signaler un problème ou proposer une amélioration.
  Votre adresse électronique y est facultative.</p>
  <div class="encart">
    <b>Vie privée</b>
    Aucun compte, aucun cookie, aucune publicité, aucun traceur. L'application ne connaît
    pas votre position. Les appels aux sources météo sont faits par le serveur : votre
    navigateur ne contacte jamais un service tiers.
  </div>
</section>

<section>
  <h2><span class="num">11</span>D'où viennent les données</h2>
  <table>
    <tr><th style="width:42mm">Source</th><th>Ce qu'elle fournit</th></tr>
    <tr><td><strong>National Hurricane Center</strong><br><span style="font-size:8.6pt;color:#5b7590">NOAA — domaine public</span></td>
        <td>Bulletins officiels, zones surveillées, probabilités de formation, cônes de prévision.</td></tr>
    <tr><td><strong>GOES-19</strong><br><span style="font-size:8.6pt;color:#5b7590">NOAA / NESDIS — domaine public</span></td>
        <td>Images satellite réelles de la boucle animée, une toutes les dix minutes.</td></tr>
    <tr><td><strong>Open-Meteo</strong><br><span style="font-size:8.6pt;color:#5b7590">Licence CC BY 4.0</span></td>
        <td>Modèles GFS, ECMWF et ICON : vents, humidité, pression, état de la mer.</td></tr>
    <tr><td><strong>Météo-France</strong><br><span style="font-size:8.6pt;color:#5b7590">Lien officiel</span></td>
        <td>Vigilance pour la Guadeloupe. Non intégrée volontairement : l'application renvoie
        vers la source officielle plutôt que d'en afficher une copie.</td></tr>
  </table>
  <p>Chaque donnée affichée indique son heure de publication et son état de fraîcheur :
  <strong>à jour</strong>, <strong>actualisation en attente</strong> ou
  <strong>données anciennes</strong>. Une information ancienne reste consultable, mais elle
  n'est jamais présentée comme actuelle.</p>
</section>

<div class="fin">
  ${logo(56)}
  <div style="margin-top:8mm;font-size:13pt;color:#8fd6f2;font-weight:600">Accès à l'application</div>
  <div class="url">cyclone.kdl-tech.fr</div>
  <div class="gages">Gratuite · Sans publicité · Sans compte</div>
  <div class="contact">
    <b>KDLTech</b> — Les Abymes, Guadeloupe<br>
    Téléphone et WhatsApp : <b>0690 70 60 08</b><br>
    Courriel : <b>karim.delucia@kdl-tech.fr</b><br>
    Site : <b>kdl-tech.fr</b>
  </div>
  <div class="avert">
    KDL Cyclone est une application d'information en bêta publique. Elle ne remplace ni
    Météo-France, ni le National Hurricane Center, ni la préfecture, ni la sécurité civile.
    En cas d'alerte, suivez exclusivement les consignes officielles.
  </div>
</div>

</body></html>`;

fs.mkdirSync(CAPTURES, { recursive: true });
fs.writeFileSync(HTML, html, 'utf8');

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kdl-pdf-'));
const r = spawnSync('google-chrome', [
  '--headless=new', `--user-data-dir=${profil}`, '--no-first-run', '--disable-gpu',
  '--no-pdf-header-footer', '--print-to-pdf-no-header',
  `--print-to-pdf=${SORTIE_PDF}`, `file://${HTML}`,
], { encoding: 'utf8', timeout: 120000 });

try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5 }); } catch { /* ignoré */ }

if (!fs.existsSync(SORTIE_PDF)) {
  console.error('Échec de génération.', r.stderr?.slice(0, 400));
  process.exit(1);
}
const ko = Math.round(fs.statSync(SORTIE_PDF).size / 1024);
console.log(`Tutoriel écrit : ${SORTIE_PDF} (${ko} Ko)`);
