/**
 * Lecteur de shapefile (.shp + .dbf) réduit à ce dont KDL Cyclone a besoin :
 * points, polylignes et polygones en coordonnées géographiques WGS 84.
 * Écrit à la main pour éviter toute dépendance externe.
 *
 * Référence de format : ESRI Shapefile Technical Description (juillet 1998).
 */

const TYPES = { 0: 'Null', 1: 'Point', 3: 'PolyLine', 5: 'Polygon', 8: 'MultiPoint' };

/** Lit un .shp et retourne un tableau de géométries. */
export function readShp(buf) {
  const geoms = [];
  if (!Buffer.isBuffer(buf) || buf.length < 100) return geoms;
  if (buf.readInt32BE(0) !== 9994) return geoms;

  const longueurFichier = buf.readInt32BE(24) * 2; // exprimée en mots de 16 bits
  let ptr = 100;

  while (ptr + 8 <= Math.min(longueurFichier, buf.length)) {
    const longueurContenu = buf.readInt32BE(ptr + 4) * 2;
    const debut = ptr + 8;
    const fin = debut + longueurContenu;
    if (fin > buf.length) break;

    const type = buf.readInt32LE(debut);
    geoms.push(lireGeometrie(buf, debut, type));
    ptr = fin;
  }
  return geoms;
}

function lireGeometrie(buf, debut, type) {
  if (type === 1) {
    return {
      type: 'Point',
      coordinates: { lon: buf.readDoubleLE(debut + 4), lat: buf.readDoubleLE(debut + 12) },
    };
  }
  if (type === 3 || type === 5) {
    const nbParties = buf.readInt32LE(debut + 36);
    const nbPoints = buf.readInt32LE(debut + 40);
    const debutParties = debut + 44;
    const debutPoints = debutParties + nbParties * 4;

    const indexParties = [];
    for (let i = 0; i < nbParties; i += 1) indexParties.push(buf.readInt32LE(debutParties + i * 4));

    const points = [];
    for (let i = 0; i < nbPoints; i += 1) {
      points.push({
        lon: buf.readDoubleLE(debutPoints + i * 16),
        lat: buf.readDoubleLE(debutPoints + i * 16 + 8),
      });
    }

    const anneaux = indexParties.map((debutPartie, i) => {
      const finPartie = i + 1 < indexParties.length ? indexParties[i + 1] : nbPoints;
      return points.slice(debutPartie, finPartie);
    });

    return { type: TYPES[type], rings: anneaux };
  }
  return { type: TYPES[type] || `Inconnu(${type})` };
}

/** Lit un .dbf (dBase III/IV) et retourne un tableau d'objets d'attributs. */
export function readDbf(buf) {
  const lignes = [];
  if (!Buffer.isBuffer(buf) || buf.length < 32) return lignes;

  const nbEnregistrements = buf.readUInt32LE(4);
  const longueurEntete = buf.readUInt16LE(8);
  const longueurEnregistrement = buf.readUInt16LE(10);

  const champs = [];
  let ptr = 32;
  while (ptr < longueurEntete - 1 && buf[ptr] !== 0x0d) {
    champs.push({
      nom: buf.toString('latin1', ptr, ptr + 11).replace(/\0.*$/, '').trim(),
      type: String.fromCharCode(buf[ptr + 11]),
      longueur: buf[ptr + 16],
    });
    ptr += 32;
  }

  let pos = longueurEntete;
  for (let i = 0; i < nbEnregistrements; i += 1) {
    if (pos + longueurEnregistrement > buf.length) break;
    const supprime = buf[pos] === 0x2a;
    let champPos = pos + 1;
    const ligne = {};
    for (const c of champs) {
      const brut = buf.toString('latin1', champPos, champPos + c.longueur).trim();
      champPos += c.longueur;
      if (c.type === 'N' || c.type === 'F') {
        const n = Number.parseFloat(brut);
        ligne[c.nom] = Number.isFinite(n) ? n : null;
      } else if (c.type === 'L') {
        ligne[c.nom] = /^[YyTt]$/.test(brut);
      } else {
        ligne[c.nom] = brut;
      }
    }
    if (!supprime) lignes.push(ligne);
    pos += longueurEnregistrement;
  }
  return lignes;
}

/**
 * Associe géométries et attributs d'une même couche.
 * @param {Buffer} shp
 * @param {Buffer} [dbf]
 * @returns {Array<{geometry:object, properties:object}>}
 */
export function readLayer(shp, dbf) {
  const geoms = readShp(shp);
  const attrs = dbf ? readDbf(dbf) : [];
  return geoms.map((g, i) => ({ geometry: g, properties: attrs[i] || {} }));
}
