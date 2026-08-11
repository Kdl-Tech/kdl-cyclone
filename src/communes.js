/**
 * Communes et lieux couverts par la météo locale.
 *
 * Fichier produit par `scripts/build-communes.mjs`. Les territoires français
 * viennent du découpage administratif officiel (geo.api.gouv.fr), les autres du
 * géocodage Open-Meteo (données GeoNames), avec contrôle du nom rendu.
 *
 * Ne pas modifier à la main : une coordonnée saisie de travers donnerait un
 * bulletin qui ne correspond à rien.
 *
 * Produit le 2026-08-11 — 99 lieux.
 */

export const COMMUNES = {
  "guadeloupe": [
    {
      "cle": "anse-bertrand",
      "nom": "Anse-Bertrand",
      "lat": 16.4668,
      "lon": -61.4698,
      "altitude": null,
      "population": 4412
    },
    {
      "cle": "baie-mahault",
      "nom": "Baie-Mahault",
      "lat": 16.2498,
      "lon": -61.5951,
      "altitude": null,
      "population": 30924
    },
    {
      "cle": "baillif",
      "nom": "Baillif",
      "lat": 16.0497,
      "lon": -61.7158,
      "altitude": null,
      "population": 5096
    },
    {
      "cle": "basse-terre",
      "nom": "Basse-Terre",
      "lat": 15.9992,
      "lon": -61.7294,
      "altitude": null,
      "population": 9417
    },
    {
      "cle": "bouillante",
      "nom": "Bouillante",
      "lat": 16.1387,
      "lon": -61.7578,
      "altitude": null,
      "population": 6127
    },
    {
      "cle": "capesterre-belle-eau",
      "nom": "Capesterre-Belle-Eau",
      "lat": 16.0486,
      "lon": -61.6197,
      "altitude": null,
      "population": 17684
    },
    {
      "cle": "capesterre-de-marie-galante",
      "nom": "Capesterre-de-Marie-Galante",
      "lat": 15.9176,
      "lon": -61.2296,
      "altitude": null,
      "population": 3123
    },
    {
      "cle": "deshaies",
      "nom": "Deshaies",
      "lat": 16.3194,
      "lon": -61.7831,
      "altitude": null,
      "population": 3710
    },
    {
      "cle": "gourbeyre",
      "nom": "Gourbeyre",
      "lat": 16.0057,
      "lon": -61.689,
      "altitude": null,
      "population": 7307
    },
    {
      "cle": "goyave",
      "nom": "Goyave",
      "lat": 16.1231,
      "lon": -61.615,
      "altitude": null,
      "population": 7565
    },
    {
      "cle": "grand-bourg",
      "nom": "Grand-Bourg",
      "lat": 15.9085,
      "lon": -61.2929,
      "altitude": null,
      "population": 4617
    },
    {
      "cle": "la-desirade",
      "nom": "La Désirade",
      "lat": 16.2972,
      "lon": -61.0814,
      "altitude": null,
      "population": 1306
    },
    {
      "cle": "lamentin",
      "nom": "Lamentin",
      "lat": 16.2443,
      "lon": -61.6695,
      "altitude": null,
      "population": 18628
    },
    {
      "cle": "le-gosier",
      "nom": "Le Gosier",
      "lat": 16.2274,
      "lon": -61.4749,
      "altitude": null,
      "population": 27757
    },
    {
      "cle": "le-moule",
      "nom": "Le Moule",
      "lat": 16.3354,
      "lon": -61.36,
      "altitude": null,
      "population": 23014
    },
    {
      "cle": "les-abymes",
      "nom": "Les Abymes",
      "lat": 16.2678,
      "lon": -61.4967,
      "altitude": null,
      "population": 51055
    },
    {
      "cle": "morne-a-l-eau",
      "nom": "Morne-à-l'Eau",
      "lat": 16.3212,
      "lon": -61.4988,
      "altitude": null,
      "population": 16228
    },
    {
      "cle": "petit-bourg",
      "nom": "Petit-Bourg",
      "lat": 16.1695,
      "lon": -61.658,
      "altitude": null,
      "population": 24665
    },
    {
      "cle": "petit-canal",
      "nom": "Petit-Canal",
      "lat": 16.3921,
      "lon": -61.4547,
      "altitude": null,
      "population": 8212
    },
    {
      "cle": "pointe-a-pitre",
      "nom": "Pointe-à-Pitre",
      "lat": 16.2351,
      "lon": -61.5379,
      "altitude": null,
      "population": 15040
    },
    {
      "cle": "pointe-noire",
      "nom": "Pointe-Noire",
      "lat": 16.227,
      "lon": -61.7651,
      "altitude": null,
      "population": 5762
    },
    {
      "cle": "port-louis",
      "nom": "Port-Louis",
      "lat": 16.4201,
      "lon": -61.488,
      "altitude": null,
      "population": 5607
    },
    {
      "cle": "saint-claude",
      "nom": "Saint-Claude",
      "lat": 16.0406,
      "lon": -61.6953,
      "altitude": null,
      "population": 10177
    },
    {
      "cle": "saint-francois",
      "nom": "Saint-François",
      "lat": 16.2784,
      "lon": -61.2539,
      "altitude": null,
      "population": 13942
    },
    {
      "cle": "saint-louis",
      "nom": "Saint-Louis",
      "lat": 15.9654,
      "lon": -61.2732,
      "altitude": null,
      "population": 2610
    },
    {
      "cle": "sainte-anne",
      "nom": "Sainte-Anne",
      "lat": 16.2565,
      "lon": -61.3896,
      "altitude": null,
      "population": 23973
    },
    {
      "cle": "sainte-rose",
      "nom": "Sainte-Rose",
      "lat": 16.2937,
      "lon": -61.6836,
      "altitude": null,
      "population": 17700
    },
    {
      "cle": "terre-de-bas",
      "nom": "Terre-de-Bas",
      "lat": 15.8554,
      "lon": -61.6326,
      "altitude": null,
      "population": 873
    },
    {
      "cle": "terre-de-haut",
      "nom": "Terre-de-Haut",
      "lat": 15.8579,
      "lon": -61.5892,
      "altitude": null,
      "population": 1463
    },
    {
      "cle": "trois-rivieres",
      "nom": "Trois-Rivières",
      "lat": 15.9931,
      "lon": -61.6493,
      "altitude": null,
      "population": 7415
    },
    {
      "cle": "vieux-fort",
      "nom": "Vieux-Fort",
      "lat": 15.9607,
      "lon": -61.6929,
      "altitude": null,
      "population": 1674
    },
    {
      "cle": "vieux-habitants",
      "nom": "Vieux-Habitants",
      "lat": 16.0847,
      "lon": -61.717,
      "altitude": null,
      "population": 7077
    }
  ],
  "martinique": [
    {
      "cle": "basse-pointe",
      "nom": "Basse-Pointe",
      "lat": 14.841,
      "lon": -61.1237,
      "altitude": null,
      "population": 2852
    },
    {
      "cle": "bellefontaine",
      "nom": "Bellefontaine",
      "lat": 14.6747,
      "lon": -61.146,
      "altitude": null,
      "population": 1746
    },
    {
      "cle": "case-pilote",
      "nom": "Case-Pilote",
      "lat": 14.6594,
      "lon": -61.1297,
      "altitude": null,
      "population": 4537
    },
    {
      "cle": "ducos",
      "nom": "Ducos",
      "lat": 14.5785,
      "lon": -60.9685,
      "altitude": null,
      "population": 18105
    },
    {
      "cle": "fonds-saint-denis",
      "nom": "Fonds-Saint-Denis",
      "lat": 14.7228,
      "lon": -61.1207,
      "altitude": null,
      "population": 640
    },
    {
      "cle": "fort-de-france",
      "nom": "Fort-de-France",
      "lat": 14.6492,
      "lon": -61.0686,
      "altitude": null,
      "population": 75506
    },
    {
      "cle": "grand-riviere",
      "nom": "Grand'Rivière",
      "lat": 14.847,
      "lon": -61.1836,
      "altitude": null,
      "population": 487
    },
    {
      "cle": "gros-morne",
      "nom": "Gros-Morne",
      "lat": 14.7084,
      "lon": -61.0303,
      "altitude": null,
      "population": 9610
    },
    {
      "cle": "l-ajoupa-bouillon",
      "nom": "L'Ajoupa-Bouillon",
      "lat": 14.816,
      "lon": -61.1305,
      "altitude": null,
      "population": 1682
    },
    {
      "cle": "la-trinite",
      "nom": "La Trinité",
      "lat": 14.7518,
      "lon": -60.9469,
      "altitude": null,
      "population": 11454
    },
    {
      "cle": "le-carbet",
      "nom": "Le Carbet",
      "lat": 14.7041,
      "lon": -61.1583,
      "altitude": null,
      "population": 3721
    },
    {
      "cle": "le-diamant",
      "nom": "Le Diamant",
      "lat": 14.4787,
      "lon": -61.0165,
      "altitude": null,
      "population": 6161
    },
    {
      "cle": "le-francois",
      "nom": "Le François",
      "lat": 14.6093,
      "lon": -60.8976,
      "altitude": null,
      "population": 15778
    },
    {
      "cle": "le-lamentin",
      "nom": "Le Lamentin",
      "lat": 14.6231,
      "lon": -60.9923,
      "altitude": null,
      "population": 39400
    },
    {
      "cle": "le-lorrain",
      "nom": "Le Lorrain",
      "lat": 14.7995,
      "lon": -61.074,
      "altitude": null,
      "population": 6566
    },
    {
      "cle": "le-marigot",
      "nom": "Le Marigot",
      "lat": 14.7795,
      "lon": -61.053,
      "altitude": null,
      "population": 2948
    },
    {
      "cle": "le-marin",
      "nom": "Le Marin",
      "lat": 14.4822,
      "lon": -60.8589,
      "altitude": null,
      "population": 8486
    },
    {
      "cle": "le-morne-rouge",
      "nom": "Le Morne-Rouge",
      "lat": 14.7695,
      "lon": -61.1217,
      "altitude": null,
      "population": 4388
    },
    {
      "cle": "le-morne-vert",
      "nom": "Le Morne-Vert",
      "lat": 14.7046,
      "lon": -61.1362,
      "altitude": null,
      "population": 1718
    },
    {
      "cle": "le-precheur",
      "nom": "Le Prêcheur",
      "lat": 14.8221,
      "lon": -61.1963,
      "altitude": null,
      "population": 1479
    },
    {
      "cle": "le-robert",
      "nom": "Le Robert",
      "lat": 14.6786,
      "lon": -60.9243,
      "altitude": null,
      "population": 21553
    },
    {
      "cle": "le-vauclin",
      "nom": "Le Vauclin",
      "lat": 14.542,
      "lon": -60.8595,
      "altitude": null,
      "population": 8483
    },
    {
      "cle": "les-anses-d-arlet",
      "nom": "Les Anses-d'Arlet",
      "lat": 14.4996,
      "lon": -61.0736,
      "altitude": null,
      "population": 3912
    },
    {
      "cle": "les-trois-ilets",
      "nom": "Les Trois-Îlets",
      "lat": 14.5329,
      "lon": -61.0376,
      "altitude": null,
      "population": 6507
    },
    {
      "cle": "macouba",
      "nom": "Macouba",
      "lat": 14.8474,
      "lon": -61.1465,
      "altitude": null,
      "population": 987
    },
    {
      "cle": "riviere-pilote",
      "nom": "Rivière-Pilote",
      "lat": 14.5027,
      "lon": -60.897,
      "altitude": null,
      "population": 11604
    },
    {
      "cle": "riviere-salee",
      "nom": "Rivière-Salée",
      "lat": 14.5262,
      "lon": -60.9623,
      "altitude": null,
      "population": 11829
    },
    {
      "cle": "saint-esprit",
      "nom": "Saint-Esprit",
      "lat": 14.5617,
      "lon": -60.9233,
      "altitude": null,
      "population": 10322
    },
    {
      "cle": "saint-joseph",
      "nom": "Saint-Joseph",
      "lat": 14.6835,
      "lon": -61.0407,
      "altitude": null,
      "population": 16258
    },
    {
      "cle": "saint-pierre",
      "nom": "Saint-Pierre",
      "lat": 14.7717,
      "lon": -61.1735,
      "altitude": null,
      "population": 3961
    },
    {
      "cle": "sainte-anne",
      "nom": "Sainte-Anne",
      "lat": 14.4314,
      "lon": -60.8516,
      "altitude": null,
      "population": 4306
    },
    {
      "cle": "sainte-luce",
      "nom": "Sainte-Luce",
      "lat": 14.4904,
      "lon": -60.9467,
      "altitude": null,
      "population": 9410
    },
    {
      "cle": "sainte-marie",
      "nom": "Sainte-Marie",
      "lat": 14.773,
      "lon": -61.0084,
      "altitude": null,
      "population": 14756
    },
    {
      "cle": "schoelcher",
      "nom": "Schœlcher",
      "lat": 14.6518,
      "lon": -61.1001,
      "altitude": null,
      "population": 19478
    }
  ],
  "saint-martin": [
    {
      "cle": "grand-case",
      "nom": "Grand-Case",
      "lat": 18.1048,
      "lon": -63.0536,
      "altitude": 6,
      "population": 6333
    },
    {
      "cle": "marigot",
      "nom": "Marigot",
      "lat": 18.0682,
      "lon": -63.083,
      "altitude": 9,
      "population": 5700
    },
    {
      "cle": "terres-basses",
      "nom": "Terres Basses",
      "lat": 18.0696,
      "lon": -63.1423,
      "altitude": 28,
      "population": null
    }
  ],
  "saint-barthelemy": [
    {
      "cle": "corossol",
      "nom": "Corossol",
      "lat": 17.9086,
      "lon": -62.8556,
      "altitude": 11,
      "population": null
    },
    {
      "cle": "gustavia",
      "nom": "Gustavia",
      "lat": 17.8962,
      "lon": -62.8498,
      "altitude": 6,
      "population": 5988
    }
  ],
  "dominique": [
    {
      "cle": "berekua",
      "nom": "Berekua",
      "lat": 15.2333,
      "lon": -61.3167,
      "altitude": 288,
      "population": 2608
    },
    {
      "cle": "castle-bruce",
      "nom": "Castle Bruce",
      "lat": 15.444,
      "lon": -61.2572,
      "altitude": 81,
      "population": 1387
    },
    {
      "cle": "marigot",
      "nom": "Marigot",
      "lat": 15.5374,
      "lon": -61.282,
      "altitude": 84,
      "population": 2669
    },
    {
      "cle": "portsmouth",
      "nom": "Portsmouth",
      "lat": 15.5829,
      "lon": -61.4559,
      "altitude": 1,
      "population": 3633
    },
    {
      "cle": "roseau",
      "nom": "Roseau",
      "lat": 15.3017,
      "lon": -61.3881,
      "altitude": 11,
      "population": 16571
    },
    {
      "cle": "saint-joseph",
      "nom": "Saint-Joseph",
      "lat": 15.4061,
      "lon": -61.4237,
      "altitude": 1,
      "population": 2184
    }
  ],
  "sainte-lucie": [
    {
      "cle": "castries",
      "nom": "Castries",
      "lat": 13.9957,
      "lon": -61.0061,
      "altitude": 119,
      "population": 20000
    },
    {
      "cle": "dennery",
      "nom": "Dennery",
      "lat": 13.9141,
      "lon": -60.8913,
      "altitude": 19,
      "population": 12589
    },
    {
      "cle": "gros-islet",
      "nom": "Gros Islet",
      "lat": 14.0667,
      "lon": -60.95,
      "altitude": 58,
      "population": 25210
    },
    {
      "cle": "micoud",
      "nom": "Micoud",
      "lat": 13.8167,
      "lon": -60.9,
      "altitude": 11,
      "population": 3406
    },
    {
      "cle": "soufriere",
      "nom": "Soufrière",
      "lat": 13.8562,
      "lon": -61.0566,
      "altitude": 12,
      "population": 2918
    },
    {
      "cle": "vieux-fort",
      "nom": "Vieux Fort",
      "lat": 13.7167,
      "lon": -60.95,
      "altitude": 76,
      "population": 4574
    }
  ],
  "barbade": [
    {
      "cle": "bathsheba",
      "nom": "Bathsheba",
      "lat": 13.2113,
      "lon": -59.526,
      "altitude": 69,
      "population": 1765
    },
    {
      "cle": "bridgetown",
      "nom": "Bridgetown",
      "lat": 13.1073,
      "lon": -59.6202,
      "altitude": 10,
      "population": 98511
    },
    {
      "cle": "holetown",
      "nom": "Holetown",
      "lat": 13.1867,
      "lon": -59.6381,
      "altitude": 1,
      "population": 1350
    },
    {
      "cle": "oistins",
      "nom": "Oistins",
      "lat": 13.0707,
      "lon": -59.5464,
      "altitude": 37,
      "population": 2285
    },
    {
      "cle": "speightstown",
      "nom": "Speightstown",
      "lat": 13.2507,
      "lon": -59.644,
      "altitude": 9,
      "population": 3634
    }
  ],
  "antigua": [
    {
      "cle": "all-saints",
      "nom": "All Saints",
      "lat": 17.0667,
      "lon": -61.793,
      "altitude": 60,
      "population": 2526
    },
    {
      "cle": "codrington",
      "nom": "Codrington",
      "lat": 17.6394,
      "lon": -61.8244,
      "altitude": 1,
      "population": 1325
    },
    {
      "cle": "english-harbour-town",
      "nom": "English Harbour Town",
      "lat": 17.0164,
      "lon": -61.7674,
      "altitude": 29,
      "population": 778
    },
    {
      "cle": "liberta",
      "nom": "Liberta",
      "lat": 17.0414,
      "lon": -61.7905,
      "altitude": 69,
      "population": 2560
    },
    {
      "cle": "saint-john-s",
      "nom": "Saint John's",
      "lat": 17.121,
      "lon": -61.8433,
      "altitude": 12,
      "population": 51737
    }
  ],
  "trinite-tobago": [
    {
      "cle": "arima",
      "nom": "Arima",
      "lat": 10.6374,
      "lon": -61.2823,
      "altitude": 62,
      "population": 35000
    },
    {
      "cle": "chaguanas",
      "nom": "Chaguanas",
      "lat": 10.5167,
      "lon": -61.4167,
      "altitude": 18,
      "population": 67433
    },
    {
      "cle": "point-fortin",
      "nom": "Point  Fortin",
      "lat": 10.1741,
      "lon": -61.6841,
      "altitude": 12,
      "population": 19056
    },
    {
      "cle": "port-d-espagne",
      "nom": "Port-d'Espagne",
      "lat": 10.6667,
      "lon": -61.5189,
      "altitude": 21,
      "population": 49031
    },
    {
      "cle": "san-fernando",
      "nom": "San Fernando",
      "lat": 10.2797,
      "lon": -61.4683,
      "altitude": 28,
      "population": 55419
    },
    {
      "cle": "scarborough",
      "nom": "Scarborough",
      "lat": 11.1823,
      "lon": -60.7352,
      "altitude": 9,
      "population": 17000
    }
  ]
};

/** Tous les lieux d'un territoire, par ordre alphabétique. */
export function communesDe(territoire) {
  return COMMUNES[territoire] || [];
}

/** Retrouve un lieu par sa clé, dans un territoire donné. */
export function communePar(territoire, cle) {
  return communesDe(territoire).find((c) => c.cle === cle) || null;
}
