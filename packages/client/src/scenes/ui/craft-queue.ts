/**
 * LA FILE DE CRAFT, À L'ÉCRAN (spec craft-file F15-F16). Visible MÊME inventaire
 * fermé — et MÊME inventaire OUVERT (maquette 3A la pose bas-droite, par-dessus
 * l'écran personnage) : le travail en cours n'est pas un détail de menu, c'est un
 * état du personnage, et une file bouchée doit se voir sans aller la chercher.
 *
 * Rendu ISO à la maquette (Turn 3A), en DOM (voir `hud-dom.ts`), coin bas-droit,
 * par-dessus tout le reste du HUD. Une ligne par ordre : le nom, `×N`, une barre de
 * progression, un ✕ d'annulation. Trois états, EXACTEMENT ceux de la sim (`CraftOrder`) :
 *   - en cours   : la barre avance (au rythme des snapshots, AUCUN décompte local) ;
 *   - EN PAUSE   : `paused` — la station a été quittée (F7). Rien n'est perdu ;
 *   - SAC PLEIN  : `remainingTicks === 0` — l'objet est prêt, le sac est plein (F10).
 */
import { RECIPES, type CraftOrder, type PlayerAction } from '@braises/sim'
import { ITEM_LABELS } from '../../render/item-art'

export interface CraftQueueView {
  update(queue: CraftOrder[]): void
  setVisible(v: boolean): void
}

export function createCraftQueueView(board: HTMLElement, send: (a: PlayerAction) => void): CraftQueueView {
  const root = document.createElement('div')
  root.className = 'cq'
  root.innerHTML =
    `<style>
    .cq{position:absolute;right:26px;bottom:26px;width:340px;background:rgba(20,16,12,.82);border:3px solid #14141a;
      padding:14px;z-index:10;pointer-events:auto;display:none;}
    .cq-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;}
    .cq-t{font-size:13px;color:#e8e0c8;letter-spacing:2px;}
    .cq-n{font-size:12px;color:#6f6a60;}
    .cq-row{margin-bottom:10px;}
    .cq-row:last-child{margin-bottom:0;}
    .cq-line{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
    .cq-name{font-size:14px;color:#e8e0c8;}
    .cq-mult{color:#9a8f78;}
    .cq-state{letter-spacing:1px;}
    .cq-x{font-size:14px;color:#6f6a60;cursor:pointer;padding:0 2px;}
    .cq-x:hover{color:#e05a4a;}
    .cq-barbg{height:8px;background:#1b1b22;border:1px solid #14141a;}
    .cq-bar{height:100%;background:#c9a227;}
    </style>` +
    `<div class="cq-h"><span class="cq-t">FILE DE CRAFT</span><span class="cq-n"></span></div><div class="cq-rows"></div>`
  board.appendChild(root)

  const countEl = root.querySelector<HTMLElement>('.cq-n')!
  const rowsEl = root.querySelector<HTMLElement>('.cq-rows')!
  let gated = false
  // NE RECONSTRUIRE LES LIGNES QUE SUR CHANGEMENT DE COMPOSITION : la file avance à
  // chaque frame (les barres montent), mais recréer les lignes chaque frame tuerait le
  // clic sur ✕ (recréé entre `mousedown` et `mouseup`). On garde donc les lignes stables
  // et on ne repeint QUE la largeur des barres en place.
  let lastSig = ''
  let bars: HTMLElement[] = []

  const blockedOf = (o: CraftOrder): boolean => o.remainingTicks === 0
  const widthOf = (o: CraftOrder): number =>
    blockedOf(o) ? 100 : Math.max(0, Math.min(1, o.totalTicks > 0 ? (o.totalTicks - o.remainingTicks) / o.totalTicks : 0)) * 100

  return {
    setVisible(v) {
      gated = v
      if (!v) root.style.display = 'none'
    },
    update(queue) {
      // Cachée si l'attente est cachée (chargement) OU s'il n'y a rien en file : une
      // file de craft vide n'est pas un état à montrer.
      if (!gated || queue.length === 0) {
        root.style.display = 'none'
        lastSig = ''
        return
      }
      root.style.display = 'block'
      countEl.textContent = `${queue.length} ORDRE${queue.length > 1 ? 'S' : ''}`

      // La COMPOSITION (recette, quantité, état) : ce qui décide de reconstruire.
      const sig = queue.map((o) => `${o.recipeId}:${o.count}:${o.paused}:${blockedOf(o)}`).join(',')
      if (sig !== lastSig) {
        lastSig = sig
        rowsEl.innerHTML = ''
        bars = queue.map((order, i) => {
          const blocked = blockedOf(order)
          const barColor = blocked ? '#e05a4a' : order.paused ? '#6f6a60' : '#c9a227'
          const stateTxt = blocked ? ' · sac plein' : order.paused ? ' · pause' : ''
          const xColor = blocked ? '#e05a4a' : '#6f6a60'
          const row = document.createElement('div')
          row.className = 'cq-row'
          row.innerHTML =
            `<div class="cq-line"><span class="cq-name">${ITEM_LABELS[RECIPES[order.recipeId].output]} <span class="cq-mult">×${order.count}</span>` +
            `<span class="cq-state" style="color:#c98b3a">${stateTxt}</span></span>` +
            `<span class="cq-x hud-click" style="color:${xColor}">✕</span></div>` +
            `<div class="cq-barbg"><div class="cq-bar" style="background:${barColor}"></div></div>`
          row.querySelector('.cq-x')!.addEventListener('click', () => send({ type: 'cancel_craft', index: i }))
          rowsEl.appendChild(row)
          return row.querySelector<HTMLElement>('.cq-bar')!
        })
      }
      // La barre avance à chaque frame — repeinte EN PLACE (aucune ligne recréée).
      queue.forEach((order, i) => {
        const bar = bars[i]
        if (bar) bar.style.width = `${widthOf(order).toFixed(0)}%`
      })
    },
  }
}
