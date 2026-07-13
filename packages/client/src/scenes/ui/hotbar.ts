/**
 * La ceinture (hotbar) : les BALANCE.SLOTS.BELT premières cases du sac, en bas
 * au centre, avec le numéro de touche (1-6) sous chacune. La case tenue en main
 * (`activeSlot`) est surlignée. Aucune règle ici : on affiche `inv` tel que le
 * snapshot le donne (spec inventaire R17, R22).
 */
import { SLOTS, type Inventory } from '@braises/sim'
import type Phaser from 'phaser'
import { createSlotView, type SlotView } from './slot-view'
import { FONT } from './typography'

export interface Hotbar {
  update(inv: Inventory, activeSlot: number): void
  /** Masquée quand l'écran d'inventaire est ouvert : sa rangée dans la grille la
   *  remplace (Rust fait pareil — sinon on affiche deux fois la même ceinture). */
  setVisible(v: boolean): void
}

/** Taille et gouttière RUST : de grandes cases, quasi jointives. La ceinture est
 *  une rangée de la grille du sac — elle doit s'écrire dans le même alphabet. */
export const CELL = 62
export const GAP = 2
/** Marge sous les cases. */
const MARGIN = 20

/** Le bord BAS des cases de ceinture. Les vitales s'alignent dessus : le bas de
 *  l'écran doit lire comme une seule bande, pas comme deux blocs qui flottent. */
export function hotbarBottom(scene: Phaser.Scene): number {
  return scene.scale.height - MARGIN
}

export function createHotbar(scene: Phaser.Scene): Hotbar {
  const belt = SLOTS.BELT
  const totalW = belt * CELL + (belt - 1) * GAP
  const startX = scene.scale.width / 2 - totalW / 2 + CELL / 2
  const y = hotbarBottom(scene) - CELL / 2

  const cells: SlotView[] = []
  const parts: Phaser.GameObjects.GameObject[] = []
  for (let i = 0; i < belt; i++) {
    const x = startX + i * (CELL + GAP)
    const view = createSlotView(scene, x, y, CELL)
    cells.push(view)
    // Le numéro de touche DANS la case, au coin haut-gauche — le bas-gauche est
    // pris par le filet d'usure, le bas-droit par le compte de pile.
    const num = scene.add
      .text(x - CELL / 2 + 5, y - CELL / 2 + 3, String(i + 1), {
        fontFamily: FONT,
        fontSize: '12px',
        color: '#d8d4cc',
        stroke: '#14141a',
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
    parts.push(view.root, num)
  }
  const root = scene.add.container(0, 0, parts)

  return {
    setVisible(v) {
      root.setVisible(v)
    },
    update(inv, activeSlot) {
      for (let i = 0; i < belt; i++) {
        cells[i]!.update(inv[i] ?? null, i === activeSlot)
      }
    },
  }
}
