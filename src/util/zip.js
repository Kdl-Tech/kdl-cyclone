/**
 * Lecteur ZIP minimal (stored + deflate), bâti sur `zlib` natif.
 * Nécessaire pour ouvrir les archives GIS du NHC sans ajouter de dépendance.
 * Ne gère volontairement ni chiffrement, ni ZIP64, ni multi-volumes : les
 * archives visées sont de petites archives de shapefiles.
 */
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

/**
 * @param {Buffer} buf Archive complète en mémoire.
 * @returns {Map<string, Buffer>} nom de fichier → contenu décompressé.
 */
export function unzip(buf) {
  const out = new Map();
  if (!Buffer.isBuffer(buf) || buf.length < 22) return out;

  // Fin du répertoire central : recherche depuis la fin (commentaire ≤ 64 Ko).
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;

  const nbEntrees = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < nbEntrees; n += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== SIG_CEN) break;
    const methode = buf.readUInt16LE(ptr + 10);
    const tailleCompressee = buf.readUInt32LE(ptr + 20);
    const lgNom = buf.readUInt16LE(ptr + 28);
    const lgExtra = buf.readUInt16LE(ptr + 30);
    const lgComment = buf.readUInt16LE(ptr + 32);
    const offsetLocal = buf.readUInt32LE(ptr + 42);
    const nom = buf.toString('utf8', ptr + 46, ptr + 46 + lgNom);
    ptr += 46 + lgNom + lgExtra + lgComment;

    if (offsetLocal + 30 > buf.length) continue;
    const lgNomLocal = buf.readUInt16LE(offsetLocal + 26);
    const lgExtraLocal = buf.readUInt16LE(offsetLocal + 28);
    const debut = offsetLocal + 30 + lgNomLocal + lgExtraLocal;
    const brut = buf.subarray(debut, debut + tailleCompressee);

    try {
      if (methode === 0) out.set(nom, Buffer.from(brut));
      else if (methode === 8) out.set(nom, zlib.inflateRawSync(brut));
    } catch {
      // Entrée illisible : ignorée, les autres restent exploitables.
    }
  }
  return out;
}
