/**
 * LES TRACES DU COIN À L'ÉCRAN (spec faune R24, A38) — la couche est bête : les
 * POSITIONS viennent du module pur (`render/traces.ts`, les mêmes données que le
 * comportement des bêtes), ici on ne fait que poser des images de sol.
 *
 * Statique tant que les coins ne bougent pas — et REBÂTIE quand ils bougent
 * (R27 : `coin_eteint`/`coin_seme`, le monde ressème et les traces suivent ;
 * celles d'un coin mort s'effacent avec lui). ~15 marques par coin, une dizaine
 * de coins : pas de pooling, pas de culling — le poids d'un buisson.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@ashes/sim'
import { GROUND_PROP_DEPTH, TILE_PX } from '../../render/framing'
import { tracesDuMonde, type Trace } from '../../render/traces'

const TRACE_TEXTURE: Record<Trace['sorte'], string> = {
  empreinte: 'spr-trace-empreinte',
  fumees: 'spr-trace-fumees',
  frottis: 'spr-trace-frottis',
}

export class TracesLayer {
  private images: Phaser.GameObjects.Image[] = []

  constructor(private readonly scene: Phaser.Scene) {}

  /** Rebâtit tout — appelé au `ready`, puis à chaque coin éteint ou semé (R27). */
  rebuild(map: WorldMap, grounds: readonly { x: number; y: number }[], seed: number): void {
    for (const im of this.images) im.destroy()
    this.images = []
    for (const t of tracesDuMonde(map, grounds, seed)) {
      const im = this.scene.add
        .image(t.x * TILE_PX, t.y * TILE_PX, TRACE_TEXTURE[t.sorte])
        .setDepth(GROUND_PROP_DEPTH)
      // L'empreinte suit le CAP de la coulée — par huitièmes : la grammaire
      // pixel quantifie, elle ne tourne pas librement.
      if (t.sorte === 'empreinte' && t.cap !== undefined) im.setAngle(t.cap * 45)
      this.images.push(im)
    }
  }

  destroy(): void {
    for (const im of this.images) im.destroy()
    this.images = []
  }
}
