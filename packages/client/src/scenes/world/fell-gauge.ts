/**
 * LA JAUGE D'ABATTAGE — le geste à maîtrise se VOIT (spec recolte-maitrise, verbe 1).
 *
 * Le clic maintenu sur un arbre EMPLIT une jauge ; relâcher dans le VERT sort le coup
 * PROPRE. La sim COMPTE (`Entity.harvestCharge.ticks`), le client ne fait que DESSINER
 * `ticks / FELL_CHARGE_MAX_TICKS` — pur miroir, il n'invente ni la position du vert ni
 * son jugement (recolte-maitrise C3). Le vert est FIXE ; sa largeur croît avec
 * `woodcutting` (`fellGreenWidth`) — la maîtrise l'élargit jusqu'à l'autopilote.
 *
 * On peint la jauge de QUICONQUE charge (comme le télégraphe de charge du combat) :
 * SOUS son arbre, centrée, le vert dimensionné par SON niveau. Rien n'est décidé ici —
 * la sim tranche le coup au relâchement (invariant §3).
 *
 * RENDU EN ESPACE-MONDE (comme le télégraphe de combat `attack-fx`) : on POSITIONNE
 * l'objet Graphics à la base monde de l'arbre et on dessine en local — la caméra applique
 * scroll + zoom sans décalage (un calcul monde→écran manuel lit `worldView`, qui retarde
 * d'une frame et ripe dès que la caméra bouge). Positionner l'objet sur une tuile visible
 * évite aussi tout culling. La barre suit donc le zoom : ses tailles sont en px MONDE.
 */
import { BALANCE, fellGreenWidth, type ResourceNode } from '@braises/sim'
import { tileFeetAnchor, OVERLAY_DEPTH, TILE_PX } from '../../render/framing'
import type { Warp } from '../../render/warp'
import type Phaser from 'phaser'

/** Une charge d'abattage en cours, lue du snapshot. `level` = niveau `woodcutting`
 *  de celui qui charge (il dimensionne le vert). */
export interface FellCharge {
  nodeId: number
  ticks: number
  level: number
}

/** Tailles en px MONDE (le zoom caméra les agrandit — ~×2.25 au cadrage courant). */
const BAR_W = 38
const BAR_H = 5
/** Décalage sous la base du tronc, en px monde. */
const BELOW_WORLD = 3

const TRACK = 0x3d3d47
const FRAME = 0x0d0d12
const GREEN = 0x8ef06a
const AMBER = 0xf2c65a
const HEAD = 0xfffbe8

export class FellGauge {
  private readonly g: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(OVERLAY_DEPTH)
  }

  update(charges: readonly FellCharge[], nodes: readonly ResourceNode[], warp: Warp | undefined): void {
    this.g.clear()
    const max = BALANCE.FELL_CHARGE_MAX_TICKS
    for (const c of charges) {
      const node = nodes.find((n) => n.id === c.nodeId)
      if (node === undefined) continue

      // On POSITIONNE l'objet à la base MONDE de l'arbre (pieds − relief) et on dessine
      // en LOCAL autour de (0,0) : la caméra transforme (scroll + zoom) sans décalage —
      // et un objet positionné à une tuile visible n'est jamais culé (comme un sprite).
      const a = tileFeetAnchor(node.tx, node.ty, TILE_PX)
      const baseWorldY = a.py - (warp?.lift(node.tx + 0.5, node.ty + 1) ?? 0)
      this.g.setPosition(a.px, baseWorldY + BELOW_WORLD)

      const x = -BAR_W / 2
      const y = 0

      // Cadre + piste.
      this.g.fillStyle(FRAME, 0.9).fillRect(x - 1, y - 1, BAR_W + 2, BAR_H + 2)
      this.g.fillStyle(TRACK, 1).fillRect(x, y, BAR_W, BAR_H)

      // LE VERT (la cible), à sa place FIXE, large selon le niveau.
      const gx = x + (BALANCE.FELL_GREEN_START_TICKS / max) * BAR_W
      const gw = Math.max(1, (fellGreenWidth(c.level) / max) * BAR_W)
      this.g.fillStyle(GREEN, 0.95).fillRect(gx, y, gw, BAR_H)

      // LE REMPLISSAGE (ambre translucide, laisse voir le vert) + la TÊTE vive.
      const fillW = Math.min(1, c.ticks / max) * BAR_W
      this.g.fillStyle(AMBER, 0.5).fillRect(x, y, fillW, BAR_H)
      this.g.fillStyle(HEAD, 1).fillRect(x + fillW - 1, y - 1, 2, BAR_H + 2)
    }
  }

  destroy(): void {
    this.g.destroy()
  }
}
