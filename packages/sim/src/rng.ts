/**
 * PRNG seedé (mulberry32) — l'unique source d'aléatoire autorisée dans /sim.
 *
 * L'état est un simple entier 32 bits stocké dans le SimState : il se
 * sérialise avec le reste de l'état, ce qui rend les snapshots et le replay
 * log exacts au bit près.
 */

/** Fait avancer l'état du PRNG d'un pas. Retourne le nouvel état. */
export function rngNext(state: number): number {
  return (state + 0x6d2b79f5) >>> 0
}

/** Dérive un flottant dans [0, 1) à partir d'un état de PRNG. */
export function rngFloat(state: number): number {
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Tire un flottant et l'état suivant en une passe. */
export function rngRoll(state: number): { value: number; next: number } {
  const next = rngNext(state)
  return { value: rngFloat(next), next }
}
