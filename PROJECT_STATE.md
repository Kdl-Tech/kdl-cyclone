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
