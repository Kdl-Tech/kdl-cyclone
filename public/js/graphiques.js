/**
 * Graphiques météo — SVG écrit à la main, sans aucune bibliothèque.
 *
 * Une colonne de chiffres ne se lit pas : une courbe, si. Ces tracés existent
 * pour qu'on voie d'un coup d'œil quand la chaleur monte, quand la pluie
 * arrive et quel jour de la semaine sera le plus arrosé.
 *
 * Trois règles tenues partout :
 *  - les couleurs sont celles des grandeurs (corail la température, bleu la
 *    pluie, turquoise le vent) et proviennent des variables du thème, donc
 *    elles suivent le mode clair ou sombre sans code supplémentaire ;
 *  - rien n'est inventé : un point manquant coupe la courbe au lieu d'être
 *    interpolé en douce ;
 *  - le SVG est fluide (`viewBox` + largeur 100 %), il se lit de 320 px à un
 *    grand écran sans être redessiné.
 */
(function (global) {
  'use strict';

  /** Identifiants uniques : plusieurs graphiques cohabitent dans une page. */
  var compteur = 0;
  function identifiant(prefixe) {
    compteur += 1;
    return prefixe + '-' + compteur;
  }

  function echapper(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Courbe lissée passant par tous les points, en Bézier cubique symétrique.
   * Le lissage reste faible : une prévision n'a pas à ressembler à une vague
   * décorative.
   */
  function chemin(points) {
    if (!points.length) return '';
    if (points.length === 1) return 'M' + points[0].x + ',' + points[0].y;
    var d = 'M' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1);
    for (var i = 0; i < points.length - 1; i += 1) {
      var p = points[i];
      var q = points[i + 1];
      var dx = (q.x - p.x) * 0.36;
      d += ' C' + (p.x + dx).toFixed(1) + ',' + p.y.toFixed(1)
        + ' ' + (q.x - dx).toFixed(1) + ',' + q.y.toFixed(1)
        + ' ' + q.x.toFixed(1) + ',' + q.y.toFixed(1);
    }
    return d;
  }

  /**
   * Prochaines heures : température en courbe, pluie en barres, vent en
   * annotation. Une seule lecture, trois grandeurs.
   *
   * @param {Array} heures  entrées { heure, temperature, pluieProbabilite, rafalesKmh }
   * @param {object} options { nuit: fonction(heure) => bool }
   */
  function heures(liste, options) {
    options = options || {};
    var points = (liste || []).filter(function (h) { return h && h.temperature != null; });
    if (points.length < 3) return '';

    var L = 720;
    var H = 210;
    var margeH = 26;
    var hautCourbe = 30;
    var basCourbe = 128;
    var basPluie = 176;

    var temps = points.map(function (h) { return h.temperature; });
    var tMin = Math.min.apply(null, temps);
    var tMax = Math.max.apply(null, temps);
    // Une amplitude minimale évite qu'une journée régulière ne devienne une
    // montagne russe à cause de l'échelle automatique.
    if (tMax - tMin < 3) {
      var centre = (tMax + tMin) / 2;
      tMin = centre - 1.5;
      tMax = centre + 1.5;
    }

    var pas = (L - margeH * 2) / (points.length - 1);
    var y = function (t) {
      return basCourbe - ((t - tMin) / (tMax - tMin)) * (basCourbe - hautCourbe);
    };
    var coordonnees = points.map(function (h, i) {
      return { x: margeH + i * pas, y: y(h.temperature), h: h };
    });

    var idCourbe = identifiant('temp');
    var idNuit = identifiant('nuit');

    var barres = coordonnees.map(function (p) {
      var prob = p.h.pluieProbabilite;
      if (prob == null || prob <= 0) return '';
      var hauteur = Math.max(2, (prob / 100) * (basPluie - basCourbe - 12));
      return '<rect x="' + (p.x - pas * 0.28).toFixed(1) + '" y="' + (basPluie - hauteur).toFixed(1)
        + '" width="' + Math.max(3, pas * 0.56).toFixed(1) + '" height="' + hauteur.toFixed(1)
        + '" rx="2" fill="var(--d-pluie)" opacity="' + (0.35 + (prob / 100) * 0.5).toFixed(2) + '"/>';
    }).join('');

    // Bandes de nuit : le graphique porte le rythme du jour.
    var nuits = '';
    var debutNuit = null;
    coordonnees.forEach(function (p, i) {
      var estNuit = !!p.h.nuit;
      if (estNuit && debutNuit === null) debutNuit = p.x;
      var dernier = i === coordonnees.length - 1;
      if ((!estNuit || dernier) && debutNuit !== null) {
        var fin = estNuit && dernier ? p.x : p.x;
        nuits += '<rect x="' + debutNuit.toFixed(1) + '" y="' + (hautCourbe - 18)
          + '" width="' + Math.max(0, fin - debutNuit).toFixed(1) + '" height="' + (basPluie - hautCourbe + 18)
          + '" fill="url(#' + idNuit + ')"/>';
        debutNuit = null;
      }
    });

    var etiquettes = coordonnees.map(function (p, i) {
      if (i % 3 !== 0) return '';
      return '<text x="' + p.x.toFixed(1) + '" y="' + (H - 6)
        + '" text-anchor="middle" class="graphe__heure">'
        + echapper(String(p.h.heure || '').slice(11, 16)) + '</text>';
    }).join('');

    // Extrêmes annotés : les deux chiffres qui comptent vraiment.
    var iMax = coordonnees.reduce(function (m, p, i) {
      return p.h.temperature > coordonnees[m].h.temperature ? i : m;
    }, 0);
    var iMin = coordonnees.reduce(function (m, p, i) {
      return p.h.temperature < coordonnees[m].h.temperature ? i : m;
    }, 0);
    var reperes = [iMax, iMin].map(function (i, rang) {
      var p = coordonnees[i];
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1)
        + '" r="4" fill="var(--surface)" stroke="var(--d-thermique)" stroke-width="2.5"/>'
        + '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + (rang === 0 ? -12 : 20)).toFixed(1)
        + '" text-anchor="middle" class="graphe__extreme">'
        + Math.round(p.h.temperature) + '°</text>';
    }).join('');

    return '<figure class="graphe">'
      + '<svg viewBox="0 0 ' + L + ' ' + H + '" preserveAspectRatio="none" role="img"'
      + ' aria-label="Température et probabilité de pluie sur les prochaines heures">'
      + '<defs>'
      + '<linearGradient id="' + idCourbe + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="var(--d-thermique)" stop-opacity="0.36"/>'
      + '<stop offset="100%" stop-color="var(--d-thermique)" stop-opacity="0"/>'
      + '</linearGradient>'
      + '<linearGradient id="' + idNuit + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="var(--ocean)" stop-opacity="0.14"/>'
      + '<stop offset="100%" stop-color="var(--ocean)" stop-opacity="0.03"/>'
      + '</linearGradient>'
      + '</defs>'
      + nuits
      + '<path d="' + chemin(coordonnees) + ' L' + coordonnees[coordonnees.length - 1].x.toFixed(1)
      + ',' + basCourbe + ' L' + coordonnees[0].x.toFixed(1) + ',' + basCourbe + ' Z"'
      + ' fill="url(#' + idCourbe + ')"/>'
      + '<path d="' + chemin(coordonnees) + '" fill="none" stroke="var(--d-thermique)"'
      + ' stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
      + barres
      + reperes
      + etiquettes
      + '</svg>'
      + '<figcaption class="graphe__legende">'
      + '<span><i style="background:var(--d-thermique)"></i>Température</span>'
      + '<span><i style="background:var(--d-pluie)"></i>Probabilité de pluie</span>'
      + '<span><i class="graphe__nuit"></i>Nuit</span>'
      + '</figcaption>'
      + '</figure>';
  }

  /**
   * Dix jours : une réglette par jour, positionnée sur l'amplitude commune et
   * teintée du froid vers le chaud. La semaine se lit en diagonale.
   */
  function jours(liste) {
    var valides = (liste || []).filter(function (j) {
      return j && j.tempMin != null && j.tempMax != null;
    });
    if (valides.length < 2) return null;
    var bas = Math.min.apply(null, valides.map(function (j) { return j.tempMin; }));
    var haut = Math.max.apply(null, valides.map(function (j) { return j.tempMax; }));
    var etendue = Math.max(haut - bas, 1);
    return {
      bas: bas,
      haut: haut,
      position: function (j) {
        if (j.tempMin == null || j.tempMax == null) return null;
        return {
          debut: Math.round(((j.tempMin - bas) / etendue) * 100),
          fin: Math.round(((j.tempMax - bas) / etendue) * 100),
        };
      },
    };
  }

  global.KdlGraphiques = { heures: heures, jours: jours };
})(window);
