# Historique des versions

Les dates sont celles du déploiement en production. La version installée est
lisible sur [`/version.json`](https://cyclone.kdl-tech.fr/version.json) et dans
la page À propos de l'application.

## 0.14.0 — 14 août 2026

**Les rafales prévues, la grandeur qu'aucune station antillaise ne mesure.**
Sur les quarante-six stations de Guadeloupe, aucune ne relève les rafales —
c'est pourtant ce qui décide d'une mise à l'abri. Le modèle ARPEGE les prévoit,
et Météo-France en fournit directement la carte : la page du territoire affiche
désormais l'arc antillais avec quatre échéances, maintenant, +6 h, +12 h et
+24 h.

L'heure annoncée est l'heure ronde réellement servie par le modèle, et non
l'heure courante : sous une image valable pour 13 h 00, afficher « 13 h 21 »
serait une erreur. L'encart porte l'étiquette « Modèle » et dit explicitement
que ces rafales sont prévues, non mesurées.

- **Des repères sur la carte** : l'image du modèle ne porte ni côte ni nom. Les
  territoires suivis sont dessinés par-dessus, la Guadeloupe en bleu KDL. Des
  aplats de couleur sans repère n'apprennent rien à personne.
- L'encart disparaît de lui-même si la source ne répond pas : une couche de
  confort ne doit pas ressembler à une panne.

## 0.13.1 — 14 août 2026

**La limitation du formulaire de retour protégeait tout le monde d'un seul
visiteur.** Chaque envoi était rattaché à l'adresse vue par l'application ;
derrière le serveur web, cette adresse est la même pour tous. La limite de trois
retours par heure s'appliquait donc au public entier : passé trois envois, plus
personne ne pouvait écrire. Sur la voie de retour d'une bêta publique, le défaut
méritait d'être corrigé vite.

- La page des retours ne relit plus l'intégralité du fichier à chaque
  consultation, et la réponse compressée n'est plus recalculée pour chaque
  visiteur alors que les données ne changent que toutes les cinq minutes.
- Une trajectoire réduite à un seul point faisait disparaître **silencieusement**
  toutes les îles de la liste des territoires concernés. Le calcul rend
  désormais la même forme de résultat quelle que soit la trajectoire.
- Les flux de mise à jour laissaient un minuteur tourner sur une connexion
  fermée, et retardaient chaque redémarrage du service.
- L'application ne réclame plus l'autorisation de géolocalisation, qu'elle
  n'utilise nulle part.

## 0.13.0 — 14 août 2026

**La vigilance officielle de Météo-France s'affiche enfin dans l'application.**
Jusqu'ici, KDL Cyclone renvoyait vers la page officielle sans pouvoir en
relayer le contenu. Sur un territoire français, c'est elle qui fait autorité,
et c'est elle qui bouge en premier : le National Hurricane Center publie
quatre fois par jour, Météo-France dès qu'une vigilance change.

La vigilance apparaît en tête de la page du territoire, avant l'estimation
KDL, avec son niveau écrit en toutes lettres, les phénomènes concernés,
l'heure d'émission du bulletin et le lien vers l'autorité. Elle est relayée
telle quelle, jamais reformulée. Les sept territoires français sont couverts,
Saint-Martin et Saint-Barthélemy compris ; les six territoires étrangers n'en
reçoivent aucune, puisque Météo-France ne les couvre pas.

- **Mesures réelles des stations** : la page du territoire distingue désormais
  ce qui est *mesuré* de ce qui est *calculé*. Pression, vent, pluie,
  température et humidité relevés par les stations de Guadeloupe et de
  Martinique s'affichent sous un tampon « Mesuré », au-dessus des sorties de
  modèle. S'y ajoutent les extrêmes du territoire — pression la plus basse,
  vent le plus fort, pluie la plus forte — car en veille, c'est le point le
  plus exposé qui compte, pas la moyenne.
- **Une absence de mesure reste une absence.** Le réseau antillais ne mesure
  pas les rafales : l'application l'écrit, au lieu d'afficher « 0 km/h ». Sur
  une application de veille cyclonique, une mesure absente présentée comme
  nulle est un contresens dangereux.
- **Provenance des données rappelée partout** : une ligne en pied de page
  nomme les cinq sources et donne l'état de chacune à la dernière collecte, et
  chaque bloc de données porte la sienne. GOES-19 et Natural Earth étaient
  utilisés sans figurer nulle part — une provenance incomplète est une
  provenance fausse.
- **Le radar n'est pas intégré**, et c'est un choix. Le produit Antilles existe
  bien, actualisé toutes les cinq minutes, mais il est diffusé en BUFR avec des
  tables propres au centre de Toulouse. Un décodeur écrit sans ces tables
  rendrait des valeurs fausses sans lever la moindre erreur. Le détail est dans
  `docs/SOURCES.md`.
- Correctifs de la 0.12.1, jamais publiés ici : trajectoire officielle des
  systèmes nommés effectivement chargée, fraîcheur du bulletin conservée après
  un redémarrage, cadence de collecte portée à cinq minutes.

Côté technique, le jeton d'accès reste strictement côté serveur : lu depuis un
fichier ignoré par Git, jamais journalisé, jamais transmis au navigateur. Les
refus d'authentification ne sont jamais réessayés, un dépassement de quota
respecte le délai demandé par Météo-France, et la dernière valeur connue
survit à une panne — six heures au plus pour une vigilance, au-delà de quoi
elle cesse d'être affichée plutôt que d'induire en erreur.

## 0.12.0 — 10 août 2026

**Les appareils restés sur une ancienne version ne pouvaient plus en sortir.**
Le service worker attendait l'accord de la page avant de se remplacer — une
précaution qui se retournait contre son but : la page qui devait donner cet
accord venait elle-même du cache périmé, donc son bouton de mise à jour était
celui d'avant le correctif. Le remplacement dépendait du code qu'il fallait
justement remplacer. Une version neuve prend désormais la main dès son
installation : pour une application de veille cyclonique, la fraîcheur passe
avant le confort.

- **Recherche de commune** : le choix du lieu n'est plus un second menu
  déroulant sous celui du territoire — deux bandeaux jumeaux qu'on ne
  distinguait pas. C'est maintenant l'action principale de la page météo, avec
  le nom du lieu en clair et un panneau de recherche : « francois » trouve
  Saint-François, « ste anne » trouve Sainte-Anne, accents et tirets sont
  ignorés. Navigation au clavier, fermeture par Échap.
- **Un lien partagé retrouve enfin sa commune.** L'adresse était réécrite à
  chaque changement de page en ne gardant que le territoire, et le paramètre
  `lieu` disparaissait avant même d'avoir pu être lu — la liste des communes
  arrive par le réseau, donc au premier rendu rien ne permettait de le valider.

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
