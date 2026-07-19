/**
 * LA LUEUR DU BON FLANC — le point faible du minage se VOIT (spec recolte-maitrise, verbe 2).
 *
 * Le point faible d'un rocher est l'un de ses QUATRE FLANCS (0=haut,1=droite,2=bas,3=gauche),
 * seedé et RECALCULÉ à l'identique par le client (`mineGoodFlank`, pure fonction de nodeId +
 * stock — C3). On peint une lueur sur le bon flanc de chaque nœud de minage à portée : le
 * joueur y pose son curseur pour frapper propre. `mining` fait luire PLUS FORT (le novice
 * piétine, l'expert voit d'emblée — M3) et ÉCLAIRE AUSSI les flancs voisins ACCEPTÉS quand la
 * tolérance grandit (`mineTolerance`) — la lueur dit exactement ce que la sim admettra.
 *
 * LA LUEUR PORTE LE TEMPO (décision d'Alexis) : plutôt qu'un cooldown INVISIBLE qui rejette,
 * le point faible se CONSOMME au coup (terne, petit) puis se REFORME sur le rechargement,
 * BRILLANT quand on peut refrapper. Le joueur lit la lueur pour savoir QUAND frapper — le
 * geste et le visuel donnent la cadence, pas un timer caché. `readiness` ∈ [0,1] (0 = juste
 * frappé, 1 = prêt) vient du temps écoulé depuis le dernier coup (horloge client).
 *
 * Rendu en espace-monde (objet positionné au nœud, dessin local) — même patron que la jauge
 * d'abattage, pour les mêmes raisons (pas de calcul écran manuel, pas de culling).
 */
import { BALANCE, NODE_DEFS, mineGoodFlank, mineTolerance, type ResourceNode } from '@braises/sim'
import { OVERLAY_DEPTH, TILE_PX } from '../../render/framing'
import type { Warp } from '../../render/warp'
import type Phaser from 'phaser'

/** Décalage du pip depuis le centre du nœud, vers le bord de chaque flanc (px monde). */
const EDGE = 0.42 * TILE_PX
const FLANK_OFFSET = [
  { dx: 0, dy: -EDGE }, // 0 haut
  { dx: EDGE, dy: 0 }, // 1 droite
  { dx: 0, dy: EDGE }, // 2 bas
  { dx: -EDGE, dy: 0 }, // 3 gauche
]

const BACK = 0x120a02 // liseré sombre : le pip lit sur un fond CLAIR (neige) autant que sombre
const GLOW = 0xffc74d // halo ambre
const CORE = 0xffe9a0 // cœur du bon flanc
const NEIGHBOUR = 0xd8b25a // voisin admis, plus terne

/** Distance circulaire entre deux flancs sur le cycle 0..3 (0, 1 ou 2). */
function circDist(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 4 - d)
}

export class FlankGlow {
  private readonly g: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(OVERLAY_DEPTH - 1)
  }

  update(
    nodes: readonly ResourceNode[],
    player: { x: number; y: number },
    level: number,
    readiness: number,
    time: number,
    warp: Warp | undefined,
  ): void {
    this.g.clear()
    const rangeSq = BALANCE.INTERACT_RANGE * BALANCE.INTERACT_RANGE
    const tol = mineTolerance(level)
    // LE TEMPO : `grow` monte de ~0 (juste frappé) à 1 (prêt) ; à plein, un souffle lent
    // (`pulse`) dit « frappe ». `sin` est du rendu — permis hors /sim.
    const grow = Math.max(0, Math.min(1, readiness))
    const ready = grow >= 1
    const pulse = ready ? 0.85 + 0.15 * Math.sin(time / 150) : 1
    for (const node of nodes) {
      if (node.stock <= 0 || NODE_DEFS[node.type].skill !== 'mining') continue
      const cxT = node.tx + 0.5
      const cyT = node.ty + 0.5
      if ((cxT - player.x) ** 2 + (cyT - player.y) ** 2 > rangeSq) continue

      const good = mineGoodFlank(node.id, node.stock)
      const lift = warp?.lift(cxT, node.ty + 1) ?? 0
      const ox = cxT * TILE_PX
      const oy = cyT * TILE_PX - lift

      for (let f = 0; f < 4; f++) {
        const isGood = f === good
        if (!isGood && circDist(f, good) > tol) continue // seulement le bon + les voisins ADMIS
        const px = ox + FLANK_OFFSET[f]!.dx
        const py = oy + FLANK_OFFSET[f]!.dy
        // Le bon flanc luit plus fort AVEC le niveau (M3), et se REFORME sur le tempo :
        // terne/petit quand `grow` est bas, plein et pulsé quand c'est prêt.
        const alphaMax = isGood ? 0.6 + Math.min(0.4, level * 0.08) : 0.4
        const alpha = alphaMax * (0.18 + 0.82 * grow) * pulse
        const r = (isGood ? 3.2 : 2.2) * (0.65 + 0.35 * grow)
        this.g.fillStyle(BACK, 0.5 * (0.4 + 0.6 * grow)).fillCircle(px, py, r + 2.2) // liseré sombre
        this.g.fillStyle(GLOW, alpha * 0.6).fillCircle(px, py, r + 1) // halo ambre
        this.g.fillStyle(isGood ? CORE : NEIGHBOUR, alpha).fillCircle(px, py, r) // cœur
        // PRÊT : un anneau sur le bon flanc claque « frappe maintenant ».
        if (ready && isGood) {
          this.g.lineStyle(1.2, CORE, 0.55 * pulse)
          this.g.strokeCircle(px, py, r + 2.5)
        }
      }
    }
  }

  destroy(): void {
    this.g.destroy()
  }
}
