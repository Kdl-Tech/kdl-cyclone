#!/usr/bin/env python3
"""
Construit le kit de communication de KDL Cyclone.

Tous les visuels sont produits localement, à partir du logo officiel KDLTech
(jamais recréé ni recoloré, seulement redimensionné et placé) et du bleu
officiel #1F5278. Aucune image de banque, aucun service en ligne, aucun droit
incertain.

    python3 scripts/build-media-kit.py
"""

import os
import shutil
from PIL import Image, ImageDraw, ImageFont

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(RACINE, 'media-kit')
VISUELS = os.path.join(KIT, 'visuels')
LOGO_KDL = '/home/skyme/KDL_BRAND/assets/KDL_TECH_LOGO_OFFICIEL_TRANSPARENT_V1.png'

# Palette officielle — identique aux jetons de l'application.
BLEU = (31, 82, 120)
BLEU_PROFOND = (6, 26, 42)
BLEU_NUIT = (5, 19, 31)
CYAN = (53, 198, 239)
BLANC = (233, 242, 249)
GRIS = (154, 181, 203)

INTER = '/usr/share/fonts/opentype/inter'
DEJAVU = '/usr/share/fonts/truetype/dejavu'


def police(taille, graisse='Bold'):
    """Inter si disponible (police du KDL Design System), DejaVu en secours."""
    for chemin in (
        os.path.join(INTER, f'Inter-{graisse}.otf'),
        os.path.join(INTER, 'Inter-Regular.otf'),
        os.path.join(DEJAVU, 'DejaVuSans-Bold.ttf' if graisse != 'Regular' else 'DejaVuSans.ttf'),
    ):
        if os.path.exists(chemin):
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


def fond_ocean(largeur, hauteur):
    """Dégradé bleu nuit océanique, vertical, avec un halo cyan discret."""
    img = Image.new('RGB', (largeur, hauteur), BLEU_NUIT)
    px = img.load()
    for y in range(hauteur):
        t = y / max(hauteur - 1, 1)
        # Du bleu KDL en haut vers le bleu profond en bas.
        c = tuple(int(BLEU[i] * (1 - t) ** 1.5 + BLEU_PROFOND[i] * (1 - (1 - t) ** 1.5)) for i in range(3))
        for x in range(largeur):
            px[x, y] = c

    halo = Image.new('RGBA', (largeur, hauteur), (0, 0, 0, 0))
    d = ImageDraw.Draw(halo)
    r = int(min(largeur, hauteur) * 0.75)
    cx, cy = int(largeur * 0.82), int(-hauteur * 0.15)
    for i in range(28, 0, -1):
        rayon = int(r * i / 28)
        alpha = int(46 * (1 - i / 28) ** 1.7)
        d.ellipse([cx - rayon, cy - rayon, cx + rayon, cy + rayon], fill=CYAN + (alpha,))
    return Image.alpha_composite(img.convert('RGBA'), halo).convert('RGB')


def cadran(taille, epaisseur=3):
    """Motif signature : le cadran de relèvement, en filigrane."""
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = taille // 2
    for i, fraction in enumerate((0.30, 0.52, 0.74, 0.96)):
        r = int(c * fraction)
        alpha = 70 - i * 12
        d.ellipse([c - r, c - r, c + r, c + r], outline=CYAN + (alpha,), width=epaisseur)
    for angle in (0, 90, 180, 270):
        import math
        a = math.radians(angle - 90)
        d.line([c, c, c + math.cos(a) * c * 0.96, c + math.sin(a) * c * 0.96],
               fill=CYAN + (40,), width=epaisseur)
    # Le point de repère : la Guadeloupe, au centre.
    d.ellipse([c - 9, c - 9, c + 9, c + 9], fill=CYAN + (230,))
    return img


def logo(taille):
    return Image.open(LOGO_KDL).convert('RGBA').resize((taille, taille), Image.LANCZOS)


def logo_sur_pastille(taille, marge=0.16):
    """
    Le logo officiel est sombre : sur un fond bleu nuit, il se perd. On le pose
    donc sur une pastille claire. Le logo lui-même n'est ni recoloré, ni déformé,
    ni recadré — seul un fond est ajouté derrière lui.
    """
    pastille = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(pastille)
    rayon = int(taille * 0.26)
    d.rounded_rectangle([0, 0, taille - 1, taille - 1], radius=rayon, fill=(240, 246, 250, 255))
    interieur = int(taille * (1 - 2 * marge))
    l = logo(interieur)
    decalage = (taille - interieur) // 2
    pastille.paste(l, (decalage, decalage), l)
    return pastille


def texte(d, xy, contenu, fonte, couleur, ancre='la', espacement=None):
    d.text(xy, contenu, font=fonte, fill=couleur, anchor=ancre,
           **({'spacing': espacement} if espacement else {}))


# --------------------------------------------------------------- les visuels

def banniere_og():
    """1200 × 630 — aperçu Facebook, WhatsApp, LinkedIn, X, Telegram."""
    L, H = 1200, 630
    img = fond_ocean(L, H)
    img.paste(cadran(520), (L - 470, 60), cadran(520))

    d = ImageDraw.Draw(img)
    l = logo_sur_pastille(80)
    img.paste(l, (76, 66), l)
    texte(d, (168, 78), 'KDLTech', police(26, 'SemiBold'), GRIS)
    texte(d, (168, 110), 'Guadeloupe', police(20, 'Regular'), (110, 140, 165))

    texte(d, (76, 218), 'KDL Cyclone', police(86, 'Bold'), BLANC)
    texte(d, (76, 322), 'Veille tropicale pour la Guadeloupe', police(34, 'Medium'), CYAN)
    texte(d, (76, 368), 'et les Petites Antilles', police(34, 'Medium'), CYAN)
    texte(d, (76, 448), 'Comprendre tôt. Se préparer calmement.', police(28, 'Regular'), GRIS)

    d.line([76, 528, 300, 528], fill=CYAN + (255,), width=3)
    texte(d, (76, 552), 'Un service gratuit KDLTech · cyclone.kdl-tech.fr',
          police(23, 'Regular'), (140, 172, 196))
    return img, 'og-kdl-cyclone.png'


def banniere_large():
    """1500 × 500 — bandeau de page Facebook ou LinkedIn."""
    L, H = 1500, 500
    img = fond_ocean(L, H)
    img.paste(cadran(430), (L - 400, 35), cadran(430))
    d = ImageDraw.Draw(img)
    l = logo_sur_pastille(68)
    img.paste(l, (90, 60), l)
    texte(d, (172, 76), 'KDLTech · Guadeloupe', police(24, 'SemiBold'), GRIS)
    texte(d, (90, 186), 'KDL Cyclone', police(80, 'Bold'), BLANC)
    texte(d, (90, 288), 'Suivi des ondes tropicales et cyclones aux Antilles',
          police(31, 'Medium'), CYAN)
    texte(d, (90, 386), 'Gratuit · sans publicité · fonctionne hors connexion',
          police(25, 'Regular'), (140, 172, 196))
    return img, 'banniere-1500x500.png'


def carre_facebook():
    """1080 × 1080 — publication Facebook et Instagram."""
    T = 1080
    img = fond_ocean(T, T)
    c = cadran(760)
    img.paste(c, ((T - 760) // 2, 130), c)

    d = ImageDraw.Draw(img)
    texte(d, (T // 2, 118), 'KDL CYCLONE', police(58, 'Bold'), BLANC, ancre='mm')
    texte(d, (T // 2, 800), 'Veille tropicale', police(52, 'Medium'), CYAN, ancre='mm')
    texte(d, (T // 2, 858), 'Guadeloupe & Petites Antilles', police(36, 'Regular'), GRIS, ancre='mm')
    texte(d, (T // 2, 936), 'Comprendre tôt. Se préparer calmement.',
          police(30, 'Regular'), (140, 172, 196), ancre='mm')

    l = logo_sur_pastille(56)
    img.paste(l, (T // 2 - 152, 990), l)
    texte(d, (T // 2 - 82, 1018), 'Un service gratuit KDLTech',
          police(26, 'SemiBold'), GRIS, ancre='lm')
    return img, 'carre-1080.png'


def vertical_story():
    """1080 × 1920 — Story Instagram, Facebook, TikTok."""
    L, H = 1080, 1920
    img = fond_ocean(L, H)
    c = cadran(880)
    img.paste(c, ((L - 880) // 2, 620), c)

    d = ImageDraw.Draw(img)
    l = logo_sur_pastille(76)
    img.paste(l, (L // 2 - 38, 206), l)
    texte(d, (L // 2, 340), 'KDLTech · Guadeloupe', police(30, 'SemiBold'), GRIS, ancre='mm')

    texte(d, (L // 2, 452), 'KDL CYCLONE', police(84, 'Bold'), BLANC, ancre='mm')
    texte(d, (L // 2, 540), 'Veille tropicale aux Antilles', police(38, 'Medium'), CYAN, ancre='mm')

    lignes = [
        'Ondes tropicales suivies en direct',
        'Probabilités officielles du NHC',
        'Facteurs météo expliqués simplement',
        'Carte et préparation hors connexion',
    ]
    y = 1620
    for ligne in lignes:
        d.ellipse([148, y - 7, 162, y + 7], fill=CYAN)
        texte(d, (190, y), ligne, police(31, 'Regular'), BLANC, ancre='lm')
        y += 62

    texte(d, (L // 2, 1846), 'Gratuit · cyclone.kdl-tech.fr',
          police(30, 'SemiBold'), (140, 172, 196), ancre='mm')
    return img, 'story-1080x1920.png'


def logo_cyclone():
    """Logo de l'application : le cadran KDL Cyclone, sur fond transparent."""
    T = 512
    img = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([8, 8, T - 8, T - 8], fill=BLEU + (255,))
    c = cadran(T - 80, epaisseur=5)
    img.paste(c, (40, 40), c)
    l = logo_sur_pastille(164)
    img.paste(l, ((T - 164) // 2, (T - 164) // 2 - 6), l)
    return img, 'logo-kdl-cyclone-512.png'


def main():
    os.makedirs(VISUELS, exist_ok=True)

    for fabrique in (banniere_og, banniere_large, carre_facebook, vertical_story, logo_cyclone):
        img, nom = fabrique()
        chemin = os.path.join(VISUELS, nom)
        img.save(chemin, optimize=True)
        print(f'  {nom:<28} {os.path.getsize(chemin) // 1024} Ko')

    # L'image sociale est aussi servie par l'application.
    media_public = os.path.join(RACINE, 'public', 'media')
    os.makedirs(media_public, exist_ok=True)
    shutil.copy(os.path.join(VISUELS, 'og-kdl-cyclone.png'),
                os.path.join(media_public, 'og-kdl-cyclone.png'))

    # Icônes et favicon déjà produits pour la PWA : le kit les reprend.
    icones = os.path.join(RACINE, 'public', 'icons')
    dossier_icones = os.path.join(VISUELS, 'icones-pwa')
    os.makedirs(dossier_icones, exist_ok=True)
    for nom in os.listdir(icones):
        shutil.copy(os.path.join(icones, nom), os.path.join(dossier_icones, nom))

    # Captures réelles produites par le contrôle qualité — jamais de maquette
    # inventée : ce sont de vraies captures de l'application en fonctionnement.
    captures_src = os.path.expanduser('~/Bureau/kdl-cyclone-captures')
    if os.path.isdir(captures_src):
        dossier_captures = os.path.join(VISUELS, 'captures')
        os.makedirs(dossier_captures, exist_ok=True)
        paires = [
            ('01-mobile-accueil-clair.png', 'capture-mobile-accueil.png'),
            ('06-mobile-fiche.png', 'capture-mobile-fiche.png'),
            ('11-bureau-accueil.png', 'capture-ordinateur-accueil.png'),
            ('12-bureau-carte.png', 'capture-ordinateur-carte.png'),
        ]
        for src, dst in paires:
            chemin = os.path.join(captures_src, src)
            if os.path.exists(chemin):
                shutil.copy(chemin, os.path.join(dossier_captures, dst))
                print(f'  capture reprise : {dst}')

    print(f'\nKit de communication : {KIT}')


if __name__ == '__main__':
    main()
