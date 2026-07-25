/**
 * LE MODAL DU FEU (spec feu-station S17-S19), en DOM — ouvert à la touche E (viser un feu + E).
 * Layout calqué sur l'UI du FOUR de Rust (« after ») : un FLUX VERTICAL labellisé —
 * COMBUSTIBLE → ↓ → CUISSON (ENTRÉE → SORTIE) —, chaque section titrée avec sa/ses case(s), et une
 * BARRE DE CONTRÔLE en bas (le bouton contextuel « Fonder » / « Améliorer »). EN DESSOUS, ancré au
 * bas de l'écran, le sac + la ceinture du joueur : le MÊME composant partagé que l'écran perso.
 *
 * Le slot de cuisson est UNIQUE côté sim (l'aliment se transforme sur place) ; on le REPRÉSENTE en
 * deux cases façon four : l'aliment CRU vit dans l'ENTRÉE avec sa progression, et une fois cuit il
 * passe à la SORTIE (clic pour le reprendre). Une seule vérité (`view.cook`), deux cases à l'écran.
 *
 * AUCUNE RÈGLE DE JEU. Les gestes ne calculent QUE l'action à envoyer (feed_fire / cook_put /
 * cook_take / found_village / upgrade_fire) — la sim tranche (invariant §3). On GLISSE une bûche sur
 * la case COMBUSTIBLE, un aliment sur l'ENTRÉE (résolu par `externalDrop` du composant sac), ou clic
 * droit pour router vite. Le client n'anticipe que l'affichage (le snapshot fait foi).
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
  const fuelCell = $('.fpn-fuel')
  const fuelFill = $('.fpn-fuel-fill')
  const fuelCt = $('.fpn-fuel-ct')
  const inCell = $('.fpn-in')
  const inIcon = $<HTMLImageElement>('.fpn-in-ic')
  const inProg = $('.fpn-in-prog')
  const outCell = $('.fpn-out')
  const outIcon = $<HTMLImageElement>('.fpn-out-ic')
  const btn = $<HTMLButtonElement>('.fpn-btn')

  // La case COMBUSTIBLE montre toujours du bois (ce qu'on y met) ; la jauge + le compteur, le stock.
  $<HTMLImageElement>('.fpn-fuel-ic').src = iconUrl('wood')

  // ── Le SAC + la CEINTURE : le composant PARTAGÉ (identique à l'écran perso), ancré EN BAS. Un
  //    dépôt sur une case du feu (`data-fire`) ou un clic droit route vers feed_fire / cook_put. ──
  const grid = createInventoryGrid(game, {
    queue: hooks.queue,
    externalDrop: (_from, item, target) => routeItem(item, target.dataset.fire),
    quickMove: (_from, item) => routeItem(item, undefined),
  })
  $('.fpn-inv').appendChild(grid.root)

  /** Où va cet item ? Le bois au combustible, un aliment cuisinable à l'ENTRÉE de cuisson vide. */
  const routeItem = (item: ItemId, slot: string | undefined): PlayerAction | null => {
    if (!view) return null
    const toFuel = slot === 'fuel' || (slot === undefined && item === 'wood')
    const toCook = slot === 'cook' || (slot === undefined && item !== 'wood')
    if (toFuel && item === 'wood') return { type: 'feed_fire', structureId: view.structureId }
    if (toCook && COOK_SLOT.fire?.[item] && !view.cook) return { type: 'cook_put', structureId: view.structureId, item }
    return null
  }

  const takeCook = (): void => {
    if (view?.cook) hooks.queue({ type: 'cook_take', structureId: view.structureId })
  }
  inCell.addEventListener('click', takeCook) // reprendre l'aliment CRU (annuler la cuisson)
  outCell.addEventListener('click', takeCook) // reprendre l'aliment CUIT
  fuelCell.addEventListener('click', () => {
    if (view) hooks.queue({ type: 'feed_fire', structureId: view.structureId })
  })
  btn.addEventListener('click', () => {
    if (!view?.action) return
    if (view.action.kind === 'found') hooks.queue({ type: 'found_village', structureId: view.structureId })
    else hooks.queue({ type: 'upgrade_fire' })
  })

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
      fuelFill.style.width = `${Math.round((view.fuel / view.fuelCap) * 100)}%`
      fuelCt.textContent = `${Math.round(view.fuel)} / ${view.fuelCap}`

      // ENTRÉE = l'aliment en cours de cuisson (cru + progression) ; SORTIE = l'aliment cuit (prêt).
      const cooking = view.cook !== null && !view.cook.ready
      const done = view.cook !== null && view.cook.ready
      inIcon.style.display = cooking ? '' : 'none'
      if (cooking && view.cook) inIcon.src = iconUrl(view.cook.item)
      inProg.style.width = cooking && view.cook ? `${Math.round(view.cook.progress * 100)}%` : '0%'
      outIcon.style.display = done ? '' : 'none'
      if (done && view.cook) outIcon.src = iconUrl(view.cook.item)

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
    /* MODAL DU FEU — calqué sur le FOUR de Rust (« after ») : un FLUX VERTICAL (COMBUSTIBLE → ↓ →
       ENTRÉE → ↓ → SORTIE) dans un panneau, une BARRE DE CONTRÔLE en bas, et le sac + ceinture
       ANCRÉS EN BAS (la ceinture à bottom:26, PILE sa place au HUD → elle ne bouge pas à l'ouverture). */
    .fpn{position:absolute;inset:0;background:rgba(20,16,12,.72);display:none;pointer-events:auto;}
    .fpn-close{position:absolute;top:24px;right:30px;font-size:12px;color:#8b8474;letter-spacing:1px;}
    /* Le sac+ceinture (composant partagé) : bottom:7 = 26 (place HUD de la ceinture) moins le liseré
       (3) et le rembourrage (16) du cadre autour de la ligne du bas. */
    .fpn-inv{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);}
    /* Le panneau station, juste au-dessus du sac. Étroit, en colonne, façon four de Rust. */
    .fpn-card{position:absolute;left:50%;bottom:350px;transform:translateX(-50%);width:400px;background:#16120d;
      border:3px solid #2a2a34;box-shadow:0 0 40px rgba(232,163,58,.08);display:flex;flex-direction:column;}
    .fpn-h{display:flex;justify-content:space-between;align-items:baseline;padding:14px 18px;border-bottom:1px solid #2a2a34;}
    .fpn-title{font-size:15px;font-weight:700;color:#f2ead0;letter-spacing:2px;}
    .fpn-state{font-size:12px;letter-spacing:2px;}
    .fpn-flow{padding:14px 18px;display:flex;flex-direction:column;gap:6px;}
    .fpn-sec-lbl{font-size:12px;color:#c98b3a;letter-spacing:2px;margin-bottom:2px;}
    /* Une case de station : carrée, façon slot Rust, cible de dépôt (data-fire). */
    .fpn-cell{position:relative;width:70px;height:70px;background:#1b1b22;border:3px solid #14141a;display:grid;place-items:center;cursor:pointer;flex:0 0 auto;}
    .fpn-cell[data-drop]:hover{border-color:#6b5a3a;}
    .fpn-cell-ic{width:40px;height:40px;image-rendering:pixelated;pointer-events:none;}
    /* La flèche de flux entre les sections, comme le four de Rust. */
    .fpn-arrow{color:#6b5a3a;font-size:15px;line-height:1;text-align:center;margin:2px 0;}
    /* COMBUSTIBLE : la case bois + une jauge + le compteur, à droite. */
    .fpn-row{display:flex;align-items:center;gap:14px;}
    .fpn-meter{display:flex;flex-direction:column;gap:6px;min-width:180px;}
    .fpn-fuel-bar{height:12px;background:#2a2320;border:1px solid #14141a;}
    .fpn-fuel-fill{height:100%;background:linear-gradient(90deg,#b5602a,#e8a33a);transition:width .2s ease;}
    .fpn-fuel-ct{font-size:12px;color:#9a8f78;letter-spacing:1px;}
    .fpn-hint{font-size:11px;color:#8b8474;letter-spacing:.5px;}
    .fpn-in-pbar{position:absolute;left:0;right:0;bottom:0;height:5px;background:#2a2320;}
    .fpn-in-prog{height:100%;background:#8a9a4a;transition:width .2s ease;}
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
      <div class="fpn-sec-lbl">COMBUSTIBLE</div>
      <div class="fpn-row">
        <div class="fpn-cell fpn-fuel" data-drop data-fire="fuel"><img class="fpn-cell-ic fpn-fuel-ic" alt=""></div>
        <div class="fpn-meter">
          <div class="fpn-fuel-bar"><div class="fpn-fuel-fill"></div></div>
          <div class="fpn-fuel-ct"></div>
          <div class="fpn-hint">glisser des bûches</div>
        </div>
      </div>
      <div class="fpn-arrow">▼</div>
      <div class="fpn-sec-lbl">ENTRÉE — à cuire</div>
      <div class="fpn-row">
        <div class="fpn-cell fpn-in" data-drop data-fire="cook"><img class="fpn-cell-ic fpn-in-ic" alt="" style="display:none"><div class="fpn-in-pbar"><div class="fpn-in-prog"></div></div></div>
        <div class="fpn-hint">glisser un aliment (viande…)</div>
      </div>
      <div class="fpn-arrow">▼</div>
      <div class="fpn-sec-lbl">SORTIE — cuit</div>
      <div class="fpn-row">
        <div class="fpn-cell fpn-out"><img class="fpn-cell-ic fpn-out-ic" alt="" style="display:none"></div>
        <div class="fpn-hint">clic pour reprendre</div>
      </div>
    </div>
    <button class="fpn-btn hud-click"></button>
  </div>
  <div class="fpn-inv"></div>`
}
