/**
 * LE CONTOUR EXACT DE LA ZONE RÉSOLUE — ce que le télégraphe doit dessiner.
 *
 * ═══ LE DÉFAUT QU'IL CORRIGE, ET IL SE LISAIT DANS LE CODE ═══
 *
 * `WorldScene.zoneOf` peignait la zone NOMINALE du `Strike` : `range` et `arcCos`, tels
 * quels. Or `inStrikeZone` (sim) résout depuis le 2026-08-02 sur la zone ÉLARGIE DU CORPS
 * de la cible — la portée grossit de `HIT_BODY_RADIUS`, et l'ANGLE aussi, parce qu'un
 * corps de rayon r vu à distance d couvre un demi-angle φ avec sin φ = r/d. Mesuré à
 * l'époque : de **+16 % (lance) à +36 % (poings)** de surface réellement touchée.
 *
 * Le dessin était donc plus STRICT que la règle : le coup portait hors du télégraphe. Un
 * télégraphe qui ment dans le sens généreux est le pire des deux — il apprend au joueur
 * une portée fausse, et le jeu la dément sans jamais dire pourquoi.
 *
 * ═══ LA FORME, ET ELLE EST EXACTE ═══
 *
 * On ne « dilate » pas au jugé : on inverse le prédicat. En polaire depuis le frappeur,
 * avec α l'écart à la visée, le lieu des CENTRES touchés est
 *
 *     ρ ≤ range + r        ET        α ≤ θ + asin(r/ρ)
 *
 * plus le disque ρ ≤ r tout entier (le corps de la cible ENGLOBE le frappeur : aucune
 * direction ne l'épargne — c'est la branche `d2 <= corps*corps` de la sim). Le contour
 * s'échantillonne donc le long des deux flancs, où le demi-angle s'ouvre à mesure qu'on
 * se rapproche, et se ferme par l'arc extérieur.
 *
 * ⚠ ICI ON A LE DROIT À `Math.acos`/`asin`/`cos`/`sin` — c'est du DESSIN, pas de la sim :
 * l'invariant §2 (pas de trigonométrie approximée) protège le rejeu, et rien de ce fichier
 * n'entre dans un `SimState`. La sim, elle, garde sa formule en `+ − × ÷` et `sqrt`.
 *
 * Tout est en TUILES. La conversion en pixels appartient à l'appelant — tester le polygone
 * en pixels réintroduirait l'échelle comme source d'écart avec le prédicat qu'on reproduit.
 */

/** Ce que le contour a besoin de savoir d'un `Strike` — la forme, rien d'autre. */
export interface FormeZone {
  shape: 'cone' | 'disc'
  range: number
  arcCos: number
  radius: number
}

/** Un point du contour, en tuiles, relatif au frappeur (visée le long de +x). */
export interface Point {
  x: number
  y: number
}

/** Finesse d'échantillonnage d'un flanc. 12 suffit : le flanc est court et régulier. */
const PAS_FLANC = 12
/** Finesse de l'arc extérieur — c'est lui qu'on voit, il a droit à plus de points. */
const PAS_ARC = 28

/**
 * LE CONTOUR, en tuiles et dans le repère du frappeur (visée = +x). L'appelant fait
 * tourner et translate — c'est la même séparation que `arcPoints` avait déjà.
 *
 * `corps` est le rayon de la cible (`COMBAT.HIT_BODY_RADIUS`) : à 0, on retrouve
 * EXACTEMENT le contour nominal d'avant, ce qui rend la règle éteignable et vérifiable.
 */
export function contourZone(zone: FormeZone, corps: number): Point[] {
  const r = Math.max(0, corps)

  if (zone.shape === 'disc') {
    // Le disque est posé DEVANT, à `range` : il grossit simplement du rayon du corps.
    const cx = zone.range
    const rayon = zone.radius + r
    return cercle(cx, 0, rayon, PAS_ARC * 2)
  }

  const portee = zone.range + r
  // LE TOURBILLON (arcCos ≤ −1) : tout le tour. Un polygone à 360° coudrait une couture
  // dans le dos de l'avatar ; un cercle centré n'en a pas.
  if (zone.arcCos <= -1) return cercle(0, 0, portee, PAS_ARC * 2)

  const theta = Math.acos(Math.max(-1, Math.min(1, zone.arcCos)))

  // Sans corps, la forme est le secteur nominal : apex, arc, retour. Le cas est traité à
  // part parce que le flanc dégénère (φ ≡ 0) et que l'apex est un vrai point anguleux.
  if (r <= 0) {
    const pts: Point[] = [{ x: 0, y: 0 }]
    for (let i = 0; i <= PAS_ARC; i++) {
      const a = -theta + (2 * theta * i) / PAS_ARC
      pts.push({ x: Math.cos(a) * zone.range, y: Math.sin(a) * zone.range })
    }
    return pts
  }

  /** Le demi-angle utile à la distance ρ — il s'OUVRE quand on se rapproche. */
  const demiAngle = (rho: number): number => theta + Math.asin(Math.min(1, r / rho))

  const pts: Point[] = []
  // ① Le flanc NÉGATIF, de l'intérieur (ρ = r, où l'angle vaut θ + 90°) vers l'extérieur.
  for (let i = 0; i <= PAS_FLANC; i++) {
    const rho = r + ((portee - r) * i) / PAS_FLANC
    const a = -demiAngle(rho)
    pts.push({ x: Math.cos(a) * rho, y: Math.sin(a) * rho })
  }
  // ② L'arc extérieur, d'un flanc à l'autre.
  const bord = demiAngle(portee)
  for (let i = 1; i < PAS_ARC; i++) {
    const a = -bord + (2 * bord * i) / PAS_ARC
    pts.push({ x: Math.cos(a) * portee, y: Math.sin(a) * portee })
  }
  // ③ Le flanc POSITIF, de l'extérieur vers l'intérieur.
  for (let i = PAS_FLANC; i >= 0; i--) {
    const rho = r + ((portee - r) * i) / PAS_FLANC
    const a = demiAngle(rho)
    pts.push({ x: Math.cos(a) * rho, y: Math.sin(a) * rho })
  }
  // ④ LE DISQUE DU CORPS, refermé par l'arrière. À ρ ≤ r, la cible englobe le frappeur et
  //    AUCUNE direction ne l'épargne (branche `d2 <= corps*corps` de la sim) : le contour
  //    doit donc faire le tour par le dos, sans quoi le dessin promettrait un angle mort
  //    de trois pixels qui n'existe pas. C'est minuscule et c'est exact — et c'est
  //    justement au contact, quand on est cerné, que le joueur a besoin qu'on ne mente pas.
  const ouvert = demiAngle(r) // θ + 90°
  for (let i = 1; i < PAS_ARC; i++) {
    const a = ouvert + ((2 * Math.PI - 2 * ouvert) * i) / PAS_ARC
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return pts
}

function cercle(cx: number, cy: number, rayon: number, pas: number): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < pas; i++) {
    const a = (i * 2 * Math.PI) / pas
    pts.push({ x: cx + Math.cos(a) * rayon, y: cy + Math.sin(a) * rayon })
  }
  return pts
}
