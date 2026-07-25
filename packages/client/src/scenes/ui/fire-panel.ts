/**
 * LE MODAL DU FEU (spec feu-station S17-S19), en DOM — ouvert à la touche E (viser un feu + E).
 * Layout calqué sur l'UI du FOUR de Rust (« after ») : un FLUX VERTICAL labellisé, avec 3 SLOTS
 * par niveau — COMBUSTIBLE (3) → ↓ → ENTRÉE (3, à cuire) → ↓ → SORTIE (3, cuits + sous-produits) —,
 * et une BARRE DE CONTRÔLE en bas (le bouton « Fonder » / « Améliorer »). EN DESSOUS, ancré au bas
 * de l'écran, le sac + la ceinture : le MÊME composant partagé que l'écran perso.
 *
 * Les cases du feu sont de VRAIS CONTENEURS (spec feu-station) : on y DÉPOSE, RETIRE et DÉPLACE par
 * glisser-déposer (sac↔feu et feu↔feu), clic droit pour router vite. Tout part en une seule action
 * `transfer` avec une `zone` (fuel/cookIn/cookOut) — la sim tranche : la case SPÉCIALISÉE filtre ce
 * qu'elle accepte, et l'unité EN COURS de consommation (bûche qui brûle, aliment qui cuit) est
 * VERROUILLÉE (une pile bouge de `count − verrou`). Le COMBUSTIBLE affiche le TEMPS restant (pas de
 * X/Y ni jauge) ; la case qui BRÛLE porte l'INDICATEUR DE CONSOMMATION ; chaque ENTRÉE, sa progression.
 *
 * AUCUNE RÈGLE DE JEU ici. Les gestes ne calculent QUE l'action à envoyer.
 */
import { BALANCE, COOK_SLOT, stackSize, type Inventory, type ItemId, type PlayerAction, type SlotRef } from '@braises/sim'
import type Phaser from 'phaser'
import type { FireView } from '../../hud-state'
import { itemIconKey } from '../../render/item-art'
import { createInventoryGrid } from './inventory-grid'

type FireZone = 'fuel' | 'cookIn' | 'cookOut'

const STATE_LABEL: Record<FireView['state'], string> = { lit: 'ALLUMÉ', ember: 'BRAISES', out: 'ÉTEINT' }
const STATE_COLOR: Record<FireView['state'], string> = { lit: '#e8a33a', ember: '#b5602a', out: '#6f685a' }

/** Ticks → durée lisible (le temps réel de jeu que le combustible fait tenir). */
function fmtTime(ticks: number): string {
  const s = Math.round(ticks / BALANCE.TICK_RATE_HZ)
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
  if (s >= 60) return `${Math.floor(s / 60)} min`
  return `${s} s`
}

function moveGhost(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

interface Cell {
  el: HTMLElement
  icon: HTMLImageElement
  count: HTMLElement
  fill: HTMLElement
}

export interface FirePanel {
  update(s: { view: FireView | null; inv: Inventory; activeSlot: number }): void
}

export function createFirePanel(
  board: HTMLElement,
  game: Phaser.Game,
  hooks: { queue: (a: PlayerAction) => void },
): FirePanel {
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

  let view: FireView | null = null
  let currentInv: Inventory = []

  const root = document.createElement('div')
  root.className = 'fpn'
  root.innerHTML = markup()
  board.appendChild(root)
  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!

  const titleEl = $('.fpn-title')
  const stateEl = $('.fpn-state')
  const timeEl = $('.fpn-fuel-time')
  const btn = $<HTMLButtonElement>('.fpn-btn')

  // ── Une action `transfer` vers/depuis une case du feu — kind 'structure', la sim tranche. ──
  const transfer = (from: SlotRef, to: SlotRef, count: number): PlayerAction | null =>
    view && count > 0 ? { type: 'transfer', kind: 'structure', containerId: view.structureId, from, to, count } : null

  /** Le contenu affiché d'une case du feu (depuis la vue) — `null` si vide. */
  const cellSlot = (zone: FireZone, slot: number): { item: ItemId; count: number } | null => {
    if (!view) return null
    const c = zone === 'fuel' ? view.fuel[slot] : zone === 'cookIn' ? view.cookIn[slot] : view.cookOut[slot]
    return c ? { item: c.item, count: c.count } : null
  }

  /** Une case du SAC pour recevoir un retrait : même item avec de la place, sinon 1re case vide. */
  const firstBagTarget = (item: ItemId): SlotRef | null => {
    let empty = -1
    for (let i = 0; i < currentInv.length; i++) {
      const sl = currentInv[i]
      if (sl === null || sl === undefined) {
        if (empty < 0) empty = i
        continue
      }
      if (sl.item === item && sl.count < stackSize(item)) return { side: 'player', slot: i }
    }
    return empty >= 0 ? { side: 'player', slot: empty } : null
  }

  /** La zone/case du FEU où router un dépôt rapide : bois → combustible ; cuisinable → entrée. */
  const firstFireTarget = (item: ItemId): SlotRef | null => {
    if (!view) return null
    const pick = (zone: FireZone, cells: ({ item: ItemId; count: number } | null)[]): SlotRef | null => {
      let empty = -1
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        if (!c) {
          if (empty < 0) empty = i
          continue
        }
        if (c.item === item && c.count < stackSize(item)) return { side: 'container', slot: i, zone }
      }
      return empty >= 0 ? { side: 'container', slot: empty, zone } : null
    }
    if (item === 'wood') return pick('fuel', view.fuel)
    if (COOK_SLOT.fire?.[item]) return pick('cookIn', view.cookIn)
    return null
  }

  // ── Glisser DEPUIS une case du feu (retrait vers le sac, ou déplacement feu↔feu). ──
  let fdrag: { zone: FireZone; slot: number; ghost: HTMLElement } | null = null
  const makeCell = (zone: FireZone, slot: number): Cell => {
    const el = document.createElement('div')
    el.className = 'fpn-cell hud-click'
    el.dataset.drop = '' // cible de dépôt pour un glisser DEPUIS le sac (externalDrop)
    el.dataset.fzone = zone
    el.dataset.fslot = String(slot)
    el.innerHTML = `<img class="fpn-cell-ic" alt="" style="display:none"><span class="fpn-cell-ct"></span><div class="fpn-cbar"><div class="fpn-cbar-fill"></div></div>`
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !cellSlot(zone, slot)) return
      e.preventDefault()
      const cur = cellSlot(zone, slot)!
      const ghost = document.createElement('img')
      ghost.className = 'igr-ghost' // même fantôme que le sac (style global, monté par la grille)
      ghost.src = iconUrl(cur.item)
      moveGhost(ghost, e.clientX, e.clientY)
      document.body.appendChild(ghost)
      fdrag = { zone, slot, ghost }
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const cur = cellSlot(zone, slot)
      if (!cur) return
      const to = firstBagTarget(cur.item) // clic droit = retrait rapide vers le sac
      if (to) {
        const a = transfer({ side: 'container', slot, zone }, to, cur.count)
        if (a) hooks.queue(a)
      }
    })
    return {
      el,
      icon: el.querySelector<HTMLImageElement>('.fpn-cell-ic')!,
      count: el.querySelector<HTMLElement>('.fpn-cell-ct')!,
      fill: el.querySelector<HTMLElement>('.fpn-cbar-fill')!,
    }
  }
  const row = (sel: string, cells: Cell[]): void => cells.forEach((c) => $(sel).appendChild(c.el))

  const fuelCells = [0, 1, 2].map((i) => makeCell('fuel', i))
  const inCells = [0, 1, 2].map((i) => makeCell('cookIn', i))
  const outCells = [0, 1, 2].map((i) => makeCell('cookOut', i))
  row('.fpn-fuel-row', fuelCells)
  row('.fpn-in-row', inCells)
  row('.fpn-out-row', outCells)

  const onMove = (e: MouseEvent): void => {
    if (fdrag) moveGhost(fdrag.ghost, e.clientX, e.clientY)
  }
  const onUp = (e: MouseEvent): void => {
    if (!fdrag) return // un drag du SAC est géré par la grille — on ne s'en mêle pas
    const d = fdrag
    fdrag = null
    d.ghost.remove()
    const cur = cellSlot(d.zone, d.slot)
    if (!cur) return
    const from: SlotRef = { side: 'container', slot: d.slot, zone: d.zone }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const bagCell = el?.closest<HTMLElement>('.igr-cell')
    if (bagCell) {
      const a = transfer(from, { side: 'player', slot: Number(bagCell.dataset.slot) }, cur.count)
      if (a) hooks.queue(a)
      return
    }
    const fireCell = el?.closest<HTMLElement>('.fpn-cell')
    if (fireCell && !(fireCell.dataset.fzone === d.zone && Number(fireCell.dataset.fslot) === d.slot)) {
      const to: SlotRef = { side: 'container', slot: Number(fireCell.dataset.fslot), zone: fireCell.dataset.fzone as FireZone }
      const a = transfer(from, to, cur.count)
      if (a) hooks.queue(a)
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  // ── Le SAC + la CEINTURE : le composant PARTAGÉ, ancré EN BAS. Un dépôt sur une case du feu
  //    (`data-fzone`/`data-fslot`) ou un clic droit route en un `transfer` vers la bonne zone. ──
  const grid = createInventoryGrid(game, {
    queue: hooks.queue,
    externalDrop: (from, _item, target) => {
      const zone = target.dataset.fzone as FireZone | undefined
      const fslot = target.dataset.fslot
      if (!zone || fslot === undefined) return null
      return transfer(from, { side: 'container', slot: Number(fslot), zone }, currentInv[from.slot]?.count ?? 1)
    },
    quickMove: (from, item) => {
      const dest = firstFireTarget(item)
      return dest ? transfer(from, dest, currentInv[from.slot]?.count ?? 1) : null
    },
  })
  $('.fpn-inv').appendChild(grid.root)

  btn.addEventListener('click', () => {
    if (!view?.action) return
    if (view.action.kind === 'found') hooks.queue({ type: 'found_village', structureId: view.structureId })
    else hooks.queue({ type: 'upgrade_fire' })
  })

  const paint = (c: Cell, item: ItemId | null, count: number, fill: number, fillColor: string): void => {
    if (item) {
      c.icon.src = iconUrl(item)
      c.icon.style.display = ''
    } else {
      c.icon.style.display = 'none'
    }
    c.count.textContent = count > 1 ? `×${count}` : ''
    c.fill.style.width = `${Math.round(fill * 100)}%`
    c.fill.style.background = fillColor
  }

  return {
    update(s) {
      view = s.view
      currentInv = s.inv
      root.style.display = view ? 'block' : 'none'
      if (!view) {
        grid.cancelDrag()
        if (fdrag) {
          fdrag.ghost.remove()
          fdrag = null
        }
        return
      }

      titleEl.textContent = view.title
      stateEl.textContent = STATE_LABEL[view.state]
      stateEl.style.color = STATE_COLOR[view.state]
      timeEl.textContent =
        view.state === 'out' ? 'éteint' : view.state === 'ember' ? 'braises…' : `reste ${fmtTime(view.fuelTimeRemaining)}`

      for (let i = 0; i < 3; i++) {
        // COMBUSTIBLE : bois + compte ; la case qui BRÛLE porte l'indicateur de consommation.
        const f = view.fuel[i]
        paint(fuelCells[i]!, f?.item ?? null, f?.count ?? 0, i === view.fuelBurnSlot ? view.fuelBurnProgress : 0, '#c98b3a')
        // ENTRÉE : la pile crue + sa progression (l'unité EN COURS de cuisson).
        const ci = view.cookIn[i]
        paint(inCells[i]!, ci?.item ?? null, ci?.count ?? 0, ci?.progress ?? 0, '#8a9a4a')
        // SORTIE : le cuit (+ sous-produit) + son compte.
        const co = view.cookOut[i]
        paint(outCells[i]!, co?.item ?? null, co?.count ?? 0, 0, '#8a9a4a')
      }

      if (view.action) {
        btn.style.display = ''
        btn.textContent = view.action.label
        btn.classList.toggle('fpn-btn-off', view.action.kind === 'upgrade' && !view.action.affordable)
      } else {
        btn.style.display = 'none'
      }

      grid.update(s.inv, s.activeSlot)
    },
  }
}

function markup(): string {
  return `
  <style>
    /* MODAL DU FEU — four de Rust (« after ») : FLUX VERTICAL, 3 SLOTS par niveau (COMBUSTIBLE → ↓ →
       ENTRÉE → ↓ → SORTIE), barre de contrôle en bas, et le sac + ceinture ANCRÉS EN BAS (ceinture
       à bottom:26, sa place au HUD → elle ne bouge pas à l'ouverture). */
    .fpn{position:absolute;inset:0;background:rgba(20,16,12,.72);display:none;pointer-events:auto;}
    .fpn-close{position:absolute;top:24px;right:30px;font-size:12px;color:#8b8474;letter-spacing:1px;}
    .fpn-inv{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);}
    .fpn-card{position:absolute;left:50%;bottom:350px;transform:translateX(-50%);width:340px;background:#16120d;
      border:3px solid #2a2a34;box-shadow:0 0 40px rgba(232,163,58,.08);display:flex;flex-direction:column;}
    .fpn-h{display:flex;justify-content:space-between;align-items:baseline;padding:14px 18px;border-bottom:1px solid #2a2a34;}
    .fpn-title{font-size:15px;font-weight:700;color:#f2ead0;letter-spacing:2px;}
    .fpn-state{font-size:12px;letter-spacing:2px;}
    .fpn-flow{padding:14px 18px;display:flex;flex-direction:column;gap:5px;}
    .fpn-sec-lbl{font-size:12px;color:#c98b3a;letter-spacing:2px;display:flex;justify-content:space-between;align-items:baseline;}
    .fpn-fuel-time{font-size:12px;color:#f2ead0;letter-spacing:.5px;}
    .fpn-row{display:flex;gap:8px;}
    /* Une case de station : carrée, façon slot Rust, cible de dépôt (data-drop) ET source de glisser. */
    .fpn-cell{position:relative;width:78px;height:78px;background:#1b1b22;border:3px solid #14141a;display:grid;place-items:center;cursor:pointer;flex:0 0 auto;}
    .fpn-cell[data-drop]:hover{border-color:#6b5a3a;}
    .fpn-cell-ic{width:44px;height:44px;image-rendering:pixelated;pointer-events:none;}
    .fpn-cell-ct{position:absolute;bottom:2px;right:4px;font-size:11px;color:#e8e0c8;}
    /* La barre au bas de la case : CONSOMMATION (combustible) ou PROGRESSION (cuisson). Réutilisable. */
    .fpn-cbar{position:absolute;left:0;right:0;bottom:0;height:5px;background:#2a2320;}
    .fpn-cbar-fill{height:100%;width:0;transition:width .1s linear;}
    .fpn-arrow{color:#6b5a3a;font-size:15px;line-height:1;text-align:center;margin:1px 0;}
    /* La BARRE DE CONTRÔLE en bas (le bouton contextuel), façon « TURN OFF » de Rust. */
    .fpn-btn{background:#241d14;border:none;border-top:3px solid #c98b3a;color:#f2ead0;font-family:inherit;font-size:14px;
      letter-spacing:1px;padding:14px;cursor:pointer;text-align:center;}
    .fpn-btn:hover{background:#31281a;}
    .fpn-btn-off{border-top-color:#4a453a;color:#8b8474;}
  </style>
  <div class="fpn-close">E — FERMER</div>
  <div class="fpn-card">
    <div class="fpn-h"><span class="fpn-title">FEU DE CAMP</span><span class="fpn-state"></span></div>
    <div class="fpn-flow">
      <div class="fpn-sec-lbl"><span>COMBUSTIBLE</span><span class="fpn-fuel-time"></span></div>
      <div class="fpn-row fpn-fuel-row"></div>
      <div class="fpn-arrow">▼</div>
      <div class="fpn-sec-lbl"><span>ENTRÉE — à cuire</span></div>
      <div class="fpn-row fpn-in-row"></div>
      <div class="fpn-arrow">▼</div>
      <div class="fpn-sec-lbl"><span>SORTIE — cuit</span></div>
      <div class="fpn-row fpn-out-row"></div>
    </div>
    <button class="fpn-btn hud-click"></button>
  </div>
  <div class="fpn-inv"></div>`
}
