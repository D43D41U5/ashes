/**
 * UNE case, à l'écran. Partagée par la ceinture, la grille du sac et le panneau
 * de loot : si la case se dessine à trois endroits, elle se dessine une fois.
 * On ne décide de rien ici — on affiche un `Slot` que la sim fait foi
 * (spec inventaire R22 : le geste est optimiste, l'autorité reste au snapshot).
 *
 * STYLE RUST (relevé sur une capture du jeu, pas de mémoire) :
 *  - la case est un carré GRIS PLAT translucide, SANS bordure — le monde
 *    transparaît au travers, et ce sont les gouttières (2 px) qui séparent ;
 *  - l'icône remplit presque toute la case ;
 *  - le compte de pile s'écrit « x210 », en bas à DROITE ;
 *  - l'usure n'est PAS une barre horizontale sous l'objet : c'est un FILET
 *    VERTICAL collé au bord GAUCHE de la case, qui se vide vers le bas ;
 *  - la case tenue en main n'est pas cerclée d'or : elle est TEINTÉE DE BLEU.
 */
import { durabilityOf, type Slot } from '@braises/sim'
import type Phaser from 'phaser'
import { ITEM_ICON_PX, itemIconKey } from '../../render/item-art'
import { FONT } from './typography'

export interface SlotView {
  root: Phaser.GameObjects.Container
  update(slot: Slot | null, active: boolean): void
}

/** Le gris de la case, et le bleu de la case tenue. Assez OPAQUE pour rester
 *  neutre : à 0.55 le vert du monde traversait et la grille virait au kaki —
 *  on voyait même l'avatar au travers. Chez Rust les cases sont translucides,
 *  mais elles lisent GRIS. */
const FILL = 0x585858
const FILL_ALPHA = 0.86
const FILL_ACTIVE = 0x7ea8cc
const FILL_ACTIVE_ALPHA = 0.85

/** Le filet d'usure, au bord gauche. */
const WEAR_W = 4
const WEAR_INSET = 4
const WEAR_GREEN = 0x8cc63e
const WEAR_AMBER = 0xe8c66a
const WEAR_RED = 0xc0503e

/**
 * L'icône, en multiple ENTIER de sa taille native : le jeu tourne en `pixelArt`,
 * une échelle fractionnaire baverait. Pour une case de 62, ça donne ×3 (48 px).
 */
function iconSize(cell: number): number {
  return Math.max(1, Math.floor((cell - 14) / ITEM_ICON_PX)) * ITEM_ICON_PX
}

export function createSlotView(scene: Phaser.Scene, x: number, y: number, size: number): SlotView {
  const bg = scene.add.rectangle(0, 0, size, size, FILL, FILL_ALPHA)
  // On amorce l'icône avec une texture connue puis on la cache : `setTexture`
  // sur une clé absente laisserait le sprite figé sur la texture manquante.
  const icon = scene.add.image(0, 0, itemIconKey('wood')).setVisible(false)
  const iconPx = iconSize(size)
  icon.setDisplaySize(iconPx, iconPx)

  const count = scene.add
    .text(size / 2 - 4, size / 2 - 3, '', {
      fontFamily: FONT,
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#14141a',
      strokeThickness: 3,
    })
    .setOrigin(1, 1)

  // Le filet d'usure : présent SEULEMENT quand l'objet est entamé (wear > 0).
  // Origine (0,1) = coin bas-gauche : la jauge se vide donc vers le BAS.
  const wearH = size - 2 * WEAR_INSET
  const wearX = -size / 2 + WEAR_INSET
  const wearY = size / 2 - WEAR_INSET
  const wearBg = scene.add
    .rectangle(wearX, wearY, WEAR_W, wearH, 0x14141a, 0.65)
    .setOrigin(0, 1)
    .setVisible(false)
  const wearBar = scene.add
    .rectangle(wearX, wearY, WEAR_W, wearH, WEAR_GREEN)
    .setOrigin(0, 1)
    .setVisible(false)

  const root = scene.add.container(x, y, [bg, icon, wearBg, wearBar, count])

  return {
    root,
    update(slot, active) {
      bg.fillColor = active ? FILL_ACTIVE : FILL
      bg.fillAlpha = active ? FILL_ACTIVE_ALPHA : FILL_ALPHA
      if (slot === null) {
        icon.setVisible(false)
        count.setText('')
        wearBg.setVisible(false)
        wearBar.setVisible(false)
        return
      }
      icon.setTexture(itemIconKey(slot.item)).setVisible(true)
      count.setText(slot.count > 1 ? `x${slot.count}` : '')
      const worn = slot.wear !== undefined && slot.wear > 0
      wearBg.setVisible(worn)
      wearBar.setVisible(worn)
      if (worn) {
        // La durabilité vient de l'OBJET, pas d'une constante : un hachereau de
        // fortune meurt en 20 coups. Une barre calée sur les 100 de la hache
        // d'atelier le montrerait encore aux trois quarts plein en tombant.
        const left = Math.max(0, 1 - (slot.wear ?? 0) / durabilityOf(slot.item))
        wearBar.height = wearH * left
        wearBar.fillColor = left > 0.5 ? WEAR_GREEN : left > 0.2 ? WEAR_AMBER : WEAR_RED
      }
    },
  }
}
