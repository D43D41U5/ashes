/**
 * L'ARBRE TOMBE (spec recolte.md G15) — le troisième et dernier signe qu'un nœud MEURT.
 *
 * Un arbre vidé disparaissait d'une frame à l'autre : le fût était là, on frappait, et il
 * n'était plus là. C'est le geste le plus long du jeu (une dizaine de coups, une jauge de
 * charge à tenir) et il se terminait par une disparition. Demandé par Alexis le 2026-07-29.
 *
 * ─── CE QU'UNE VUE DE DESSUS PERMET, ET CE QU'ELLE INTERDIT ──────────────────────────
 *
 * Le monde est dessiné en billboards vus de dessus : le fût est un sprite d'origine
 * (0.5, 1) qui pointe vers le HAUT de l'écran. Le faire tomber, c'est le faire TOURNER
 * autour de son pied — et le houppier, planté à `ancrageHouppierPx` sur ce fût, suit
 * l'arc du même angle.
 *
 * MAIS UN ARBRE QUI TOMBE VERS LE NORD NE TOURNE PAS. Il s'enfonce dans la profondeur,
 * et en projection sa pointe ne bouge quasiment pas : à l'écran, « il ne s'est rien
 * passé ». Ce n'est pas un détail de goût, c'est de la géométrie — et c'est pourquoi la
 * direction de chute n'est pas prise telle quelle. On exige que LA POINTE PARCOURE une
 * distance visible (`POINTE_MIN_PX`) et on rabat la direction vers le côté le plus proche
 * quand elle ne peut pas la parcourir. Le minimum n'est pas un angle choisi à l'œil : il
 * se DÉRIVE de la hauteur du fût (`angleChute`), donc un gros bois de 40 px et un arbre
 * ordinaire de 30 px obtiennent chacun le sien, sans qu'on y pense.
 *
 * ─── LE HOUPPIER QUITTE LA CANOPÉE ──────────────────────────────────────────────────
 *
 * Un houppier DEBOUT vit dans la bande canopée (`CROWN_BASE`, ~900 000) : elle coiffe le
 * monde, c'est ce qui lui permet de survoler les acteurs. Un houppier qui TOMBE n'a plus
 * rien à y faire — laissé là, il peindrait par-dessus le joueur, les murs et le fût
 * auquel il est accroché. Il rejoint donc la bande de tri Y dès la première image de la
 * chute, sous les acteurs : on passe DEVANT une cime abattue, et c'est ce qui la pose au
 * sol.
 */
import Phaser from 'phaser'
import { TIE_CLUTTER, TIE_NODE, TILE_PX, ySortDepth } from '../../render/framing'
import { ancrageHouppierPx, cleHouppier, type EtatCime, type VarianteArbre } from '../../render/arbre-art'
import { cleLit } from '../../render/normal-map'

/** La chute elle-même (ms) : le temps que met le fût à toucher le sol. */
export const CHUTE_MS = 760
/** Il reste couché, puis la forêt le reprend. */
const REPOS_MS = 420
const FONDU_MS = 420
const VIE_MS = CHUTE_MS + REPOS_MS + FONDU_MS

/**
 * Ce que LA POINTE du fût doit parcourir à l'écran pour qu'on VOIE une chute, en px monde.
 * En deçà, l'arbre s'enfonce dans la profondeur sans tourner et la chute est un non-événement.
 * ~12 px à un zoom de 2,25 font ~27 px d'écran : un mouvement franc, pas un frémissement.
 */
export const POINTE_MIN_PX = 12

/**
 * LE DÉPLACEMENT DE LA POINTE, en px monde, pour une chute vers l'azimut écran `phi`.
 *
 * Debout, la pointe est en `(0, −h)`. Couchée vers `phi`, elle est en `h·(cos φ, sin φ)`.
 * D'où `‖Δ‖ = h·√(2 + 2 sin φ)` — nul vers le NORD (φ = −π/2, l'arbre part droit dans la
 * profondeur), maximal vers le SUD (il tombe vers la caméra).
 */
export function deplacementPointe(phi: number, futH: number): number {
  return futH * Math.sqrt(Math.max(0, 2 + 2 * Math.sin(phi)))
}

/**
 * L'ANGLE DE ROTATION DU SPRITE pour une chute dans la direction `(dx, dy)`.
 *
 * Deux choses d'un coup, et la seconde est celle qui compte :
 *   1. la conversion azimut → rotation. Le sprite pointe vers le HAUT au repos : tourné de
 *      `α`, sa pointe est en `h·(sin α, −cos α)`. Pour qu'elle atteigne l'azimut `φ`, donc
 *      `h·(cos φ, sin φ)`, il faut `α = φ + π/2` (est → +π/2, nord → 0, sud → π).
 *
 *      LE SIGNE ÉTAIT INVERSÉ (`π/2 − φ`, corrigé le 2026-07-29 sur constat d'Alexis
 *      « les arbres qui tombent font parfois 180 degrés de plus que prévu »). Cette
 *      formule-là est une SYMÉTRIE : elle laisse l'est et l'ouest intacts et retourne le
 *      nord et le sud l'un dans l'autre. L'arbre s'abattait donc SUR le bûcheron placé au
 *      sud, et un arbre qu'on coupait par le nord ne tournait pas du tout (`α = 0`) —
 *      alors que `deplacementPointe` promet là son maximum, deux hauteurs de fût. Le
 *      module se contredisait lui-même, et sa garde reprenait la faute pour inverser la
 *      mesure : elle ne pouvait pas la voir.
 *
 *      La rotation se ramène ensuite dans `(−π, π]` : le sprite prend le CHEMIN LE PLUS
 *      COURT vers le sol. Sans ça une chute vers l'ouest partirait à `3π/2`, c'est-à-dire
 *      trois quarts de tour dans le mauvais sens — un arbre qui pirouette.
 *   2. LE RABATTEMENT. Si `φ` ne fait pas parcourir `POINTE_MIN_PX` à la pointe, on le
 *      rabat sur le plus proche azimut qui le fait, EN GARDANT SON CÔTÉ (est ou ouest) :
 *      l'arbre tombe toujours du bon bord, seulement moins « dans l'écran ». Une chute
 *      plein nord sans côté (dx = 0) part à l'est, arbitrairement mais toujours pareil.
 */
export function angleChute(dx: number, dy: number, futH: number): number {
  let phi = Math.atan2(dy, dx)
  if (deplacementPointe(phi, futH) < POINTE_MIN_PX) {
    // `h·√(2+2 sin φ) = min` ⟹ le sinus plancher. Au-delà de 1, aucune direction ne
    // convient (fût minuscule) : on prend le plein sud, le maximum atteignable.
    const sinMin = Math.min(1, (POINTE_MIN_PX * POINTE_MIN_PX) / (futH * futH) / 2 - 1)
    const cosSigne = Math.cos(phi) >= 0 ? 1 : -1
    phi = Math.atan2(sinMin, cosSigne * Math.sqrt(Math.max(0, 1 - sinMin * sinMin)))
  }
  const alpha = phi + Math.PI / 2
  return alpha > Math.PI ? alpha - 2 * Math.PI : alpha
}

/**
 * LA COURBE DE CHUTE, dans [0,1]. Un arbre ACCÉLÈRE : il part imperceptiblement, puis
 * s'abat. Une interpolation linéaire donnerait une barrière qui se baisse, pas un arbre
 * qui tombe — c'est l'accélération qui porte tout le poids de l'effet.
 *
 * Puis il S'ARRÊTE NET, avec un petit rebond amorti : le fût touche le sol, la cime
 * fouette une fois. Sans ce sursaut, la chute se termine par une immobilité molle.
 */
export function courbeChute(k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 1
  if (k < 0.86) {
    // `0,55t² + 0,45t³` : pente NULLE au départ (l'arbre hésite, comme un fût qui perd sa
    // prise), puis ça part. Vaut exactement 1 en t = 1, et croît partout.
    //
    // Première version : `t²(2 − t²)`, qui DÉCÉLÈRE — la garde l'a attrapée, et c'était
    // exactement la faute qu'elle vise : à mi-chemin l'arbre était déjà à 56 % de sa
    // course, soit une barrière qui se baisse, pas un arbre qui tombe.
    const t = k / 0.86
    return t * t * (0.55 + 0.45 * t)
  }
  // Le REBOND : 4 % au-delà, qui revient. Amorti, court — un contrecoup, pas un ressort.
  const t = (k - 0.86) / 0.14
  return 1 + 0.045 * Math.sin(t * Math.PI) * (1 - t)
}

interface Chute {
  fut: Phaser.GameObjects.Image
  houppier: Phaser.GameObjects.Image | null
  px: number
  py: number
  alpha: number
  ancrage: number
  ne: number
}

/** Plafond de troncs en train de tomber. Une coupe rase reste une coupe, pas une avalanche. */
const MAX_CHUTES = 6

/**
 * LES ARBRES QUI TOMBENT. Sprites empruntés à un banc (une chute dure ~1,6 s et il en
 * tombe rarement deux à la fois), texturés à la variante RÉELLE de l'arbre abattu — c'est
 * le même `varianteArbre` que la boucle de nœuds, donc le fût qui tombe est exactement
 * celui qu'on regardait.
 */
export class ChuteArbre {
  private readonly chutes: Chute[] = []

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * UN ARBRE S'ABAT. `px/py` : le PIED du fût, tel que la boucle de nœuds le posait
   * (relief compris). `dx/dy` : la direction de chute — celle qui l'éloigne du bûcheron.
   */
  tomber(px: number, py: number, variante: VarianteArbre, lit: boolean, dx: number, dy: number, now: number, cime = 0, etat: EtatCime = 'feuillu', miroir = false): void {
    if (this.chutes.length >= MAX_CHUTES) {
      const vieille = this.chutes.shift()
      vieille?.fut.destroy()
      vieille?.houppier?.destroy()
    }
    const m = variante.mesures
    const alpha = angleChute(dx, dy, m.futH)
    const fut = this.scene.add
      // LE MIROIR VIENT DE L'APPELANT, comme la cime et l'état, et pour la MÊME raison : le
      // redériver ici le tirerait d'une tuile déduite de `px/py`, qui portent le tressaillement —
      // l'arbre se retournerait À L'INSTANT où il tombe.
      .image(px, py, lit ? cleLit(`nd-${variante.slug}_trunk`, miroir) : `nd-${variante.slug}_trunk`)
      .setOrigin(0.5, 1)
      .setDepth(ySortDepth(py / TILE_PX, TILE_PX, TIE_NODE))
    fut.setLighting(lit)
    // LE HOUPPIER SORT DE LA BANDE CANOPÉE dès la première image (voir l'en-tête) : couché,
    // il doit passer SOUS les acteurs, pas coiffer le monde.
    const houppier = this.scene.add
      // LA CIME EST CELLE DE L'ARBRE DEBOUT, passée par l'appelant : la reconstruire ici la
      // tirerait d'une tuile déduite de `px/py`, qui portent déjà le tressaillement et le
      // décalage d'arbre — l'arbre changerait de houppier À L'INSTANT où il tombe.
      // L'ÉTAT vient de l'appelant, comme la cime, et pour la MÊME raison : un pin chargé
      // de neige perdrait sa coiffe à l'instant où il tombe, et un feuillu nu reverdirait.
      .image(px, py - ancrageHouppierPx(m), cleHouppier(variante.slug, lit, cime, etat, 0, miroir))
      .setOrigin(0.5, 1)
      .setDepth(ySortDepth(py / TILE_PX, TILE_PX, TIE_CLUTTER))
    houppier.setLighting(lit)
    this.chutes.push({ fut, houppier, px, py, alpha, ancrage: ancrageHouppierPx(m), ne: now })
  }

  update(now: number): void {
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      const c = this.chutes[i]!
      const age = now - c.ne
      if (age >= VIE_MS) {
        c.fut.destroy()
        c.houppier?.destroy()
        this.chutes.splice(i, 1)
        continue
      }
      const a = c.alpha * courbeChute(age / CHUTE_MS)
      c.fut.setRotation(a)
      // Le houppier est planté à `ancrage` le long du fût : il suit donc l'ARC de ce point,
      // et tourne du même angle. C'est la seule façon qu'il reste accroché à son tronc —
      // le déplacer en ligne droite le décrocherait dès les premiers degrés.
      if (c.houppier) {
        const hx = c.px + Math.sin(a) * c.ancrage
        const hy = c.py - Math.cos(a) * c.ancrage
        c.houppier.setPosition(hx, hy).setRotation(a)
        c.houppier.setDepth(ySortDepth(hy / TILE_PX, TILE_PX, TIE_CLUTTER))
      }
      // Il reste COUCHÉ un instant avant que la forêt le reprenne : c'est ce temps d'arrêt
      // qui fait lire « il est tombé » plutôt que « il a disparu en tournant ».
      const restant = VIE_MS - age
      const opacite = restant >= FONDU_MS ? 1 : restant / FONDU_MS
      c.fut.setAlpha(opacite)
      c.houppier?.setAlpha(opacite)
    }
  }

  /** Sonde du smoke : combien d'arbres tombent à cette image. */
  get vivants(): number {
    return this.chutes.length
  }

  destroy(): void {
    for (const c of this.chutes) {
      c.fut.destroy()
      c.houppier?.destroy()
    }
    this.chutes.length = 0
  }
}
