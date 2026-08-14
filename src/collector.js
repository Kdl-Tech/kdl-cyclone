/**
 * Collecteur : interroge les sources, applique les moteurs, publie un état
 * complet. Il ne lève jamais d'exception vers l'appelant — un échec de source
 * devient une dégradation visible dans l'interface, pas une page blanche.
 */

import { CONFIG, GUADELOUPE } from './config.js';
import { collecterNhc } from './sources/nhc.js';
import {
  fetchEnvironnement,
  fetchMer,
  fetchAccordModeles,
  fetchConditionsLocales,
  ATTRIBUTION,
} from './sources/openmeteo.js';
import { analysePotential } from './engine/potential.js';
import { evaluateThreat, risqueGlobal, ilesConcernees } from './engine/threat.js';
import { distanceKm, compassFr } from './engine/geo.js';
import { etat as storeEtat, bulletins as storeBulletins, historique, evolution } from './store.js';
import { rafraichirCartes } from './social.js';
import { rafraichirBoucle, SECTEURS, CANAUX } from './sources/satellite.js';
import { mettreAJour as majSlugs, slugDe } from './slugs.js';
import { fetchBulletin } from './sources/meteo.js';
import {
  vigilances,
  observationsTerritoire,
  DEPARTEMENTS,
  configuree as meteoFranceConfiguree,
} from './sources/meteofrance.js';
import { territoiresEvalues, territoire, liensOfficiels, avertissementOfficiel, TERRITOIRE_DEFAUT } from './territoires.js';
import { fraicheur, detecterChangements, detecterDisparitions, consigner, lireJournal, chronologie, ETATS } from './journal.js';

export const VERSION_ETAT = 1;

const SOURCES = [
  {
    cle: 'nhc',
    nom: 'National Hurricane Center (NOAA)',
    url: 'https://www.nhc.noaa.gov/',
    licence: 'Domaine public (gouvernement des États-Unis)',
    role: 'Avis officiels, zones surveillées, cônes de prévision',
  },
  {
    cle: 'openmeteo',
    nom: 'Open-Meteo',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0',
    role: 'Modèles GFS, ECMWF et ICON, état de la mer',
  },
  {
    cle: 'meteofrance',
    nom: 'Météo-France',
    url: 'https://vigilance.meteofrance.fr/fr/guadeloupe',
    licence: 'Licence Ouverte 2.0 (Etalab)',
    role: "Vigilance officielle (seule référence pour l'alerte), mesures des stations "
      + 'et rafales prévues par le modèle ARPEGE',
  },
  // Ces deux sources étaient utilisées sans figurer dans la liste : la boucle
  // satellite et le fond de carte. Une provenance incomplète est une
  // provenance fausse — tout ce qui s'affiche doit pouvoir être attribué.
  {
    cle: 'satellite',
    nom: 'GOES-19 (NOAA / NESDIS)',
    url: 'https://www.star.nesdis.noaa.gov/goes/',
    licence: 'Domaine public (gouvernement des États-Unis)',
    role: 'Imagerie satellite et boucle animée du bassin',
  },
  {
    cle: 'naturalearth',
    nom: 'Natural Earth',
    url: 'https://www.naturalearthdata.com/',
    licence: 'Domaine public',
    role: 'Fond de carte (côtes et frontières), embarqué dans l\'application',
  },
];

/** Une seule collecte complète. Retourne l'état publié. */
export async function collecter() {
  const debut = Date.now();
  const degradations = [];

  // Vigilance officielle française. Volontairement isolée du reste : si elle
  // échoue, la veille continue sur le NHC. Une couche officielle absente se
  // signale, elle ne fait pas tomber l'application.
  const mf = await vigilances().catch((e) => ({
    disponible: false,
    motif: e.message,
    parTerritoire: {},
  }));
  // Une souscription absente (401/403) n'est pas une dégradation : rien n'est
  // tombé, l'accès n'a simplement jamais été accordé. L'annoncer comme une
  // panne ferait clignoter un avertissement permanent dans l'interface et
  // finirait par rendre les vrais avertissements invisibles. L'information
  // reste lisible dans l'état de la source, à sa juste place.
  if (!mf.disponible && mf.motif && mf.motif !== 'jeton non configuré' && !mf.definitif) {
    degradations.push(`Météo-France : ${mf.motif}`);
  }

  const nhc = await collecterNhc().catch((e) => {
    degradations.push(`NHC injoignable : ${e.message}`);
    return { zones: null, systemes: null, outlookTexte: null, erreurs: [], tracabilite: [] };
  });
  degradations.push(...(nhc.erreurs || []));

  // Un document inchangé n'est pas retéléchargé : on repart de l'état publié
  // précédemment plutôt que de perdre l'information ou d'afficher du vide.
  const precedent = await storeEtat.lire();
  const reutiliser = (nouveau, cheminPrecedent, inchange) => {
    if (nouveau !== null && nouveau !== undefined) return nouveau;
    if (!inchange) return [];
    return cheminPrecedent ?? [];
  };

  const zonesBrutes = reutiliser(
    nhc.zones,
    precedent?.systemes?.filter((s) => s.type === 'zone_surveillee').map((s) => ({
      id: s.id, source: 'NHC', type: s.type, numero: s.numero,
      prob48h: s.prob48h, prob7j: s.prob7j,
      risque48h: s.risque48hOfficiel, risque7j: s.risque7jOfficiel,
      polygone: s.polygone, position: s.position,
      trajectoireIndicative: s.trajectoireOfficielle,
    })),
    nhc.zonesInchangees,
  );

  const systemesBruts = reutiliser(
    nhc.systemes,
    precedent?.systemes?.filter((s) => s.type === 'systeme_officiel').map((s) => ({
      id: s.id, source: 'NHC', type: s.type, nom: s.nom,
      identifiantNhc: s.identifiantNhc, statut: s.statut, statutCode: s.statutCode,
      position: s.position, intensiteKmh: s.intensiteKmh, pressionHpa: s.pressionHpa,
      mouvement: s.mouvement, misAJourLe: s.misAJourLe,
      coneOfficiel: s.coneOfficiel, liens: {},
    })),
    nhc.systemesInchanges,
  );

  const outlook = nhc.outlookTexte
    ?? (nhc.outlookInchange ? precedent?.outlookOfficiel : null);

  // Un système officiel nommé prime sur la zone du TWO qui le décrivait.
  const bruts = [
    ...systemesBruts.map((s) => ({ ...s, officiel: true })),
    ...zonesBrutes.map((z) => ({ ...z, officiel: true })),
  ].filter((s) => s.position);

  const historiqueExistant = await historique.lire();
  const journalExistant = await lireJournal();

  const systemes = [];
  for (const brut of bruts) {
    const analyse = await analyserSysteme(brut, historiqueExistant[brut.id], degradations);
    systemes.push(analyse);
  }

  // Comparaison au bulletin précédent : ce qui a changé est consigné et daté.
  const precedentParId = new Map((precedent?.systemes || []).map((s) => [s.id, {
    prob48h: s.prob48h, prob7j: s.prob7j,
    statut: s.statut, statutCode: s.statutCode, nom: s.nom,
    identifiantNhc: s.identifiantNhc,
    distanceGuadeloupeKm: s.distanceGuadeloupeKm,
    mouvement: s.mouvement,
    menaceNiveau: s.menace?.niveau,
  }]));

  const changements = {};
  for (const s of systemes) {
    const evts = detecterChangements(precedentParId.get(s.id) || null, s);
    if (evts.length) changements[s.id] = evts;
  }
  const disparus = detecterDisparitions([...precedentParId.keys()], systemes);
  for (const d of disparus) {
    changements[d.id] = [...(changements[d.id] || []), d];
  }
  if (Object.keys(changements).length) await consigner(changements);

  const journal = await lireJournal();
  for (const s of systemes) {
    s.chronologie = chronologie(journal, s.id, 12);
  }

  systemes.sort((a, b) => {
    const pa = a.menace?.score ?? 0;
    const pb = b.menace?.score ?? 0;
    if (pb !== pa) return pb - pa;
    return (b.potentiel?.score ?? 0) - (a.potentiel?.score ?? 0);
  });

  // Conditions locales, pour chaque territoire suivi.
  //
  // Elles changent lentement : les rafraîchir toutes les dix minutes comme le
  // reste gaspillerait le quota sans rien apporter. Une demi-heure suffit, et
  // l'état précédent sert d'appoint entre deux mises à jour.
  const conditionsPrecedentes = precedent?.conditionsTerritoires || {};
  const ageConditions = precedent?.conditionsMajLe
    ? Date.now() - new Date(precedent.conditionsMajLe).getTime()
    : Infinity;
  // On rafraîchit aussi lorsque les bulletins manquent : sans cette condition,
  // un fichier perdu ou une première exécution après la séparation des données
  // ne serait jamais reconstitué.
  const bulletinsExistants = await storeBulletins.lire();
  const bulletinsManquants = Object.keys(bulletinsExistants || {}).length === 0;
  const rafraichirConditions = ageConditions > 30 * 60 * 1000 || bulletinsManquants;

  const conditionsTerritoires = {};
  if (rafraichirConditions) {
    const resultats = await Promise.all(territoiresEvalues().map(async (t) => {
      const [meteo, mer, bulletin] = await Promise.all([
        fetchConditionsLocales({ lat: t.lat, lon: t.lon }, t.fuseau),
        fetchMer({ lat: t.lat, lon: t.lon }),
        // Bulletin complet : le besoin quotidien, à côté de la veille tropicale.
        fetchBulletin({ lat: t.lat, lon: t.lon }, t.fuseau),
      ]);
      if (!meteo.ok) degradations.push(`conditions ${t.nom} : ${meteo.erreur}`);
      if (!bulletin.ok) degradations.push(`bulletin ${t.nom} : ${bulletin.erreur}`);
      return [t.cle, {
        meteo: meteo.ok ? meteo : null,
        mer: mer.ok ? mer : null,
        bulletin: bulletin.ok ? bulletin : null,
      }];
    }));
    for (const [cle, valeur] of resultats) conditionsTerritoires[cle] = valeur;
  } else {
    Object.assign(conditionsTerritoires, conditionsPrecedentes);
  }

  const local = conditionsTerritoires[TERRITOIRE_DEFAUT]?.meteo || { ok: false };
  const merLocale = conditionsTerritoires[TERRITOIRE_DEFAUT]?.mer || { ok: false };

  // Menace par territoire. Le moteur acceptait déjà n'importe quelle cible :
  // on l'exécute simplement pour chacun des territoires suivis, au lieu de la
  // Observations mesurées par Météo-France, là où elle en publie.
  //
  // Appelé à chaque collecte sans crainte : le module garde son propre cache
  // horaire, aligné sur la cadence de publication des stations. Un seul
  // téléchargement par heure et par département en découle, quel que soit le
  // nombre de collectes ou de visiteurs.
  const observations = {};
  for (const t of territoiresEvalues()) {
    if (!DEPARTEMENTS[t.cle]) continue;
    const o = await observationsTerritoire(t.cle, { lat: t.lat, lon: t.lon })
      .catch((e) => ({ disponible: false, motif: e.message }));
    if (o.disponible) observations[t.cle] = o;
    else if (o.motif && o.motif !== 'jeton non configuré' && !o.definitif) {
      degradations.push(`observations ${t.nom} : ${o.motif}`);
    }
  }

  // seule Guadeloupe. C'est ce qui permet à un Martiniquais ou à un habitant
  // de Sainte-Lucie de lire une situation qui le concerne vraiment.
  const territoires = territoiresEvalues();
  for (const s of systemes) {
    s.menaces = {};
    for (const t of territoires) {
      const m = evaluateThreat({
        position: s.position,
        mouvement: s.mouvement,
        intensiteKmh: s.intensiteKmh,
        statut: s.statut,
        potentielKdl: s.potentiel?.score,
        probNhc7d: s.prob7j,
      }, t);
      s.menaces[t.cle] = {
        niveau: m.niveau,
        niveauLabel: m.niveauLabel,
        score: m.score,
        distanceKm: m.distanceKm,
        approche: m.approche,
        fenetre: m.fenetre,
        message: m.message,
        tendance: m.tendance,
        fondement: m.fondement,
      };
    }
  }

  // Identifiants d'URL durables : un lien partagé hier doit encore aboutir.
  const { table: tableSlugs, renommages } = await majSlugs(systemes);
  for (const s of systemes) s.slug = slugDe(tableSlugs, s.id);
  if (renommages.length) {
    for (const r of renommages) {
      console.log(`[kdl-cyclone] slug ${r.de} → ${r.vers} (ancien lien conservé)`);
    }
  }

  // Cartes sociales : régénérées seulement si le bulletin a changé.
  const cartes = await rafraichirCartes(systemes, new Date().toISOString());
  if (!cartes.disponible) degradations.push(`cartes sociales indisponibles : ${cartes.raison}`);

  // Boucle satellite : images réelles, jamais fabriquées. Un échec ici
  // n'empêche rien d'autre — la carte reste utilisable sans animation.
  const satellite = await rafraichirBoucle(
    'caraibes', 'geocolor', precedent?.satellite,
  ).catch((e) => ({ ok: false, erreur: e.message, images: [], degrade: true }));
  if (!satellite.ok) degradations.push(`boucle satellite : ${satellite.erreur || 'indisponible'}`);

  const risque = risqueGlobal(systemes.map((s) => s.menace).filter(Boolean));

  const genereLe = new Date().toISOString();
  const nouvelEtat = {
    version: VERSION_ETAT,
    genereLe,
    prochaineMajPrevue: new Date(Date.now() + CONFIG.collectIntervalMs).toISOString(),
    dureeCollecteMs: Date.now() - debut,

    situation: {
      nbSystemes: systemes.length,
      nbSystemesNommes: systemes.filter((s) => s.nom).length,
      risque: {
        niveau: risque.code,
        label: risque.label,
      },
      resume: resumeSituation(systemes, risque),
    },

    systemes,

    guadeloupe: {
      position: { lat: GUADELOUPE.lat, lon: GUADELOUPE.lon },
      fuseau: CONFIG.timezone,
      conditions: local.ok ? local : null,
      mer: merLocale.ok ? merLocale : null,
      risque: { niveau: risque.code, label: risque.label },
      systemesConcernes: systemes
        .filter((s) => s.menace && s.menace.niveau !== 'aucun')
        .map((s) => ({ id: s.id, nom: s.nom || s.designation, niveau: s.menace.niveau })),
      vigilanceOfficielle: {
        // Bloc historique, conservé pour les clients antérieurs au
        // multi-territoires. La vigilance réelle vit désormais dans
        // `territoires[].vigilanceOfficielle`.
        ...(mf.parTerritoire?.guadeloupe || {}),
        integree: Boolean(mf.parTerritoire?.guadeloupe),
        raison: mf.parTerritoire?.guadeloupe
          ? 'Vigilance officielle Météo-France, relayée telle quelle. Les liens ci-dessous restent la référence en cas d\'alerte.'
          : "La vigilance de Météo-France n'est pas disponible pour le moment. KDL Cyclone renvoie vers la page officielle plutôt que d'afficher une information de seconde main.",
        liens: [
          { libelle: 'Vigilance Météo-France Guadeloupe', url: 'https://vigilance.meteofrance.fr/fr/guadeloupe' },
          { libelle: 'Météo-France Antilles', url: 'https://meteofrance.gp/' },
          { libelle: 'Préfecture de la Guadeloupe', url: 'https://www.guadeloupe.gouv.fr/' },
        ],
      },
    },

    // Une entrée par territoire : niveau, systèmes concernés et surtout les
    // bonnes autorités. Le client choisit celui qui le concerne.
    territoires: territoires.map((t) => {
      const menaces = systemes.map((s) => s.menaces?.[t.cle]).filter(Boolean);
      const pire = menaces.reduce(
        (max, m) => (risqueGlobal([m]).ordre > risqueGlobal([max || { niveau: 'aucun' }]).ordre ? m : max),
        null,
      );
      return {
        cle: t.cle,
        nom: t.nom,
        nomLong: t.nomLong || t.nom,
        article: t.article || '',
        articleDe: t.articleDe || 'de ',
        pays: t.pays,
        position: { lat: t.lat, lon: t.lon },
        fuseau: t.fuseau,
        francais: !!t.francais,
        principal: !!t.principal,
        risque: {
          niveau: pire?.niveau || 'aucun',
          label: pire?.niveauLabel || 'Aucun',
        },
        systemesConcernes: systemes
          .filter((s) => s.menaces?.[t.cle] && s.menaces[t.cle].niveau !== 'aucun')
          .map((s) => ({
            id: s.id,
            slug: s.slug,
            nom: s.nom || s.designation,
            niveau: s.menaces[t.cle].niveauLabel,
            distanceKm: s.menaces[t.cle].distanceKm,
          })),
        conditions: conditionsTerritoires[t.cle]?.meteo || null,
        mer: conditionsTerritoires[t.cle]?.mer || null,
        // Vigilance officielle : relayée telle quelle, jamais recalculée, et
        // seulement là où Météo-France est compétente. Les territoires non
        // français n'en reçoivent aucune — c'est la règle vitale du projet.
        vigilanceOfficielle: mf.parTerritoire?.[t.cle] || null,
        // Mesures réelles des stations, à ne jamais confondre avec les
        // prévisions de modèle affichées à côté.
        observations: observations[t.cle] || null,
        liens: liensOfficiels(t.cle),
        avertissement: avertissementOfficiel(t.cle),
      };
    }),
    territoireDefaut: TERRITOIRE_DEFAUT,
    // Les bulletins complets sont volumineux : ils ne voyagent pas dans l'état
    // principal, qui est chargé à chaque visite. Ils sont servis à la demande
    // par /api/meteo/<territoire>, pour le seul territoire consulté.
    conditionsTerritoires: Object.fromEntries(
      Object.entries(conditionsTerritoires).map(([cle, v]) => [cle, { meteo: v.meteo, mer: v.mer }]),
    ),
    bulletinsDisponibles: Object.keys(conditionsTerritoires)
      .filter((cle) => conditionsTerritoires[cle]?.bulletin),
    conditionsMajLe: rafraichirConditions
      ? new Date().toISOString()
      : (precedent?.conditionsMajLe || null),

    outlookOfficiel: outlook,
    sources: SOURCES.map((s) => ({
      ...s,
      etat: etatSource(s.cle, nhc, local, degradations, mf, observations, satellite),
    })),
    // Fraîcheur : ce que l'interface affiche à côté de chaque valeur importante.
    // Le Tropical Weather Outlook paraît quatre fois par jour, à 00, 06, 12 et
    // 18 h UTC. Un bulletin vieux de quatre heures est donc parfaitement normal.
    // Les seuils précédents (75 min et 240 min) étaient calés sur la cadence de
    // collecte, pas sur celle du NHC : l'application signalait un retard
    // imaginaire et se décrédibilisait toute seule.
    fraicheur: fraicheur(
      nhc.emisLe || precedent?.fraicheur?.emisLe || null,
      genereLe,
      { attenduMin: 400, ancienMin: 800 },
    ),
    // Provenance vérifiable de chaque document officiel utilisé.
    tracabilite: (nhc.tracabilite || []).map((t) => ({
      source: t.source,
      produit: t.produit,
      url: t.url,
      emisLe: t.emisLe,
      recuLe: t.recuLe,
      sha256: t.sha256,
      octets: t.octets ?? null,
    })),
    documentsInchanges: {
      zones: !!nhc.zonesInchangees,
      systemes: !!nhc.systemesInchanges,
      texte: !!nhc.outlookInchange,
    },
    changements: Object.values(changements).flat().slice(-20),
    satellite,
    cartesSociales: cartes,
    renommages,

    attributions: [ATTRIBUTION, 'Avis et graphiques : NOAA / National Hurricane Center'],
    degradations,
  };

  // Le contrôle anti-retard s'exécute sur l'état qui vient d'être construit.
  nouvelEtat.watchdog = surveiller(nouvelEtat, precedent);
  if (nouvelEtat.watchdog.alertes.length) {
    degradations.push(...nouvelEtat.watchdog.alertes.map((a) => a.message));
  }

  await storeEtat.ecrire(nouvelEtat);
  // Les bulletins sont rangés à part. On ne réécrit le fichier que lorsqu'on
  // vient réellement d'en récupérer : sinon, une collecte qui saute le
  // rafraîchissement effacerait les bulletins existants — ils ne transitent
  // plus par l'état précédent depuis qu'ils en ont été sortis.
  if (rafraichirConditions) {
    const aEcrire = Object.fromEntries(
      Object.entries(conditionsTerritoires)
        .filter(([, v]) => v.bulletin)
        .map(([cle, v]) => [cle, v.bulletin]),
    );
    if (Object.keys(aEcrire).length) await storeBulletins.ecrire(aEcrire);
  }
  await historique.ajouter(
    Object.fromEntries(
      systemes.map((s) => [
        s.id,
        {
          potentiel: s.potentiel?.score ?? null,
          menace: s.menace?.score ?? null,
          prob7j: s.prob7j ?? null,
          distanceKm: s.menace?.distanceKm ?? null,
          lat: s.position?.lat ?? null,
          lon: s.position?.lon ?? null,
        },
      ]),
    ),
  );

  return nouvelEtat;
}

async function analyserSysteme(brut, serieHistorique, degradations) {
  const position = brut.position;

  const [env, mer, accord] = await Promise.all([
    fetchEnvironnement(position),
    fetchMer(position),
    fetchAccordModeles(position),
  ]);
  if (!env.ok) degradations.push(`environnement ${brut.id} : ${env.erreur}`);
  if (!mer.ok) degradations.push(`mer ${brut.id} : ${mer.erreur}`);

  const environnement = {
    lat: position.lat,
    sstC: mer.ok ? mer.sstC : null,
    shearKmh: env.ok ? env.shearKmh : null,
    rh700: env.ok ? env.rh700 : null,
    precipMmH: env.ok ? env.precipMmH : null,
    lowLevelSpinKmh: env.ok ? env.lowLevelSpinKmh : null,
    pressureHpa: brut.pressionHpa ?? (env.ok ? env.pressureHpa : null),
    dryAirIndex: env.ok ? env.dryAirIndex : null,
    saharien: env.ok ? env.saharien : null,
    modelAgreement: accord.ok ? accord.modelAgreement : null,
  };

  const ageMinutes = env.ok && env.heureModele
    ? Math.max(0, (Date.now() - new Date(env.heureModele).getTime()) / 60000)
    : null;

  const potentiel = analysePotential(environnement, {
    observedAgeMinutes: ageMinutes,
    nhcProb7d: brut.prob7j ?? null,
  });

  // Le mouvement vient du NHC s'il le publie, sinon de l'historique de position.
  const mouvement = brut.mouvement || mouvementDepuisHistorique(serieHistorique);

  const menace = evaluateThreat(
    {
      position,
      mouvement,
      intensiteKmh: brut.intensiteKmh ?? null,
      statut: brut.statut || (brut.type === 'zone_surveillee' ? 'La zone surveillée' : null),
      potentielKdl: potentiel.score,
      probNhc7d: brut.prob7j ?? null,
    },
    GUADELOUPE,
  );

  const designation = brut.nom
    ? brut.nom
    : brut.numero
      ? `Zone surveillée ${brut.numero}`
      : 'Système suivi';

  return {
    id: brut.id,
    designation,
    nom: brut.nom || null,
    identifiantNhc: brut.identifiantNhc || null,
    numero: brut.numero || null,
    officiel: true,
    type: brut.type,
    statut: brut.statut || 'Zone surveillée par le NHC',
    statutCode: brut.statutCode || 'zone',
    position,
    polygone: brut.polygone || null,
    trajectoireOfficielle: brut.trajectoireIndicative || null,
    coneOfficiel: brut.coneOfficiel || null,
    intensiteKmh: brut.intensiteKmh ?? null,
    pressionHpa: brut.pressionHpa ?? null,
    mouvement: mouvement
      ? { ...mouvement, directionFr: compassFr(mouvement.bearingDeg), origine: brut.mouvement ? 'NHC' : 'calculé par KDL' }
      : null,
    prob48h: brut.prob48h ?? null,
    prob7j: brut.prob7j ?? null,
    risque48hOfficiel: brut.risque48h ?? null,
    risque7jOfficiel: brut.risque7j ?? null,
    distanceGuadeloupeKm: Math.round(distanceKm(position, GUADELOUPE)),
    potentiel,
    menace,
    environnement: {
      ...environnement,
      heureModele: env.ok ? env.heureModele : null,
      houleM: mer.ok ? mer.houleM : null,
      ecartTypeModelesHpa: accord.ok ? accord.ecartTypeHpa : null,
      nbModeles: accord.ok ? accord.nbModeles : 0,
    },
    ilesProches: ilesConcernees(menace.corridor),
    evolutions: {
      potentiel6h: evolution(serieHistorique, 'potentiel', 6),
      potentiel12h: evolution(serieHistorique, 'potentiel', 12),
      potentiel24h: evolution(serieHistorique, 'potentiel', 24),
      distance24h: evolution(serieHistorique, 'distanceKm', 24),
    },
    historique: (serieHistorique || []).slice(-48).map((e) => ({
      t: e.t,
      potentiel: e.potentiel,
      distanceKm: e.distanceKm,
    })),
    misAJourLe: brut.misAJourLe || new Date().toISOString(),
    // Chaque système porte sa propre fraîcheur : un bulletin peut être ancien
    // alors que les données de modèle qui l'entourent sont récentes.
    // Un système nommé reçoit un avis toutes les trois heures ; une zone du
    // Tropical Weather Outlook, toutes les six heures.
    fraicheur: fraicheur(brut.misAJourLe || null, new Date().toISOString(), {
      attenduMin: brut.nom ? 240 : 400,
      ancienMin: brut.nom ? 420 : 800,
    }),
    fraicheurModele: fraicheur(env.ok ? env.heureModele : null, new Date().toISOString(), {
      attenduMin: 120,
      ancienMin: 360,
    }),
  };
}

/**
 * Contrôle anti-retard. Il ne corrige rien : il constate et alerte, pour qu'un
 * affichage périmé ou incohérent ne passe jamais pour une information actuelle.
 */
function surveiller(etatCourant, precedent) {
  const alertes = [];
  const controles = [];
  const noter = (nom, ok, message) => {
    controles.push({ nom, ok });
    if (!ok) alertes.push({ nom, message, gravite: 'technique' });
  };

  const f = etatCourant.fraicheur;
  noter(
    'bulletin_recent',
    f.etat !== ETATS.ANCIENNE,
    `Aucun bulletin officiel récent : dernière émission il y a ${f.ageTexte}.`,
  );

  noter(
    'telechargement',
    etatCourant.tracabilite.length > 0 || Object.values(etatCourant.documentsInchanges).some(Boolean),
    "Aucun document officiel n'a été récupéré lors de cette collecte.",
  );

  const parseOk = etatCourant.systemes.length > 0
    || (etatCourant.outlookOfficiel && etatCourant.outlookOfficiel.texte);
  noter(
    'analyse',
    !!parseOk,
    "Les documents ont été reçus mais aucune information n'a pu en être extraite : "
      + "un format de source a peut-être changé.",
  );

  // Régression : moins de systèmes qu'avant sans qu'aucune disparition n'ait
  // été détectée signale une analyse silencieusement cassée.
  if (precedent && Array.isArray(precedent.systemes)) {
    const perdus = precedent.systemes.length - etatCourant.systemes.length;
    const disparitionsConsignees = (etatCourant.changements || [])
      .filter((c) => c.type === 'disparition').length;
    noter(
      'coherence_effectif',
      perdus <= 0 || disparitionsConsignees >= perdus,
      `${perdus} système(s) ont disparu de l'affichage sans disparition officielle constatée.`,
    );
  }

  // Horloge : une dérive fausserait toutes les heures affichées.
  const derive = etatCourant.tracabilite
    .map((t) => (t.recuLe && t.emisLe ? new Date(t.recuLe) - new Date(t.emisLe) : null))
    .filter((d) => d !== null);
  noter(
    'horloge',
    derive.every((d) => d > -5 * 60 * 1000),
    "Un document semble émis dans le futur : l'horloge ou le fuseau du serveur est peut-être faux.",
  );

  // Contradiction entre sources officielles sur une même échéance.
  const incoherents = etatCourant.systemes.filter(
    (s) => Number.isFinite(s.prob48h) && Number.isFinite(s.prob7j) && s.prob48h > s.prob7j,
  );
  noter(
    'coherence_sources',
    incoherents.length === 0,
    `Probabilité à 48 h supérieure à celle à 7 jours sur ${incoherents.length} système(s) : `
      + 'les valeurs officielles se contredisent.',
  );

  return {
    verifieLe: new Date().toISOString(),
    controles,
    alertes,
    etat: alertes.length === 0 ? 'ok' : 'alerte',
  };
}

/** Déduit le déplacement à partir des positions successives enregistrées. */
function mouvementDepuisHistorique(serie) {
  if (!Array.isArray(serie) || serie.length < 2) return null;
  const recents = serie.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon)).slice(-6);
  if (recents.length < 2) return null;

  const a = recents[0];
  const b = recents[recents.length - 1];
  const heures = (new Date(b.t) - new Date(a.t)) / 3600000;
  if (heures < 1) return null;

  const d = distanceKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
  if (d < 20) return null; // déplacement dans le bruit de la donnée

  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;
  const bearing = (Math.atan2(dLon * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180), dLat) * 180) / Math.PI;

  return {
    bearingDeg: (bearing + 360) % 360,
    speedKmh: Math.round(d / heures),
  };
}

function resumeSituation(systemes, risque) {
  const n = systemes.length;
  const nommes = systemes.filter((s) => s.nom);
  const menacants = systemes.filter((s) => s.menace && s.menace.niveau !== 'aucun' && s.menace.niveau !== 'veille');

  if (n === 0) {
    return {
      titre: 'Aucun phénomène cyclonique ne menace actuellement la Guadeloupe.',
      detail: "Le National Hurricane Center ne suit aucune zone de développement dans l'Atlantique nord.",
      ton: 'calme',
    };
  }

  if (menacants.length === 0) {
    const quoi = nommes.length
      ? `${nommes.length} système${nommes.length > 1 ? 's' : ''} nommé${nommes.length > 1 ? 's' : ''} et ${n - nommes.length} zone${n - nommes.length > 1 ? 's' : ''} surveillée${n - nommes.length > 1 ? 's' : ''}`
      : `${n} zone${n > 1 ? 's' : ''} surveillée${n > 1 ? 's' : ''}`;

    // Dire « sans incidence identifiée » alors qu'une zone est donnée à 50 %
    // par le NHC serait faussement rassurant. On cite la probabilité la plus
    // élevée : le lecteur juge sur le chiffre officiel, pas sur une formule.
    const probaMax = systemes.reduce(
      (max, s) => (Number.isFinite(s.prob7j) && s.prob7j > max ? s.prob7j : max), 0,
    );
    const detail = probaMax >= 30
      ? `${quoi} ${n > 1 ? 'sont suivies' : 'est suivie'} dans l'Atlantique. `
        + `La plus active est donnée à ${probaMax} % de chances de se former sous sept jours `
        + `par le National Hurricane Center. Aucune ne se dirige vers l'archipel à ce stade, `
        + `mais leur évolution est à suivre.`
      : `${quoi} ${n > 1 ? 'sont suivies' : 'est suivie'} dans l'Atlantique, `
        + `sans incidence identifiée pour l'archipel.`;

    return {
      titre: 'Aucun phénomène cyclonique ne menace actuellement la Guadeloupe.',
      detail,
      ton: probaMax >= 40 ? 'attention' : 'calme',
    };
  }

  const principal = menacants[0];
  return {
    titre:
      risque.code === 'imminent'
        ? `Un système approche des Petites Antilles.`
        : `Un système est à surveiller pour la Guadeloupe.`,
    detail: principal.menace.message,
    ton: risque.code === 'imminent' ? 'alerte' : 'attention',
  };
}

function etatSource(cle, nhc, local, degradations, mf, observations, satellite) {
  // Fond de carte : fichiers embarqués, servis par l'application elle-même.
  // Il ne dépend d'aucun réseau, donc il ne tombe jamais.
  if (cle === 'naturalearth') return { disponible: true, mode: 'embarqué' };

  if (cle === 'satellite') {
    const nb = satellite?.images?.length || 0;
    return {
      disponible: Boolean(satellite?.ok && nb),
      mode: satellite?.ok && nb ? `boucle de ${nb} images` : (satellite?.erreur || 'indisponible'),
      emisLe: satellite?.derniereImage || null,
    };
  }

  if (cle === 'meteofrance') {
    // Sans jeton, la source reste ce qu'elle était : un lien vers l'autorité.
    // C'est une configuration absente, pas une panne — l'interface ne doit pas
    // afficher une alerte technique pour ça.
    if (!meteoFranceConfiguree()) return { disponible: true, mode: 'lien officiel' };

    // Deux volets indépendants, et ils ne vont pas toujours ensemble : le
    // compte peut être abonné aux observations sans l'être à la vigilance.
    const nbObservations = Object.keys(observations || {}).length;
    const volets = [];
    if (mf?.disponible) volets.push(mf.perime ? 'dernière vigilance connue' : 'vigilance officielle');
    if (nbObservations) volets.push(`observations (${nbObservations} territoire(s))`);

    if (volets.length) {
      return {
        disponible: true,
        mode: volets.join(' + '),
        emisLe: mf?.emisLe || null,
        // Dit explicitement ce qui manque, pour que la page Sources soit
        // honnête plutôt que muette.
        vigilance: mf?.disponible ? 'intégrée' : (mf?.motif || 'indisponible'),
      };
    }
    return { disponible: false, mode: mf?.motif || 'indisponible' };
  }
  if (cle === 'nhc') {
    const ko = degradations.some((d) => d.startsWith('NHC') || d.includes('TWO') || d.includes('systèmes actifs'));
    return { disponible: !ko, mode: ko ? 'partiel' : 'complet', emisLe: nhc.emisLe || null };
  }
  return { disponible: local.ok, mode: local.ok ? 'complet' : 'indisponible' };
}

// Exécution directe : `npm run collect`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const etatFinal = await collecter();
  console.log(
    `Collecte terminée en ${etatFinal.dureeCollecteMs} ms — ${etatFinal.systemes.length} système(s), risque : ${etatFinal.situation.risque.label}`,
  );
  if (etatFinal.degradations.length) console.log('Dégradations :', etatFinal.degradations.join(' | '));
}
