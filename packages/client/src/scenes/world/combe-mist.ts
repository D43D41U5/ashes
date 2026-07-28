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
import { DIST_FIELD_MAX, MIST_DEPTH, MistLayer } from './mist-layer'

const DENSITE = 0.2
/** Le halo permanent : plateau plein ~1,5 tuile au-delà de l'empreinte, puis la rampe de
 *  2,5 tuiles du shader — regardé à 23h : à 2,5 le rectangle se devinait encore. */
const FRONT_COMBE = 4
/** Le vent de la combe : le quart de celui du monde — un creux garde son air. */
const VENT_FACTEUR = 0.25
/** Vitesse de dérive de base (tuiles/s), comme la matinale, avant le facteur du creux. */
const DERIVE = 0.32

export class CombeMist {
  private layer: MistLayer | null = null
  private readonly key = 'combe-mist-mask'

  constructor(scene: Phaser.Scene, map: WorldMap) {
    const combe = map.zones.find((z) => z.kind === 'combe_brumeuse')
    if (!combe) return
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
    this.layer = new MistLayer(scene, this.key, width, height, MIST_DEPTH + 0.01)
  }

  update(nowMs: number, vent: { x: number; y: number }, day = 1): void {
    const w = { x: vent.x * DERIVE * VENT_FACTEUR, y: vent.y * DERIVE * VENT_FACTEUR }
    this.layer?.update(nowMs, DENSITE, FRONT_COMBE, w, day)
  }

  destroy(): void {
    this.layer?.destroy()
    this.layer = null
  }
}
