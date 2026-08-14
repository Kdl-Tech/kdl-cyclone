# Sources de données — vérifications et conditions

Chaque source a été vérifiée avant intégration : disponibilité réelle, licence,
obligation d'attribution, limites d'usage, coût.

Vérification effectuée le **9 août 2026**.

---

## 0. Géocodage Open-Meteo — utilisé hors ligne uniquement

| | |
|---|---|
| Service | https://geocoding-api.open-meteo.com/ |
| Données | GeoNames, CC BY 4.0 |
| Clé d'accès | Aucune |
| Coût | 0 € |
| Usage | **À la fabrication seulement** : `scripts/build-communes.mjs` |

Les 88 communes et zones proposées dans l'onglet météo ont leurs coordonnées
issues de ce service, figées dans `src/communes.js`. **L'application ne
l'interroge jamais à l'exécution** : la liste est statique, et aucun nom saisi
par un visiteur n'est envoyé où que ce soit.

Ce choix est délibéré : écrire des latitudes à la main aurait fini par produire
un bulletin correspondant à un point situé en mer, ou dans l'île voisine.

Relancer `node scripts/build-communes.mjs` uniquement si la liste des
territoires change.

---

## 1. National Hurricane Center (NOAA / NWS)

| | |
|---|---|
| Site | https://www.nhc.noaa.gov/ |
| Licence | Domaine public (œuvre du gouvernement fédéral des États-Unis) |
| Clé d'accès | Aucune |
| Carte bancaire | Non |
| Quota | Aucun quota publié |
| Coût | 0 € |
| Attribution | Non exigée juridiquement, mais affichée par correction |

### Points d'accès utilisés

| Ressource | URL | État vérifié |
|---|---|---|
| Systèmes actifs | `/CurrentStorms.json` | 200 |
| Tropical Weather Outlook (texte) | `/xml/TWOAT.xml` | 200 |
| Zones, points et lignes du TWO | `/xgtwo/gtwo_shapefiles.zip` | 200 |
| Cône et trajectoire d'un système nommé | URL fournie par `CurrentStorms.json` | dépend du système |

Les archives GIS sont des shapefiles ESRI. KDL Cyclone les lit avec un
décompresseur ZIP et un lecteur de shapefile écrits pour le projet
(`src/util/zip.js`, `src/util/shapefile.js`), afin d'éviter toute dépendance.

Attributs exploités des zones : `AREA`, `PROB2DAY`, `RISK2DAY`, `PROB7DAY`,
`RISK7DAY`, `BASIN`.

### Règle d'usage

Le NHC est la référence. Sa probabilité est affichée **avant** l'analyse KDL, et
en cas d'écart notable, l'interface rappelle que la valeur officielle fait foi.
Le cône affiché est toujours celui du NHC — jamais un cône reconstruit.

---

## 2. Open-Meteo

| | |
|---|---|
| Site | https://open-meteo.com/ |
| Licence des données | **CC BY 4.0** — attribution obligatoire |
| Clé d'accès | Aucune pour l'offre gratuite |
| Carte bancaire | Non |
| Quota | 600 appels/min, 5 000/h, **10 000/jour** |
| Usage | Non commercial pour l'offre gratuite |
| Coût | 0 € |

### Conformité

- **Attribution** : affichée dans la page « Sources » et dans les métadonnées de
  l'application (« Données météorologiques Open-Meteo — licence CC BY 4.0 »).
- **Non commercial** : KDL Cyclone est gratuit, sans publicité, sans compte et
  sans revente de données. La condition est respectée.
- **Quota** : seul le serveur interroge Open-Meteo ; les navigateurs des
  utilisateurs n'appellent que KDL Cyclone. Consommation réelle : environ
  3 requêtes par système et par collecte, plus 2 pour la Guadeloupe, toutes les
  10 minutes. Avec 5 systèmes suivis en permanence, cela donne environ
  **2 500 requêtes par jour**, soit un quart du plafond. La consommation ne
  dépend **pas** du nombre d'utilisateurs.

### Points d'accès utilisés

| Usage | API | Variables |
|---|---|---|
| Environnement d'un système | `api.open-meteo.com/v1/forecast` | vents 850/700/500/200 hPa, humidité relative 850/700/500 hPa, pression, précipitations |
| Mer | `marine-api.open-meteo.com/v1/marine` | température de surface, hauteur, période et direction de houle |
| Accord des modèles | `api.open-meteo.com/v1/forecast` | `pressure_msl` sur GFS, ECMWF IFS et ICON |
| Conditions en Guadeloupe | `api.open-meteo.com/v1/forecast` | vent, rafales, précipitations, pression |

La requête d'environnement utilise le mode multi-coordonnées : les cinq points
nécessaires au calcul de la rotation sont obtenus en **un seul appel**.

---

## 3. Météo-France — observations intégrées, vigilance en attente

Vérifié le **14 août 2026** contre l'API réelle, avec un jeton du portail.

| | |
|---|---|
| Portail | https://portail-api.meteofrance.fr/web/fr/ |
| Authentification | en-tête `apikey`, jeton dans `METEOFRANCE_API_TOKEN` |
| Licence | **Licence Ouverte 2.0 (Etalab)** — attribution « Source : Météo-France » |
| Coût | 0 € |

### 3.1 Observations — **intégrées**

| | |
|---|---|
| API | `DonneesPubliquesPaquetObservation` — `/public/DPPaquetObs/v1` |
| Point d'accès | `/paquet/horaire?id-departement=<971\|972>&format=csv` |
| Quota | 50 requêtes/minute |
| Cadence | horaire — l'application appelle une fois par heure et par département |

Le format **CSV est retenu** : 709 Ko contre 2 192 Ko en JSON pour des données
identiques. Le paquet contient cinq jours d'historique ; seule la mesure la
plus récente de chaque station est conservée.

Couverture réelle mesurée en Guadeloupe (46 stations) :

| Grandeur | Stations qui la mesurent |
|---|---|
| Pluie sur une heure | 46 / 46 |
| Température | 42 / 46 |
| Humidité | 17 / 46 |
| Vent moyen et direction | 16 / 46 |
| Pression | 6 / 46 |
| **Rafales** | **0 / 46 — jamais mesurées par ce réseau** |

L'absence de rafale est affichée comme une absence, jamais comme un zéro : sur
une application de veille cyclonique, « rafale 0 km/h » serait un contresens
dangereux.

**Saint-Martin et Saint-Barthélemy ne sont pas couverts** : leurs codes ne
figurent pas dans la liste des départements acceptés par l'API.

### 3.2 Vigilance — **intégrée**

| | |
|---|---|
| API | `DonneesPubliquesVigilance` — `/public/DPVigilance/v1` |
| Point d'accès | `/vigilanceom/flux/dernier` — archive ZIP, ~1,4 Mo |
| Quota | 60 requêtes/minute |
| Cadence | l'archive est réactualisée en continu ; l'application la relit toutes les 5 minutes |

Fait vérifié, contraire à une partie de la documentation publique : **il
n'existe aucun point d'accès JSON par département pour les Antilles**. Seules
la Polynésie et la Nouvelle-Calédonie ont le leur. Les départements d'outre-mer
passent par cette archive unique, lue avec le lecteur ZIP maison.

Contenu réel de l'archive (16 entrées) : des bulletins PDF, des textes, et des
fichiers **`CDPV85_*.txt` qui contiennent en réalité du JSON**. L'extension ne
dit rien du contenu — l'analyseur teste donc le premier caractère utile plutôt
que le nom du fichier.

Correspondance des territoires, relevée sur le flux :

| Territoire | Fichier | Domaine retenu |
|---|---|---|
| Guadeloupe (et dépendances) | `CDPV85_TFFR_.txt` | `VIGI971-01` |
| Martinique | `CDPV85_TFFF_.txt` | `VIGI972-01` |
| Saint-Martin et Saint-Barthélemy | `CDPV85_TFFJ_.txt` | `VIGI978-977-01` |

Chaque territoire est découpé en domaines (`VIGI971-01`, puis `-51` à `-57`).
**Seule la zone principale est retenue** : additionner les vigilances des
sous-zones reviendrait à annoncer une alerte que Météo-France n'a pas émise.

Identifiants de phénomènes, **confirmés par recoupement dans le flux lui-même**
— le bulletin rédigé de Mayotte annonçait « Vagues-submersion JAUNE, Vents
forts néant, Fortes pluies/Orages néant » quand sa carte portait `9:2, 1:1,
12:1` :

| Identifiant | Phénomène |
|---|---|
| 1 | Vent violent |
| 2 et 12 | Fortes pluies-Orages |
| 9 | Vagues-submersion |
| 10 | **Cyclone** |

L'identifiant 10 a été établi par un test falsifiable plutôt que par
ressemblance. Météo-France documente quatre phénomènes pour la vigilance
outre-mer — vents violents, fortes pluies-orages, vagues-submersion et cyclone
— en précisant **« sauf en Guyane »**. Si 10 était le cyclone, il devait donc
manquer au seul fichier guyanais. Relevé sur le flux réel :

| Fichier | Territoire | Phénomènes |
|---|---|---|
| `CDPV85_TFFR_` | Guadeloupe | 1, 2, 9, **10** |
| `CDPV85_TFFF_` | Martinique | 1, 2, 9, **10** |
| `CDPV85_TFFJ_` | Îles du Nord | 1, 2, 9, **10** |
| `CDPV84/95_FMEE_` | Réunion et Mayotte | 1, 9, **10**, 12 |
| `CDPV85_SOCA_` | **Guyane** | 1, 2, 9 — **pas de 10** |

La Guyane est le seul territoire privé de cet identifiant, exactement là où la
documentation exclut le cyclone. La prédiction se vérifie.

Les DROM de l'océan Indien emploient l'identifiant 12 là où les Antilles
emploient le 2, pour le même phénomène.

Le niveau de vigilance cyclonique est affiché explicitement sur la page du
territoire, **même au vert** : c'est la question que le visiteur vient poser, et
une réponse rassurante donnée par l'autorité vaut mieux qu'un silence qu'il
faudrait interpréter.

Les couleurs `0` et `-1` signifient « non évalué » et ne sont jamais affichées
comme un niveau vert.

### 3.3 ARPEGE — **rafales prévues, intégrées**

| | |
|---|---|
| API | `ARPEGE` — `/public/arpege/1.0` |
| Service | `MF-NWP-GLOBAL-ARPEGE-025-GLOBE-WMS` |
| Quota | 50 requêtes/minute — une image est ensuite gardée une heure |
| Emprise | monde entier : la seule des cinq à contenir les Antilles |

**AROME ne sert à rien ici** : ses services s'appellent `AROME-001-FRANCE` et
`AROME-0025-FRANCE`, c'est le modèle métropole. Les services `EUROPE`, `EURAT`
et `ATOURX` d'ARPEGE s'arrêtent également avant l'Atlantique ouest — vérifié
sur leurs emprises déclarées. Seul `GLOBE` convient.

Ce qui rend cette source exploitable là où le radar ne l'est pas : le service
**WMS rend l'image lui-même**, en PNG, sur l'emprise demandée. Rien à décoder,
aucune dépendance ajoutée — Météo-France calcule, colorie et légende, KDL
Cyclone relaie en citant la source.

| | |
|---|---|
| Couche | `WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND` |
| Style | `FF_RAF__HEIGHT__SHADING` |
| Emprise | 10°N–22°N, 70°O–55°O (arc antillais) |
| Échéances | maintenant, +6 h, +12 h, +24 h (heures rondes UTC) |
| Poids | 17 à 30 Ko selon l'échéance |

**Pourquoi les rafales, et seulement elles** : c'est la grandeur que le réseau
de stations antillais ne mesure pas — zéro station sur quarante-six — et c'est
pourtant celle qui décide d'une mise à l'abri. Le reste (vent moyen, pluie,
pression) est déjà mesuré, ou fourni par Open-Meteo.

L'échéance affichée est calculée à l'heure ronde, exactement comme la requête :
annoncer « 13 h 21 » sous une image valable pour 13 h 00 serait une erreur.

Deux pièges rencontrés, à ne pas réintroduire :

- **`loading="lazy"` empêchait l'image d'arriver.** Sans elle, l'encart restait
  vide sans erreur. Le chargement différé est retiré : l'image pèse 20 Ko.
- **`style="display:none"` est sans effet** : la politique de contenu interdit
  les styles inline. La visibilité passe par la classe `.est-cache`.

L'image ne porte ni côte ni frontière : les territoires suivis sont projetés
par-dessus en SVG. La projection est directe, l'emprise étant demandée en
EPSG:4326 où latitude et longitude sont linéaires.

### 3.4 Radar — **souscrit mais non exploitable en l'état**

| | |
|---|---|
| API | `DonneesPubliquesRadar` — `/public/DPRadar/v1` |
| Zone | **ANTILLES** existe bien, produits `REFLECTIVITE` et `LAME_D_EAU`, toutes les 5 minutes |
| Maille | 1000 m (seule valeur acceptée pour cette zone) |
| Poids | 26 Ko compressés → **4,5 Mo** décompressés |
| Format | **BUFR édition 4**, centre 85 (Toulouse) |

Le blocage n'est pas le poids, c'est le format. Le message emploie 56
descripteurs dont plusieurs **séquences et éléments locaux au centre 85**
(`3-29-192`, `0-48-192`, `0-25-192`, `0-31-192`, `0-06-196`), absents des
tables publiques de l'OMM, ainsi que des opérateurs de redéfinition
(`2-01-124`, `2-02-129`, `2-03-011`) et des réplications différées.

Sans les tables locales de Météo-France, l'échelle, la référence et la largeur
en bits de ces champs ne peuvent pas être devinées : un décodeur écrit à la
main rendrait des valeurs **fausses sans lever d'erreur**. C'est un décodeur
BUFR quasi complet qu'il faudrait, pas un lecteur ciblé.

**Décision** : ne pas intégrer le radar tant que le décodage n'est pas sûr. La
voie réaliste serait `ecCodes` (paquet système `libeccodes-tools`, qui embarque
les tables locales du centre 85), sur le modèle du venv Python déjà utilisé
pour les cartes sociales. Cela suppose une dépendance système, donc une
décision explicite.

---

## 4. Natural Earth

| | |
|---|---|
| Site | https://www.naturalearthdata.com/ |
| Licence | Domaine public |
| Coût | 0 € |

Fond de carte construit une fois par `npm run geo:build`, simplifié
(Douglas-Peucker) et **hébergé localement** dans `public/geo/` :

| Couche | Détail | Poids |
|---|---|---|
| `monde.json` | 110 m, Atlantique et continents | 25 Ko |
| `antilles.json` | 10 m, arc antillais | 205 Ko |
| `guadeloupe.json` | 10 m, archipel | 3 Ko |

Aucun service de tuiles n'est appelé : pas de coût, pas de quota, pas de
position d'utilisateur transmise à un tiers, et la carte reste disponible hors
connexion.

---

## Ce qui a été écarté

| Service | Raison |
|---|---|
| Google Maps / Mapbox | Payant au-delà d'un quota, carte bancaire exigée |
| OpenWeatherMap, Tomorrow.io, Weatherbit | Offre gratuite trop limitée ou clé liée à une carte bancaire |
| Tuiles OSM publiques | Politique d'usage incompatible avec une application publique |
| Windy, Zoom Earth | Pas d'API ouverte réutilisable |

---

## Budget

| Poste | Coût mensuel |
|---|---|
| Données météorologiques | 0 € |
| Cartographie | 0 € |
| Hébergement | 0 € — VPS OVH KDLTech existant |
| Domaine | 0 € — sous-domaine de `kdl-tech.fr` |
| Dépendances logicielles | 0 € — aucune |
| **Total** | **0 €** |

La gratuité durable ne repose sur aucune offre promotionnelle : elle vient du
fait qu'aucune source utilisée n'a de modèle payant obligatoire, et que
l'infrastructure existe déjà.
