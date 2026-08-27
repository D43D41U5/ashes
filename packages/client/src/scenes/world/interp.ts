/**
 * Tampon d'interpolation des entités distantes (netcode client, spec reconciliation
 * hors-périmètre R4 étendu pour la latence LAN).
 *
 * L'avatar LOCAL est prédit (jamais ici) ; TOUTES les autres entités — joueurs
 * distants, PNJ, faune — sont RENDUES EN RETARD, à `now - delayMs`, entre les deux
 * échantillons de snapshot qui encadrent cet instant. Ce retard (un « tampon de
 * gigue ») absorbe l'irrégularité d'arrivée des snapshots sur le réseau : sans lui,
 * un snapshot en retard fait sauter le sprite, puis rattraper d'un coup. On paie un
 * délai visuel (≈ le délai choisi) contre de la fluidité — le compromis standard.
 *
 * PUR — aucune dépendance Phaser, testé dans `interp.test.ts`.
 */

/** Un relevé de position daté (temps d'horloge de rendu, pas un tick de sim). */
export interface Sample {
  at: number
  x: number
  y: number
}

/** Au-delà : on jette les plus vieux. ~12 relevés = ~0,6 s à 20 Hz, large devant 100 ms. */
const MAX_SAMPLES = 12

/** Ajoute un relevé (chronologique, le plus vieux en tête) et borne la taille. */
export function pushSample(buffer: Sample[], at: number, x: number, y: number): void {
  buffer.push({ at, x, y })
  if (buffer.length > MAX_SAMPLES) buffer.splice(0, buffer.length - MAX_SAMPLES)
}

/**
 * ═══ DE COMBIEN A-T-IL BOUGÉ, RÉCEMMENT ? — le déplacement RÉEL, pas le cap rangé ═══
 *
 * *(Alexis, 2026-08-25 : « il devrait s'aligner vers la direction où il se déplace le plus en X
 * et en Y ».)*
 *
 * `entity.facing` est quantifié en HUIT secteurs par la sim (il vient des signes du pas) : sur une
 * diagonale, ses deux composantes sont ÉGALES, et « de quel côté se déplace-t-il le plus ? » n'y a
 * pas de réponse. Le tampon d'interpolation, lui, porte les positions réelles : la différence
 * entre le dernier relevé et celui d'il y a `fenetreMs` EST la question, sans arbitrage.
 *
 * Rend `{ dx: 0, dy: 0 }` quand le tampon est trop court ou l'entité immobile — l'appelant garde
 * alors ce qu'il avait, plutôt que de basculer sur un zéro.
 */
export function deplacementRecent(buffer: readonly Sample[], fenetreMs: number): { dx: number; dy: number } {
  const dernier = buffer[buffer.length - 1]
  if (dernier === undefined) return { dx: 0, dy: 0 }
  // Le relevé le plus RÉCENT parmi ceux d'il y a au moins `fenetreMs` — à défaut, le plus vieux
  // qu'on ait : un tampon qui vient de naître dit quand même dans quel sens on va.
  let base = buffer[0]!
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (dernier.at - buffer[i]!.at >= fenetreMs) { base = buffer[i]!; break }
  }
  return { dx: dernier.x - base.x, dy: dernier.y - base.y }
}

/**
 * Position à l'instant `target`, interpolée entre les deux relevés qui l'encadrent.
 * Dégradé GRACIEUX aux deux bouts :
 * - `target` avant le premier relevé (démarrage à froid) → le premier relevé ;
 * - `target` après le dernier (tampon affamé : snapshot en retard) → le dernier
 *   (on GÈLE sur la position connue plutôt que d'extrapoler dans le vide).
 * Buffer vide → `null` (l'appelant garde alors la position d'origine).
 */
export function sampleAt(buffer: readonly Sample[], target: number): { x: number; y: number } | null {
  if (buffer.length === 0) return null
  const first = buffer[0]!
  if (target <= first.at) return { x: first.x, y: first.y }
  const last = buffer[buffer.length - 1]!
  if (target >= last.at) return { x: last.x, y: last.y }
  for (let i = 1; i < buffer.length; i++) {
    const b1 = buffer[i]!
    if (b1.at >= target) {
      const b0 = buffer[i - 1]!
      const span = b1.at - b0.at
      const t = span > 0 ? (target - b0.at) / span : 0
      return { x: b0.x + (b1.x - b0.x) * t, y: b0.y + (b1.y - b0.y) * t }
    }
  }
  return { x: last.x, y: last.y }
}
