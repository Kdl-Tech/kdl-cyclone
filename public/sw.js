/**
 * Service worker — KDL Cyclone.
 *
 * Objectif : que l'application reste utile quand la connexion se dégrade, ce
 * qui est précisément le moment où l'on en a besoin.
 *
 *   coquille et carte  → cache d'abord (instantané, disponible hors ligne)
 *   /api/etat          → réseau d'abord, repli sur la dernière réponse connue
 *
 * Une réponse servie depuis le cache porte l'en-tête `X-KDL-Cache`, et
 * l'interface date systématiquement l'information affichée.
 */

// __VERSION__ est remplacée par le serveur au moment de servir ce fichier.
// Le nom du cache change donc à chaque version : le navigateur détecte un
// nouveau service worker, réinstalle la coquille et propose la mise à jour.
// Sans cela, un visiteur déjà venu gardait l'ancienne version indéfiniment.
var VERSION = 'kdl-cyclone-__VERSION__-__BUILD__';
var PREFIXE = 'kdl-cyclone-';
var CACHE_COQUILLE = VERSION + '-coquille';
var CACHE_DONNEES = VERSION + '-donnees';

var COQUILLE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/carte.js',
  '/js/cadran.js',
  '/js/preparation.js',
  '/js/installation.js',
  '/js/beta.js',
  '/js/satellite.js',
  '/js/graphiques.js',
  // Les fontes font partie de la coquille : hors connexion, l'application
  // doit garder son visage, pas retomber sur la fonte du système.
  '/fonts/inter-400.woff2',
  '/fonts/inter-600.woff2',
  '/fonts/inter-700.woff2',
  '/geo/monde.json',
  '/geo/antilles.json',
  '/geo/guadeloupe.json',
  '/icons/logo-96.png',
  '/icons/favicon-64.png',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', function (e) {
  // Pas de skipWaiting automatique : une nouvelle version ne doit jamais
  // remplacer l'ancienne pendant que quelqu'un lit une information de sécurité.
  // Elle attend en coulisse que l'utilisateur accepte la mise à jour.
  e.waitUntil(caches.open(CACHE_COQUILLE).then(function (c) { return c.addAll(COQUILLE); }));
});

/**
 * La page demande à cette version de prendre la main.
 *
 * Un service worker en attente est fréquemment arrêté par le navigateur et
 * n'entend pas toujours ce message : la page prévoit donc un filet. Quand il
 * arrive, on répond, pour qu'elle sache que la bascule est engagée plutôt que
 * de patienter à l'aveugle.
 *
 * Deux noms sont acceptés : `SKIP_WAITING`, la convention répandue, et
 * `APPLIQUER_MAJ`, utilisé par les versions précédentes de l'application. Une
 * page servie depuis un ancien cache doit pouvoir réveiller un service worker
 * neuf — c'est exactement le cas qui bloquait les visiteurs.
 */
self.addEventListener('message', function (e) {
  var type = e.data && e.data.type;
  if (type !== 'SKIP_WAITING' && type !== 'APPLIQUER_MAJ') {
    if (type === 'VERSION') repondre(e, { type: 'VERSION', version: VERSION });
    return;
  }
  self.skipWaiting();
  repondre(e, { type: 'MAJ_ENGAGEE', version: VERSION });
});

function repondre(e, charge) {
  if (e.ports && e.ports[0]) { e.ports[0].postMessage(charge); return; }
  // Sans canal dédié, on prévient tous les clients : la page saura que la
  // bascule est lancée même si elle n'a pas ouvert de port.
  self.clients.matchAll({ includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (c) { c.postMessage(charge); });
  });
}

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (noms) {
        // On ne supprime que nos propres caches : ceux d'une autre application
        // servie sur le même domaine ne nous appartiennent pas.
        return Promise.all(noms
          .filter(function (n) { return n.indexOf(PREFIXE) === 0 && n.indexOf(VERSION) !== 0; })
          .map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); }),
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Données : le réseau fait foi, le cache sert de filet.
  if (url.pathname.indexOf('/api/') === 0) {
    e.respondWith(
      fetch(req)
        .then(function (rep) {
          if (rep.ok && url.pathname === '/api/etat') {
            var copie = rep.clone();
            caches.open(CACHE_DONNEES).then(function (c) { c.put(req, copie); });
          }
          return rep;
        })
        .catch(function () {
          return caches.match(req).then(function (cache) {
            if (cache) {
              // `blob()` rend le corps DÉCODÉ. Conserver `content-encoding: gzip`
              // ferait échouer la lecture côté page : on repart d'en-têtes propres.
              var entetes = new Headers();
              entetes.set('Content-Type', cache.headers.get('Content-Type') || 'application/json');
              entetes.set('Cache-Control', 'no-store');
              entetes.set('X-KDL-Cache', 'hors-ligne');
              return cache.blob().then(function (corps) {
                return new Response(corps, { status: 200, headers: entetes });
              });
            }
            return new Response(
              JSON.stringify({
                erreur: 'Hors connexion et aucune donnée en mémoire.',
                conseil: 'Ouvrez l\'application une fois connecté pour disposer du mode hors ligne.',
              }),
              { status: 503, headers: { 'Content-Type': 'application/json' } },
            );
          });
        }),
    );
    return;
  }

  // Le document lui-même : réseau d'abord. C'est lui qui référence les scripts
  // et la feuille de style ; le servir depuis un cache périmé figerait
  // l'application dans son ancienne version, même après un déploiement.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (rep) {
          if (rep && rep.ok) {
            var copie = rep.clone();
            caches.open(CACHE_COQUILLE).then(function (c) { c.put('/index.html', copie); });
          }
          return rep;
        })
        .catch(function () {
          return caches.match('/index.html').then(function (cache) {
            return cache || caches.match('/');
          });
        }),
    );
    return;
  }

  // Coquille et ressources : cache d'abord, mise à jour en arrière-plan.
  e.respondWith(
    caches.match(req).then(function (cache) {
      var reseau = fetch(req)
        .then(function (rep) {
          if (rep.ok) {
            var copie = rep.clone();
            caches.open(CACHE_COQUILLE).then(function (c) { c.put(req, copie); });
          }
          return rep;
        })
        .catch(function () {
          // Navigation hors ligne vers une route inconnue : on rend l'application.
          if (req.mode === 'navigate') return caches.match('/index.html');
          return cache;
        });
      return cache || reseau;
    }),
  );
});
