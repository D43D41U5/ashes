/**
 * L'ÉCRAN PERSONNAGE (maquette Turn 3A), en DOM — le SAC + l'ARTISANAT, ouverts au TAB.
 *
 * À GAUCHE le SAC : la grille du sac + un rappel de la CEINTURE, glisser-déposer et clic
 * droit (envoi rapide). À DROITE l'ARTISANAT : recherche, recettes groupées par rayon,
 * trois états (faisable / manque / grisé), un clic FAIT. Un conteneur ouvert (coffre,
 * dépouille) ajoute sa colonne de butin. Rendu ISO à la maquette, par-dessus le canvas.
 *
 * AUCUNE RÈGLE DE JEU. Les gestes ne calculent QUE l'action à envoyer — la logique dure
 * (`dragToAction`, `quickMoveToAction`, `craftRows`) est PURE et testée, importée telle
 * quelle ; la sim tranche le résultat (invariant §3). Le client n'anticipe que l'affichage.
 */
import {
  CARRY,
  SLOTS,
  carryTier,
  carryWeight,
  durabilityOf,
  hasItems,
  RECIPES,
  type CarryTier,
  type Inventory,
  type ItemId,
  type PlayerAction,
  type RecipeId,
  type Slot,
  type SlotRef,
} from '@braises/sim'
import type Phaser from 'phaser'
import type { OpenContainerView, StationId } from '../../hud-state'
import { ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { costLine, craftRows, type CraftRow } from './craft-panel'
import { dragIntentFrom, dragToAction, quickMoveToAction } from './inventory-panel'

const COLS = 6
const BAG_LO = SLOTS.BELT // les cases 0..BELT sont la ceinture ; le sac est au-dessus
const BAG_HI = SLOTS.PLAYER

const TIER_COLOR: Record<CarryTier, string> = {
  light: '#8a9a4a',
  medium: '#c9a24a',
  heavy: '#d07a2a',
  overloaded: '#e05a4a',
}
const TIER_LABEL: Record<CarryTier, string> = {
  light: 'LÉGER',
  medium: 'MOYEN',
  heavy: 'LOURD',
  overloaded: 'SURCHARGÉ',
}
const STATION_LABEL: Record<StationId, string> = { fire: 'au Feu', workshop: "à l'atelier", furnace: 'au four' }

export interface HudCharacter {
  update(s: {
    open: boolean
    inv: Inventory
    activeSlot: number
    stations: readonly StationId[]
    container: OpenContainerView | null
  }): void
}

export function createHudCharacter(
  board: HTMLElement,
  game: Phaser.Game,
  hooks: { queue: (a: PlayerAction) => void; setTyping: (v: boolean) => void },
): HudCharacter {
  const urls = new Map<string, string>()
  const iconUrl = (item: ItemId): string => {
    const key = itemIconKey(item)
    let u = urls.get(key)
    if (u === undefined) {
      u = game.textures.getBase64(key)
      urls.set(key, u)
    }
    return u
  }

  const root = document.createElement('div')
  root.className = 'hch'
  root.innerHTML = markup()
  board.appendChild(root)

  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!
  const bagGrid = $('.hch-bag')
  const beltRow = $('.hch-belt')
  const weightEl = $('.hch-weight')
  const contWrap = $('.hch-cont')
  const contGrid = $('.hch-cont-grid')
  const contTitle = $('.hch-cont-title')
  const listEl = $('.hch-list')
  const stationNote = $('.hch-note')
  const search = $<HTMLInputElement>('.hch-search')

  // ── État courant (relu à chaque geste : la vérité vient du snapshot) ──
  let inv: Inventory = []
  let activeSlot = -1
  let stations: readonly StationId[] = []
  let container: OpenContainerView | null = null

  // ── La recherche : un vrai <input>. Focalisé = le jeu ne bouge plus (`uiTyping`). ──
  search.addEventListener('focus', () => hooks.setTyping(true))
  search.addEventListener('blur', () => hooks.setTyping(false))
  search.addEventListener('input', () => syncList())
  search.addEventListener('keydown', (e) => {
    e.stopPropagation() // le clavier va à l'input, pas au déplacement Phaser
    if (e.key === 'Escape') search.blur()
  })

  // ── Les cases : construites une fois, repeintes à l'update ──
  interface CellEl {
    el: HTMLElement
    icon: HTMLImageElement
    count: HTMLElement
    wearBg: HTMLElement
    wear: HTMLElement
    num: HTMLElement
  }
  const makeCell = (side: SlotRef['side'], slot: number, belt: boolean): CellEl => {
    const el = document.createElement('div')
    el.className = belt ? 'hch-cell hch-cell-belt hud-click' : 'hch-cell hud-click'
    el.dataset.side = side
    el.dataset.slot = String(slot)
    el.innerHTML =
      `<img class="hch-ic" alt="" style="display:none">` +
      (belt ? `<span class="hch-num">${slot + 1}</span>` : '') +
      `<span class="hch-ct"></span>` +
      `<div class="hch-wbg" style="display:none"><div class="hch-w"></div></div>`
    wireCell(el, side)
    return {
      el,
      icon: el.querySelector<HTMLImageElement>('.hch-ic')!,
      count: el.querySelector<HTMLElement>('.hch-ct')!,
      wearBg: el.querySelector<HTMLElement>('.hch-wbg')!,
      wear: el.querySelector<HTMLElement>('.hch-w')!,
      num: el.querySelector<HTMLElement>('.hch-num')!,
    }
  }

  const bagCells: CellEl[] = []
  for (let i = BAG_LO; i < BAG_HI; i++) {
    const c = makeCell('player', i, false)
    bagGrid.appendChild(c.el)
    bagCells.push(c)
  }
  const beltCells: CellEl[] = []
  for (let i = 0; i < SLOTS.BELT; i++) {
    const c = makeCell('player', i, true)
    beltRow.appendChild(c.el)
    beltCells.push(c)
  }
  let contCells: CellEl[] = []

  const slotAt = (ref: SlotRef): Slot | null => {
    if (ref.side === 'container') return container?.inv[ref.slot] ?? null
    return inv[ref.slot] ?? null
  }

  // ── Glisser-déposer (pointeur) : from → to → dragToAction. La sim tranche. ──
  let drag: { from: SlotRef; ghost: HTMLElement } | null = null
  function wireCell(el: HTMLElement, side: SlotRef['side']): void {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const slot = Number(el.dataset.slot)
      const src = slotAt({ side, slot })
      if (!src) return
      e.preventDefault()
      const ghost = document.createElement('img')
      ghost.className = 'hch-ghost'
      ghost.src = iconUrl(src.item)
      moveGhost(ghost, e.clientX, e.clientY)
      document.body.appendChild(ghost)
      drag = { from: { side, slot }, ghost }
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const slot = Number(el.dataset.slot)
      const action = quickMoveToAction({
        from: { side, slot },
        playerInv: inv,
        container: container ? { kind: container.kind, id: container.id, inv: container.inv } : null,
      })
      if (action) hooks.queue(action)
    })
  }
  document.addEventListener('mousemove', (e) => {
    if (drag) moveGhost(drag.ghost, e.clientX, e.clientY)
  })
  document.addEventListener('mouseup', (e) => {
    if (!drag) return
    const d = drag
    drag = null
    d.ghost.remove()
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-slot]')
    if (!target) return
    const to: SlotRef = { side: target.dataset.side as SlotRef['side'], slot: Number(target.dataset.slot) }
    const src = slotAt(d.from)
    if (!src) return
    const intent = dragIntentFrom(
      d.from,
      to,
      e.shiftKey,
      src,
      slotAt(to),
      container ? { kind: container.kind, id: container.id } : null,
    )
    const action = dragToAction(intent)
    if (action) hooks.queue(action)
  })

  const paintCell = (c: CellEl, slot: Slot | null, active: boolean): void => {
    c.el.classList.toggle('hch-active', active)
    if (c.num) c.num.style.color = active ? '#c98b3a' : '#9a8f78'
    if (!slot) {
      c.icon.style.display = 'none'
      c.count.textContent = ''
      c.wearBg.style.display = 'none'
      return
    }
    c.icon.src = iconUrl(slot.item)
    c.icon.style.display = ''
    c.count.textContent = slot.count > 1 ? String(slot.count) : ''
    if (slot.wear !== undefined && slot.wear > 0) {
      const left = Math.max(0, 1 - slot.wear / durabilityOf(slot.item))
      c.wearBg.style.display = ''
      c.wear.style.width = `${(left * 100).toFixed(0)}%`
    } else {
      c.wearBg.style.display = 'none'
    }
  }

  // NE RECONSTRUIRE QUE SUR CHANGEMENT. `drawList` détruit et recrée toutes les lignes ;
  // le rappeler à chaque frame RECRÉAIT la ligne entre le `mousedown` et le `mouseup` —
  // le navigateur n'émettait alors aucun `click` (craft cassé) et le scroll se remettait
  // à zéro. On ne redessine donc que si la recherche, les stations ou la bourse ont bougé.
  let lastSig = ''
  const invSig = (): string => inv.map((s) => (s ? `${s.item}:${s.count}` : '-')).join(',')
  const syncList = (): void => {
    const sig = `${search.value}|${stations.join(',')}|${invSig()}`
    if (sig === lastSig) return
    lastSig = sig
    drawList()
  }

  const drawList = (): void => {
    const rows = craftRows(stations, search.value)
    const keepScroll = listEl.scrollTop // le geste de défilement survit à la reconstruction
    listEl.innerHTML = ''
    let group: HTMLElement | null = null
    for (const row of rows) {
      if (row.kind === 'header') {
        group = document.createElement('div')
        group.className = 'hch-grp'
        group.innerHTML = `<div class="hch-cat">${row.label}</div><div class="hch-recs"></div>`
        listEl.appendChild(group)
      } else if (group) {
        group.querySelector('.hch-recs')!.appendChild(recipeRow(row))
      }
    }
    // Note « station absente » : les stations connues qu'on n'a PAS à portée.
    const ALL: StationId[] = ['furnace', 'workshop', 'fire']
    const absent = ALL.filter((s) => !stations.includes(s))
    stationNote.textContent = absent.length
      ? `RECETTES DE ${absent.map((s) => (s === 'furnace' ? 'FOUR' : s === 'workshop' ? 'FORGE' : 'FEU')).join(' & DE ')} — ABSENTES (aucune station à portée)`
      : ''
    stationNote.style.display = absent.length ? '' : 'none'
    listEl.scrollTop = keepScroll
  }

  const recipeRow = (row: Extract<CraftRow, { kind: 'recipe' }>): HTMLElement => {
    const recipe = RECIPES[row.id]
    const ready = hasItems(inv, recipe.inputs)
    const el = document.createElement('div')
    el.className = ready ? 'hch-rec hud-click' : 'hch-rec-off' // grisé = pas de survol, pas de clic
    const station = recipe.station
    el.innerHTML =
      `<div class="hch-rec-ic"><img alt="" src="${iconUrl(recipe.output)}"></div>` +
      `<div class="hch-rec-mid"><div class="hch-rec-name">${ITEM_LABELS[recipe.output]}</div>` +
      `<div class="hch-rec-cost">${costLine(row.id)} — ${station === null ? 'à la main' : STATION_LABEL[station]}</div></div>` +
      `<div class="hch-rec-state">${ready ? 'FAISABLE' : 'MANQUE'}</div>`
    if (ready) el.addEventListener('click', () => hooks.queue({ type: 'craft', recipeId: row.id as RecipeId }))
    return el
  }

  return {
    update(s) {
      root.style.display = s.open ? 'flex' : 'none'
      if (!s.open) {
        if (drag) {
          drag.ghost.remove()
          drag = null
        }
        return
      }
      inv = s.inv
      activeSlot = s.activeSlot
      stations = s.stations
      container = s.container

      for (let i = 0; i < bagCells.length; i++) paintCell(bagCells[i]!, inv[BAG_LO + i] ?? null, false)
      for (let i = 0; i < beltCells.length; i++) paintCell(beltCells[i]!, inv[i] ?? null, i === activeSlot)

      const tier = carryTier(carryWeight(inv) / CARRY_CAP)
      const w = carryWeight(inv)
      weightEl.textContent = `${w.toFixed(1)} / ${CARRY_CAP} — ${TIER_LABEL[tier]}`
      weightEl.style.color = TIER_COLOR[tier]

      // Le conteneur ouvert : sa colonne de butin (cases `side:container`).
      if (container) {
        contWrap.style.display = ''
        contTitle.textContent = container.title.toUpperCase()
        if (contCells.length !== container.inv.length) {
          contGrid.innerHTML = ''
          contCells = container.inv.map((_, i) => {
            const c = makeCell('container', i, false)
            contGrid.appendChild(c.el)
            return c
          })
        }
        for (let i = 0; i < contCells.length; i++) paintCell(contCells[i]!, container.inv[i] ?? null, false)
      } else {
        contWrap.style.display = 'none'
      }

      syncList() // ne reconstruit la liste QUE si recherche/stations/bourse ont changé
    },
  }
}

/** La capacité de portage — le dénominateur du poids (spec portage P11, /sim). */
const CARRY_CAP = CARRY.CAPACITY

function markup(): string {
  return `
  <style>
    .hch{position:absolute;inset:0;background:#14100c;display:none;flex-direction:column;padding:40px 46px 160px;pointer-events:auto;
      background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.012) 0 2px,transparent 2px 4px);}
    .hch-tabs{display:flex;gap:0;border-bottom:3px solid #2a2a34;margin-bottom:26px;}
    .hch-tab{font-size:15px;color:#9a8f78;padding:12px 24px;letter-spacing:1px;}
    .hch-tab-on{font-weight:700;color:#14100c;background:#c98b3a;}
    .hch-close{margin-left:auto;font-size:12px;color:#6f6a60;padding:12px 6px;letter-spacing:1px;align-self:center;}
    .hch-tray{flex:1;min-height:0;display:flex;border:3px solid #2a2a34;background:#16120d;}
    .hch-sac{width:640px;padding:22px;box-sizing:border-box;display:flex;flex-direction:column;}
    .hch-sac-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;}
    .hch-sac-t{font-size:15px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .hch-weight{font-size:12px;letter-spacing:1px;}
    .hch-bag{display:grid;grid-template-columns:repeat(${COLS},84px);grid-auto-rows:84px;gap:6px;}
    .hch-cell{position:relative;background:#1b1b22;border:3px solid #14141a;}
    .hch-cell-belt{width:84px;height:84px;}
    .hch-active{background:#241d14;border-color:#c98b3a;}
    .hch-ic{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:52px;height:52px;image-rendering:pixelated;pointer-events:none;}
    .hch-num{position:absolute;top:3px;left:5px;font-size:12px;color:#9a8f78;}
    .hch-ct{position:absolute;bottom:3px;right:6px;font-size:13px;color:#e8e0c8;}
    .hch-wbg{position:absolute;left:4px;right:4px;bottom:4px;height:4px;background:#3a2f22;}
    .hch-w{height:100%;background:#c98b3a;}
    .hch-belt-lbl{font-size:11px;color:#6f6a60;letter-spacing:1px;margin-bottom:8px;}
    .hch-belt-wrap{margin-top:auto;padding-top:18px;}
    .hch-belt{display:flex;gap:6px;}
    .hch-cont{margin-top:16px;}
    .hch-cont-title{font-size:11px;color:#c98b3a;letter-spacing:1px;margin-bottom:8px;}
    .hch-cont-grid{display:grid;grid-template-columns:repeat(${COLS},66px);grid-auto-rows:66px;gap:6px;}
    .hch-cont-grid .hch-cell{width:66px;height:66px;}
    .hch-div{width:3px;background:#2a2a34;}
    .hch-art{flex:1;padding:22px;box-sizing:border-box;display:flex;flex-direction:column;min-width:0;}
    .hch-art-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;}
    .hch-art-t{font-size:17px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .hch-art-hint{font-size:12px;color:#6f6a60;letter-spacing:1px;}
    .hch-search{background:#1b1b22;border:3px solid #14141a;padding:12px 14px;font-size:16px;color:#e8e0c8;letter-spacing:1px;
      margin-bottom:18px;font-family:inherit;outline:none;}
    .hch-search::placeholder{color:#6f6a60;}
    .hch-search:focus{border-color:#6b5a3a;}
    /* La liste défile : une VRAIE barre visible (le contenu déborde presque toujours). */
    .hch-list{flex:1;min-height:0;overflow-y:scroll;display:flex;flex-direction:column;gap:18px;padding-right:12px;
      scrollbar-width:thin;scrollbar-color:#6b5a3a #16120d;}
    .hch-list::-webkit-scrollbar{width:14px;}
    .hch-list::-webkit-scrollbar-track{background:#1b1b22;border:1px solid #14141a;}
    .hch-list::-webkit-scrollbar-thumb{background:#6b5a3a;border:3px solid #16120d;}
    .hch-list::-webkit-scrollbar-thumb:hover{background:#c98b3a;}
    .hch-cat{font-size:13px;color:#c98b3a;letter-spacing:2px;margin-bottom:10px;}
    .hch-recs{display:flex;flex-direction:column;gap:8px;}
    .hch-rec{display:flex;align-items:center;gap:14px;background:#1b1b22;border-left:3px solid #c98b3a;padding:13px 16px;}
    .hch-rec:hover{background:#2a2a34;}
    .hch-rec-off{display:flex;align-items:center;gap:14px;background:#17151a;border-left:3px solid #2a2a34;padding:13px 16px;}
    .hch-rec-ic{width:46px;height:46px;background:#14100c;border:2px solid #2a2a34;display:grid;place-items:center;flex:0 0 auto;}
    .hch-rec-ic img{width:34px;height:34px;image-rendering:pixelated;}
    .hch-rec-off .hch-rec-ic img{opacity:.4;}
    .hch-rec-mid{flex:1;min-width:0;}
    .hch-rec-name{font-size:17px;color:#e8e0c8;}
    .hch-rec-off .hch-rec-name{color:#6f6a60;}
    .hch-rec-cost{font-size:14px;color:#9a8f78;margin-top:2px;}
    .hch-rec-off .hch-rec-cost{color:#6f6a60;}
    .hch-rec-state{font-size:13px;color:#8a9a4a;letter-spacing:1px;flex:0 0 auto;}
    .hch-rec-off .hch-rec-state{color:#e05a4a;}
    .hch-note{font-size:12px;color:#6f6a60;letter-spacing:1px;margin-top:12px;padding-top:12px;border-top:1px solid #2a2a34;}
    .hch-ghost{position:fixed;width:52px;height:52px;image-rendering:pixelated;pointer-events:none;z-index:60;transform:translate(-50%,-50%);opacity:.85;}
  </style>
  <div class="hch-tabs">
    <div class="hch-tab hch-tab-on">ARTISANAT</div>
    <div class="hch-close">TAB — FERMER</div>
  </div>
  <div class="hch-tray">
    <div class="hch-sac">
      <div class="hch-sac-h"><span class="hch-sac-t">SAC</span><span class="hch-weight"></span></div>
      <div class="hch-bag"></div>
      <div class="hch-cont"><div class="hch-cont-title"></div><div class="hch-cont-grid"></div></div>
      <div class="hch-belt-wrap"><div class="hch-belt-lbl">CEINTURE</div><div class="hch-belt"></div></div>
    </div>
    <div class="hch-div"></div>
    <div class="hch-art">
      <div class="hch-art-h"><span class="hch-art-t">ARTISANAT</span><span class="hch-art-hint">MOLETTE POUR DÉFILER</span></div>
      <input class="hch-search" type="text" placeholder="rechercher une recette…" spellcheck="false">
      <div class="hch-list"></div>
      <div class="hch-note"></div>
    </div>
  </div>`
}

function moveGhost(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}
