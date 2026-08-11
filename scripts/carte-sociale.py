#!/usr/bin/env python3
"""
Génère les cartes sociales d'un système, à partir de données réellement datées.

Appelé par le serveur avec un JSON sur l'entrée standard. Écrit trois PNG et
répond un JSON décrivant ce qui a été produit.

    echo '{...}' | python3 scripts/carte-sociale.py

Règles tenues ici, comme dans le reste de l'application :
  - aucune valeur n'est inventée ; une donnée absente est écrite « non publiée » ;
  - la probabilité officielle du NHC est affichée avant l'analyse KDL, et
    l'analyse KDL est toujours étiquetée comme indicative ;
  - une donnée ancienne est signalée sur l'image elle-même.

La police est embarquée dans le dépôt (Inter, OFL-1.1) : le rendu est identique
sur le poste de travail et sur le serveur, sans dépendre des polices système.
"""

import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print(json.dumps({'ok': False, 'erreur': 'Pillow indisponible'}))
    sys.exit(0)

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLICES = os.path.join(RACINE, 'assets', 'fonts')
LOGO = '/home/skyme/KDL_BRAND/assets/KDL_TECH_LOGO_OFFICIEL_TRANSPARENT_V1.png'
LOGO_PROJET = os.path.join(RACINE, 'public', 'icons', 'logo-96.png')

BLEU = (31, 82, 120)
BLEU_PROFOND = (6, 26, 42)
CYAN = (53, 198, 239)
BLANC = (233, 242, 249)
GRIS = (154, 181, 203)
GRIS_SOMBRE = (110, 140, 165)
# Couleur de puce neutre, déjà mélangée au fond : une image RGB ignore l'alpha.
ARDOISE = (46, 78, 104)
AMBRE = (240, 182, 92)
ROUGE = (240, 112, 95)
VERT = (76, 195, 138)


def police(taille, graisse='Bold'):
    """Police embarquée. Son absence est une erreur franche, pas un repli muet."""
    chemin = os.path.join(POLICES, f'Inter-{graisse}.otf')
    if not os.path.exists(chemin):
        raise FileNotFoundError(f'police manquante : {chemin}')
    return ImageFont.truetype(chemin, taille)


def fond(largeur, hauteur):
    img = Image.new('RGB', (largeur, hauteur), BLEU_PROFOND)
    px = img.load()
    for y in range(hauteur):
        t = y / max(hauteur - 1, 1)
        c = tuple(int(BLEU[i] * (1 - t) ** 1.5 + BLEU_PROFOND[i] * (1 - (1 - t) ** 1.5))
                  for i in range(3))
        for x in range(largeur):
            px[x, y] = c

    halo = Image.new('RGBA', (largeur, hauteur), (0, 0, 0, 0))
    d = ImageDraw.Draw(halo)
    r = int(min(largeur, hauteur) * 0.8)
    cx, cy = int(largeur * 0.85), int(-hauteur * 0.1)
    for i in range(26, 0, -1):
        rayon = int(r * i / 26)
        d.ellipse([cx - rayon, cy - rayon, cx + rayon, cy + rayon],
                  fill=CYAN + (int(42 * (1 - i / 26) ** 1.7),))
    return Image.alpha_composite(img.convert('RGBA'), halo).convert('RGB')


def cadran(taille, epaisseur=3):
    import math
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = taille // 2
    for i, f in enumerate((0.30, 0.52, 0.74, 0.96)):
        r = int(c * f)
        d.ellipse([c - r, c - r, c + r, c + r], outline=CYAN + (66 - i * 12,), width=epaisseur)
    for angle in (0, 90, 180, 270):
        a = math.radians(angle - 90)
        d.line([c, c, c + math.cos(a) * c * 0.96, c + math.sin(a) * c * 0.96],
               fill=CYAN + (38,), width=epaisseur)
    d.ellipse([c - 8, c - 8, c + 8, c + 8], fill=CYAN + (230,))
    return img


def logo_pastille(taille):
    """Logo officiel KDLTech sur pastille claire : jamais recoloré, jamais déformé."""
    source = LOGO if os.path.exists(LOGO) else LOGO_PROJET
    if not os.path.exists(source):
        return None
    pastille = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(pastille)
    d.rounded_rectangle([0, 0, taille - 1, taille - 1],
                        radius=int(taille * 0.26), fill=(240, 246, 250, 255))
    interieur = int(taille * 0.68)
    l = Image.open(source).convert('RGBA').resize((interieur, interieur), Image.LANCZOS)
    pastille.paste(l, ((taille - interieur) // 2, (taille - interieur) // 2), l)
    return pastille


def txt(d, xy, contenu, fonte, couleur, ancre='la'):
    d.text(xy, contenu, font=fonte, fill=couleur, anchor=ancre)


def puce(d, xy, texte, couleur_texte, couleur_fond, fonte, marge=(14, 7)):
    """Étiquette arrondie. Retourne sa largeur, pour enchaîner les puces."""
    x, y = xy
    boite = d.textbbox((0, 0), texte, font=fonte)
    l = boite[2] - boite[0] + marge[0] * 2
    h = boite[3] - boite[1] + marge[1] * 2
    d.rounded_rectangle([x, y, x + l, y + h], radius=h // 2, fill=couleur_fond)
    d.text((x + marge[0], y + marge[1] - boite[1]), texte, font=fonte, fill=couleur_texte)
    return l


def couper(texte, fonte, largeur_max, d, max_lignes=3):
    mots = texte.split()
    lignes, courante = [], ''
    for mot in mots:
        essai = (courante + ' ' + mot).strip()
        if d.textlength(essai, font=fonte) <= largeur_max:
            courante = essai
        else:
            if courante:
                lignes.append(courante)
            courante = mot
            if len(lignes) == max_lignes:
                break
    if courante and len(lignes) < max_lignes:
        lignes.append(courante)
    return lignes


def bloc_donnees(s):
    """Prépare les chaînes affichables. Rien n'est inventé ni arrondi au hasard."""
    prob48 = f"{s['prob48h']} %" if isinstance(s.get('prob48h'), (int, float)) else 'non publiée'
    prob7j = f"{s['prob7j']} %" if isinstance(s.get('prob7j'), (int, float)) else 'non publiée'
    distance = (f"{s['distanceKm']:,} km".replace(',', ' ')
                if isinstance(s.get('distanceKm'), (int, float)) else 'non calculable')
    potentiel = (f"{s['potentiel']}/100"
                 if isinstance(s.get('potentiel'), (int, float)) else '—')
    return prob48, prob7j, distance, potentiel


def tendance_texte(s):
    t = s.get('tendance')
    if not t or not isinstance(t.get('delta'), (int, float)) or t['delta'] == 0:
        return None, GRIS
    fleche = '▲' if t['delta'] > 0 else '▼'
    couleur = AMBRE if t['delta'] > 0 else VERT
    return f"{fleche} {abs(t['delta'])} pts depuis le bulletin précédent", couleur


# ------------------------------------------------------------------ formats

def horizontal(s, sortie):
    """1200 × 630 — aperçu de lien Facebook, LinkedIn, X, WhatsApp, Telegram."""
    L, H = 1200, 630
    img = fond(L, H)
    c = cadran(430)
    img.paste(c, (L - 400, 90), c)
    d = ImageDraw.Draw(img)

    lg = logo_pastille(64)
    if lg:
        img.paste(lg, (64, 54), lg)
    txt(d, (146, 62), 'KDL Cyclone', police(27, 'Bold'), BLANC)
    txt(d, (146, 94), 'Veille Antilles · KDLTech', police(19, 'Regular'), GRIS_SOMBRE)

    x = 64
    x += puce(d, (x, 152), 'BÊTA PUBLIQUE', (26, 20, 6), AMBRE, police(15, 'Bold')) + 10
    puce(d, (x, 152), s.get('classification', 'Système suivi').upper(),
         BLANC, ARDOISE, police(15, 'SemiBold'))

    nom = s.get('nom') or s.get('designation') or 'Système'
    lignes = couper(nom, police(64, 'Bold'), 660, d, 2)
    y = 208
    for ligne in lignes:
        txt(d, (64, y), ligne, police(64, 'Bold'), BLANC)
        y += 72

    prob48, prob7j, distance, potentiel = bloc_donnees(s)

    y = max(y + 14, 330)
    colonnes = [
        ('NHC — 48 HEURES', prob48, CYAN),
        ('NHC — 7 JOURS', prob7j, CYAN),
        ('DISTANCE GUADELOUPE', distance, BLANC),
        ('POTENTIEL KDL (INDICATIF)', potentiel, AMBRE),
    ]
    cx = 64
    for titre, valeur, couleur in colonnes:
        txt(d, (cx, y), titre, police(14, 'SemiBold'), GRIS_SOMBRE)
        txt(d, (cx, y + 22), valeur, police(34, 'Bold'), couleur)
        cx += 268

    tend, couleur_tend = tendance_texte(s)
    if tend:
        txt(d, (64, y + 76), tend, police(19, 'SemiBold'), couleur_tend)

    # Bas de carte : source, heure, et avertissement d'ancienneté s'il y a lieu.
    d.line([64, H - 92, L - 64, H - 92], fill=(52, 84, 110), width=1)
    source = f"{s.get('source', 'NHC')} — bulletin de {s.get('heureLocale', 'heure inconnue')}, heure de Guadeloupe"
    txt(d, (64, H - 74), source, police(19, 'Regular'), GRIS)

    if s.get('ancienne'):
        puce(d, (64, H - 44), 'DONNÉES ANCIENNES — VÉRIFIEZ AUPRÈS DU NHC ET DE MÉTÉO-FRANCE',
             (30, 12, 10), ROUGE, police(14, 'Bold'))
    else:
        txt(d, (64, H - 42), 'Service gratuit KDLTech · cyclone.kdl-tech.fr',
            police(17, 'Regular'), GRIS_SOMBRE)
    return img


def carre(s, sortie):
    """1080 × 1080 — publication Facebook, Instagram, LinkedIn."""
    T = 1080
    img = fond(T, T)
    c = cadran(660)
    img.paste(c, ((T - 660) // 2, 300), c)
    d = ImageDraw.Draw(img)

    lg = logo_pastille(58)
    if lg:
        img.paste(lg, (72, 66), lg)
    txt(d, (146, 74), 'KDL Cyclone', police(26, 'Bold'), BLANC)
    txt(d, (146, 105), 'Veille Antilles · KDLTech', police(18, 'Regular'), GRIS_SOMBRE)
    puce(d, (T - 240, 74), 'BÊTA PUBLIQUE', (26, 20, 6), AMBRE, police(15, 'Bold'))

    nom = s.get('nom') or s.get('designation') or 'Système'
    lignes = couper(nom, police(66, 'Bold'), 940, d, 2)
    y = 176
    for ligne in lignes:
        txt(d, (T // 2, y), ligne, police(66, 'Bold'), BLANC, ancre='ma')
        y += 76
    txt(d, (T // 2, y + 6), s.get('classification', ''), police(28, 'Medium' if os.path.exists(
        os.path.join(POLICES, 'Inter-Medium.otf')) else 'Regular'), CYAN, ancre='ma')

    prob48, prob7j, distance, potentiel = bloc_donnees(s)
    paires = [
        ('NHC — 48 HEURES', prob48, CYAN),
        ('NHC — 7 JOURS', prob7j, CYAN),
        ('DISTANCE GUADELOUPE', distance, BLANC),
        ('POTENTIEL KDL (INDICATIF)', potentiel, AMBRE),
    ]
    y0 = 700
    for i, (titre, valeur, couleur) in enumerate(paires):
        cx = 96 + (i % 2) * 470
        cy = y0 + (i // 2) * 116
        txt(d, (cx, cy), titre, police(16, 'SemiBold'), GRIS_SOMBRE)
        txt(d, (cx, cy + 24), valeur, police(40, 'Bold'), couleur)

    tend, couleur_tend = tendance_texte(s)
    if tend:
        txt(d, (T // 2, 946), tend, police(21, 'SemiBold'), couleur_tend, ancre='ma')

    source = f"{s.get('source', 'NHC')} — {s.get('heureLocale', 'heure inconnue')} (Guadeloupe)"
    txt(d, (T // 2, 998), source, police(19, 'Regular'), GRIS, ancre='ma')
    if s.get('ancienne'):
        puce(d, (T // 2 - 250, 1030), 'DONNÉES ANCIENNES — VÉRIFIEZ LES SOURCES OFFICIELLES',
             (30, 12, 10), ROUGE, police(13, 'Bold'))
    else:
        txt(d, (T // 2, 1032), 'Service gratuit KDLTech · cyclone.kdl-tech.fr',
            police(18, 'Regular'), GRIS_SOMBRE, ancre='ma')
    return img


def vertical(s, sortie):
    """1080 × 1920 — TikTok, Stories, WhatsApp Status."""
    L, H = 1080, 1920
    img = fond(L, H)
    c = cadran(880)
    img.paste(c, ((L - 880) // 2, 700), c)
    d = ImageDraw.Draw(img)

    lg = logo_pastille(76)
    if lg:
        img.paste(lg, (L // 2 - 38, 190), lg)
    txt(d, (L // 2, 300), 'KDL Cyclone', police(34, 'Bold'), BLANC, ancre='ma')
    txt(d, (L // 2, 344), 'Veille Antilles · KDLTech', police(22, 'Regular'), GRIS_SOMBRE, ancre='ma')
    puce(d, (L // 2 - 105, 400), 'BÊTA PUBLIQUE', (26, 20, 6), AMBRE, police(17, 'Bold'))

    nom = s.get('nom') or s.get('designation') or 'Système'
    lignes = couper(nom, police(78, 'Bold'), 900, d, 2)
    y = 500
    for ligne in lignes:
        txt(d, (L // 2, y), ligne, police(78, 'Bold'), BLANC, ancre='ma')
        y += 88
    txt(d, (L // 2, y + 8), s.get('classification', ''), police(30, 'Regular'), CYAN, ancre='ma')

    prob48, prob7j, distance, potentiel = bloc_donnees(s)
    entrees = [
        ('Probabilité NHC à 48 heures', prob48, CYAN),
        ('Probabilité NHC à 7 jours', prob7j, CYAN),
        ('Distance de la Guadeloupe', distance, BLANC),
        ('Potentiel KDL (indicatif)', potentiel, AMBRE),
    ]
    y = 1240
    for titre, valeur, couleur in entrees:
        txt(d, (110, y), titre, police(24, 'Regular'), GRIS)
        txt(d, (L - 110, y - 6), valeur, police(38, 'Bold'), couleur, ancre='ra')
        d.line([110, y + 52, L - 110, y + 52], fill=(48, 80, 106), width=1)
        y += 96

    tend, couleur_tend = tendance_texte(s)
    if tend:
        txt(d, (L // 2, y + 12), tend, police(24, 'SemiBold'), couleur_tend, ancre='ma')

    source = f"{s.get('source', 'NHC')} — {s.get('heureLocale', 'heure inconnue')} (Guadeloupe)"
    txt(d, (L // 2, 1740), source, police(23, 'Regular'), GRIS, ancre='ma')
    if s.get('ancienne'):
        puce(d, (L // 2 - 300, 1786), 'DONNÉES ANCIENNES — VÉRIFIEZ LES SOURCES OFFICIELLES',
             (30, 12, 10), ROUGE, police(16, 'Bold'))

    txt(d, (L // 2, 1846), 'cyclone.kdl-tech.fr', police(30, 'Bold'), BLANC, ancre='ma')
    txt(d, (L // 2, 1886), 'Service gratuit KDLTech', police(21, 'Regular'), GRIS_SOMBRE, ancre='ma')
    return img


FORMATS = {'horizontal': horizontal, 'carre': carre, 'vertical': vertical}


def main():
    try:
        entree = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({'ok': False, 'erreur': f'entrée illisible : {e}'}))
        return

    systeme = entree.get('systeme') or {}
    dossier = entree.get('dossier')
    prefixe = entree.get('prefixe', 'carte')
    if not dossier:
        print(json.dumps({'ok': False, 'erreur': 'dossier de sortie manquant'}))
        return

    os.makedirs(dossier, exist_ok=True)
    produits = {}
    try:
        for nom, fabrique in FORMATS.items():
            chemin = os.path.join(dossier, f'{prefixe}-{nom}.png')
            image = fabrique(systeme, chemin)
            image.save(chemin, optimize=True)
            produits[nom] = {'fichier': os.path.basename(chemin),
                             'octets': os.path.getsize(chemin)}
    except FileNotFoundError as e:
        print(json.dumps({'ok': False, 'erreur': str(e)}))
        return
    except Exception as e:
        print(json.dumps({'ok': False, 'erreur': f'{type(e).__name__}: {e}'}))
        return

    print(json.dumps({'ok': True, 'formats': produits}))


if __name__ == '__main__':
    main()
