/**
 * LE MODAL DU FEU (spec feu-station S17-S19), en DOM — ouvert à la touche E (viser un feu + E).
 * Layout calqué sur l'UI du FOUR de Rust (« after ») : un FLUX VERTICAL labellisé, avec 3 SLOTS
 * par niveau — COMBUSTIBLE (3) → ↓ → ENTRÉE (3, à cuire) → ↓ → SORTIE (3, cuits + sous-produits) —,
 * et une BARRE DE CONTRÔLE en bas (le bouton « Fonder » / « Améliorer »). EN DESSOUS, ancré au bas
 * de l'écran, le sac + la ceinture : le MÊME composant partagé que l'écran perso.
 *
 * Le COMBUSTIBLE affiche le TEMPS restant avant extinction (pas de X/Y ni jauge) ; la case qui BRÛLE
 * porte l'INDICATEUR DE CONSOMMATION (la bûche en cours). Chaque ENTRÉE montre l'aliment cru + sa
 * progression ; chaque SORTIE le cuit + son compte.
 *
 * AUCUNE RÈGLE DE JEU. Les gestes ne calculent QUE l'action à envoyer — la sim tranche. On GLISSE
 * une bûche sur une case COMBUSTIBLE, un aliment sur une ENTRÉE (résolu par `externalDrop` du sac),
 * clic droit pour router vite ; un clic sur une ENTRÉE la reprend (annule), sur une SORTIE la sort.
 */
import { COOK_SLOT, BALANCE, type Inventory, type ItemId, type PlayerAction } from '@braises/sim'
import type Phaser from 'phaser'
import type { FireView } from '../../hud-state'
import { itemIconKey } from '../../render/item-art'
import { createInventoryGrid } from './inventory-grid'

const STATE_LABEL: Record<FireView['state'], string> = { lit: 'ALLUMÉ', ember: 'BRAISES', out: 'ÉTEINT' }
const STATE_COLOR: Record<FireView['state'], string> = { lit: '#e8a33a', ember: '#b5602a', out: '#6f685a' }

/** Ticks → durée lisible (le temps réel de jeu que le combustible fait tenir). */
function fmtTime(ticks: number): string {
  const s = Math.round(ticks / BALANCE.TICK_RATE_HZ)
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
  if (s >= 60) return `${Math.floor(s / 60)} min`
  return `${s} s`
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

  const root = document.createElement('div')
  root.className = 'fpn'
  root.innerHTML = markup()
  board.appendChild(root)
  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!

  const titleEl = $('.fpn-title')
  const stateEl = $('.fpn-state')
  const timeEl = $('.fpn-fuel-time')
  const btn = $<HTMLButtonElement>('.fpn-btn')

  // ── Une case de station : icône + compte + une barre (consommation / progression). ──
  const makeCell = (kind: 'fuel' | 'cook' | null, onClick: () => void): Cell => {
    const el = document.createElement('div')
    el.className = 'fpn-cell hud-click'
    if (kind) {
      el.dataset.drop = ''
      el.dataset.fire = kind
    }
    el.innerHTML = `<img class="fpn-cell-ic" alt="" style="display:none"><span class="fpn-cell-ct"></span><div class="fpn-cbar"><div class="fpn-cbar-fill"></div></div>`
    el.addEventListener('click', onClick)
    return {
      el,
      icon: el.querySelector<HTMLImageElement>('.fpn-cell-ic')!,
      count: el.querySelector<HTMLElement>('.fpn-cell-ct')!,
      fill: el.querySelector<HTMLElement>('.fpn-cbar-fill')!,
    }
  }
  const row = (sel: string, cells: Cell[]): void => cells.forEach((c) => $(sel).appendChild(c.el))

  const fuelCells = [0, 1, 2].map(() =>
    makeCell('fuel', () => {
      if (view) hooks.queue({ type: 'feed_fire', structureId: view.structureId })
    }),
  )
  const inCells = [0, 1, 2].map((i) =>
    makeCell('cook', () => {
      if (view?.cookIn[i]) hooks.queue({ type: 'cook_take_in', structureId: view.structureId, slot: i })
    }),
  )
  const outCells = [0, 1, 2].map((i) =>
    makeCell(null, () => {
      if (view?.cookOut[i]) hooks.queue({ type: 'cook_take_out', structureId: view.structureId, slot: i })
    }),
  )
  row('.fpn-fuel-row', fuelCells)
  row('.fpn-in-row', inCells)
  row('.fpn-out-row', outCells)

  // ── Le SAC + la CEINTURE : le composant PARTAGÉ, ancré EN BAS. Un dépôt sur une case du feu
  //    (`data-fire`) ou un clic droit route vers feed_fire / cook_put (première entrée libre). ──
  const grid = createInventoryGrid(game, {
    queue: hooks.queue,
    externalDrop: (_from, item, target) => routeItem(item, target.dataset.fire),
    quickMove: (_from, item) => routeItem(item, undefined),
  })
  $('.fpn-inv').appendChild(grid.root)

  const routeItem = (item: ItemId, slot: string | undefined): PlayerAction | null => {
    if (!view) return null
    const toFuel = slot === 'fuel' || (slot === undefined && item === 'wood')
    const toCook = slot === 'cook' || (slot === undefined && item !== 'wood')
    if (toFuel && item === 'wood') return { type: 'feed_fire', structureId: view.structureId }
    if (toCook && COOK_SLOT.fire?.[item]) return { type: 'cook_put', structureId: view.structureId, item }
    return null
  }

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
      root.style.display = view ? 'block' : 'none'
      if (!view) {
        grid.cancelDrag()
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
        // ENTRÉE : l'aliment cru + sa progression (vert quand prêt).
        const ci = view.cookIn[i]
        paint(inCells[i]!, ci?.item ?? null, 0, ci?.progress ?? 0, '#8a9a4a')
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
    /* Une case de station : carrée, façon slot Rust, cible de dépôt (data-fire). */
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
