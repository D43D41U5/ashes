/**
 * LE PANNEAU D'ARTISANAT — à droite de l'écran d'inventaire (spec craft-file F14).
 *
 * Depuis LE PIVOT RUST (spec construction R20), il est REDEVENU PUR : il ne
 * fabrique QUE des recettes (outils, armes, survie, matériaux, campement). Les
 * PIÈCES STRUCTURELLES (mur, porte, sol, toit) ont leur propre menu — celui du
 * MARTEAU (`ui/build-menu.ts`) ; les COMPOSANTS (enclume, four…) sont des objets
 * qu'on tient et pose. Le panneau ne montre plus jamais de construction.
 *
 * Quatre règles, demandées le 2026-07-13 :
 *   1. ON NE MONTRE QUE CE QU'ON PEUT FAIRE ICI. Une recette de four sans four à
 *      portée n'est pas grisée : elle n'est PAS LÀ. Le panneau dit ce que le lieu
 *      permet — c'est une lecture du lieu, pas un catalogue.
 *   2. GROUPÉ PAR CATÉGORIE (outils, armes, survie, matériaux), en-têtes visibles.
 *   3. DÉFILABLE (molette) — la liste ne déborde jamais de son cadre.
 *   4. UN CHAMP DE RECHERCHE pour filtrer au clavier.
 *
 * La logique — QUOI afficher — est PURE et testée (`craftRows`). Le Phaser en
 * dessous n'est que du placement.
 *
 * Ce qui reste GRISÉ, c'est ce dont on n'a pas les MATÉRIAUX : la recette est
 * faisable ici, elle est juste hors de portée de bourse — une invitation à aller
 * chercher les trois fibres qui manquent.
 */
import {
  RECIPES,
  hasItems,
  type Inventory,
  type ItemBag,
  type ItemId,
  type PlayerAction,
  type RecipeId,
} from '@braises/sim'
import type Phaser from 'phaser'
import type { StationId } from '../../hud-state'
import { ITEM_ICON_PX, ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { INK, SECTION_TITLE, textStyle } from './typography'

// ─── La logique (pure, testée — craft-panel.test.ts) ─────────────────────────

export type CraftCategory = 'campement' | 'composants' | 'outils' | 'armes' | 'survie' | 'materiaux'

export const CATEGORY_LABEL: Record<CraftCategory, string> = {
  campement: 'CAMPEMENT',
  // Les COMPOSANTS (spec construction R20) : fabriqués au Feu, portés, posés — ce
  // sont des OBJETS d'artisanat, pas des pièces du menu du marteau (les barrières).
  composants: 'COMPOSANTS',
  outils: 'OUTILS',
  armes: 'ARMES',
  survie: 'SURVIE',
  materiaux: 'MATÉRIAUX',
}

/**
 * L'ordre des rayons à l'écran : ALPHABÉTIQUE (décision utilisateur, 2026-07-13).
 * Un ordre qu'on peut PRÉDIRE se cherche moins qu'un ordre qu'on a jugé « logique ».
 * DÉRIVÉ, jamais recopié : un nouveau rayon prend sa place tout seul.
 */
export const CATEGORY_ORDER: readonly CraftCategory[] = (Object.keys(CATEGORY_LABEL) as CraftCategory[]).sort((a, b) =>
  CATEGORY_LABEL[a].localeCompare(CATEGORY_LABEL[b], 'fr'),
)

/**
 * La catégorie de chaque recette. `Record<RecipeId, …>` est le garde-fou : ajouter
 * une recette à la sim sans lui donner de rayon ne compile plus.
 */
export const RECIPE_CATEGORY: Record<RecipeId, CraftCategory> = {
  // LE FEU DE CAMP est une recette comme une autre : elle produit un OBJET
  // (station: null → faisable partout) qu'on pose ensuite au sol.
  campfire: 'campement',
  // LE COFFRE (décision d'Alexis) : fabriqué à la main, posé en objet tenu — plus au marteau.
  chest: 'campement',
  crude_axe: 'outils',
  crude_pickaxe: 'outils',
  axe: 'outils',
  pickaxe: 'outils',
  iron_axe: 'outils',
  iron_pickaxe: 'outils',
  hammer: 'outils',
  crude_spear: 'armes',
  spear: 'armes',
  stew: 'survie',
  cooked_meat: 'survie',
  rope: 'materiaux',
  iron_ingot: 'materiaux',
  // Les COMPOSANTS (spec construction §4bis) : assemblés au Feu, posés pour émerger.
  enclume: 'composants',
  furnace: 'composants',
  four_acier: 'composants',
  workshop: 'composants',
  tour_meca: 'composants',
  atelier_lourd: 'composants',
  silo: 'composants',
  cave: 'composants',
  reserve: 'composants',
  parcelle: 'composants',
  serre: 'composants',
  terroir: 'composants',
}

/** Une ligne de la liste : un en-tête de rayon, ou une recette. */
export type CraftRow = { kind: 'header'; label: string } | { kind: 'recipe'; id: RecipeId }

/** Sans accents ni casse : taper « epieu » doit trouver « Épieu taillé ». */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * CE QUE LE PANNEAU MONTRE, ici et maintenant. Pur : `stations` = les stations à
 * portée (le contexte), `query` = la recherche. Les recettes `station: null` (la
 * couche 1, à la main) sont TOUJOURS là — on les fait n'importe où.
 *
 * Une catégorie vide ne pose pas d'en-tête : un rayon sans article n'est pas un rayon.
 */
export function craftRows(stations: readonly StationId[], query: string): CraftRow[] {
  const q = fold(query.trim())
  const visible = (Object.keys(RECIPES) as RecipeId[]).filter((id) => {
    const station = RECIPES[id].station
    if (station !== null && !stations.includes(station)) return false // LE CONTEXTE
    if (q === '') return true
    return fold(ITEM_LABELS[RECIPES[id].output]).includes(q) // LA RECHERCHE
  })

  const rows: CraftRow[] = []
  for (const cat of CATEGORY_ORDER) {
    const ids = visible.filter((id) => RECIPE_CATEGORY[id] === cat)
    if (ids.length === 0) continue
    rows.push({ kind: 'header', label: CATEGORY_LABEL[cat] })
    for (const id of ids) rows.push({ kind: 'recipe', id })
  }
  return rows
}

/** Le coût, en une ligne : « bois 2 · pierre 3 · corde 1 ». */
export function costLine(id: RecipeId): string {
  return bagLine(RECIPES[id].inputs)
}

export function bagLine(inputs: ItemBag): string {
  return (Object.keys(inputs) as ItemId[])
    .map((item) => `${ITEM_LABELS[item].toLowerCase()} ${inputs[item]}`)
    .join(' · ')
}

// ─── Le rendu Phaser (placement seulement) ───────────────────────────────────

/** Largeur du panneau, et les marges qui le décollent des bords de l'écran. */
export const CRAFT_PANEL_W = 300
/** Marge haute/basse : le panneau prend TOUTE la hauteur, mais ne touche pas les bords. */
export const CRAFT_PANEL_MARGIN_Y = 28
const PANEL_W = CRAFT_PANEL_W
const ROW_H = 46
const HEADER_H = 26
const SEARCH_H = 30
const PANEL_DEPTH = 900 // même plan que l'inventaire

const TITLE = SECTION_TITLE
const HEADER = textStyle('label', 'dim')
const NAME = textStyle('body', 'body', false)
const COST = textStyle('small', 'dim', false)
const SEARCH = textStyle('label', 'body', false)

const STATION_LABEL: Record<StationId, string> = { fire: 'au Feu', workshop: "à l'atelier", furnace: 'au four' }

export interface CraftPanel {
  update(inv: Inventory, stations: StationId[]): void
  setVisible(v: boolean): void
  /** Le champ de recherche a-t-il le clavier ? (le déplacement se coupe alors) */
  isTyping(): boolean
  /** Une frappe pour le champ de recherche. `true` = elle a été consommée. */
  handleKey(key: string): boolean
}

export function createCraftPanel(
  scene: Phaser.Scene,
  send: (a: PlayerAction) => void,
  bounds: { left: number; top: number; bottom: number },
): CraftPanel {
  const x = bounds.left
  const top = bounds.top
  const height = bounds.bottom - bounds.top
  const listTop = SEARCH_H + 10
  const viewH = height - listTop

  let query = ''
  let typing = false
  let scroll = 0
  let rows: CraftRow[] = []
  let inv: Inventory = []
  let stations: StationId[] = []

  const title = scene.add.text(x, top - 26, 'ARTISANAT', TITLE).setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH)

  const searchBg = scene.add
    .rectangle(x + PANEL_W / 2, top + SEARCH_H / 2, PANEL_W, SEARCH_H, 0x14141a, 0.9)
    .setStrokeStyle(1, 0x3a3a44)
    .setScrollFactor(0)
    .setDepth(PANEL_DEPTH)
    .setInteractive({ useHandCursor: true })
  const searchText = scene.add
    .text(x + 10, top + SEARCH_H / 2, '', SEARCH)
    .setOrigin(0, 0.5)
    .setScrollFactor(0)
    .setDepth(PANEL_DEPTH)

  const drawSearch = (): void => {
    searchText.setText(query === '' ? (typing ? '|' : 'rechercher…') : query + (typing ? '|' : ''))
    searchText.setColor(query === '' && !typing ? INK.faint : INK.body)
    searchBg.setStrokeStyle(1, typing ? 0x6b5a3a : 0x3a3a44)
  }
  searchBg.on('pointerdown', () => {
    typing = true
    drawSearch()
  })

  const listRoot = scene.add.container(x, top + listTop).setScrollFactor(0).setDepth(PANEL_DEPTH)
  const maskShape = scene.make.graphics({}, false)
  maskShape.fillStyle(0xffffff).fillRect(x, top + listTop, PANEL_W, viewH)
  listRoot.setMask(maskShape.createGeometryMask())

  const POOL = 24
  const pool = Array.from({ length: POOL }, () => {
    const bg = scene.add.rectangle(PANEL_W / 2, 0, PANEL_W, ROW_H - 4, 0x1b1b22, 0.9).setStrokeStyle(1, 0x3a3a44)
    const icon = scene.add.image(24, 0, itemIconKey('wood')).setDisplaySize(ITEM_ICON_PX * 1.6, ITEM_ICON_PX * 1.6)
    const name = scene.add.text(48, 0, '', NAME).setOrigin(0, 0)
    const cost = scene.add.text(48, 0, '', COST).setOrigin(0, 0)
    const header = scene.add.text(0, 0, '', HEADER).setOrigin(0, 0)
    bg.setInteractive({ useHandCursor: true })
    bg.on('pointerover', () => {
      if (bg.getData('recipe')) bg.setFillStyle(0x2a2a34, 0.95)
    })
    bg.on('pointerout', () => bg.setFillStyle(0x1b1b22, 0.9))
    bg.on('pointerdown', () => {
      // Un clic qui part se faire refuser pollue le flux d'événements : sans les
      // matériaux, on ne tire pas.
      if (bg.getData('ready') !== true) return
      const id = bg.getData('recipe') as RecipeId | undefined
      if (id) send({ type: 'craft', recipeId: id })
    })
    listRoot.add([bg, icon, name, cost, header])
    return { bg, icon, name, cost, header }
  })

  const contentHeight = (): number => rows.reduce((h, r) => h + (r.kind === 'header' ? HEADER_H : ROW_H), 0)

  const draw = (): void => {
    const maxScroll = Math.max(0, contentHeight() - viewH)
    scroll = Math.max(0, Math.min(scroll, maxScroll))

    let y = -scroll
    rows.forEach((row, i) => {
      const slot = pool[i]
      if (!slot) return
      const h = row.kind === 'header' ? HEADER_H : ROW_H
      if (row.kind === 'header') {
        slot.bg.setVisible(false).setData('recipe', undefined)
        slot.icon.setVisible(false)
        slot.name.setVisible(false)
        slot.cost.setVisible(false)
        slot.header.setVisible(true).setText(row.label).setY(y + 8)
      } else {
        const recipe = RECIPES[row.id]
        const ready = hasItems(inv, recipe.inputs)
        const station = recipe.station
        slot.header.setVisible(false)
        slot.bg.setVisible(true).setY(y + h / 2).setData('recipe', row.id).setData('ready', ready)
        slot.bg.setStrokeStyle(1, ready ? 0x6b5a3a : 0x3a3a44)
        slot.icon.setVisible(true).setTexture(itemIconKey(recipe.output)).setY(y + h / 2).setAlpha(ready ? 1 : 0.35)
        slot.name.setVisible(true).setText(ITEM_LABELS[recipe.output]).setY(y + 8).setColor(ready ? INK.body : INK.faint)
        slot.cost
          .setVisible(true)
          .setText(`${costLine(row.id)}  —  ${station === null ? 'à la main' : STATION_LABEL[station]}`)
          .setY(y + 26)
          .setColor(ready ? INK.dim : INK.faint)
      }
      y += h
    })
    for (let i = rows.length; i < POOL; i++) {
      const slot = pool[i]!
      slot.bg.setVisible(false).setData('recipe', undefined)
      slot.icon.setVisible(false)
      slot.name.setVisible(false)
      slot.cost.setVisible(false)
      slot.header.setVisible(false)
    }
  }

  scene.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    if (!title.visible) return
    if (p.x < x || p.x > x + PANEL_W || p.y < top || p.y > bounds.bottom) return
    scroll += dy > 0 ? ROW_H : -ROW_H
    draw()
  })

  const nodes = [title, searchBg, searchText]
  drawSearch()

  return {
    isTyping: () => typing,
    handleKey(key) {
      if (!typing) return false
      if (key === 'Escape' || key === 'Enter') typing = false
      else if (key === 'Backspace') query = query.slice(0, -1)
      else if (key.length === 1 && query.length < 18) query += key
      else return false
      drawSearch()
      scroll = 0
      rows = craftRows(stations, query)
      draw()
      return true
    },
    update(nextInv, nextStations) {
      inv = nextInv
      stations = nextStations
      rows = craftRows(stations, query)
      draw()
    },
    setVisible(v) {
      for (const n of nodes) n.setVisible(v)
      listRoot.setVisible(v)
      if (!v) {
        typing = false
        drawSearch()
      }
    },
  }
}
