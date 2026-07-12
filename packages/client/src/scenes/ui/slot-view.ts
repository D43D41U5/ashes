/**
 * UNE case, à l'écran. Partagée par la ceinture, la grille du sac et le panneau
 * de loot : si la case se dessine à trois endroits, elle se dessine une fois.
 * On ne décide de rien ici — on affiche un `Slot` que la sim fait foi
 * (spec inventaire R22 : le geste est optimiste, l'autorité reste au snapshot).
 */
import { BALANCE, type Slot } from '@braises/sim'
import type Phaser from 'phaser'
import { ITEM_ICON_PX, itemIconKey } from '../../render/item-art'

export interface SlotView {
  root: Phaser.GameObjects.Container
  update(slot: Slot | null, active: boolean): void
}

export function createSlotView(scene: Phaser.Scene, x: number, y: number, size: number): SlotView {
  const bg = scene.add.rectangle(0, 0, size, size, 0x14141a, 0.85).setStrokeStyle(2, 0x4a4438)
  // On amorce l'icône avec une texture connue puis on la cache : `setTexture`
  // sur une clé absente laisserait le sprite figé sur la texture manquante.
  const icon = scene.add.image(0, 0, itemIconKey('wood')).setVisible(false)
  icon.setScale((size - 10) / ITEM_ICON_PX)
  const count = scene.add
    .text(size / 2 - 3, size / 2 - 3, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#e8e0c8',
      stroke: '#14141a',
      strokeThickness: 3,
    })
    .setOrigin(1, 1)
  // La barre d'usure : présente SEULEMENT quand l'objet est entamé (wear > 0).
  const wearBg = scene.add.rectangle(0, size / 2 - 5, size - 8, 3, 0x14141a).setVisible(false)
  const wearBar = scene.add
    .rectangle(-(size - 8) / 2, size / 2 - 5, size - 8, 3, 0x4e9c5a)
    .setOrigin(0, 0.5)
    .setVisible(false)
  const root = scene.add.container(x, y, [bg, icon, count, wearBg, wearBar])

  return {
    root,
    update(slot, active) {
      bg.setStrokeStyle(2, active ? 0xe8c66a : 0x4a4438) // la case tenue est OR
      if (slot === null) {
        icon.setVisible(false)
        count.setText('')
        wearBg.setVisible(false)
        wearBar.setVisible(false)
        return
      }
      icon.setTexture(itemIconKey(slot.item)).setVisible(true)
      count.setText(slot.count > 1 ? String(slot.count) : '')
      const worn = slot.wear !== undefined && slot.wear > 0
      wearBg.setVisible(worn)
      wearBar.setVisible(worn)
      if (worn) {
        const left = Math.max(0, 1 - (slot.wear ?? 0) / BALANCE.TOOL_DURABILITY)
        wearBar.width = (size - 8) * left
        wearBar.fillColor = left > 0.5 ? 0x4e9c5a : left > 0.2 ? 0xe8c66a : 0xc0503e
      }
    },
  }
}
