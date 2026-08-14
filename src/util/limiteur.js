/**
 * Limiteur d'appels par fenêtre glissante — sans dépendance.
 *
 * Météo-France annonce des quotas par minute (60 pour la Vigilance, 50 pour les
 * observations). KDL Cyclone est très loin de ces valeurs en régime normal : le
 * serveur seul interroge les sources, toutes les cinq minutes. Le limiteur
 * n'existe donc pas pour ralentir l'usage courant, mais pour empêcher un cas
 * pathologique — une boucle de réessais, un redémarrage en rafale, une collecte
 * forcée pendant qu'une autre tourne — de faire suspendre le jeton.
 *
 * Le choix d'une fenêtre glissante plutôt que d'un compteur remis à zéro chaque
 * minute est délibéré : un compteur remis à zéro autorise deux rafales pleines
 * de part et d'autre de la bascule, soit le double du quota en une seconde.
 */

export class Limiteur {
  /**
   * @param {number} maxParFenetre Appels autorisés sur la fenêtre.
   * @param {number} [fenetreMs] Durée de la fenêtre, une minute par défaut.
   */
  constructor(maxParFenetre, fenetreMs = 60_000) {
    this.max = Math.max(1, maxParFenetre);
    this.fenetreMs = fenetreMs;
    /** @type {number[]} horodatages des appels retenus dans la fenêtre */
    this.appels = [];
    /** Fin d'une pause imposée par la source (429 avec `Retry-After`). */
    this.pauseJusqua = 0;
  }

  /** Oublie les appels sortis de la fenêtre. */
  #purger(maintenant) {
    const limite = maintenant - this.fenetreMs;
    while (this.appels.length && this.appels[0] <= limite) this.appels.shift();
  }

  /**
   * Attend le temps nécessaire pour rester dans le quota, puis enregistre
   * l'appel. À appeler juste avant chaque requête.
   */
  async reserver(maintenant = Date.now()) {
    this.#purger(maintenant);

    let attente = 0;
    if (this.pauseJusqua > maintenant) attente = this.pauseJusqua - maintenant;
    if (this.appels.length >= this.max) {
      // Le plus ancien appel de la fenêtre libère une place en sortant.
      attente = Math.max(attente, this.appels[0] + this.fenetreMs - maintenant);
    }

    if (attente > 0) {
      await new Promise((r) => setTimeout(r, attente));
      return this.reserver(Date.now());
    }

    this.appels.push(maintenant);
    return 0;
  }

  /**
   * Impose une pause demandée par la source elle-même.
   * @param {number} secondes Valeur de l'en-tête `Retry-After`.
   */
  pauser(secondes) {
    const ms = Math.max(0, Math.min(Number(secondes) || 0, 300)) * 1000;
    this.pauseJusqua = Math.max(this.pauseJusqua, Date.now() + ms);
  }

  /** État lisible, sans rien de sensible — utilisable dans un diagnostic. */
  etat(maintenant = Date.now()) {
    this.#purger(maintenant);
    return {
      appelsDansLaFenetre: this.appels.length,
      max: this.max,
      enPauseJusqua: this.pauseJusqua > maintenant
        ? new Date(this.pauseJusqua).toISOString()
        : null,
    };
  }
}
