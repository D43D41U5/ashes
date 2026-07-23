/**
 * LE GARDE DES FENÊTRES DU BAS — un petit automate PUR, donc prouvé par des tests.
 *
 * Les fenêtres-sur-le-monde (fonder, monter le Feu, réfugiés) ferment « en optimiste »
 * au clic. Mais `UIScene.update` rappelle leur `update()` À CHAQUE FRAME avec la valeur
 * du registre — laquelle ne change qu'au SNAPSHOT de confirmation (~1 à quelques frames
 * plus tard). Sans garde, la fenêtre rouvrait dès la frame suivante et un second clic
 * RENVOYAIT l'action : pour `upgrade_fire`, le handler sim retire le coût ET monte le
 * palier à chaque appel → double palier, double coût. Pour les réfugiés, double vivre.
 *
 * Le garde : après un clic, on retient l'IDENTITÉ visée (palier, id de feu, id de groupe)
 * et on TAIT la fenêtre tant que le registre rejoue la MÊME identité. Dès qu'elle change
 * (le snapshot a bougé l'état) ou passe à `null` (plus rien à portée), on rend la main.
 * Robuste à toute latence : on n'attend pas un délai, on attend le CHANGEMENT d'état.
 */
export interface PromptGate {
  /** À appeler au clic : on a tiré l'action sur cette identité, on attend sa confirmation. */
  acted(id: number): void
  /** À appeler à chaque `update()` avec l'identité reçue (`null` = rien à portée). Rend `true`
   *  s'il faut TAIRE la fenêtre (on attend encore la confirmation du même état), `false` sinon
   *  — et dans ce cas l'attente est levée (l'état a changé, ou il n'y a plus rien). */
  suppresses(incomingId: number | null): boolean
}

export function createPromptGate(): PromptGate {
  let pending: number | null = null // l'identité tirée en attente de confirmation ; null = rien
  return {
    acted(id) {
      pending = id
    },
    suppresses(incomingId) {
      if (pending !== null && incomingId !== null && incomingId === pending) return true
      pending = null // l'état a changé (ou plus rien) : on lève l'attente
      return false
    },
  }
}
