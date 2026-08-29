/**
 * LA BRUME DE LA COMBE — permanente : c'est l'identité du lieu (spec t0-exploration R9).
 *
 * Même langage que la brume du matin (`mist-layer.ts` — marée, nappes qui dérivent, crans),
 * mais SON calendrier à elle : toujours là, plus paresseuse (le creux de la combe retient son
 * air). Son masque est un champ de distance à son EMPREINTE (0 dedans, croissant dehors) et
 * son front est CONSTANT : un halo de ~2,5 tuiles qui s'effrange autour du rectangle — la
 * coupe au couteau de l'ancien masque binaire meurt ici aussi. La nappe matinale évide la
 * Combe de son propre champ : on ne double pas l'alpha.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'
import { HAUTEUR_NAPPE_PX } from './meteo-layer'
import { DIST_FIELD_MAX, MIST_DEPTH, MistLayer, type ReglageNappe } from './mist-layer'

const DENSITE = 0.2
/** Le halo permanent : plateau plein ~1,5 tuile au-delà de l'empreinte, puis la rampe de
 *  2,5 tuiles du shader — regardé à 23h : à 2,5 le rectangle se devinait encore. */
const FRONT_COMBE = 4
/** Le vent de la combe : le quart de celui du monde — un creux garde son air. */
const VENT_FACTEUR = 0.25
/** Vitesse de dérive de base (tuiles/s), comme la matinale, avant le facteur du creux. */
const DERIVE = 0.32

/**
 * ═══ ELLE AUSSI S'AFFICHE COMME LE BROUILLARD (décision d'Alexis, 2026-08-28) ═══
 *
 * La Combe était le DERNIER film au-dessus des houppiers (`MIST_DEPTH + 0.01`) : un drap qui
 * coiffait le lieu — rien n'y était jamais DEDANS. Elle reprend la pile de bandes de la marée
 * du matin (elle-même reprise du brouillard météo, mesurée au scénario `brouillardsol`) : la
 * brume devient un volume qu'on traverse, et les cimes en sortent.
 *
 * `hauteur` est LA MÊME CONSTANTE que le brouillard et la marée (`HAUTEUR_NAPPE_PX`, dérivée
 * du bouleau) : trois brumes qui promettent « entre le sol et le haut du houppier » doivent le
 * promettre avec le même nombre. Le PAS est celui de la marée (16 px, pas les 12 du
 * brouillard) : à densité 0,2 la Combe est la plus translucide des trois, et un bord de coupe
 * se lit d'autant plus qu'il traverse du translucide.
 */
const NAPPE_COMBE: ReglageNappe = { hauteur: HAUTEUR_NAPPE_PX, bandePx: 16 }

/** Où la brume ATTEINT, en tuiles au-delà de l'empreinte : le plateau du halo (`FRONT_COMBE`)
 *  plus la rampe du shader (2,5 — sa constante `RAMPE`), plus une tuile d'air. Au-delà, chaque
 *  fragment ne ferait que se `discard` — et la Combe est PERMANENTE : sans ce rayon, la pile
 *  couvrirait la vue entière partout sur la carte, à vie. Le film d'avant payait ce vide en un
 *  seul quad ; la pile le paierait en double (chevauchement de moitié) et en 20+ draw calls. */
const PORTEE_TUILES = FRONT_COMBE + 2.5 + 1

export class CombeMist {
  private layer: MistLayer | null = null
  private readonly key = 'combe-mist-mask'
  /** L'empreinte élargie de sa portée, en px monde — le rayon du cull de `update`. */
  private atteinte: { x0: number; y0: number; x1: number; y1: number } | null = null

  constructor(scene: Phaser.Scene, map: WorldMap) {
    const combe = map.zones.find((z) => z.kind === 'combe_brumeuse')
    if (!combe) return
    this.atteinte = {
      x0: (combe.x - PORTEE_TUILES) * TILE_PX,
      y0: (combe.y - PORTEE_TUILES) * TILE_PX,
      x1: (combe.x + combe.w + PORTEE_TUILES) * TILE_PX,
      y1: (combe.y + combe.h + PORTEE_TUILES) * TILE_PX,
    }
    const { width, height } = map
    const cv = document.createElement('canvas')
    cv.width = width
    cv.height = height
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const img = ctx.createImageData(width, height)
    // R = 255 (« loin ») PARTOUT d'un seul geste, puis on ne calcule que le sous-rectangle
    // utile (empreinte + portée du champ) : 4 000 cellules au lieu de 3,75 M (revue, ×1600).
    img.data.fill(255)
    const x1 = combe.x + combe.w - 1
    const y1 = combe.y + combe.h - 1
    const marge = DIST_FIELD_MAX + 1
    for (let y = Math.max(0, combe.y - marge); y <= Math.min(height - 1, y1 + marge); y++) {
      for (let x = Math.max(0, combe.x - marge); x <= Math.min(width - 1, x1 + marge); x++) {
        // Distance euclidienne au rectangle (0 dedans) — client : Math.sqrt autorisé.
        const dx = Math.max(combe.x - x, x - x1, 0)
        const dy = Math.max(combe.y - y, y - y1, 0)
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), DIST_FIELD_MAX)
        img.data[(y * width + x) * 4] = Math.round((dist / DIST_FIELD_MAX) * 255)
      }
    }
    ctx.putImageData(img, 0, 0)
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key)
    scene.textures.addCanvas(this.key, cv)
    scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    // Pas de `ReglageCrans` : la Combe garde les crans de la maquette (le défaut de MistLayer).
    // La marée du matin, elle, a le sien depuis le 26/07 — sa transparence ne descend pas ici.
    // Son identité, c'est une brume qui PÈSE — et c'est en pile qu'on la rejuge à l'œil.
    // `MIST_DEPTH` n'est plus qu'un repli : la pile pose sa profondeur dans la bande des houppiers.
    this.layer = new MistLayer(scene, this.key, width, height, MIST_DEPTH + 0.01, undefined, NAPPE_COMBE)
  }

  update(nowMs: number, vent: { x: number; y: number }, day = 1, camera?: Phaser.Cameras.Scene2D.Camera): void {
    const w = { x: vent.x * DERIVE * VENT_FACTEUR, y: vent.y * DERIVE * VENT_FACTEUR }
    // LE CULL : la vue touche-t-elle l'atteinte du halo ? La densité passée à la couche fait
    // foi (`vivante = densite > 0.003` y éteint la pile) — la dérive, elle, s'intègre toujours,
    // pour que la brume ne reparte pas d'un champ figé quand on revient au lieu.
    const a = this.atteinte
    const v = camera?.worldView
    const dehors = !!a && !!v && (v.x > a.x1 || v.x + v.width < a.x0 || v.y > a.y1 || v.y + v.height < a.y0)
    this.layer?.update(nowMs, dehors ? 0 : DENSITE, FRONT_COMBE, w, day, 1, camera)
  }

  destroy(): void {
    this.layer?.destroy()
    this.layer = null
  }
}
