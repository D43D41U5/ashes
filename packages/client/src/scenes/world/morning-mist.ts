/**
 * LA BRUME DU MATIN — elle NAÎT DE L'EAU, et elle MARCHE (spec da-feeling R13-R14).
 *
 * Le MASQUE (où la brume a le droit d'exister) : les tuiles d'eau et de marais, DILATÉES de
 * quelques tuiles — la brume déborde sur les berges. La Combe brumeuse en est ÉVIDÉE : elle
 * garde SA brume permanente (son identité), on ne double pas l'alpha.
 *
 * Le RENDU vit dans `mist-layer.ts` (le shader de nappes — retour d'Alexis : « on doit sentir
 * que ça bouge et qu'il y a du volume ») : deux couches qui dérivent au vent, postérisées en
 * crans, des trous, des crêtes claires. Ici on ne garde que le masque et la fenêtre horaire :
 * `brumeDuMatin(hour)` (module lighting, pente continue, testée) fait tout le calendrier.
 */
import Phaser from 'phaser'
import { TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER, type WorldMap } from '@braises/sim'
import { brumeDuMatin } from '../../render/lighting'
import { MIST_DEPTH, MistLayer } from './mist-layer'

/** Plafond de densité à brume pleine — la crête du shader monte à 1,2× ceci. */
const DENSITE_MAX = 0.3
/** Dilatation du masque d'eau/marais, en tuiles : la brume déborde sur les berges. */
const DILATE = 4

export class MorningMist {
  private layer: MistLayer | null = null
  private readonly key = 'morning-mist-mask'

  constructor(scene: Phaser.Scene, map: WorldMap) {
    const { width, height, terrain } = map
    const humide = (t: number): boolean =>
      t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER || t === TERRAIN_MARSH || t === TERRAIN_REED_MARSH

    // ── Le masque humide, dilaté (deux passes séparables : horizontale puis verticale) ──
    const m0 = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) if (humide(terrain[i]!)) m0[i] = 1
    const m1 = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      let compte = 0
      for (let x = -DILATE; x < width; x++) {
        if (x + DILATE < width && m0[y * width + x + DILATE]) compte++
        if (x - DILATE - 1 >= 0 && m0[y * width + x - DILATE - 1]) compte--
        if (x >= 0 && compte > 0) m1[y * width + x] = 1
      }
    }
    const m2 = new Uint8Array(width * height)
    for (let x = 0; x < width; x++) {
      let compte = 0
      for (let y = -DILATE; y < height; y++) {
        if (y + DILATE < height && m1[(y + DILATE) * width + x]) compte++
        if (y - DILATE - 1 >= 0 && m1[(y - DILATE - 1) * width + x]) compte--
        if (y >= 0 && compte > 0) m2[y * width + x] = 1
      }
    }

    // ── La Combe garde sa brume à elle : on évide son empreinte (+2 tuiles de marge) ──
    const combe = map.zones.find((z) => z.kind === 'combe_brumeuse')
    if (combe) {
      for (let y = Math.max(0, combe.y - 2); y < Math.min(height, combe.y + combe.h + 2); y++) {
        for (let x = Math.max(0, combe.x - 2); x < Math.min(width, combe.x + combe.w + 2); x++) {
          m2[y * width + x] = 0
        }
      }
    }

    // ── Le masque en texture (1 px/tuile, NEAREST — le shader lit le canal R) ──
    const cv = document.createElement('canvas')
    cv.width = width
    cv.height = height
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      if (!m2[i]) continue
      img.data[i * 4] = 255
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key)
    scene.textures.addCanvas(this.key, cv)
    scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)

    this.layer = new MistLayer(scene, this.key, width, height, MIST_DEPTH)
  }

  /** Chaque frame : l'heure décide (pente continue), le vent du monde porte les nappes. */
  update(nowMs: number, hour: number, wind?: { x: number; y: number }): void {
    const densite = DENSITE_MAX * brumeDuMatin(hour)
    // Le vent du monde (px/s des particules) ramené à des tuiles/s de nappe, avec un fond de
    // dérive : une brume parfaitement immobile est une image — c'est ce qu'on a jugé et rejeté.
    const w = wind ? { x: 0.3 + wind.x * 0.02, y: 0.1 + wind.y * 0.02 } : undefined
    this.layer?.update(nowMs, densite, w)
  }

  destroy(): void {
    this.layer?.destroy()
    this.layer = null
  }
}
