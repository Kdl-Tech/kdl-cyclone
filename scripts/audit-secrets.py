"""
Recherche de secrets avant publication d'un dépôt.

Règle absolue : **aucune valeur n'est jamais affichée**. Le rapport donne le
type, le fichier, la portée — état courant ou historique — et rien d'autre.
Un secret imprimé dans un terminal, un journal ou un compte rendu est un secret
diffusé une fois de plus.

    python3 scripts/audit-secrets.py            # état courant + non suivis
    python3 scripts/audit-secrets.py --historique   # + tout l'historique Git

Sortie : code 0 si rien, 1 si quelque chose mérite un examen humain.
"""
import re
import subprocess
import sys
import pathlib

RACINE = pathlib.Path(__file__).resolve().parent.parent

# Chaque motif décrit une famille de secrets. Le libellé est ce qui sera
# affiché ; la valeur trouvée, jamais.
MOTIFS = [
    ('clé privée (SSH, TLS, PGP)', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
    ('jeton GitHub', re.compile(r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b')),
    ('jeton GitHub (fine-grained)', re.compile(r'\bgithub_pat_[A-Za-z0-9_]{50,}\b')),
    ('clé AWS', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('clé Google API', re.compile(r'\bAIza[0-9A-Za-z_\-]{35}\b')),
    ('jeton Slack', re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{10,}')),
    ('clé Stripe', re.compile(r'\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b')),
    ('clé Supabase de service', re.compile(r'\b(?:sbp|sb_secret)_[A-Za-z0-9_\-]{20,}\b')),
    ('jeton JWT', re.compile(r'\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}')),
    ('jeton Cloudflare probable', re.compile(
        r'(?i)(?:cloudflare|cf[_-]?(?:api|zone|dns)|zone_dns_token)[^\n]{0,40}'
        r'[\'"\s:=]([A-Za-z0-9_\-]{35,})')),
    ('mot de passe en clair', re.compile(
        r'(?i)\b(?:password|passwd|motdepasse|mot_de_passe|secret|api[_-]?key|token)\b'
        r'\s*[:=]\s*[\'"][^\'"\n]{8,}[\'"]')),
    ('en-tête d\'autorisation', re.compile(r'(?i)authorization\s*:\s*(?:bearer|basic)\s+\S{12,}')),
    ('adresse d\'administration privée', re.compile(r'\b192\.168\.\d{1,3}\.\d{1,3}\b')),
    ('identifiant de connexion base de données', re.compile(
        r'(?i)\b(?:postgres|mysql|mongodb)(?:\+srv)?://[^\s:@]+:[^\s@]+@')),
]

# Ce qui est manifestement inoffensif : exemples, gabarits, motifs de détection.
INNOCENT = re.compile(
    r'(?i)(exemple|example|fictif|remplacer|votre[-_ ]|xxx+|<[a-z_]+>|\.\.\.|placeholder)')

# Fichiers dont le contenu binaire ou volumineux n'a pas à être analysé ligne
# à ligne — ils sont de toute façon exclus de la publication.
IGNORES = re.compile(r'(?:^|/)(?:node_modules|\.git|data|public/geo)/|'
                     r'\.(?:png|jpg|jpeg|webp|ico|woff2?|otf|ttf|pdf|gz|zip)$')


def analyser(texte, origine, resultats):
    for libelle, motif in MOTIFS:
        for trouve in motif.finditer(texte):
            debut = max(0, trouve.start() - 60)
            contexte = texte[debut:trouve.end() + 30]
            if INNOCENT.search(contexte):
                continue
            # On enregistre le type et l'endroit. Jamais la valeur.
            resultats.append((libelle, origine, trouve.start()))
            break                                    # une alerte par type et par fichier


def git(*args):
    return subprocess.run(['git', *args], cwd=RACINE, capture_output=True, text=True).stdout


def etat_courant(resultats):
    suivis = [f for f in git('ls-files').splitlines() if f]
    non_suivis = [f for f in git('ls-files', '--others', '--exclude-standard').splitlines() if f]
    for fichier in suivis + non_suivis:
        if IGNORES.search(fichier):
            continue
        chemin = RACINE / fichier
        try:
            texte = chemin.read_text(encoding='utf-8', errors='ignore')
        except (OSError, UnicodeDecodeError):
            continue
        portee = 'suivi' if fichier in suivis else 'non suivi'
        analyser(texte, f'{fichier} [{portee}]', resultats)
    return len(suivis), len(non_suivis)


def historique(resultats):
    """Parcourt chaque version de chaque fichier ayant existé dans le dépôt."""
    objets = git('rev-list', '--objects', '--all').splitlines()
    examines = 0
    for ligne in objets:
        parties = ligne.split(' ', 1)
        if len(parties) != 2:
            continue
        empreinte, nom = parties
        if IGNORES.search(nom):
            continue
        contenu = subprocess.run(['git', 'cat-file', '-p', empreinte],
                                 cwd=RACINE, capture_output=True)
        if contenu.returncode != 0:
            continue
        examines += 1
        analyser(contenu.stdout.decode('utf-8', errors='ignore'),
                 f'{nom} [historique]', resultats)
    return examines


if __name__ == '__main__':
    avec_historique = '--historique' in sys.argv
    resultats = []

    print('— État courant')
    suivis, non_suivis = etat_courant(resultats)
    print(f'  {suivis} fichiers suivis, {non_suivis} non suivis analysés')

    if avec_historique:
        print('— Historique Git complet')
        n = historique(resultats)
        print(f'  {n} objets analysés sur {len(git("rev-list", "--all").splitlines())} commits')

    print()
    if not resultats:
        print('Aucun secret détecté.')
        sys.exit(0)

    print(f'{len(resultats)} point(s) à examiner — valeurs volontairement non affichées :')
    vus = set()
    for libelle, origine, _ in resultats:
        cle = (libelle, origine)
        if cle in vus:
            continue
        vus.add(cle)
        print(f'  · {libelle} — {origine}')
    sys.exit(1)
