/**
 * KDL Cyclone — application.
 *
 * Trois règles tenues partout dans ce fichier :
 *  1. la provenance de chaque information est visible (officiel / modèle / KDL) ;
 *  2. une donnée manquante ou périmée est annoncée, jamais comblée ;
 *  3. le dernier état connu reste lisible sans réseau.
 */
(function () {
  'use strict';

  var GUADELOUPE = { lat: 16.25, lon: -61.55 };
  var CLE_TERRITOIRE = 'kdl-cyclone-territoire';
  var PARAM_TERRITOIRE = 'territoire';

  /**
   * Liste de secours des territoires couverts.
   *
   * Le serveur publie la liste complète avec ses distances et ses autorités,
   * mais elle arrive avec les données. Celle-ci permet d'afficher le sélecteur
   * dès la première image, avant toute requête. Un test vérifie qu'elle ne
   * dérive pas de `src/territoires.js`.
   */
  var TERRITOIRES_CONNUS = [
    { cle: 'guadeloupe', nom: 'Guadeloupe', article: 'la ', principal: true },
    { cle: 'saint-martin', nom: 'Saint-Martin', article: '' },
    { cle: 'saint-barthelemy', nom: 'Saint-Barthélemy', article: '' },
    { cle: 'martinique', nom: 'Martinique', article: 'la ' },
    { cle: 'dominique', nom: 'Dominique', article: 'la ' },
    { cle: 'sainte-lucie', nom: 'Sainte-Lucie', article: '' },
    { cle: 'barbade', nom: 'Barbade', article: 'la ' },
    { cle: 'antigua', nom: 'Antigua-et-Barbuda', article: '' },
    { cle: 'trinite-tobago', nom: 'Trinité-et-Tobago', article: '' },
  ];

  function territoiresDisponibles() {
    var publies = (etat && etat.territoires) || [];
    return publies.length ? publies : TERRITOIRES_CONNUS;
  }

  function territoireExiste(cle) {
    return !!cle && territoiresDisponibles().some(function (t) { return t.cle === cle; });
  }

  /**
   * Territoire actif, dans l'ordre : celui demandé par l'URL — un lien partagé
   * doit ouvrir la bonne île —, puis la préférence enregistrée, puis le défaut.
   */
  function cleTerritoire() {
    var demande = null;
    try { demande = new URLSearchParams(location.search).get(PARAM_TERRITOIRE); } catch (e) { demande = null; }
    if (territoireExiste(demande)) return demande;

    var memorise = null;
    try { memorise = localStorage.getItem(CLE_TERRITOIRE); } catch (e) { memorise = null; }
    if (territoireExiste(memorise)) return memorise;

    return (etat && etat.territoireDefaut) || 'guadeloupe';
  }

  /**
   * Change de territoire : la préférence est retenue, l'URL devient
   * partageable, et toutes les vues sont refaites — titres, distances, cadran,
   * carte, météo, liens officiels et libellés d'accessibilité compris.
   */
  function definirTerritoire(cle) {
    if (!territoireExiste(cle)) return;
    // Le lieu appartient au territoire quitté : le garder dans l'URL ferait
    // chercher « Saint-François » en Martinique.
    try {
      var u = new URL(location.href);
      if (u.searchParams.has('lieu')) {
        u.searchParams.delete('lieu');
        history.replaceState(history.state, '', u.pathname + u.search);
      }
    } catch (e) { /* sans History API */ }
    try { localStorage.setItem(CLE_TERRITOIRE, cle); } catch (e) { /* stockage refusé */ }
    inscrireTerritoireDansUrl(cle);
    if (etat) { preparerEtat(etat); rendreTout(); }
    if (vueCourante === 'meteo') rendreMeteo();
    if (vueCourante === 'carte' && carte) carte.dessiner();
    rendreSelecteurTerritoire();
    mesurer('territoire', cle);
  }

  /** Le territoire voyage dans l'URL, sans polluer l'historique. */
  function inscrireTerritoireDansUrl(cle) {
    try {
      var url = new URL(location.href);
      if (cle && cle !== 'guadeloupe') url.searchParams.set(PARAM_TERRITOIRE, cle);
      else url.searchParams.delete(PARAM_TERRITOIRE);
      history.replaceState(history.state, '', url.pathname + url.search);
    } catch (e) { /* navigateur sans History API : sans conséquence */ }
  }

  /** Fiche du territoire actif, telle que publiée par le serveur. */
  function territoireActif() {
    var cle = cleTerritoire();
    var liste = territoiresDisponibles();
    var trouve = liste.find(function (t) { return t.cle === cle; })
      || liste.find(function (t) { return t.principal; })
      || liste[0]
      || { cle: 'guadeloupe', nom: 'Guadeloupe', article: 'la ' };
    // Un territoire de la liste de secours n'a ni liens ni risque : on complète
    // pour que l'affichage ne s'effondre pas avant l'arrivée des données.
    return Object.assign(
      { position: GUADELOUPE, liens: [], risque: { niveau: 'aucun', label: '—' } },
      trouve,
    );
  }

  /** Menace d'un système pour le territoire actif. */
  function menacePour(s) {
    var cle = cleTerritoire();
    return (s.menaces && s.menaces[cle]) || s.menace || {};
  }

  function distancePour(s) {
    var m = menacePour(s);
    return typeof m.distanceKm === 'number' ? m.distanceKm : s.distanceGuadeloupeKm;
  }
  var CLE_CACHE = 'kdl-cyclone-dernier-etat';
  var CLE_THEME = 'kdl-cyclone-theme';

  /* Au-delà de cette durée, nos propres données ne sont plus présentables
     comme « à jour », quel que soit l'âge du bulletin officiel. */
  var SEUIL_DONNEES_ANCIENNES = 3 * 3600 * 1000;

  var etat = null;
  var carte = null;
  var vueCourante = 'accueil';
  var systemeOuvert = null;
  var horsLigne = !navigator.onLine;

  // ------------------------------------------------------------------ outils

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /**
   * Rétablit les styles portés par les attributs `style`.
   *
   * La politique de sécurité du site interdit les styles en ligne
   * (`style-src 'self'`, sans `unsafe-inline`) : le navigateur conserve
   * l'attribut mais n'en applique rien. Résultat invisible et coûteux — les
   * largeurs de barres tombaient à zéro et les respirations entre blocs
   * disparaissaient, ce qui aplatissait toute la mise en page.
   *
   * Le CSSOM, lui, n'est pas concerné par cette règle : on relit l'attribut et
   * on le repose par `style.cssText`. La politique reste stricte, et la mise en
   * page redevient celle qui est écrite.
   */
  function rendreStylesEnLigne(racine) {
    if (!racine || !racine.querySelectorAll) return;
    var noeuds = racine.querySelectorAll('[style]');
    for (var i = 0; i < noeuds.length; i += 1) {
      var voulu = noeuds[i].getAttribute('style');
      if (voulu && !noeuds[i].style.cssText) noeuds[i].style.cssText = voulu;
    }
    if (racine.nodeType === 1 && racine.hasAttribute && racine.hasAttribute('style')
      && !racine.style.cssText) {
      racine.style.cssText = racine.getAttribute('style');
    }
  }

  /** Tout contenu inséré après coup passe par la même réparation. */
  function surveillerStyles() {
    rendreStylesEnLigne(document.documentElement);
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function (lots) {
      lots.forEach(function (lot) {
        Array.prototype.forEach.call(lot.addedNodes, function (n) {
          if (n.nodeType === 1) rendreStylesEnLigne(n);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function echapper(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nombre(v, decimales) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return v.toLocaleString('fr-FR', {
      minimumFractionDigits: decimales || 0,
      maximumFractionDigits: decimales || 0,
    });
  }

  /** Valeur affichable, ou mention explicite d'indisponibilité. */
  function valeurOuIndispo(v, unite, decimales) {
    var n = nombre(v, decimales);
    return n === null ? '<span class="etiquette etiquette--indispo">Non disponible</span>'
      : '<span class="valeur">' + n + (unite ? '&nbsp;' + unite : '') + '</span>';
  }

  function heureLocale(iso, avecDate) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var opts = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Guadeloupe' };
    if (avecDate) { opts.day = '2-digit'; opts.month = 'short'; }
    return d.toLocaleString('fr-FR', opts);
  }

  function heureUtc(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toISOString().slice(11, 16) + ' UTC';
  }

  function ilYA(iso) {
    if (!iso) return 'inconnue';
    var minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'à l\'instant';
    if (minutes < 60) return 'il y a ' + minutes + ' min';
    var heures = Math.round(minutes / 60);
    if (heures < 24) return 'il y a ' + heures + ' h';
    return 'il y a ' + Math.round(heures / 24) + ' j';
  }

  /** Azimut Guadeloupe → système, pour le cadran de relèvement. */
  function azimut(depuis, vers) {
    var rad = Math.PI / 180;
    var y = Math.sin((vers.lon - depuis.lon) * rad) * Math.cos(vers.lat * rad);
    var x = Math.cos(depuis.lat * rad) * Math.sin(vers.lat * rad)
      - Math.sin(depuis.lat * rad) * Math.cos(vers.lat * rad) * Math.cos((vers.lon - depuis.lon) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  /**
   * Pastille de fraîcheur. Elle accompagne toute valeur importante : source,
   * heure officielle, heure locale, âge, état. Une donnée ancienne reste
   * lisible mais ne passe jamais pour actuelle.
   */
  function pastilleFraicheur(f, source) {
    if (!f) return '';
    var classes = {
      a_jour: 'fraicheur--ok',
      actualisation_en_attente: 'fraicheur--attente',
      donnees_anciennes: 'fraicheur--ancienne',
    };
    var detail = [];
    if (source) detail.push(echapper(source));
    if (f.emisLe) detail.push('bulletin émis à ' + heureLocale(f.emisLe) + ' (heure de Guadeloupe)');
    if (f.emisLe) detail.push(heureUtc(f.emisLe));
    return '<div class="fraicheur ' + (classes[f.etat] || '') + '">'
      + '<span class="fraicheur__pastille"></span>'
      + '<div><b>' + echapper(f.libelle) + '</b>'
      + (detail.length ? '<span class="fraicheur__detail">' + detail.join(' · ') + '</span>' : '')
      + '<span class="fraicheur__detail">' + echapper(f.message || '') + '</span>'
      + '</div></div>';
  }

  var ICONES = {
    fleche: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    bas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
    externe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>',
    horsLigne: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 1l22 22M16.7 11.1A6 6 0 0 0 8 8.6M5 12.6A6 6 0 0 0 6 20h11"/></svg>',
    calme: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22"/><path d="M32 14c8 6 8 30 0 36M32 14c-8 6-8 30 0 36"/></svg>',
    alerte: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.9 18.1A2 2 0 0 0 3.6 21h16.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0"/><path d="M12 9v4.5M12 17h.01"/></svg>',
    bouclier: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  };

  // -------------------------------------------------------------- chargement

  function memoriserEtat(e) {
    try { localStorage.setItem(CLE_CACHE, JSON.stringify(e)); } catch (err) { /* quota : sans conséquence */ }
  }

  function etatMemorise() {
    try { return JSON.parse(localStorage.getItem(CLE_CACHE) || 'null'); } catch (err) { return null; }
  }

  function preparerEtat(e) {
    var liste = e.territoires || [];
    var cle = (function () {
      try { return localStorage.getItem(CLE_TERRITOIRE) || e.territoireDefaut || 'guadeloupe'; }
      catch (err) { return e.territoireDefaut || 'guadeloupe'; }
    })();
    var t = liste.find(function (x) { return x.cle === cle; })
      || liste.find(function (x) { return x.principal; });
    var centre = (t && t.position) || GUADELOUPE;

    // Le cadran est centré sur le territoire choisi : les azimuts et les
    // distances doivent l'être aussi, sinon la lecture serait fausse.
    (e.systemes || []).forEach(function (s) {
      s.azimutDepuisGuadeloupe = s.position ? azimut(centre, s.position) : null;
    });
    e.__centre = centre;
    e.__territoire = t || null;
    return e;
  }

  /**
   * Attente annoncée par étapes. Une première collecte peut demander quelques
   * secondes ; le silence laissait l'impression d'une application figée.
   */
  var minuteursAttente = [];

  function annoncerAttente() {
    arreterAttente();
    if (etat) return;
    messageAttente('Récupération du dernier bulletin officiel…', false);
    minuteursAttente.push(setTimeout(function () {
      if (!etat) {
        messageAttente(
          'Les données prennent plus de temps que prévu. Vous pouvez réessayer '
          + 'sans quitter l\'application.', true,
        );
      }
    }, 8000));
  }

  function arreterAttente() {
    minuteursAttente.forEach(clearTimeout);
    minuteursAttente = [];
  }

  function messageAttente(texte, avecReprise) {
    var zone = $('#bandeau-connexion');
    if (!zone) return;
    zone.innerHTML = '<div class="bandeau bandeau--info">' + ICONES.info
      + '<div>' + echapper(texte)
      + (avecReprise
        ? ' <button class="lien-texte" type="button" id="reessayer">Réessayer</button>'
        : '')
      + '</div></div>';
  }

  function charger(force) {
    var bouton = $('#bouton-actualiser');
    bouton.setAttribute('aria-busy', 'true');
    annoncerAttente();

    return fetch('/api/etat', { cache: force ? 'reload' : 'default' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // Le service worker peut répondre depuis son cache avec un statut 200 :
        // sans cette vérification, l'application se croirait en ligne.
        var servieDuCache = r.headers.get('X-KDL-Cache') === 'hors-ligne';
        return r.json().then(function (d) { return { donnees: d, cache: servieDuCache }; });
      })
      .then(function (res) {
        etat = preparerEtat(res.donnees);
        if (!res.cache) memoriserEtat(res.donnees);
        horsLigne = res.cache || !navigator.onLine;
        rendreTout();
      })
      .catch(function () {
        // Réseau absent ou serveur muet : le dernier état connu reste affiché,
        // clairement daté, plutôt qu'un écran vide.
        var memoire = etatMemorise();
        horsLigne = true;
        if (memoire) {
          etat = preparerEtat(memoire);
          rendreTout();
        } else {
          rendreAucuneDonnee();
        }
      })
      .finally(function () {
        arreterAttente();
        bouton.removeAttribute('aria-busy');
        // Une source muette ne doit jamais emporter le choix du territoire.
        if (!$('#choix-territoire')) rendreCoquille();
      });
  }

  // ------------------------------------------------------------------ rendus

  /**
   * Tout ce qui ne dépend d'aucune donnée : sélecteur, titres, libellés de
   * navigation. Appelé avant la première requête, pour que l'application soit
   * utilisable immédiatement même si les sources tardent ou tombent.
   */
  function rendreCoquille() {
    rendreSelecteurTerritoire();
    var terr = territoireActif();
    var titreCadran = document.querySelector('#titre-cadran');
    if (titreCadran) titreCadran.textContent = 'Relèvement depuis ' + (terr.article || '') + terr.nom;

    var canvas = document.querySelector('#cadran');
    if (canvas) {
      canvas.setAttribute('aria-label',
        'Cadran de relèvement des systèmes suivis autour de ' + (terr.article || '') + terr.nom);
    }
    var ongletLocal = document.querySelector('.nav__lien[data-vue="guadeloupe"]');
    if (ongletLocal) {
      ongletLocal.lastChild.textContent = terr.nom.length > 12 ? 'Mon île' : terr.nom;
      ongletLocal.setAttribute('aria-label', 'Situation locale — ' + terr.nom);
    }
    var vueLocale = document.querySelector('section.vue[data-vue="guadeloupe"]');
    if (vueLocale) vueLocale.setAttribute('aria-label', 'Situation en ' + terr.nom);
  }

  function rendreTout() {
    rendreBandeauVigilance();
    rendreBandeauConnexion();
    rendreCoquille();
    rendreSituation();
    rendreCadran();
    rendreListeSystemes();
    rendreLiensOfficiels();
    rendreInvitationInstallation();
    rendreGuadeloupe();
    rendreSources();
    rendreProvenance();
    if (carte) carte.definirEtat(etat);
    if (vueCourante === 'systeme' && systemeOuvert) rendreFiche(systemeOuvert);
    $('#pied-version').textContent = 'Dernière collecte : ' + heureLocale(etat.genereLe, true)
      + ' heure de Guadeloupe (' + heureUtc(etat.genereLe) + ').';
  }

  function ageDonnees() {
    if (!etat || !etat.genereLe) return Infinity;
    return Date.now() - new Date(etat.genereLe).getTime();
  }

  /**
   * Bandeau de vigilance officielle, en haut de toutes les vues.
   *
   * Sur un territoire français, la vigilance de Météo-France fait autorité :
   * elle doit être lue avant tout le reste, sans avoir à ouvrir une page. Le
   * bandeau la relaie telle quelle — niveau, phénomènes, heure d'émission — et
   * ne la reformule jamais. Il suit l'état comme le reste de l'interface :
   * chaque collecte, chaque changement de territoire le redessine.
   *
   * Hors territoires français (Dominique, Sainte-Lucie, Barbade, Antigua,
   * Trinité), Météo-France n'a aucune autorité : le bandeau disparaît plutôt
   * que d'afficher une vigilance qui ne s'applique pas.
   */
  function rendreBandeauVigilance() {
    var zone = $('#bandeau-vigilance');
    if (!zone) return;

    var terr = territoireActif();
    var vig = terr && terr.vigilanceOfficielle;
    if (!vig || !vig.niveau) {
      zone.className = 'vigi est-cache';
      zone.innerHTML = '';
      return;
    }

    var phenomenes = vig.phenomenes || [];
    var alerte = vig.niveau !== 'vert';
    // Les phénomènes réellement en vigilance, du plus grave au moins grave :
    // c'est la liste servie par la source, déjà triée.
    var actifs = phenomenes.filter(function (p) { return p.niveau && p.niveau !== 'vert'; });
    var cyclone = phenomenes.filter(function (p) { return p.nom === 'Cyclone'; })[0];

    // Le niveau de chaque phénomène n'est écrit que s'il diffère du niveau
    // d'ensemble : sinon la phrase répéterait « orange » à chaque mot.
    var listePhenos = actifs.map(function (p) {
      return echapper(p.nom) + (p.niveau === vig.niveau ? '' : ' (' + echapper(p.niveau) + ')');
    }).join(' · ');

    var titre = alerte
      ? 'Vigilance ' + echapper(vig.niveau)
      : 'Aucune vigilance en cours';

    var ligne2 = alerte
      ? listePhenos
      : 'Météo-France ne signale aucun phénomène dangereux à cette heure.';

    // Le cyclone est la raison d'être de l'application : dès qu'il est lui-même
    // en vigilance, il est nommé en clair, avant les autres phénomènes.
    if (alerte && cyclone && cyclone.niveau !== 'vert') {
      var autres = actifs.filter(function (p) { return p.nom !== 'Cyclone'; }).map(function (p) {
        return echapper(p.nom) + (p.niveau === vig.niveau ? '' : ' (' + echapper(p.niveau) + ')');
      }).join(' · ');
      ligne2 = 'CYCLONE — vigilance ' + echapper(cyclone.niveau) + (autres ? ' · ' + autres : '');
    }

    zone.className = 'vigi vigi--' + echapper(vig.niveau);
    zone.innerHTML = '<div class="vigi__interieur">'
      + (alerte ? ICONES.alerte : ICONES.bouclier).replace('<svg ', '<svg class="vigi__icone" ')
      + '<div class="vigi__corps">'
      + '<p class="vigi__titre">' + titre
      + ' <span class="vigi__zone">— ' + echapper(vig.zone || terr.nom) + '</span></p>'
      + '<p class="vigi__phenos">' + ligne2 + '</p>'
      + '<p class="vigi__source">Météo-France · bulletin émis à '
      + heureLocale(vig.emisLe, true) + ' (heure locale)'
      + (vig.perime ? ' · dernière vigilance connue, la source n\'a pas répondu au dernier appel' : '')
      // Hors connexion ou collecte interrompue : le bandeau ne doit jamais
      // laisser croire qu'il montre la situation de l'instant.
      + (horsLigne || ageDonnees() > 3 * 3600 * 1000
        ? ' · <strong>information non actualisée, vérifiez sur Météo-France</strong>'
        : '')
      + '</p>'
      + '</div>'
      + '<div class="vigi__actions">'
      // Au vert, il n'y a rien à détailler : un seul lien, et le bandeau reste
      // court. En alerte, l'accès au détail passe avant tout.
      + (alerte ? '<button class="vigi__bouton" type="button" data-vers="guadeloupe">Détails</button>' : '')
      + '<a class="vigi__bouton" href="'
      + echapper(vig.lien || 'https://vigilance.meteofrance.fr/fr')
      + '" target="_blank" rel="noopener noreferrer">Météo-France' + ICONES.externe + '</a>'
      + '</div>'
      + '</div>';
  }

  function rendreBandeauConnexion() {
    var zone = $('#bandeau-connexion');
    var age = ageDonnees();
    var messages = [];

    if (horsLigne) {
      messages.push({
        classe: 'bandeau--hors-ligne',
        icone: ICONES.horsLigne,
        texte: 'Vous êtes hors connexion. Les informations affichées datent du '
          + heureLocale(etat && etat.genereLe, true) + ' et ne sont plus actualisées. '
          + 'Le mode préparation reste entièrement disponible.',
      });
    } else if (age > 3 * 3600 * 1000) {
      messages.push({
        classe: 'bandeau--attention',
        icone: ICONES.info,
        texte: 'Les données n\'ont pas été renouvelées depuis plus de 3 heures. '
          + 'Consultez directement Météo-France et le NHC avant toute décision.',
      });
    } else if (age > 45 * 60 * 1000) {
      messages.push({
        classe: 'bandeau--info',
        icone: ICONES.info,
        texte: 'Dernière actualisation ' + ilYA(etat.genereLe) + '. La prochaine est prévue sous peu.',
      });
    }

    if (etat && etat.watchdog && etat.watchdog.alertes && etat.watchdog.alertes.length) {
      messages.push({
        classe: 'bandeau--attention',
        icone: ICONES.info,
        texte: 'Contrôle technique : ' + etat.watchdog.alertes.map(function (a) { return a.message; }).join(' '),
      });
    }

    if (etat && etat.degradations && etat.degradations.length) {
      messages.push({
        classe: 'bandeau--attention',
        icone: ICONES.info,
        texte: 'Certaines sources n\'ont pas répondu lors de la dernière collecte : '
          + etat.degradations.length + ' élément(s) manquant(s). Les valeurs concernées sont marquées « non disponible ».',
      });
    }

    zone.innerHTML = messages.map(function (m) {
      return '<div class="bandeau ' + m.classe + '">' + m.icone + '<div>' + echapper(m.texte) + '</div></div>';
    }).join('');
  }

  /**
   * Sélecteur de territoire.
   *
   * Il ne dépend d'aucune donnée : il s'affiche dès le premier rendu, à partir
   * de la liste locale, et se met simplement à jour quand le serveur publie la
   * sienne. Auparavant il disparaissait pendant tout le chargement, et un
   * lecteur pouvait croire que seule la Guadeloupe était couverte.
   */
  function rendreSelecteurTerritoire() {
    var zone = $('#selecteur-territoire');
    if (!zone) return;
    var liste = territoiresDisponibles();
    var actif = territoireActif();

    zone.innerHTML = '<label class="territoire" for="choix-territoire">'
      + '<svg class="territoire__lieu" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11"/><circle cx="12" cy="10" r="2.6"/></svg>'
      + '<span class="territoire__intitule">Territoire</span>'
      // Le nom visible est un doublon du `select`, qui reste seul lu par les
      // lecteurs d'écran : sans cela, il serait annoncé deux fois.
      + '<span class="territoire__valeur" aria-hidden="true">' + echapper(actif.nom) + '</span>'
      + '<svg class="territoire__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
      // Le `select` natif reste le contrôle réel — clavier, tactile et menus
      // système compris — mais il est transparent et couvre tout le bouton.
      + '<select id="choix-territoire" aria-label="Territoire suivi">'
      + liste.map(function (t) {
        return '<option value="' + echapper(t.cle) + '"' + (t.cle === actif.cle ? ' selected' : '') + '>'
          + echapper(t.nom) + '</option>';
      }).join('')
      + '</select>'
      + '</label>';
  }

  /**
   * Résumé adapté au territoire choisi. Le serveur en produit un pour la
   * Guadeloupe ; ici on le reformule pour l'île réellement consultée, sans
   * inventer de donnée : tout vient de `terr` et des systèmes.
   */
  function resumePourTerritoire(terr) {
    var base = etat.situation.resume;
    if (!terr || terr.principal) return base;

    var concernes = terr.systemesConcernes || [];
    var n = (etat.systemes || []).length;

    if (concernes.length === 0) {
      return {
        titre: 'Aucun phénomène cyclonique ne menace actuellement ' + (terr.article || '') + terr.nom + '.',
        detail: n === 0
          ? "Le National Hurricane Center ne suit aucune zone de développement dans l'Atlantique nord."
          : n + ' zone' + (n > 1 ? 's' : '') + ' surveillée' + (n > 1 ? 's' : '')
            + ' dans l\'Atlantique, sans incidence identifiée pour ce territoire à ce stade.',
        ton: 'calme',
      };
    }

    var premier = (etat.systemes || []).find(function (x) { return x.id === concernes[0].id; });
    var m = premier ? menacePour(premier) : {};
    return {
      titre: concernes.length > 1
        ? concernes.length + ' systèmes sont à surveiller pour ' + (terr.article || '') + terr.nom + '.'
        : 'Un système est à surveiller pour ' + (terr.article || '') + terr.nom + '.',
      detail: m.message || '',
      ton: terr.risque.niveau === 'imminent' ? 'alerte' : 'attention',
    };
  }

  /**
   * Cran de menace d'un système, de n0 (rien) à n3 (imminent). Il vient
   * d'abord de la lecture officielle du NHC : deux zones classées différemment
   * ne doivent jamais s'afficher de la même façon.
   */
  function cranSysteme(s) {
    var niveau = (menacePour(s) || {}).niveau;
    if (niveau === 'imminent') return 3;
    if (niveau === 'preparation') return 2;
    if (niveau === 'surveillance') return 1;
    var off = s.risque7jOfficiel;
    if (off === 'eleve') return 2;
    if (off === 'moyen') return 1;
    if (typeof s.prob7j === 'number' && s.prob7j >= 60) return 1;
    return 0;
  }

  /** Lecture officielle du NHC ramenée sur la même échelle de crans. */
  function cranOfficiel(risque) {
    return { eleve: 2, moyen: 1 }[risque] || 0;
  }

  /** Même échelle, appliquée cette fois au niveau de risque d'un territoire. */
  function cranRisque(niveau) {
    return { imminent: 3, preparation: 3, surveillance: 2, veille: 1 }[niveau] || 0;
  }

  /** Le système qui porte la situation : le plus haut cran, puis le plus proche. */
  function systemeMajeur() {
    var liste = (etat && etat.systemes) || [];
    if (!liste.length) return null;
    return liste.slice().sort(function (a, b) {
      var d = cranSysteme(b) - cranSysteme(a);
      if (d !== 0) return d;
      var pa = typeof a.prob7j === 'number' ? a.prob7j : -1;
      var pb = typeof b.prob7j === 'number' ? b.prob7j : -1;
      if (pb !== pa) return pb - pa;
      return (distancePour(a) || 0) - (distancePour(b) || 0);
    })[0];
  }

  function libelleTendance(s) {
    if (!s || !s.mouvement) return 'pas encore mesurable';
    return 'vers le ' + s.mouvement.directionFr
      + (s.mouvement.speedKmh ? ' à ' + s.mouvement.speedKmh + ' km/h' : '');
  }

  /**
   * Cartouche officiel : la partie droite du bandeau. Elle porte la donnée la
   * plus lourde de conséquences — la probabilité de formation à sept jours du
   * NHC — à une taille que rien d'autre ne conteste, et range l'estimation
   * maison sous un filet, hors de portée de toute confusion.
   */
  function cartoucheSituation(s) {
    if (!s) {
      return '<aside class="cartouche cartouche--calme">'
        + '<div class="cartouche__source">Officiel · NHC</div>'
        + '<div class="cartouche__valeur"><b>0</b></div>'
        + '<div class="cartouche__quoi">zone de développement suivie dans l\'Atlantique nord.</div>'
        + '<dl class="cartouche__lignes">'
        + '<div><dt>Dernier relevé</dt><dd>' + heureLocale(etat.genereLe) + '</dd></div>'
        + '<div><dt>Prochain</dt><dd>' + heureLocale(etat.prochaineMajPrevue) + '</dd></div>'
        + '</dl>'
        + '<div class="cartouche__kdl">La saison reste ouverte : c\'est le bon moment pour vérifier votre kit.</div>'
        + '</aside>';
    }

    var p7 = typeof s.prob7j === 'number' ? s.prob7j : null;
    var p48 = typeof s.prob48h === 'number' ? s.prob48h : null;
    var pot = (s.potentiel && s.potentiel.score) || null;
    var conf = s.potentiel && s.potentiel.confianceLabel;
    var d = distancePour(s);

    // Le cartouche porte le cran du système décrit, pas celui du territoire :
    // une probabilité de formation à 60 % ne peut pas s'afficher en vert sous
    // prétexte que l'archipel, lui, est au calme.
    return '<aside class="cartouche cartouche--n' + cranSysteme(s) + '">'
      + '<div class="cartouche__source">Officiel · NHC</div>'
      + (p7 === null
        ? '<div class="cartouche__valeur"><b>—</b></div>'
          + '<div class="cartouche__quoi">Le NHC ne publie pas de probabilité pour ce système.</div>'
        : '<div class="cartouche__valeur"><b>' + p7 + '</b><span>%</span></div>'
          + '<div class="cartouche__quoi">de chances de formation à sept jours</div>'
          + '<div class="cartouche__barre"><i style="width:' + p7 + '%"></i></div>')
      + '<dl class="cartouche__lignes">'
      + (p48 !== null ? '<div><dt>À 48 heures</dt><dd>' + p48 + ' %</dd></div>' : '')
      + '<div><dt>Distance</dt><dd>' + (nombre(d) || '—') + ' km</dd></div>'
      + '<div><dt>Déplacement</dt><dd>' + echapper(libelleTendance(s)) + '</dd></div>'
      + '</dl>'
      + '<div class="cartouche__kdl">'
      + '<span class="etiquette etiquette--kdl">Analyse KDL</span>'
      + (pot === null
        ? '<span>potentiel non calculable</span>'
        : '<span>potentiel <b>' + pot + '</b>/100'
          + (conf ? ' · confiance ' + echapper(conf.toLowerCase()) : '') + '</span>')
      + '</div>'
      + '</aside>';
  }

  function rendreSituation() {
    var terr = territoireActif();
    var s = { risque: terr.risque || etat.situation.risque, nbSystemes: etat.situation.nbSystemes,
      resume: resumePourTerritoire(terr) };
    // L'état affiché suit le niveau de risque réel du territoire, jamais le
    // ton du texte : un bandeau « à surveiller » au-dessus d'un risque
    // « Aucun » se contredirait sous les yeux du lecteur.
    var libelles = {
      imminent: 'Impact possible',
      preparation: 'Préparation conseillée',
      surveillance: 'Surveillance rapprochée',
      veille: 'Zone en veille',
      aucun: 'Situation calme',
    };
    var niveau = (terr.risque && terr.risque.niveau) || (s.risque && s.risque.niveau) || 'aucun';
    var classeTon = 'situation--n' + cranRisque(niveau);
    var libelleEtat = libelles[niveau] || libelles.aucun;
    var majeur = systemeMajeur();

    $('#situation').className = 'situation ' + classeTon;
    $('#situation').innerHTML =
      '<div class="situation__corps">'
      + '<div class="situation__etat"><span class="pastille"></span>' + libelleEtat + '</div>'
      + '<h1 class="situation__titre">' + echapper(s.resume.titre) + '</h1>'
      + '<p class="situation__detail">' + echapper(s.resume.detail) + '</p>'
      + '</div>'
      + cartoucheSituation(majeur)
      // Le pied court sous les deux colonnes : sur téléphone, la valeur
      // officielle arrive avant les horaires de collecte.
      + '<div class="situation__pied chiffres">'
      + '<div>Systèmes suivis<strong>' + s.nbSystemes + '</strong></div>'
      + '<div>Risque ' + echapper(terr.nom) + '<strong>'
      + echapper((terr.risque && terr.risque.label) || s.risque.label) + '</strong></div>'
      + '<div>Actualisé<strong>' + heureLocale(etat.genereLe) + '</strong></div>'
      + '<div>Prochaine mise à jour<strong>' + heureLocale(etat.prochaineMajPrevue) + '</strong></div>'
      + '</div>'
      + (etat.fraicheur
        ? '<div class="situation__fraicheur">' + echapper(libelleFraicheur())
          + ' — ' + echapper(etat.fraicheur.message || '')
          + ' Collecte KDL ' + ilYA(etat.genereLe) + '.</div>'
        : '');
  }

  /**
   * Deux durées coexistent et se confondaient à l'écran : l'âge du bulletin
   * officiel, publié quatre fois par jour, et celui de notre propre collecte.
   * Le libellé porte l'état du bulletin, mais il ne peut pas annoncer « À
   * jour » si nos données, elles, ne le sont plus — un état lu dans le cache
   * hors connexion, par exemple.
   */
  function libelleFraicheur() {
    var libelle = (etat.fraicheur && etat.fraicheur.libelle) || '';
    if (libelle === 'À jour' && ageDonnees() > SEUIL_DONNEES_ANCIENNES) {
      return 'Données locales anciennes';
    }
    return libelle;
  }

  function rendreCadran() {
    var canvas = $('#cadran');
    if (!canvas || !global_KdlCadranPret()) return;
    window.KdlCadran.dessiner(canvas, etat.systemes, {
      messageVide: 'Aucun système suivi dans l\'Atlantique',
      centreNom: territoireActif().nom,
      menacePour: menacePour,
      distancePour: distancePour,
    });
    window.KdlCadran.legende($('#cadran-legende'), etat.systemes);
  }

  function global_KdlCadranPret() { return !!window.KdlCadran; }

  function rendreListeSystemes() {
    var zone = $('#liste-systemes');
    if (!etat.systemes || etat.systemes.length === 0) {
      zone.innerHTML = '<div class="etat-vide">' + ICONES.calme
        + '<h3>Aucun système suivi</h3>'
        + '<p>Le National Hurricane Center ne surveille actuellement aucune zone de développement '
        + 'dans l\'Atlantique nord. Rien ne demande votre attention aujourd\'hui.</p>'
        + '<button class="bouton" type="button" data-vers="preparation">Vérifier mon kit de préparation</button>'
        + '</div>';
      return;
    }

    // Avec son article : « de la Martinique », mais « de Saint-Martin ».
    var terrNom = (territoireActif().article || '') + territoireActif().nom;
    var majeur = systemeMajeur();

    // Les systèmes se lisent du plus menaçant au plus lointain : l'ordre de la
    // liste est déjà une information.
    var ordonnes = etat.systemes.slice().sort(function (a, b) {
      var d = cranSysteme(b) - cranSysteme(a);
      if (d !== 0) return d;
      return (distancePour(a) || 0) - (distancePour(b) || 0);
    });

    zone.innerHTML = ordonnes.map(function (s) {
      var cran = cranSysteme(s);
      var potentiel = (s.potentiel && s.potentiel.score) || 0;
      var p7 = typeof s.prob7j === 'number' ? s.prob7j : null;

      var meta = [];
      meta.push('<span><b>' + nombre(distancePour(s)) + ' km</b> de ' + echapper(terrNom) + '</span>');
      if (s.statut) meta.push('<span>' + echapper(s.statut) + '</span>');
      if (s.mouvement) meta.push('<span>vers le ' + echapper(s.mouvement.directionFr) + ' à <b>' + s.mouvement.speedKmh + ' km/h</b></span>');
      if (s.intensiteKmh) meta.push('<span>vent <b>' + s.intensiteKmh + ' km/h</b></span>');

      return '<button class="systeme systeme--n' + cran + '" type="button"'
        + ' data-majeur="' + (majeur && majeur.id === s.id && cran > 0) + '"'
        + ' data-systeme="' + echapper(s.id) + '">'
        // Chiffre officiel : le seul de cette taille dans la carte.
        + '<div class="systeme__officiel">'
        + (p7 === null
          ? '<div class="systeme__prob systeme__prob--vide chiffres">n. d.</div>'
          : '<div class="systeme__prob chiffres">' + p7 + '<small>%</small></div>')
        + '<div class="systeme__prob-note">NHC · 7 j</div>'
        + '</div>'
        + '<div class="systeme__corps">'
        + '<div class="systeme__nom">' + echapper(s.nom || s.designation) + '</div>'
        + '<div class="systeme__meta">' + meta.join('') + '</div>'
        // Estimation maison : une barre hachurée, jamais un grand chiffre.
        + '<div class="systeme__kdl">'
        + '<span class="systeme__kdl-label">Analyse KDL</span>'
        + '<span class="systeme__kdl-barre"><i style="width:' + potentiel + '%"></i></span>'
        + '<span class="systeme__kdl-valeur chiffres">' + potentiel + '<small>/100</small></span>'
        + '</div>'
        + '</div>'
        + '<span class="systeme__chevron">' + ICONES.fleche + '</span>'
        + '</button>';
    }).join('');
  }

  function rendreLiensOfficiels() {
    var terr = territoireActif();
    // Les autorités changent d'un territoire à l'autre : on affiche celles du
    // territoire choisi, jamais celles d'un voisin.
    $('#liens-officiels').innerHTML =
      '<div class="bandeau bandeau--info">' + ICONES.info
      + '<div>' + echapper(terr.avertissement || '')
      + ' KDL Cyclone aide à comprendre, il ne décide pas.</div></div>'
      + (terr.liens || []).map(function (l) {
        return '<a class="lien-officiel" href="' + echapper(l.url) + '" target="_blank" rel="noopener noreferrer">'
          + '<div class="lien-officiel__texte"><div class="lien-officiel__nom">' + echapper(l.libelle) + '</div>'
          + '<div class="lien-officiel__note">'
          + (l.type === 'meteo' ? 'Service météorologique officiel' : 'Autorité de sécurité civile')
          + ' — ouvre un nouvel onglet</div></div>'
          + ICONES.externe + '</a>';
      }).join('');
  }

  // -------------------------------------------------------------- fiche système

  function rendreFiche(id, selecteurZone) {
    var s = (etat.systemes || []).find(function (x) { return x.id === id; });
    var zone = $(selecteurZone || '#fiche-systeme');
    if (!zone) return;
    if (!s) {
      zone.innerHTML = '<div class="etat-vide">' + ICONES.info
        + '<h3>Ce système n\'est plus suivi</h3>'
        + '<p>Il a été retiré de la surveillance officielle, ou l\'identifiant a changé '
        + 'lors de la dernière actualisation.</p>'
        + '<button class="bouton" type="button" data-vers="accueil">Revenir à la situation générale</button></div>';
      return;
    }
    if (!selecteurZone) systemeOuvert = id;

    var p = s.potentiel || {};
    var m = s.menace || {};
    var env = s.environnement || {};

    var html = '';

    // Identité
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<div style="display:flex;flex-wrap:wrap;gap:var(--e2);margin-bottom:var(--e3)">'
      + '<span class="etiquette etiquette--officiel">Suivi officiel NHC</span>'
      + (s.nom ? '<span class="etiquette etiquette--officiel">' + echapper(s.statut) + '</span>' : '')
      + '</div>'
      + '<h2 style="font-size:1.7rem">' + echapper(s.nom || s.designation) + '</h2>'
      + '<p style="color:var(--texte-doux);margin-top:var(--e2)">' + echapper(s.statut) + '</p>'
      + '<p style="margin-top:var(--e4);font-size:1.02rem">' + echapper(m.message || '') + '</p>'
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
      + 'Identifiant stable : <code>' + echapper(s.id) + '</code></p>'
      + '</div>';

    // Chiffres clés
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--officiel">Position et déplacement</h3>'
      + '<div class="stats">'
      + stat('Distance ' + territoireActif().nom, valeurOuIndispo(distancePour(s), 'km'), 'à vol d\'oiseau')
      + stat('Position', s.position
        ? '<span class="valeur">' + s.position.lat.toFixed(1) + '° N / ' + Math.abs(s.position.lon).toFixed(1) + '° O</span>'
        : '<span class="etiquette etiquette--indispo">Non disponible</span>', 'coordonnées officielles')
      + stat('Déplacement', s.mouvement
        ? '<span class="valeur">' + s.mouvement.speedKmh + ' <small>km/h</small></span>'
        : '<span class="etiquette etiquette--indispo">Non disponible</span>',
      s.mouvement ? 'vers le ' + echapper(s.mouvement.directionFr) + ' — source : ' + echapper(s.mouvement.origine) : 'pas encore mesurable')
      + stat('Intensité', s.intensiteKmh
        ? '<span class="valeur">' + s.intensiteKmh + ' <small>km/h</small></span>'
        : '<span class="etiquette etiquette--indispo">Sans objet</span>',
      s.intensiteKmh ? 'vent maximal soutenu' : 'système non nommé')
      + '</div></div>';

    // Probabilités officielles — toujours avant l'analyse KDL
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre"><span class="etiquette etiquette--officiel">Officiel</span> Probabilité de formation — NHC</h3>'
      + '<div class="stats">'
      + stat('Sous 48 heures', typeof s.prob48h === 'number'
        ? '<span class="valeur">' + s.prob48h + ' <small>%</small></span>'
        : '<span class="etiquette etiquette--indispo">Non publiée</span>',
      s.risque48hOfficiel ? 'risque ' + echapper(s.risque48hOfficiel) : '',
      null, 'stat--cran' + cranOfficiel(s.risque48hOfficiel))
      + stat('Sous 7 jours', typeof s.prob7j === 'number'
        ? '<span class="valeur">' + s.prob7j + ' <small>%</small></span>'
        : '<span class="etiquette etiquette--indispo">Non publiée</span>',
      s.risque7jOfficiel ? 'risque ' + echapper(s.risque7jOfficiel) : '',
      null, 'stat--cran' + cranOfficiel(s.risque7jOfficiel))
      + '</div>'
      + pastilleFraicheur(s.fraicheur, 'NHC')
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
      + 'Valeurs publiées par le National Hurricane Center. Elles priment sur toute analyse de cette application.</p>'
      + '</div>';

    // Potentiel KDL
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre"><span class="etiquette etiquette--kdl">Analyse KDL</span>'
      + '<span class="etiquette etiquette--experimental">Expérimental</span></h3>'
      + '<div class="stats" style="margin-bottom:var(--e4)">'
      + stat('Potentiel de développement', '<span class="valeur">' + (p.score != null ? p.score : '—') + ' <small>/100</small></span>', p.niveauLabel || '')
      + stat('Confiance', '<span class="valeur">' + (p.confiance != null ? p.confiance : '—') + ' <small>%</small></span>', p.confianceLabel || '')
      + stat('Facteurs mesurés', '<span class="valeur">' + (p.couverture != null ? p.couverture : '—') + ' <small>%</small></span>',
        (p.inconnus && p.inconnus.length) ? p.inconnus.length + ' facteur(s) manquant(s)' : 'tous les facteurs disponibles')
      + '</div>'
      + '<p style="font-size:1rem">' + echapper(p.resume || '') + '</p>'
      + (p.ecartNhc ? '<div class="bandeau bandeau--attention" style="margin-top:var(--e4)">' + ICONES.info
        + '<div>' + echapper(p.ecartNhc.message) + '</div></div>' : '')
      + '</div>';

    // Pourquoi ce niveau
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Pourquoi ce niveau de potentiel ?</h3>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e4);max-width:66ch">'
      + 'Chaque facteur est mesuré dans les modèles météorologiques ouverts, puis noté selon les '
      + 'conditions connues de formation d\'un cyclone. Touchez un facteur pour lire son explication.</p>'
      + '<div class="facteurs">'
      + (p.facteurs || []).map(rendreFacteur).join('')
      + '</div></div>';

    // Corridor et menace
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre"><span class="etiquette etiquette--kdl">Estimation KDL</span> Trajectoire et approche</h3>'
      + '<div class="stats" style="margin-bottom:var(--e4)">'
      + stat('Niveau pour ' + (territoireActif().article || '') + territoireActif().nom, '<span class="valeur" style="font-size:1.15rem">' + echapper((menacePour(s).niveauLabel) || m.niveauLabel || '—') + '</span>', '')
      + stat('Approche la plus proche', m.approche
        ? '<span class="valeur">' + nombre(m.approche.distanceKm) + ' <small>km</small></span>'
        : '<span class="etiquette etiquette--indispo">Non calculable</span>',
      m.approche ? '± ' + nombre(m.approche.rayonIncertitudeKm) + ' km' : 'déplacement inconnu')
      + stat('Fenêtre estimée', m.fenetre
        ? '<span style="font-size:.98rem;font-weight:650">' + echapper(m.fenetre) + '</span>'
        : '<span class="etiquette etiquette--indispo">Non estimable</span>', '')
      + '</div>'
      + '<div class="bandeau bandeau--info">' + ICONES.info + '<div>' + echapper(m.incertitude || '') + '</div></div>'
      + (s.coneOfficiel
        ? '<div class="bandeau bandeau--attention" style="margin-top:var(--e3)">' + ICONES.info
          + '<div>Un cône de prévision officiel est publié par le NHC pour ce système. Il est affiché sur la carte en trait plein rouge. '
          + 'Le corridor KDL, en pointillés, ne le remplace pas.</div></div>'
        : '')
      + (s.ilesProches && s.ilesProches.length
        ? '<p style="margin-top:var(--e4);font-size:.92rem;color:var(--texte-doux)">Îles situées à moins de 250 km du corridor indicatif : '
          + s.ilesProches.map(function (i) { return echapper(i.name) + ' (' + nombre(i.distanceKm) + ' km)'; }).join(', ') + '.</p>'
        : '')
      + '<div style="display:flex;flex-wrap:wrap;gap:var(--e2);margin-top:var(--e4)">'
      + '<button class="bouton bouton--principal" type="button" data-carte="' + echapper(s.id) + '">Voir sur la carte</button>'
      + '<button class="bouton" type="button" data-partager="' + echapper(s.id) + '">Partager cette fiche</button>'
      + '</div></div>';

    // Chronologie officielle des changements
    if (s.chronologie && s.chronologie.length) {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre">Ce qui a changé</h3>'
        + '<ol class="chronologie">'
        + s.chronologie.map(function (c) {
          return '<li class="chronologie__item' + (c.importance === 'majeur' ? ' chronologie__item--majeur' : '') + '">'
            + '<time>' + heureLocale(c.t, true) + '</time>'
            + '<span>' + echapper(c.texte) + '</span></li>';
        }).join('')
        + '</ol>'
        + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
        + 'Heures de Guadeloupe. Les valeurs précédentes sont conservées pour permettre '
        + 'de comparer, plus tard, l\'analyse KDL à l\'évolution réelle.</p>'
        + '</div>';
    }

    // Évolution
    var evo = s.evolutions || {};
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Évolution du potentiel</h3>'
      + '<div class="stats">'
      + ['potentiel6h', 'potentiel12h', 'potentiel24h'].map(function (cle, i) {
        var heures = [6, 12, 24][i];
        var e = evo[cle];
        if (!e) {
          return stat('Sur ' + heures + ' h', '<span class="etiquette etiquette--indispo">Pas encore d\'historique</span>',
            'l\'application doit avoir observé ce système depuis ' + heures + ' h');
        }
        var signe = e.delta > 0 ? '+' : '';
        return stat('Sur ' + heures + ' h', '<span class="valeur">' + signe + e.delta + ' <small>pts</small></span>',
          e.sens === 'hausse' ? 'en renforcement' : e.sens === 'baisse' ? 'en affaiblissement' : 'stable');
      }).join('')
      + '</div></div>';

    // Environnement mesuré
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre"><span class="etiquette etiquette--modele">Modèle</span> Données brutes</h3>'
      + '<div class="stats">'
      + stat('Température de la mer', valeurOuIndispo(env.sstC, '°C', 1), 'Open-Meteo Marine')
      + stat('Cisaillement 850–200 hPa', valeurOuIndispo(env.shearKmh, 'km/h'), 'différence vectorielle')
      + stat('Humidité 700 hPa', valeurOuIndispo(env.rh700, '%'), 'moyenne troposphère')
      + stat('Pression', valeurOuIndispo(env.pressureHpa, 'hPa'), 'niveau de la mer')
      + stat('Précipitations', valeurOuIndispo(env.precipMmH, 'mm/h', 1), 'convection modélisée')
      + stat('Rotation basses couches', valeurOuIndispo(env.lowLevelSpinKmh, 'km/h'), 'vorticité à 850 hPa')
      + stat('Accord des modèles', env.modelAgreement != null
        ? '<span class="valeur">' + Math.round(env.modelAgreement * 100) + ' <small>%</small></span>'
        : '<span class="etiquette etiquette--indispo">Non disponible</span>',
      env.nbModeles ? env.nbModeles + ' modèles comparés' : '')
      + stat('Houle sur zone', valeurOuIndispo(env.houleM, 'm', 1), 'hauteur significative')
      + '</div>'
      + pastilleFraicheur(s.fraicheurModele, 'Open-Meteo')
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e4)">'
      + 'Échéance du modèle : ' + echapper(env.heureModele || 'inconnue') + '. '
      + 'Source : Open-Meteo (GFS, ECMWF, ICON), licence CC BY 4.0.</p>'
      + '</div>';

    zone.innerHTML = html;
  }

  /**
   * Pictogrammes de grandeur physique. Chaque mesure a le sien : sept cartes
   * alignées ne doivent plus se distinguer par leur seul libellé.
   */
  var PICTO_DOMAINE = {
    vent: '<path d="M3 8h9a3 3 0 1 0-3-3"/><path d="M3 13h13a3.2 3.2 0 1 1-3.2 3.2"/><path d="M3 18h6"/>',
    pluie: '<path d="M7 13.5a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 13.5z"/><path d="M8.5 16.5l-1 3.5M12.5 16.5l-1 3.5M16.5 16.5l-1 3.5"/>',
    houle: '<path d="M2 9c2.6-2.4 5.2-2.4 7.8 0s5.6 2.4 8.2-.4"/><path d="M2 14c2.6-2.4 5.2-2.4 7.8 0s5.6 2.4 8.2-.4"/><path d="M2 19c2.6-2.4 5.2-2.4 7.8 0s5.6 2.4 8.2-.4"/>',
    pression: '<circle cx="12" cy="12" r="8.4"/><path d="M12 12l4-3.4"/><path d="M12 3.6v1.6M20.4 12h-1.6M12 20.4v-1.6M3.6 12h1.6"/>',
    thermique: '<path d="M14 13.6V5a2 2 0 1 0-4 0v8.6a4.2 4.2 0 1 0 4 0"/><path d="M12 9.5v6.2"/>',
    uv: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6l1.6-1.6M18 6l1.6-1.6"/>',
    sable: '<path d="M3 8.5h13M3 12h18M3 15.5h11M8 19h9"/><circle cx="18.5" cy="7.5" r="2.6"/>',
    soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.8M12 19.2V21M4.6 4.6l1.3 1.3M18.1 18.1l1.3 1.3M3 12h1.8M19.2 12H21M4.6 19.4l1.3-1.3M18.1 5.9l1.3-1.3"/>',
    mer: '<path d="M12 3.5s4.5 4.4 4.5 7.6a4.5 4.5 0 1 1-9 0C7.5 7.9 12 3.5 12 3.5"/><path d="M3 19c2.2-1.9 4.3-1.9 6.5 0s4.3 1.9 6.5 0 4.3-1.9 5-1.2"/>',
  };

  function pictoDomaine(nom) {
    if (!nom || !PICTO_DOMAINE[nom]) return '';
    return '<svg class="picto" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">'
      + PICTO_DOMAINE[nom] + '</svg>';
  }

  /**
   * Carte de mesure. `domaine` porte la couleur et le pictogramme de la
   * grandeur affichée ; sans lui, la carte reste neutre.
   */
  function stat(label, valeur, note, domaine, classe) {
    var d = domaine && PICTO_DOMAINE[domaine] ? domaine : null;
    return '<div class="stat' + (d ? ' stat--' + d : '') + (classe ? ' ' + classe : '') + '">'
      + '<div class="stat__tete">' + (d ? pictoDomaine(d) : '')
      + '<span class="stat__label">' + echapper(label) + '</span></div>'
      + '<div class="stat__valeur chiffres">' + valeur + '</div>'
      + (note ? '<div class="stat__note">' + note + '</div>' : '') + '</div>';
  }

  function rendreFacteur(f) {
    var classe = 'facteur facteur--' + f.verdict;
    var largeur = f.score === null ? 0 : Math.abs(f.score) * 50;
    var gauche = f.score === null ? 50 : (f.score >= 0 ? 50 : 50 - largeur);
    var decimales = (f.unit === '°C' || f.unit === 'mm/h') ? 1 : 0;
    var valeur = f.value === null
      ? '<span class="etiquette etiquette--indispo">—</span>'
      : nombre(f.value, decimales) + '&nbsp;' + f.unit;

    return '<div class="' + classe + '" data-ouvert="false">'
      + '<button class="facteur__tete" type="button" data-facteur="' + echapper(f.key) + '" aria-expanded="false">'
      + '<span class="facteur__nom">' + echapper(f.label) + '</span>'
      + '<span class="facteur__valeur chiffres">' + valeur + '</span>'
      + '<span class="facteur__fleche">' + ICONES.bas + '</span>'
      + '</button>'
      + '<div class="facteur__barre"><i style="left:' + gauche + '%;width:' + largeur + '%"></i></div>'
      + '<div class="facteur__corps">' + echapper(f.explanation) + '</div>'
      + '</div>';
  }

  // ------------------------------------------------------------- Guadeloupe

  function rendreGuadeloupe() {
    var terr = territoireActif();
    var c = terr.conditions && terr.conditions.maintenant;
    var mer = terr.mer;

    var html = '<h2 style="font-size:1.6rem;margin-bottom:var(--e2)">' + echapper(terr.nomLong || terr.nom) + '</h2>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e5)">'
      + echapper(terr.pays) + ' · heure locale (' + echapper(terr.fuseau || '') + ') — actualisé '
      + ilYA(etat.genereLe) + '.</p>';

    // Changer de territoire depuis cette page, sans remonter dans l'en-tête.
    if ((etat.territoires || []).length > 1) {
      html += '<div class="bandeau bandeau--info" style="align-items:center">' + ICONES.info
        + '<div>Vous consultez <strong>' + echapper(terr.nom) + '</strong>. '
        + 'Changez de territoire avec le sélecteur en haut de l\'écran.</div></div>';
    }

    // Vigilance officielle en tête : sur un territoire français, c'est elle qui
    // fait autorité, et elle passe donc avant l'estimation KDL. Relayée telle
    // quelle, jamais reformulée.
    var vig = terr.vigilanceOfficielle;
    if (vig && vig.niveau) {
      var actifs = vig.phenomenesActifs || [];
      html += '<div class="carte-bloc vigilance vigilance--' + echapper(vig.niveau) + '"'
        + ' style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre section-titre--officiel">'
        + '<span class="etiquette etiquette--officiel">Officiel</span> '
        + 'Vigilance Météo-France — ' + echapper(vig.zone) + '</h3>'
        + '<div class="vigilance__niveau">' + echapper(vig.niveauLibelle) + '</div>'
        + (actifs.length
          ? '<p class="vigilance__phenomenes">Phénomène(s) concerné(s) : <strong>'
            + actifs.map(echapper).join('</strong>, <strong>') + '</strong></p>'
          : '<p class="vigilance__phenomenes">Aucun phénomène en vigilance à cette heure.</p>')
        // Le phénomène « Cyclone » est la raison d'être de l'application : son
        // niveau est dit explicitement, même au vert. C'est précisément la
        // question que se pose le visiteur, et une réponse rassurante donnée
        // par l'autorité vaut mieux qu'un silence qu'il faut interpréter.
        + (function () {
          var cyc = (vig.phenomenes || []).filter(function (p) { return p.nom === 'Cyclone'; })[0];
          if (!cyc) return '';
          return '<p class="vigilance__cyclone vigilance--' + echapper(cyc.niveau) + '">'
            + 'Vigilance cyclone : <strong>' + echapper(cyc.niveauLibelle) + '</strong>'
            + (cyc.niveau === 'vert'
              ? ' — Météo-France ne signale aucun danger cyclonique pour ce territoire.'
              : '')
            + '</p>';
        }())
        + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
        + '<strong>Source : Météo-France</strong> — bulletin émis à '
        + heureLocale(vig.emisLe, true) + ' (heure de Guadeloupe), ' + heureUtc(vig.emisLe) + '. '
        + (vig.perime ? 'Dernière vigilance connue : la source n\'a pas répondu au dernier appel. ' : '')
        + 'Licence Ouverte 2.0 (Etalab). En cas d\'alerte, suivez exclusivement '
        + 'les consignes officielles.</p>'
        + '<a class="lien-officiel" href="' + echapper(vig.lien || 'https://vigilance.meteofrance.fr/fr')
        + '" target="_blank" rel="noopener noreferrer">'
        + '<div class="lien-officiel__texte"><div class="lien-officiel__nom">'
        + 'Consulter la vigilance officielle</div>'
        + '<div class="lien-officiel__note">Page Météo-France — ouvre un nouvel onglet</div></div>'
        + ICONES.externe + '</a>'
        + '</div>';
    }

    html += '<div class="carte-bloc bloc-risque bloc-risque--n' + cranRisque(terr.risque && terr.risque.niveau)
      + '" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--risque">Risque cyclonique local</h3>'
      + '<div class="bloc-risque__valeur">'
      + echapper(terr.risque.label) + '</div>'
      + '<p style="color:var(--texte-doux);margin-top:var(--e2);max-width:60ch">'
      + (!terr.systemesConcernes || terr.systemesConcernes.length === 0
        ? 'Aucun système suivi ne concerne ce territoire à cette heure.'
        : terr.systemesConcernes.length + ' système(s) font l\'objet d\'un suivi pour '
          + echapper(terr.nom) + '.')
      + '</p>'
      + ((terr.systemesConcernes || []).length
        ? '<div class="liste-systemes" style="margin-top:var(--e4)">'
          + terr.systemesConcernes.map(function (x) {
            return '<button class="systeme" type="button" data-systeme="' + echapper(x.id) + '">'
              + '<div class="systeme__corps"><div class="systeme__nom">' + echapper(x.nom) + '</div>'
              + '<div class="systeme__meta"><span>' + echapper(x.niveau) + '</span>'
              + '<span><b>' + nombre(x.distanceKm) + ' km</b></span></div></div>'
              + '<span class="systeme__chevron">' + ICONES.fleche + '</span></button>';
          }).join('')
          + '</div>'
        : '')
      + '<div class="bandeau bandeau--attention" style="margin-top:var(--e4)">' + ICONES.info
      + '<div><strong>Ce niveau est une estimation KDL.</strong> '
      + echapper(terr.avertissement || '') + '</div></div>'
      + '</div>';

    // Mesures réelles des stations Météo-France, présentées AVANT les sorties
    // de modèle : ce qui a été constaté prime sur ce qui a été calculé. Le
    // tampon plein marque l'officiel, conformément à la direction artistique.
    var obs = terr.observations;
    if (obs && obs.disponible) {
      var noteStation = function (m) {
        return m ? 'station à ' + nombre(m.distanceKm) + ' km' : '';
      };
      var val = function (m, unite, decimales) {
        return valeurOuIndispo(m ? m.valeur : null, unite, decimales);
      };

      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre section-titre--officiel">'
        + '<span class="etiquette etiquette--officiel">Mesuré</span> Relevés des stations</h3>'
        + '<div class="stats">'
        + stat('Vent moyen', val(obs.ventMoyenKmh, 'km/h'), noteStation(obs.ventMoyenKmh), 'vent')
        + stat('Rafales', val(obs.rafaleKmh, 'km/h'),
          obs.rafaleKmh ? noteStation(obs.rafaleKmh) : 'non mesurée par ce réseau', 'vent')
        + stat('Pluie sur une heure', val(obs.pluie1hMm, 'mm', 1), noteStation(obs.pluie1hMm), 'pluie')
        + stat('Pression', val(obs.pressionHpa, 'hPa'), noteStation(obs.pressionHpa), 'pression')
        + stat('Température', val(obs.temperatureC, '°C', 1), noteStation(obs.temperatureC), 'mer')
        + stat('Humidité', val(obs.humiditePct, '%'), noteStation(obs.humiditePct), 'pluie')
        + '</div>'
        // Les extrêmes du territoire : en veille, c'est le point le plus
        // exposé qui compte, pas la moyenne.
        + (obs.pressionMiniHpa || obs.ventMaxKmh || obs.pluieMaxMm
          ? '<h3 class="section-titre section-titre--officiel" style="margin-top:var(--e5)">'
            + 'Extrêmes relevés sur le territoire</h3>'
            + '<div class="stats">'
            + stat('Pression la plus basse', val(obs.pressionMiniHpa, 'hPa'),
              noteStation(obs.pressionMiniHpa), 'pression')
            + stat('Vent le plus fort', val(obs.ventMaxKmh, 'km/h'),
              noteStation(obs.ventMaxKmh), 'vent')
            + stat('Pluie la plus forte', val(obs.pluieMaxMm, 'mm', 1),
              noteStation(obs.pluieMaxMm), 'pluie')
            + '</div>'
          : '')
        + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e4)">'
        + '<strong>Source : Météo-France</strong> — mesuré à '
        + heureLocale(obs.mesureLe) + ' (heure de Guadeloupe), '
        + heureUtc(obs.mesureLe) + '. '
        + nombre(obs.stationsRetenues) + ' station(s) retenue(s) autour du territoire. '
        + 'Licence Ouverte 2.0 (Etalab). '
        + (obs.perime ? 'Dernière valeur connue : la source n\'a pas répondu au dernier appel. ' : '')
        + 'Ce sont des mesures constatées, pas des prévisions.</p>'
        + '</div>';
    }

    // Rafales prévues par ARPEGE. C'est la seule grandeur que les stations ne
    // mesurent pas et qui décide pourtant d'une mise à l'abri : elle vient donc
    // du modèle, et c'est écrit. L'encart s'efface de lui-même si la source ne
    // répond pas — une couche de confort ne doit pas ressembler à une panne.
    // La visibilité passe par une classe, jamais par un attribut `style` :
    // la politique de contenu de l'application interdit les styles inline, et
    // un `style="display:none"` y est purement et simplement ignoré.
    html += '<div class="carte-bloc bloc-modele est-cache" id="bloc-rafales">'
      + '<h3 class="section-titre section-titre--vent">'
      + '<span class="etiquette etiquette--modele">Modèle</span> Rafales prévues sur l\'arc antillais</h3>'
      + '<div class="echeances" role="group" aria-label="Échéance de la prévision">'
      + [0, 6, 12, 24].map(function (h) {
        return '<button class="echeance' + (h === 0 ? ' echeance--active' : '') + '" type="button"'
          + ' data-echeance="' + h + '">' + (h === 0 ? 'Maintenant' : '+' + h + ' h') + '</button>';
      }).join('')
      + '</div>'
      + '<div class="rafales-carte"><img id="img-rafales" alt="Carte des rafales prévues sur l\'arc antillais"'
      + ' decoding="async">'
      + '<svg id="reperes-rafales" class="rafales-reperes" viewBox="0 0 760 600"'
      + ' preserveAspectRatio="none" aria-hidden="true"></svg></div>'
      + '<p id="note-rafales" style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
      + '</p></div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre"><span class="etiquette etiquette--modele">Modèle</span> Conditions actuelles</h3>'
      + '<div class="stats">'
      + stat('Vent', valeurOuIndispo(c && c.ventKmh, 'km/h'), 'à 10 mètres', 'vent')
      + stat('Rafales', valeurOuIndispo(c && c.rafalesKmh, 'km/h'), '', 'vent')
      + stat('Pluie', valeurOuIndispo(c && c.pluieMmH, 'mm/h', 1), 'intensité horaire', 'pluie')
      + stat('Pression', valeurOuIndispo(c && c.pressionHpa, 'hPa'), '', 'pression')
      + stat('Houle', valeurOuIndispo(mer && mer.houleM, 'm', 1), 'hauteur significative', 'houle')
      + stat('Période de houle', valeurOuIndispo(mer && mer.periodeS, 's', 1), 'une longue période porte loin', 'houle')
      + stat('Température de la mer', valeurOuIndispo(mer && mer.sstC, '°C', 1), 'carburant d\'un système tropical', 'mer')
      + '</div>'
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e4)">'
      + '<strong>Source : Open-Meteo</strong> (modèles GFS, ECMWF et ICON), licence CC BY 4.0. '
      + 'Ce sont des valeurs calculées par des modèles, pas des mesures.</p>'
      + '</div>';

    var jours = (terr.conditions && terr.conditions.jours) || [];
    if (jours.length) {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre section-titre--vent">Cinq prochains jours</h3>'
        + '<div class="stats">'
        + jours.map(function (j) {
          var d = new Date(j.date + 'T12:00:00');
          var nom = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
          return stat(nom, valeurOuIndispo(j.rafalesMaxKmh, 'km/h'),
            j.pluieMm != null ? nombre(j.pluieMm, 1) + ' mm de pluie' : 'pluie non disponible', 'vent');
        }).join('')
        + '</div>'
        + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e4)">'
        + 'Rafales maximales prévues par modèle. Une prévision à cinq jours reste indicative : '
        + 'l\'incertitude croît fortement au-delà de 72 heures.</p>'
        + '</div>';
    }

    html += '<div class="carte-bloc">'
      + '<h3 class="section-titre">Autorités officielles — ' + echapper(terr.nom) + '</h3>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e4);max-width:62ch">'
      + echapper(terr.avertissement || '') + '</p>'
      + (terr.liens || []).map(function (l) {
        return '<a class="lien-officiel" href="' + echapper(l.url) + '" target="_blank" rel="noopener noreferrer">'
          + '<div class="lien-officiel__texte"><div class="lien-officiel__nom">' + echapper(l.libelle) + '</div>'
          + '<div class="lien-officiel__note">'
          + (l.type === 'meteo' ? 'Service météorologique officiel' : 'Autorité de sécurité civile')
          + '</div></div>' + ICONES.externe + '</a>';
      }).join('')
      + '</div>';

    $('#page-guadeloupe').innerHTML = html;
    brancherRafales();
  }

  /**
   * Carte des rafales prévues.
   *
   * L'encart reste caché tant qu'une image n'est pas réellement arrivée : mieux
   * vaut ne rien montrer qu'un cadre vide qu'on prendrait pour une panne de
   * l'application. L'échéance affichée est celle que le modèle a servie, pas
   * celle qu'on a demandée — les deux peuvent différer d'une heure.
   */
  function brancherRafales() {
    var bloc = $('#bloc-rafales');
    var img = $('#img-rafales');
    var note = $('#note-rafales');
    if (!bloc || !img) return;

    /**
     * Échéance réellement servie par le modèle.
     *
     * Le serveur arrondit à l'heure ronde UTC, parce qu'ARPEGE ne publie qu'à
     * ces heures-là. Le client doit faire le même calcul, sinon l'interface
     * annonce « 13 h 21 » sous une image valable pour 13 h 00 : sur une
     * prévision, une heure approximative est une heure fausse.
     */
    function echeanceReelle(heures) {
      var d = new Date();
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(d.getUTCHours() + heures);
      return d.toISOString();
    }

    /**
     * Repères géographiques posés sur l'image.
     *
     * L'image du modèle ne porte ni côte ni nom : des aplats de couleur sans
     * repère n'apprennent rien à personne. On projette donc les territoires
     * suivis, dont on connaît déjà les coordonnées. La projection est directe —
     * l'emprise est demandée en EPSG:4326, où latitude et longitude sont
     * linéaires — et le SVG s'étire exactement comme l'image.
     */
    function poserReperes() {
      var svg = $('#reperes-rafales');
      if (!svg) return;
      // Mêmes valeurs que l'emprise demandée au serveur (src/sources/arpege.js).
      var sud = 10; var ouest = -70; var nord = 22; var est = -55;
      var L = 760; var H = 600;

      var elements = (etat.territoires || []).filter(function (t) {
        return t.position && t.position.lat != null;
      }).map(function (t) {
        var x = ((t.position.lon - ouest) / (est - ouest)) * L;
        var y = ((nord - t.position.lat) / (nord - sud)) * H;
        if (x < 0 || x > L || y < 0 || y > H) return '';
        var actif = t.cle === (territoireActif() || {}).cle;
        return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (actif ? 6 : 4) + '"'
          + ' class="repere' + (actif ? ' repere--actif' : '') + '"></circle>'
          + '<text x="' + (x + 10).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '"'
          + ' class="repere__nom' + (actif ? ' repere__nom--actif' : '') + '">'
          + echapper(t.nom) + '</text>';
      });

      svg.innerHTML = elements.join('');
    }

    function charger(heures) {
      // L'image est servie par notre propre origine : `img-src 'self'` suffit.
      // Une première version passait par un blob, que la politique de contenu
      // rejetait sans un mot — l'encart restait vide sans erreur visible.
      img.onload = function () { bloc.classList.remove('est-cache'); poserReperes(); };
      img.onerror = function () { bloc.classList.add('est-cache'); };
      img.src = '/modele/rafales.png?h=' + heures;

      note.innerHTML = '<strong>Source : Météo-France</strong> — modèle ARPEGE 0,25°, '
        + 'échéance ' + echapper(heureLocale(echeanceReelle(heures), true))
        + ' (heure de Guadeloupe). Licence Ouverte 2.0 (Etalab). '
        + 'Ce sont des rafales <strong>prévues</strong>, pas mesurées : '
        + 'les stations antillaises ne relèvent pas cette grandeur.';
    }

    bloc.addEventListener('click', function (e) {
      var b = e.target.closest('[data-echeance]');
      if (!b) return;
      bloc.querySelectorAll('.echeance').forEach(function (x) {
        x.classList.toggle('echeance--active', x === b);
      });
      charger(Number(b.dataset.echeance));
    });

    charger(0);
  }

  // ------------------------------------------------------------ préparation

  function rendrePreparation() {
    var P = window.KdlPreparation;
    var avancement = P.lire();
    var faits = P.nbFaits(avancement);
    var total = P.total();
    var pct = Math.round((faits / total) * 100);
    var circonference = 2 * Math.PI * 32;

    var html = '<h2 style="font-size:1.6rem;margin-bottom:var(--e2)">Mode préparation</h2>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e5);max-width:62ch">'
      + 'Cette liste fonctionne sans connexion et votre avancement reste sur cet appareil. '
      + 'Préparez-la hors saison : le bon moment pour cocher ces cases, c\'est maintenant, pas à l\'annonce d\'un système.</p>';

    html += '<div class="prep-progression">'
      + '<div class="prep-progression__anneau">'
      + '<svg viewBox="0 0 74 74" width="74" height="74" aria-hidden="true">'
      + '<circle cx="37" cy="37" r="32" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="5"/>'
      + '<circle cx="37" cy="37" r="32" fill="none" stroke="#7fe0ff" stroke-width="5" stroke-linecap="round"'
      + ' stroke-dasharray="' + (circonference * pct / 100).toFixed(1) + ' ' + circonference.toFixed(1) + '"/>'
      + '</svg>'
      + '<div class="prep-progression__pct chiffres">' + pct + '%</div>'
      + '</div>'
      + '<div><div style="font-size:1.15rem;font-weight:700;letter-spacing:-.02em">'
      + faits + ' point' + (faits > 1 ? 's' : '') + ' sur ' + total + '</div>'
      + '<p style="opacity:.82;font-size:.92rem;margin-top:2px">'
      + (pct === 100 ? 'Votre kit est complet. Pensez à vérifier les dates de péremption chaque année.'
        : pct >= 60 ? 'Bonne base. Terminez les points restants avant le pic de saison.'
          : 'À compléter tranquillement, un point à la fois.')
      + '</p></div></div>';

    html += P.GROUPES.map(function (g) {
      var faitsGroupe = g.items.filter(function (i) { return avancement[i.id]; }).length;
      return '<section class="prep-groupe">'
        + '<h3 class="prep-groupe__titre">' + echapper(g.titre)
        + '<span class="prep-groupe__compte chiffres">' + faitsGroupe + '/' + g.items.length + '</span></h3>'
        + '<p style="color:var(--texte-doux);font-size:.9rem;margin-bottom:var(--e3);max-width:62ch">' + echapper(g.intro) + '</p>'
        + g.items.map(function (i) {
          var fait = !!avancement[i.id];
          return '<label class="prep-item" data-fait="' + fait + '">'
            + '<input type="checkbox" data-prep="' + echapper(i.id) + '"' + (fait ? ' checked' : '') + '>'
            + '<span class="prep-item__texte">'
            + '<span class="prep-item__nom">' + echapper(i.nom) + '</span>'
            + '<span class="prep-item__detail">' + echapper(i.detail) + '</span>'
            + '</span></label>';
        }).join('')
        + '</section>';
    }).join('');

    html += '<div class="carte-bloc">'
      + '<h3 class="section-titre">Numéros utiles</h3>'
      + '<div class="stats">'
      + stat('Secours (Europe)', '<span class="valeur">112</span>', 'depuis tout téléphone')
      + stat('SAMU', '<span class="valeur">15</span>', 'urgence médicale')
      + stat('Pompiers', '<span class="valeur">18</span>', 'incendie, secours')
      + stat('Gendarmerie / Police', '<span class="valeur">17</span>', '')
      + '</div>'
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e4)">'
      + 'N\'appelez les secours qu\'en cas d\'urgence vitale : pendant un événement, les lignes doivent rester libres.</p>'
      + '<button class="bouton" type="button" id="reinitialiser-prep" style="margin-top:var(--e4)">Réinitialiser ma liste</button>'
      + '</div>'
      + '<p style="color:var(--texte-faible);font-size:.84rem;margin-top:var(--e5);text-align:center">'
      + 'Cette liste fonctionne sans connexion. Un service gratuit KDLTech, conçu en Guadeloupe.</p>';

    $('#page-preparation').innerHTML = html;
  }

  // ------------------------------------------------------------ provenance

  /**
   * Rappel permanent de la provenance des données, en pied de page.
   *
   * Une application de veille doit pouvoir répondre en un coup d'œil à
   * « d'où sort ce chiffre ». La page Sources donne le détail ; cette ligne
   * donne l'essentiel partout, y compris sur la carte et en pleine alerte,
   * avec l'état réel de chaque source au moment de la dernière collecte.
   */
  function rendreProvenance() {
    var zone = $('#pied-provenance');
    if (!zone) return;

    var sources = etat.sources || [];
    if (!sources.length) { zone.innerHTML = ''; return; }

    zone.innerHTML = '<span style="color:var(--texte-faible)">Données fournies par&nbsp;:</span> '
      + sources.map(function (s) {
        var dispo = s.etat && s.etat.disponible;
        var mode = (s.etat && s.etat.mode) || '';
        // Le titre au survol porte le détail ; la ligne reste courte.
        var infobulle = echapper(s.nom + ' — ' + s.role + ' (' + s.licence + ')'
          + (mode ? ' · ' + mode : ''));
        return '<span class="provenance__source" title="' + infobulle + '">'
          + '<span class="provenance__pastille provenance__pastille--'
          + (dispo ? 'ok' : 'ko') + '" aria-hidden="true"></span>'
          + echapper(nomCourtSource(s))
          + '</span>';
      }).join('<span style="color:var(--texte-faible)"> · </span>')
      + ' <button class="lien-texte" type="button" data-vers="sources">Tout le détail</button>';
  }

  /** Nom court, lisible d'un coup d'œil, sans perdre l'identité de la source. */
  function nomCourtSource(s) {
    var courts = {
      nhc: 'NHC (NOAA)',
      openmeteo: 'Open-Meteo',
      meteofrance: 'Météo-France',
      satellite: 'GOES-19 (NOAA)',
    };
    return courts[s.cle] || s.nom;
  }

  // ---------------------------------------------------------------- sources

  function rendreSources() {
    var html = '<h2 style="font-size:1.6rem;margin-bottom:var(--e2)">Sources, méthode et limites</h2>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e5);max-width:64ch">'
      + 'KDL Cyclone n\'invente aucune donnée. Chaque information affichée vient d\'une source '
      + 'ouverte et identifiée, ou d\'un calcul dont la méthode est décrite ici.</p>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Comment lire l\'application</h3>'
      + '<div style="display:grid;gap:var(--e3)">'
      + [
        ['etiquette--officiel', 'Officiel', 'Publié tel quel par le National Hurricane Center ou Météo-France. Fait foi.'],
        ['etiquette--modele', 'Modèle', 'Sortie brute d\'un modèle météorologique. Une prévision, pas une observation.'],
        ['etiquette--kdl', 'Analyse KDL', 'Calcul de cette application à partir des données de modèle.'],
        ['etiquette--experimental', 'Expérimental', 'Méthode maison, non validée par un organisme météorologique.'],
        ['etiquette--indispo', 'Non disponible', 'La donnée manque. Elle n\'est jamais remplacée par une estimation.'],
        ['etiquette--perime', 'Périmé', 'L\'information n\'a pas été renouvelée à temps.'],
      ].map(function (l) {
        return '<div style="display:flex;gap:var(--e3);align-items:flex-start">'
          + '<span class="etiquette ' + l[0] + '" style="flex:none;min-width:110px;justify-content:center">' + l[1] + '</span>'
          + '<span style="color:var(--texte-doux);font-size:.92rem">' + l[2] + '</span></div>';
      }).join('')
      + '</div></div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Sources de données</h3>'
      + (etat.sources || []).map(function (s) {
        var dispo = s.etat && s.etat.disponible;
        return '<a class="lien-officiel" href="' + echapper(s.url) + '" target="_blank" rel="noopener noreferrer">'
          + '<div class="lien-officiel__texte">'
          + '<div class="lien-officiel__nom">' + echapper(s.nom)
          + ' <span class="etiquette ' + (dispo ? 'etiquette--officiel' : 'etiquette--perime') + '">'
          + (dispo ? echapper(s.etat.mode) : 'indisponible') + '</span></div>'
          + '<div class="lien-officiel__note">' + echapper(s.role) + ' — ' + echapper(s.licence) + '</div>'
          + '</div>' + ICONES.externe + '</a>';
      }).join('')
      + '</div>';

    if (etat.outlookOfficiel && etat.outlookOfficiel.texte) {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre"><span class="etiquette etiquette--officiel">Officiel</span> Tropical Weather Outlook — texte intégral</h3>'
        + '<p style="color:var(--texte-doux);font-size:.88rem;margin-bottom:var(--e3)">'
        + 'Bulletin publié par le National Hurricane Center le '
        + heureLocale(etat.outlookOfficiel.emisLe, true) + ' (heure de Guadeloupe). Texte original en anglais, non traduit.</p>'
        + '<div class="texte-officiel">' + echapper(etat.outlookOfficiel.texte) + '</div>'
        + '</div>';
    }

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Ce que cette application ne fait pas</h3>'
      + '<ul style="color:var(--texte-doux);line-height:1.7;padding-left:1.1rem;max-width:64ch">'
      + '<li>Elle ne déclenche aucune alerte. Seules Météo-France et la préfecture le font.</li>'
      + '<li>Elle ne produit pas de cône de prévision. Le cône affiché, quand il existe, vient du NHC.</li>'
      + '<li>Elle n\'annonce pas de trajectoire certaine : au-delà de 72 heures, l\'incertitude dépasse souvent 300 km.</li>'
      + '<li>Elle ne remplace pas une radio à piles, seul média encore disponible quand tout tombe.</li>'
      + '<li>Elle ne collecte aucune donnée personnelle et n\'affiche aucune publicité.</li>'
      + '</ul></div>';

    html += '<div class="carte-bloc">'
      + '<h3 class="section-titre">Attributions</h3>'
      + '<ul style="color:var(--texte-doux);line-height:1.7;padding-left:1.1rem">'
      + (etat.attributions || []).map(function (a) { return '<li>' + echapper(a) + '</li>'; }).join('')
      + '<li>Fond de carte : Natural Earth (domaine public), simplifié et hébergé localement.</li>'
      + '</ul>'
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e4)">'
      + 'KDL Cyclone est développé en Guadeloupe par KDLTech. Application gratuite, sans publicité, '
      + 'sans compte et sans suivi. Les appels aux sources sont faits par le serveur : '
      + 'votre navigateur ne contacte jamais un service tiers.</p>'
      + '</div>';

    $('#page-sources').innerHTML = html;
  }

  // ------------------------------------------------------------- KDLTech

  var KDLTECH = {
    site: 'https://kdl-tech.fr',
    decouvrir: 'https://kdl-tech.fr/?utm_source=kdl-cyclone&utm_medium=referral&utm_campaign=service-gratuit',
    carte: 'https://kdl-tech.fr/carte.html',
    telephone: '0690 70 60 08',
    whatsapp: 'https://wa.me/590690706008',
    email: 'karim.delucia@kdl-tech.fr',
    zone: 'Les Abymes et alentours, Guadeloupe',
    horaires: 'Du lundi au vendredi, 8 h – 18 h · fermé le week-end',
    tiktok: 'https://www.tiktok.com/@kdltech',
    facebook: 'https://www.facebook.com/profile.php?id=61588286166391&locale=fr_FR',
    // Identité légale officielle (avis SIRENE du 21/08/2026). Source unique de
    // vérité : KDL_BRAND/legal.json. Ne jamais inventer une valeur absente.
    exploitant: 'Karim Laurent De Lucia',
    formeJuridique: 'Entrepreneur individuel',
    siren: '423 471 481',
    siret: '423 471 481 00022',
    ape: '95.11Z',
    apeLibelle: 'Réparation d\'ordinateurs et d\'équipements périphériques',
    adresse: 'LD Caraque, Rue Narcisse Louis, 97139 Les Abymes, Guadeloupe',
    tva: 'TVA non applicable, article 293 B du CGI',
    hebergeur: 'OVH SAS',
    hebergeurAdresse: '2 rue Kellermann, 59100 Roubaix, France',
    hebergeurTelephone: '1007',
    hebergeurSite: 'https://www.ovhcloud.com',
  };

  /**
   * En vigilance élevée, la présence commerciale s'efface : l'information de
   * sécurité passe avant tout le reste.
   */
  function periodeSensible() {
    if (!etat || !etat.situation) return false;
    return ['preparation', 'imminent'].indexOf(etat.situation.risque.niveau) !== -1;
  }

  function rendreSignature() {
    var bloc = $('#signature-kdltech');
    if (periodeSensible() || vueCourante === 'apropos') {
      bloc.hidden = true;
      return;
    }
    bloc.hidden = false;
    bloc.innerHTML =
      '<img class="signature__logo" src="/icons/logo-96.png" alt="" width="40" height="40">'
      + '<p class="signature__texte"><strong>Une technologie KDLTech au service des Antilles.</strong> '
      + 'KDL Cyclone est un service gratuit conçu en Guadeloupe par KDLTech pour rendre la veille '
      + 'tropicale plus claire, accessible et utile aux habitants des Antilles.</p>'
      + '<div class="signature__actions">'
      + '<button class="bouton bouton--discret" type="button" data-vers="apropos">Comment c\'est fait</button>'
      + '<a class="bouton bouton--discret" href="' + KDLTECH.decouvrir + '" target="_blank" rel="noopener noreferrer" data-kdltech>Découvrir KDLTech</a>'
      + '</div>';
  }

  function rendreApropos() {
    var html = '<h2 style="font-size:1.7rem;margin-bottom:var(--e2)">À propos de KDL Cyclone</h2>'
      + '<p style="color:var(--texte-doux);font-size:1.02rem;margin-bottom:var(--e6);max-width:62ch">'
      + 'Un service gratuit conçu en Guadeloupe par KDLTech.</p>';

    // Version installée et vérification à la demande : personne ne devrait
    // avoir à deviner s'il utilise la dernière version.
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--kdl">Version installée</h3>'
      + '<div class="version-bloc">'
      + '<div><b id="version-installee" class="chiffres">…</b>'
      + '<span id="version-detail">Lecture en cours…</span></div>'
      + '<button class="bouton" type="button" id="verifier-maj">Vérifier les mises à jour</button>'
      + '</div></div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Pourquoi cette application existe</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'Chaque saison, la même scène se répète aux Antilles : une onde tropicale quitte l\'Afrique, '
      + 'les captures d\'écran circulent, les commentaires s\'emballent, et personne ne sait vraiment '
      + 'si le système va se creuser ou se dissoudre en route.</p>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'L\'information officielle existe, elle est excellente, mais elle est en anglais, technique, '
      + 'et dispersée entre plusieurs sites. Entre le bulletin brut du National Hurricane Center et '
      + 'la rumeur sur les réseaux, il manquait quelque chose au milieu.</p>'
      + '<p style="max-width:66ch">'
      + 'KDL Cyclone rassemble ces sources, les traduit en français courant, et explique ce que les '
      + 'chiffres veulent dire. L\'objectif tient en une phrase : comprendre tôt, se préparer calmement.</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Une mission gratuite</h3>'
      + '<p style="max-width:66ch">'
      + 'L\'application est gratuite et le restera. Pas de publicité, pas de compte à créer, '
      + 'pas d\'adresse électronique à donner, pas de revente de données. Elle est construite '
      + 'sur des données météorologiques ouvertes et hébergée sur l\'infrastructure existante de '
      + 'KDLTech : son coût de fonctionnement est proche de zéro, et rien n\'oblige donc à la monétiser.</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Fiabilité et transparence</h3>'
      + '<ul style="line-height:1.75;padding-left:1.1rem;max-width:66ch;color:var(--texte-doux)">'
      + '<li><strong style="color:var(--texte)">La source officielle passe toujours en premier.</strong> '
      + 'La probabilité du NHC est affichée avant l\'analyse KDL, et en cas de désaccord, c\'est elle qui fait foi.</li>'
      + '<li><strong style="color:var(--texte)">Une donnée manquante est affichée comme manquante.</strong> '
      + 'Elle n\'est jamais remplacée par une estimation qui aurait l\'air d\'une mesure.</li>'
      + '<li><strong style="color:var(--texte)">Chaque information porte son étiquette</strong> : officielle, '
      + 'issue d\'un modèle, ou calculée par KDL.</li>'
      + '<li><strong style="color:var(--texte)">L\'heure de la donnée est toujours visible</strong>, '
      + 'et une information vieillissante est signalée comme telle.</li>'
      + '<li><strong style="color:var(--texte)">Aucun cône de prévision n\'est fabriqué.</strong> '
      + 'Le cône affiché, quand il existe, est celui du NHC, transporté tel quel.</li>'
      + '</ul></div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Les limites de l\'analyse</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'Le « potentiel KDL » est une lecture automatique de l\'environnement d\'un système : '
      + 'température de la mer, cisaillement, humidité, rotation, air saharien, accord des modèles. '
      + 'C\'est une méthode maison, expérimentale, qui n\'a été validée par aucun organisme météorologique.</p>'
      + '<p style="max-width:66ch">'
      + 'Elle aide à comprendre pourquoi un système se renforce ou s\'essouffle. Elle ne prévoit rien, '
      + 'et elle ne déclenche aucune alerte. Seules Météo-France et la préfecture le font.</p>'
      + '<div class="bandeau bandeau--attention" style="margin-top:var(--e4)">' + ICONES.info
      + '<div>KDLTech n\'est ni un organisme météorologique officiel, ni un partenaire de Météo-France, '
      + 'du National Hurricane Center, de la préfecture ou de la sécurité civile.</div></div>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">La technologie derrière KDL Cyclone</h3>'
      + '<div class="services">'
      + [
        ['Agrégation de données ouvertes', 'Le serveur interroge en continu les bulletins et fichiers géographiques du National Hurricane Center, puis trois modèles météorologiques mondiaux, et réconcilie le tout en une seule vision cohérente.'],
        ['Analyse automatisée', 'Neuf facteurs de cyclogenèse sont mesurés, pondérés et traduits en français courant, avec un niveau de confiance calculé à partir de la couverture réelle des données.'],
        ['Cartographie autonome', 'La carte est dessinée par l\'application elle-même, à partir de contours géographiques libres hébergés en local. Aucun service cartographique tiers n\'est appelé.'],
        ['Fonctionnement hors connexion', 'Le dernier état connu et toute la liste de préparation restent consultables sans réseau — précisément quand on en a besoin.'],
        ['Application installable', 'KDL Cyclone s\'installe sur un téléphone comme une application classique, depuis le navigateur, sans passer par un magasin d\'applications.'],
        ['Sécurité et vie privée', 'Politique de sécurité du contenu stricte, aucun script externe, aucun cookie, aucun traceur publicitaire. Le navigateur ne contacte jamais un service tiers.'],
        ['Hébergement et supervision', 'Le service tourne sur l\'infrastructure KDLTech, supervisée en continu, avec collecte automatique et journal des incidents.'],
      ].map(function (s) {
        return '<div class="service"><h4>' + echapper(s[0]) + '</h4><p>' + echapper(s[1]) + '</p></div>';
      }).join('')
      + '</div>'
      + '<p style="color:var(--texte-faible);font-size:.84rem;margin-top:var(--e4)">'
      + 'Zéro dépendance externe au moment de l\'exécution : l\'application n\'embarque aucune '
      + 'bibliothèque tierce, ce qui réduit d\'autant sa surface d\'attaque.</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Le rôle de KDLTech</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e4)">'
      + 'KDLTech accompagne particuliers et professionnels en dépannage informatique, '
      + 'assistance à distance, création de sites web et développement d\'applications intelligentes. '
      + 'KDL Cyclone est né de ce savoir-faire, et il en est la démonstration publique.</p>'
      + '<dl class="contact-liste">'
      + '<div><dt>Téléphone</dt><a href="tel:+590690706008" data-kdltech>' + KDLTECH.telephone + '</a></div>'
      + '<div><dt>WhatsApp</dt><a href="' + KDLTECH.whatsapp + '" target="_blank" rel="noopener noreferrer" data-kdltech>Écrire sur WhatsApp</a></div>'
      + '<div><dt>Courriel</dt><a href="mailto:' + KDLTECH.email + '" data-kdltech>' + KDLTECH.email + '</a></div>'
      + '<div><dt>Zone</dt><span>' + KDLTECH.zone + '</span></div>'
      + '<div><dt>Horaires</dt><span>' + KDLTECH.horaires + '</span></div>'
      + '<div><dt>Site</dt><a href="' + KDLTECH.decouvrir + '" target="_blank" rel="noopener noreferrer" data-kdltech>kdl-tech.fr</a></div>'
      + '</dl>'
      + '<div style="display:flex;flex-wrap:wrap;gap:var(--e2);margin-top:var(--e5)">'
      + '<a class="bouton bouton--principal" href="' + KDLTECH.decouvrir + '" target="_blank" rel="noopener noreferrer" data-kdltech>Découvrir KDLTech</a>'
      + '<a class="bouton" href="' + KDLTECH.carte + '" target="_blank" rel="noopener noreferrer" data-kdltech>Carte de visite</a>'
      + '</div></div>';

    html += '<div class="carte-bloc">'
      + '<h3 class="section-titre">Mesure d\'audience</h3>'
      + '<p style="max-width:66ch;color:var(--texte-doux)">'
      + 'Pour savoir si ce service est réellement utile, l\'application compte un petit nombre '
      + 'd\'événements agrégés : visites par page, installations, partages, clics vers le site KDLTech '
      + 'et erreurs techniques. Aucune adresse IP, aucun cookie, aucun identifiant d\'appareil, '
      + 'aucune position géographique et aucun parcours individuel ne sont enregistrés. '
      + 'Les compteurs sont publics et consultables à tout moment.</p>'
      + '<p style="margin-top:var(--e3)"><a class="lien-texte" href="/api/audience" target="_blank" rel="noopener noreferrer">Voir les compteurs</a></p>'
      + '</div>';

    $('#page-apropos').innerHTML = html;
    remplirVersion();
  }

  /**
   * Mentions légales. KDL Cyclone est un site à part entière : il porte donc sa
   * propre identité d'éditeur, son hébergeur et ses conditions, sans renvoyer
   * l'internaute vers kdl-tech.fr pour une information qui lui est obligatoire.
   * Toutes les valeurs viennent de KDLTECH, alimenté par KDL_BRAND/legal.json.
   */
  function rendreMentions() {
    var html = '<h2 style="font-size:1.7rem;margin-bottom:var(--e2)">Mentions légales</h2>'
      + '<p style="color:var(--texte-doux);font-size:1.02rem;margin-bottom:var(--e6);max-width:62ch">'
      + 'Qui édite KDL Cyclone, où le service est hébergé, et dans quelles conditions il s\'utilise.</p>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--kdl">Éditeur du site</h3>'
      + '<dl class="contact-liste">'
      + '<div><dt>Nom commercial</dt><span>KDL TECH (KDLTech)</span></div>'
      + '<div><dt>Exploitant</dt><span>' + KDLTECH.exploitant + '</span></div>'
      + '<div><dt>Forme juridique</dt><span>' + KDLTECH.formeJuridique + '</span></div>'
      + '<div><dt>SIRET</dt><span>' + KDLTECH.siret + '</span></div>'
      + '<div><dt>SIREN</dt><span>' + KDLTECH.siren + '</span></div>'
      + '<div><dt>Code APE</dt><span>' + KDLTECH.ape + ' — ' + KDLTECH.apeLibelle + '</span></div>'
      + '<div><dt>Siège</dt><span>' + KDLTECH.adresse + '</span></div>'
      + '<div><dt>TVA</dt><span>' + KDLTECH.tva + '</span></div>'
      + '<div><dt>Directeur de la publication</dt><span>' + KDLTECH.exploitant + '</span></div>'
      + '<div><dt>Courriel</dt><a href="mailto:' + KDLTECH.email + '" data-kdltech>' + KDLTECH.email + '</a></div>'
      + '<div><dt>Téléphone</dt><a href="tel:+590690706008" data-kdltech>' + KDLTECH.telephone + '</a></div>'
      + '<div><dt>Site</dt><a href="' + KDLTECH.decouvrir + '" target="_blank" rel="noopener noreferrer" data-kdltech>kdl-tech.fr</a></div>'
      + '</dl></div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Hébergement</h3>'
      + '<dl class="contact-liste">'
      + '<div><dt>Hébergeur</dt><span>' + KDLTECH.hebergeur + '</span></div>'
      + '<div><dt>Adresse</dt><span>' + KDLTECH.hebergeurAdresse + '</span></div>'
      + '<div><dt>Téléphone</dt><span>' + KDLTECH.hebergeurTelephone + '</span></div>'
      + '<div><dt>Site</dt><a href="' + KDLTECH.hebergeurSite + '" target="_blank" rel="noopener noreferrer">ovhcloud.com</a></div>'
      + '</dl>'
      + '<p style="max-width:66ch;margin-top:var(--e3);color:var(--texte-doux)">'
      + 'Le service tourne sur un serveur loué par KDLTech chez cet hébergeur, en France. '
      + 'Aucune donnée n\'est confiée à un service tiers.</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Nature du service et responsabilité</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'KDL Cyclone est un service d\'information gratuit. Il ne fait l\'objet d\'aucune vente, '
      + 'd\'aucun abonnement et d\'aucune création de compte.</p>'
      + '<div class="bandeau bandeau--attention" style="margin-bottom:var(--e3)">' + ICONES.info
      + '<div>KDLTech n\'est ni un organisme météorologique officiel, ni un partenaire de Météo-France, '
      + 'du National Hurricane Center, de la préfecture ou de la sécurité civile. En cas d\'alerte, '
      + 'suivez exclusivement les consignes officielles.</div></div>'
      + '<p style="max-width:66ch">'
      + 'Les informations sont fournies à titre indicatif, sans garantie de disponibilité ni '
      + 'd\'exactitude, et ne se substituent en aucun cas à la vigilance officielle. '
      + 'L\'éditeur ne peut être tenu responsable d\'une décision prise sur la seule base de '
      + 'ce service.</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Données personnelles</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'KDL Cyclone ne demande aucun compte, n\'utilise aucun cookie publicitaire et ne dépose '
      + 'aucun traceur tiers. Les préférences (thème, territoire, liste de préparation) restent '
      + 'dans le navigateur, sur l\'appareil.</p>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'La mesure d\'audience se limite à des compteurs agrégés : aucune adresse IP, aucun '
      + 'identifiant d\'appareil, aucune position géographique et aucun parcours individuel ne '
      + 'sont enregistrés. Aucune donnée n\'est vendue ni transmise à un tiers.</p>'
      + '<p style="max-width:66ch">'
      + 'Pour toute question relative aux données, écrivez à '
      + '<a href="mailto:' + KDLTECH.email + '" data-kdltech>' + KDLTECH.email + '</a>. '
      + 'Une réclamation peut être adressée à la CNIL '
      + '(<a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">cnil.fr</a>).</p>'
      + '</div>';

    html += '<div class="carte-bloc">'
      + '<h3 class="section-titre">Propriété intellectuelle et sources</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'Le nom KDL TECH, le logo et l\'application KDL Cyclone appartiennent à l\'éditeur. '
      + 'Les données météorologiques restent la propriété de leurs producteurs — National Hurricane '
      + 'Center (NOAA), Météo-France, Open-Meteo — et sont reprises selon leurs conditions '
      + 'de réutilisation.</p>'
      + '<p style="max-width:66ch">'
      + '<button class="lien-texte" type="button" data-vers="sources">Voir le détail des sources et de la méthode</button></p>'
      + '</div>';

    $('#page-mentions').innerHTML = html;
  }

  // ----------------------------------------------------------- installation

  /**
   * Encart d'invitation. Il n'apparaît qu'à partir de la troisième visite,
   * jamais au premier affichage : l'utilisateur doit d'abord voir à quoi sert
   * l'application. Un refus la fait disparaître pour deux mois.
   */
  function rendreInvitationInstallation() {
    var zone = $('#invitation-installation');
    if (!zone) return;
    var I = window.KdlInstallation;
    if (!I) { zone.innerHTML = ''; return; }

    // Navigateur intégré à une application : l'installation y est impossible,
    // quoi qu'on fasse. On propose le seul chemin qui marche — rouvrir la page
    // dans le vrai navigateur — et on le propose tout de suite, sans attendre
    // la troisième visite : ces visiteurs arrivent d'un partage et ne
    // reviendront peut-être jamais.
    var haut = $('#passerelle-sociale');
    var integre = I.navigateurIntegre();
    if (integre && !I.estInstallee()) {
      if (haut) { haut.innerHTML = passerelleNavigateur(integre); zone.innerHTML = ''; }
      else { zone.innerHTML = passerelleNavigateur(integre); }
      return;
    }
    if (haut) haut.innerHTML = '';

    if (!I.inviterMaintenant() || periodeSensible()) {
      zone.innerHTML = '';
      return;
    }

    var auto = I.disponible();
    zone.innerHTML =
      '<div class="invitation">'
      + '<div class="invitation__texte">'
      + '<h3>Gardez la veille tropicale à portée de main</h3>'
      + '<p>Installez gratuitement KDL Cyclone pour accéder plus rapidement aux dernières '
      + 'informations et conserver les conseils essentiels hors connexion.</p>'
      + '<p class="invitation__gages">Gratuite • Sans publicité • Sans compte</p>'
      + '</div>'
      + '<div class="invitation__actions">'
      + (auto
        ? '<button class="bouton bouton--principal" type="button" id="installer-maintenant">Installer gratuitement</button>'
        : '<button class="bouton bouton--principal" type="button" data-vers="installer">Installer gratuitement</button>')
      + '<button class="bouton bouton--discret" type="button" id="continuer-web">Continuer sur le Web</button>'
      + '</div></div>';
  }

  /**
   * Passerelle vers le vrai navigateur.
   *
   * Trois chemins, du plus direct au plus sûr : ouvrir Chrome, copier
   * l'adresse, ou suivre la marche à suivre. Aucun ne promet ce qui n'est pas
   * possible — on ne peut pas installer une application depuis Facebook, et le
   * dire clairement vaut mieux qu'un bouton qui échoue en silence.
   */
  function passerelleNavigateur(integre) {
    var I = window.KdlInstallation;
    var p = I.plateforme();
    var surIOS = p.code === 'ios';

    return '<div class="passerelle">'
      + '<div class="passerelle__tete">'
      + '<span class="passerelle__pastille">' + ICONES.info + '</span>'
      + '<div><h3>Installez gratuitement KDL Cyclone</h3>'
      + '<p>' + echapper(integre.nom) + ' ouvre le site dans son navigateur intégré, '
      + 'qui ne sait pas installer d\'application. '
      + (surIOS
        ? 'Ouvrez cette page dans Safari, puis choisissez « Sur l\'écran d\'accueil ».'
        : 'Ouvrez-la dans Chrome pour l\'installer et recevoir les mises à jour.')
      + '</p></div></div>'
      + '<div class="passerelle__actions">'
      + (surIOS
        ? '<button class="bouton bouton--principal" type="button" data-vers="installer">Voir la marche à suivre</button>'
        : '<a class="bouton bouton--principal" id="ouvrir-chrome" href="' + echapper(I.lienChrome()) + '">Ouvrir dans Chrome</a>')
      + '<button class="bouton" type="button" id="copier-lien">Copier le lien</button>'
      + '<button class="bouton bouton--discret" type="button" id="aide-navigateur">Comment faire ?</button>'
      + '</div>'
      + '<p class="passerelle__aide" id="aide-navigateur-texte" hidden>'
      + (surIOS
        ? 'Touchez le bouton Partager en bas de l\'écran, puis « Ouvrir dans Safari ».'
        : 'Touchez ⋮ en haut à droite, puis « Ouvrir dans le navigateur externe ».')
      + '</p>'
      + '<p class="passerelle__note">Application gratuite, sans publicité et sans compte. '
      + 'Vous pouvez aussi continuer ici : toutes les informations sont déjà accessibles.</p>'
      + '</div>';
  }

  function rendreInstaller() {
    var I = window.KdlInstallation;
    var installee = I.estInstallee();
    var mode = I.instructions();
    var p = I.plateforme();

    var html = '<h2 style="font-size:1.7rem;margin-bottom:var(--e2)">Installer KDL Cyclone</h2>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e6);max-width:62ch">'
      + 'Gratuite • Sans publicité • Sans compte. L\'application s\'installe depuis votre '
      + 'navigateur, sans passer par un magasin d\'applications, et se désinstalle comme '
      + 'n\'importe quelle autre.</p>';

    if (installee) {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<div class="bandeau bandeau--info" style="margin:0">' + ICONES.info
        + '<div><strong>KDL Cyclone est déjà installée sur cet appareil.</strong> '
        + 'Vous pouvez la lancer depuis votre écran d\'accueil ou votre menu d\'applications. '
        + 'Pour la retirer, désinstallez-la comme une application ordinaire.</div></div>'
        + '</div>';
    } else {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre">' + echapper(mode.titre) + '</h3>';

      if (mode.auto) {
        html += '<p style="max-width:62ch;margin-bottom:var(--e4)">'
          + 'Votre navigateur permet l\'installation directe. Une fenêtre de confirmation '
          + 's\'ouvrira ; rien ne sera installé sans votre accord.</p>'
          + '<button class="bouton bouton--principal" type="button" id="installer-maintenant">Installer gratuitement</button>';
      } else {
        html += '<ol style="line-height:1.8;padding-left:1.3rem;max-width:62ch;margin-bottom:var(--e4)">'
          + mode.etapes.map(function (e) { return '<li>' + echapper(e) + '</li>'; }).join('')
          + '</ol>';
      }

      html += '<p style="color:var(--texte-doux);font-size:.9rem;margin-top:var(--e4);max-width:62ch">'
        + echapper(mode.note) + '</p>'
        + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
        + 'Instructions adaptées à votre appareil (' + echapper(p.nom) + ').</p>'
        + '</div>';
    }

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Ce que l\'installation apporte</h3>'
      + '<div class="services">'
      + [
        ['Ouverture immédiate', 'L\'application se lance depuis votre écran d\'accueil, dans sa propre fenêtre, sans barre de navigateur.'],
        ['Hors connexion', 'Le dernier état connu, la carte et toute la liste de préparation restent consultables sans réseau.'],
        ['Léger', 'Quelques centaines de kilooctets. Aucune place perdue sur votre téléphone.'],
        ['Réversible', 'Se désinstalle comme n\'importe quelle application, sans laisser de compte ni de données ailleurs.'],
      ].map(function (s) {
        return '<div class="service"><h4>' + echapper(s[0]) + '</h4><p>' + echapper(s[1]) + '</p></div>';
      }).join('')
      + '</div></div>';

    html += '<div class="carte-bloc">'
      + '<h3 class="section-titre">Pas envie d\'installer ?</h3>'
      + '<p style="max-width:62ch;margin-bottom:var(--e4)">'
      + 'C\'est très bien aussi. KDL Cyclone fonctionne entièrement dans le navigateur, '
      + 'avec exactement les mêmes informations. L\'installation ne fait que raccourcir '
      + 'le chemin.</p>'
      + '<button class="bouton" type="button" data-vers="accueil">Continuer sur le Web</button>'
      + '</div>';

    $('#page-installer').innerHTML = html;
  }

  /**
   * Mise à jour contrôlée : jamais de rechargement imposé. Et pendant une
   * vigilance élevée, la proposition attend — on ne coupe pas quelqu'un qui
   * lit une information de sécurité.
   */
  function proposerMiseAJour(enregistrement) {
    var zone = $('#bandeau-maj');
    if (!zone || zone.dataset.propose === 'true') return;
    zone.dataset.propose = 'true';

    // La proposition n'est plus jamais différée.
    //
    // Elle l'était de cinq minutes en cinq minutes tant que le risque restait
    // « préparation » ou « imminent », pour ne pas distraire pendant une
    // alerte. L'intention était juste, l'effet inverse du but : c'est
    // précisément pendant un épisode cyclonique qu'un correctif compte, et le
    // report pouvait durer aussi longtemps que l'épisode lui-même.
    //
    // Le compromis retenu : toujours visible, mais discret quand une alerte
    // est en cours — la mise à jour ne doit pas rivaliser d'attention avec la
    // situation elle-même.
    var sensible = periodeSensible();
    zone.innerHTML = '<div class="bandeau ' + (sensible ? 'bandeau--discret' : 'bandeau--info') + '">'
      + ICONES.info
      + '<div class="bandeau__texte">'
      + (sensible
        ? 'Une version corrigée est disponible.'
        : 'Une nouvelle version de KDL Cyclone est disponible.')
      + '</div>'
      + '<button class="bouton' + (sensible ? ' bouton--discret' : ' bouton--principal')
      + '" type="button" id="appliquer-maj">Mettre à jour</button>'
      + '</div>';
  }

  /* ------------------------------------------------------ cycle de vie PWA */

  var CLE_VERROU_MAJ = 'kdl-cyclone-maj-en-cours';

  /**
   * Applique la version en attente, en disant à chaque instant où l'on en est.
   *
   * Le piège, découvert en reproduisant le scénario réel : un service worker
   * **en attente** est arrêté par le navigateur et n'entend pas toujours le
   * message qu'on lui envoie. Le clic partait alors dans le vide, sans erreur,
   * et le bouton paraissait mort.
   *
   * La séquence tenue ici :
   *   1. écouter `controllerchange` AVANT d'envoyer quoi que ce soit ;
   *   2. demander au navigateur de vérifier s'il existe une nouvelle version ;
   *   3. réveiller le service worker en attente, ou attendre la fin de
   *      l'installation de celui qui arrive ;
   *   4. si rien ne bascule dans le temps imparti, désinscrire et recharger —
   *      la page repart du réseau, donc dans la version neuve ;
   *   5. ne recharger qu'une seule fois, grâce à un verrou de session.
   */
  function appliquerMiseAJour(bouton) {
    var etat = function (texte, actif) {
      if (!bouton) return;
      bouton.textContent = texte;
      bouton.disabled = !actif;
    };

    var termine = false;
    var recharger = function () {
      if (termine) return;
      termine = true;
      try { sessionStorage.setItem(CLE_VERROU_MAJ, String(Date.now())); } catch (e) { /* refusé */ }
      location.reload();
    };

    if (!('serviceWorker' in navigator)) {
      etat('Rechargement…', false);
      return recharger();
    }

    // L'écoute précède l'envoi : sinon la bascule peut arriver avant qu'on
    // écoute, et l'application attendrait un signal déjà passé.
    navigator.serviceWorker.addEventListener('controllerchange', recharger, { once: true });

    etat('Recherche d\'une mise à jour…', false);

    var minuterie = setTimeout(function () {
      if (termine) return;
      etat('Installation…', false);
    }, 1200);

    var abandon = setTimeout(function () {
      if (termine) return;
      clearTimeout(minuterie);
      // Dernier recours : on repart proprement plutôt que de laisser
      // l'utilisateur devant un bouton qui tourne dans le vide.
      etat('Installation…', false);
      navigator.serviceWorker.getRegistration().then(function (enr) {
        var finir = function () { recharger(); };
        if (enr && enr.unregister) enr.unregister().then(finir, finir);
        else finir();
      }, recharger);
    }, 6000);

    navigator.serviceWorker.getRegistration().then(function (enr) {
      if (!enr) { clearTimeout(abandon); return recharger(); }

      var reveiller = function (worker) {
        if (!worker) return false;
        worker.postMessage({ type: 'SKIP_WAITING' });
        return true;
      };

      var suivre = function () {
        if (enr.waiting) {
          etat('Nouvelle version installée', false);
          return reveiller(enr.waiting);
        }
        if (enr.installing) {
          etat('Téléchargement de la nouvelle version…', false);
          var arrivant = enr.installing;
          arrivant.addEventListener('statechange', function () {
            if (arrivant.state === 'installed') {
              etat('Installation…', false);
              reveiller(enr.waiting || arrivant);
            }
          });
          return true;
        }
        return false;
      };

      if (suivre()) return undefined;

      // Rien en attente : on interroge le serveur avant de conclure.
      return enr.update().then(function () {
        if (suivre()) return;
        clearTimeout(abandon);
        clearTimeout(minuterie);
        dejaAJour(bouton);
      }).catch(function () {
        clearTimeout(abandon);
        clearTimeout(minuterie);
        echecMiseAJour(bouton);
      });
    }).catch(function () {
      clearTimeout(abandon);
      clearTimeout(minuterie);
      echecMiseAJour(bouton);
    });
    return undefined;
  }

  /** Aucune version plus récente : on le dit, plutôt que de ne rien faire. */
  function dejaAJour(bouton) {
    versionServeur().then(function (v) {
      var texte = 'KDL Cyclone est déjà à jour'
        + (v && v.version ? ' — version ' + v.version : '');
      if (bouton) {
        bouton.textContent = texte;
        bouton.disabled = true;
      }
      signaler(texte);
      var zone = $('#bandeau-maj');
      if (zone) setTimeout(function () { zone.innerHTML = ''; zone.dataset.propose = 'false'; }, 4000);
    });
  }

  function echecMiseAJour(bouton) {
    if (bouton) {
      bouton.textContent = 'Mise à jour impossible — Réessayer';
      bouton.disabled = false;
    }
    signaler('La mise à jour n\'a pas abouti. Vérifiez votre connexion, puis réessayez.');
  }

  /**
   * Version publiée par le serveur. Demandée sans cache et horodatée : c'est
   * le seul moyen d'être certain de ne pas lire une réponse mise de côté par
   * un intermédiaire.
   */
  function versionServeur() {
    return fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /** Affiche la version réellement servie, et celle qui tourne dans l'onglet. */
  function remplirVersion() {
    var cible = $('#version-installee');
    var detail = $('#version-detail');
    if (!cible) return;
    versionServeur().then(function (v) {
      if (!v) {
        cible.textContent = 'hors connexion';
        if (detail) detail.textContent = 'La version du serveur n\'a pas pu être lue.';
        return;
      }
      cible.textContent = v.version;
      if (!detail) return;
      var quand = v.deployeLe ? heureLocale(v.deployeLe, true) : null;
      detail.textContent = 'Build ' + v.build
        + (quand ? ' · déployée le ' + quand : '')
        + ' · minimum compatible ' + v.versionMinimale + '.';
    });
  }

  /** Vérification manuelle, disponible en permanence depuis la page À propos. */
  function verifierMiseAJour(bouton) {
    appliquerMiseAJour(bouton);
  }

  // ----------------------------------------------------------- satellite

  var boucle = null;

  function rendreControlesSatellite() {
    var zone = $('#satellite-controles');
    if (!zone) return;

    if (!boucle || !boucle.meta || !boucle.meta.images || !boucle.meta.images.length) {
      var poids = null;
      zone.innerHTML = '<div class="satellite-invite">'
        + '<div><b>Boucle satellite</b>'
        + '<span>Images réelles GOES-19 (NOAA), deux heures d\'observation.</span></div>'
        + '<button class="bouton" type="button" id="charger-satellite">Charger la boucle</button>'
        + '</div>';
      return;
    }

    var image = boucle.imageCourante();
    var total = boucle.images.length;
    var direct = boucle.estAuDirect();
    var reduit = window.KdlSatellite.mouvementReduit();

    zone.innerHTML = '<div class="satellite">'
      + '<div class="satellite__tete">'
      + '<div class="satellite__heure">'
      + '<b>' + (image ? heureLocale(image.instant, true) : '—') + '</b>'
      + '<span>' + (image ? heureUtc(image.instant) : '') + ' · image ' + (boucle.index + 1) + ' sur ' + total + '</span>'
      + '</div>'
      + (direct
        ? '<span class="etiquette etiquette--officiel">Direct</span>'
        : '<button class="bouton bouton--discret" type="button" id="sat-direct">Revenir au direct</button>')
      + '</div>'

      + '<div class="satellite__transport">'
      + '<button class="bouton-icone" type="button" id="sat-prec" aria-label="Image précédente">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>'
      + '<button class="bouton-icone" type="button" id="sat-play" aria-label="'
      + (boucle.lecture ? 'Mettre en pause' : 'Lancer l\'animation') + '">'
      + (boucle.lecture
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>')
      + '</button>'
      + '<button class="bouton-icone" type="button" id="sat-suiv" aria-label="Image suivante">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></button>'
      + '<input type="range" id="sat-curseur" min="0" max="' + (total - 1) + '" value="' + boucle.index
      + '" aria-label="Position dans la boucle satellite">'
      + '<div class="satellite__vitesses" role="group" aria-label="Vitesse de lecture">'
      + [0.5, 1, 2].map(function (v) {
        return '<button class="bouton-vitesse' + (boucle.vitesse === v ? ' est-actif' : '')
          + '" type="button" data-vitesse="' + v + '">' + String(v).replace('.', ',') + '×</button>';
      }).join('')
      + '</div></div>'

      + '<p class="satellite__source">'
      + echapper(boucle.meta.source) + ' · ' + echapper(boucle.meta.libelleCanal)
      + ' · <span class="etiquette etiquette--officiel">Observation</span>'
      + (boucle.economie ? ' · <span class="etiquette etiquette--modele">Économie de données</span>' : '')
      + (boucle.echecs ? ' · ' + boucle.echecs + ' image(s) non chargée(s)' : '')
      + '</p>'
      + (reduit
        ? '<p class="satellite__source">Animations réduites : la lecture automatique est désactivée, '
          + 'utilisez le curseur ou les flèches.</p>'
        : '')
      + '<p class="satellite__resume" role="status">' + echapper(resumeAccessible()) + '</p>'
      + '</div>';
  }

  /**
   * Résumé lisible de ce que montre l'animation. La couleur et le mouvement ne
   * doivent jamais être le seul moyen de comprendre une évolution.
   */
  function resumeAccessible() {
    if (!etat || !etat.systemes || !etat.systemes.length) {
      return 'Aucun système suivi : la boucle montre la couverture nuageuse de la zone.';
    }
    var phrases = [];
    etat.systemes.slice(0, 2).forEach(function (s) {
      var bout = (s.nom || s.designation) + ' se trouve à '
        + nombre(distancePour(s)) + ' km de ' + (territoireActif().article || '') + territoireActif().nom;
      var d = s.evolutions && s.evolutions.distance24h;
      if (d && Math.abs(d.delta) > 50) {
        bout += ', soit ' + nombre(Math.abs(d.delta)) + ' km '
          + (d.delta < 0 ? 'de moins' : 'de plus') + " qu'il y a 24 heures";
      }
      var p = s.evolutions && s.evolutions.potentiel24h;
      if (p && Math.abs(p.delta) >= 3) {
        bout += '. Son potentiel KDL est passé de ' + Math.round(p.avant)
          + ' à ' + Math.round(p.maintenant) + ' sur 100';
      }
      phrases.push(bout + '.');
    });
    return phrases.join(' ');
  }

  function chargerSatellite() {
    var zone = $('#satellite-controles');
    boucle = new window.KdlSatellite.Boucle({
      surChangement: function () {
        if (carte) carte.dessiner();
        rendreControlesSatellite();
      },
    });

    zone.innerHTML = '<div class="satellite-invite"><div><b>Lecture des métadonnées…</b></div></div>';

    boucle.chargerMeta().then(function (meta) {
      if (!meta || !meta.images || !meta.images.length) {
        zone.innerHTML = '<div class="bandeau bandeau--attention">' + ICONES.info
          + '<div>La boucle satellite n\'est pas disponible pour le moment. '
          + 'Le reste de la carte fonctionne normalement.</div></div>';
        return;
      }
      var poids = boucle.poidsEstime();
      // Le poids est annoncé, et le téléchargement ne commence qu'ensuite.
      zone.innerHTML = '<div class="satellite-invite">'
        + '<div><b>' + poids.nombre + ' images · environ ' + poids.ko + ' Ko</b>'
        + '<span>Observations GOES-19 des deux dernières heures'
        + (boucle.economie ? ', allégées pour votre connexion' : '') + '.</span></div>'
        + '<button class="bouton bouton--principal" type="button" id="confirmer-satellite">Charger</button>'
        + '</div>';
    });
  }

  function confirmerChargementSatellite() {
    var zone = $('#satellite-controles');
    zone.innerHTML = '<div class="satellite-invite"><div><b>Chargement…</b>'
      + '<span id="sat-progression">0 %</span></div></div>';

    boucle.charger(function (fait, total) {
      var p = $('#sat-progression');
      if (p) p.textContent = Math.round((fait / total) * 100) + ' %';
    }).then(function (ok) {
      if (!ok) {
        zone.innerHTML = '<div class="bandeau bandeau--attention">' + ICONES.info
          + '<div>Aucune image n\'a pu être chargée. La carte reste utilisable. '
          + '<button class="lien-texte" type="button" id="charger-satellite">Réessayer</button></div></div>';
        return;
      }
      if (carte) {
        carte.attacherBoucle(boucle);
        carte.definirCalque('satellite', true);
        var caseSat = document.querySelector('[data-calque="satellite"]');
        if (caseSat) caseSat.checked = true;
      }
      rendreControlesSatellite();
      // La lecture ne démarre pas d'elle-même si l'utilisateur a demandé
      // des animations réduites.
      if (!window.KdlSatellite.mouvementReduit()) boucle.jouer();
    });
  }

  // ------------------------------------------------------------------ météo

  var bulletins = {};

  /** Pictogrammes maison : aucun jeu d'icônes tiers aux droits incertains. */
  /**
   * Pictogrammes météo maison — aucun jeu d'icônes tiers aux droits incertains.
   *
   * Chaque dessin est composé de couches nommées : le soleil, la lune, le
   * nuage, les gouttes, l'éclair. Ces couches portent leur propre couleur, qui
   * vient de la feuille de style et suit donc le thème. Un soleil doré, un
   * nuage gris-bleu et des gouttes bleues se distinguent d'un coup d'œil,
   * là où un tracé d'une seule couleur obligeait à déchiffrer la forme.
   */
  var PICTO = {
    soleil:
      '<g class="p-soleil"><circle cx="12" cy="12" r="4.6"/>'
      + '<path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></g>',
    lune:
      '<g class="p-lune"><path d="M20 14.6A8.6 8.6 0 1 1 9.4 4a6.9 6.9 0 0 0 10.6 10.6"/></g>',
    'soleil-voile':
      '<g class="p-soleil"><circle cx="12" cy="11" r="4"/>'
      + '<path d="M12 3v1.8M4.9 6.3l1.3 1.3M19.1 6.3l-1.3 1.3M3 11h1.8M19.2 11H21"/></g>'
      + '<g class="p-voile"><path d="M5 18h14"/></g>',
    'lune-voile':
      '<g class="p-lune"><path d="M18 12.4A6.6 6.6 0 1 1 10.6 5a5.3 5.3 0 0 0 7.4 7.4"/></g>'
      + '<g class="p-voile"><path d="M5 19h14"/></g>',
    'soleil-nuage':
      '<g class="p-soleil"><circle cx="9" cy="9" r="3.2"/>'
      + '<path d="M9 3.4v1.4M4.6 5.6l1 1M3.4 10h1.4"/></g>'
      + '<g class="p-nuage"><path d="M8.5 19a3.5 3.5 0 0 1 .3-7 4.6 4.6 0 0 1 8.7 1.2A3 3 0 0 1 17 19z"/></g>',
    'lune-nuage':
      '<g class="p-lune"><path d="M15.5 9.5A4.5 4.5 0 1 1 10.5 4a3.6 3.6 0 0 0 5 5"/></g>'
      + '<g class="p-nuage"><path d="M8.5 19a3.5 3.5 0 0 1 .3-7 4.6 4.6 0 0 1 8.7 1.2A3 3 0 0 1 17 19z"/></g>',
    nuage:
      '<g class="p-nuage"><path d="M7.5 19a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 19z"/></g>',
    brume:
      '<g class="p-brume"><path d="M4 9h16M4 13h16M6 17h12M6 5h12"/></g>',
    bruine:
      '<g class="p-nuage"><path d="M7.5 15a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 15z"/></g>'
      + '<g class="p-pluie"><path d="M9 18v1.5M13 18v2M17 18v1.5"/></g>',
    pluie:
      '<g class="p-nuage"><path d="M7.5 14a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 14z"/></g>'
      + '<g class="p-pluie"><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/></g>',
    'pluie-forte':
      '<g class="p-nuage p-nuage--dense"><path d="M7.5 13a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 13z"/></g>'
      + '<g class="p-pluie"><path d="M7.5 16l-1.5 5M11.5 16l-1.5 5M15.5 16l-1.5 5M19 16l-1.5 5"/></g>',
    averse:
      '<g class="p-nuage"><path d="M7.5 14a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 14z"/></g>'
      + '<g class="p-pluie"><path d="M9 17l-1.5 4M14 17l-1.5 4"/></g>',
    'averse-forte':
      '<g class="p-nuage p-nuage--dense"><path d="M7.5 13a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 13z"/></g>'
      + '<g class="p-pluie"><path d="M8 16l-2 5.5M12.5 16l-2 5.5M17 16l-2 5.5"/></g>',
    orage:
      '<g class="p-nuage p-nuage--dense"><path d="M7.5 13a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 13z"/></g>'
      + '<g class="p-eclair"><path d="M13 14l-3 4.5h3l-2 4"/></g>',
    neige:
      '<g class="p-nuage"><path d="M7.5 14a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 9.9 1.4A3.4 3.4 0 0 1 17 14z"/></g>'
      + '<g class="p-neige"><path d="M9 18h.01M12.5 20h.01M16 18h.01"/></g>',
  };

  /**
   * Nature du ciel, déduite du code OMM. Elle donne sa couleur au bandeau des
   * conditions du moment : un midi dégagé et une nuit d'orage ne peuvent pas
   * avoir le même fond.
   */
  function ciel(code, nuit) {
    var c = typeof code === 'number' ? code : 3;
    if (c >= 95) return 'orage';
    if (c >= 51) return 'pluie';
    if (nuit) return c <= 1 ? 'nuit' : 'nuit-nuageuse';
    if (c === 0) return 'jour-clair';
    if (c <= 2) return 'jour-voile';
    return 'couvert';
  }

  function picto(nom, taille) {
    return '<svg class="picto" viewBox="0 0 24 24" width="' + (taille || 24) + '" height="'
      + (taille || 24) + '" aria-hidden="true">' + (PICTO[nom] || PICTO.nuage) + '</svg>';
  }

  /**
   * Une alerte locale se reconnaît d'abord à son phénomène : le vent, l'UV et
   * la brume de sable n'ont ni la même couleur, ni le même pictogramme, ni la
   * même unité. Le seuil franchi est affiché avec la valeur : le lecteur voit
   * de combien on dépasse, pas seulement qu'on dépasse.
   */
  var ALERTES_LOCALES = {
    rafales: { domaine: 'vent', unite: 'km/h', decimales: 0 },
    pluie: { domaine: 'pluie', unite: 'mm', decimales: 1 },
    uv: { domaine: 'uv', unite: 'indice', decimales: 1 },
    poussiere: { domaine: 'sable', unite: 'µg/m³', decimales: 0 },
  };

  function rendreAlerteLocale(a) {
    var def = ALERTES_LOCALES[a.type] || { domaine: null, unite: '', decimales: 0 };
    var texte = String(a.texte || '');
    var coupe = texte.indexOf(':');
    var titre = coupe > 0 ? texte.slice(0, coupe).trim() : texte.replace(/\.$/, '');
    var detail = coupe > 0 ? texte.slice(coupe + 1).trim() : '';
    var valeur = nombre(a.valeur, def.decimales);
    var seuil = nombre(a.min, def.decimales);

    return '<div class="alerte alerte--' + echapper(a.type || 'autre') + '"'
      + ' data-intensite="' + echapper(a.niveau || 'faible') + '">'
      + '<span class="alerte__icone">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true">' + (PICTO_DOMAINE[def.domaine] || '') + '</svg>'
      + '</span>'
      + '<div class="alerte__texte"><b>' + echapper(titre) + '</b>'
      + (detail ? '<span>' + echapper(detail.charAt(0).toUpperCase() + detail.slice(1)) + '</span>' : '')
      + '</div>'
      + (valeur === null ? ''
        : '<div class="alerte__valeur chiffres">' + valeur
          + '<small>' + echapper(def.unite) + (seuil !== null ? ' · seuil ' + seuil : '') + '</small></div>')
      + '</div>';
  }

  /**
   * Position de chaque journée sur une réglette de température commune aux dix
   * jours : une semaine plus chaude que la suivante se voit sans lire un seul
   * chiffre. L'échelle est bornée à 1 °C minimum pour éviter une barre nulle
   * quand toutes les journées se ressemblent.
   */
  function reglettesJours(jours) {
    var valeurs = (jours || []).reduce(function (acc, j) {
      if (typeof j.tempMin === 'number') acc.push(j.tempMin);
      if (typeof j.tempMax === 'number') acc.push(j.tempMax);
      return acc;
    }, []);
    var bas = valeurs.length ? Math.min.apply(null, valeurs) : 0;
    var haut = valeurs.length ? Math.max.apply(null, valeurs) : 1;
    var etendue = Math.max(haut - bas, 1);

    return (jours || []).map(function (j, i) {
      var min = typeof j.tempMin === 'number' ? j.tempMin : bas;
      var max = typeof j.tempMax === 'number' ? j.tempMax : haut;
      return {
        jour: j,
        index: i,
        debut: Math.round(((min - bas) / etendue) * 100),
        fin: Math.round(((max - bas) / etendue) * 100),
      };
    });
  }

  /* ------------------------------------------------- lieux de la météo */

  var CLE_LIEU = 'kdl-cyclone-lieu';
  var communes = null;
  var chargementCommunes = null;

  /**
   * Le lieu réclamé par l'adresse d'ouverture, retenu avant que quoi que ce
   * soit ne réécrive l'URL.
   *
   * Sans cette copie, un lien partagé perdait sa commune : la liste des
   * communes arrive par le réseau, donc au premier rendu on ne pouvait pas
   * valider « deshaies » — on le rejetait, et la navigation réécrivait aussitôt
   * l'adresse sans le paramètre. Le lieu était perdu avant même d'avoir pu être
   * reconnu. On fait donc crédit à l'URL jusqu'à ce que la liste permette de
   * trancher.
   */
  var lieuDemande = (function () {
    try { return new URLSearchParams(location.search).get('lieu') || ''; }
    catch (e) { return ''; }
  })();

  /** Liste des communes couvertes, demandée une seule fois par session. */
  function chargerCommunes() {
    if (communes) return Promise.resolve(communes);
    if (chargementCommunes) return chargementCommunes;
    chargementCommunes = fetch('/api/communes')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { communes = d || {}; return communes; })
      .catch(function () { communes = {}; return communes; });
    return chargementCommunes;
  }

  function communesDuTerritoire() {
    return (communes && communes[cleTerritoire()]) || [];
  }

  /**
   * Lieu choisi pour la météo. Il est propre à chaque territoire : passer de
   * la Guadeloupe à la Martinique ne doit pas conserver « Saint-François ».
   * L'URL prime, pour qu'un lien partagé ouvre la bonne commune.
   */
  function lieuActif() {
    var demande = null;
    try { demande = new URLSearchParams(location.search).get('lieu'); } catch (e) { demande = null; }
    if (!demande) demande = lieuDemande;

    // Tant que la liste n'est pas arrivée, on fait crédit à l'adresse : c'est
    // le seul moyen qu'un lien partagé survive au premier rendu.
    if (demande && !communes) return demande;

    if (demande && communesDuTerritoire().some(function (c) { return c.cle === demande; })) {
      return demande;
    }
    // La liste est là et le lieu n'y est pas : la demande n'a plus lieu d'être.
    if (demande === lieuDemande) lieuDemande = '';
    var memorise = null;
    try { memorise = JSON.parse(localStorage.getItem(CLE_LIEU) || '{}')[cleTerritoire()]; }
    catch (e) { memorise = null; }
    if (memorise && communesDuTerritoire().some(function (c) { return c.cle === memorise; })) {
      return memorise;
    }
    return '';                       // vide : l'ensemble du territoire
  }

  function definirLieu(cle) {
    try {
      var tout = JSON.parse(localStorage.getItem(CLE_LIEU) || '{}');
      if (cle) tout[cleTerritoire()] = cle; else delete tout[cleTerritoire()];
      localStorage.setItem(CLE_LIEU, JSON.stringify(tout));
    } catch (e) { /* stockage refusé */ }

    try {
      var url = new URL(location.href);
      if (cle) url.searchParams.set('lieu', cle); else url.searchParams.delete('lieu');
      history.replaceState(history.state, '', url.pathname + url.search);
    } catch (e) { /* sans History API */ }

    mesurer('lieu_meteo', cle || 'territoire');
    rendreMeteo();
  }

  /** Intitulé du lieu consulté : la commune si elle est choisie, sinon l'île. */
  function nomDuLieu(terr) {
    var cle = lieuActif();
    if (!cle) return (terr.article || '') + terr.nom;
    var trouve = communesDuTerritoire().find(function (c) { return c.cle === cle; });
    return trouve ? trouve.nom : (terr.article || '') + terr.nom;
  }

  /**
   * Choix du lieu. Il vient en tête de la page météo : c'est la première
   * question qu'on se pose en l'ouvrant — « et chez moi ? ».
   */
  /**
   * Comparaison tolérante : « francois » doit trouver « Saint-François », et
   * « ste anne » doit trouver « Sainte-Anne ». On retire les accents, on
   * ramène tout en minuscules et on traite tirets et apostrophes comme des
   * espaces — personne ne tape « Morne-à-l'Eau » à l'identique.
   */
  function aplati(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/['’\-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Les lieux correspondant à une saisie, dans l'ordre le plus utile. */
  function lieuxFiltres(saisie) {
    var liste = communesDuTerritoire();
    var q = aplati(saisie);
    if (!q) return liste;
    var debut = [];
    var ailleurs = [];
    liste.forEach(function (c) {
      var n = aplati(c.nom);
      if (n.indexOf(q) === 0) debut.push(c);
      // « anne » doit trouver « Sainte-Anne » : on cherche aussi en début de mot.
      else if (n.indexOf(' ' + q) !== -1 || n.indexOf(q) !== -1) ailleurs.push(c);
    });
    return debut.concat(ailleurs);
  }

  /**
   * Le choix du lieu est l'action principale de l'onglet météo : il ne se
   * présente donc pas comme un jumeau du sélecteur de territoire, mais comme un
   * bouton de recherche, avec le nom du lieu en clair.
   */
  function selecteurLieu() {
    var liste = communesDuTerritoire();
    if (!liste.length) return '';
    var courant = lieuActif();
    var nom = courant ? nomDuLieu(territoireActif()) : '';

    return '<button type="button" class="chercheur' + (courant ? '' : ' chercheur--vide') + '"'
      + ' id="ouvrir-lieu" aria-haspopup="dialog" aria-expanded="false">'
      + '<svg class="chercheur__epingle" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11"/><circle cx="12" cy="10" r="2.6"/></svg>'
      + '<span class="chercheur__texte">'
      + '<span class="chercheur__intitule">Météo de</span>'
      + '<span class="chercheur__valeur">'
      + echapper(nom || 'Choisir ma commune') + '</span></span>'
      + '<svg class="chercheur__loupe" viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
      + '</button>'
      + '<div class="chercheur-panneau" id="panneau-lieu" role="dialog" aria-modal="true"'
      + ' aria-label="Choisir une commune ou une zone" hidden>'
      + '<div class="chercheur-panneau__tete">'
      + '<svg class="chercheur-panneau__loupe" viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
      + '<input type="search" id="recherche-lieu" autocomplete="off" spellcheck="false"'
      + ' placeholder="Rechercher une commune…"'
      + ' aria-label="Rechercher une commune" aria-controls="liste-lieux">'
      + '<button type="button" class="chercheur-panneau__fermer" id="fermer-lieu"'
      + ' aria-label="Fermer la recherche">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      + '</button></div>'
      + '<ul class="chercheur-liste" id="liste-lieux" role="listbox">'
      + optionsLieux('') + '</ul></div>';
  }

  /** Le corps de la liste, seul morceau redessiné à chaque frappe. */
  function optionsLieux(saisie) {
    var courant = lieuActif();
    var resultats = lieuxFiltres(saisie);
    var html = '';

    // « Tout le territoire » n'a de sens que sans recherche en cours.
    if (!aplati(saisie)) {
      html += '<li role="option" class="chercheur-item' + (courant ? '' : ' est-choisi') + '"'
        + ' data-lieu="" aria-selected="' + (courant ? 'false' : 'true') + '" tabindex="-1">'
        + '<span class="chercheur-item__nom">Tout le territoire</span>'
        + '<span class="chercheur-item__note">moyenne générale</span></li>';
    }

    if (!resultats.length) {
      return html + '<li class="chercheur-vide">Aucune commune ne correspond.<br>'
        + 'Essayez sans accent, ou une partie du nom.</li>';
    }

    return html + resultats.map(function (c) {
      var choisi = c.cle === courant;
      return '<li role="option" class="chercheur-item' + (choisi ? ' est-choisi' : '') + '"'
        + ' data-lieu="' + echapper(c.cle) + '" aria-selected="' + (choisi ? 'true' : 'false') + '"'
        + ' tabindex="-1"><span class="chercheur-item__nom">' + echapper(c.nom) + '</span>'
        + (c.population
          ? '<span class="chercheur-item__note">' + formaterHabitants(c.population) + '</span>'
          : '')
        + '</li>';
    }).join('');
  }

  function formaterHabitants(n) {
    if (n >= 1000) return Math.round(n / 1000) + ' 000 hab.';
    return n + ' hab.';
  }

  function ouvrirChercheurLieu() {
    var panneau = $('#panneau-lieu');
    var bouton = $('#ouvrir-lieu');
    if (!panneau) return;
    panneau.hidden = false;
    document.body.classList.add('chercheur-ouvert');
    if (bouton) bouton.setAttribute('aria-expanded', 'true');
    var champ = $('#recherche-lieu');
    if (champ) {
      champ.value = '';
      rafraichirListeLieux('');
      // Sur téléphone, ouvrir le clavier tout de suite fait gagner un geste.
      setTimeout(function () { champ.focus(); }, 30);
    }
  }

  function fermerChercheurLieu() {
    var panneau = $('#panneau-lieu');
    var bouton = $('#ouvrir-lieu');
    if (panneau) panneau.hidden = true;
    document.body.classList.remove('chercheur-ouvert');
    if (bouton) { bouton.setAttribute('aria-expanded', 'false'); bouton.focus(); }
  }

  function rafraichirListeLieux(saisie) {
    var liste = $('#liste-lieux');
    if (liste) liste.innerHTML = optionsLieux(saisie);
  }

  /** Clé de cache d'un bulletin : le territoire seul, ou territoire + lieu. */
  function cleBulletin() {
    var lieu = lieuActif();
    return lieu ? cleTerritoire() + '@' + lieu : cleTerritoire();
  }

  /**
   * Bulletin d'un territoire, ou d'une commune précise. La clé porte les deux
   * cas — « guadeloupe » ou « guadeloupe@saint-francois » — pour que les deux
   * cohabitent en mémoire sans se marcher dessus.
   */
  function chargerBulletin(cle) {
    if (bulletins[cle]) return Promise.resolve(bulletins[cle]);
    var partie = String(cle).split('@');
    var url = '/api/meteo/' + encodeURIComponent(partie[0])
      + (partie[1] ? '?lieu=' + encodeURIComponent(partie[1]) : '');
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { if (b) bulletins[cle] = b; return b; })
      .catch(function () { return null; });
  }

  function rendreMeteo() {
    var terr = territoireActif();
    var zone = $('#page-meteo');

    // La liste des lieux conditionne le choix courant : sans elle, on ne sait
    // pas si le lieu mémorisé existe encore.
    if (!communes) {
      chargerCommunes().then(function () { if (vueCourante === 'meteo') rendreMeteo(); });
    }

    var cle = cleBulletin();
    var b = bulletins[cle];

    if (!b) {
      zone.innerHTML = selecteurLieu()
        + '<div class="squelette squelette--titre"></div>'
        + '<div class="squelette squelette--carte"></div>'
        + '<div class="squelette squelette--carte"></div>';
      chargerBulletin(cle).then(function (recu) {
        if (!recu) {
          zone.innerHTML = selecteurLieu()
            + '<div class="bandeau bandeau--attention">' + ICONES.info
            + '<div>La météo détaillée n\'est pas disponible pour '
            + echapper(nomDuLieu(terr)) + ' en ce moment. '
            + 'La veille cyclonique, elle, fonctionne normalement.</div></div>';
          return;
        }
        if (vueCourante === 'meteo') rendreMeteo();
      });
      return;
    }

    var m = b.maintenant;
    var html = selecteurLieu()
      + '<h2 style="font-size:1.6rem;margin-bottom:var(--e2)">Météo — '
      + echapper(nomDuLieu(terr)) + '</h2>'
      + '<p style="color:var(--texte-doux);margin-bottom:var(--e5)">'
      + 'Prévisions de modèle, actualisées ' + ilYA(b.recuLe) + '. '
      + (b.lieu
        ? 'Relevé au point le plus proche de ' + echapper(b.lieu.nom) + '. '
        : 'Valeurs pour l\'ensemble du territoire. ')
      + 'Elles ne remplacent pas un bulletin officiel.</p>';

    // Conditions actuelles, en évidence. Le fond prend la couleur du ciel réel,
    // et la journée entière tient dans la colonne de droite : min et max,
    // rafales attendues, pluie, et les heures de soleil.
    var jour0 = b.jours && b.jours[0];
    var repere = function (libelle, valeur) {
      return '<div><dt>' + libelle + '</dt><dd>' + valeur + '</dd></div>';
    };
    html += '<div class="meteo-actuel" data-ciel="' + ciel(m.code, m.nuit) + '">'
      + '<div class="meteo-actuel__picto">' + picto(m.icone, 64) + '</div>'
      + '<div class="meteo-actuel__corps">'
      + '<div class="meteo-actuel__temp chiffres">' + (m.temperature != null ? Math.round(m.temperature) : '—') + '<span>°C</span></div>'
      + '<div class="meteo-actuel__desc">' + echapper(m.description) + '</div>'
      + '<div class="meteo-actuel__detail">Ressenti ' + (m.ressenti != null ? Math.round(m.ressenti) : '—') + ' °C'
      + ' · humidité ' + (m.humidite != null ? m.humidite : '—') + ' %'
      + ' · ' + (m.pressionHpa != null ? Math.round(m.pressionHpa) : '—') + ' hPa</div>'
      + '</div>'
      + (jour0
        ? '<dl class="meteo-actuel__jour chiffres">'
          + repere('Aujourd\'hui', (jour0.tempMax != null ? Math.round(jour0.tempMax) + '°' : '—')
            + ' <span>' + (jour0.tempMin != null ? Math.round(jour0.tempMin) + '°' : '—') + '</span>')
          + repere('Rafales', (jour0.rafalesMaxKmh != null ? Math.round(jour0.rafalesMaxKmh) + ' km/h' : '—'))
          + repere('Pluie', (jour0.pluieProbabilite != null ? jour0.pluieProbabilite + ' %' : '—')
            + (jour0.pluieMm != null ? ' <span>' + nombre(jour0.pluieMm, 1) + ' mm</span>' : ''))
          + repere('Soleil', (jour0.leverSoleil ? jour0.leverSoleil.slice(11, 16) : '—')
            + ' <span>' + (jour0.coucherSoleil ? jour0.coucherSoleil.slice(11, 16) : '—') + '</span>')
          + '</dl>'
        : '')
      + '</div>';

    // Alertes locales : des seuils, jamais une vigilance officielle.
    if (b.alertes && b.alertes.length) {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre section-titre--risque">À surveiller aujourd\'hui</h3>'
        + '<div class="alertes">' + b.alertes.map(rendreAlerteLocale).join('') + '</div>'
        + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
        + 'Repères calculés à partir des prévisions de modèle. '
        + 'Ce ne sont pas des vigilances officielles.</p>'
        + '</div>';
    }

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--vent">Vent, mer et air</h3>'
      + '<div class="stats">'
      + stat('Vent', valeurOuIndispo(m.ventKmh, 'km/h'),
        m.ventDirection != null ? 'de secteur ' + Math.round(m.ventDirection) + '°' : '', 'vent')
      + stat('Rafales', valeurOuIndispo(m.rafalesKmh, 'km/h'), '', 'vent')
      + stat('Houle', valeurOuIndispo(terr.mer && terr.mer.houleM, 'm', 1), 'hauteur significative', 'houle')
      + stat('Mer', valeurOuIndispo(terr.mer && terr.mer.sstC, '°C', 1), 'température de surface', 'mer')
      + stat('Indice UV', valeurOuIndispo(b.qualiteAir && b.qualiteAir.uv, '', 1), 'maintenant', 'uv')
      + stat('Poussières', valeurOuIndispo(b.qualiteAir && b.qualiteAir.poussiere, 'µg/m³'), 'brume de sable', 'sable')
      + stat('PM10', valeurOuIndispo(b.qualiteAir && b.qualiteAir.pm10, 'µg/m³'), 'particules', 'sable')
      + '</div></div>';

    // Les prochaines heures : d'abord la tendance d'un coup d'œil, ensuite le
    // détail heure par heure pour qui veut le chiffre exact.
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--pluie">Prochaines heures</h3>'
      + (window.KdlGraphiques ? window.KdlGraphiques.heures(b.heures.slice(0, 24)) : '')
      + '<div class="meteo-heures" data-defilante="true">'
      + b.heures.slice(0, 18).map(function (h) {
        var d = decrire(h.code, h.nuit);
        var pluie = h.pluieProbabilite != null ? h.pluieProbabilite : null;
        return '<div class="meteo-heure" data-ciel="' + ciel(h.code, h.nuit) + '">'
          + '<div class="meteo-heure__h chiffres">' + h.heure.slice(11, 16) + '</div>'
          + picto(d.icone, 26)
          + '<div class="meteo-heure__t chiffres">' + (h.temperature != null ? Math.round(h.temperature) : '—') + '°</div>'
          + '<div class="meteo-heure__p chiffres" data-sec="' + (pluie === null || pluie < 30) + '">'
          + (pluie !== null ? pluie + ' %' : '—') + '</div>'
          + '<div class="meteo-heure__jauge"><i style="width:' + (pluie || 0) + '%"></i></div>'
          + '<div class="meteo-heure__v chiffres">' + (h.rafalesKmh != null ? Math.round(h.rafalesKmh) : '—') + '</div>'
          + '</div>';
      }).join('')
      + '</div>'
      + '<p class="meteo-astuce">'
      + 'Heure · temps · température · probabilité de pluie · rafales en km/h'
      + '<span class="meteo-astuce__glisser">Faites glisser pour voir la suite</span></p>'
      + '</div>';

    // Dix jours.
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre section-titre--pluie">Dix prochains jours</h3>'
      + '<div class="meteo-jours">'
      + reglettesJours(b.jours).map(function (r) {
        var j = r.jour;
        var d = decrire(j.code, false);
        var date = new Date(j.date + 'T12:00:00');
        var nom = r.index === 0 ? "Aujourd'hui"
          : date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
        var pluie = j.pluieProbabilite != null ? j.pluieProbabilite : null;
        return '<div class="meteo-jour" data-ciel="' + ciel(j.code, false) + '">'
          + '<div class="meteo-jour__nom">' + echapper(nom) + '</div>'
          + picto(d.icone, 24)
          + '<div class="meteo-jour__pluie chiffres" data-sec="' + (pluie === null || pluie < 30) + '">'
          + (pluie !== null ? pluie + ' %' : '—') + '</div>'
          + '<div class="meteo-jour__reglette" aria-hidden="true">'
          + '<i style="left:' + r.debut + '%;right:' + (100 - r.fin) + '%"></i></div>'
          + '<div class="meteo-jour__temps chiffres"><b>' + (j.tempMax != null ? Math.round(j.tempMax) : '—') + '°</b>'
          + ' <span>' + (j.tempMin != null ? Math.round(j.tempMin) : '—') + '°</span></div>'
          + '</div>';
      }).join('')
      + '</div></div>';

    var j0 = b.jours[0];
    if (j0 && j0.leverSoleil) {
      html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
        + '<h3 class="section-titre section-titre--air">Soleil</h3>'
        + '<div class="stats">'
        + stat('Lever', '<span class="valeur">' + j0.leverSoleil.slice(11, 16) + '</span>', 'heure locale', 'soleil')
        + stat('Coucher', '<span class="valeur">' + j0.coucherSoleil.slice(11, 16) + '</span>', 'heure locale', 'soleil')
        + stat('UV maximal', valeurOuIndispo(j0.uvMax, '', 1), "aujourd'hui", 'uv')
        + '</div></div>';
    }

    html += '<p style="color:var(--texte-faible);font-size:.82rem">'
      + 'Source : ' + echapper(b.source) + ' — licence ' + echapper(b.licence) + '. '
      + 'Prévisions de modèle, sans validation par un prévisionniste. '
      + 'Pour une vigilance officielle, consultez les liens de la page '
      + echapper(terr.nom) + '.</p>';

    zone.innerHTML = html;
  }

  /** Traduction locale des codes météo — même table que le serveur. */
  function decrire(code, nuit) {
    var t = {
      0: ['Ciel dégagé', 'soleil', 'lune'], 1: ['Généralement dégagé', 'soleil-voile', 'lune-voile'],
      2: ['Partiellement nuageux', 'soleil-nuage', 'lune-nuage'], 3: ['Couvert', 'nuage'],
      45: ['Brouillard', 'brume'], 48: ['Brouillard givrant', 'brume'],
      51: ['Bruine légère', 'bruine'], 53: ['Bruine', 'bruine'], 55: ['Bruine dense', 'bruine'],
      61: ['Pluie faible', 'pluie'], 63: ['Pluie', 'pluie'], 65: ['Pluie forte', 'pluie-forte'],
      80: ['Averses faibles', 'averse'], 81: ['Averses', 'averse'], 82: ['Averses violentes', 'averse-forte'],
      95: ['Orage', 'orage'], 96: ['Orage avec grêle', 'orage'], 99: ['Orage violent', 'orage'],
    }[code];
    if (!t) return { texte: 'Conditions indéterminées', icone: 'nuage' };
    return { texte: t[0], icone: (nuit && t[2]) || t[1] };
  }

  // ------------------------------------------------------------------ bêta

  var ouvertureFormulaire = 0;

  function rendreBeta() {
    var B = window.KdlBeta;
    var t = B.textes(etat);
    var installee = window.KdlInstallation.estInstallee();

    var html = '<h2 style="font-size:1.7rem;margin-bottom:var(--e2)">'
      + 'KDL Cyclone <span class="badge-lab" style="vertical-align:6px">Bêta publique</span></h2>'
      + '<p style="color:var(--texte-doux);font-size:1.02rem;margin-bottom:var(--e6);max-width:64ch">'
      + 'KDLTech ouvre gratuitement KDL Cyclone dans son Lab : une web app conçue en Guadeloupe '
      + 'pour suivre les ondes tropicales, mieux comprendre leur évolution et se préparer calmement. '
      + 'Utilisez-la directement sur le Web ou installez-la gratuitement sur votre téléphone '
      + 'et votre ordinateur.</p>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Participez à la bêta</h3>'
      + '<p style="max-width:64ch;margin-bottom:var(--e4)">'
      + 'Essayez gratuitement l\'application, installez-la si vous le souhaitez et aidez KDLTech '
      + 'à améliorer cet outil conçu pour les Antilles.</p>'
      + '<div style="display:flex;flex-wrap:wrap;gap:var(--e2)">'
      + '<button class="bouton bouton--principal" type="button" data-vers="accueil">Essayer la bêta</button>'
      + (installee ? '' : '<button class="bouton" type="button" data-vers="installer">Installer gratuitement</button>')
      + '<button class="bouton" type="button" id="partager-beta">Partager la bêta</button>'
      + '<button class="bouton" type="button" id="aller-avis">Donner mon avis</button>'
      + '</div>'
      + '<p class="invitation__gages" style="margin-top:var(--e3)">Gratuite • Sans publicité • Sans compte</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Ce qu\'est cette bêta</h3>'
      + '<ul style="line-height:1.75;padding-left:1.1rem;max-width:66ch;color:var(--texte-doux)">'
      + '<li><strong style="color:var(--texte)">Une expérimentation publique du KDL Lab.</strong> '
      + 'L\'application fonctionne, mais elle n\'est pas figée : des réglages évoluent encore.</li>'
      + '<li><strong style="color:var(--texte)">Gratuite et sans contrepartie.</strong> '
      + 'Pas de compte, pas de publicité, pas de collecte de données personnelles.</li>'
      + '<li><strong style="color:var(--texte)">Utilisable sans rien installer</strong>, '
      + 'dans le navigateur, sur téléphone comme sur ordinateur.</li>'
      + '</ul></div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Données officielles et analyse KDL</h3>'
      + '<p style="max-width:66ch;margin-bottom:var(--e3)">'
      + 'Deux natures d\'information cohabitent dans l\'application, et elles ne se valent pas.</p>'
      + '<div style="display:grid;gap:var(--e3)">'
      + '<div style="display:flex;gap:var(--e3);align-items:flex-start">'
      + '<span class="etiquette etiquette--officiel" style="flex:none;min-width:96px;justify-content:center">Officiel</span>'
      + '<span style="color:var(--texte-doux);font-size:.94rem">Probabilités, zones et cônes publiés '
      + 'par le National Hurricane Center. Ils font foi, et sont affichés en premier.</span></div>'
      + '<div style="display:flex;gap:var(--e3);align-items:flex-start">'
      + '<span class="etiquette etiquette--kdl" style="flex:none;min-width:96px;justify-content:center">Analyse KDL</span>'
      + '<span style="color:var(--texte-doux);font-size:.94rem">Lecture automatique de l\'environnement '
      + 'météorologique, expérimentale, non validée par un organisme officiel. Elle explique, '
      + 'elle ne prévoit pas.</span></div>'
      + '</div>'
      + '<div class="bandeau bandeau--attention" style="margin-top:var(--e4)">' + ICONES.info
      + '<div>En cas d\'alerte, seules la vigilance de Météo-France et les consignes de la '
      + 'préfecture font autorité.</div></div>'
      + '</div>';

    // Visuels téléchargeables : formats prêts pour chaque réseau.
    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Visuels à partager</h3>'
      + '<p style="max-width:64ch;margin-bottom:var(--e4);color:var(--texte-doux)">'
      + 'Pour TikTok et les Stories, téléchargez le visuel vertical puis copiez le texte : '
      + 'ces applications ne reçoivent pas de lien enrichi.</p>'
      + '<div style="display:flex;flex-wrap:wrap;gap:var(--e2)">'
      + '<a class="bouton" href="/media/og-kdl-cyclone.png" download>Visuel horizontal (1200 × 630)</a>'
      + '</div>'
      + '<p style="color:var(--texte-faible);font-size:.82rem;margin-top:var(--e3)">'
      + 'Les visuels propres à chaque système se téléchargent depuis sa fiche.</p>'
      + '</div>';

    html += '<div class="carte-bloc" style="margin-bottom:var(--e4)">'
      + '<h3 class="section-titre">Textes prêts à publier</h3>'
      + '<label class="champ"><span>Partage général</span>'
      + '<textarea id="texte-general" rows="7">' + echapper(t.general) + '</textarea></label>'
      + '<button class="bouton" type="button" data-copier="texte-general" style="margin:var(--e2) 0 var(--e5)">Copier ce texte</button>'
      + '<label class="champ"><span>Version LinkedIn</span>'
      + '<textarea id="texte-linkedin" rows="8">' + echapper(t.linkedin) + '</textarea></label>'
      + '<button class="bouton" type="button" data-copier="texte-linkedin" style="margin-top:var(--e2)">Copier ce texte</button>'
      + '</div>';

    html += formulaireRetour();
    $('#page-beta').innerHTML = html;
    ouvertureFormulaire = Date.now();
  }

  function formulaireRetour() {
    var B = window.KdlBeta;
    return '<div class="carte-bloc" id="bloc-avis">'
      + '<h3 class="section-titre">Donner mon avis</h3>'
      + '<p style="max-width:64ch;margin-bottom:var(--e4);color:var(--texte-doux)">'
      + 'Un problème, une information fausse, une idée ? Dites-le. Votre adresse électronique '
      + 'est facultative : elle n\'est conservée que si vous demandez une réponse.</p>'
      + '<div id="retour-resultat"></div>'
      + '<form id="formulaire-retour" novalidate>'
      + '<label class="champ"><span>Type de retour</span>'
      + '<select name="categorie" required>'
      + '<option value="">Choisissez…</option>'
      + B.CATEGORIES.map(function (c) {
        return '<option value="' + c[0] + '">' + echapper(c[1]) + '</option>';
      }).join('')
      + '</select></label>'
      + '<label class="champ"><span>Votre message</span>'
      + '<textarea name="message" rows="5" maxlength="3000" required '
      + 'placeholder="Décrivez ce que vous avez constaté, et sur quel écran."></textarea></label>'
      + '<label class="champ"><span>Adresse électronique (facultative)</span>'
      + '<input type="email" name="email" autocomplete="email" placeholder="pour une réponse seulement"></label>'
      + '<label class="champ champ--case">'
      + '<input type="checkbox" name="recontact"> <span>KDLTech peut me recontacter à ce sujet</span></label>'
      // Piège à robots : invisible et hors du parcours clavier.
      + '<div class="piege" aria-hidden="true">'
      + '<label>Ne rien écrire ici<input type="text" name="site" tabindex="-1" autocomplete="off"></label></div>'
      + '<button class="bouton bouton--principal" type="submit" style="margin-top:var(--e3)">Envoyer mon retour</button>'
      + '</form></div>';
  }

  function soumettreRetour(formulaire) {
    var B = window.KdlBeta;
    var zone = $('#retour-resultat');
    var bouton = formulaire.querySelector('button[type=submit]');
    var donnees = {
      categorie: formulaire.categorie.value,
      message: formulaire.message.value,
      email: formulaire.email.value,
      recontact: formulaire.recontact.checked,
      site: formulaire.site.value,
      duree: Date.now() - ouvertureFormulaire,
      page: vueCourante,
    };

    bouton.disabled = true;
    bouton.textContent = 'Envoi…';

    B.envoyerRetour(donnees).then(function (r) {
      if (r.statut === 201 && r.corps.ok) {
        zone.innerHTML = '<div class="bandeau bandeau--info">' + ICONES.info
          + '<div>' + echapper(r.corps.message) + ' Conservez cette référence si vous souhaitez '
          + 'en reparler.</div></div>';
        formulaire.reset();
      } else if (r.corps && r.corps.erreurs) {
        zone.innerHTML = '<div class="bandeau bandeau--attention">' + ICONES.info
          + '<div>' + r.corps.erreurs.map(echapper).join(' ') + '</div></div>';
      } else {
        zone.innerHTML = '<div class="bandeau bandeau--attention">' + ICONES.info
          + '<div>' + echapper((r.corps && r.corps.erreur) || "L'envoi n'a pas abouti. Réessayez dans un moment.")
          + '</div></div>';
      }
    }).catch(function () {
      zone.innerHTML = '<div class="bandeau bandeau--hors-ligne">' + ICONES.horsLigne
        + '<div>Envoi impossible : vous semblez hors connexion. Votre message n\'a pas été perdu, '
        + 'réessayez une fois reconnecté.</div></div>';
    }).finally(function () {
      bouton.disabled = false;
      bouton.textContent = 'Envoyer mon retour';
      zone.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /** Feuille de partage : natif d'abord, replis ensuite. */
  function ouvrirPartage(titre, texte, url) {
    var B = window.KdlBeta;
    mesurer('partage');

    B.partageNatif({ title: titre, text: texte, url: url }).then(function (resultat) {
      if (resultat === 'partage' || resultat === 'annule') return;
      afficherReplisPartage(titre, texte, url);
    });
  }

  function afficherReplisPartage(titre, texte, url) {
    var B = window.KdlBeta;
    var liens = B.liensReseaux(url, texte);
    var boite = $('#partage-replis');
    if (!boite) {
      boite = document.createElement('div');
      boite.id = 'partage-replis';
      boite.className = 'replis';
      boite.setAttribute('role', 'dialog');
      boite.setAttribute('aria-label', 'Partager');
      document.body.appendChild(boite);
    }
    boite.innerHTML = '<div class="replis__panneau">'
      + '<h3>' + echapper(titre) + '</h3>'
      + '<p>Choisissez où partager. Aucune connexion à un réseau ne vous sera demandée ici.</p>'
      + '<div class="replis__liste">'
      + liens.map(function (l) {
        if (!l.url) {
          return '<button class="bouton" type="button" data-copier-texte="1">' + l.nom + '</button>';
        }
        return '<a class="bouton" href="' + l.url + '" target="_blank" rel="noopener noreferrer">'
          + l.nom + '</a>';
      }).join('')
      + '</div>'
      + '<button class="bouton bouton--discret" type="button" id="fermer-replis">Fermer</button>'
      + '</div>';
    boite.dataset.visible = 'true';
    boite.dataset.texte = texte;
  }

  // -------------------------------------------------------------- partage

  function texteDePartage(s) {
    var lignes = [];
    var nom = s.nom || s.designation;
    lignes.push(nom + ' — ' + s.statut + '.');
    var terr = territoireActif();
    lignes.push('À ' + nombre(distancePour(s)) + ' km de ' + (terr.article || '') + terr.nom + '.');
    if (typeof s.prob7j === 'number') {
      lignes.push('Risque de formation à 7 jours (NHC, officiel) : ' + s.prob7j + ' %.');
    }
    if (s.potentiel && s.potentiel.score != null) {
      lignes.push('Potentiel KDL (analyse indicative, non officielle) : ' + s.potentiel.score + '/100.');
    }
    var menaceLocale = menacePour(s);
    if (menaceLocale && menaceLocale.niveau && menaceLocale.niveau !== 'aucun') {
      lignes.push('Niveau pour ' + (terr.article || '') + terr.nom + ' : ' + menaceLocale.niveauLabel + '.');
    }
    // Une donnée partagée porte toujours sa date : sans elle, elle devient fausse.
    lignes.push('Données du ' + heureLocale(etat.genereLe, true) + ' (heure de Guadeloupe).');
    lignes.push('');
    lignes.push('Sources officielles et facteurs météo : ' + location.origin + '/systeme/' + encodeURIComponent(s.id));
    lignes.push('KDL Cyclone — service gratuit créé en Guadeloupe par KDLTech.');
    return lignes.join('\n');
  }

  function partager(s) {
    var texte = window.KdlBeta.texteSysteme(s, etat, heureLocale);
    var url = location.origin + '/systemes/' + (s.slug || '');
    ouvrirPartage('KDL Cyclone — ' + (s.nom || s.designation), texte, url);
  }

  var minuteurSignal;
  /**
   * Copie l'adresse de la page, paramètres compris — le territoire choisi doit
   * survivre au passage d'un navigateur à l'autre.
   */
  function copierAdresse() {
    var adresse = location.href;
    var reussi = function () {
      signaler('Lien copié. Collez-le dans Chrome pour installer l\'application.');
      mesurer('copier_lien');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(adresse).then(reussi, function () { copierRepli(adresse, reussi); });
    } else {
      copierRepli(adresse, reussi);
    }
    return undefined;
  }

  /** Repli pour les navigateurs intégrés, qui refusent souvent le presse-papiers. */
  function copierRepli(adresse, reussi) {
    var champ = document.createElement('textarea');
    champ.value = adresse;
    champ.setAttribute('readonly', '');
    champ.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(champ);
    champ.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    champ.remove();
    if (ok) reussi();
    else signaler('Copie impossible sur ce navigateur. Utilisez « Comment faire ? ».');
  }

  function signaler(message) {
    var zone = $('#signal');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'signal';
      zone.className = 'signal';
      zone.setAttribute('role', 'status');
      document.body.appendChild(zone);
    }
    zone.textContent = message;
    zone.dataset.visible = 'true';
    clearTimeout(minuteurSignal);
    minuteurSignal = setTimeout(function () { zone.dataset.visible = 'false'; }, 4000);
  }

  /** Compteur agrégé, sans identifiant ni cookie. Un échec est sans conséquence. */
  function mesurer(evenement, page) {
    try {
      fetch('/api/mesure?e=' + encodeURIComponent(evenement)
        + (page ? '&p=' + encodeURIComponent(page) : ''), { method: 'GET', keepalive: true })
        .catch(function () {});
    } catch (e) { /* ignoré */ }
  }

  function rendreAucuneDonnee() {
    $('#situation').className = 'situation';
    $('#situation').innerHTML = '<h1 class="situation__titre">Données pas encore disponibles</h1>'
      + '<p class="situation__detail">La première collecte n\'a pas encore abouti, ou le serveur est '
      + 'momentanément injoignable. Le mode préparation reste accessible.</p>';
    $('#liste-systemes').innerHTML = '<div class="etat-vide">' + ICONES.horsLigne
      + '<h3>Aucune donnée en mémoire</h3>'
      + '<p>Ouvrez l\'application une fois avec une connexion : le dernier état sera ensuite '
      + 'conservé pour être consulté hors ligne. En attendant, la liste de préparation '
      + 'reste entièrement disponible.</p>'
      + '<div style="display:flex;gap:var(--e2);flex-wrap:wrap;justify-content:center">'
      + '<button class="bouton bouton--principal" type="button" id="reessayer">Réessayer</button>'
      + '<button class="bouton" type="button" data-vers="preparation">Ouvrir la préparation</button>'
      + '</div>'
      + '<p style="font-size:.84rem;color:var(--texte-faible)">KDL Cyclone — un service gratuit KDLTech.</p>'
      + '</div>';
  }

  // ------------------------------------------------------------- navigation

  var CHEMINS = {
    accueil: '/', carte: '/carte', guadeloupe: '/guadeloupe',
    preparation: '/preparation', sources: '/sources', apropos: '/a-propos',
    mentions: '/mentions-legales',
    installer: '/installer',
    beta: '/beta',
    meteo: '/meteo',
  };

  /** L'URL publique d'une fiche utilise le slug lisible, pas l'identifiant interne. */
  function cheminDeVue(vue, id) {
    if (vue === 'systeme' && id) {
      var s = (etat && etat.systemes || []).find(function (x) { return x.id === id; });
      if (s && s.slug) return avecTerritoire('/systemes/' + encodeURIComponent(s.slug));
      return avecTerritoire('/systeme/' + encodeURIComponent(id));
    }
    return avecTerritoire(CHEMINS[vue] || '/');
  }

  /**
   * Conserve le territoire en changeant de page : sans cela, naviguer depuis un
   * lien « Martinique » ramenait silencieusement à la Guadeloupe.
   */
  function avecTerritoire(chemin) {
    var params = [];
    var cle = cleTerritoire();
    if (cle && cle !== 'guadeloupe') {
      params.push(PARAM_TERRITOIRE + '=' + encodeURIComponent(cle));
    }
    // La commune ne suit que la page météo : elle n'a pas de sens ailleurs, et
    // la traîner partout encombrerait les adresses partagées pour rien.
    var lieu = lieuActif();
    // CHEMINS est déclaré plus bas dans le module : on ne suppose pas qu'il
    // soit déjà défini si un rendu très précoce passe par ici.
    if (lieu && chemin.indexOf((typeof CHEMINS !== 'undefined' && CHEMINS && CHEMINS.meteo) || '/meteo') === 0) {
      params.push('lieu=' + encodeURIComponent(lieu));
    }
    return params.length ? chemin + '?' + params.join('&') : chemin;
  }

  function vueDeChemin(chemin) {
    // Forme publique : /systemes/<slug>. C'est celle qui circule dans les
    // partages, elle doit ouvrir la bonne fiche dès le premier rendu.
    if (chemin.indexOf('/systemes/') === 0) {
      var slug = decodeURIComponent(chemin.slice('/systemes/'.length)).replace(/\/$/, '');
      var trouve = (etat && etat.systemes || []).find(function (x) { return x.slug === slug; });
      return { vue: 'systeme', id: trouve ? trouve.id : null, slug: slug };
    }
    // Forme interne, conservée pour les anciens liens.
    if (chemin.indexOf('/systeme/') === 0) {
      return { vue: 'systeme', id: decodeURIComponent(chemin.slice('/systeme/'.length)) };
    }
    for (var vue in CHEMINS) {
      if (CHEMINS[vue] === chemin) return { vue: vue };
    }
    return { vue: 'accueil' };
  }

  function allerA(vue, options) {
    options = options || {};
    vueCourante = vue;
    $$('section.vue').forEach(function (v) { v.dataset.active = String(v.dataset.vue === vue); });
    $$('.nav__lien').forEach(function (b) {
      if (b.dataset.vue === vue) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });

    if (vue !== 'carte') fermerPanneauSysteme();
    if (vue === 'carte') initialiserCarte();
    if (vue === 'preparation') rendrePreparation();
    if (vue === 'apropos') rendreApropos();
    if (vue === 'mentions') rendreMentions();
    if (vue === 'installer') rendreInstaller();
    if (vue === 'beta') rendreBeta();
    if (vue === 'meteo') rendreMeteo();
    if (vue === 'systeme' && options.id) rendreFiche(options.id);
    rendreSignature();

    // L'URL suit la navigation : les pages restent partageables et indexables.
    var chemin = cheminDeVue(vue, options.id);
    if (!options.sansHistorique && (location.pathname + location.search) !== chemin) {
      history.pushState({ vue: vue, id: options.id }, '', chemin);
    }

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    var terr = territoireActif();
    var titres = {
      accueil: 'Situation générale', carte: 'Carte de l\'Atlantique', guadeloupe: terr.nom,
      preparation: 'Préparation', sources: 'Sources et méthode', apropos: 'À propos',
      mentions: 'Mentions légales',
      installer: 'Installer l\'application',
      beta: 'Bêta publique',
      meteo: 'Météo locale',
      systeme: 'Détail du système',
    };
    // Le titre d'onglet dit quel territoire est consulté : c'est aussi ce que
    // reprennent les favoris et l'historique du navigateur.
    var suffixe = terr.cle === 'guadeloupe' || vue === 'guadeloupe' ? '' : ' · ' + terr.nom;
    document.title = 'KDL Cyclone — ' + (titres[vue] || 'Veille Antilles') + suffixe;
    mesurer('visite', vue);
  }

  window.addEventListener('popstate', function () {
    var r = vueDeChemin(location.pathname);
    allerA(r.vue, { id: r.id, sansHistorique: true });
  });

  /**
   * Plein écran de la carte. Sur téléphone, c'est la seule façon de suivre une
   * trajectoire sans loucher ; sur ordinateur, cela donne à la carte la place
   * qu'elle mérite. La carte est redessinée après la bascule, sinon le canvas
   * garderait ses anciennes dimensions.
   */
  function basculerPleinEcran() {
    var zone = $('#carte-enveloppe');
    if (!zone) return;
    var apres = function () { setTimeout(function () { if (carte) carte.dessiner(); }, 120); };
    if (document.fullscreenElement) {
      (document.exitFullscreen ? document.exitFullscreen() : Promise.resolve()).then(apres, apres);
      return;
    }
    var demander = zone.requestFullscreen || zone.webkitRequestFullscreen;
    if (!demander) {
      // Safari sur iPhone ne l'expose pas : plutôt qu'un bouton mort, on le
      // retire et la carte garde sa hauteur adaptative.
      signaler('Le plein écran n\'est pas disponible sur ce navigateur.');
      return;
    }
    demander.call(zone).then(apres, apres);
  }

  document.addEventListener('fullscreenchange', function () {
    var bouton = $('#plein-ecran');
    if (!bouton) return;
    var actif = !!document.fullscreenElement;
    bouton.setAttribute('aria-label', actif ? 'Quitter le plein écran' : 'Afficher la carte en plein écran');
    if (carte) setTimeout(function () { carte.dessiner(); }, 120);
  });

  /**
   * Anime seulement ce qui est visible. Une boucle satellite qui continue de
   * tourner pendant qu'on lit la météo plus bas ne sert à personne et vide la
   * batterie d'un téléphone.
   */
  function surveillerVisibiliteCarte() {
    var zone = $('#carte-enveloppe');
    if (!zone || typeof IntersectionObserver !== 'function') return;
    new IntersectionObserver(function (entrees) {
      entrees.forEach(function (entree) {
        if (!boucle) return;
        if (!entree.isIntersecting && boucle.lecture) {
          boucle.pause();
          boucle.repriseHorsEcran = true;
        } else if (entree.isIntersecting && boucle.repriseHorsEcran) {
          boucle.repriseHorsEcran = false;
          if (!window.KdlSatellite.mouvementReduit()) boucle.jouer();
        }
      });
    }, { threshold: 0.08 }).observe(zone);
  }

  /**
   * Ouvre un système depuis la carte. Sur grand écran, la fiche vient à côté
   * de la carte : on garde la trajectoire sous les yeux pendant qu'on lit le
   * détail. Sur un écran plus étroit, elle prend toute la vue, ce qui reste la
   * bonne réponse sur un téléphone.
   */
  function ouvrirSysteme(id) {
    var large = window.matchMedia('(min-width: 1200px)').matches;
    if (!large || vueCourante !== 'carte') {
      fermerPanneauSysteme();
      return allerA('systeme', { id: id });
    }
    var agencement = document.querySelector('.carte-agencement');
    var panneau = $('#carte-panneau');
    if (!agencement || !panneau) return allerA('systeme', { id: id });

    panneau.hidden = false;
    agencement.dataset.panneau = 'true';
    rendreFiche(id, '#fiche-laterale');
    panneau.scrollTop = 0;
    if (carte) setTimeout(function () { carte.dessiner(); }, 60);
    mesurer('fiche_laterale', id);
    return undefined;
  }

  function fermerPanneauSysteme() {
    var agencement = document.querySelector('.carte-agencement');
    var panneau = $('#carte-panneau');
    if (!agencement || !panneau) return;
    agencement.removeAttribute('data-panneau');
    panneau.hidden = true;
    if (carte) setTimeout(function () { carte.dessiner(); }, 60);
  }

  function initialiserCarte() {
    if (carte) { carte.dessiner(); return; }
    var canvas = $('#carte');
    carte = new window.KdlCarte(canvas, {
      surClic: function (s) { ouvrirSysteme(s.id); },
      surSurvol: function (s, p) {
        var bulle = $('#carte-infobulle');
        if (!s) { bulle.dataset.visible = 'false'; return; }
        bulle.dataset.visible = 'true';
        bulle.style.left = Math.min(p.x + 14, canvas.clientWidth - 250) + 'px';
        bulle.style.top = Math.max(p.y - 60, 8) + 'px';
        bulle.innerHTML = '<b>' + echapper(s.nom || s.designation) + '</b>'
          + nombre(distancePour(s)) + ' km de ' + echapper((territoireActif().article || '') + territoireActif().nom) + '<br>'
          + (typeof s.prob7j === 'number' ? 'NHC 7 jours : ' + s.prob7j + ' %<br>' : '')
          + 'Potentiel KDL : ' + ((s.potentiel && s.potentiel.score) || '—') + '/100';
      },
    });

    surveillerVisibiliteCarte();

    var calques = [
      ['satellite', 'Satellite (boucle)', false],
      ['zones', 'Zones surveillées', true],
      ['trajectoires', 'Trajectoires officielles', true],
      ['cones', 'Cônes officiels', true],
      ['corridors', 'Corridors KDL', true],
      ['grille', 'Grille', true],
    ];
    $('#calques').innerHTML =
      '<button class="calques__bascule" type="button" id="basculer-calques" aria-expanded="false">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 4-6 3v13l6-3 6 3 6-3V4l-6 3z"/></svg>'
      + '<span>Calques</span></button>'
      + '<div class="calques__liste" id="calques-liste">'
      + calques.map(function (c) {
        return '<label><input type="checkbox" data-calque="' + c[0] + '"' + (c[2] ? ' checked' : '') + '>' + c[1] + '</label>';
      }).join('')
      + '</div>';

    // La légende explique la couleur ET la forme : un anneau de plus par
    // niveau, pour que l'information reste lisible sans distinguer les teintes.
    $('#carte-legende').innerHTML =
      '<span><i style="background:var(--texte-faible)"></i>Suivi, sans menace</span>'
      + '<span><i style="background:var(--cyan)"></i>Veille</span>'
      + '<span><i style="background:var(--ambre)"></i>Surveillance · 1 anneau</span>'
      + '<span><i style="background:var(--ambre-vif)"></i>Préparation · 2 anneaux</span>'
      + '<span><i style="background:var(--rouge)"></i>Impact possible · 3 anneaux</span>'
      + '<span style="color:var(--texte-faible)">Trait plein = officiel NHC · '
      + 'pointillés = corridor KDL indicatif · le pourcentage est la probabilité officielle à 7 jours</span>';

    carte.chargerGeo().then(function () {
      if (etat) carte.definirEtat(etat);
      else carte.dessiner();
    });

    // L'invitation à charger la boucle s'affiche dès l'ouverture de la carte :
    // rien n'est téléchargé tant que l'utilisateur ne l'a pas demandé.
    rendreControlesSatellite();
  }

  // ---------------------------------------------------------------- thème

  /**
   * Applique un thème. La préférence n'est enregistrée que sur choix explicite
   * de l'utilisateur : sans cela, la simple ouverture de l'application aurait
   * figé un thème que personne n'a demandé.
   */
  function appliquerTheme(theme, choixExplicite) {
    document.documentElement.dataset.theme = theme;
    if (choixExplicite) {
      try { localStorage.setItem(CLE_THEME, theme); } catch (e) { /* stockage refusé */ }
    }

    var sombre = theme === 'sombre';
    // La barre système du téléphone suit le thème de l'application.
    var couleur = document.querySelector('#couleur-systeme');
    if (couleur) couleur.setAttribute('content', sombre ? '#0b0c0e' : '#1f5278');

    var bouton = $('#bouton-theme');
    bouton.setAttribute('aria-label', sombre ? 'Passer en mode clair' : 'Passer en mode sombre');
    bouton.setAttribute('title', sombre ? 'Mode clair' : 'Mode sombre');
    $('#icone-theme').innerHTML = sombre
      ? '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
      : '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5"/>';

    if (etat) { rendreCadran(); if (carte) carte.dessiner(); }
  }

  // ---------------------------------------------------------------- écoutes

  document.addEventListener('click', function (e) {
    var nav = e.target.closest('.nav__lien');
    if (nav) return allerA(nav.dataset.vue);

    var vers = e.target.closest('[data-vers]');
    if (vers) return allerA(vers.dataset.vers);

    var sys = e.target.closest('[data-systeme]');
    if (sys) {
      return vueCourante === 'carte'
        ? ouvrirSysteme(sys.dataset.systeme)
        : allerA('systeme', { id: sys.dataset.systeme });
    }

    var surCarte = e.target.closest('[data-carte]');
    if (surCarte) {
      allerA('carte');
      var s = (etat.systemes || []).find(function (x) { return x.id === surCarte.dataset.carte; });
      setTimeout(function () { if (carte && s) carte.cadrerSur(s); }, 60);
      return;
    }

    var facteur = e.target.closest('[data-facteur]');
    if (facteur) {
      var bloc = facteur.closest('.facteur');
      var ouvert = bloc.dataset.ouvert === 'true';
      bloc.dataset.ouvert = String(!ouvert);
      facteur.setAttribute('aria-expanded', String(!ouvert));
      return;
    }

    var aPartager = e.target.closest('[data-partager]');
    if (aPartager) {
      var cible = (etat.systemes || []).find(function (x) { return x.id === aPartager.dataset.partager; });
      if (cible) partager(cible);
      return;
    }

    // Clic vers KDLTech : compté de façon agrégée, sans identifiant.
    if (e.target.closest('[data-kdltech]')) mesurer('clic_kdltech');

    if (e.target.closest('#installer-maintenant')) {
      window.KdlInstallation.installer().then(function (resultat) {
        if (resultat === 'installee') signaler('KDL Cyclone est installée. Vous la retrouverez sur votre écran d\'accueil.');
        else if (resultat === 'indisponible') allerA('installer');
        rendreInvitationInstallation();
        if (vueCourante === 'installer') rendreInstaller();
      });
      return;
    }
    if (e.target.closest('#continuer-web')) {
      window.KdlInstallation.refuser();
      rendreInvitationInstallation();
      return;
    }

    var bascule = e.target.closest('#basculer-calques');
    if (bascule) {
      var panneau = $('#calques');
      var ouvert = panneau.dataset.ouvert === 'true';
      panneau.dataset.ouvert = String(!ouvert);
      bascule.setAttribute('aria-expanded', String(!ouvert));
      return;
    }

    if (e.target.closest('#charger-satellite')) { chargerSatellite(); return; }
    if (e.target.closest('#confirmer-satellite')) { confirmerChargementSatellite(); return; }
    if (e.target.closest('#sat-play')) { boucle.basculer(); return; }
    if (e.target.closest('#sat-prec')) { boucle.pause(); boucle.precedente(); return; }
    if (e.target.closest('#sat-suiv')) { boucle.pause(); boucle.suivante(); return; }
    if (e.target.closest('#sat-direct')) { boucle.revenirAuDirect(); return; }
    var vitesse = e.target.closest('[data-vitesse]');
    if (vitesse) { boucle.definirVitesse(Number(vitesse.dataset.vitesse)); return; }

    if (e.target.closest('#partager-beta')) {
      var t = window.KdlBeta.textes(etat);
      ouvrirPartage('KDL Cyclone — bêta publique', t.general, location.origin + '/beta');
      return;
    }
    if (e.target.closest('#aller-avis')) {
      var bloc = $('#bloc-avis');
      if (bloc) bloc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var aCopier = e.target.closest('[data-copier]');
    if (aCopier) {
      var champ = $('#' + aCopier.dataset.copier);
      window.KdlBeta.copier(champ.value)
        .then(function () { signaler('Texte copié.'); })
        .catch(function () { signaler('La copie a échoué. Sélectionnez le texte à la main.'); });
      return;
    }
    if (e.target.closest('[data-copier-texte]')) {
      var panneau = $('#partage-replis');
      window.KdlBeta.copier(panneau.dataset.texte)
        .then(function () { signaler('Lien et texte copiés.'); panneau.dataset.visible = 'false'; })
        .catch(function () { signaler('La copie a échoué.'); });
      return;
    }
    if (e.target.closest('#fermer-replis')) {
      $('#partage-replis').dataset.visible = 'false';
      return;
    }
    if (e.target.id === 'partage-replis') {
      e.target.dataset.visible = 'false';
      return;
    }

    // Chercheur de commune : ouverture, fermeture, choix, et clic sur le fond.
    if (e.target.closest('#ouvrir-lieu')) return ouvrirChercheurLieu();
    if (e.target.closest('#fermer-lieu')) return fermerChercheurLieu();
    var itemLieu = e.target.closest('.chercheur-item');
    if (itemLieu) return choisirLieuDepuisListe(itemLieu);
    var panneauLieu = $('#panneau-lieu');
    if (panneauLieu && !panneauLieu.hidden && e.target === panneauLieu) {
      return fermerChercheurLieu();
    }

    if (e.target.closest('#retour-accueil')) return allerA('accueil');
    if (e.target.closest('#bouton-actualiser')) return charger(true);
    if (e.target.closest('#reessayer')) return charger(true);
    if (e.target.closest('#zoom-plus')) return carte && carte.zoomer(1.3);
    if (e.target.closest('#zoom-moins')) return carte && carte.zoomer(1 / 1.3);
    if (e.target.closest('#recentrer')) return carte && carte.recentrer('guadeloupe');
    if (e.target.closest('#plein-ecran')) return basculerPleinEcran();
    if (e.target.closest('#fermer-panneau')) return fermerPanneauSysteme();

    var boutonMaj = e.target.closest('#appliquer-maj, #verifier-maj');
    if (boutonMaj) return appliquerMiseAJour(boutonMaj);

    if (e.target.closest('#copier-lien')) return copierAdresse();
    if (e.target.closest('#aide-navigateur')) {
      var aide = $('#aide-navigateur-texte');
      if (aide) aide.hidden = !aide.hidden;
      return undefined;
    }
    if (e.target.closest('#ouvrir-chrome')) {
      mesurer('ouvrir_chrome');
      // Le lien fait le travail ; si l'application hôte le bloque, la marche à
      // suivre reste affichée juste en dessous.
      return undefined;
    }

    if (e.target.closest('#bouton-theme')) {
      // Bascule demandée par l'utilisateur : sa préférence est retenue.
      return appliquerTheme(document.documentElement.dataset.theme === 'sombre' ? 'clair' : 'sombre', true);
    }

    if (e.target.closest('#reinitialiser-prep')) {
      window.KdlPreparation.reinitialiser();
      rendrePreparation();
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'formulaire-retour') {
      e.preventDefault();
      soumettreRetour(e.target);
    }
  });

  document.addEventListener('keydown', function (e) {
    // Le chercheur de commune se pilote entièrement au clavier : flèches pour
    // parcourir, Entrée pour valider le premier résultat, Échap pour sortir.
    var panneauLieu = $('#panneau-lieu');
    if (panneauLieu && !panneauLieu.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); fermerChercheurLieu(); return; }
      if (e.key === 'Enter') {
        var premier = panneauLieu.querySelector('.chercheur-item');
        if (premier) { e.preventDefault(); choisirLieuDepuisListe(premier); }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = [].slice.call(panneauLieu.querySelectorAll('.chercheur-item'));
        if (!items.length) return;
        e.preventDefault();
        var i = items.indexOf(document.activeElement);
        var suivant = e.key === 'ArrowDown'
          ? items[i < 0 ? 0 : Math.min(i + 1, items.length - 1)]
          : (i <= 0 ? $('#recherche-lieu') : items[i - 1]);
        if (suivant) suivant.focus();
        return;
      }
      return;
    }

    if (e.key !== 'Escape') return;
    var p = $('#partage-replis');
    if (p && p.dataset.visible === 'true') {
      p.dataset.visible = 'false';
      return;
    }
    // Échap ferme aussi la fiche latérale : elle se referme comme n'importe
    // quel panneau, sans obliger à viser la croix.
    var agencement = document.querySelector('.carte-agencement[data-panneau="true"]');
    if (agencement) fermerPanneauSysteme();
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'sat-curseur' && boucle) {
      boucle.pause();
      boucle.allerA(Number(e.target.value));
      return;
    }
    if (e.target.id === 'recherche-lieu') rafraichirListeLieux(e.target.value);
  });

  /**
   * Applique le lieu d'un élément de la liste. On ferme AVANT d'appliquer :
   * `definirLieu` redessine toute la page météo, donc le panneau disparaît avec
   * elle — si on fermait après, il ne resterait que la classe posée sur `body`,
   * et le défilement de la page resterait bloqué.
   */
  function choisirLieuDepuisListe(item) {
    var cle = item.dataset.lieu || '';
    document.body.classList.remove('chercheur-ouvert');
    definirLieu(cle);
    var bouton = $('#ouvrir-lieu');
    if (bouton) bouton.focus();
  }

  document.addEventListener('change', function (e) {
    var prep = e.target.closest('[data-prep]');
    if (prep) {
      window.KdlPreparation.basculer(prep.dataset.prep);
      rendrePreparation();
      return;
    }
    if (e.target.id === 'sat-curseur' && boucle) {
      boucle.pause();
      boucle.allerA(Number(e.target.value));
      return;
    }
    if (e.target.id === 'choix-territoire') {
      definirTerritoire(e.target.value);
      return;
    }
    var calque = e.target.closest('[data-calque]');
    if (calque && carte) {
      if (calque.dataset.calque === 'satellite' && calque.checked && !boucle) {
        calque.checked = false;
        chargerSatellite();
        return;
      }
      carte.definirCalque(calque.dataset.calque, calque.checked);
    }
  });

  window.addEventListener('online', function () { horsLigne = false; charger(true); });
  window.addEventListener('offline', function () { horsLigne = true; if (etat) rendreBandeauConnexion(); });

  var redimensionnement;
  window.addEventListener('resize', function () {
    clearTimeout(redimensionnement);
    redimensionnement = setTimeout(function () {
      if (etat) rendreCadran();
      if (carte && vueCourante === 'carte') carte.dessiner();
    }, 150);
  });

  // Rafraîchissement discret quand l'application revient au premier plan.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (boucle && boucle.lecture) { boucle.pause(); boucle.repriseAttendue = true; }
      return;
    }
    if (boucle && boucle.repriseAttendue && !window.KdlSatellite.mouvementReduit()) {
      boucle.repriseAttendue = false;
      boucle.jouer();
    }
    if (ageDonnees() > 5 * 60 * 1000) charger();
  });

  /**
   * Flux d'événements : le serveur signale une nouvelle collecte, on recharge
   * les données sans recharger la page ni interrompre l'animation en cours.
   * L'interrogation périodique reste en place comme filet.
   */
  var fluxErreurs = 0;
  function ouvrirFlux() {
    if (!('EventSource' in window)) return;
    var flux = new EventSource('/api/flux');

    flux.addEventListener('maj', function (e) {
      fluxErreurs = 0;
      var info;
      try { info = JSON.parse(e.data); } catch (err) { return; }
      if (etat && info.genereLe === etat.genereLe) return;

      var etaitAuDirect = !boucle || boucle.estAuDirect();
      charger().then(function () {
        // Une nouvelle image satellite n'interrompt pas une lecture en cours ;
        // si l'utilisateur consulte une heure passée, on le laisse où il est.
        if (boucle && info.derniereImageSatellite && etaitAuDirect) {
          rafraichirBoucleSatellite();
        } else if (boucle && !etaitAuDirect) {
          signaler('Nouvelles données disponibles. Revenez au direct pour les voir.');
        }
      });
    });

    flux.onerror = function () {
      fluxErreurs += 1;
      // EventSource se reconnecte seul ; au-delà de plusieurs échecs, on
      // s'appuie uniquement sur l'interrogation périodique.
      if (fluxErreurs > 6) flux.close();
    };
  }

  function rafraichirBoucleSatellite() {
    if (!boucle) return;
    boucle.chargerMeta().then(function (meta) {
      if (!meta || !meta.images || !meta.images.length) return;
      var connues = boucle.images.map(function (i) { return i.instant; });
      var nouvelles = meta.images.filter(function (i) { return connues.indexOf(i.instant) === -1; });
      if (!nouvelles.length) return;
      var etaitEnLecture = boucle.lecture;
      boucle.pause();
      boucle.charger().then(function () {
        boucle.revenirAuDirect();
        rendreControlesSatellite();
        if (etaitEnLecture) boucle.jouer();
      });
    });
  }

  ouvrirFlux();
  setInterval(function () { if (!document.hidden) charger(); }, 10 * 60 * 1000);

  // ------------------------------------------------------------- démarrage

  // Avant tout rendu : sans cette réparation, la mise en page arrive amputée.
  surveillerStyles();

  // Retour d'un rechargement de mise à jour : on confirme, et le verrou empêche
  // qu'un enchaînement malheureux ne relance un second rechargement.
  (function () {
    var verrou = null;
    try { verrou = sessionStorage.getItem(CLE_VERROU_MAJ); } catch (e) { verrou = null; }
    if (!verrou) return;
    try { sessionStorage.removeItem(CLE_VERROU_MAJ); } catch (e) { /* refusé */ }
    if (Date.now() - Number(verrou) > 60000) return;
    versionServeur().then(function (v) {
      signaler('KDL Cyclone est à jour' + (v && v.version ? ' — version ' + v.version : '') + '.');
    });
  })();

  if (window.KdlInstallation) {
    window.KdlInstallation.compterVue();
    window.KdlInstallation.surChangement(function () {
      rendreInvitationInstallation();
      if (vueCourante === 'installer') rendreInstaller();
    });
  }

  appliquerTheme(document.documentElement.dataset.theme || 'clair');

  // La coquille est utilisable avant toute requête : logo, navigation, choix du
  // territoire, thème et actualisation répondent dès la première image.
  rendreCoquille();

  var memoire = etatMemorise();
  if (memoire) { etat = preparerEtat(memoire); rendreTout(); }
  charger();

  // La vue initiale vient de l'URL : un lien partagé ouvre la bonne page.
  var cheminInitial = location.pathname;
  var routeInitiale = vueDeChemin(cheminInitial);
  var vueDemandee = new URLSearchParams(location.search).get('vue');
  if (['carte', 'guadeloupe', 'preparation', 'sources', 'apropos', 'mentions', 'installer', 'beta', 'meteo'].indexOf(vueDemandee) !== -1) {
    routeInitiale = { vue: vueDemandee };
  }
  allerA(routeInitiale.vue, { id: routeInitiale.id, sansHistorique: true });

  // Un lien partagé arrive avant que les données ne soient chargées : dès
  // qu'elles le sont, on résout le slug et on ouvre la fiche demandée.
  if (routeInitiale.vue === 'systeme' && !routeInitiale.id) {
    var attenduSlug = routeInitiale.slug;
    var resoudreSlug = function () {
      var s = (etat && etat.systemes || []).find(function (x) { return x.slug === attenduSlug; });
      if (s) allerA('systeme', { id: s.id, sansHistorique: true });
      else rendreFiche(null);
    };
    if (etat) resoudreSlug();
    else setTimeout(resoudreSlug, 1500);
  }

  // Installation de l'application : comptée une fois, sans aucun identifiant.
  window.addEventListener('appinstalled', function () { mesurer('installation_pwa'); });
  window.addEventListener('error', function () { mesurer('erreur_technique'); });

  /* ------------------------------------------- détection de mise à jour */

  /**
   * Version qui a produit ce fichier. Le serveur la remplace à la volée ; un
   * exemplaire sorti d'un cache périmé porte donc l'ancienne valeur.
   */
  var VERSION_APP = '__VERSION__';

  /**
   * Le visiteur exécute-t-il une version dépassée ?
   *
   * Ne rien demander au service worker : c'est justement là que le compte n'y
   * était pas. Comme il appelle `skipWaiting()` dès son installation, il ne
   * passe jamais par l'état « en attente » et l'état « installé » est trop
   * fugace pour être saisi de façon fiable. Les deux signaux sur lesquels
   * reposait l'affichage du bouton ne se produisaient donc pratiquement
   * jamais.
   *
   * Pire, une course s'installait au chargement : l'ancien service worker
   * servait `app.js` depuis son cache pendant que le document, lui, arrivait
   * du réseau. Le visiteur se retrouvait avec le nouveau document et l'ancien
   * script, sans aucun bouton pour s'en sortir — il fallait vider le cache à
   * la main, ce qu'on ne peut demander à personne, encore moins un jour
   * d'alerte.
   *
   * La comparaison ci-dessous ne dépend d'aucun de ces mécanismes : le
   * document est toujours servi par le réseau, le script porte la version qui
   * l'a produit, et deux valeurs différentes signifient exactement une chose.
   */
  function versionDepassee() {
    var duDocument = document.documentElement.dataset.version;
    if (!duDocument || !VERSION_APP || VERSION_APP.indexOf('__') === 0) return false;
    return duDocument !== VERSION_APP;
  }

  /** Compare la version exécutée à celle que le serveur publie maintenant. */
  function surveillerVersion() {
    if (versionDepassee()) { proposerMiseAJour(null); return; }
    versionServeur().then(function (v) {
      if (v && v.version && VERSION_APP.indexOf('__') !== 0 && v.version !== VERSION_APP) {
        proposerMiseAJour(null);
      }
    });
  }

  // La surveillance ne dépend pas du service worker : elle vaut aussi pour un
  // navigateur qui n'en gère pas, et c'est elle qui porte la détection.
  window.addEventListener('load', function () {
    // Un onglet laissé ouvert pendant un épisode cyclonique doit apprendre
    // qu'une version corrigée existe, sans que personne ait à recharger.
    surveillerVersion();
    setInterval(surveillerVersion, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) surveillerVersion();
    });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (enr) {
        if (enr.waiting) proposerMiseAJour(enr);
        enr.addEventListener('updatefound', function () {
          var nouveau = enr.installing;
          if (!nouveau) return;
          nouveau.addEventListener('statechange', function () {
            // « installed » avec un contrôleur déjà en place = mise à jour prête.
            if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
              proposerMiseAJour(enr);
            }
          });
        });
      }).catch(function () { /* PWA indisponible : l'app fonctionne quand même */ });
    });
  }
})();
