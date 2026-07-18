/**
 * LE MENU DU MARTEAU (spec construction R20) — SÉPARÉ du panneau d'artisanat.
 *
 * Le marteau EN MAIN ouvre ce menu ; on y choisit une PIÈCE STRUCTURELLE (mur,
 * porte, sol, toit, coffre) qui ARME le fantôme (`selected`). Ranger le marteau le
 * referme et désarme (R21) — les fantômes structurels disparaissent avec l'outil.
 * Les COMPOSANTS (enclume, four…) n'y sont PAS : ce sont des objets qu'on tient et
 * pose (flux feu de camp), livrés par les tranches suivantes.
 *
 * Pour mur/porte, un bouton cycle le PALIER DE MATÉRIAU (bois → pierre → métal, R8) :
 * la pose neuve prend ce matériau, et cliquer un mur existant l'AMÉLIORE vers lui.
 *
 * Comme tout le HUD, il ne DÉCIDE rien : il arme une intention, la sim revalide la
 * pose (carré, navigabilité, matériaux — invariant §3).
 */
import { STRUCTURE_COSTS, WALL_TIERS, hasItems, type Inventory, type ItemBag, type WallMaterial } from '@braises/sim'
import type Phaser from 'phaser'
import type { Buildable } from '../../hud-state'
import { bagLine } from './craft-panel'
import { INK, SECTION_TITLE, textStyle } from './typography'

/** Les pièces structurelles du menu du marteau (spec construction R20, décision
 *  d'Alexis) — le coffre n'y est PLUS (il se pose en objet tenu). */
export const BUILDABLES = ['wall', 'door', 'floor', 'roof'] as const
export const BUILDABLE_LABEL: Record<Buildable, string> = {
  wall: 'Mur',
  door: 'Porte',
  floor: 'Sol',
  roof: 'Toit',
}
const MATERIALS: readonly WallMaterial[] = ['wood', 'stone', 'metal']
const MATERIAL_LABEL: Record<WallMaterial, string> = { wood: 'bois', stone: 'pierre', metal: 'métal' }

/** Le coût d'une pièce, matériau compris pour mur/porte (spec construction R8). */
export function pieceCost(piece: Buildable, material: WallMaterial): ItemBag {
  if (piece === 'wall' || piece === 'door') return WALL_TIERS[material][piece].cost
  return STRUCTURE_COSTS[piece]
}

const TITLE_STYLE = SECTION_TITLE
const NAME = textStyle('body', 'body', false)
const COST = textStyle('small', 'dim', false)

const PANEL_W = 220
const ROW_H = 42
const PANEL_DEPTH = 900

export interface BuildMenu {
  /** Rafraîchit l'affichage (grisé selon la bourse). */
  update(inv: Inventory): void
  setVisible(v: boolean): void
  /** La pièce armée (le fantôme la suit), ou `null`. */
  armed(): Buildable | null
  /** Le palier de matériau choisi pour mur/porte. */
  material(): WallMaterial
  /** Ranger le marteau : désarme et referme (R21). */
  disarm(): void
}

export function createBuildMenu(scene: Phaser.Scene, top: number): BuildMenu {
  const x = 16
  let armed: Buildable | null = null
  let materialIdx = 0
  let inv: Inventory = []

  const title = scene.add
    .text(x, top - 24, 'MARTEAU', TITLE_STYLE)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(PANEL_DEPTH)

  const nodes: Phaser.GameObjects.GameObject[] = [title]

  const rows = BUILDABLES.map((piece, i) => {
    const y = top + i * ROW_H
    const bg = scene.add
      .rectangle(x + PANEL_W / 2, y + ROW_H / 2, PANEL_W, ROW_H - 4, 0x1b1b22, 0.9)
      .setStrokeStyle(1, 0x3a3a44)
      .setScrollFactor(0)
      .setDepth(PANEL_DEPTH)
      .setInteractive({ useHandCursor: true })
    const name = scene.add.text(x + 12, y + 6, '', NAME).setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH)
    const cost = scene.add.text(x + 12, y + 24, '', COST).setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH)
    bg.on('pointerdown', () => {
      // On ARME, ou on DÉSARME en recliquant : une bascule, là où l'œil regarde.
      armed = armed === piece ? null : piece
      draw()
    })
    nodes.push(bg, name, cost)
    return { piece, bg, name, cost }
  })

  // La barre de MATÉRIAU (mur/porte) : cliquer cycle bois → pierre → métal (R8).
  const matY = top + BUILDABLES.length * ROW_H
  const matBg = scene.add
    .rectangle(x + PANEL_W / 2, matY + ROW_H / 2, PANEL_W, ROW_H - 4, 0x14141a, 0.9)
    .setStrokeStyle(1, 0x6b5a3a)
    .setScrollFactor(0)
    .setDepth(PANEL_DEPTH)
    .setInteractive({ useHandCursor: true })
  const matText = scene.add
    .text(x + 12, matY + ROW_H / 2, '', NAME)
    .setOrigin(0, 0.5)
    .setScrollFactor(0)
    .setDepth(PANEL_DEPTH)
  matBg.on('pointerdown', () => {
    materialIdx = (materialIdx + 1) % MATERIALS.length
    draw()
  })
  nodes.push(matBg, matText)

  const draw = (): void => {
    const material = MATERIALS[materialIdx]!
    for (const row of rows) {
      const ready = hasItems(inv, pieceCost(row.piece, material))
      const isArmed = armed === row.piece
      row.bg.setStrokeStyle(isArmed ? 2 : 1, isArmed ? 0xe8c66a : ready ? 0x6b5a3a : 0x3a3a44)
      row.name
        .setText(isArmed ? `${BUILDABLE_LABEL[row.piece]} — ARMÉ` : BUILDABLE_LABEL[row.piece])
        .setColor(ready ? INK.body : INK.faint)
      row.cost.setText(bagLine(pieceCost(row.piece, material))).setColor(ready ? INK.dim : INK.faint)
    }
    matText.setText(`Matériau : ${MATERIAL_LABEL[material]}`)
  }
  draw()

  return {
    update(nextInv) {
      inv = nextInv
      draw()
    },
    setVisible(v) {
      for (const n of nodes) (n as unknown as { setVisible(x: boolean): void }).setVisible(v)
    },
    armed: () => armed,
    material: () => MATERIALS[materialIdx]!,
    disarm() {
      armed = null
      draw()
    },
  }
}
