/**
 * LE MODAL DU FEU (spec feu-station S17-S19), en DOM — ouvert à la touche E (viser un feu + E).
 * Deux slots liés : COMBUSTIBLE (glisser des bûches) et CUISSON (glisser un aliment, il cuit
 * seul), l'état lisible du feu (allumé / braises / éteint + jauge), le SAC pour glisser, et un
 * BOUTON contextuel « Fonder un Foyer » / « Améliorer le Foyer ».
 *
 * AUCUNE RÈGLE DE JEU. Les gestes ne calculent QUE l'action à envoyer (feed_fire / cook_put /
 * cook_take / found_village / upgrade_fire) — la sim tranche (invariant §3). Bâti sur le patron
 * de l'écran perso (`hud-character.ts`) : drag au pointeur (mousedown → ghost → mouseup → cible),
 * clic droit pour le routage rapide. Le client n'anticipe que l'affichage (le snapshot fait foi).
 */
import { COOK_SLOT, SLOTS, type Inventory, type ItemId, type PlayerAction } from '@braises/sim'
import type Phaser from 'phaser'
import type { FireView } from '../../hud-state'
import { itemIconKey } from '../../render/item-art'

const BAG_LO = SLOTS.BELT // 0..BELT = ceinture ; le sac commence au-dessus
const BAG_HI = SLOTS.PLAYER
const COLS = 6

const STATE_LABEL: Record<FireView['state'], string> = { lit: 'ALLUMÉ', ember: 'BRAISES', out: 'ÉTEINT' }
const STATE_COLOR: Record<FireView['state'], string> = { lit: '#e8a33a', ember: '#b5602a', out: '#6f685a' }

export interface FirePanel {
  update(s: { view: FireView | null; inv: Inventory }): void
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

  const root = document.createElement('div')
  root.className = 'fpn'
  root.innerHTML = markup()
  board.appendChild(root)
  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!

  const stateEl = $('.fpn-state')
  const fuelFill = $('.fpn-fuel-fill')
  const fuelCell = $('.fpn-fuel')
  const cookCell = $('.fpn-cook')
  const cookIcon = $<HTMLImageElement>('.fpn-cook-ic')
  const cookProg = $('.fpn-cook-prog')
  const cookLabel = $('.fpn-cook-lbl')
  const btn = $<HTMLButtonElement>('.fpn-btn')
  const bagGrid = $('.fpn-bag')

  let inv: Inventory = []
  let view: FireView | null = null

  // ── Le sac : source de drag (mousedown → ghost) + clic droit = routage rapide. ──
  interface Cell {
    el: HTMLElement
    icon: HTMLImageElement
    count: HTMLElement
  }
  let drag: { item: ItemId; ghost: HTMLElement } | null = null
  const makeCell = (slot: number): Cell => {
    const el = document.createElement('div')
    el.className = 'fpn-cell hud-click'
    el.dataset.slot = String(slot)
    el.innerHTML = `<img class="fpn-ic" alt="" style="display:none"><span class="fpn-ct"></span>`
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const src = inv[slot]
      if (!src) return
      e.preventDefault()
      const ghost = document.createElement('img')
      ghost.className = 'fpn-ghost'
      ghost.src = iconUrl(src.item)
      moveGhost(ghost, e.clientX, e.clientY)
      document.body.appendChild(ghost)
      drag = { item: src.item, ghost }
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const src = inv[slot]
      if (src) routeItem(src.item)
    })
    return {
      el,
      icon: el.querySelector<HTMLImageElement>('.fpn-ic')!,
      count: el.querySelector<HTMLElement>('.fpn-ct')!,
    }
  }
  const bagCells: Cell[] = []
  for (let i = BAG_LO; i < BAG_HI; i++) {
    const c = makeCell(i)
    bagGrid.appendChild(c.el)
    bagCells.push(c)
  }

  /** Routage rapide (clic droit) : le bois va au combustible, un aliment cuisinable au slot vide. */
  const routeItem = (item: ItemId): void => {
    if (!view) return
    if (item === 'wood') hooks.queue({ type: 'feed_fire' })
    else if (COOK_SLOT.fire?.[item] && !view.cook) hooks.queue({ type: 'cook_put', structureId: view.structureId, item })
  }

  document.addEventListener('mousemove', (e) => {
    if (drag) moveGhost(drag.ghost, e.clientX, e.clientY)
  })
  document.addEventListener('mouseup', (e) => {
    if (!drag) return
    const d = drag
    drag = null
    d.ghost.remove()
    if (!view) return
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-fire]')
    if (!target) return
    const kind = target.dataset.fire
    // Bûche → combustible ; aliment cuisinable → cuisson (slot vide). La sim revalide tout.
    if (kind === 'fuel' && d.item === 'wood') hooks.queue({ type: 'feed_fire' })
    else if (kind === 'cook' && COOK_SLOT.fire?.[d.item] && !view.cook) {
      hooks.queue({ type: 'cook_put', structureId: view.structureId, item: d.item })
    }
  })

  // Le slot CUISSON : un clic reprend son contenu (cru ou grillé) → le sac.
  cookCell.addEventListener('click', () => {
    if (view?.cook) hooks.queue({ type: 'cook_take', structureId: view.structureId })
  })
  // Le slot COMBUSTIBLE : un clic y jette une bûche (la sim vérifie qu'on en a).
  fuelCell.addEventListener('click', () => {
    if (view) hooks.queue({ type: 'feed_fire' })
  })
  // Le bouton contextuel : fonder un Foyer, ou monter le palier.
  btn.addEventListener('click', () => {
    if (!view?.action) return
    if (view.action.kind === 'found') hooks.queue({ type: 'found_village', structureId: view.structureId })
    else hooks.queue({ type: 'upgrade_fire' })
  })

  return {
    update(s) {
      view = s.view
      inv = s.inv
      root.style.display = view ? 'flex' : 'none'
      if (!view) {
        if (drag) {
          drag.ghost.remove()
          drag = null
        }
        return
      }

      stateEl.textContent = STATE_LABEL[view.state]
      stateEl.style.color = STATE_COLOR[view.state]
      fuelFill.style.width = `${Math.round((view.fuel / view.fuelCap) * 100)}%`

      if (view.cook) {
        cookIcon.src = iconUrl(view.cook.item)
        cookIcon.style.display = ''
        cookProg.style.width = `${Math.round(view.cook.progress * 100)}%`
        cookLabel.textContent = view.cook.ready ? 'PRÊT — clic pour reprendre' : 'cuisson…'
      } else {
        cookIcon.style.display = 'none'
        cookProg.style.width = '0%'
        cookLabel.textContent = 'vide — glisser un aliment'
      }

      if (view.action) {
        btn.style.display = ''
        btn.textContent = view.action.label
        btn.classList.toggle('fpn-btn-off', view.action.kind === 'upgrade' && !view.action.affordable)
      } else {
        btn.style.display = 'none'
      }

      for (let i = 0; i < bagCells.length; i++) {
        const slot = inv[BAG_LO + i] ?? null
        const c = bagCells[i]!
        if (slot) {
          c.icon.src = iconUrl(slot.item)
          c.icon.style.display = ''
          c.count.textContent = slot.count > 1 ? String(slot.count) : ''
        } else {
          c.icon.style.display = 'none'
          c.count.textContent = ''
        }
      }
    },
  }
}

function moveGhost(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

function markup(): string {
  return `
  <style>
    /* MODAL DU FEU : centré, sombre, accents braise — cohérent avec l'écran perso (hch). */
    .fpn{position:absolute;inset:0;background:rgba(20,16,12,.72);display:none;flex-direction:column;
      align-items:center;justify-content:center;gap:22px;pointer-events:auto;}
    .fpn-close{position:absolute;top:24px;right:30px;font-size:12px;color:#8b8474;letter-spacing:1px;}
    .fpn-card{background:#16120d;border:3px solid #2a2a34;padding:26px 30px;width:520px;display:flex;flex-direction:column;gap:20px;
      box-shadow:0 0 40px rgba(232,163,58,.08);}
    .fpn-h{font-size:16px;font-weight:700;color:#f2ead0;letter-spacing:2px;display:flex;justify-content:space-between;align-items:baseline;}
    .fpn-state{font-size:13px;letter-spacing:2px;}
    .fpn-slots{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
    .fpn-slot{background:#1b1b22;border:3px solid #14141a;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:120px;cursor:pointer;}
    .fpn-slot-t{font-size:12px;color:#c98b3a;letter-spacing:2px;}
    .fpn-slot-hint{font-size:11px;color:#8b8474;letter-spacing:.5px;}
    .fpn-fuel-bar{height:14px;background:#2a2320;border:1px solid #14141a;}
    .fpn-fuel-fill{height:100%;background:linear-gradient(90deg,#b5602a,#e8a33a);transition:width .2s ease;}
    .fpn-cook-box{position:relative;flex:1;display:grid;place-items:center;min-height:52px;}
    .fpn-cook-ic{width:44px;height:44px;image-rendering:pixelated;}
    .fpn-cook-pbar{position:absolute;left:0;right:0;bottom:0;height:5px;background:#2a2320;}
    .fpn-cook-prog{height:100%;background:#8a9a4a;transition:width .2s ease;}
    .fpn-btn{background:#241d14;border:3px solid #c98b3a;color:#f2ead0;font-family:inherit;font-size:14px;letter-spacing:1px;
      padding:12px;cursor:pointer;}
    .fpn-btn:hover{background:#31281a;}
    .fpn-btn-off{border-color:#4a453a;color:#8b8474;}
    .fpn-bagwrap{display:flex;flex-direction:column;gap:8px;}
    .fpn-bagt{font-size:12px;color:#8b8474;letter-spacing:2px;}
    .fpn-bag{display:grid;grid-template-columns:repeat(${COLS},58px);grid-auto-rows:58px;gap:5px;}
    .fpn-cell{position:relative;background:#1b1b22;border:3px solid #14141a;}
    .fpn-ic{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:34px;image-rendering:pixelated;pointer-events:none;}
    .fpn-ct{position:absolute;bottom:2px;right:4px;font-size:11px;color:#e8e0c8;}
    .fpn-ghost{position:fixed;width:34px;height:34px;image-rendering:pixelated;pointer-events:none;z-index:60;transform:translate(-50%,-50%);opacity:.85;}
  </style>
  <div class="fpn-close">E — FERMER</div>
  <div class="fpn-card">
    <div class="fpn-h">FEU DE CAMP<span class="fpn-state"></span></div>
    <div class="fpn-slots">
      <div class="fpn-slot fpn-fuel" data-fire="fuel">
        <div class="fpn-slot-t">COMBUSTIBLE</div>
        <div class="fpn-fuel-bar"><div class="fpn-fuel-fill"></div></div>
        <div class="fpn-slot-hint">glisser des bûches</div>
      </div>
      <div class="fpn-slot fpn-cook" data-fire="cook">
        <div class="fpn-slot-t">CUISSON</div>
        <div class="fpn-cook-box"><img class="fpn-cook-ic" alt=""><div class="fpn-cook-pbar"><div class="fpn-cook-prog"></div></div></div>
        <div class="fpn-cook-lbl fpn-slot-hint"></div>
      </div>
    </div>
    <button class="fpn-btn hud-click"></button>
  </div>
  <div class="fpn-bagwrap"><div class="fpn-bagt">SAC</div><div class="fpn-bag"></div></div>`
}
