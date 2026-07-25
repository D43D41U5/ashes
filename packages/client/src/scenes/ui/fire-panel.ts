/**
 * LE MODAL DU FEU (spec feu-station S17-S19), en DOM — ouvert à la touche E (viser un feu + E).
 * Layout façon LOOT/four de Rust : la STATION en haut (état + deux slots liés COMBUSTIBLE et
 * CUISSON + un bouton contextuel « Fonder » / « Améliorer »), et EN DESSOUS le sac + la ceinture
 * du joueur — le MÊME composant partagé que l'écran perso (`inventory-grid.ts`), encadré.
 *
 * AUCUNE RÈGLE DE JEU. Les gestes ne calculent QUE l'action à envoyer (feed_fire / cook_put /
 * cook_take / found_village / upgrade_fire) — la sim tranche (invariant §3). Le client n'anticipe
 * que l'affichage (le snapshot fait foi). On GLISSE une bûche sur le slot combustible, un aliment
 * sur le slot cuisson (résolu par `externalDrop` du composant sac), ou clic droit pour router vite.
 */
import { COOK_SLOT, type Inventory, type ItemId, type PlayerAction } from '@braises/sim'
import type Phaser from 'phaser'
import type { FireView } from '../../hud-state'
import { itemIconKey } from '../../render/item-art'
import { createInventoryGrid } from './inventory-grid'

const STATE_LABEL: Record<FireView['state'], string> = { lit: 'ALLUMÉ', ember: 'BRAISES', out: 'ÉTEINT' }
const STATE_COLOR: Record<FireView['state'], string> = { lit: '#e8a33a', ember: '#b5602a', out: '#6f685a' }

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
  const fuelFill = $('.fpn-fuel-fill')
  const fuelCell = $('.fpn-fuel')
  const cookCell = $('.fpn-cook')
  const cookIcon = $<HTMLImageElement>('.fpn-cook-ic')
  const cookProg = $('.fpn-cook-prog')
  const cookLabel = $('.fpn-cook-lbl')
  const btn = $<HTMLButtonElement>('.fpn-btn')

  // ── Le SAC + la CEINTURE : le composant PARTAGÉ (identique à l'écran perso). Un dépôt sur un
  //    slot du feu (`data-fire`) ou un clic droit y route vers feed_fire / cook_put. ──
  const grid = createInventoryGrid(game, {
    queue: hooks.queue,
    externalDrop: (_from, item, target) => routeItem(item, target.dataset.fire),
    quickMove: (_from, item) => routeItem(item, undefined),
  })
  $('.fpn-inv').appendChild(grid.root)

  /** Où va cet item ? Le bois au combustible, un aliment cuisinable au slot de cuisson vide.
   *  `slot` fixé (drag sur une case précise) ou libre (clic droit → on choisit selon l'item). */
  const routeItem = (item: ItemId, slot: string | undefined): PlayerAction | null => {
    if (!view) return null
    const toFuel = slot === 'fuel' || (slot === undefined && item === 'wood')
    const toCook = slot === 'cook' || (slot === undefined && item !== 'wood')
    if (toFuel && item === 'wood') return { type: 'feed_fire', structureId: view.structureId }
    if (toCook && COOK_SLOT.fire?.[item] && !view.cook) return { type: 'cook_put', structureId: view.structureId, item }
    return null
  }

  // Le slot CUISSON : un clic reprend son contenu (cru ou grillé) → le sac.
  cookCell.addEventListener('click', () => {
    if (view?.cook) hooks.queue({ type: 'cook_take', structureId: view.structureId })
  })
  // Le slot COMBUSTIBLE : un clic y jette une bûche (la sim vérifie qu'on en a).
  fuelCell.addEventListener('click', () => {
    if (view) hooks.queue({ type: 'feed_fire', structureId: view.structureId })
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
      root.style.display = view ? 'flex' : 'none'
      if (!view) {
        grid.cancelDrag()
        return
      }

      titleEl.textContent = view.title
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

      grid.update(s.inv, s.activeSlot)
    },
  }
}

function markup(): string {
  return `
  <style>
    /* MODAL DU FEU : centré, sombre, accents braise — cohérent avec l'écran perso. Layout LOOT
       façon four de Rust : la STATION (fpn-card) en haut, le sac + ceinture encadrés en dessous. */
    .fpn{position:absolute;inset:0;background:rgba(20,16,12,.72);display:none;flex-direction:column;
      align-items:center;justify-content:center;gap:16px;pointer-events:auto;}
    .fpn-close{position:absolute;top:24px;right:30px;font-size:12px;color:#8b8474;letter-spacing:1px;}
    .fpn-card{background:#16120d;border:3px solid #2a2a34;padding:22px 24px;width:530px;display:flex;flex-direction:column;gap:18px;
      box-shadow:0 0 40px rgba(232,163,58,.08);}
    .fpn-h{display:flex;justify-content:space-between;align-items:baseline;}
    .fpn-title{font-size:16px;font-weight:700;color:#f2ead0;letter-spacing:2px;}
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
    /* Un slot ARMÉ comme cible de dépôt : le liseré braise au survol du fantôme (retour visuel). */
    .fpn-slot[data-drop]:hover{border-color:#6b5a3a;}
  </style>
  <div class="fpn-close">E — FERMER</div>
  <div class="fpn-card">
    <div class="fpn-h"><span class="fpn-title">FEU DE CAMP</span><span class="fpn-state"></span></div>
    <div class="fpn-slots">
      <div class="fpn-slot fpn-fuel" data-drop data-fire="fuel">
        <div class="fpn-slot-t">COMBUSTIBLE</div>
        <div class="fpn-fuel-bar"><div class="fpn-fuel-fill"></div></div>
        <div class="fpn-slot-hint">glisser des bûches</div>
      </div>
      <div class="fpn-slot fpn-cook" data-drop data-fire="cook">
        <div class="fpn-slot-t">CUISSON</div>
        <div class="fpn-cook-box"><img class="fpn-cook-ic" alt=""><div class="fpn-cook-pbar"><div class="fpn-cook-prog"></div></div></div>
        <div class="fpn-cook-lbl fpn-slot-hint"></div>
      </div>
    </div>
    <button class="fpn-btn hud-click"></button>
  </div>
  <div class="fpn-inv"></div>`
}
