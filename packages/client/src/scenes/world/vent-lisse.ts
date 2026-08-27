/**
 * LE VENT LISSÉ — la version RENDU du vent de la sim, pour tout ce qui dérive lentement
 * (brume, bancs).
 *
 * ═══ CE QU'IL FAISAIT, ET POURQUOI IL NE LE FAIT PLUS ═══
 *
 * Diagnostic du 2026-07-26 (MESURÉ) : la sim publiait un CAP unitaire qui SAUTAIT d'un coup
 * (45° à 180°) toutes les cinq minutes, et SANS FORCE — ce module inventait donc la force, à
 * coups de deux battements lents. C'était une prothèse : le vent n'avait pas de force à publier.
 *
 * Depuis l'unification (`vent.md`, 2026-08-24 — « le front est le vent »), LA SIM A UNE FORCE
 * et ce module la CONSOMME. Il ne lui reste qu'un seul métier, celui qu'elle ne peut pas faire :
 * RALLIER LE CAP EN DOUCEUR. Le cap de la sim avance par crans de 45° — c'est le prix de la
 * pureté (un lissage entré dans la sim lui coûterait le rembobinage, `vent.md` contrainte 1) —
 * et c'est ici que la pente redevient continue.
 *
 * Client pur : `sin`/`pow` autorisés (l'interdit de l'invariant 2 est sim-only).
 */

/** Le battement RÉSIDUEL — la respiration, posée AU-DESSUS de la force de la sim, jamais à sa
 *  place. Deux périodes désynchronisées (~23 s et ~7 s) : des bouffées, pas un métronome. */
const RESPIRATION = 0.08

/** LE PLANCHER DE RENDU. La sim rend 0 sous la sentinelle du calme plat (`wind = {0,0}` : un
 *  monde d'hôte ou de banc qui n'a pas de vent). Une brume immobile est une image plate — jugé
 *  et rejeté le 2026-07-26 — donc le rendu garde un souffle minimal même là. Ce n'est PAS un
 *  démenti de la sim : aucune règle ne s'y branche, seules des nappes dérivent. */
const PLANCHER_RENDU = 0.4

export class VentLisse {
  private dir = { x: 1, y: 0 }
  private cible = { x: 1, y: 0 }
  /** Le cap de la sim tel qu'il est arrivé — c'est lui qui porte la SENTINELLE du calme plat. */
  private brut = { x: 1, y: 0 }

  /**
   * ═══ LE CAP RALLIÉ, SANS LA FORCE (Alexis, 2026-08-25) ═══
   *
   * *« Quand il y a un changement de direction du vent, les houppiers et autres végétaux
   * reviennent à la position initiale d'un coup. »* Exactement : le décor lisait `state.wind`,
   * le cap BRUT de la sim, qui avance par crans de 45°. À chaque bascule, `windSway` recalculait
   * son inclinaison de fond (`BASE_LEAN × wx`) sur le nouveau cap — et sur un virage vers le
   * nord ou le sud, `wx` tombe à zéro : toutes les tiges se redressaient d'une image à l'autre.
   * Ce module tenait DÉJÀ la pente continue, mais seule la brume en profitait.
   *
   * On expose donc le cap rallié SEUL, sans le plancher de rendu ni la respiration : ce que le
   * décor doit prendre ici, c'est la DIRECTION lissée ; sa force, il la lit de la sim
   * (`state.windForce`), qui monte avant la pluie et n'a pas à être réinventée.
   *
   * ⚠ LA SENTINELLE DU CALME PLAT TRAVERSE. `wind = {0,0}` dit « ce monde n'a pas de vent »
   * (`vent.ts`) et `windSway` s'y appuie pour ne RIEN faire bouger. Un cap rallié, lui, est
   * toujours unitaire : le rendre tel quel aurait fait plier les herbes d'un monde sans vent —
   * un banc, un hôte muet. On repasse donc le vecteur nul quand la sim l'envoie.
   */
  get cap(): { x: number; y: number } {
    if (this.brut.x === 0 && this.brut.y === 0) return this.brut
    return this.dir
  }

  /**
   * À appeler chaque frame. `windSim` est le cap de la sim (norme 1, ou nul par calme plat),
   * `forceSim` sa force au centre (`state.windForce` : de `VENT.AMBIANT` à 1, ou 0 par calme
   * plat). Rend un vecteur direction × force — l'appelant applique sa vitesse.
   */
  update(nowMs: number, dtMs: number, windSim?: { x: number; y: number }, forceSim?: number): { x: number; y: number } {
    if (windSim) this.brut = windSim
    if (windSim && (windSim.x !== 0 || windSim.y !== 0)) {
      const n = Math.sqrt(windSim.x * windSim.x + windSim.y * windSim.y)
      this.cible = { x: windSim.x / n, y: windSim.y / n }
    }
    // Demi-tour parfait (cible anti-parallèle) : le lerp re-normalisé ne TOURNE jamais — il
    // raccourcit le vecteur puis le re-projette sur la même droite (revue, MESURÉ : la clef
    // « n < 0,05 » ne se déclenchait qu'après un gel de plusieurs secondes). On détecte
    // l'anti-parallélisme au produit scalaire et on pousse par le travers AVANT le lerp :
    // le virage se fait en arc, d'un côté déterminé (le travers gauche de la cible).
    //
    // ⚠ C'est ce ressort-là qui NE SE TRANSPOSE PAS à la sim : il marche parce que `this.dir`
    // survit d'une frame à l'autre. Une fonction pure par tick n'a rien à pousser — d'où le
    // parcours en index de `vent.ts` V4.
    if (this.cible.x * this.dir.x + this.cible.y * this.dir.y < -0.995) {
      this.dir.x -= this.cible.y * 0.15
      this.dir.y += this.cible.x * 0.15
    }
    // Rallier le cap : demi-vie de 4 s → ~95 % du virage en 17 s, indépendant du framerate.
    const k = 1 - Math.pow(0.5, dtMs / 4000)
    this.dir.x += (this.cible.x - this.dir.x) * k
    this.dir.y += (this.cible.y - this.dir.y) * k
    const n = Math.sqrt(this.dir.x * this.dir.x + this.dir.y * this.dir.y)
    this.dir.x /= n
    this.dir.y /= n
    // LA FORCE VIENT DE LA SIM (elle monte avant la pluie : `vent.md` V2), et le résidu ne fait
    // que la faire respirer. Le monde ne retient jamais son souffle.
    const base = Math.max(forceSim ?? PLANCHER_RENDU, PLANCHER_RENDU)
    const respire = 1 + RESPIRATION * Math.sin(nowMs / 23000) + (RESPIRATION / 2) * Math.sin(nowMs / 7100 + 1.7)
    const force = base * respire
    return { x: this.dir.x * force, y: this.dir.y * force }
  }
}
