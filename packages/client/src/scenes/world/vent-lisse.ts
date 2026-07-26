/**
 * LE VENT LISSÉ — la version RENDU du vent de la sim, pour tout ce qui dérive lentement
 * (brume, bancs). Diagnostic du 2026-07-26 (MESURÉ) : la sim publie un CAP unitaire qui
 * SAUTE d'un coup (45° à 180°) toutes les 5 minutes, sans force ; et l'ancienne brume n'en
 * dépendait qu'à ±6 % — une dérive quasi codée en dur.
 *
 * Ici : le cap est rallié en douceur (~15 s — un banc ne casse jamais sa route d'un coup),
 * la FORCE est inventée côté client (deux battements lents désynchronisés — la sim n'en
 * fournit pas), et le vecteur n'est JAMAIS nul : une brume immobile est une image plate,
 * c'est ce qui a été jugé et rejeté. Client pur : sin/pow autorisés (l'interdit est sim-only).
 */

export class VentLisse {
  private dir = { x: 1, y: 0 }
  private cible = { x: 1, y: 0 }

  /** À appeler chaque frame. `windSim` est le cap de la sim (norme 1, ou nul par calme plat).
   *  Rend un vecteur direction × force, norme ~0,55..1,15 — l'appelant applique sa vitesse. */
  update(nowMs: number, dtMs: number, windSim?: { x: number; y: number }): { x: number; y: number } {
    if (windSim && (windSim.x !== 0 || windSim.y !== 0)) {
      const n = Math.sqrt(windSim.x * windSim.x + windSim.y * windSim.y)
      this.cible = { x: windSim.x / n, y: windSim.y / n }
    }
    // Demi-tour parfait (cible anti-parallèle) : le lerp re-normalisé ne TOURNE jamais — il
    // raccourcit le vecteur puis le re-projette sur la même droite (revue, MESURÉ : la clef
    // « n < 0,05 » ne se déclenchait qu'après un gel de plusieurs secondes). On détecte
    // l'anti-parallélisme au produit scalaire et on pousse par le travers AVANT le lerp :
    // le virage se fait en arc, d'un côté déterminé (le travers gauche de la cible).
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
    // La force : deux battements lents (périodes ~145 s et ~45 s, désynchronisées) — des
    // bouffées, pas un métronome. Bornée loin de zéro : le monde ne retient pas son souffle.
    const force = 0.85 + 0.2 * Math.sin(nowMs / 23000) + 0.1 * Math.sin(nowMs / 7100 + 1.7)
    return { x: this.dir.x * force, y: this.dir.y * force }
  }
}
