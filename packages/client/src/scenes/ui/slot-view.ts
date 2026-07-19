/**
 * UNE case, à l'écran. Partagée par la ceinture, la grille du sac et le panneau
 * de loot : si la case se dessine à trois endroits, elle se dessine une fois.
 * On ne décide de rien ici — on affiche un `Slot` que la sim fait foi
 * (spec inventaire R22 : le geste est optimiste, l'autorité reste au snapshot).
 *
 * STYLE MAQUETTE « Ashes UI » (Turn 2A/5A) :
 *  - la case est un carré de PANNEAU sombre (#1b1b22) cerné d'ENCRE (#14141a) ;
 *  - l'icône remplit presque toute la case ;
 *  - le compte de pile s'écrit « x210 », en bas à DROITE ;
 *  - l'usure est une BARRE HORIZONTALE en bas (rail sombre, remplissage braise) ;
 *  - la case tenue en main s'allume d'un LISERÉ BRAISE (pas d'une teinte bleue).
 */
import { durabilityOf, spoilTier, type Slot } from '@braises/sim'
import type Phaser from 'phaser'
import { ITEM_ICON_PX, itemIconKey } from '../../render/item-art'
import { COL } from './palette'
import { FONT } from './typography'

export interface SlotView {
  root: Phaser.GameObjects.Container
  update(slot: Slot | null, active: boolean): void
}

/**
 * LA CASE, façon maquette « Ashes UI » (Turn 2A/5A) : un carré de PANNEAU sombre
 * (`#1b1b22`, translucide) cerné d'ENCRE, dont le bord passe en BRAISE quand l'objet
 * est tenu en main — c'est le liseré chaud qui dit « celui-ci », pas une teinte bleue.
 */
const FILL = COL.panel // #1b1b22
const FILL_ALPHA = 0.86
const BORDER = COL.ink // #14141a
const BORDER_ACTIVE = COL.ember // #c98b3a — la case tenue s'allume en braise

/** La barre d'usure : un rail sombre en bas, rempli de braise (maquette Turn 5A). */
const WEAR_H = 4
const WEAR_INSET = 4
const WEAR_RAIL = 0x3a2f22
const WEAR_FILL = COL.ember

/**
 * LA FRAÎCHEUR — un bandeau en BAS de la case, quand la nourriture n'est plus
 * fraîche. Vert : on ne l'affiche pas (le frais est l'état normal, et un HUD qui
 * décore l'état normal ne dit plus rien). Jaune : RASSIS (moitié moins nourrissant).
 * Rouge : AVARIÉ (presque plus rien) — et il va bientôt POURRIR, c'est-à-dire
 * DISPARAÎTRE. Le joueur n'a rien à gérer : il voit, il décide.
 *
 * Même grammaire que l'usure (un filet coloré collé au bord) : on n'apprend pas
 * deux langages pour deux compteurs.
 */
const FRESH_STALE = 0xe8c66a
const FRESH_SPOILED = 0xc0503e
const FRESH_H = 4

/**
 * L'icône, en multiple ENTIER de sa taille native : le jeu tourne en `pixelArt`,
 * une échelle fractionnaire baverait. Pour une case de 62, ça donne ×3 (48 px).
 */
function iconSize(cell: number): number {
  return Math.max(1, Math.floor((cell - 14) / ITEM_ICON_PX)) * ITEM_ICON_PX
}

export function createSlotView(scene: Phaser.Scene, x: number, y: number, size: number): SlotView {
  const bg = scene.add.rectangle(0, 0, size, size, FILL, FILL_ALPHA).setStrokeStyle(2, BORDER)
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

  // La barre d'usure : un rail HORIZONTAL en bas de la case (maquette Turn 5A),
  // présent seulement quand l'objet est entamé. Origine (0,0.5) = bord gauche : la
  // jauge se vide donc vers la DROITE. Le rail court d'un insert à l'autre.
  const wearW = size - 2 * WEAR_INSET
  const wearX = -size / 2 + WEAR_INSET
  const wearY = size / 2 - WEAR_INSET
  const wearBg = scene.add
    .rectangle(wearX, wearY, wearW, WEAR_H, WEAR_RAIL, 1)
    .setOrigin(0, 1)
    .setVisible(false)
  const wearBar = scene.add
    .rectangle(wearX, wearY, wearW, WEAR_H, WEAR_FILL)
    .setOrigin(0, 1)
    .setVisible(false)

  // Le bandeau de fraîcheur : en bas, sur toute la largeur — impossible à confondre
  // avec le filet d'usure (vertical, à gauche).
  const spoilBar = scene.add
    .rectangle(0, size / 2 - FRESH_H / 2, size - 8, FRESH_H, FRESH_STALE)
    .setVisible(false)

  const root = scene.add.container(x, y, [bg, icon, wearBg, wearBar, spoilBar, count])

  return {
    root,
    update(slot, active) {
      // La case tenue s'allume d'un liseré BRAISE (maquette) ; le fond reste le panneau.
      bg.setStrokeStyle(active ? 3 : 2, active ? BORDER_ACTIVE : BORDER)
      if (slot === null) {
        icon.setVisible(false)
        count.setText('')
        wearBg.setVisible(false)
        wearBar.setVisible(false)
        spoilBar.setVisible(false)
        return
      }
      icon.setTexture(itemIconKey(slot.item)).setVisible(true)
      count.setText(slot.count > 1 ? `x${slot.count}` : '')

      // La fraîcheur : le cran vient de /sim (`spoilTier`), jamais d'un seuil
      // recopié ici — la case doit dire EXACTEMENT ce que l'assiette rendra.
      const tier = slot.fresh === undefined ? null : spoilTier(slot.fresh)
      spoilBar.setVisible(tier === 'stale' || tier === 'spoiled')
      if (tier === 'stale') spoilBar.fillColor = FRESH_STALE
      if (tier === 'spoiled') spoilBar.fillColor = FRESH_SPOILED
      const worn = slot.wear !== undefined && slot.wear > 0
      wearBg.setVisible(worn)
      wearBar.setVisible(worn)
      if (worn) {
        // La durabilité vient de l'OBJET, pas d'une constante : un hachereau de
        // fortune meurt en 20 coups. Une barre calée sur les 100 de la hache
        // d'atelier le montrerait encore aux trois quarts plein en tombant.
        const left = Math.max(0, 1 - (slot.wear ?? 0) / durabilityOf(slot.item))
        // `setSize` (pas `.width =`) : seul lui recalcule l'origine d'affichage. La
        // barre part du bord gauche (origine 0) et se vide vers la DROITE. Braise pleine,
        // elle rougit quand il ne reste presque plus rien (l'objet va casser).
        wearBar.setSize(wearW * left, WEAR_H)
        wearBar.fillColor = left > 0.2 ? WEAR_FILL : COL.alert
      }
    },
  }
}
