/**
 * LA BRUME DE LA COMBE — le set-piece humide a son air (spec t0-exploration R9, R16).
 *
 * Une nappe au sol, QUANTIFIÉE à la grille de l'art (grain 4 px, NEAREST — règle projet : les
 * FX de lumière et d'air ne se lissent jamais), posée sur l'empreinte de la Combe brumeuse.
 * Elle RESPIRE par l'alpha (jamais par la taille), lentement, sur l'horloge Phaser.
 *
 * Sous les pieds des acteurs (au ras du sol, au-dessus de la cendre) : une brume de fond de
 * combe, pas un nuage. Le rideau se lève à peine — c'est l'endroit qui est humide, pas l'écran.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import type { Warp } from '../../render/warp'

const GRAIN = 4 // px de la grille d'art : la brume est faite de pavés, pas de dégradés
const TEINTE = { r: 206, g: 216, b: 214 } // un gris d'eau froide, à peine vert
const ALPHA_BAS = 0.1
const ALPHA_HAUT = 0.2
const RESPIRATION_MS = 5200

export class CombeMist {
  private img: Phaser.GameObjects.Image | null = null
  private tween: Phaser.Tweens.Tween | null = null
  private readonly key = 'combe-mist'

  constructor(scene: Phaser.Scene, map: WorldMap, warp: Warp) {
    const combe = map.zones.find((z) => z.kind === 'combe_brumeuse')
    if (!combe) return

    // La nappe : un canvas au grain, des PLAQUES d'alpha décidées par hash positionnel — le
    // même vocabulaire que le marais de la génération (des plaques, pas des confettis).
    const wPx = combe.w * TILE_PX
    const hPx = combe.h * TILE_PX
    const cols = Math.ceil(wPx / GRAIN)
    const rows = Math.ceil(hPx / GRAIN)
    const cv = document.createElement('canvas')
    cv.width = cols
    cv.height = rows
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(cols, rows)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        // LA PLAQUE SE DÉCIDE EN GROS (4×4 cellules = 16 px), PAS PAR CELLULE — et le hash a une
        // vraie avalanche. La première écriture combinait deux imul affines par cellule : d'une
        // cellule à la suivante la valeur avançait d'un pas quasi constant (mod 1), et la nappe
        // rendait un DAMIER moiré (mesuré par la revue : runs moyens de 2,3 cellules). Des
        // confettis, exactement ce que le module promettait d'éviter.
        let h = (Math.imul(i >> 2, 0x9e3779b1) ^ Math.imul(j >> 2, 0x85ebca6b)) >>> 0
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
        h = (h ^ (h >>> 13)) >>> 0
        const plaque = (h & 0xff) / 255
        // Le bord de la nappe s'effrange en pavés : plus on approche du bord, plus les plaques
        // se raréfient — une frange en marches, jamais un dégradé (le bord se juge PAR cellule :
        // les plaques du pourtour s'écornent une cellule à la fois).
        const bord = Math.min(i, cols - 1 - i, j, rows - 1 - j) / Math.min(cols, rows)
        const dense = plaque < 0.35 + 1.4 * Math.min(0.25, bord)
        const o = (j * cols + i) * 4
        img.data[o] = TEINTE.r
        img.data[o + 1] = TEINTE.g
        img.data[o + 2] = TEINTE.b
        img.data[o + 3] = dense ? 255 : 0
      }
    }
    ctx.putImageData(img, 0, 0)
    // Une nouvelle Veillée re-monte la scène : la texture du monde précédent traîne encore
    // dans le TextureManager (il survit aux scènes) — on la remplace, on n'empile pas.
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key)
    scene.textures.addCanvas(this.key, cv)
    scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)

    const cx = combe.x + combe.w / 2
    const cy = combe.y + combe.h / 2
    this.img = scene.add
      .image(cx * TILE_PX, cy * TILE_PX - warp.lift(cx, cy), this.key)
      .setScale(GRAIN)
      .setAlpha(ALPHA_BAS)
      .setDepth(GROUND_MAP_DEPTH + 0.3) // au ras du sol : au-dessus de la cendre, sous les pieds

    // La respiration : l'ALPHA oscille, la taille jamais (règle projet des FX).
    this.tween = scene.tweens.add({
      targets: this.img,
      alpha: ALPHA_HAUT,
      duration: RESPIRATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  destroy(): void {
    this.tween?.stop()
    this.img?.destroy()
    this.img = null
  }
}
