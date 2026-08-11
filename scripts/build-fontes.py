"""
Fabrique les fontes web de KDL Cyclone à partir des Inter officielles du dépôt.

La feuille de style déclarait « Inter » sans qu'aucune fonte ne soit servie :
l'application tournait en réalité sur la pile système, avec un rendu différent
sur chaque appareil et des graisses approximatives. Plutôt que de retirer la
déclaration, on sert vraiment Inter — mais sous-ensemblée au français, sinon
les fichiers d'origine pèseraient 1,8 Mo à eux trois.

Sont conservés : le latin utilisé en français, la ponctuation typographique,
les symboles des unités météo, et surtout les **chiffres tabulaires**, dont
toute la mise en page des mesures dépend.

    python3 scripts/build-fontes.py

Dépendance : python3-fonttools (paquet de la distribution) et brotli.
"""
import pathlib
import subprocess
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCES = RACINE / 'assets' / 'fonts'
CIBLE = RACINE / 'public' / 'fonts'

GRAISSES = [
    ('Inter-Regular.otf', 'inter-400.woff2', 400),
    ('Inter-SemiBold.otf', 'inter-600.woff2', 600),
    ('Inter-Bold.otf', 'inter-700.woff2', 700),
]

# Plages Unicode réellement utilisées par l'interface. Tout le reste est écarté :
# c'est ce qui fait passer chaque graisse de 600 Ko à quelques dizaines.
UNICODES = ','.join([
    'U+0020-007E',   # latin de base et ponctuation ASCII
    'U+00A0-00FF',   # accents français, °, µ, ², ³, «, », ×
    'U+0152-0153',   # Œ œ
    'U+0178',        # Ÿ
    'U+02BC',        # apostrophe modificative
    'U+2010-2015',   # tirets et demi-cadratins
    'U+2018-201F',   # apostrophes et guillemets typographiques
    'U+2022',        # puce
    'U+2026',        # points de suspension
    'U+202F',        # espace fine insécable — typographie française
    'U+2030',        # pour mille
    'U+2039-203A',   # chevrons simples
    'U+20AC',        # euro
    'U+2192',        # flèche
    'U+2212',        # signe moins
    'U+2713-2714',   # coches
])

# `tnum` aligne les chiffres en colonne : sans elle, les tableaux de mesures et
# les compteurs sautilleraient à chaque mise à jour.
FONCTIONS = 'kern,liga,clig,calt,tnum,frac,ccmp,locl,mark,mkmk'


def fabriquer():
    if not SOURCES.is_dir():
        print(f'sources introuvables : {SOURCES}', file=sys.stderr)
        return 1

    CIBLE.mkdir(parents=True, exist_ok=True)
    total = 0
    for source, sortie, graisse in GRAISSES:
        entree = SOURCES / source
        if not entree.exists():
            print(f'manquant : {entree}', file=sys.stderr)
            return 1
        destination = CIBLE / sortie
        subprocess.run([
            sys.executable, '-m', 'fontTools.subset', str(entree),
            f'--unicodes={UNICODES}',
            f'--layout-features={FONCTIONS}',
            '--flavor=woff2',
            '--desubroutinize',
            '--no-hinting',
            '--drop-tables+=DSIG',
            f'--output-file={destination}',
        ], check=True, capture_output=True)
        poids = destination.stat().st_size
        total += poids
        avant = entree.stat().st_size
        print(f'  {sortie:18} {poids / 1024:6.1f} Ko  '
              f'(graisse {graisse}, {avant / 1024:.0f} Ko à l\'origine)')

    print(f'\nTotal servi : {total / 1024:.1f} Ko pour {len(GRAISSES)} graisses.')
    licence = SOURCES / 'Inter-LICENSE.txt'
    if licence.exists():
        (CIBLE / 'LICENSE.txt').write_bytes(licence.read_bytes())
        print('Licence SIL Open Font recopiée à côté des fontes.')
    return 0


if __name__ == '__main__':
    sys.exit(fabriquer())
