/**
 * Métadonnées par page et données structurées.
 *
 * L'application est une page unique, mais chaque route reçoit son titre, sa
 * description et ses balises sociales, injectés par le serveur dans le HTML.
 * C'est ce qui permet un rendu correct des aperçus sur WhatsApp, Facebook ou
 * LinkedIn, et un référencement propre — sans framework ni service tiers.
 */

export const SITE = {
  nom: 'KDL Cyclone',
  nomComplet: 'KDL Cyclone — Veille Antilles',
  base: process.env.KDL_CYCLONE_URL || 'https://cyclone.kdl-tech.fr',
  signature: 'Comprendre tôt. Se préparer calmement.',
  imageSociale: '/media/og-kdl-cyclone.png',
  langue: 'fr-FR',
  zone: 'Guadeloupe, Petites Antilles',
};

export const KDLTECH = {
  nom: 'KDLTech',
  nomLegal: 'KDL TECH',
  site: 'https://kdl-tech.fr',
  // Lien de découverte, avec repère d'origine pour mesurer l'intérêt réel.
  lienDecouverte: 'https://kdl-tech.fr/?utm_source=kdl-cyclone&utm_medium=referral&utm_campaign=service-gratuit',
  carte: 'https://kdl-tech.fr/carte.html',
  telephone: '0690 70 60 08',
  telephoneE164: '+590690706008',
  whatsapp: 'https://wa.me/590690706008',
  email: 'karim.delucia@kdl-tech.fr',
  ville: 'Les Abymes',
  region: 'Guadeloupe',
  pays: 'FR',
  zoneIntervention: 'Les Abymes et alentours, Guadeloupe',
  horaires: 'Du lundi au vendredi, 8 h – 18 h. Fermé le week-end.',
  tiktok: 'https://www.tiktok.com/@kdltech',
  facebook: 'https://www.facebook.com/profile.php?id=61588286166391&locale=fr_FR',
  presentation:
    'KDLTech accompagne particuliers et professionnels en dépannage informatique, '
    + 'assistance à distance, création de sites web et développement d\'applications intelligentes.',
  presentationCyclone:
    'KDL Cyclone est un service gratuit conçu en Guadeloupe par KDLTech pour rendre la veille '
    + 'tropicale plus claire, accessible et utile aux habitants des Antilles.',
};

/**
 * Une entrée par route. Les descriptions sont rédigées pour être lues par un
 * humain dans un résultat de recherche — pas remplies de mots-clés.
 */
export const PAGES = {
  '/': {
    vue: 'accueil',
    titre: 'KDL Cyclone — Suivi des cyclones et ondes tropicales en Guadeloupe',
    description:
      "Suivi en direct des ondes tropicales et cyclones entre l'Afrique et les Antilles. "
      + "Situation pour la Guadeloupe, probabilités officielles du NHC, analyse des facteurs météo "
      + "et liens vers la vigilance Météo-France. Service gratuit conçu en Guadeloupe par KDLTech.",
  },
  '/carte': {
    vue: 'carte',
    titre: 'Carte des cyclones et ondes tropicales — Atlantique et Antilles',
    description:
      "Carte interactive de l'Atlantique tropical, de la côte africaine à la mer des Caraïbes : "
      + "zones surveillées, trajectoires officielles, cônes du NHC et distance à la Guadeloupe.",
  },
  '/guadeloupe': {
    vue: 'guadeloupe',
    titre: 'Vigilance et risque cyclonique en Guadeloupe — conditions locales',
    description:
      "Risque cyclonique pour la Guadeloupe, vent, rafales, pluie, houle et fenêtre d'incertitude, "
      + "avec les liens directs vers la vigilance officielle de Météo-France et la préfecture.",
  },
  '/preparation': {
    vue: 'preparation',
    titre: 'Préparation cyclone en Guadeloupe — kit et liste de vérification',
    description:
      "Liste de préparation au cyclone pour la Guadeloupe : eau, alimentation, médicaments, "
      + "documents, énergie, habitation et consignes d'après-passage. Consultable hors connexion.",
  },
  '/sources': {
    vue: 'sources',
    titre: 'Sources et méthode — KDL Cyclone',
    description:
      "Toutes les sources utilisées par KDL Cyclone : National Hurricane Center, Open-Meteo, "
      + "Météo-France, et la méthode d'analyse, avec ses limites clairement énoncées.",
  },
  '/meteo': {
    vue: 'meteo',
    titre: 'Météo Guadeloupe et Petites Antilles — prévisions, houle, UV',
    description:
      "Prévisions détaillées pour la Guadeloupe et l'arc antillais : température, "
      + "pluie, vent et rafales heure par heure, tendance sur dix jours, houle, "
      + "indice UV et brume de sable. Gratuit, sans publicité.",
  },
  '/beta': {
    vue: 'beta',
    titre: 'Bêta publique de KDL Cyclone — essayez, installez, donnez votre avis',
    description:
      "KDL Cyclone est en bêta publique dans le KDL Lab. Application gratuite de veille "
      + "tropicale pour la Guadeloupe : essayez-la sur le Web, installez-la sur votre "
      + "téléphone et aidez KDLTech à l'améliorer.",
  },
  '/installer': {
    vue: 'installer',
    titre: 'Installer KDL Cyclone — application cyclone gratuite pour les Antilles',
    description:
      "Installez gratuitement KDL Cyclone sur votre téléphone ou votre ordinateur, "
      + "depuis votre navigateur et sans magasin d'applications. Gratuite, sans publicité, "
      + "sans compte, et consultable hors connexion.",
  },
  '/a-propos': {
    vue: 'apropos',
    titre: 'À propos — KDL Cyclone, un service gratuit KDLTech en Guadeloupe',
    description:
      "Pourquoi KDL Cyclone a été créé en Guadeloupe, sa mission gratuite, ses principes de "
      + "fiabilité et de transparence, et le savoir-faire technique de KDLTech derrière l'application.",
  },
};

/** Métadonnées d'une fiche système : titre et description réellement informatifs. */
export function metaSysteme(systeme) {
  if (!systeme) {
    return {
      vue: 'systeme',
      titre: 'Système non suivi — KDL Cyclone',
      description: "Ce système n'est plus suivi par le National Hurricane Center.",
    };
  }
  const nom = systeme.nom || systeme.designation;
  const prob = typeof systeme.prob7j === 'number' ? `${systeme.prob7j} % de risque de formation à 7 jours selon le NHC. ` : '';
  return {
    vue: 'systeme',
    // La carte sociale du système, si elle a pu être produite ; sinon la
    // bannière de marque. Un partage n'est jamais laissé sans visuel.
    image: systeme.carteSociale?.horizontal || null,
    titre: `${nom} — suivi et distance de la Guadeloupe | KDL Cyclone`,
    description:
      `${nom} : ${systeme.statut.toLowerCase()}, à ${systeme.distanceGuadeloupeKm} km de la Guadeloupe. `
      + prob
      + `Potentiel KDL indicatif : ${systeme.potentiel?.score ?? '—'}/100. Données mises à jour automatiquement.`,
  };
}

/** Données structurées Schema.org — application, éditeur et fil d'Ariane. */
export function donneesStructurees(page, chemin) {
  const organisation = {
    '@type': 'Organization',
    '@id': `${KDLTECH.site}#organisation`,
    name: KDLTECH.nom,
    legalName: KDLTECH.nomLegal,
    url: KDLTECH.site,
    email: KDLTECH.email,
    telephone: KDLTECH.telephoneE164,
    description: KDLTECH.presentation,
    areaServed: { '@type': 'Place', name: KDLTECH.zoneIntervention },
    address: {
      '@type': 'PostalAddress',
      addressLocality: KDLTECH.ville,
      addressRegion: KDLTECH.region,
      addressCountry: KDLTECH.pays,
    },
    sameAs: [KDLTECH.tiktok, KDLTECH.facebook],
  };

  const application = {
    '@type': 'WebApplication',
    '@id': `${SITE.base}#application`,
    name: SITE.nomComplet,
    alternateName: SITE.nom,
    url: SITE.base,
    applicationCategory: 'WeatherApplication',
    operatingSystem: 'Tout navigateur web moderne',
    browserRequirements: 'JavaScript activé',
    inLanguage: SITE.langue,
    isAccessibleForFree: true,
    // Gratuit, sans compte et sans publicité : la déclaration reflète la réalité.
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    description: PAGES['/'].description,
    featureList: [
      'Suivi des ondes tropicales entre l\'Afrique et les Antilles',
      'Probabilités officielles du National Hurricane Center',
      'Analyse des facteurs de développement expliquée en français',
      'Carte interactive hors connexion',
      'Liste de préparation consultable sans réseau',
    ],
    publisher: { '@id': `${KDLTECH.site}#organisation` },
    creator: { '@id': `${KDLTECH.site}#organisation` },
  };

  const graphe = [organisation, application];

  if (chemin && chemin !== '/') {
    graphe.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: SITE.base + '/' },
        { '@type': 'ListItem', position: 2, name: page.titre.split('—')[0].trim(), item: SITE.base + chemin },
      ],
    });
  }

  return { '@context': 'https://schema.org', '@graph': graphe };
}

const echapperHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bloc `<head>` complet pour une route donnée. */
export function balises(page, chemin) {
  const url = SITE.base + (chemin === '/' ? '/' : chemin);
  const image = SITE.base + (page.image || SITE.imageSociale);
  const t = echapperHtml(page.titre);
  const d = echapperHtml(page.description);

  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${echapperHtml(url)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<meta name="author" content="${KDLTECH.nom}">`,
    '<meta name="geo.region" content="FR-GP">',
    '<meta name="geo.placename" content="Guadeloupe">',

    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="KDL Cyclone">',
    '<meta property="og:locale" content="fr_FR">',
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${echapperHtml(url)}">`,
    `<meta property="og:image" content="${echapperHtml(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${page.image ? echapperHtml(page.titre) : 'KDL Cyclone — veille tropicale pour la Guadeloupe, un service gratuit KDLTech'}">`,
    // Les robots sociaux ne lisent pas le JavaScript : ces balises sont rendues
    // par le serveur, présentes dans le HTML initial.
    '<meta property="og:image:type" content="image/png">',

    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${echapperHtml(image)}">`,

    `<script type="application/ld+json">${JSON.stringify(donneesStructurees(page, chemin))}</script>`,
  ].join('\n');
}

/** Plan du site : uniquement des pages réelles et utiles. */
export function sitemap(systemes = []) {
  const maintenant = new Date().toISOString().slice(0, 10);
  const entrees = Object.entries(PAGES).map(([chemin, p]) => ({
    url: SITE.base + (chemin === '/' ? '/' : chemin),
    priorite: chemin === '/' ? '1.0' : chemin === '/preparation' ? '0.8' : '0.7',
    frequence: chemin === '/' || chemin === '/carte' ? 'hourly' : 'weekly',
  }));

  // Les fiches de systèmes vivent le temps du système : fréquence horaire,
  // priorité moyenne, et elles disparaissent du plan quand le système disparaît.
  systemes.forEach((s) => {
    entrees.push({
      url: `${SITE.base}/systeme/${encodeURIComponent(s.id)}`,
      priorite: '0.6',
      frequence: 'hourly',
    });
  });

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entrees.map((e) =>
      `  <url><loc>${echapperHtml(e.url)}</loc><lastmod>${maintenant}</lastmod>`
      + `<changefreq>${e.frequence}</changefreq><priority>${e.priorite}</priority></url>`).join('\n')
    + '\n</urlset>\n';
}

export function robots() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE.base}/sitemap.xml`,
    '',
  ].join('\n');
}

export { echapperHtml };
