/**
 * LA FILE DE CRAFT, À L'ÉCRAN (spec craft-file F15-F16). Visible MÊME inventaire
 * fermé : le travail en cours n'est pas un détail de menu, c'est un état du
 * personnage — et une file bouchée doit se voir sans aller la chercher.
 *
 * Une ligne par ordre : l'icône de ce qui sort, `×N`, une barre de progression,
 * un bouton d'annulation. Trois états s'y lisent, et ce sont EXACTEMENT ceux de
 * la sim (`CraftOrder`) — le client n'en invente aucun :
 *   - en cours   : la barre avance ;
 *   - EN PAUSE   : `paused` — la station a été quittée (F7). Rien n'est perdu ;
 *   - EN ATTENTE : `remainingTicks === 0` — l'objet est prêt, le sac est plein,
 *                  la file attend une case (F10).
 *
 * AUCUN DÉCOMPTE LOCAL : la barre avance au rythme des snapshots. Un timer client
 * divergerait de la sim, et c'est précisément ce que la file dans `SimState` est
 * là pour empêcher (invariant §3).
 */
import { RECIPES, type CraftOrder, type PlayerAction } from '@braises/sim'
import type Phaser from 'phaser'
import { ITEM_ICON_PX, ITEM_LABELS, itemIconKey } from '../../render/item-art'

const ROW_H = 34
const ROW_W = 190
const BAR_H = 4
const HUD_DEPTH = 800

const LABEL = { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#e8e0cc' } as const
const STATE = { fontFamily: 'Georgia, serif', fontSize: '10px', color: '#c98b3a' } as const

const BAR_BG = 0x2a2a32
const BAR_FILL = 0xc9a227
const BAR_PAUSED = 0x7a6a4a
const BAR_BLOCKED = 0xc0392b

export interface CraftQueueView {
  update(queue: CraftOrder[]): void
  setVisible(v: boolean): void
}

/**
 * `x, y` : le coin HAUT-GAUCHE de la file. Les lignes descendent — la tête de
 * file (celle qui travaille) est EN HAUT : on lit ce qui sort en premier d'abord.
 */
export function createCraftQueueView(
  scene: Phaser.Scene,
  send: (a: PlayerAction) => void,
  x: number,
  y: number,
  maxRows: number,
): CraftQueueView {
  const rows = Array.from({ length: maxRows }, (_, i) => {
    const ry = i * ROW_H
    const bg = scene.add.rectangle(ROW_W / 2, ry + ROW_H / 2, ROW_W, ROW_H - 3, 0x14141a, 0.82).setStrokeStyle(1, 0x3a3a44)
    const icon = scene.add.image(18, ry + ROW_H / 2 - 3, itemIconKey('wood')).setDisplaySize(ITEM_ICON_PX * 1.2, ITEM_ICON_PX * 1.2)
    const label = scene.add.text(36, ry + 5, '', LABEL).setOrigin(0, 0)
    const state = scene.add.text(36, ry + 18, '', STATE).setOrigin(0, 0)
    const barBg = scene.add.rectangle(36, ry + ROW_H - 8, ROW_W - 76, BAR_H, BAR_BG).setOrigin(0, 0.5)
    const bar = scene.add.rectangle(36, ry + ROW_H - 8, 0, BAR_H, BAR_FILL).setOrigin(0, 0.5)
    // Le bouton d'annulation vit SUR la ligne — annuler, c'est annuler CETTE
    // recette-là, pas « la dernière » (spec F12).
    const cancel = scene.add
      .text(ROW_W - 16, ry + ROW_H / 2, '✕', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#9a8f78' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    cancel.on('pointerover', () => cancel.setColor('#e05a4a'))
    cancel.on('pointerout', () => cancel.setColor('#9a8f78'))
    cancel.on('pointerdown', () => send({ type: 'cancel_craft', index: i }))
    return { bg, icon, label, state, barBg, bar, cancel }
  })

  const root = scene.add
    .container(x, y, rows.flatMap((r) => [r.bg, r.icon, r.label, r.state, r.barBg, r.bar, r.cancel]))
    .setDepth(HUD_DEPTH)
    .setScrollFactor(0)

  const setRowVisible = (r: (typeof rows)[number], v: boolean): void => {
    r.bg.setVisible(v)
    r.icon.setVisible(v)
    r.label.setVisible(v)
    r.state.setVisible(v)
    r.barBg.setVisible(v)
    r.bar.setVisible(v)
    r.cancel.setVisible(v)
  }

  return {
    setVisible(v) {
      root.setVisible(v)
    },
    update(queue) {
      rows.forEach((r, i) => {
        const order = queue[i]
        if (order === undefined) return setRowVisible(r, false)
        setRowVisible(r, true)

        const recipe = RECIPES[order.recipeId]
        r.icon.setTexture(itemIconKey(recipe.output))
        r.label.setText(order.count > 1 ? `${ITEM_LABELS[recipe.output]} ×${order.count}` : ITEM_LABELS[recipe.output])

        // Le sac est plein : l'objet est FAIT et attend une case. C'est le seul
        // état où la barre est pleine ET rouge — on doit comprendre en un coup
        // d'œil que ce n'est pas la sim qui rame, c'est le sac qui bloque.
        const blocked = order.remainingTicks === 0
        const done = order.totalTicks > 0 ? (order.totalTicks - order.remainingTicks) / order.totalTicks : 0
        r.bar.width = Math.max(0, Math.min(1, done)) * (ROW_W - 76)
        r.bar.fillColor = blocked ? BAR_BLOCKED : order.paused ? BAR_PAUSED : BAR_FILL
        r.state.setText(blocked ? 'sac plein — en attente' : order.paused ? 'station quittée — en pause' : '')
        r.state.setColor(blocked ? '#e05a4a' : '#c98b3a')
      })
    },
  }
}
