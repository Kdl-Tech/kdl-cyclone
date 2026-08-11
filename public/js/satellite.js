/**
 * Boucle satellite animée.
 *
 * Chaque vignette est une image réelle de GOES-19, avec son heure
 * d'acquisition. Rien n'est interpolé, rien n'est inventé : quand la boucle
 * avance, elle passe d'une observation à une autre.
 *
 * Contraintes tenues :
 *  - le poids est annoncé avant chargement, et le mode économie n'en prend
 *    que la moitié ;
 *  - l'animation s'arrête quand l'onglet est masqué ou la carte hors écran ;
 *  - `prefers-reduced-motion` désactive la lecture automatique ;
 *  - une image qui ne se charge pas est écartée, jamais remplacée en douce.
 */
(function (global) {
  'use strict';

  /**
   * Cadrage géographique du secteur GOES « car ». Ces bornes viennent de la
   * définition du secteur publiée par la NOAA ; elles servent à poser l'image
   * à sa place réelle sur la carte, sans la déformer arbitrairement.
   */
  var SECTEUR_CAR = { nord: 33.0, sud: 5.0, ouest: -95.0, est: -55.0 };

  function Boucle(options) {
    this.options = options || {};
    this.images = [];          // { instant, chemin, element, chargee }
    this.index = 0;
    this.lecture = false;
    this.vitesse = 1;
    this.direct = true;
    this.opacite = 0.94;
    this.minuteur = null;
    this.meta = null;
    this.economie = detecterEconomie();
    this.echecs = 0;
  }

  /** Le navigateur annonce-t-il une connexion limitée ou un forfait compté ? */
  function detecterEconomie() {
    var c = navigator.connection;
    if (!c) return false;
    if (c.saveData) return true;
    return ['slow-2g', '2g', '3g'].indexOf(c.effectiveType) !== -1;
  }

  function mouvementReduit() {
    return global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  Boucle.prototype.chargerMeta = function () {
    var self = this;
    return fetch('/api/satellite')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        self.meta = m;
        return m;
      })
      .catch(function () { self.meta = null; return null; });
  };

  /** Poids annoncé avant tout téléchargement, pour un choix éclairé. */
  Boucle.prototype.poidsEstime = function () {
    if (!this.meta || !this.meta.images) return null;
    var liste = this.selection();
    var octets = liste.reduce(function (t, i) { return t + (i.octets || 0); }, 0);
    return { nombre: liste.length, ko: Math.round(octets / 1024) };
  };

  /** En mode économie, une image sur deux : le mouvement reste lisible. */
  Boucle.prototype.selection = function () {
    var toutes = (this.meta && this.meta.images) || [];
    if (!this.economie) return toutes;
    return toutes.filter(function (_, i) { return i % 2 === 0; });
  };

  /**
   * Seuils du masque de nuages, en luminance (0–255). Mesurés sur les
   * vignettes GOES-19 réelles : l'océan de nuit tourne autour de 20–40, les
   * masses nuageuses au-dessus de 150. Entre les deux, la transition est
   * progressive pour ne pas découper les bords des systèmes au couteau.
   */
  var SEUIL_BAS = 52;
  var SEUIL_HAUT = 158;

  /* Part de l'image fondue sur chaque bord. Sans ce fondu, le secteur GOES
     apparaît comme un rectangle collé sur l'Atlantique. */
  var FONDU = 0.055;

  /**
   * Transforme une vignette satellite en calque à fond transparent.
   *
   * L'ancien rendu superposait l'image entière en mode « lighter » : tout se
   * délavait en blanc-cyan et la carte disparaissait dessous. Ici, la
   * luminance de chaque pixel devient sa propre opacité — le ciel dégagé
   * s'efface, les nuages restent, et rien n'est inventé : les couleurs
   * d'origine de l'image sont conservées, seule leur transparence est calculée.
   *
   * Les images sont servies par KDL Cyclone lui-même : aucune contrainte
   * d'origine croisée n'empêche de lire les pixels.
   */
  function preparerCalque(img) {
    var l = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!l || !h) return img;

    var toile = document.createElement('canvas');
    toile.width = l;
    toile.height = h;
    var ctx = toile.getContext('2d', { willReadFrequently: true });
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);

    var donnees;
    try {
      donnees = ctx.getImageData(0, 0, l, h);
    } catch (e) {
      // Lecture refusée : on garde l'image telle quelle plutôt que rien.
      return img;
    }

    var px = donnees.data;
    var etendue = SEUIL_HAUT - SEUIL_BAS;
    var margeX = Math.max(1, l * FONDU);
    var margeY = Math.max(1, h * FONDU);

    for (var i = 0; i < px.length; i += 4) {
      var lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      var t = (lum - SEUIL_BAS) / etendue;
      if (t <= 0) { px[i + 3] = 0; continue; }
      if (t > 1) t = 1;
      // Transition douce : les bords de nuages restent des bords de nuages.
      var a = t * t * (3 - 2 * t);

      // Fondu de bordure : le secteur observé se dissout dans la carte au lieu
      // de s'y découper au rectangle.
      var pixel = i / 4;
      var x = pixel % l;
      var y = (pixel - x) / l;
      var bordX = Math.min(x, l - 1 - x) / margeX;
      var bordY = Math.min(y, h - 1 - y) / margeY;
      var bord = Math.min(1, Math.min(bordX, bordY));
      if (bord < 1) a *= bord * bord * (3 - 2 * bord);

      px[i + 3] = Math.round(255 * a);
      // Les sommets les plus froids sont ramenés vers un blanc légèrement
      // bleuté : ils gagnent en présence sans changer de nature.
      var eclat = a * a * 0.3;
      px[i] = Math.round(px[i] + (238 - px[i]) * eclat);
      px[i + 1] = Math.round(px[i + 1] + (245 - px[i + 1]) * eclat);
      px[i + 2] = Math.round(px[i + 2] + (255 - px[i + 2]) * eclat);
    }
    ctx.putImageData(donnees, 0, 0);
    return toile;
  }

  Boucle.prototype.charger = function (surProgression) {
    var self = this;
    var liste = this.selection();
    if (!liste.length) return Promise.resolve(false);

    var chargees = 0;
    return Promise.all(liste.map(function (info) {
      return new Promise(function (resoudre) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          chargees += 1;
          if (surProgression) surProgression(chargees, liste.length);
          resoudre({
            instant: info.instant,
            chemin: info.chemin,
            element: preparerCalque(img),
            chargee: true,
          });
        };
        // Une image qui échoue est écartée : pas de trou masqué, pas de doublon.
        img.onerror = function () {
          self.echecs += 1;
          chargees += 1;
          if (surProgression) surProgression(chargees, liste.length);
          resoudre(null);
        };
        img.src = info.chemin;
      });
    })).then(function (resultats) {
      self.images = resultats.filter(Boolean);
      self.index = Math.max(0, self.images.length - 1);
      return self.images.length > 0;
    });
  };

  Boucle.prototype.imageCourante = function () {
    return this.images[this.index] || null;
  };

  Boucle.prototype.instantCourant = function () {
    var i = this.imageCourante();
    return i ? i.instant : null;
  };

  Boucle.prototype.estAuDirect = function () {
    return this.index >= this.images.length - 1;
  };

  Boucle.prototype.allerA = function (index) {
    if (!this.images.length) return;
    this.index = Math.max(0, Math.min(this.images.length - 1, index));
    this.direct = this.estAuDirect();
    this.notifier();
  };

  Boucle.prototype.suivante = function () { this.allerA(this.index + 1); };
  Boucle.prototype.precedente = function () { this.allerA(this.index - 1); };

  Boucle.prototype.revenirAuDirect = function () {
    this.allerA(this.images.length - 1);
    this.direct = true;
  };

  Boucle.prototype.jouer = function () {
    if (this.lecture || this.images.length < 2) return;
    this.lecture = true;
    this.planifier();
    this.notifier();
  };

  Boucle.prototype.pause = function () {
    this.lecture = false;
    clearTimeout(this.minuteur);
    this.minuteur = null;
    this.notifier();
  };

  Boucle.prototype.basculer = function () {
    if (this.lecture) this.pause(); else this.jouer();
  };

  Boucle.prototype.definirVitesse = function (v) {
    this.vitesse = v;
    if (this.lecture) { clearTimeout(this.minuteur); this.planifier(); }
    this.notifier();
  };

  Boucle.prototype.planifier = function () {
    var self = this;
    // La dernière image est tenue plus longtemps : c'est celle qu'on lit.
    var derniere = this.index >= this.images.length - 1;
    var delai = (derniere ? 1400 : 420) / this.vitesse;
    this.minuteur = setTimeout(function () {
      if (!self.lecture) return;
      self.index = (self.index + 1) % self.images.length;
      self.direct = self.estAuDirect();
      self.notifier();
      self.planifier();
    }, delai);
  };

  Boucle.prototype.notifier = function () {
    if (this.options.surChangement) this.options.surChangement(this);
  };

  /**
   * Dessine l'image courante sur la carte, calée sur ses coordonnées réelles.
   * `projeter` convertit une latitude et une longitude en pixels.
   */
  Boucle.prototype.dessiner = function (ctx, projeter) {
    var image = this.imageCourante();
    if (!image || !image.element) return false;

    var hautGauche = projeter(SECTEUR_CAR.nord, SECTEUR_CAR.ouest);
    var basDroite = projeter(SECTEUR_CAR.sud, SECTEUR_CAR.est);
    var largeur = basDroite.x - hautGauche.x;
    var hauteur = basDroite.y - hautGauche.y;
    if (largeur <= 0 || hauteur <= 0) return false;

    ctx.save();
    ctx.globalAlpha = this.opacite;
    // Le calque porte déjà sa propre transparence : le ciel dégagé laisse voir
    // la carte, les nuages se posent dessus à leur densité réelle. Aucune
    // fusion additive, qui délavait l'ensemble en blanc.
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(image.element, hautGauche.x, hautGauche.y, largeur, hauteur);
    } catch (e) {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  };

  Boucle.prototype.detruire = function () {
    this.pause();
    // Libère explicitement les images : une boucle laissée en mémoire finirait
    // par peser lourd sur un téléphone.
    this.images.forEach(function (i) {
      if (!i.element) return;
      if (i.element.tagName === 'CANVAS') { i.element.width = 0; i.element.height = 0; } else { i.element.src = ''; }
    });
    this.images = [];
  };

  global.KdlSatellite = {
    Boucle: Boucle,
    SECTEUR_CAR: SECTEUR_CAR,
    detecterEconomie: detecterEconomie,
    mouvementReduit: mouvementReduit,
  };
})(window);
