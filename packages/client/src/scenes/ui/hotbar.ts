/**
 * La ceinture (hotbar) : les BALANCE.SLOTS.BELT premières cases du sac, en bas
 * au centre, avec le numéro de touche (1-6) sous chacune. La case tenue en main
 * (`activeSlot`) est surlignée. Aucune règle ici : on affiche `inv` tel que le
 * snapshot le donne (spec inventaire R17, R22).
 */
import { SLOTS, type Inventory } from '@braises/sim'
import type Phaser from 'phaser'
import { createSlotView, type SlotView } from './slot-view'

export interface Hotbar {
  update(inv: Inventory, activeSlot: number): void
}

const CELL = 48
const GAP = 4

export function createHotbar(scene: Phaser.Scene): Hotbar {
  const belt = SLOTS.BELT
  const totalW = belt * CELL + (belt - 1) * GAP
  const startX = scene.scale.width / 2 - totalW / 2 + CELL / 2
  const y = scene.scale.height - CELL / 2 - 20

  const cells: SlotView[] = []
  for (let i = 0; i < belt; i++) {
    const x = startX + i * (CELL + GAP)
    cells.push(createSlotView(scene, x, y, CELL))
    // Le numéro de touche, discret, sous la case.
    scene.add
      .text(x, y + CELL / 2 + 2, String(i + 1), {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#b8b0a0',
        stroke: '#14141a',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
  }

  return {
    update(inv, activeSlot) {
      for (let i = 0; i < belt; i++) {
        cells[i]!.update(inv[i] ?? null, i === activeSlot)
      }
    },
  }
}
