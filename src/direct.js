/** Décisions pures de la veille officielle rapide. */

const modifiee = (reponse) => Boolean(reponse?.ok && reponse.inchange !== true);

export function evaluerVeilleOfficielle({ mf, zones, texte, actifs }) {
  const meteoFranceModifiee = Boolean(
    mf?.disponible && mf.inchange !== true && mf.cache !== true,
  );
  return {
    modifie: meteoFranceModifiee || [zones, texte, actifs].some(modifiee),
    prefetch: { mf, nhc: { zones, texte, actifs } },
  };
}

/** Null signifie échec ou 304 ; un tableau vide signifie absence confirmée. */
export function reutiliserDerniereListe(nouvelle, precedente) {
  if (Array.isArray(nouvelle)) return nouvelle;
  return Array.isArray(precedente) ? precedente : [];
}
