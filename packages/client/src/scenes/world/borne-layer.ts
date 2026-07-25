/**
 * LES BORNES DE SEUIL — le seuil s'ANNONCE (worldgen R21, spec t0-exploration R4).
 *
 * Avant : la porte se trouvait en longeant le mur — un beau geste de design, mais le mur qu'on
 * longe avait le charisme d'un grillage, et rien ne signalait la porte à plus d'un écran. Deux
 * BORNES de pierre dressées flanquent désormais chaque couloir de seuil, plantées dans la roche
 * des flancs, et leur tête PERCE la canopée (même mécanique de couronne que les lieux) : on voit
 * la porte venir de loin, on marche vers elle. *Le monde prévient, il ne guide pas* — aucune
 * règle de jeu, du décor, gratuit.
 *
 * Les bornes d'un seuil de SECOURS sont BRISÉES : le second passage est toujours pire (R11), et
 * ça se voit d'abord à ses portiques décapités.
 *
 * Données : `map.seuils` (spec t0-exploration R20) — position, axe de traversée, drapeau
 * secours. Tout est dérivé, rien n'est deviné par les noms.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { crownDepth, TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import type { Warp } from '../../render/warp'

/** Écart latéral borne↔centre du couloir, en tuiles : la demi-largeur du couloir + 2 — les
 *  bornes se plantent contre les flancs, comme des montants de porte. Le couloir d'un SECOURS
 *  est plus étroit (demi-largeur 4, `RELIEF.DEMI_LARGEUR_SECOURS`) : ses bornes se resserrent
 *  d'autant, sinon les pierres brisées flottent à cinq tuiles du défilé qu'elles annoncent. */
const ECART_TUILES = 9
const ECART_SECOURS_TUILES = 6

const STONE = { lit: 0xb4ada1, mid: 0x8d867b, dark: 0x605a51, deep: 0x3e3a34 }
const SHADOW = 0x000000

const W = 22
const H = 74
const H_BRISEE = 46
const CROWN = 34

export const BORNE_KEY = 'seuil-borne'
export const BORNE_BRISEE_KEY = 'seuil-borne-brisee'
const crownKey = (key: string): string => `${key}-crown`

/** Peint les deux bornes (entière, brisée) et leurs couronnes. À appeler au boot. */
export function makeBorneTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()

  const pilier = (b: number, brisee: boolean): void => {
    const c = W / 2
    g.fillStyle(SHADOW, 0.26).fillEllipse(c + 1, b - 2, W * 0.9, 7) // l'ombre qui ancre
    // Le socle : deux marches grossières.
    g.fillStyle(STONE.dark).fillRect(c - 9, b - 8, 18, 7)
    g.fillStyle(STONE.mid).fillRect(c - 7, b - 12, 14, 5)
    // Le fût : un monolithe dressé, arêtes franches.
    const haut = brisee ? b - (H_BRISEE - 6) : b - (H - 12)
    g.fillStyle(STONE.mid).fillRect(c - 5, haut, 10, b - 10 - haut)
    g.fillStyle(STONE.lit).fillRect(c - 5, haut, 3, b - 10 - haut) //  la lumière au NO
    g.fillStyle(STONE.deep).fillRect(c + 2, haut + 2, 3, b - 12 - haut) // l'ombre au SE
    if (brisee) {
      // LA CASSURE : un chicot en biais — le portique décapité du second passage.
      // (Apex à haut−5 : haut vaut 6 sur la texture brisée, un −7 sortait du canvas d'un pixel.)
      g.fillStyle(STONE.mid).fillTriangle(c - 5, haut, c + 5, haut, c - 2, haut - 5)
      g.fillStyle(STONE.dark).fillRect(c + 4, b - 14, 7, 5) // le tronçon tombé au pied
    } else {
      // LE CHAPEAU : une dalle posée en tête — la silhouette qui se lit à contre-jour.
      g.fillStyle(STONE.dark).fillRect(c - 8, haut - 6, 16, 7)
      g.fillStyle(STONE.lit).fillRect(c - 8, haut - 6, 16, 2)
    }
  }

  g.clear()
  pilier(H, false)
  g.generateTexture(BORNE_KEY, W, H)
  g.generateTexture(crownKey(BORNE_KEY), W, CROWN) // la tête, redessinée au-dessus des houppiers
  g.clear()
  pilier(H_BRISEE, true)
  g.generateTexture(BORNE_BRISEE_KEY, W, H_BRISEE)
  g.destroy()
}

export class BorneLayer {
  private readonly sprites: Phaser.GameObjects.Image[] = []

  constructor(scene: Phaser.Scene, map: WorldMap, warp: Warp) {
    for (const s of map.seuils ?? []) {
      // La perpendiculaire à l'axe de traversée : les deux flancs du couloir.
      const perpX = -s.ay
      const perpY = s.ax
      const ecart = s.secours ? ECART_SECOURS_TUILES : ECART_TUILES
      for (const cote of [-1, 1] as const) {
        const tx = s.x + perpX * ecart * cote + 0.5
        const ty = s.y + perpY * ecart * cote + 1
        const px = tx * TILE_PX
        const py = ty * TILE_PX - warp.lift(tx, ty)
        const key = s.secours ? BORNE_BRISEE_KEY : BORNE_KEY
        const body = scene.add.image(px, py, key).setOrigin(0.5, 1)
        body.setDepth(ySortDepth(ty, TILE_PX, TIE_NODE))
        this.sprites.push(body)
        if (!s.secours) {
          // La tête perce la canopée — même superposition au pixel près que les lieux.
          const crown = scene.add.image(px, py - H, crownKey(BORNE_KEY)).setOrigin(0.5, 0)
          crown.setDepth(crownDepth(ty, TILE_PX))
          this.sprites.push(crown)
        }
      }
    }
  }

  destroy(): void {
    for (const s of this.sprites) s.destroy()
    this.sprites.length = 0
  }
}
