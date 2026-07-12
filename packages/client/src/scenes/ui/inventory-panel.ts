/**
 * L'écran d'inventaire (TAB) : la grille complète (ceinture + sac), le
 * glisser-déposer, le clic droit, l'infobulle, et le panneau de loot à côté
 * quand un coffre ou une dépouille est ouvert (spec inventaire R19-R20).
 *
 * LE POINT DUR est en haut de ce fichier : `dragToAction`, `firstFitSlot` et
 * `quickMoveToAction` sont PURES (zéro Phaser) et testées. Un geste ne calcule
 * QUE l'action à envoyer — jamais son résultat. Le résultat est la sim, seule
 * source de vérité (invariant §3) ; le client n'anticipe que l'affichage (R22).
 * Réimplémenter `moveWithin`/`pourInto` ici signerait leur divergence : on ne
 * le fait pas.
 */
import { BALANCE, SLOTS, isStackable, stackSize, type Inventory, type ItemId, type PlayerAction, type Slot, type SlotRef } from '@braises/sim'
import type Phaser from 'phaser'
import type { OpenContainerView } from '../../hud-state'
import { ITEM_ICON_PX, ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { createSlotView, type SlotView } from './slot-view'

/** Le conteneur ouvert, tel que le panneau en a besoin (kind+id pour construire
 *  le `transfer`, inv+title pour dessiner). C'est `OpenContainerView`. */
type OpenContainer = OpenContainerView

/** Un geste de glisser terminé, réduit à ce qui décide de l'action. */
export interface DragIntent {
  from: SlotRef
  to: SlotRef
  /** SHIFT maintenu au lâcher — scinde la pile (uniquement en interne, case vide). */
  split: boolean
  /** Quantité concernée : la pile entière, ou la moitié si `split`. */
  count: number
  container: { kind: 'structure' | 'corpse'; id: number } | null
}

/**
 * La décision « ce glisser est-il un split ou un simple déplacement ? » et la
 * quantité concernée — la logique la plus fragile du geste, extraite du closure
 * Phaser pour être prouvée ici. `sourceSlot` est la pile tirée (jamais vide, une
 * case vide ne se glisse pas) ; `targetSlot` est ce qu'il y a sous le curseur au
 * lâcher (null = case vide). On ne décide QUE l'intention ; `dragToAction` en
 * tire l'action, la sim tranche le résultat.
 */
export function dragIntentFrom(
  from: SlotRef,
  to: SlotRef,
  shiftKey: boolean,
  sourceSlot: Slot,
  targetSlot: Slot | null,
  container: DragIntent['container'],
): DragIntent {
  const half = Math.floor(sourceSlot.count / 2)
  // On ne scinde QUE dans le même sac, vers une case vide, et s'il y a de quoi
  // couper (une pile de 1 ne se scinde pas) — sinon c'est un simple déplacement.
  const split = shiftKey && from.side === 'player' && to.side === 'player' && targetSlot == null && half >= 1
  return { from, to, split, count: split ? half : sourceSlot.count, container }
}

/**
 * Quelle ACTION un glisser produit-il ? Pur, donc c'est ici qu'on prouve la
 * logique. On ne décide jamais du RÉSULTAT — la sim le fera et fera foi.
 */
export function dragToAction(d: DragIntent): PlayerAction | null {
  // Une case sur elle-même : rien.
  if (d.from.side === d.to.side && d.from.slot === d.to.slot) return null
  // Réarranger un conteneur en interne (deux cases du même conteneur) n'est pas
  // supporté : `transfer` est cross-inventaire, la sim rejette « transfert sur
  // place ». On n'envoie rien plutôt qu'une action refusée.
  if (d.from.side === 'container' && d.to.side === 'container') return null
  // Un côté touche au conteneur mais aucun n'est ouvert : impossible.
  if ((d.from.side === 'container' || d.to.side === 'container') && d.container === null) return null
  // Dès qu'un conteneur est en jeu, c'est un transfert case-à-case (jamais un
  // split : scinder n'a de sens qu'à l'intérieur d'un même sac).
  if (d.from.side === 'container' || d.to.side === 'container') {
    return {
      type: 'transfer',
      kind: d.container!.kind,
      containerId: d.container!.id,
      from: d.from,
      to: d.to,
      count: d.count,
    }
  }
  if (d.split) return { type: 'split_slot', from: d.from.slot, to: d.to.slot, count: d.count }
  return { type: 'move_slot', from: d.from.slot, to: d.to.slot }
}

/**
 * La première case où `item` peut atterrir dans `inv[lo, hi[` : une pile
 * INCOMPLÈTE du même item d'abord (pour fusionner), sinon la première case vide,
 * sinon `null` (rien ne rentre). Les bornes `lo`/`hi` servent au clic droit
 * sac↔ceinture, qui ne vise qu'une région du même tableau.
 */
export function firstFitSlot(inv: Inventory, item: ItemId, lo = 0, hi: number = inv.length): number | null {
  if (isStackable(item)) {
    const max = stackSize(item)
    for (let i = lo; i < hi; i++) {
      const s = inv[i]
      if (s && s.item === item && s.count < max) return i
    }
  }
  for (let i = lo; i < hi; i++) {
    if (!inv[i]) return i // null ou undefined : une case libre
  }
  return null
}

/** Un clic droit sur une case : d'où, quel inventaire joueur, quel conteneur.
 *  Le conteneur n'a besoin ICI que de son identité et de son contenu (pas du
 *  titre d'affichage) — la logique pure reste indépendante du rendu. */
export interface QuickMoveIntent {
  from: SlotRef
  playerInv: Inventory
  container: { kind: 'structure' | 'corpse'; id: number; inv: Inventory } | null
}

/**
 * Le clic droit = envoi rapide vers l'autre zone. Avec un conteneur ouvert :
 * joueur ↔ conteneur. Sans : sac ↔ ceinture. La cible est la première case
 * compatible (`firstFitSlot`). Pur et testé — comme le glisser.
 */
export function quickMoveToAction(q: QuickMoveIntent): PlayerAction | null {
  const srcInv = q.from.side === 'player' ? q.playerInv : q.container?.inv
  if (!srcInv) return null
  const src = srcInv[q.from.slot]
  if (!src) return null

  if (q.container) {
    // Joueur ↔ conteneur : on traverse.
    const dstInv = q.from.side === 'player' ? q.container.inv : q.playerInv
    const to = firstFitSlot(dstInv, src.item)
    if (to === null) return null
    const dstSide: SlotRef['side'] = q.from.side === 'player' ? 'container' : 'player'
    return {
      type: 'transfer',
      kind: q.container.kind,
      containerId: q.container.id,
      from: { side: q.from.side, slot: q.from.slot },
      to: { side: dstSide, slot: to },
      count: src.count,
    }
  }

  // Sans conteneur : sac ↔ ceinture, dans le SEUL inventaire du joueur.
  if (q.from.side !== 'player') return null
  const belt = SLOTS.BELT
  const inBelt = q.from.slot < belt
  const to = inBelt
    ? firstFitSlot(q.playerInv, src.item, belt, q.playerInv.length) // ceinture → sac
    : firstFitSlot(q.playerInv, src.item, 0, belt) // sac → ceinture
  if (to === null || to === q.from.slot) return null
  return { type: 'move_slot', from: q.from.slot, to }
}

// ─── Le rendu Phaser (vérifié à l'œil ; aucune règle ici) ───────────────────

export interface InventoryPanel {
  update(inv: Inventory, activeSlot: number, container: OpenContainer | null): void
  setVisible(v: boolean): void
}

const CELL = 44
const GAP = 4
const COLS = 6
const PANEL_DEPTH = 900 // sous la carte (1000), au-dessus du HUD

/** Style de texte partagé du panneau (repris du journal). */
const TEXT = { fontFamily: 'monospace', fontSize: '14px', color: '#e8e0c8', stroke: '#14141a', strokeThickness: 3 } as const

/** Une case à l'écran + son adresse logique (côté, index). */
interface Cell {
  view: SlotView
  side: SlotRef['side']
  slot: number
}

/** Largeur d'une grille de `COLS` colonnes. */
const gridWidth = (): number => COLS * CELL + (COLS - 1) * GAP

export function createInventoryPanel(scene: Phaser.Scene, send: (a: PlayerAction) => void): InventoryPanel {
  const W = scene.scale.width
  const H = scene.scale.height
  const topY = -H / 2 + 90 // marge sous le bord haut du fond

  const bg = scene.add.rectangle(0, 0, 760, 560, 0x14141a, 0.94).setStrokeStyle(2, 0x6b5a3a)

  // ── Groupe JOUEUR (ceinture + sac) ──
  const playerCells: Cell[] = []
  const playerNodes: Phaser.GameObjects.GameObject[] = []
  const playerTitle = scene.add.text(0, topY - 26, 'SAC', { ...TEXT, fontSize: '16px', color: '#e8c66a' }).setOrigin(0.5, 0)
  playerNodes.push(playerTitle)
  for (let i = 0; i < SLOTS.PLAYER; i++) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    // La ceinture (row 0) est décollée du sac par un cran vertical : on VOIT la
    // séparation sans avoir à lire l'étiquette.
    const rowGap = row === 0 ? 0 : 16
    const x = -gridWidth() / 2 + CELL / 2 + col * (CELL + GAP)
    const y = topY + CELL / 2 + row * (CELL + GAP) + rowGap
    const view = createSlotView(scene, x, y, CELL)
    playerNodes.push(view.root)
    playerCells.push({ view, side: 'player', slot: i })
  }
  // Le filet sous la ceinture + son étiquette : la première ligne EST la ceinture.
  const beltY = topY + CELL + GAP / 2 + 6
  const beltRule = scene.add.rectangle(0, beltY, gridWidth(), 2, 0x6b5a3a).setOrigin(0.5)
  const beltLabel = scene.add
    .text(-gridWidth() / 2 - 8, topY + CELL / 2, 'ceinture', { ...TEXT, fontSize: '11px', color: '#b8b0a0' })
    .setOrigin(1, 0.5)
  playerNodes.push(beltRule, beltLabel)
  const playerGroup = scene.add.container(0, 0, playerNodes)

  // ── Groupe LOOT (créé au max = CORPSE ; on n'affiche que ce qu'il faut) ──
  const lootCells: Cell[] = []
  const lootNodes: Phaser.GameObjects.GameObject[] = []
  const lootTitle = scene.add.text(0, topY - 26, '', { ...TEXT, fontSize: '16px', color: '#e8c66a' }).setOrigin(0.5, 0)
  lootNodes.push(lootTitle)
  for (let i = 0; i < SLOTS.CORPSE; i++) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x = -gridWidth() / 2 + CELL / 2 + col * (CELL + GAP)
    const y = topY + CELL / 2 + row * (CELL + GAP)
    const view = createSlotView(scene, x, y, CELL)
    lootNodes.push(view.root)
    lootCells.push({ view, side: 'container', slot: i })
  }
  const lootGroup = scene.add.container(0, 0, lootNodes).setVisible(false)

  // ── Fantôme de glisser + infobulle (au-dessus de tout, dernier ajout) ──
  const ghost = scene.add.image(0, 0, itemIconKey('wood')).setVisible(false).setAlpha(0.85)
  ghost.setScale((CELL - 8) / ITEM_ICON_PX)
  const tip = scene.add
    .text(0, 0, '', { ...TEXT, fontSize: '12px', backgroundColor: '#14141aee', padding: { x: 6, y: 3 } })
    .setOrigin(0, 1)
    .setVisible(false)

  const root = scene.add
    .container(W / 2, H / 2, [bg, lootGroup, playerGroup, ghost, tip])
    .setDepth(PANEL_DEPTH)
    .setVisible(false)

  // ── État vivant du panneau ──
  let visible = false
  let playerInv: Inventory = []
  let container: OpenContainer | null = null
  let dragSource: Cell | null = null
  /** Cases marquées « en attente » (alpha réduit) jusqu'au prochain snapshot
   *  (R22 : optimisme d'AFFICHAGE seulement). Clés `side:slot`. */
  const pending = new Set<string>()
  let lastInvRef: Inventory | null = null
  let lastContainerRef: Inventory | null = null
  const key = (c: { side: SlotRef['side']; slot: number }): string => `${c.side}:${c.slot}`

  const shiftKey = scene.input.keyboard?.addKey('SHIFT', false)

  /** L'inventaire d'un côté (le conteneur peut avoir disparu). */
  const invOf = (side: SlotRef['side']): Inventory => (side === 'player' ? playerInv : (container?.inv ?? []))

  const cellFromNode = (obj: Phaser.GameObjects.GameObject): Cell | undefined =>
    (obj.getData('cell') as Cell | undefined) ?? undefined

  // Marque les cases d'une action comme « en attente » — le prochain snapshot fera foi.
  const markPending = (a: PlayerAction): void => {
    if (a.type === 'move_slot' || a.type === 'split_slot') {
      pending.add(`player:${a.from}`).add(`player:${a.to}`)
    } else if (a.type === 'transfer') {
      pending.add(key(a.from)).add(key(a.to))
    }
  }

  const dispatch = (a: PlayerAction | null): void => {
    if (!a) return
    markPending(a)
    send(a)
  }

  // Chaque case est interactive : source de glisser ET zone de dépôt.
  for (const cell of [...playerCells, ...lootCells]) {
    const node = cell.view.root
    node.setData('cell', cell)
    node.setSize(CELL, CELL).setInteractive({ draggable: true, dropZone: true })
    node.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!visible || !pointer.rightButtonDown()) return
      dispatch(quickMoveToAction({ from: { side: cell.side, slot: cell.slot }, playerInv, container }))
    })
    node.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!visible) return
      const slot = invOf(cell.side)[cell.slot]
      if (!slot) return
      const wear = slot.wear && slot.wear > 0 ? ` — usure ${Math.round((slot.wear / BALANCE.TOOL_DURABILITY) * 100)}%` : ''
      tip.setText(`${ITEM_LABELS[slot.item]}${wear}`)
        .setPosition(pointer.x - root.x + 12, pointer.y - root.y - 8)
        .setVisible(true)
    })
    node.on('pointerout', () => tip.setVisible(false))
  }

  // Le glisser vit au niveau de la scène (Phaser émet là ses events de drag).
  scene.input.on('dragstart', (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
    if (!visible) return
    const cell = cellFromNode(obj)
    if (!cell) return
    const slot = invOf(cell.side)[cell.slot]
    if (!slot) return // rien à traîner d'une case vide
    dragSource = cell
    tip.setVisible(false)
    ghost.setTexture(itemIconKey(slot.item)).setPosition(pointer.x - root.x, pointer.y - root.y).setVisible(true)
  })
  scene.input.on('drag', (pointer: Phaser.Input.Pointer) => {
    if (dragSource) ghost.setPosition(pointer.x - root.x, pointer.y - root.y)
  })
  scene.input.on('drop', (_p: Phaser.Input.Pointer, _o: Phaser.GameObjects.GameObject, target: Phaser.GameObjects.GameObject) => {
    if (!visible || !dragSource) return
    const dst = cellFromNode(target)
    if (!dst) return
    const src = dragSource
    const srcSlot = invOf(src.side)[src.slot]
    if (!srcSlot) return // rien à glisser d'une case vide
    // La décision split/move est PURE (`dragIntentFrom`, testée) — le closure ne
    // fait que lui donner l'état du geste (source, cible, SHIFT) et poster l'action.
    const intent = dragIntentFrom(
      { side: src.side, slot: src.slot },
      { side: dst.side, slot: dst.slot },
      Boolean(shiftKey?.isDown),
      srcSlot,
      invOf(dst.side)[dst.slot] ?? null,
      container,
    )
    dispatch(dragToAction(intent))
  })
  scene.input.on('dragend', () => {
    dragSource = null
    ghost.setVisible(false)
  })

  return {
    setVisible(v: boolean): void {
      visible = v
      root.setVisible(v)
      if (!v) {
        ghost.setVisible(false)
        tip.setVisible(false)
        dragSource = null
      }
    },
    update(inv: Inventory, activeSlot: number, open: OpenContainer | null): void {
      playerInv = inv
      container = open
      // Un nouveau snapshot (référence d'inventaire neuve) fait foi : il efface
      // l'optimisme (R22). Sinon les cases « en attente » restent grisées jusque-là.
      const containerRef = open?.inv ?? null
      if (inv !== lastInvRef || containerRef !== lastContainerRef) {
        pending.clear()
        lastInvRef = inv
        lastContainerRef = containerRef
      }

      // Groupe joueur : centré si pas de loot, décalé à droite sinon.
      const offset = gridWidth() / 2 + 40
      playerGroup.setX(open ? offset : 0)
      for (const cell of playerCells) {
        cell.view.update(inv[cell.slot] ?? null, cell.slot === activeSlot)
        cell.view.root.setAlpha(pending.has(key(cell)) ? 0.6 : 1)
      }

      // Groupe loot : visible et titré seulement si un conteneur est ouvert.
      lootGroup.setVisible(open !== null)
      if (open) {
        lootGroup.setX(-offset)
        lootTitle.setText(open.title)
        for (const cell of lootCells) {
          const shown = cell.slot < open.inv.length
          cell.view.root.setVisible(shown)
          if (shown) {
            cell.view.update(open.inv[cell.slot] ?? null, false)
            cell.view.root.setAlpha(pending.has(key(cell)) ? 0.6 : 1)
          }
        }
      }
    },
  }
}
