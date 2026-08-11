# Historique des versions

Les dates sont celles du déploiement en production. La version installée est
lisible sur [`/version.json`](https://cyclone.kdl-tech.fr/version.json) et dans
la page À propos de l'application.

## 0.11.0 — 10 août 2026

- **Météo par commune** : 88 communes et zones proposées, du Moule à
  Grand-Bourg, de Fort-de-France au Prêcheur, plus les principales villes des
  sept autres territoires. Les coordonnées viennent du géocodage Open-Meteo
  (données GeoNames) et sont figées dans le dépôt — écrire une latitude à la
  main finit par afficher un bulletin correspondant à un point en mer.
  L'application n'interroge aucun service de géocodage à l'exécution.
  Le bulletin d'une commune est gardé dix minutes en mémoire : le quota
  Open-Meteo continue de ne pas dépendre du trafic.
- **Pictogrammes en couleur** : chaque dessin est composé de couches nommées —
  soleil, lune, nuage, gouttes, éclair — portant la couleur de ce qu'elles
  représentent.

## 0.10.0 — 10 août 2026

**Le bouton de mise à jour restait sans effet.** Cause établie en s'attachant au
service worker : un service worker *en attente* est arrêté par le navigateur et
n'entend pas le message qu'on lui envoie ; le worker actif, lui, le reçoit. Le
clic partait dans le vide, sans erreur.

- Séquence de mise à jour complète : écoute de `controllerchange` avant tout
  envoi, `SKIP_WAITING`, suivi du worker en installation, et désinscription en
  dernier recours. Six états visibles, du « Recherche d'une mise à jour… » au
  « déjà à jour — version X ». Verrou de session contre les boucles.
- Document servi réseau d'abord : un `index.html` en cache figeait toute
  l'application, y compris son propre bouton de mise à jour.
- Nom de cache portant version **et** identifiant de build ; nettoyage limité
  aux caches préfixés `kdl-cyclone-`.
- `/version.json` sans cache : version, build, date de déploiement, version
  minimale compatible.
- **Facebook, Messenger, Instagram, TikTok, LinkedIn, WebView** : ces navigateurs
  intégrés n'installent pas d'application web. Une passerelle propose désormais
  « Ouvrir dans Chrome », « Copier le lien » et une marche à suivre — plutôt
  qu'un bouton d'installation qui ne pouvait pas fonctionner.

## 0.9.2 — 10 août 2026

- Fiche système en panneau latéral à partir de 1200 px : la trajectoire reste
  visible pendant la lecture du détail.
- Libellés de la carte : recherche d'une place libre et trait de rattachement.
  Le repère du territoire réserve sa place en premier.

## 0.9.0 — 10 août 2026

**Identité visuelle propre**, distincte de la charte KDLTech, qui ne sert plus
que de signature.

- Système de couleurs porteuses de sens : bleu profond pour l'océan et
  l'officiel, cyan pour le satellite, vert-jaune-orange-rouge pour le risque,
  violet pour l'analyse expérimentale, une teinte par grandeur physique.
- Graphique horaire en SVG écrit à la main : courbe de température, barres de
  pluie, bandes de nuit.
- Carte à l'océan en trois bleus, commandes tactiles, plein écran.
- Responsive vérifié sur huit formats de 320 à 1920 px, dans les deux thèmes :
  450 contrôles automatisés.

## 0.8.3 — 10 août 2026

Inter réellement servie, sous-ensemblée au français : 56 Ko pour trois graisses
au lieu de 1,8 Mo. La feuille de style la déclarait depuis le premier jour sans
qu'aucun fichier ne soit servi.

## 0.8.1 — 10 août 2026

- Sélecteur de territoire affiché dès la première image, sans attendre les
  données, et lisible en thème sombre — les options du menu natif héritaient
  d'un texte clair sur fond transparent.
- Mode clair par défaut, y compris sur un appareil réglé en sombre.
- Territoire partageable par URL et propagé à toutes les vues.
- Âge du bulletin officiel et âge de la collecte enfin distingués.

## 0.8.0 — 10 août 2026

Refonte de la direction artistique : base neutre, échelle de menace en quatre
crans, couleurs sémantiques. Correction d'un défaut invisible : la politique de
sécurité rendait inertes les attributs `style`, ce qui aplatissait la mise en
page.

## 0.7.0 — 10 août 2026

Le service worker figeait les visiteurs sur une ancienne version : son nom de
cache était constant. Il porte désormais la version de l'application.

## 0.6.0 — 9 août 2026

Boucle satellite GOES-19 réelle, mise à jour sans rechargement (SSE), adaptation
aux grands écrans.

## 0.5.0 — 9 août 2026

Neuf territoires de l'arc antillais, chacun avec **ses** autorités. Un test
interdit tout lien français pour la Dominique, Sainte-Lucie, la Barbade,
Antigua-et-Barbuda et Trinité-et-Tobago.

Onglet météo complet : conditions du moment, prévisions horaires et sur dix
jours, état de la mer, qualité de l'air, UV, brume de sable.

## 0.4.0 — 9 août 2026

Traçabilité des sources par empreinte, journal des changements, trois états de
fraîcheur, surveillance technique. Cartes sociales par système, adresses
durables, page bêta, formulaire de retour.

## 0.1.0 — 9 août 2026

Première version : collecte NHC, analyse du potentiel sur neuf facteurs, carte
de l'Atlantique tropical, cadran de relèvement, mode préparation, application
installable et utilisable hors connexion.
