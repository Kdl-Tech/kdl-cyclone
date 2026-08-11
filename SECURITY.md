# Sécurité

## Signaler une faille

Écrivez à KDLTech via <https://kdl-tech.fr/carte.html>, en indiquant
« sécurité KDL Cyclone » en objet. Une réponse est apportée sous 72 heures.

**Ne créez pas d'issue publique** pour une faille exploitable : la page peut
être lue par n'importe qui, et l'application sert des informations de sécurité
civile.

Décrivez ce que vous avez observé, comment le reproduire, et l'impact que vous
estimez. Les preuves de concept destructrices ne sont pas nécessaires — une
description précise suffit toujours.

## Périmètre

Concerne ce dépôt et le service publié sur `cyclone.kdl-tech.fr` :

- exécution de code, injection, traversée de chemin ;
- contournement de la politique de sécurité du contenu ;
- falsification des données affichées comme officielles — le point le plus
  grave ici : quelqu'un qui parviendrait à faire afficher une fausse
  probabilité du NHC mettrait des gens en danger ;
- fuite de données d'un visiteur.

Hors périmètre : absence d'en-tête sans impact démontrable, résultats bruts de
scanner sans exploitation, dénis de service par volume, et ingénierie sociale.

## Ce que l'application ne fait pas

Ces choix limitent la surface d'attaque par construction, et ne changeront pas :

- **aucune dépendance d'exécution** — rien à compromettre en amont ;
- **aucun compte, aucun mot de passe** — rien à voler ;
- **aucun traceur, aucune publicité, aucun appel tiers depuis le navigateur** ;
- **aucune donnée personnelle collectée** — pas de position, pas d'identifiant,
  pas de cookie de suivi. Les préférences (thème, territoire, préparation)
  restent dans le navigateur du visiteur ;
- **une seule route accepte l'écriture** (`/api/feedback`), limitée en débit,
  validée et sans exécution ;
- le serveur **écoute sur `127.0.0.1`** ; la publication passe par un reverse
  proxy.

## Dépendances

`package.json` ne déclare aucune dépendance d'exécution. Les outils de
développement (`fonttools`, `Pillow`) ne servent qu'à fabriquer des fontes et
des visuels, jamais à l'exécution du service.

Cette absence est délibérée : elle supprime toute compromission héritée d'un
paquet tiers, et évite d'avoir à mettre à jour un arbre de dépendances en
urgence au milieu d'une saison cyclonique.

## Secrets

Aucun secret n'est nécessaire pour faire tourner l'application : toutes les
sources sont ouvertes et anonymes.

Le dépôt est contrôlé avant chaque publication :

```bash
python3 scripts/audit-secrets.py --historique
```

Le script analyse l'état courant, les fichiers non suivis et **tous** les objets
de l'historique Git. Il n'affiche jamais la valeur d'un secret détecté, seulement
son type et son emplacement — un secret imprimé dans un terminal est un secret
diffusé une fois de plus.

## Versions prises en charge

Seule la dernière version publiée reçoit des correctifs. La version installée
est lisible sur `/version.json` et dans la page À propos de l'application.
