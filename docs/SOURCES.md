# Sources de données — vérifications et conditions

Chaque source a été vérifiée avant intégration : disponibilité réelle, licence,
obligation d'attribution, limites d'usage, coût.

Vérification effectuée le **9 août 2026**.

---

## 0. Communes et lieux — deux sources, utilisées hors ligne uniquement

### 0.1 Découpage administratif officiel (territoires français)

| | |
|---|---|
| Service | https://geo.api.gouv.fr/communes |
| Données | Découpage administratif de l'État français |
| Clé d'accès | Aucune |
| Coût | 0 € |
| Usage | **À la fabrication seulement** : `scripts/build-communes.mjs` |

Les **32 communes de Guadeloupe** et les **34 de Martinique** viennent de là,
avec leur centre géographique et leur population légale. Liste exhaustive et
exacte, ni une commune de plus, ni une de moins.

### 0.2 Géocodage Open-Meteo (îles indépendantes)

| | |
|---|---|
| Service | https://geocoding-api.open-meteo.com/ |
| Données | GeoNames, CC BY 4.0 |
| Clé d'accès | Aucune |
| Coût | 0 € |
| Usage | **À la fabrication seulement** : `scripts/build-communes.mjs` |

Pour la Dominique, Sainte-Lucie, la Barbade, Antigua-et-Barbuda, Trinité-et-Tobago
et les quartiers des collectivités du Nord, que l'API française ne découpe pas.

### Pourquoi deux sources

GeoNames enregistre certains chefs-lieux sous le nom d'un de leurs quartiers :
une recherche de « Bouillante » y renvoie « Village », « Schoelcher » renvoie
« Case Navire ». La première version du script retenait le résultat le plus
peuplé sans vérifier le nom — l'application a donc proposé pendant un temps une
commune « Village » qui n'existe pas, tandis que Bouillante et Schœlcher
manquaient.

D'où la règle appliquée depuis : **un résultat dont le nom ne correspond pas à
ce qui était demandé est rejeté**, et l'absence est signalée en fin d'exécution
plutôt que comblée par un à-peu-près. Pour une application météo, une commune
inventée est pire qu'une commune manquante.

Trois lieux sont écartés en connaissance de cause, faute de figurer dans les
sources : Quartier d'Orléans (Saint-Martin), Saint-Jean et Lorient
(Saint-Barthélemy) — ce sont des quartiers, pas des communes.

**L'application n'interroge aucun de ces services à l'exécution** : la liste est
statique dans `src/communes.js`, et aucun nom saisi par un visiteur n'est envoyé
où que ce soit. Écrire des latitudes à la main aurait fini par produire un
bulletin correspondant à un point situé en mer, ou dans l'île voisine.

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

## 3. Météo-France — non intégré, volontairement

| | |
|---|---|
| Vigilance Guadeloupe | https://vigilance.meteofrance.fr/fr/guadeloupe |
| API vigilance | `public-api.meteofrance.fr` — **jeton d'accès requis** |

Les points d'accès testés (`webservice.meteofrance.com`,
`rpcache-aa.meteofrance.com`) répondent `401 — you must provide a token`.

**Décision** : ne pas intégrer. Afficher une vigilance officielle avec un
décalage, une erreur d'interprétation ou une panne silencieuse serait pire que
de ne pas l'afficher du tout. KDL Cyclone renvoie donc directement vers la page
officielle, mise en avant sur l'accueil et sur la page Guadeloupe.

Si un jeton gratuit est obtenu plus tard, l'intégration se fera par variable
d'environnement, sans jamais remplacer le lien officiel.

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
