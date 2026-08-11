# Méthode d'analyse — comment le potentiel KDL est calculé

> Cette méthode est **expérimentale** et n'a été validée par aucun organisme
> météorologique. Elle sert à *expliquer* un environnement, jamais à prévoir.
> La probabilité officielle du National Hurricane Center reste la référence.

---

## Principe

Neuf facteurs de cyclogenèse sont mesurés dans les modèles ouverts, notés de
−1 (bloquant) à +1 (très favorable), puis combinés par moyenne pondérée. Le
résultat est ramené sur une échelle de 0 à 100.

Une donnée absente est **retirée du calcul** — jamais remplacée par une valeur
par défaut. Sa disparition fait baisser la couverture, donc la confiance.

Code : `src/engine/potential.js`. Fonction pure, sans entrée/sortie, couverte
par les tests.

## Les neuf facteurs

| Facteur | Poids | Source | Seuils retenus |
|---|---|---|---|
| Température de la mer | 1,15 | Open-Meteo Marine | < 26,5 °C défavorable · > 28,5 °C très favorable |
| Cisaillement vertical 850–200 hPa | 1,30 | GFS | < 19 km/h favorable · > 37 km/h hostile |
| Humidité à 700 hPa | 1,00 | GFS | < 45 % défavorable · > 65 % favorable |
| Activité orageuse | 0,90 | GFS | précipitations horaires modélisées |
| Rotation en basses couches | 1,05 | GFS, calcul KDL | vorticité relative à 850 hPa |
| Pression au niveau de la mer | 0,85 | GFS ou NHC | < 1 009 hPa favorable |
| Latitude / force de Coriolis | 0,80 | position | < 7° insuffisant · > 30° sortie de zone |
| Air sec ou poussières sahariennes | 0,75 | **CAMS (mesure)** + GFS | poussière en µg/m³ et épaisseur optique |
| Accord des modèles | 0,95 | GFS + ECMWF + ICON | écart-type de pression à +72 h |

Le cisaillement pèse le plus lourd : c'est le facteur qui, en pratique, tue le
plus de systèmes dans l'Atlantique tropical.

## Calculs propres au projet

### Cisaillement vertical

Différence **vectorielle** entre le vent à 850 hPa et celui à 200 hPa, et non
différence de vitesses. Deux vents de même force en sens opposés donnent un
cisaillement égal à leur somme, ce qu'une simple soustraction manquerait.

### Rotation en basses couches

Vorticité relative par différences finies sur cinq points espacés de 1,5° :

```
ζ = ∂v/∂x − ∂u/∂y
```

Les cinq points sont obtenus en **une seule requête** grâce au mode
multi-coordonnées d'Open-Meteo. Seule la rotation cyclonique (positive dans
l'hémisphère nord) est retenue. Le résultat est converti en vitesse équivalente
sur un rayon de 150 km, plus parlante qu'une valeur en s⁻¹.

### Indice de couche saharienne

Cet indice reposait initialement sur un indicateur indirect : le contraste
d'humidité entre la couche limite et la moyenne troposphère. Il repose
désormais sur une **mesure** d'aérosols, fournie par le modèle CAMS via
l'API qualité de l'air d'Open-Meteo :

- `dust` — concentration de poussière, en µg/m³ ;
- `aerosol_optical_depth` — épaisseur optique sur toute la colonne d'air.

Une couche saharienne marquée se lit au-delà de 0,4 d'épaisseur optique, avec
des concentrations de poussière dépassant 50 µg/m³. L'air sec accompagne la
poussière : le contraste d'humidité pèse encore un quart de l'indice, la mesure
les trois autres quarts.

Si l'API d'aérosols ne répond pas, l'ancien indicateur indirect reprend la main
et l'interface le signale : l'explication du facteur précise alors qu'il s'agit
d'une estimation indirecte, et non d'une mesure.

### Accord des modèles

Écart-type de la pression au niveau de la mer prévue à +72 h par GFS, ECMWF IFS
et ICON. Zéro écart = accord total ; 8 hPa d'écart = divergence franche.

## Verrous physiques

Certains facteurs sont éliminatoires à eux seuls. Ils plafonnent le score, quel
que soit le reste :

| Condition | Plafond | Motif |
|---|---|---|
| Mer < 25,5 °C | 18/100 | pas assez d'énergie disponible |
| Cisaillement > 65 km/h | 20/100 | les orages sont disloqués |
| Latitude < 5° | 12/100 | Coriolis insuffisant pour enrouler l'air |

## Confiance

```
confiance = 0,45 × couverture + 0,35 × accord des modèles + 0,20 × fraîcheur
```

- **couverture** : part du poids total des facteurs réellement mesurés ;
- **accord** : convergence des trois modèles ;
- **fraîcheur** : décroît avec l'âge de la donnée de modèle.

Sous 45 %, la confiance est affichée comme « faible ».

---

# Évaluation du risque pour la Guadeloupe

Code : `src/engine/threat.js`.

## Corridor indicatif

À partir de la position et du déplacement, le corridor extrapole des positions à
0, 12, 24, 36, 48, 72, 96 et 120 heures, chacune assortie d'un rayon
d'incertitude :

| Échéance | Rayon |
|---|---|
| 24 h | 110 km |
| 48 h | 185 km |
| 72 h | 280 km |
| 96 h | 385 km |
| 120 h | 500 km |

Ces rayons sont volontairement larges : mieux vaut un corridor honnête qu'une
ligne faussement précise.

**Sans déplacement connu, aucun corridor n'est produit.** L'interface affiche
alors « non calculable » plutôt qu'une trajectoire inventée.

Ce corridor n'est **jamais** présenté comme un cône officiel : il est tracé en
pointillés, le cône du NHC en trait plein.

## Score de menace

```
score = 100 × P(approche) × sévérité × facteur de délai × (0,4 + 0,6 × P(développement))
```

- **P(approche)** : position de la Guadeloupe dans le cercle d'incertitude au
  moment du passage au plus près ;
- **sévérité** : intensité connue, ou intensité potentielle si le système n'est
  pas nommé ;
- **facteur de délai** : un système à 24 h n'appelle pas la même réaction qu'un
  système à 5 jours, à probabilité égale ;
- **P(développement)** : probabilité du NHC si elle existe, sinon le potentiel KDL.

## Niveaux

| Score | Niveau | Sens |
|---|---|---|
| 0–2 | Aucun | rien à signaler |
| 3–9 | Veille | suivi par précaution |
| 10–24 | Surveillance rapprochée | à revoir régulièrement |
| 25–44 | Préparation conseillée | vérifier son kit, sans urgence |
| 45+ | Impact possible à court terme | suivre la vigilance officielle |

Règle de sécurité : un système **déjà nommé** dont le corridor passe à moins de
500 km dans les 48 heures ne descend jamais sous « surveillance rapprochée »,
quel que soit le résultat du calcul.

Aucun de ces niveaux ne déclenche d'alerte. Seules Météo-France et la préfecture
le font.
