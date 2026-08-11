/**
 * Cadran de relèvement — l'écran signature de KDL Cyclone.
 *
 * Il répond en une seconde à la seule question qui compte au premier regard :
 * « où sont ces systèmes, par rapport à moi ? ». Le territoire choisi est au
 * centre — Guadeloupe par défaut, mais n'importe quelle île de l'arc — et
 * chaque système est placé à son azimut réel et à sa distance réelle.
 *
 * L'échelle radiale suit une racine carrée : le proche respire, le lointain
 * tient dans le disque sans écraser le reste.
 */
(function (global) {
  'use strict';

  var ANNEAUX_KM = [500, 1000, 2000, 4000];
  var DISTANCE_MAX_KM = 5200;

  function couleurMenace(niveau, css) {
    switch (niveau) {
      case 'imminent': return css('--rouge');
      case 'preparation': return css('--ambre-vif');
      case 'surveillance': return css('--ambre');
      case 'veille': return css('--cyan');
      default: return css('--texte-faible');
    }
  }

  /** Rayon à l'écran pour une distance en kilomètres. */
  function rayonPour(distanceKm, rayonMax) {
    var d = Math.min(distanceKm, DISTANCE_MAX_KM);
    return rayonMax * Math.sqrt(d / DISTANCE_MAX_KM);
  }

  function dessiner(canvas, systemes, options) {
    options = options || {};
    var ctx = canvas.getContext('2d');
    var styles = getComputedStyle(document.documentElement);
    var css = function (nom) { return styles.getPropertyValue(nom).trim(); };

    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    var taille = canvas.clientWidth || 340;
    canvas.width = taille * dpr;
    canvas.height = taille * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, taille, taille);

    var cx = taille / 2;
    var cy = taille / 2;
    var rayonMax = taille / 2 - 26;

    var sombre = document.documentElement.dataset.theme === 'sombre';
    var trait = css('--bordure');
    var traitDoux = sombre ? 'rgba(154,181,203,.22)' : 'rgba(74,100,128,.18)';
    var texteFaible = css('--texte-faible');
    var cyan = css('--cyan');

    // Fond du disque : une profondeur discrète, pas un effet.
    var fond = ctx.createRadialGradient(cx, cy, 0, cx, cy, rayonMax);
    if (sombre) {
      fond.addColorStop(0, 'rgba(31,82,120,.30)');
      fond.addColorStop(1, 'rgba(6,26,42,.05)');
    } else {
      fond.addColorStop(0, 'rgba(31,82,120,.10)');
      fond.addColorStop(1, 'rgba(31,82,120,.02)');
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rayonMax, 0, Math.PI * 2);
    ctx.fillStyle = fond;
    ctx.fill();

    // Secteur d'où arrivent les systèmes tropicaux : est-sud-est.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rayonMax, -Math.PI / 180 * 15, Math.PI / 180 * 55);
    ctx.closePath();
    ctx.fillStyle = sombre ? 'rgba(53,198,239,.05)' : 'rgba(11,143,184,.045)';
    ctx.fill();

    // Anneaux de distance.
    ctx.lineWidth = 1;
    ANNEAUX_KM.forEach(function (km) {
      var r = rayonPour(km, rayonMax);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = traitDoux;
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Les étiquettes vont au sud-ouest : les systèmes tropicaux arrivent
      // par l'est, ce secteur reste donc libre presque tout le temps.
      var angleEtiquette = (215 - 90) * Math.PI / 180;
      var ex = cx + Math.cos(angleEtiquette) * r;
      var ey = cy + Math.sin(angleEtiquette) * r;

      ctx.font = '600 9.5px ' + css('--police');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var etiquette = km >= 1000 ? (km / 1000).toLocaleString('fr-FR') + ' 000 km' : km + ' km';
      var largeur = ctx.measureText(etiquette).width + 8;
      ctx.fillStyle = css('--surface');
      ctx.globalAlpha = 0.85;
      ctx.fillRect(ex - largeur / 2, ey - 6, largeur, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = texteFaible;
      ctx.fillText(etiquette, ex, ey);
    });

    // Axes cardinaux.
    ctx.strokeStyle = traitDoux;
    [0, 90, 180, 270].forEach(function (azimut) {
      var a = (azimut - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * rayonMax, cy + Math.sin(a) * rayonMax);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(cx, cy, rayonMax, 0, Math.PI * 2);
    ctx.strokeStyle = trait;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.font = '700 10px ' + css('--police');
    ctx.fillStyle = texteFaible;
    [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(function (p) {
      var a = (p[1] - 90) * Math.PI / 180;
      ctx.fillText(p[0], cx + Math.cos(a) * (rayonMax + 13), cy + Math.sin(a) * (rayonMax + 13));
    });

    // Distance au territoire choisi, et non plus à la Guadeloupe en dur.
    var distanceDe = options.distancePour || function (s) { return s.distanceGuadeloupeKm; };

    // Systèmes, du plus lointain au plus proche pour que le proche reste lisible.
    var tries = (systemes || [])
      .filter(function (s) { return typeof distanceDe(s) === 'number'; })
      .slice()
      .sort(function (a, b) { return distanceDe(b) - distanceDe(a); });

    // Anti-chevauchement des noms : deux systèmes voisins ne s'écrivent pas
    // l'un sur l'autre. Le libellé glisse verticalement jusqu'à trouver sa place.
    var etiquettesPosees = [];
    function placerEtiquette(x, y) {
      var yFinal = y;
      var essais = 0;
      while (essais < 8 && etiquettesPosees.some(function (e) {
        return Math.abs(e.x - x) < 74 && Math.abs(e.y - yFinal) < 13;
      })) {
        yFinal += 14;
        essais += 1;
      }
      etiquettesPosees.push({ x: x, y: yFinal });
      return yFinal;
    }

    tries.forEach(function (s) {
      var azimut = s.azimutDepuisGuadeloupe;
      if (typeof azimut !== 'number') return;
      var r = rayonPour(distanceDe(s), rayonMax);
      var a = (azimut - 90) * Math.PI / 180;
      var x = cx + Math.cos(a) * r;
      var y = cy + Math.sin(a) * r;

      var niveau = (options.menacePour ? options.menacePour(s).niveau : (s.menace && s.menace.niveau))
        || 'aucun';
      // eslint-disable-next-line no-unused-vars
      var couleur = couleurMenace(niveau, css);
      var potentiel = (s.potentiel && s.potentiel.score) || 0;
      var taille = 5 + (potentiel / 100) * 6;

      // Un système qui se rapproche tire un trait vers le centre.
      var menace = options.menacePour ? options.menacePour(s) : (s.menace || {});
      if (menace.tendance === 'se_rapproche') {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx, cy);
        ctx.strokeStyle = couleur;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(x, y, taille + 7, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(x, y, taille, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.fill();
      ctx.strokeStyle = css('--surface');
      ctx.lineWidth = 1.6;
      ctx.stroke();

      var court = s.nom || (s.designation || '').replace('Zone surveillée ', 'Zone ');
      ctx.font = '650 10px ' + css('--police');
      ctx.textAlign = x > cx ? 'right' : 'left';
      var yTexte = placerEtiquette(x, y);
      var xTexte = x + (x > cx ? -(taille + 6) : taille + 6);

      // Fond léger : le nom reste lisible même posé sur un anneau.
      var l = ctx.measureText(court).width;
      ctx.fillStyle = css('--surface');
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x > cx ? xTexte - l - 3 : xTexte - 3, yTexte - 6, l + 6, 12);
      ctx.globalAlpha = 1;

      ctx.fillStyle = css('--texte');
      ctx.fillText(court, xTexte, yTexte);
      ctx.textAlign = 'center';
    });

    // La Guadeloupe, au centre, en cyan : le seul point de repère absolu.
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = cyan;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = cyan;
    ctx.fill();

    ctx.font = '700 10px ' + css('--police');
    ctx.fillStyle = css('--texte');
    ctx.fillText(options.centreNom || 'Guadeloupe', cx, cy + 24);

    // Aucun système : on le dit dans le cadran plutôt que de le laisser vide.
    if (tries.length === 0) {
      ctx.font = '600 11.5px ' + css('--police');
      ctx.fillStyle = texteFaible;
      ctx.fillText(options.messageVide || 'Aucun système suivi', cx, cy - 32);
    }
  }

  function legende(conteneur, systemes) {
    var styles = getComputedStyle(document.documentElement);
    var css = function (n) { return styles.getPropertyValue(n).trim(); };
    var niveaux = [
      ['veille', 'Suivi'],
      ['surveillance', 'À surveiller'],
      ['preparation', 'Préparation'],
      ['imminent', 'Impact possible'],
    ];
    var presents = niveaux.filter(function (n) {
      return (systemes || []).some(function (s) { return s.menace && s.menace.niveau === n[0]; });
    });
    if (presents.length === 0) {
      presents = [['aucun', (systemes || []).length
        ? 'Systèmes suivis, aucun ne concerne l\'archipel'
        : 'Aucun système suivi']];
    }

    conteneur.innerHTML = presents.map(function (n) {
      return '<span><i style="background:' + couleurMenace(n[0], css) + '"></i>' + n[1] + '</span>';
    }).join('') + '<span style="color:var(--texte-faible)">Taille du point = potentiel de développement</span>';
  }

  global.KdlCadran = { dessiner: dessiner, legende: legende, rayonPour: rayonPour };
})(window);
