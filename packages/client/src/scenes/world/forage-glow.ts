/**
 * LA LUEUR DES BONS COINS — la maîtrise de cueillette se VOIT (spec recolte-maitrise, verbe 3).
 *
 * Cueillir est un geste NU (rien à viser). La maîtrise vit DANS LE MONDE : chaque coin porte
 * une RICHESSE seedée (`forageRichness`, pure fonction du nodeId — C3), et un `foraging` haut
 * fait LUIRE les bons coins que le novice voit tous pareils. On peint une étincelle au-dessus
 * des plantes RICHES, À DISTANCE (perception, pas portée de bras) — « l'herboriste voit ce que
 * le novice piétine ». Un gain de TRAJET : on sait où aller, pas un accès exclusif.
 *
 * RENDU GATÉ CÔTÉ CLIENT (P3, fuite assumée) : la révélation dépend du niveau `foraging` LOCAL
 * (`forageRevealed`) — rien sous le seuil, pas de snapshot par joueur. Espace-monde (objet
 * positionné au nœud, dessin local) — même patron que les autres lueurs.
 */
import { BALANCE, NODE_DEFS, forageRevealed, forageRichness, type ResourceNode } from '@braises/sim'
import { OVERLAY_DEPTH, TILE_PX } from '../../render/framing'
import type { Warp } from '../../render/warp'
import type Phaser from 'phaser'

/** On repère les bons coins À DISTANCE — la perception porte plus loin que le bras. */
const VISION_TILES = 11
/** L'étincelle flotte au-dessus de la plante. */
const LIFT_WORLD = TILE_PX * 1.4

const BACK = 0x0d1405 // liseré sombre : lisible sur terrain vert
const GLOW = 0xa6e85a // halo vert-tendre (herboristerie)
const CORE = 0xecffc4 // cœur clair

export class ForageGlow {
  private readonly g: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(OVERLAY_DEPTH - 1)
  }

  update(
    nodes: readonly ResourceNode[],
    player: { x: number; y: number },
    level: number,
    time: number,
    warp: Warp | undefined,
  ): void {
    this.g.clear()
    if (level < BALANCE.FORAGE_REVEAL_LEVEL) return // le novice voit uniforme — rien ne luit
    const visSq = VISION_TILES * VISION_TILES
    const breathe = 0.78 + 0.22 * Math.sin(time / 380) // un souffle lent attire l'œil (rendu — `sin` permis)
    for (const node of nodes) {
      if (node.stock <= 0 || NODE_DEFS[node.type].skill !== 'foraging') continue
      const richness = forageRichness(node.id)
      if (!forageRevealed(level, richness)) continue
      const cxT = node.tx + 0.5
      const cyT = node.ty + 0.5
      if ((cxT - player.x) ** 2 + (cyT - player.y) ** 2 > visSq) continue

      const lift = (warp?.lift(cxT, node.ty + 1) ?? 0) + LIFT_WORLD
      const x = cxT * TILE_PX
      const y = cyT * TILE_PX - lift
      // Plus le coin est riche, plus vif ; le souffle module l'ensemble.
      const richFactor = Math.min(
        1,
        (richness - BALANCE.FORAGE_RICH_THRESHOLD) / (BALANCE.FORAGE_RICHNESS_MAX - BALANCE.FORAGE_RICH_THRESHOLD),
      )
      const a = (0.42 + 0.48 * richFactor) * breathe
      const r = 2 + 1.2 * richFactor
      this.g.fillStyle(BACK, 0.45 * breathe).fillCircle(x, y, r + 2.4) // liseré sombre
      this.g.fillStyle(GLOW, a * 0.4).fillCircle(x, y, r + 1.2) // halo
      this.g.fillStyle(CORE, a).fillCircle(x, y, r) // étincelle
    }
  }

  destroy(): void {
    this.g.destroy()
  }
}
