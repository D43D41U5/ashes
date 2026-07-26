/**
 * LA BRUME DE LA COMBE — permanente : c'est l'identité du lieu (spec t0-exploration R9).
 *
 * Même langage que la brume du matin (`mist-layer.ts` — nappes qui dérivent, crans, volume :
 * retour d'Alexis du 25/07), mais SON calendrier à elle : toujours là, plus paresseuse (le
 * creux de la combe retient son air), un peu plus verte (l'eau dormante, pas l'aube froide).
 * Son masque est son empreinte ; la nappe matinale l'évide pour ne pas doubler l'alpha.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { MIST_DEPTH, MistLayer } from './mist-layer'

const DENSITE = 0.2
/** Le vent de la combe : le quart de celui du monde — un creux garde son air. */
const VENT_FACTEUR = 0.25

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
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(width, height)
    for (let y = combe.y; y < combe.y + combe.h; y++) {
      for (let x = combe.x; x < combe.x + combe.w; x++) {
        const o = (y * width + x) * 4
        img.data[o] = 255
        img.data[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key)
    scene.textures.addCanvas(this.key, cv)
    scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.layer = new MistLayer(scene, this.key, width, height, MIST_DEPTH + 0.01)
  }

  update(nowMs: number, wind?: { x: number; y: number }, day = 1): void {
    const w = wind
      ? { x: (0.3 + wind.x * 0.02) * VENT_FACTEUR, y: (0.1 + wind.y * 0.02) * VENT_FACTEUR }
      : { x: 0.09, y: 0.03 }
    this.layer?.update(nowMs, DENSITE, w, day)
  }

  destroy(): void {
    this.layer?.destroy()
    this.layer = null
  }
}
