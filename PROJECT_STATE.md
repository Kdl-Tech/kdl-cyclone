# KDL Cyclone — point de reprise

## Autorisation et périmètre
- Karim a validé le plan de refonte le 12 septembre 2026 : progression fichier par fichier.
- Priorité ajoutée : météo et cyclones en quasi-direct, sans inventer une fréquence de publication des producteurs.
- Outils nécessaires autorisés sur le MSI ; privilégier ceux déjà installés. Économiser les tokens.
- Aucun push, déploiement ou changement des clés API autorisé dans ce lot.

## Où reprendre
- Machine de travail : MSI, skyme@192.168.50.6.
- Worktree : /home/skyme/Bureau/RANGEMENT_BUREAU/01_KDL_TECH/Projets/kdl-cyclone-refonte
- Branche : refonte/cyclone ; base GitHub/MSI : 6b44512.
- Dépôt original : ../kdl-cyclone-public (main, non modifié).
- Sauvegarde vérifiée SHA-256 : /home/skyme/Sauvegarde/cyclone-refonte-20260912-201546.
- Modifications non commitées, disponibles pour revue.

## Premier lot implémenté : vigilances
1. src/sources/meteofrance.js : violet reconnu ; gris conservé comme phase post-cyclone, sans rang 6 ; niveaux inconnus conservés, état incomplet explicite. Une alerte rouge peut coexister avec un cyclone gris ; les deux restent visibles.
2. public/js/app.js : bandeau violet/gris explicite, indisponibilité visible pour les territoires français, avertissement sur données incomplètes, ancien bulletin vert présenté au passé.
3. public/css/app.css : couleurs violet et gris, contrastes dédiés dans les deux thèmes.
4. test/vigilance.test.js et test/vigilance-client.test.js : 28 nouveaux tests ; échecs observés avant correction.

## Validation réalisée
- 189 tests passent (161 existants + 28 nouveaux).
- node --check public/js/app.js et git diff --check passent.
- Chrome MSI : 360, 390 et 1280 px, clair/sombre, cinq scénarios simulés ; six contrôles sans débordement horizontal, couleurs vérifiées.
- Contrôle visuel d'une capture mobile effectué. Il s'agit des bandeaux isolés, pas d'une recette complète de l'application.
- Script de reproduction : /tmp/cyclone-vigilance-qa.mjs sur le MSI.
- Captures : /tmp/cyclone-vigilance-clair.png et /tmp/cyclone-vigilance-sombre.png sur le MSI.
- Aucune API authentifiée appelée pendant ces tests ; aucun secret lu, copié ou modifié.
- La production publique reste inchangée.

## Prochaine étape prioritaire : collecte fiable et quasi-direct
Objectif à implémenter et mesurer : rechercher les nouveaux bulletins officiels environ toutes les 60 secondes, puis transmettre leur arrivée par SSE. Respecter les quotas et Retry-After. Indiquer séparément émission du bulletin, dernière vérification et données périmées.

Ne PAS simplement abaisser collectIntervalMs :
- server.js:tourDeCollecte protège les collectes par un verrou, mais toutes les tâches lourdes précèdent actuellement la publication.
- src/collector.js attend modèles par système, météo de neuf territoires, observations, cartes sociales et satellite avant de publier.
- CONFIG.environmentIntervalMs (1 h) est inutilisé ; ajouter caches bornés et déduplication des requêtes en cours, puis dissocier les enrichissements de la diffusion officielle.
- MF garde actuellement la vigilance 5 min : adapter ce cache avec revalidation conditionnelle.
- Le retour 304 MF ne renouvelle pas la date de vérification du cache ; corriger sans modifier l'heure d'émission.
- Sur panne MF, perime est porté par la racine mais perdu dans parTerritoire. Les archives illisibles et formats non reconnus doivent aussi conserver la dernière donnée valide.
- L'heure d'émission MF est actuellement partagée entre territoires : la conserver par territoire.
- Sur panne NHC, reutiliser() renvoie [] si le document n'est pas marqué inchangé : conserver les systèmes connus et signaler leur ancienneté. Une liste vide confirmée reste une véritable disparition.
- L'historique est limité à 96 points : augmenter la fréquence sans échantillonnage casserait les tendances 6/12/24 h.
- Le client ferme définitivement EventSource après six erreurs et se rabat sur 10 min : prévoir reconnexion et revalidation au retour en ligne/onglet visible.
- Ne pas confondre mesure de station, prévision horaire et date de collecte ; les producteurs n'émettent pas tout en continu.

## Lot quasi-direct implémenté le 13 septembre 2026
- Veille légère toutes les 60 secondes sur les seuls bulletins officiels Météo-France/NHC.
- Requêtes HTTP conditionnelles : une collecte complète ne part que lorsqu'un document a réellement changé.
- Les réponses NHC absentes ou en erreur conservent les derniers systèmes connus ; une liste vide confirmée reste une vraie disparition.
- Les nouveaux documents détectés sont réutilisés par la collecte complète, sans second téléchargement.
- Cache vigilance ramené à 55 secondes ; les retours 304 renouvellent l'heure de vérification sans modifier l'heure d'émission.
- Chaque territoire conserve sa propre heure d'émission. Une panne, une archive illisible ou un format inconnu conserve la dernière vigilance avec un marquage périmé jusque dans l'interface.
- Le navigateur recrée le flux SSE après plusieurs coupures sous 30 secondes, recharge au retour réseau et garde un contrôle périodique toutes les deux minutes.
- Test réel NHC : premier passage modifié, second passage entièrement inchangé/304, sans nouvelle collecte lourde.
- Serveur temporaire validé sur le port 4255 : API état HTTP 200 et flux SSE opérationnel. Production inchangée.
- 199 tests passent, contrôles syntaxiques et `git diff --check` passent.
- Aucun `.env` Cyclone présent dans les deux dépôts du MSI ; Météo-France reste donc désactivée dans ce test local. Aucun secret n'a été lu ou modifié.
- Fichiers concernés : `src/direct.js`, `src/config.js`, `src/sources/meteofrance.js`, `src/sources/nhc.js`, `src/collector.js`, `server.js`, `public/js/app.js` et les tests `direct*`/`vigilance*`.

## Prochaine étape active
- Précision des mesures : empêcher les valeurs NHC absentes de devenir zéro, puis corriger le décalage de quatre heures dans `fetchConditionsLocales` Open-Meteo. Procéder test par test et fichier par fichier.

## Suite du plan validé
- Précision : NHC null/chaîne vide deviennent zéro dans coneDepuisCouches ; Open-Meteo fetchConditionsLocales interprète des heures locales comme UTC (+4 h aux Antilles). Ajouter tests puis corriger.
- Cartographie : parties/anneaux perdus, parties de trajectoires concaténées, centres Guadeloupe codés en dur ; préserver géométries et échéances.
- Spaghetti : source de trajectoires de modèles à ajouter (ATCF a-deck selon disponibilité). L'accord actuel entre pressions locales de modèles n'est pas un spaghetti.
- Carte différée : migration progressive Leaflet auto-hébergé ; conserver serveur Node et frontend léger.
- UI mobile : vigilance, position, vents, pression et bulletin en tête ; thème système automatique ; découpage app.js.
- Performance/PWA : chargement à la demande, service worker actuellement trop gourmand, délais réseau, bornes de cache, tests connexion lente/hors ligne et mesures réelles.

## Sources de référence déjà consultées
- https://meteofrance.com/vigilance-et-securite/la-vigilance-meteorologique-en-outre-mer
- https://www.nhc.noaa.gov/gis/
- https://www.nhc.noaa.gov/modelsummary.shtml
- https://leafletjs.com/reference.html


## Checkpoint — 13 septembre 2026, après déploiement 0.19.0

- Production déployée : `https://cyclone.kdl-tech.fr`, version `0.19.0`.
- Commit local MSI : `f11d923` sur `refonte/cyclone`.
- Tests : 203/203 réussis avant déploiement.
- Sauvegarde VPS : `/home/debian/backups/kdl-cyclone-pre-0.19.0.tgz`.
- SHA-256 sauvegarde : `c0bd28d9c185fe9b5b0f4f8de7b1ca6ac9c2dd3d08f201ebb62e0039676ebf33`.
- Retour Karim : nouveau visuel validé, mais les **sargasses ne sont pas visibles**.

### Première tâche à la reprise

1. Reproduire sur la production et tester `/api/sargasses`.
2. Vérifier que « Sargasses » apparaît clairement dans le panneau Calques.
3. Corriger le chargement/dessin ou rendre la commande directement visible.
4. Tester mobile 390 px, carte Atlantique, date/source NOAA et absence de chevauchement.
5. Relancer les tests, sauvegarder, déployer un correctif `0.19.1`, puis vérifier publiquement.

Ne pas toucher au nouveau visuel validé ni revenir à l’ancienne version.

## Checkpoint — 13 septembre 2026, version 0.19.1 prête localement

- Production inchangée en `0.19.0` : aucun déploiement sans feu vert explicite.
- Correctifs prêts sur `refonte/cyclone`, jusqu’au commit `df1fc97`.
- Météo-France reste la source principale dès qu’une observation officielle fraîche existe ; Open-Meteo est affiché uniquement comme secours explicite.
- Les sargasses NOAA sont chargées au premier affichage et représentées en bandes vert foncé datées.
- La couche NOAA GOES-19 « brumes de sable » s’active réellement au premier clic, avec une palette sable/ocre et sans cartouche technique dans la carte.
- Le chevauchement du premier écran est supprimé et contrôlé de 360 à 1 440 px, ainsi qu’au zoom 200 %.
- Validation locale 0.19.1 : 213/213 tests, QA navigateur sans défaut, PWA 23/23, hors-ligne sans défaut, carte animée 23/23 à 50 i/s, grand écran 7/7.
- Le secret Météo-France n’a été ni lu ni copié. L’état public 0.19.0 confirmait que la collecte Météo-France en production est opérationnelle.

### Prochaine action

Après feu vert de Karim : sauvegarde VPS vérifiée par SHA-256, déploiement 0.19.1, contrôle public des sources Météo-France/Open-Meteo, des deux calques environnementaux, de la version et du cache PWA, puis rollback immédiat au moindre défaut critique.

## Checkpoint — 13 septembre 2026, 0.19.1 DÉPLOYÉE ET CONTRÔLÉE EN PRODUCTION

- Production : `https://cyclone.kdl-tech.fr` en **0.19.1** (PM2 `kdl-cyclone` en ligne).
- Commit de référence : `f320cce` sur `refonte/cyclone`, dépôt local propre et
  synchronisé avec `origin` (0 en avance, 0 en retard).
- `public/js/app.js` identique bit à bit entre le MSI et le VPS (SHA-256
  `cb6515b65a042d6a89ce082fc8b2d8a927a6a2976a8e86727f70edf2528c056e`).
- Sauvegarde avant déploiement : `/home/debian/backups/kdl-cyclone-pre-0.19.1-20260913T202932Z.tgz`
  — SHA-256 `a18fb0400f283173ad46e2cf10cf63bcace42a1d6b7f173c43dc4d4d8240cb1d`.

### Contrôles publics effectués sur la production 0.19.1

- Tests unitaires : **215/215** réussis.
- QA navigateur (`KDL_QA_BASE=https://cyclone.kdl-tech.fr npm run qa`) : **aucun défaut**.
- PWA : **23/23**, aucun cache périmé, tous préfixés `kdl-cyclone-0.19.1`.
- Grand écran : **7/7** de 1366 à 2560 px, accueil en colonnes, sans chevauchement.
- Carte animée : **23/23**, 50 images/s, 2,1 Mo de mémoire JS, aucune dérive.
- Endpoints : `/`, `/api/version`, `/api/etat`, `/api/sargasses`,
  `/manifest.webmanifest`, `/sw.js` répondent tous en 200.
- **Sargasses visibles dès l ouverture de la carte** : bandes vert foncé sur les
  Caraïbes et le golfe, case cochée, mention « NOAA SIR · 2026-09-12 » dans les
  calques et message « Sargasses NOAA du 2026-09-12 affichées ». Le défaut
  signalé par Karim sur la 0.19.0 est corrigé.
- Brumes de sable : couche présente, chargée à la demande, source NOAA GOES-19.
- Hiérarchie des sources conforme : Météo-France reste la référence de vigilance
  (bulletin daté affiché) ; Open-Meteo apparaît en secours explicite pour les
  conditions et la mer quand aucune observation officielle fraîche n existe.
- Écosystème KDL : `kdl-sync-apps.mjs` en mode lecture répond « toutes les
  surfaces sont cohérentes » ; la carte Cyclone est bien présente dans le
  KDL Pro Launcher.

### État de la mission

Chantier 0.19.1 **terminé**. Rien ne reste en attente sur cette version.
Les évolutions suivantes restent celles listées plus haut dans « Suite du plan
validé » (précision NHC/Open-Meteo, cartographie, spaghetti, Leaflet
auto-hébergé, découpage de `app.js`, performance/PWA).
