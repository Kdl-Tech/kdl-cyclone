/**
 * Carte de l'Atlantique tropical — canvas, projection Mercator, fond de carte
 * Natural Earth servi par KDL Cyclone.
 *
 * Aucun service cartographique en ligne : pas de coût, pas de tuiles tierces,
 * pas de position utilisateur envoyée ailleurs, et la carte reste disponible
 * hors connexion.
 *
 * Règle de lecture stricte, appliquée dans le rendu :
 *   trait plein  = donnée officielle (zone, trajectoire, cône du NHC)
 *   pointillés   = corridor indicatif calculé par KDL, jamais un cône
 */
(function (global) {
  'use strict';

  var GUADELOUPE = { lat: 16.25, lon: -61.55 };
  var VUE_DEFAUT = { centreLat: 15.5, centreLon: -50, zoom: 1 };

  /**
   * La carte est un objet d'observation, pas une surface d'interface : elle
   * reste sombre dans les deux thèmes. C'est le seul moyen d'avoir à la fois
   * un océan qui a de la matière, des terres franches et une imagerie
   * satellite lisible. Sa palette est donc autonome, jamais empruntée aux
   * variables de la page.
   */
  var CARTE = {
    // Trois bleus pour l'océan : le large en haut, la mer des Caraïbes au
    // centre, les fosses en bas. Une mer plate en aplat unique n'a jamais
    // donné envie de regarder une carte.
    oceanHaut: '#0a3a63',
    oceanMilieu: '#0d4f7a',
    oceanBas: '#052134',
    // Les terres sont chaudes : elles se détachent d'autant mieux du bleu.
    terre: '#3d4a4b',
    terreHaute: '#4d5a56',
    cote: '#a9c4c9',
    grille: 'rgba(180, 226, 244, 0.15)',
    grilleTexte: 'rgba(198, 232, 246, 0.66)',
    arc: 'rgba(53, 208, 238, 0.42)',
    encre: '#f3f9fc',
    encreDouce: 'rgba(226, 242, 249, 0.8)',
    plaque: 'rgba(5, 24, 40, 0.88)',
  };

  /* Mêmes crans que le reste de l'application, en versions lumineuses : elles
     sont lues sur l'océan de nuit, jamais sur le fond clair de la page. */
  var TEINTES = {
    n3: '#f87171',
    n2: '#fb923c',
    n1: '#fbbf24',
    veille: '#35d0ee',
    neutre: '#9fb6c4',
  };

  function mercatorY(lat) {
    var l = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + l / 2));
  }

  function Carte(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};
    this.geo = { monde: null, antilles: null, guadeloupe: null };
    this.etat = null;
    this.vue = Object.assign({}, VUE_DEFAUT);
    this.calques = {
      satellite: false,
      zones: true,
      trajectoires: true,
      corridors: true,
      cones: true,
      grille: true,
    };
    this.pointsCliquables = [];
    this.survole = null;
    this._installerInteractions();
  }

  Carte.prototype.chargerGeo = function () {
    var self = this;
    return Promise.all(
      ['monde', 'antilles', 'guadeloupe'].map(function (nom) {
        return fetch('/geo/' + nom + '.json')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { self.geo[nom] = d; })
          .catch(function () { self.geo[nom] = null; });
      }),
    );
  };

  Carte.prototype.definirEtat = function (etat) {
    this.etat = etat;
    this.dessiner();
  };

  /** Échelle en pixels par degré de longitude. */
  Carte.prototype._echelle = function () {
    var l = this.canvas.clientWidth || 600;
    return (l / 92) * this.vue.zoom; // 92° de longitude couverts au zoom 1
  };

  Carte.prototype.versEcran = function (lat, lon) {
    var k = this._echelle();
    var cx = (this.canvas.clientWidth || 600) / 2;
    var cy = (this.canvas.clientHeight || 400) / 2;
    return {
      x: cx + (lon - this.vue.centreLon) * k,
      y: cy - (mercatorY(lat) - mercatorY(this.vue.centreLat)) * k * (180 / Math.PI),
    };
  };

  Carte.prototype.versGeo = function (x, y) {
    var k = this._echelle();
    var cx = (this.canvas.clientWidth || 600) / 2;
    var cy = (this.canvas.clientHeight || 400) / 2;
    var lon = this.vue.centreLon + (x - cx) / k;
    var my = mercatorY(this.vue.centreLat) - ((y - cy) / k) * (Math.PI / 180);
    var lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;
    return { lat: lat, lon: lon };
  };

  Carte.prototype._css = function (nom) {
    return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  };

  Carte.prototype.dessiner = function () {
    var canvas = this.canvas;
    var ctx = this.ctx;
    var L = canvas.clientWidth || 600;
    var H = canvas.clientHeight || 400;
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);

    canvas.width = L * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.pointsCliquables = [];
    // Zones déjà occupées par un libellé : deux systèmes proches ne doivent
    // plus s'écrire l'un sur l'autre.
    this.etiquettesPosees = [];

    // Océan : un dégradé profond, jamais un aplat.
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, CARTE.oceanHaut);
    g.addColorStop(0.52, CARTE.oceanMilieu);
    g.addColorStop(1, CARTE.oceanBas);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, H);

    // La boucle satellite se pose sur l'océan, sous les tracés et les repères :
    // elle informe, elle ne masque pas la lecture de la carte.
    if (this.calques.satellite && this.boucle) {
      this.boucle.dessiner(ctx, this.versEcran.bind(this));
    }

    if (this.calques.grille) this._dessinerGrille(L, H);
    this._dessinerTerres();
    this._dessinerArc();

    // Le repère du territoire réserve sa place avant les systèmes.
    if (this.geo) {
      var pCentre = this.versEcran(GUADELOUPE.lat, GUADELOUPE.lon);
      var nomCentre = (this.options && this.options.nomCentre) || 'Guadeloupe';
      ctx.font = '700 11.5px ' + this._css('--police');
      this.etiquettesPosees.push({
        x: pCentre.x - ctx.measureText(nomCentre).width / 2 - 7,
        y: pCentre.y + 24, l: ctx.measureText(nomCentre).width + 14, h: 18,
      });
    }

    if (this.etat && this.etat.systemes) {
      var self = this;
      // Les couches se superposent dans l'ordre de lecture : officiel dessous,
      // estimation KDL au-dessus, marqueurs en dernier.
      if (this.calques.zones) this.etat.systemes.forEach(function (s) { self._dessinerZone(s); });
      if (this.calques.cones) this.etat.systemes.forEach(function (s) { self._dessinerCone(s); });
      if (this.calques.trajectoires) this.etat.systemes.forEach(function (s) { self._dessinerTrajectoire(s); });
      if (this.calques.corridors) this.etat.systemes.forEach(function (s) { self._dessinerCorridor(s); });
      this.etat.systemes.forEach(function (s) { self._dessinerMarqueur(s); });
    }

    this._dessinerGuadeloupe();
    this._dessinerEchelle(L, H);
  };

  Carte.prototype._dessinerGrille = function (L, H) {
    var ctx = this.ctx;
    ctx.strokeStyle = CARTE.grille;
    ctx.fillStyle = CARTE.grilleTexte;
    ctx.lineWidth = 1;
    ctx.font = '650 10.5px ' + this._css('--police');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    var pas = this.vue.zoom > 3 ? 2 : this.vue.zoom > 1.6 ? 5 : 10;
    for (var lat = -10; lat <= 50; lat += pas) {
      var p = this.versEcran(lat, this.vue.centreLon);
      if (p.y < -20 || p.y > H + 20) continue;
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(L, p.y); ctx.stroke();
      ctx.fillText(lat + '°N', 4, p.y + 2);
    }
    for (var lon = -110; lon <= 0; lon += pas) {
      var q = this.versEcran(this.vue.centreLat, lon);
      if (q.x < -20 || q.x > L + 20) continue;
      ctx.beginPath(); ctx.moveTo(q.x, 0); ctx.lineTo(q.x, H); ctx.stroke();
      ctx.fillText(Math.abs(lon) + '°O', q.x + 3, 4);
    }
  };

  Carte.prototype._dessinerTerres = function () {
    var ctx = this.ctx;
    var couches = [this.geo.monde, this.geo.antilles];
    if (this.vue.zoom > 6) couches.push(this.geo.guadeloupe);

    var self = this;
    couches.forEach(function (couche, rang) {
      if (!couche || !couche.polygones) return;
      // Les îles de l'arc sont dessinées un ton au-dessus du continent :
      // elles restent visibles même à petite taille.
      ctx.fillStyle = rang === 0 ? CARTE.terre : CARTE.terreHaute;
      ctx.strokeStyle = CARTE.cote;
      ctx.lineWidth = rang === 0 ? 1 : 1.3;
      couche.polygones.forEach(function (ring) {
        ctx.beginPath();
        for (var i = 0; i < ring.length; i += 1) {
          var p = self.versEcran(ring[i][1], ring[i][0]);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    });
  };

  /** Repère discret de l'arc antillais, pour situer la Guadeloupe dans sa chaîne. */
  Carte.prototype._dessinerArc = function () {
    if (this.vue.zoom > 4) return;
    var ctx = this.ctx;
    var arc = [
      [18.2, -63.06], [17.11, -61.85], [16.25, -61.55],
      [15.41, -61.37], [14.64, -61.02], [13.91, -60.98], [12.12, -61.67],
    ];
    ctx.beginPath();
    for (var i = 0; i < arc.length; i += 1) {
      var p = this.versEcran(arc[i][0], arc[i][1]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = CARTE.arc;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  Carte.prototype._couleurSysteme = function (s) {
    // Même échelle que la liste des systèmes : une zone classée « moyen » par
    // le NHC ne peut pas être ambre sur l'accueil et cyan sur la carte.
    var n = (s.menace && s.menace.niveau) || 'aucun';
    if (n === 'imminent') return TEINTES.n3;
    if (n === 'preparation') return TEINTES.n2;
    if (n === 'surveillance') return TEINTES.n1;
    if (s.risque7jOfficiel === 'eleve') return TEINTES.n2;
    if (s.risque7jOfficiel === 'moyen') return TEINTES.n1;
    if (typeof s.prob7j === 'number' && s.prob7j >= 60) return TEINTES.n1;
    var p = (s.potentiel && s.potentiel.score) || 0;
    return p >= 55 ? TEINTES.veille : TEINTES.neutre;
  };

  /** Zone surveillée officielle : trait plein, remplissage voilé. */
  Carte.prototype._dessinerZone = function (s) {
    if (!s.polygone || s.polygone.length < 3) return;
    var ctx = this.ctx;
    var couleur = this._couleurSysteme(s);

    ctx.beginPath();
    for (var i = 0; i < s.polygone.length; i += 1) {
      var p = this.versEcran(s.polygone[i][1], s.polygone[i][0]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    // Plus le niveau est élevé, plus la zone se détache du fond.
    var n = (s.menace && s.menace.niveau) || 'aucun';
    var poids = { imminent: 0.3, preparation: 0.24, surveillance: 0.19 }[n] || 0.12;
    ctx.fillStyle = couleur;
    ctx.globalAlpha = poids;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = couleur;
    ctx.lineWidth = poids > 0.15 ? 2.2 : 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /** Cône officiel du NHC : transporté tel quel, jamais fabriqué. */
  Carte.prototype._dessinerCone = function (s) {
    if (!s.coneOfficiel || !s.coneOfficiel.polygones) return;
    var ctx = this.ctx;
    var self = this;
    s.coneOfficiel.polygones.forEach(function (ring) {
      ctx.beginPath();
      for (var i = 0; i < ring.length; i += 1) {
        var p = self.versEcran(ring[i][1], ring[i][0]);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = TEINTES.n3;
      ctx.globalAlpha = 0.13;
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = TEINTES.n3;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  };

  /** Trajectoire publiée par le NHC : trait plein. */
  Carte.prototype._dessinerTrajectoire = function (s) {
    var t = s.trajectoireOfficielle;
    if (!t || t.length < 2) return;
    var ctx = this.ctx;
    ctx.beginPath();
    for (var i = 0; i < t.length; i += 1) {
      var p = this.versEcran(t[i][1], t[i][0]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = this._couleurSysteme(s);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  /** Corridor KDL : pointillés + halo d'incertitude. Ce n'est pas un cône. */
  Carte.prototype._dessinerCorridor = function (s) {
    var c = s.menace && s.menace.corridor;
    if (!c || c.length < 2) return;
    var ctx = this.ctx;
    var couleur = this._couleurSysteme(s);
    var self = this;

    c.forEach(function (pt) {
      if (pt.heure === 0) return;
      var centre = self.versEcran(pt.lat, pt.lon);
      // Le rayon d'incertitude est converti en pixels via un point décalé réel.
      var bord = self.versEcran(pt.lat, pt.lon + pt.rayonKm / (111.32 * Math.cos(pt.lat * Math.PI / 180)));
      var rayonPx = Math.abs(bord.x - centre.x);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, rayonPx, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.globalAlpha = 0.05;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    ctx.beginPath();
    for (var i = 0; i < c.length; i += 1) {
      var p = this.versEcran(c[i].lat, c[i].lon);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Échéances marquées : la position se lit dans le temps, pas seulement dans l'espace.
    ctx.font = '600 8.5px ' + this._css('--police');
    ctx.fillStyle = CARTE.encreDouce;
    ctx.textAlign = 'center';
    c.forEach(function (pt) {
      if (pt.heure === 0 || pt.heure % 24 !== 0) return;
      var p = self.versEcran(pt.lat, pt.lon);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.fill();
      ctx.fillStyle = CARTE.encreDouce;
      ctx.fillText('+' + (pt.heure / 24) + ' j', p.x, p.y - 8);
    });
  };

  /**
   * Cherche une place libre pour un libellé.
   *
   * On essaie d'abord la position naturelle, à droite du marqueur, puis on
   * s'écarte verticalement par paliers, et enfin on passe à gauche. Un libellé
   * qui recouvre son voisin ne renseigne plus personne : mieux vaut le décaler
   * de quelques pixels que d'écrire deux noms l'un sur l'autre.
   */
  Carte.prototype._placerEtiquette = function (x, y, largeur, hauteur) {
    var occupees = this.etiquettesPosees || [];
    var chevauche = function (boite) {
      for (var i = 0; i < occupees.length; i += 1) {
        var o = occupees[i];
        if (boite.x < o.x + o.l && boite.x + boite.l > o.x
          && boite.y < o.y + o.h && boite.y + boite.h > o.y) return true;
      }
      return false;
    };

    var essais = [];
    var decalages = [0, -20, 20, -38, 38, -56, 56];
    decalages.forEach(function (dy) { essais.push({ x: x, y: y + dy, cote: 'droite' }); });
    decalages.forEach(function (dy) {
      essais.push({ x: x - largeur - 26, y: y + dy, cote: 'gauche' });
    });

    for (var i = 0; i < essais.length; i += 1) {
      var boite = { x: essais[i].x, y: essais[i].y - hauteur / 2, l: largeur, h: hauteur };
      if (!chevauche(boite)) {
        occupees.push(boite);
        return essais[i];
      }
    }
    // Tout est pris : on rend la position naturelle plutôt que de masquer le
    // système. Le rendu reste dense, mais rien ne disparaît.
    var repli = { x: x, y: y, cote: 'droite' };
    occupees.push({ x: x, y: y - hauteur / 2, l: largeur, h: hauteur });
    return repli;
  };

  Carte.prototype._dessinerMarqueur = function (s) {
    if (!s.position) return;
    var ctx = this.ctx;
    var p = this.versEcran(s.position.lat, s.position.lon);
    var couleur = this._couleurSysteme(s);
    var nomme = !!s.nom;
    var niveau = (s.menace && s.menace.niveau) || 'aucun';
    var importance = { imminent: 3, preparation: 2, surveillance: 1 }[niveau] || 0;
    var r = (nomme ? 8 : 6) + importance;

    // Un système qui compte porte des anneaux concentriques : leur nombre suit
    // le niveau, pour que l'information passe aussi sans distinguer les
    // couleurs — daltonisme, plein soleil, capture en noir et blanc.
    if (importance > 0) {
      for (var k = importance; k >= 1; k -= 1) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6 + k * 7, 0, Math.PI * 2);
        ctx.strokeStyle = couleur;
        ctx.globalAlpha = 0.13 + 0.07 * (importance - k + 1);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = couleur;
    ctx.globalAlpha = this.survole === s.id ? 0.34 : 0.16 + 0.05 * importance;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = couleur;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Un système nommé porte le symbole tournant ; une zone reste un point.
    if (nomme) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 3.4, 0.4, Math.PI * 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3.4, Math.PI + 0.4, Math.PI * 1.95);
      ctx.stroke();
      ctx.restore();
    }

    ctx.font = '650 11.5px ' + this._css('--police');
    ctx.fillStyle = CARTE.encre;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var etiquette = s.nom || (s.designation || '').replace('Zone surveillée ', 'Zone ');
    var largeur = ctx.measureText(etiquette).width + 10;
    var place = this._placerEtiquette(p.x + r + 4, p.y, largeur, 18);

    // Un trait relie le libellé à son marqueur dès qu'il a dû s'écarter.
    if (Math.abs(place.y - p.y) > 2 || place.cote === 'gauche') {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = couleur;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(place.cote === 'gauche' ? place.x + largeur : place.x, place.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = importance > 0 ? 0.94 : 0.86;
    ctx.fillStyle = importance > 0 ? couleur : CARTE.plaque;
    ctx.fillRect(place.x, place.y - 9, largeur, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = importance > 0 ? '#161a1e' : CARTE.encre;
    ctx.fillText(etiquette, place.x + 5, place.y);

    // La probabilité officielle s'écrit sur la carte : c'est le chiffre qui
    // décide, il ne doit pas obliger à ouvrir la fiche.
    if (typeof s.prob7j === 'number' && s.prob7j >= 20) {
      ctx.font = '700 10.5px ' + this._css('--police');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      var txt = s.prob7j + ' %';
      var l2 = ctx.measureText(txt).width;
      this.etiquettesPosees.push({ x: p.x - l2 / 2 - 5, y: p.y - r - 22, l: l2 + 10, h: 15 });
      ctx.fillStyle = couleur;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.roundRect(p.x - l2 / 2 - 5, p.y - r - 22, l2 + 10, 15, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, p.x, p.y - r - 10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
    }

    this.pointsCliquables.push({ x: p.x, y: p.y, r: r + 10, systeme: s });
  };

  /**
   * Le territoire suivi est le point de vue du lecteur : il porte une croix de
   * visée et un cartouche, pour être trouvé en un coup d'œil au milieu de
   * l'Atlantique. Le libellé suit le territoire choisi, jamais un nom figé.
   */
  Carte.prototype._dessinerGuadeloupe = function () {
    var ctx = this.ctx;
    var p = this.versEcran(GUADELOUPE.lat, GUADELOUPE.lon);
    var teinte = TEINTES.veille;
    var nom = (this.options && this.options.nomCentre) || 'Guadeloupe';

    // Halo, puis croix de visée : deux niveaux de lecture, aucun bruit.
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = teinte;
    ctx.globalAlpha = 0.13;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = teinte;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
    ctx.stroke();
    [[-20, -9], [9, 20]].forEach(function (seg) {
      ctx.beginPath();
      ctx.moveTo(p.x + seg[0], p.y); ctx.lineTo(p.x + seg[1], p.y);
      ctx.moveTo(p.x, p.y + seg[0]); ctx.lineTo(p.x, p.y + seg[1]);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = teinte;
    ctx.fill();
    ctx.strokeStyle = '#05131f';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cartouche : le nom reste lisible même par-dessus une image satellite.
    ctx.font = '700 11.5px ' + this._css('--police');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var largeur = ctx.measureText(nom).width;
    ctx.fillStyle = CARTE.plaque;
    ctx.beginPath();
    // Le repère du territoire est prioritaire : il occupe sa place avant les
    // libellés de systèmes, qui s'écarteront s'il le faut.
    this.etiquettesPosees.push({ x: p.x - largeur / 2 - 7, y: p.y + 24, l: largeur + 14, h: 18 });
    ctx.roundRect(p.x - largeur / 2 - 7, p.y + 24, largeur + 14, 18, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(76, 201, 240, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = CARTE.encre;
    ctx.fillText(nom, p.x, p.y + 27);
  };

  Carte.prototype._dessinerEchelle = function (L, H) {
    var ctx = this.ctx;
    var kmParDegre = 111.32 * Math.cos(this.vue.centreLat * Math.PI / 180);
    var pxParKm = this._echelle() / kmParDegre;
    var cibles = [100, 200, 500, 1000, 2000];
    var km = cibles.find(function (c) { return c * pxParKm > 55; }) || 2000;
    var largeur = km * pxParKm;

    var x = 14;
    var y = H - 16;
    ctx.strokeStyle = 'rgba(233,242,249,.72)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + largeur, y); ctx.lineTo(x + largeur, y - 4);
    ctx.stroke();
    ctx.font = '650 10.5px ' + this._css('--police');
    ctx.fillStyle = 'rgba(233,242,249,.82)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(km.toLocaleString('fr-FR') + ' km', x + 2, y - 5);
  };

  // ------------------------------------------------------------ interactions

  Carte.prototype._installerInteractions = function () {
    var self = this;
    var canvas = this.canvas;
    var deplacement = null;
    var pincement = null;

    function positionLocale(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      var p = positionLocale(e);
      deplacement = { x: p.x, y: p.y, centreLat: self.vue.centreLat, centreLon: self.vue.centreLon, bouge: false };
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = positionLocale(e);

      if (deplacement) {
        var dx = p.x - deplacement.x;
        var dy = p.y - deplacement.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) deplacement.bouge = true;
        var k = self._echelle();
        self.vue.centreLon = deplacement.centreLon - dx / k;
        var myBase = mercatorY(deplacement.centreLat);
        var my = myBase + (dy / k) * (Math.PI / 180);
        self.vue.centreLat = Math.max(-5, Math.min(48, (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI));
        self.vue.centreLon = Math.max(-110, Math.min(-5, self.vue.centreLon));
        self.dessiner();
        return;
      }

      var touche = self._pointSous(p.x, p.y);
      var idSurvole = touche ? touche.systeme.id : null;
      if (idSurvole !== self.survole) {
        self.survole = idSurvole;
        canvas.style.cursor = touche ? 'pointer' : 'grab';
        self.dessiner();
      }
      if (self.options.surSurvol) self.options.surSurvol(touche ? touche.systeme : null, p);
    });

    function relacher(e) {
      if (deplacement && !deplacement.bouge) {
        var p = positionLocale(e);
        var touche = self._pointSous(p.x, p.y);
        if (touche && self.options.surClic) self.options.surClic(touche.systeme);
      }
      deplacement = null;
    }
    canvas.addEventListener('pointerup', relacher);
    canvas.addEventListener('pointercancel', function () { deplacement = null; });
    canvas.addEventListener('pointerleave', function () {
      if (self.survole) { self.survole = null; self.dessiner(); }
      if (self.options.surSurvol) self.options.surSurvol(null);
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoomer(e.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });

    // Pincement à deux doigts.
    var pointeurs = new Map();
    canvas.addEventListener('pointerdown', function (e) { pointeurs.set(e.pointerId, e); });
    canvas.addEventListener('pointermove', function (e) {
      if (!pointeurs.has(e.pointerId)) return;
      pointeurs.set(e.pointerId, e);
      if (pointeurs.size !== 2) return;
      deplacement = null;
      var arr = [...pointeurs.values()];
      var d = Math.hypot(arr[0].clientX - arr[1].clientX, arr[0].clientY - arr[1].clientY);
      if (pincement) self.zoomer(d / pincement);
      pincement = d;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      canvas.addEventListener(ev, function (e) { pointeurs.delete(e.pointerId); pincement = null; });
    });

    // Clavier : la carte doit rester utilisable sans souris.
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', function (e) {
      var pas = 4 / self.vue.zoom;
      var touches = {
        ArrowLeft: function () { self.vue.centreLon -= pas; },
        ArrowRight: function () { self.vue.centreLon += pas; },
        ArrowUp: function () { self.vue.centreLat = Math.min(48, self.vue.centreLat + pas); },
        ArrowDown: function () { self.vue.centreLat = Math.max(-5, self.vue.centreLat - pas); },
        '+': function () { self.zoomer(1.25); },
        '-': function () { self.zoomer(0.8); },
      };
      if (touches[e.key]) { e.preventDefault(); touches[e.key](); self.dessiner(); }
    });
  };

  Carte.prototype._pointSous = function (x, y) {
    for (var i = this.pointsCliquables.length - 1; i >= 0; i -= 1) {
      var p = this.pointsCliquables[i];
      if (Math.hypot(p.x - x, p.y - y) <= p.r) return p;
    }
    return null;
  };

  Carte.prototype.zoomer = function (facteur) {
    this.vue.zoom = Math.max(0.6, Math.min(14, this.vue.zoom * facteur));
    this.dessiner();
  };

  Carte.prototype.recentrer = function (sur) {
    if (sur === 'guadeloupe') {
      this.vue = { centreLat: GUADELOUPE.lat, centreLon: GUADELOUPE.lon, zoom: 5 };
    } else {
      this.vue = Object.assign({}, VUE_DEFAUT);
    }
    this.dessiner();
  };

  Carte.prototype.cadrerSur = function (systeme) {
    if (!systeme || !systeme.position) return;
    var d = systeme.distanceGuadeloupeKm || 1000;
    this.vue = {
      centreLat: (systeme.position.lat + GUADELOUPE.lat) / 2,
      centreLon: (systeme.position.lon + GUADELOUPE.lon) / 2,
      zoom: d > 3000 ? 0.9 : d > 1500 ? 1.5 : 2.6,
    };
    this.dessiner();
  };

  /** Rattache une boucle satellite ; elle se redessine à chaque image. */
  Carte.prototype.attacherBoucle = function (boucle) {
    this.boucle = boucle;
    this.dessiner();
  };

  Carte.prototype.definirCalque = function (nom, actif) {
    this.calques[nom] = actif;
    this.dessiner();
  };

  global.KdlCarte = Carte;
})(window);
