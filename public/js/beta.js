/**
 * Bêta publique : partage, visuels téléchargeables et formulaire de retour.
 *
 * Aucun script de réseau social n'est chargé : les replis sont de simples liens
 * `https://`, ce qui évite tout traceur tiers et n'oblige jamais l'utilisateur à
 * se connecter à un réseau depuis KDL Cyclone.
 */
(function (global) {
  'use strict';

  var BASE = location.origin;

  /** Textes proposés, modifiables par l'utilisateur avant envoi. */
  function textes(etat) {
    var general =
      "🌀 Découvrez KDL Cyclone, une nouvelle web app gratuite conçue en Guadeloupe par KDLTech.\n"
      + "Suivez les ondes tropicales, consultez les données officielles et comprenez les facteurs "
      + "favorables ou défavorables à leur évolution.\n"
      + "La bêta est accessible gratuitement dans le KDL Lab, directement sur le Web ou en "
      + "installation sur votre téléphone.\n\n" + BASE + '/beta';

    var linkedin =
      "KDLTech lance dans son Lab la bêta publique de KDL Cyclone, une application web gratuite "
      + "conçue en Guadeloupe pour rendre le suivi des ondes tropicales plus clair, transparent et "
      + "accessible.\n\nL'application centralise les données officielles, conserve l'évolution des "
      + "bulletins et explique les principaux facteurs météorologiques. Elle est utilisable "
      + "directement dans le navigateur ou installable gratuitement comme PWA.\n\n" + BASE + '/beta';

    return { general: general, linkedin: linkedin };
  }

  /**
   * Texte de partage d'une perturbation. Il n'est produit qu'à partir de
   * données réellement datées : sans heure de bulletin, on ne prétend rien.
   */
  function texteSysteme(s, etat, heureLocale) {
    var lignes = ['🌀 Évolution en cours dans l\'Atlantique tropical.'];
    var nom = s.nom || s.designation;
    lignes.push('');
    lignes.push(nom + ' — ' + s.statut + '.');
    if (typeof s.prob7j === 'number') {
      lignes.push('Probabilité officielle de formation à 7 jours (NHC) : ' + s.prob7j + ' %.');
    }
    if (s.potentiel && s.potentiel.score != null) {
      lignes.push('Potentiel KDL (analyse indicative, non officielle) : ' + s.potentiel.score + '/100.');
    }
    if (typeof s.distanceGuadeloupeKm === 'number') {
      lignes.push('Distance de la Guadeloupe : ' + s.distanceGuadeloupeKm.toLocaleString('fr-FR') + ' km.');
    }
    // La date accompagne toujours la donnée : sans elle, elle devient fausse.
    var quand = (s.fraicheur && s.fraicheur.emisLe) || etat.genereLe;
    lignes.push('Données du ' + heureLocale(quand, true) + ' (heure de Guadeloupe).');
    if (s.fraicheur && s.fraicheur.etat === 'donnees_anciennes') {
      lignes.push('⚠ Information ancienne : vérifiez auprès du NHC et de Météo-France.');
    }
    lignes.push('');
    lignes.push('Retrouvez les dernières probabilités officielles, leur heure de publication et '
      + "l'analyse détaillée sur KDL Cyclone.");
    lignes.push(BASE + '/systemes/' + (s.slug || ''));
    lignes.push('Bêta publique gratuite créée en Guadeloupe par KDLTech.');
    return lignes.join('\n');
  }

  /**
   * Replis de partage : de simples liens, aucun kit de développement tiers,
   * aucune connexion demandée à l'utilisateur.
   */
  function liensReseaux(url, texte) {
    var u = encodeURIComponent(url);
    var t = encodeURIComponent(texte);
    return [
      { cle: 'copier', nom: 'Copier le lien', url: null },
      { cle: 'whatsapp', nom: 'WhatsApp', url: 'https://wa.me/?text=' + t },
      { cle: 'facebook', nom: 'Facebook', url: 'https://www.facebook.com/sharer/sharer.php?u=' + u },
      { cle: 'linkedin', nom: 'LinkedIn', url: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u },
      { cle: 'x', nom: 'X', url: 'https://twitter.com/intent/tweet?text=' + t },
      { cle: 'telegram', nom: 'Telegram', url: 'https://t.me/share/url?url=' + u + '&text=' + t },
      {
        cle: 'email',
        nom: 'E-mail',
        url: 'mailto:?subject=' + encodeURIComponent('KDL Cyclone — veille tropicale aux Antilles')
          + '&body=' + t,
      },
    ];
  }

  /**
   * Partage natif quand le système le propose — c'est la seule voie qui peut
   * offrir TikTok, Messenger ou les Stories, selon les applications installées.
   */
  function partageNatif(donnees) {
    if (!navigator.share) return Promise.resolve('indisponible');
    return navigator.share(donnees)
      .then(function () { return 'partage'; })
      .catch(function (e) {
        return e && e.name === 'AbortError' ? 'annule' : 'indisponible';
      });
  }

  function copier(texte) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texte);
    }
    // Repli pour les navigateurs sans presse-papiers asynchrone.
    return new Promise(function (resoudre, rejeter) {
      var zone = document.createElement('textarea');
      zone.value = texte;
      zone.setAttribute('readonly', '');
      zone.style.position = 'fixed';
      zone.style.left = '-9999px';
      document.body.appendChild(zone);
      zone.select();
      try {
        document.execCommand('copy');
        resoudre();
      } catch (e) {
        rejeter(e);
      } finally {
        document.body.removeChild(zone);
      }
    });
  }

  var CATEGORIES = [
    ['avis', 'Avis général'],
    ['suggestion', 'Suggestion'],
    ['information_incorrecte', 'Information incorrecte'],
    ['bug_affichage', "Problème d'affichage"],
    ['probleme_installation', "Problème d'installation"],
    ['fraicheur_donnees', 'Données pas à jour'],
  ];

  /** Envoie un retour. Le serveur valide à nouveau : ceci n'est qu'un confort. */
  function envoyerRetour(donnees) {
    return fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(donnees),
    }).then(function (r) {
      return r.json().then(function (corps) { return { statut: r.status, corps: corps }; });
    });
  }

  global.KdlBeta = {
    textes: textes,
    texteSysteme: texteSysteme,
    liensReseaux: liensReseaux,
    partageNatif: partageNatif,
    copier: copier,
    envoyerRetour: envoyerRetour,
    CATEGORIES: CATEGORIES,
  };
})(window);
