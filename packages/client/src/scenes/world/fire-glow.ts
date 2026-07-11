/**
 * Les halos de lumière des Feux : un sprite additif par structure `fire`, teinté
 * par l'alignement du village et dosé par l'heure (module pur `lighting`). Cycle
 * de vie par diff `seen`, comme les autres sprites de snapshot-view. AUCUNE
 * logique de jeu — pur habillage (spec lumière & ambiance).
 */
import Phaser from 'phaser'
import type { Structure } from '@braises/sim'
import { fireGlow } from '../../render/lighting'
import { GLOW_DEPTH, TILE_PX } from '../../render/framing'
import type { SnapshotMessage } from '../../protocol'

export class FireGlow {
  private sprites = new Map<number, Phaser.GameObjects.Image>()

  constructor(private scene: Phaser.Scene) {}

  /** Réconcilie les halos avec les Feux du snapshot, à l'heure courante (`day`). */
  update(structures: Structure[], villages: SnapshotMessage['villages'], day: number, now: number): void {
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      seen.add(s.id)
      let sprite = this.sprites.get(s.id)
      if (!sprite) {
        sprite = this.scene.add
          .image(s.tx * TILE_PX + TILE_PX / 2, s.ty * TILE_PX + TILE_PX / 2, 'glow')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(GLOW_DEPTH)
        this.sprites.set(s.id, sprite)
      }
      const warmth = villages.find((v) => v.id === s.villageId)?.warmth ?? 0
      // L'id du Feu sert de graine de phase : deux foyers côte à côte palpitent
      // chacun pour soi, jamais à l'unisson.
      const glow = fireGlow(warmth, day, now, s.id * 1.7)
      const diameterPx = glow.radius * TILE_PX * 2
      sprite.setTint(glow.color)
      sprite.setAlpha(glow.alpha)
      sprite.setDisplaySize(diameterPx, diameterPx)
    }
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }
}
