/**
 * LES TOASTS DE RÉCOLTE — « +2 BOIS (14) », en pile, façon Rust.
 *
 * Le premier jet faisait monter un « +1 bois » AU-DESSUS DU NŒUD, dans le monde.
 * Ça marchait — la donnée le prouvait, le texte était bien à l'écran — mais dans
 * une forêt dense, un petit texte blanc sur du feuillage vert sombre est ILLISIBLE.
 * Le butin se lit dans le HUD, à une place FIXE que l'œil apprend, pas au milieu
 * des arbres.
 *
 * LA FUSION EST LE POINT DUR. On récolte un coup toutes les ~600 ms : sans fusion,
 * abattre un arbre empilerait dix lignes « +1 BOIS ». Une récolte du MÊME item
 * réanime donc la ligne existante et lui AJOUTE son compte — comme Rust. Une ligne
 * ne meurt que lorsqu'on cesse de la nourrir.
 *
 * Le nombre entre parenthèses est le TOTAL DÉTENU, relu du sac à chaque frame :
 * on ne l'accumule pas nous-mêmes (le sac est borné, il peut écrêter — la sim fait
 * foi, le client ne tient pas un deuxième compteur qui divergerait).
 */
import { countOf, type Inventory, type ItemId } from '@braises/sim'
import type Phaser from 'phaser'
import { ITEM_ICON_PX, ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { hotbarBottom } from './hotbar'

export interface PickupToasts {
  /** Un `resource_harvested` reçu POUR MOI (jamais un clic — spec recolte.md G9). */
  push(item: ItemId, count: number, now: number): void
  update(inv: Inventory, now: number): void
}

const ROW_W = 268
const ROW_H = 28
const ROW_GAP = 4
/** Au-delà, les plus vieilles lignes s'effacent : le HUD ne devient pas un mur. */
const MAX_ROWS = 5
/** Une ligne vit ça sans être nourrie, puis s'efface. */
const LIFE_MS = 3600
const FADE_MS = 500

/** Le vert de Rust : une barre pleine, un liseré sombre, du blanc dessus. */
const GREEN = 0x7ba428
const GREEN_DARK = 0x53701a
const ICON_PAD = 26

interface Row {
  item: ItemId
  count: number
  /** Dernier apport — c'est LUI qui tient la ligne en vie (fusion). */
  fedAt: number
  root: Phaser.GameObjects.Container
  icon: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  amount: Phaser.GameObjects.Text
}

export function createPickupToasts(scene: Phaser.Scene): PickupToasts {
  // Les toasts s'empilent VERS LE HAUT depuis juste au-dessus des vitales : le bas
  // de l'écran est déjà pris (médaillons, ceinture), et l'œil y est déjà.
  const x = 12
  const bottom = hotbarBottom(scene) - 2 * 32 - 52

  const rows: Row[] = []

  const makeRow = (): Row => {
    const bg = scene.add.graphics()
    bg.fillStyle(GREEN_DARK, 0.92).fillRoundedRect(0, 0, ROW_W, ROW_H, 3)
    bg.fillStyle(GREEN, 0.92).fillRoundedRect(0, 0, ROW_W - 74, ROW_H, 3)
    const icon = scene.add.image(ICON_PAD / 2 + 4, ROW_H / 2, itemIconKey('wood'))
    icon.setDisplaySize(ITEM_ICON_PX, ITEM_ICON_PX)
    const label = scene.add
      .text(ICON_PAD + 8, ROW_H / 2, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#2c3d10',
        strokeThickness: 2,
      })
      .setOrigin(0, 0.5)
    const amount = scene.add
      .text(ROW_W - 8, ROW_H / 2, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#2c3d10',
        strokeThickness: 2,
      })
      .setOrigin(1, 0.5)
    const root = scene.add.container(x, 0, [bg, icon, label, amount]).setVisible(false)
    return { item: 'wood', count: 0, fedAt: 0, root, icon, label, amount }
  }

  return {
    push(item, count, now) {
      // FUSION : la même ressource réanime sa ligne au lieu d'en créer une autre.
      const existing = rows.find((r) => r.item === item)
      if (existing) {
        existing.count += count
        existing.fedAt = now
        return
      }
      const row = makeRow()
      row.item = item
      row.count = count
      row.fedAt = now
      row.icon.setTexture(itemIconKey(item))
      row.label.setText(ITEM_LABELS[item].toUpperCase())
      rows.push(row)
      // La plus vieille cède la place — on n'empile pas un mur de vert.
      while (rows.length > MAX_ROWS) rows.shift()!.root.destroy()
    },

    update(inv, now) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!
        const age = now - r.fedAt
        if (age > LIFE_MS + FADE_MS) {
          r.root.destroy()
          rows.splice(i, 1)
        }
      }
      // La plus RÉCENTE en bas, les anciennes montent : la dernière prise tombe
      // toujours au même endroit, juste au-dessus des vitales.
      rows.forEach((r, i) => {
        const fromBottom = rows.length - 1 - i
        r.root.setPosition(x, bottom - ROW_H - fromBottom * (ROW_H + ROW_GAP)).setVisible(true)
        const age = now - r.fedAt
        r.root.setAlpha(age <= LIFE_MS ? 1 : Math.max(0, 1 - (age - LIFE_MS) / FADE_MS))
        // Le total vient du SAC, pas d'un compteur maison : le sac est borné, la
        // récolte peut écrêter — seule la sim sait ce qu'on détient vraiment.
        const total = countOf(inv, r.item)
        r.amount.setText(total > r.count ? `+${r.count} (${total})` : `+${r.count}`)
      })
    },
  }
}
