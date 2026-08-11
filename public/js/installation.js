/**
 * Parcours d'installation de l'application.
 *
 * Principe tenu partout ici : l'invitation arrive APRÈS que l'utilisateur a vu
 * à quoi sert l'application, jamais avant. Pas de fenêtre surgissante au
 * premier affichage, pas d'écran bloquant, pas de relance insistante. Un refus
 * est définitif pendant plusieurs semaines.
 */
(function (global) {
  'use strict';

  var CLE_REFUS = 'kdl-cyclone-install-refus';
  var CLE_VUES = 'kdl-cyclone-vues';
  // Après un refus, on ne repropose rien pendant 60 jours.
  var DELAI_APRES_REFUS_MS = 60 * 24 * 3600 * 1000;
  // L'invitation n'apparaît qu'à partir de la troisième consultation.
  var VUES_AVANT_INVITATION = 3;

  var promesseInstallation = null;
  var ecouteurs = [];

  function lire(cle, defaut) {
    try {
      var v = localStorage.getItem(cle);
      return v === null ? defaut : JSON.parse(v);
    } catch (e) { return defaut; }
  }

  function ecrire(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* ignoré */ }
  }

  /** L'application tourne-t-elle déjà en fenêtre autonome ? */
  function estInstallee() {
    return global.matchMedia('(display-mode: standalone)').matches
      || global.matchMedia('(display-mode: window-controls-overlay)').matches
      || global.navigator.standalone === true;
  }

  /**
   * Plateforme détectée, pour n'afficher que les instructions pertinentes :
   * jamais la marche à suivre iPhone sur un Android.
   */
  function plateforme() {
    var ua = navigator.userAgent;
    var estIOS = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (estIOS) {
      return { code: 'ios', mobile: true, nom: /iPad/.test(ua) ? 'iPad' : 'iPhone' };
    }
    if (/Android/.test(ua)) return { code: 'android', mobile: true, nom: 'Android' };
    if (/Firefox/.test(ua)) return { code: 'firefox', mobile: false, nom: 'Firefox' };
    return { code: 'ordinateur', mobile: false, nom: 'ordinateur' };
  }

  /**
   * Navigateur intégré à une application, façon Facebook ou TikTok.
   *
   * Ces navigateurs n'installent pas d'application web : `beforeinstallprompt`
   * ne s'y déclenche jamais. Afficher un bouton « Installer » y reviendrait à
   * afficher un bouton mort — il faut au contraire proposer d'ouvrir la page
   * dans le vrai navigateur du téléphone.
   *
   * On regarde d'abord les capacités réelles, puis les indices du user-agent,
   * qui restent le seul signal disponible pour reconnaître ces coquilles.
   */
  function navigateurIntegre() {
    var ua = navigator.userAgent || '';
    // Messenger d'abord : son user-agent porte aussi les marqueurs Facebook,
    // et annoncer « Facebook » à quelqu'un qui est dans Messenger sèmerait le
    // doute au moment précis où il doit suivre une consigne.
    var connus = [
      { motif: /Messenger|MessengerLiteFor|FB_IAB\/MESSENGER/, code: 'messenger', nom: 'Messenger' },
      { motif: /FBAN|FBAV|FB_IAB|FBIOS/, code: 'facebook', nom: 'Facebook' },
      { motif: /Instagram/, code: 'instagram', nom: 'Instagram' },
      { motif: /musical_ly|Bytedance|TikTok|BytedanceWebview/, code: 'tiktok', nom: 'TikTok' },
      { motif: /LinkedInApp|LinkedIn/, code: 'linkedin', nom: 'LinkedIn' },
      { motif: /Twitter|X11; Twitter/, code: 'twitter', nom: 'X' },
      { motif: /Snapchat/, code: 'snapchat', nom: 'Snapchat' },
    ];
    for (var i = 0; i < connus.length; i += 1) {
      if (connus[i].motif.test(ua)) {
        return { code: connus[i].code, nom: connus[i].nom, certain: true };
      }
    }
    // WebView Android générique : le marqueur « wv » est posé par le système,
    // et l'absence d'installation possible le confirme.
    if (/Android/.test(ua) && /; wv\)/.test(ua)) {
      return { code: 'webview', nom: 'une application', certain: true };
    }
    // Repli prudent : un navigateur sans invite d'installation, sans partage
    // natif et manifestement encapsulé. On ne conclut pas à la légère.
    if (/Android/.test(ua) && !('onbeforeinstallprompt' in global) && !navigator.share) {
      return { code: 'inconnu', nom: 'cette application', certain: false };
    }
    return null;
  }

  /**
   * Adresse permettant de rouvrir la page courante dans Chrome sur Android.
   *
   * L'URL `intent://` conserve le chemin, les paramètres — donc le territoire
   * choisi et la campagne — et prévoit un repli : si Chrome est absent, le
   * système renvoie vers la même page en HTTPS plutôt que d'échouer sans rien
   * dire.
   */
  function lienChrome() {
    var url = global.location.href.replace(/^https?:\/\//, '');
    var repli = encodeURIComponent(global.location.href);
    return 'intent://' + url + '#Intent;scheme=https;package=com.android.chrome;'
      + 'S.browser_fallback_url=' + repli + ';end';
  }

  /** L'installation native est-elle réellement proposable maintenant ? */
  function installationDisponible() {
    return promesseInstallation !== null;
  }

  function refusRecent() {
    var refus = lire(CLE_REFUS, 0);
    return refus && Date.now() - refus < DELAI_APRES_REFUS_MS;
  }

  /** Faut-il montrer l'encart d'invitation ? */
  function inviterMaintenant() {
    if (estInstallee()) return false;
    if (refusRecent()) return false;
    if (lire(CLE_VUES, 0) < VUES_AVANT_INVITATION) return false;
    // Sur iOS, aucune installation automatique : on invite quand même, mais
    // seulement avec la marche à suivre, et sous les mêmes conditions.
    return installationDisponible() || plateforme().code === 'ios';
  }

  function compterVue() {
    ecrire(CLE_VUES, lire(CLE_VUES, 0) + 1);
  }

  function prevenir() {
    ecouteurs.forEach(function (f) {
      try { f(); } catch (e) { /* un écouteur fautif n'en bloque pas d'autres */ }
    });
  }

  // Chrome, Edge et dérivés annoncent l'installation par cet événement.
  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    promesseInstallation = e;
    prevenir();
  });

  global.addEventListener('appinstalled', function () {
    promesseInstallation = null;
    ecrire(CLE_REFUS, 0);
    prevenir();
  });

  /**
   * Lance l'installation native.
   * @returns {Promise<'installee'|'refusee'|'indisponible'>}
   */
  function installer() {
    if (!promesseInstallation) return Promise.resolve('indisponible');
    var invite = promesseInstallation;
    promesseInstallation = null;
    invite.prompt();
    return invite.userChoice.then(function (choix) {
      if (choix.outcome === 'accepted') {
        prevenir();
        return 'installee';
      }
      // Refus enregistré : on ne redemandera pas avant deux mois.
      ecrire(CLE_REFUS, Date.now());
      prevenir();
      return 'refusee';
    }).catch(function () { return 'indisponible'; });
  }

  function refuser() {
    ecrire(CLE_REFUS, Date.now());
    prevenir();
  }

  /** Marche à suivre adaptée à la plateforme réellement détectée. */
  function instructions() {
    var p = plateforme();
    if (p.code === 'ios') {
      return {
        titre: 'Installer sur ' + p.nom,
        auto: false,
        etapes: [
          'Touchez le bouton Partager, en bas de Safari (le carré avec une flèche vers le haut).',
          'Faites défiler et choisissez « Sur l\'écran d\'accueil ».',
          'Confirmez avec « Ajouter ».',
        ],
        note: 'Safari ne permet pas l\'installation automatique : ces trois étapes la remplacent. '
          + 'L\'application s\'ouvrira ensuite comme une application normale, sans barre de navigateur.',
      };
    }
    if (p.code === 'android') {
      return {
        titre: 'Installer sur Android',
        auto: installationDisponible(),
        etapes: [
          'Ouvrez le menu du navigateur (les trois points, en haut à droite).',
          'Choisissez « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».',
          'Confirmez.',
        ],
        note: 'L\'application apparaîtra dans votre tiroir d\'applications, avec son icône, '
          + 'et fonctionnera même sans connexion.',
      };
    }
    if (p.code === 'firefox') {
      return {
        titre: 'Ajouter un raccourci',
        auto: false,
        etapes: [
          'Firefox n\'installe pas les applications web sur ordinateur.',
          'Ajoutez cette page à vos marque-pages avec Ctrl + D.',
          'Sur Chrome ou Edge, l\'installation complète en fenêtre autonome est disponible.',
        ],
        note: 'L\'application reste entièrement utilisable dans Firefox, y compris hors connexion.',
      };
    }
    return {
      titre: 'Installer sur ordinateur',
      auto: installationDisponible(),
      etapes: [
        'Cliquez sur l\'icône d\'installation dans la barre d\'adresse (à droite).',
        'Ou ouvrez le menu du navigateur et choisissez « Installer KDL Cyclone ».',
        'Confirmez.',
      ],
      note: 'L\'application s\'ouvrira dans sa propre fenêtre, sans barre d\'adresse, '
        + 'et se lancera depuis votre menu Démarrer ou votre dock.',
    };
  }

  global.KdlInstallation = {
    estInstallee: estInstallee,
    plateforme: plateforme,
    navigateurIntegre: navigateurIntegre,
    lienChrome: lienChrome,
    disponible: installationDisponible,
    inviterMaintenant: inviterMaintenant,
    compterVue: compterVue,
    installer: installer,
    refuser: refuser,
    instructions: instructions,
    surChangement: function (f) { ecouteurs.push(f); },
  };
})(window);
