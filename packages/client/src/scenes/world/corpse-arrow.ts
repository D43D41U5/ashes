/**
 * LE TRAQUEUR DE DÉPOUILLE (mort-suite 2) — retrouver son sac tombé.
 *
 * À la mort, le porté reste sur le cadavre (spec inventaire R11) et l'avatar respawn au Feu,
 * loin. Sans repère, le sac est perdu — la dépouille décante (`CORPSE_TICKS`). On pose donc
 * une flèche de bord d'écran qui pointe vers elle, tant qu'elle existe.
 *
 * Ce résolveur est PUR (testable) : de la position de l'avatar, de la dépouille et de la vue
 * caméra, il tire OÙ poser la flèche à l'écran et son ANGLE. Quand la dépouille est déjà à
 * l'écran, `onScreen` est vrai — le client peut alors cacher la flèche (on la VOIT). NB :
 * `Math.atan2` est permis ici (code CLIENT, hors du /sim déterministe).
 */

export interface CorpseArrow {
  /** La dépouille est-elle dans le cadre caméra ? (si oui, cacher la flèche : on la voit) */
  onScreen: boolean
  /** Position ÉCRAN de la flèche (px, scrollFactor 0), posée sur un rayon près du bord. */
  x: number
  y: number
  /** Angle (radians) vers la dépouille — pour orienter la flèche. */
  angle: number
}

/** Rectangle monde visible par la caméra (px). */
export interface WorldView {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Place la flèche vers la dépouille. `radiusFrac` = fraction du plus petit côté écran à
 * laquelle poser la flèche depuis le centre (l'avatar est au centre, la caméra le suit).
 */
export function corpseArrow(
  playerX: number,
  playerY: number,
  corpseX: number,
  corpseY: number,
  view: WorldView,
  screenW: number,
  screenH: number,
  radiusFrac = 0.4,
): CorpseArrow {
  const onScreen =
    corpseX >= view.x && corpseX <= view.x + view.width && corpseY >= view.y && corpseY <= view.y + view.height
  const dx = corpseX - playerX
  const dy = corpseY - playerY
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const R = Math.min(screenW, screenH) * radiusFrac
  return {
    onScreen,
    x: screenW / 2 + (dx / len) * R,
    y: screenH / 2 + (dy / len) * R,
    angle: Math.atan2(dy, dx),
  }
}

/** Secondes (arrondies) avant que la dépouille ne décante, pour l'étiquette. */
export function corpseSecondsLeft(decayAt: number, nowTick: number, tickRateHz: number): number {
  return Math.max(0, Math.round((decayAt - nowTick) / tickRateHz))
}
