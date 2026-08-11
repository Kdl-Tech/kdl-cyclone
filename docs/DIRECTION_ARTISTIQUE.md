# Direction artistique — KDL Cyclone

Version 0.9.0. Ce document fixe les règles visuelles de l'application et
explique les pièges rencontrés, pour qu'une modification future ne défasse pas
ce qui a été gagné.

> **Version 2 (0.9.0)** — l'application a désormais son identité propre, et
> non plus celle du site KDLTech. Le bleu institutionnel ne sert plus qu'à la
> signature : logo, lien vers KDLTech, pied de page. L'interface, elle, parle
> météo.

## Parti pris : un centre de veille tropical

Bleu profond pour l'océan et la parole officielle, cyan pour l'air et le
satellite, une échelle franche du vert au rouge pour le risque, violet pour ce
que KDL calcule lui-même, et une couleur par grandeur physique. Le neutre
chaud tient la structure ; tout le reste porte du sens.

| Couleur | Sens | Variables |
| --- | --- | --- |
| Bleu profond | océan, données officielles | `--ocean`, `--ocean-vif` |
| Cyan | air humide, satellite, commandes actives | `--cyan`, `--cyan-vif` |
| Vert | situation calme ou favorable | `--n0` |
| Jaune | vigilance | `--n1` |
| Orange | risque notable | `--n2` |
| Rouge | danger, forte probabilité | `--n3` |
| Violet | analyse expérimentale KDL | `--kdl-analyse` |
| Turquoise | vent | `--d-vent` |
| Bleu intense | pluie | `--d-pluie` |
| Indigo | houle, état de la mer | `--d-houle` |
| Corail | chaleur, température de la mer | `--d-thermique` |
| Fuchsia | ultraviolet | `--d-uv` |
| Ocre | poussières sahariennes | `--d-sable` |
| Acier | pression | `--d-pression` |
| Neutres chauds | structure de l'interface | `--fond`, `--surface*` |

Cinq notions ne doivent jamais se confondre, et chacune a sa forme autant que
sa couleur : la **probabilité de formation** (grand chiffre, bleu océan),
l'**intensité actuelle** du système, le **risque pour le territoire choisi**
(échelle de crans), la **vigilance officielle locale** (liens vers l'autorité
compétente) et l'**analyse KDL** (violet, hachures, mention « expérimental »).

Règle absolue : **une couleur d'alerte ne sert jamais à décorer.** Si un aplat
est rouge, c'est que la donnée l'est.

## Fondation (version 1) : la table du prévisionniste

Le support est neutre — papier le jour, ardoise la nuit — et **seules les
données ont le droit d'être colorées**. Le bleu KDL est l'encre de la marque,
jamais la peinture des surfaces.

Répartition tenue partout :

| Part | Rôle | Où |
| --- | --- | --- |
| 70 % | neutre | fonds, cartes, textes, bordures |
| 20 % | identité KDL | en-tête, liens, action principale, mode préparation, signature |
| 10 % | sémantique | échelle de menace, alertes, teintes de grandeur physique |

Un aplat coloré signifie toujours quelque chose. Si tout est accentué, plus
rien ne l'est.

## Échelle de menace — le fil conducteur

Quatre crans, déclinés en clair et en sombre, présents partout où un niveau se
lit : bandeau d'accueil, cartes de système, carte, page territoire, fiche.

| Cran | Sens | Clair (texte / aplat) | Sombre |
| --- | --- | --- | --- |
| `n0` | calme | `#0f7d4f` / `#17a86a` | `#34d399` |
| `n1` | vigilance | `#8a6300` / `#f2b705` | `#fbbf24` |
| `n2` | risque notable | `#bf4c0a` / `#f97316` | `#fb923c` |
| `n3` | danger | `#bc2622` / `#ef4444` | `#f87171` |

Correspondance avec les niveaux du moteur : `aucun → n0`, `veille → n1`,
`surveillance → n2`, `preparation` et `imminent → n3` (fonction `cranRisque`).
Pour un système : `menacePour()` d'abord, puis le risque officiel du NHC
(`cranSysteme`). La carte suit la même règle (`_couleurSysteme`) : une zone
classée « moyen » ne peut pas être ambre sur l'accueil et cyan sur la carte.

Deux variables complémentaires :

- `--teinte` peint les aplats et les filets ;
- `--teinte-texte` écrit. En thème clair, un ambre lumineux sur fond blanc ne
  passerait pas le contraste AA.

## Teintes de grandeur physique

Une grandeur, une couleur, un pictogramme : vent, pluie, houle, pression,
thermique (air et mer), UV, poussières, soleil. Depuis la version 2, la teinte
baigne la carte de mesure — dégradé léger, filet vertical, pastille d'icône —
au lieu de se réduire à un trait : on reconnaît le vent ou l'UV avant même de
lire le libellé.

Elles n'empruntent jamais les couleurs de l'échelle de menace, et
réciproquement.

## Provenance de l'information

La forme dit la provenance autant que la couleur :

- **Officiel** — tampon plein bleu océan. Priorité absolue.
- **Modèle** — contour cyan : une sortie de modèle météo, pas une parole
  officielle.
- **Analyse KDL** — violet, barre **hachurée** (le hachurage marque
  l'estimation).
- **Expérimental** — violet en pointillés.
- **Non disponible** — pointillés neutres.

Sur l'accueil, la probabilité officielle du NHC est le seul grand chiffre de la
carte ; l'analyse maison est une barre discrète. On ne doit jamais pouvoir les
confondre.

## La carte est un objet, pas une surface d'interface

Elle reste sombre dans les deux thèmes (palette `CARTE` dans `carte.js`), ce
qui donne un océan qui a de la matière, des terres franches et une imagerie
satellite lisible. L'océan est peint en trois bleus — le large, la mer des
Caraïbes, les fosses — et les terres tirent vers le chaud pour s'en détacher. Ses couleurs sont autonomes : n'y utilisez jamais les
variables de la page (`--texte`, `--surface`…), elles deviendraient illisibles
en thème clair.

Le territoire suivi porte une croix de visée et un cartouche : on le trouve en
un coup d'œil au milieu de l'Atlantique.

## Couche satellite

Les vignettes GOES-19 sont converties en calque à fond transparent : la
luminance de chaque pixel devient son opacité (`preparerCalque` dans
`satellite.js`), avec un fondu de 5,5 % sur les bords pour que le secteur ne se
découpe pas en rectangle sur l'océan.

L'ancien rendu superposait l'image entière en mode `lighter` : tout se délavait
en blanc-cyan et la carte disparaissait dessous. **Ne pas revenir à une fusion
additive.**

Rien n'est inventé : les couleurs d'origine sont conservées, seule leur
transparence est calculée.

## Piège majeur : la CSP interdit les attributs `style`

L'en-tête `style-src 'self'` (sans `unsafe-inline`) émis par `server.js` fait
que le navigateur **conserve l'attribut `style` mais n'en applique rien**.
Aucune erreur, aucun avertissement : les largeurs de barres tombent à zéro et
les respirations entre blocs disparaissent.

Portée réelle, vérifiée le 2026-08-10 : en **production**, une Transform Rule
Cloudflare remplace cet en-tête par la CSP générale de kdl-tech.fr, qui
autorise `style-src 'self' 'unsafe-inline'`. Les styles en ligne y
fonctionnaient donc, et l'aplatissement ne touchait que le développement local
et tout futur durcissement de la règle Cloudflare. Le correctif rend le rendu
indépendant de la politique appliquée : c'est ce qui compte, la Transform Rule
devant de toute façon être resserrée un jour (elle ouvre aussi `script-src`
à `unsafe-inline` et à un CDN externe pour toutes les pages du domaine).

`app.js` répare cela sans affaiblir la politique : `rendreStylesEnLigne()`
relit l'attribut et le repose par `style.cssText`, ce que le CSSOM autorise ;
`surveillerStyles()` applique la même réparation à tout contenu inséré ensuite.

Conséquences à connaître :

- la politique reste stricte, y compris pour un contenu tiers injecté dans la
  page — seuls les attributs écrits par l'application sont rétablis, et toutes
  les données externes passent par `echapper()` avant d'être insérées ;
- si un jour la CSP est assouplie, ce correctif devient inutile mais reste sans
  effet de bord ;
- une nouvelle vue qui utilise `style="…"` fonctionne, mais une classe CSS
  reste préférable.

## Choix du territoire

C'est le contrôle le plus utile de l'en-tête, et il obéit à trois règles :

1. **Il ne dépend d'aucune donnée.** Il s'affiche dès la première image à
   partir de `TERRITOIRES_CONNUS`, une liste embarquée dans `app.js` ; celle du
   serveur prend le relais dès qu'elle arrive. Un test
   (`test/territoires-client.test.js`) échoue si les deux divergent.
2. **C'est un bouton, pas un badge.** Épingle, libellé « Territoire », nom
   courant, chevron, 44 px de haut, survol, focus cerclé. Le `<select>` natif
   est conservé — clavier, tactile et menus système compris — mais rendu
   transparent et étalé sur tout le contrôle : n'importe quel point ouvre la
   liste.
3. **Les `option` portent des couleurs explicites.** Le menu déroulant est
   peint par le système, pas par la page : sans `background-color` et `color`
   sur `option`, les noms de territoires s'affichaient blanc sur blanc en thème
   sombre. La liste s'ouvrait, mais elle était illisible.

Le territoire choisi est enregistré, inscrit dans l'URL (`?territoire=<clé>`,
absent pour la Guadeloupe) et conservé d'une page à l'autre. Ordre de
résolution : URL, puis préférence enregistrée, puis Guadeloupe.

## Thème

Le **mode clair est le mode par défaut**, y compris sur un appareil réglé en
sombre : `prefers-color-scheme` n'est pas consulté. Seule une bascule explicite
enregistre une préférence, et elle survit au rechargement, à la réouverture et
à l'installation. Le script d'initialisation, en tête de `index.html`, pose le
thème avant le premier rendu : aucun flash.

La couleur de la barre système suit le thème de l'application, pas celui du
téléphone (`#couleur-systeme`, ajustée par `appliquerTheme`).

## Deux âges, deux phrases

L'âge du bulletin officiel et celui de notre collecte se confondaient :
« À jour » s'affichait à côté de « reçu il y a 2 heures », juste après une
collecte réussie. Le NHC publie quatre fois par jour ; un bulletin de deux
heures est normal. On dit donc « Bulletin publié il y a… » pour l'officiel, et
« Collecte KDL il y a… » pour la nôtre. « À jour » ne peut plus s'afficher si
nos propres données dépassent trois heures.

## Chargement, vide, erreur

- Squelettes bordés et animés plutôt qu'une roue qui tourne.
- État vide illustré, avec une action proposée (vérifier le kit).
- Bandeaux : neutre pour une information, ambre pour une attention, rouge pour
  une alerte — la couleur est réservée à ce qui alerte réellement.

## Contrôle du rendu

```bash
node demarrer.mjs                                        # serveur local
node --experimental-websocket scripts/qa-refonte-visuelle.mjs   # captures
node --experimental-websocket scripts/qa-territoire-theme.mjs   # 20 scénarios
node --experimental-websocket scripts/qa-responsive.mjs         # 8 formats
node scripts/qa-firefox.mjs                                     # autre moteur
```

Tous acceptent `KDL_QA_BASE=https://cyclone.kdl-tech.fr` pour contrôler la
production plutôt que le poste local.

`qa-responsive` mesure ce qui casse vraiment une interface : débordement
horizontal, cible tactile sous 40 px, texte sous 11 px, disparition du
sélecteur — sur huit formats, deux thèmes et cinq vues, soit 450 contrôles.
C'est lui qui a révélé une navigation à 40 px, des boutons « discrets » à
38 px et onze tailles de texte devenues illisibles au soleil.

Le second rejoue les cas qui ne se vérifient pas à l'œil : stockage vide sur un
appareil réglé en sombre, source lente, mode hors connexion, écran de 320 px,
lien partagé, navigation au clavier, contraste du menu déroulant.

Les captures partent dans `~/Bureau/kdl-cyclone-captures/refonte/` : accueil,
carte (avec boucle satellite), fiche, territoire, météo et préparation, en
clair et en sombre, en écran de bureau et en téléphone.

Contrastes vérifiés au ratio WCAG AA (4,5:1) pour tout texte, dans les deux
thèmes, sur les trois fonds (`--surface`, `--surface-2`, `--fond`).

## Responsive

Mobile d'abord, puis élargissement. Les règles qui comptent :

- **Aucun débordement horizontal**, jamais. Seules la bande horaire et les
  graphiques défilent, à l'intérieur de leur propre conteneur, avec un indice
  visuel de glissement sous 760 px.
- **44 px de cible tactile** partout : navigation, boutons, sélecteur,
  commandes de carte, y compris sur un écran de 320 px et sur grand écran — on
  clique aussi sur une tablette posée à plat.
- **11 px de plancher typographique.** En dessous, un libellé ne se lit pas au
  soleil, à bout de bras.
- **Rien d'essentiel derrière un survol** : l'infobulle de carte double une
  information disponible au clic, dans la fiche.
- La carte garde une hauteur utile (`clamp(360px, 62vh, 640px)`), passe à 78 vh
  sur téléphone couché, et ses commandes s'alignent horizontalement sous
  600 px pour ne pas manger l'Atlantique.
- L'animation satellite s'arrête quand la carte sort de l'écran
  (`IntersectionObserver`) et quand l'onglet passe en arrière-plan.

## Cycle de vie de l'application

Trois pièges se sont payés cher ici ; ils sont désormais tenus par
`scripts/qa-pwa-cycle.mjs`, qui rejoue le scénario complet.

1. **Un service worker en attente est arrêté par le navigateur.** Il n'entend
   pas toujours le message qu'on lui envoie — le bouton « Mettre à jour »
   partait alors dans le vide, sans erreur. La page envoie donc `SKIP_WAITING`,
   mais borne son attente : passé six secondes, elle désinscrit le service
   worker et recharge. La page repart du réseau, donc dans la version neuve.
2. **Le document doit être servi réseau d'abord.** C'est lui qui référence les
   scripts et la feuille de style ; un `index.html` en cache fige toute
   l'application, y compris son bouton de mise à jour. Conséquence pratique :
   un visiteur bloqué sur une version cassée reçoit le correctif au **deuxième**
   chargement, jamais au premier.
3. **Le nom du cache porte la version *et* un identifiant de build** —
   `kdl-cyclone-<version>-<build>` — car on corrige parfois un script sans
   monter de version. Le build est l'empreinte des fichiers de la coquille,
   calculée au démarrage du serveur. Le nettoyage ne touche que les caches
   préfixés `kdl-cyclone-`.

Le bouton ne reste jamais muet : « Recherche d'une mise à jour… »,
« Téléchargement… », « Installation… », « Nouvelle version installée »,
« déjà à jour — version X » ou « Mise à jour impossible — Réessayer ». Un
verrou de session empêche toute boucle de rechargement.

`/version.json` (sans cache) expose version, build, date de déploiement et
version minimale compatible ; la page À propos l'affiche et propose une
vérification à la demande.

## Navigateurs intégrés

Facebook, Messenger, Instagram, TikTok, LinkedIn et les WebView Android
n'installent pas d'application web : `beforeinstallprompt` ne s'y déclenche
jamais. Y afficher un bouton « Installer » revient à afficher un bouton mort.

À la place, une passerelle s'affiche juste sous la situation — après
l'information, jamais devant : « Ouvrir dans Chrome » (URL `intent://` qui
conserve le chemin et les paramètres, avec repli HTTPS), « Copier le lien » et
« Comment faire ? ». Sur iOS, le parcours renvoie vers Safari puis « Sur
l'écran d'accueil ».

La détection teste Messenger avant Facebook — son user-agent porte les deux
marqueurs, et annoncer la mauvaise application au moment de suivre une consigne
sèmerait le doute.

## Mise en cache

Le service worker nomme son cache d'après la version du `package.json`. **Toute
modification visuelle exige une montée de version**, sinon un visiteur déjà
venu garde l'ancienne feuille de style et l'ancien script — y compris pendant
les campagnes de captures.

Côté Cloudflare, `scripts/deployer.sh` enchaîne la purge et le réamorçage
(`scripts/purger-cache.py`) : les fichiers susceptibles d'avoir changé sont
purgés, puis rechargés pour que le premier visiteur trouve un cache déjà chaud.
États attendus ensuite : `HIT` pour les fontes et les icônes, `REVALIDATED`
pour le CSS et les scripts (ils sont en `no-cache`, donc toujours revalidés —
c'est voulu), `BYPASS` pour `/sw.js`, `DYNAMIC` pour le HTML et l'API.
