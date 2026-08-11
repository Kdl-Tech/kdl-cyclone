/**
 * Mode préparation — entièrement hors connexion.
 *
 * Le contenu est embarqué dans ce fichier : une fois l'application installée,
 * la liste reste consultable sans réseau, sans électricité côté serveur, et
 * l'avancement est conservé en local sur l'appareil.
 *
 * Les quantités reprennent les recommandations usuelles de la sécurité civile
 * pour les Antilles : autonomie de 72 heures, eau en tête.
 */
(function (global) {
  'use strict';

  var CLE = 'kdl-cyclone-preparation';

  var GROUPES = [
    {
      id: 'eau',
      titre: 'Eau',
      intro: "La première ressource à manquer, et celle qu'on ne peut pas improviser.",
      items: [
        { id: 'eau-boisson', nom: '3 litres d\'eau par personne et par jour', detail: 'Sur 3 jours minimum, soit 9 litres par personne. Comptez aussi les animaux.' },
        { id: 'eau-sanitaire', nom: 'Réserve d\'eau sanitaire', detail: 'Baignoire, seaux, bidons remplis avant le passage : chasse d\'eau et toilette.' },
        { id: 'eau-traitement', nom: 'Pastilles de purification ou eau de Javel', detail: 'Permet de rendre potable une eau douteuse si la coupure dure.' },
      ],
    },
    {
      id: 'alimentation',
      titre: 'Alimentation',
      intro: 'De quoi tenir sans cuisson et sans réfrigérateur.',
      items: [
        { id: 'ali-conserves', nom: 'Vivres non périssables pour 3 à 7 jours', detail: 'Conserves, riz, pâtes, biscuits, fruits secs, lait UHT. Rien qui exige un congélateur.' },
        { id: 'ali-ouvre-boite', nom: 'Ouvre-boîte manuel', detail: 'Détail classique oublié : des conserves sans ouvre-boîte ne servent à rien.' },
        { id: 'ali-bebe', nom: 'Alimentation spécifique', detail: 'Lait infantile, petits pots, régimes particuliers, nourriture pour animaux.' },
        { id: 'ali-rechaud', nom: 'Réchaud à gaz et cartouches', detail: 'À utiliser uniquement dans un local ventilé, jamais à l\'intérieur fermé.' },
      ],
    },
    {
      id: 'sante',
      titre: 'Santé et médicaments',
      intro: 'Les pharmacies peuvent rester fermées plusieurs jours.',
      items: [
        { id: 'sante-traitement', nom: 'Traitements en cours, 1 mois d\'avance', detail: 'Ordonnances comprises. Anticipez le renouvellement avant la saison.' },
        { id: 'sante-trousse', nom: 'Trousse de premiers secours', detail: 'Pansements, antiseptique, compresses, bande, paracétamol, thermomètre.' },
        { id: 'sante-materiel', nom: 'Matériel médical et lunettes de rechange', detail: 'Appareils sur batterie : prévoyez l\'autonomie électrique correspondante.' },
        { id: 'sante-moustiques', nom: 'Répulsif anti-moustiques', detail: 'Après les fortes pluies, les eaux stagnantes favorisent les moustiques.' },
      ],
    },
    {
      id: 'documents',
      titre: 'Documents',
      intro: 'Rassemblés dans une pochette étanche, prêts à emporter.',
      items: [
        { id: 'doc-identite', nom: 'Pièces d\'identité, livret de famille', detail: 'Originaux en pochette étanche, photos sur le téléphone en secours.' },
        { id: 'doc-assurance', nom: 'Contrat d\'assurance habitation', detail: 'Numéro de police et téléphone du déclarant sinistre notés à part.' },
        { id: 'doc-sante', nom: 'Carte Vitale, carnet de santé, ordonnances', detail: 'Utile si vous devez être pris en charge ailleurs que chez votre médecin.' },
        { id: 'doc-numerique', nom: 'Sauvegarde numérique hors ligne', detail: 'Copie des documents sur une clé USB, indépendante d\'Internet.' },
      ],
    },
    {
      id: 'energie',
      titre: 'Énergie et éclairage',
      intro: 'La coupure de courant est la conséquence la plus fréquente, même sans dégât majeur.',
      items: [
        { id: 'ene-lampes', nom: 'Lampes torches et frontales', detail: 'Une par personne. Les bougies sont à éviter : risque d\'incendie.' },
        { id: 'ene-piles', nom: 'Piles de rechange', detail: 'Aux formats réellement utilisés par vos lampes et votre radio.' },
        { id: 'ene-batteries', nom: 'Batteries externes chargées', detail: 'À recharger dès qu\'un système est annoncé, pas au dernier moment.' },
        { id: 'ene-chargeur-voiture', nom: 'Chargeur allume-cigare', detail: 'Le véhicule devient une source d\'énergie de secours.' },
        { id: 'ene-radio', nom: 'Radio à piles ou à manivelle', detail: 'Le seul canal qui fonctionne encore quand le réseau mobile tombe. Notez la fréquence de Guadeloupe La 1ère.' },
      ],
    },
    {
      id: 'habitation',
      titre: 'Habitation',
      intro: 'À faire avant, pendant qu\'il fait encore beau.',
      items: [
        { id: 'hab-volets', nom: 'Volets, protections et fixations vérifiés', detail: 'Contrôlez les fixations en début de saison, pas la veille du passage.' },
        { id: 'hab-jardin', nom: 'Extérieur dégagé', detail: 'Mobilier, plantes en pot, poubelles, tôles : tout ce qui vole doit rentrer.' },
        { id: 'hab-gouttieres', nom: 'Gouttières et évacuations dégagées', detail: 'Les inondations viennent souvent d\'une évacuation bouchée.' },
        { id: 'hab-arbres', nom: 'Élagage des branches proches du toit', detail: 'À anticiper largement : les déchets verts doivent être évacués avant.' },
      ],
    },
    {
      id: 'divers',
      titre: 'Autonomie et sécurité',
      intro: 'Ce qui fait la différence quand la situation dure.',
      items: [
        { id: 'div-especes', nom: 'Argent liquide en petites coupures', detail: 'Sans électricité, ni carte bancaire ni distributeur ne fonctionnent.' },
        { id: 'div-carburant', nom: 'Réservoir de carburant plein', detail: 'À faire dès l\'annonce d\'un système, avant la file d\'attente aux stations.' },
        { id: 'div-outils', nom: 'Outils de base', detail: 'Couteau, scie, corde, ruban adhésif, gants, bâches, clous.' },
        { id: 'div-extincteur', nom: 'Extincteur vérifié', detail: 'Les départs de feu augmentent avec les groupes électrogènes et les bougies.' },
        { id: 'div-animaux', nom: 'Animaux mis à l\'abri', detail: 'Prévoyez leur eau, leur nourriture et un lieu sûr à l\'intérieur.' },
      ],
    },
    {
      id: 'contacts',
      titre: 'Contacts et plan familial',
      intro: 'Décidé à froid, écrit sur papier.',
      items: [
        { id: 'con-papier', nom: 'Numéros essentiels notés sur papier', detail: 'Un téléphone déchargé ne donne accès à aucun répertoire.' },
        { id: 'con-point', nom: 'Point de rassemblement convenu', detail: 'Un lieu connu de tous si vous êtes séparés et sans réseau.' },
        { id: 'con-abri', nom: 'Abri le plus proche repéré', detail: 'Renseignez-vous auprès de votre mairie sur le centre d\'hébergement de votre commune.' },
        { id: 'con-voisins', nom: 'Voisins isolés identifiés', detail: 'Personnes âgées, handicapées ou seules : prévenez-les et gardez le contact.' },
      ],
    },
    {
      id: 'apres',
      titre: 'Après le passage',
      intro: 'La phase la plus sous-estimée : la majorité des accidents arrive après.',
      items: [
        { id: 'apr-attendre', nom: 'Attendre la fin officielle de l\'alerte', detail: 'L\'œil du cyclone donne un calme trompeur : le vent revient en sens inverse.' },
        { id: 'apr-cables', nom: 'Ne jamais toucher un câble tombé', detail: 'Considérez toute ligne au sol comme sous tension et signalez-la.' },
        { id: 'apr-eau', nom: 'Ne pas circuler dans l\'eau', detail: 'Une eau boueuse cache trous, câbles et matériaux coupants. 30 cm suffisent à emporter un véhicule.' },
        { id: 'apr-photos', nom: 'Photographier les dégâts avant de nettoyer', detail: 'Indispensable pour la déclaration à l\'assurance.' },
      ],
    },
  ];

  function lireAvancement() {
    try {
      return JSON.parse(localStorage.getItem(CLE) || '{}');
    } catch (e) {
      return {};
    }
  }

  function ecrireAvancement(a) {
    try { localStorage.setItem(CLE, JSON.stringify(a)); } catch (e) { /* stockage refusé : l'app reste utilisable */ }
  }

  function total() {
    return GROUPES.reduce(function (n, g) { return n + g.items.length; }, 0);
  }

  function nbFaits(avancement) {
    return Object.keys(avancement).filter(function (k) { return avancement[k]; }).length;
  }

  global.KdlPreparation = {
    GROUPES: GROUPES,
    lire: lireAvancement,
    ecrire: ecrireAvancement,
    total: total,
    nbFaits: nbFaits,
    basculer: function (id) {
      var a = lireAvancement();
      a[id] = !a[id];
      ecrireAvancement(a);
      return a;
    },
    reinitialiser: function () {
      ecrireAvancement({});
      return {};
    },
  };
})(window);
