/**
 * LE SAC + LA CEINTURE, en un composant PARTAGÉ (spec feu-station S18) — l'affichage
 * EXACT du panneau de personnage (mêmes cases, même style, même glisser-déposer), encadré
 * ensemble. Réutilisé tel quel par l'écran perso ET le modal du feu : une seule source, ils
 * ne peuvent pas diverger.
 *
 * AUCUNE RÈGLE DE JEU. Le geste ne calcule QUE l'action à envoyer — la logique dure
 * (`dragIntentFrom`, `dragToAction`, `quickMoveToAction`) est PURE et testée, importée telle
 * quelle. Les déplacements sac↔ceinture sont résolus ici ; tout dépôt sur une cible EXTERNE
 * (le conteneur du perso, les slots du feu) est délégué à l'hôte (`externalDrop`).
 */
import { durabilityOf, SLOTS, type Inventory, type ItemId, type PlayerAction, type Slot, type SlotRef } from '@ashes/sim'
import type Phaser from 'phaser'
import { itemIconKey } from '../../render/item-art'
import { dragIntentFrom, dragToAction } from './inventory-panel'

const BAG_LO = SLOTS.BELT // 0..BELT = ceinture ; le sac commence au-dessus
const BAG_HI = SLOTS.PLAYER

export interface InventoryGridHooks {
  queue: (a: PlayerAction) => void
  /** Dépôt sur une cible HORS sac/ceinture (le conteneur du perso, les slots du feu) : l'hôte
   *  inspecte l'élément visé et rend l'action, ou `null`. */
  externalDrop?: (from: SlotRef, item: ItemId, target: HTMLElement) => PlayerAction | null
  /** Clic droit (envoi rapide) : l'hôte route (conteneur / feu), ou `null`. */
  quickMove?: (from: SlotRef, item: ItemId) => PlayerAction | null
}

export interface InventoryGrid {
  /** La racine ENCADRÉE (sac + ceinture) à insérer dans le panneau hôte. */
  root: HTMLElement
  update(inv: Inventory, activeSlot: number): void
  /** À appeler quand le panneau hôte se ferme : annule un fantôme de drag en cours. */
  cancelDrag(): void
}

interface CellEl {
  el: HTMLElement
  icon: HTMLImageElement
  count: HTMLElement
  wearBg: HTMLElement
  wear: HTMLElement
  belt: boolean
}

export function createInventoryGrid(game: Phaser.Game, hooks: InventoryGridHooks): InventoryGrid {
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
  root.className = 'igr'
  root.innerHTML = markup()
  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!
  const bagGrid = $('.igr-bag')
  const beltRow = $('.igr-belt')

  let inv: Inventory = []
  let activeSlot = -1
  const slotAt = (ref: SlotRef): Slot | null => (ref.side === 'player' ? inv[ref.slot] ?? null : null)

  // ── Glisser-déposer (pointeur) : sac↔ceinture résolu ici ; cible externe → l'hôte. ──
  let drag: { from: SlotRef; ghost: HTMLElement } | null = null
  const makeCell = (slot: number, belt: boolean): CellEl => {
    const el = document.createElement('div')
    el.className = belt ? 'igr-cell igr-cell-belt hud-click' : 'igr-cell hud-click'
    el.dataset.side = 'player'
    el.dataset.slot = String(slot)
    el.innerHTML =
      `<img class="igr-ic" alt="" style="display:none">` +
      (belt ? `<span class="igr-num">${slot + 1}</span>` : '') +
      `<span class="igr-ct"></span>` +
      `<div class="igr-wbg" style="display:none"><div class="igr-w"></div></div>`
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const src = inv[slot]
      if (!src) return
      e.preventDefault()
      const ghost = document.createElement('img')
      ghost.className = 'igr-ghost'
      ghost.src = iconUrl(src.item)
      moveGhost(ghost, e.clientX, e.clientY)
      document.body.appendChild(ghost)
      drag = { from: { side: 'player', slot }, ghost }
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const src = inv[slot]
      if (!src) return
      const a = hooks.quickMove?.({ side: 'player', slot }, src.item)
      if (a) hooks.queue(a)
    })
    return {
      el,
      icon: el.querySelector<HTMLImageElement>('.igr-ic')!,
      count: el.querySelector<HTMLElement>('.igr-ct')!,
      wearBg: el.querySelector<HTMLElement>('.igr-wbg')!,
      wear: el.querySelector<HTMLElement>('.igr-w')!,
      belt,
    }
  }

  const bagCells: CellEl[] = []
  for (let i = BAG_LO; i < BAG_HI; i++) {
    const c = makeCell(i, false)
    bagGrid.appendChild(c.el)
    bagCells.push(c)
  }
  const beltCells: CellEl[] = []
  for (let i = 0; i < SLOTS.BELT; i++) {
    const c = makeCell(i, true)
    beltRow.appendChild(c.el)
    beltCells.push(c)
  }

  const onMove = (e: MouseEvent): void => {
    if (drag) moveGhost(drag.ghost, e.clientX, e.clientY)
  }
  const onUp = (e: MouseEvent): void => {
    if (!drag) return
    const d = drag
    drag = null
    d.ghost.remove()
    const src = slotAt(d.from)
    if (!src) return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const invCell = el?.closest<HTMLElement>('.igr-cell')
    if (invCell) {
      // Déplacement sac↔ceinture : la logique pure tranche (pas de conteneur ici).
      const to: SlotRef = { side: 'player', slot: Number(invCell.dataset.slot) }
      const action = dragToAction(dragIntentFrom(d.from, to, e.shiftKey, src, slotAt(to), null))
      if (action) hooks.queue(action)
      return
    }
    // Cible EXTERNE (conteneur, slots du feu) : l'hôte inspecte l'élément et résout.
    const target = el?.closest<HTMLElement>('[data-drop]')
    if (target) {
      const action = hooks.externalDrop?.(d.from, src.item, target)
      if (action) hooks.queue(action)
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  const paintCell = (c: CellEl, slot: Slot | null, active: boolean): void => {
    c.el.classList.toggle('igr-active', active)
    if (!slot) {
      c.icon.style.display = 'none'
      c.count.textContent = ''
      c.wearBg.style.display = 'none'
      return
    }
    c.icon.src = iconUrl(slot.item)
    c.icon.style.display = ''
    c.count.textContent = slot.count > 1 ? (c.belt ? '×' : '') + slot.count : ''
    if (slot.wear !== undefined && slot.wear > 0) {
      const left = Math.max(0, 1 - slot.wear / durabilityOf(slot.item))
      c.wearBg.style.display = ''
      c.wear.style.width = `${(left * 100).toFixed(0)}%`
    } else {
      c.wearBg.style.display = 'none'
    }
  }

  return {
    root,
    update(nextInv, nextActive) {
      inv = nextInv
      activeSlot = nextActive
      for (let i = 0; i < bagCells.length; i++) paintCell(bagCells[i]!, inv[BAG_LO + i] ?? null, false)
      for (let i = 0; i < beltCells.length; i++) paintCell(beltCells[i]!, inv[i] ?? null, i === activeSlot)
    },
    cancelDrag() {
      if (drag) {
        drag.ghost.remove()
        drag = null
      }
    },
  }
}

function moveGhost(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

/** Les cases : copie EXACTE du panneau perso (mêmes tailles/couleurs), encadrées ensemble. */
function markup(): string {
  return `
  <style>
    .igr{display:flex;flex-direction:column;gap:10px;background:#16120d;border:3px solid #2a2a34;padding:16px;}
    .igr-bag{display:grid;grid-template-columns:repeat(6,78px);grid-auto-rows:78px;gap:5px;}
    .igr-belt{display:flex;gap:5px;}
    .igr-cell{position:relative;background:#1b1b22;border:3px solid #14141a;width:78px;height:78px;}
    .igr-active{background:#241d14;border-color:#c98b3a;}
    .igr-cell-belt{background:rgba(27,27,34,.8);box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .igr-cell-belt.igr-active{background:rgba(27,27,34,.86);box-shadow:0 0 0 1px #14141a,0 3px 0 rgba(0,0,0,.5);}
    .igr-ic{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;image-rendering:pixelated;pointer-events:none;}
    .igr-num{position:absolute;top:3px;left:5px;font-size:11px;color:#9a8f78;}
    .igr-ct{position:absolute;bottom:3px;right:5px;font-size:11px;color:#e8e0c8;}
    .igr-wbg{position:absolute;left:4px;right:4px;bottom:5px;height:4px;background:#3a2f22;}
    .igr-w{height:100%;background:#c98b3a;}
    .igr-ghost{position:fixed;width:44px;height:44px;image-rendering:pixelated;pointer-events:none;z-index:60;transform:translate(-50%,-50%);opacity:.85;}
  </style>
  <div class="igr-bag"></div>
  <div class="igr-belt"></div>`
}
