/**
 * LA FLAQUE DE LA TORCHE — la lumière qu'un porteur jette à ses pieds.
 *
 * MÊME RECETTE QUE CELLE DU FEU (`fire-ground-glow.ts`) : une texture radiale PIXELLISÉE, un
 * texel par cellule de 4 px monde, NEAREST, additive, posée à plat sous ce qui a des pieds.
 * Et pour la MÊME raison décisive : **le sol n'est pas sur la pipeline Light2D** — mesuré, un
 * point light ne lui apporte que ~+8 de rouge. Le point light de la torche allume les fûts et
 * les corps ; c'est cette flaque, et le trou du voile, qui mettent la TERRE en lumière.
 *
 * TROIS DIFFÉRENCES AVEC CELLE DU FEU, et elles disent ce qu'est une torche :
 *   • ELLE SUIT UN CORPS. La flaque du Feu est plantée sur une tuile pour toujours — donc sur
 *     un multiple de 2 px monde, pile sur la grille de l'art. Celle-ci se repositionne chaque
 *     image sur la position INTERPOLÉE du porteur, qui est un FLOTTANT quelconque.
 *
 *     ⚠ ON A CRU DEVOIR LA QUANTIFIER SUR `LIGHT_PX`, ET LA MESURE DIT NON. La crainte était le
 *     grouillement : des texels qui se recomposeraient d'une image à l'autre au lieu de glisser.
 *     Or un texel de lumière mesure `LIGHT_PX × zoom` pixels d'écran, et le zoom du jeu se
 *     dérive du cadrage (`zoomForFraming` : hauteur / (20 × 16)) — RELEVÉ dans le vrai jeu à
 *     1280×800 : zoom 2,25, soit **9 px d'écran par texel, un entier**. Les texels ont donc tous
 *     la même largeur, et déplacer le sprite d'un sous-texel décale TOUTES ses frontières de la
 *     MÊME fraction : c'est un glissement d'ensemble, pas un battement interne. (Et le facteur
 *     est le même pour la flaque du Feu et celle des lucioles — il n'y a pas ici de classe
 *     d'artefact que la torche introduirait.)
 *
 *     Quantifier aurait ÉCHANGÉ ce glissement contre un à-coup de 9 px d'écran, sur la seule
 *     lumière accrochée à une main qui marche. On ne quantifie donc pas. Ce qui doit rester
 *     stable, c'est la TAILLE (le rayon ne vacille jamais : la leçon de `fire-ground-glow` —
 *     un disque qui respire, LUI, fait bien grouiller ses carrés, parce qu'il les RÉÉCHELONNE).
 *
 *     ⚠ CE QUI RESTE OUVERT, et qu'on n'a pas mesuré : `LIGHT_PX × zoom` n'est entier que si la
 *     hauteur de fenêtre est un multiple de 80. Hors de ces hauteurs, les frontières de texel
 *     s'arrondissent inégalement — pour les TROIS flaques à la fois, pas pour celle-ci seule.
 *   • ELLE EST LARGE ET FAIBLE — `TORCHE_POOL_TILES` 6 depuis le 2026-08-26 (elle valait 3),
 *     pour un alpha divisé par deux. La torche porte plus loin qu'avant, mais elle ne monte
 *     jamais au niveau d'un foyer (voir l'en-tête de `render/torche.ts`).
 *   • ELLE AGONISE. `forceDeTorche` porte la nuit, le vacillement ET la mort de la flamme :
 *     la flaque faiblit avant de s'éteindre, et le joueur voit venir le noir.
 *
 * AUCUNE logique de jeu — pure ambiance, comme ses deux sœurs.
 */
import Phaser from 'phaser'
import { FIRE_GROUND_DEPTH, TILE_PX } from '../../render/framing'
import { TORCHE_POOL_TILES, forceDeTorche } from '../../render/torche'

/** Un porteur de torche à l'image : où il est, et où en est sa flamme. */
export interface PorteurDeTorche {
  id: number
  /** Position MONDE en pixels (interpolée — pas la tuile : une torche suit les pas). */
  x: number
  y: number
  /** `partDeFlamme` du slot tenu : 1 neuve → 0 morte. */
  part: number
}

/** Le PIXEL DE LUMIÈRE : 4×4 px monde — la MÊME grille que les deux autres flaques et que l'art. */
const LIGHT_PX = 4
const POOL_RADIUS_CELLS = (TORCHE_POOL_TILES * TILE_PX) / LIGHT_PX
const TEX_SIDE = POOL_RADIUS_CELLS * 2 + 1
/** Le cœur : l'ambre clair d'un fagot qui flambe. */
const CORE_COLOR: readonly [number, number, number] = [0xff, 0xc8, 0x74]
/** Le bord : le même ambre, plus profond et pauvre en bleu — il fond dans le noir sans délaver. */
const EDGE_COLOR: readonly [number, number, number] = [0xe0, 0x6c, 0x1c]
/** Gain d'alpha, calé loin SOUS celui du Feu (0,75) : une torche est une flamme de la taille
 *  d'un poing, pas un foyer. Elle ne doit jamais laver la terre en beige.
 *  DIVISÉ PAR DEUX le 2026-08-26 (0,55 → 0,28) en échange du rayon doublé : à surface
 *  quadruplée, garder l'alpha aurait fait de la flaque une clairière beige de six tuiles. */
const GLOW_ALPHA_SCALE = 0.28

const TEX_KEY = 'fx-torche-ground'
function ensureTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_KEY)) return
  const tex = scene.textures.createCanvas(TEX_KEY, TEX_SIDE, TEX_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(TEX_SIDE, TEX_SIDE)
  for (let j = 0; j < TEX_SIDE; j++) {
    for (let i = 0; i < TEX_SIDE; i++) {
      const dx = i - POOL_RADIUS_CELLS
      const dy = j - POOL_RADIUS_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / POOL_RADIUS_CELLS) // 0 centre → 1 bord
      const s = 1 - t
      const a = s * s * (3 - 2 * s) // smoothstep : plein au centre, 0 doux au bord
      const ct = t * t // le cœur tient plus longtemps → une vraie tache chaude sous les pieds
      const k = (j * TEX_SIDE + i) * 4
      img.data[k] = Math.round(CORE_COLOR[0] + (EDGE_COLOR[0] - CORE_COLOR[0]) * ct)
      img.data[k + 1] = Math.round(CORE_COLOR[1] + (EDGE_COLOR[1] - CORE_COLOR[1]) * ct)
      img.data[k + 2] = Math.round(CORE_COLOR[2] + (EDGE_COLOR[2] - CORE_COLOR[2]) * ct)
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(TEX_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

export class TorcheGroundGlow {
  private glows = new Map<number, Phaser.GameObjects.Image>()

  constructor(private scene: Phaser.Scene) {
    ensureTexture(scene)
  }

  /** Réconcilie une flaque par porteur, la déplace sur ses pas et la fait agoniser avec sa flamme. */
  update(porteurs: PorteurDeTorche[], day: number, now: number): void {
    const seen = new Set<number>()
    for (const p of porteurs) {
      const force = forceDeTorche(p.part, day, now, p.id * 2.3)
      // Force nulle (plein jour, flamme morte) → on saute : la réconciliation détruit la flaque.
      if (force <= 0) continue
      seen.add(p.id)
      let glow = this.glows.get(p.id)
      if (!glow) {
        glow = this.scene.add
          .image(p.x, p.y, TEX_KEY)
          .setOrigin(0.5, 0.5)
          .setDepth(FIRE_GROUND_DEPTH)
          .setBlendMode('ADD')
          .setDisplaySize(TEX_SIDE * LIGHT_PX, TEX_SIDE * LIGHT_PX) // 1 texel = 4 px monde
        this.glows.set(p.id, glow)
      }
      glow.setPosition(p.x, p.y)
      glow.setAlpha(Math.min(1, force * GLOW_ALPHA_SCALE))
    }
    for (const [id, glow] of this.glows) {
      if (seen.has(id)) continue
      glow.destroy()
      this.glows.delete(id)
    }
  }

  destroy(): void {
    for (const glow of this.glows.values()) glow.destroy()
    this.glows.clear()
  }
}
