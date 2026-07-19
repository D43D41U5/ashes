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
import { CARRY, SLOTS, carryRatio, carryTier, carryWeight, durabilityOf, isStackable, spoilTier, stackSize, type CarryTier, type Inventory, type ItemId, type PlayerAction, type Slot, type SlotRef } from '@braises/sim'
import type Phaser from 'phaser'
import type { OpenContainerView } from '../../hud-state'
import { ITEM_ICON_PX, ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { CELL, GAP, hotbarBottom } from './hotbar'
import { createSlotView, type SlotView } from './slot-view'
import { INK, SECTION_TITLE, textStyle } from './typography'

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

/** Case et gouttière viennent de la CEINTURE : c'est la même case, au même
 *  format, partout — c'est tout le point du style Rust. */
const COLS = 6
const PANEL_DEPTH = 900 // sous la carte (1000), au-dessus du HUD
/** Le vide qui décolle la ceinture du sac. Chez Rust il n'y a ni filet ni
 *  étiquette : juste un cran, et la rangée du bas EST la ceinture. */
const BELT_GAP = 12
/** Combien de rangées de sac au-dessus de la ceinture. */
const BAG_ROWS = (SLOTS.PLAYER - SLOTS.BELT) / COLS

/** La barre de charge, à droite du titre du sac. Quatre paliers, quatre couleurs —
 *  les mêmes que le médaillon de poids (vitals.ts) : le joueur ne doit pas avoir à
 *  traduire d'un écran à l'autre. Les SEUILS, eux, viennent de /sim (`carryTier`). */
const LOAD_BAR_W = 120
const TIER_COLOR: Record<CarryTier, number> = {
  light: 0x7e8a94,
  medium: 0xc9a227,
  heavy: 0xd07a2a,
  overloaded: 0xc0503e,
}
const TIER_LABEL: Record<CarryTier, string> = {
  light: 'léger',
  medium: 'moyen',
  heavy: 'lourd (pas de sprint)',
  overloaded: 'SURCHARGÉ',
}

/** Styles du panneau — tirés de la source unique (`typography.ts`). */
const TEXT = textStyle('body')
/** Le titre : capitales, blanc, calé à GAUCHE au-dessus de la grille (Rust). */
const TITLE = SECTION_TITLE

/** Une case à l'écran + son adresse logique (côté, index). */
interface Cell {
  view: SlotView
  side: SlotRef['side']
  slot: number
}

/** Largeur d'une grille de `COLS` colonnes. */
const gridWidth = (): number => COLS * CELL + (COLS - 1) * GAP

/**
 * LA GÉOMÉTRIE DE L'ÉCRAN D'INVENTAIRE, en coordonnées ÉCRAN — la seule source.
 *
 * Le panneau d'artisanat se pose À CÔTÉ de cette grille : sans repère partagé, il
 * se peignait PAR-DESSUS (posé à `largeur/2 + 40`, il tombait en plein milieu
 * d'une grille qui s'étend de `largeur/2 − 191` à `largeur/2 + 191`). La formule
 * de calage vit donc ICI, une fois, et `createInventoryPanel` la lit comme les
 * autres — deux copies auraient divergé au premier ajustement de case.
 */
export function inventoryGeometry(scene: Phaser.Scene): { left: number; right: number; top: number; bottom: number } {
  const W = scene.scale.width
  const bottom = hotbarBottom(scene)
  // Rangées du sac + gouttière + rangée de ceinture (qui reste EXACTEMENT là où
  // la vraie barre de ceinture vit déjà à l'écran).
  const height = BAG_ROWS * (CELL + GAP) + BELT_GAP + CELL
  return { left: W / 2 - gridWidth() / 2, right: W / 2 + gridWidth() / 2, top: bottom - height, bottom }
}
/** L'icône dans une case — multiple entier de sa taille native (`pixelArt`). */
const ICON_IN_CELL = Math.max(1, Math.floor((CELL - 14) / ITEM_ICON_PX)) * ITEM_ICON_PX

export function createInventoryPanel(scene: Phaser.Scene, send: (a: PlayerAction) => void): InventoryPanel {
  const W = scene.scale.width
  const H = scene.scale.height
  // Les grilles se construisent avec leur bord HAUT à y = 0 ; c'est le conteneur
  // du groupe qui les place. Coordonnées LOCALES au `root`, centré à l'écran.
  const gx = (col: number): number => -gridWidth() / 2 + CELL / 2 + col * (CELL + GAP)
  const gy = (row: number): number => CELL / 2 + row * (CELL + GAP)

  /** La ligne du bas de tout le dispositif : le bord bas des cases de ceinture. */
  const BOTTOM_Y = hotbarBottom(scene) - H / 2

  /**
   * LA CEINTURE NE BOUGE PAS. Son rang dans la grille du sac tombe EXACTEMENT
   * là où la barre de ceinture vit déjà à l'écran (même x, même y, même taille) :
   * ouvrir le sac ne fait donc rien sauter — la grille pousse vers le HAUT depuis
   * la ceinture, et la vraie barre s'efface derrière (cf. `hotbar.setVisible`).
   * D'où ce calage par le bas, et un groupe joueur qui ne se déplace JAMAIS.
   */
  const PLAYER_Y = inventoryGeometry(scene).top - H / 2

  // Rust n'a PAS de panneau encadré : les cases flottent sur le monde, qui reste
  // visible et seulement assombri. On remplace donc le cadre brun par un voile.
  const bg = scene.add.rectangle(0, 0, W, H, 0x0a0a0e, 0.6)

  // ── Groupe JOUEUR (sac + ceinture) ──
  const playerCells: Cell[] = []
  const playerNodes: Phaser.GameObjects.GameObject[] = []
  const playerTitle = scene.add.text(-gridWidth() / 2, -26, 'INVENTAIRE', TITLE).setOrigin(0, 0)

  /*
   * LA CHARGE (spec portage.md P11). Elle se lit à DROITE du titre, sur la même
   * ligne : « poids 12.4 / 30 », et une barre dessous. Un malus qu'on subit sans le
   * voir est un bug, pas une règle — et celui-là est violent : au-dessus des trois
   * quarts on ne sprinte plus, au-dessus de la capacité on rampe et l'endurance ne
   * revient plus. Le joueur doit pouvoir décider AVANT de charger, pas comprendre
   * après coup pourquoi il ne court plus.
   */
  const loadText = scene.add.text(gridWidth() / 2, -26, '', textStyle('label', 'dim')).setOrigin(1, 0)
  const loadBg = scene.add.rectangle(gridWidth() / 2, -6, LOAD_BAR_W, 3, 0x2a2a32).setOrigin(1, 0.5)
  const loadBar = scene.add.rectangle(gridWidth() / 2 - LOAD_BAR_W, -6, 0, 3, TIER_COLOR.light).setOrigin(0, 0.5)
  playerNodes.push(playerTitle, loadText, loadBg, loadBar)
  for (let i = 0; i < SLOTS.PLAYER; i++) {
    // LA CEINTURE EST LA RANGÉE DU BAS. Les cases 0-5 restent la ceinture pour la
    // sim ; seul leur DESSIN descend sous le sac, comme chez Rust. Un cran de vide
    // l'en sépare — ni filet, ni étiquette : la place suffit à le dire.
    const beltSlot = i < SLOTS.BELT
    const col = beltSlot ? i : (i - SLOTS.BELT) % COLS
    const row = beltSlot ? BAG_ROWS : Math.floor((i - SLOTS.BELT) / COLS)
    const view = createSlotView(scene, gx(col), gy(row) + (beltSlot ? BELT_GAP : 0), CELL)
    playerNodes.push(view.root)
    playerCells.push({ view, side: 'player', slot: i })
  }
  const playerGroup = scene.add.container(0, PLAYER_Y, playerNodes)

  // ── Groupe LOOT (créé au max = CORPSE ; on n'affiche que ce qu'il faut) ──
  const lootCells: Cell[] = []
  const lootNodes: Phaser.GameObjects.GameObject[] = []
  const lootTitle = scene.add.text(-gridWidth() / 2, -26, '', TITLE).setOrigin(0, 0)
  lootNodes.push(lootTitle)
  for (let i = 0; i < SLOTS.CORPSE; i++) {
    const view = createSlotView(scene, gx(i % COLS), gy(Math.floor(i / COLS)), CELL)
    lootNodes.push(view.root)
    lootCells.push({ view, side: 'container', slot: i })
  }
  const lootGroup = scene.add.container(0, 0, lootNodes).setVisible(false)

  // ── Fantôme de glisser + infobulle (au-dessus de tout, dernier ajout) ──
  const ghost = scene.add.image(0, 0, itemIconKey('wood')).setVisible(false).setAlpha(0.85)
  ghost.setDisplaySize(ICON_IN_CELL, ICON_IN_CELL)
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
      const wear =
        slot.wear && slot.wear > 0 ? ` — usure ${Math.round((slot.wear / durabilityOf(slot.item)) * 100)}%` : ''
      // L'ÉTAT, en toutes lettres : « rassis (moitié moins nourrissant) ». Une
      // couleur seule laisse deviner ; un mot ne laisse pas de doute.
      const etat =
        slot.fresh === undefined
          ? ''
          : { fresh: '', stale: ' — rassis (moitié moins nourrissant)', spoiled: ' — AVARIÉ (il va pourrir)' }[
              spoilTier(slot.fresh)
            ]
      tip.setText(`${ITEM_LABELS[slot.item]}${wear}${etat}`)
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

      // LA CHARGE : le poids, la capacité, et l'état — libre, chargé, SURCHARGÉ.
      // Les seuils viennent de /sim (`CARRY`), jamais recopiés : le jour où la
      // besace de peau fera monter la capacité, cette barre suivra toute seule.
      const poids = carryWeight(inv)
      const ratio = carryRatio(inv)
      const tier = carryTier(ratio) // les seuils viennent de /sim, jamais recopiés
      // POIDS ABSTRAIT (décision d'Alexis 2026-07-19) : le moteur n'a pas de kg,
      // l'échelle est une capacité abstraite (min 0.2, capacité 30). Pas de « kg ».
      loadText.setText(`poids ${poids.toFixed(1)} / ${CARRY.CAPACITY} — ${TIER_LABEL[tier]}`)
      loadText.setColor(tier === 'overloaded' ? INK.alert : tier === 'heavy' ? INK.warm : INK.dim)
      loadBar.width = Math.min(1, ratio) * LOAD_BAR_W
      loadBar.fillColor = TIER_COLOR[tier]
      // Un nouveau snapshot (référence d'inventaire neuve) fait foi : il efface
      // l'optimisme (R22). Sinon les cases « en attente » restent grisées jusque-là.
      const containerRef = open?.inv ?? null
      if (inv !== lastInvRef || containerRef !== lastContainerRef) {
        pending.clear()
        lastInvRef = inv
        lastContainerRef = containerRef
      }

      for (const cell of playerCells) {
        cell.view.update(inv[cell.slot] ?? null, cell.slot === activeSlot)
        cell.view.root.setAlpha(pending.has(key(cell)) ? 0.6 : 1)
      }

      // Groupe loot : visible et titré seulement si un conteneur est ouvert. Il
      // se pose À GAUCHE du sac, dont il ne déplace RIEN (cf. `PLAYER_Y`), et se
      // cale sur la même ligne du BAS — une dépouille fait huit rangées, un coffre
      // quatre : les aligner par le haut les ferait pendre dans le vide.
      lootGroup.setVisible(open !== null)
      if (open) {
        const rows = Math.ceil(open.inv.length / COLS)
        lootGroup.setPosition(-(gridWidth() + 40), BOTTOM_Y - (rows * (CELL + GAP) - GAP))
        lootTitle.setText(open.title.toUpperCase())
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
