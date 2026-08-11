# Contribuer

Merci de l'intérêt porté au projet. Quelques repères avant de commencer.

## Ce que ce dépôt est, et n'est pas

Le code est publié pour être **consultable** : vérifier comment les bulletins
officiels sont traités, comment l'indice expérimental est calculé, et s'assurer
que rien n'est inventé. Ce n'est pas un projet sous licence ouverte — voir
[`LICENSE`](LICENSE). Les contributions sont les bienvenues, mais elles
rejoignent un code dont KDLTech conserve les droits.

## Signalements les plus utiles

1. **Une donnée fausse ou trompeuse.** C'est la priorité absolue. Précisez ce
   qui était affiché, ce qu'annonçait la source officielle au même moment, et
   l'heure. Une capture aide beaucoup.
2. **Une autorité mal attribuée.** Chaque territoire a ses propres services :
   Météo-France ne couvre ni la Dominique, ni Sainte-Lucie, ni la Barbade, ni
   Antigua, ni Trinité. Un lien français sur l'un de ces territoires est un
   défaut grave.
3. **Un problème d'affichage** : débordement, texte illisible, commande
   inaccessible. Indiquez l'appareil, la largeur d'écran et le thème.

Pour une faille de sécurité, n'ouvrez **pas** d'issue : voir
[`SECURITY.md`](SECURITY.md).

## Avant de proposer du code

```bash
node demarrer.mjs                                        # démarrer
npm test                                                 # 128 tests
node --experimental-websocket scripts/qa-responsive.mjs  # 8 formats, 2 thèmes
python3 scripts/audit-secrets.py                         # aucun secret
```

Tout doit passer. Si votre changement touche l'interface, joignez une capture
avant/après dans les deux thèmes.

## Style attendu

Le code est écrit en français, y compris les noms de variables et de fonctions.
C'est délibéré : le domaine est français, les sources sont traduites, et
mélanger les deux langues dans le même fichier rendrait la lecture pénible.

- **Aucune dépendance d'exécution ne sera ajoutée.** Si une bibliothèque semble
  indispensable, ouvrez d'abord une issue pour en discuter.
- Les commentaires expliquent **pourquoi**, pas quoi. Un commentaire qui
  paraphrase la ligne suivante sera retiré.
- Une donnée affichée porte toujours sa source et sa date. Jamais de valeur
  sans provenance.
- Ce qui vient d'un organisme officiel et ce que KDL calcule ne se ressemblent
  jamais à l'écran — couleurs, formes et libellés les séparent.

## Règles absolues

- **Rien d'inventé.** Pas de donnée interpolée présentée comme mesurée, pas de
  particule décorative non alimentée par un modèle réel, pas d'avis ni de
  statistique fabriqués.
- **L'officiel prime toujours.** Aucune estimation maison ne doit pouvoir être
  confondue avec un bulletin.
- **Jamais de secret dans un commit** — ni jeton, ni clé, ni chemin de coffre,
  ni configuration de serveur.

## Commits

Messages en français, à l'impératif ou au constat, expliquant le problème résolu
plutôt que la manipulation effectuée. Un commit qui corrige un défaut décrit
d'abord le symptôme observé, puis la cause trouvée.
