/**
 * LE MENU DU MARTEAU (spec construction R20) — SÉPARÉ du panneau d'artisanat.
 *
 * Le marteau EN MAIN ouvre ce menu ; on y choisit une PIÈCE STRUCTURELLE (mur,
 * porte, sol, toit) qui ARME le fantôme (`selected`). Ranger le marteau le referme et
 * désarme (R21) — les fantômes structurels disparaissent avec l'outil. Les COMPOSANTS
 * (enclume, four…) n'y sont PAS : ce sont des objets qu'on tient et pose.
 *
 * Pour mur/porte, une barre choisit le PALIER DE MATÉRIAU (bois → pierre → métal, R8) :
 * la pose neuve prend ce matériau, et cliquer un mur existant l'AMÉLIORE vers lui.
 *
 * Rendu ISO à la maquette Turn 4A, en DOM (voir `hud-dom.ts`) : panneau vertical au
 * bord GAUCHE, 4 pièces (armé / faisable / grisé), la barre de matériau à 3 onglets.
 * Le fantôme, lui, reste dans le monde (Phaser) : il est ancré à la TUILE. Comme tout
 * le HUD, ce panneau ne DÉCIDE rien : il arme une intention, la sim revalide la pose.
 */
import { STRUCTURE_COSTS, WALL_TIERS, hasItems, type Inventory, type ItemBag, type ItemId, type WallMaterial } from '@braises/sim'
import type { Buildable } from '../../hud-state'

/** Les pièces structurelles du menu du marteau (spec construction R20). */
export const BUILDABLES = ['wall', 'door', 'floor', 'roof'] as const
export const BUILDABLE_LABEL: Record<Buildable, string> = {
  wall: 'Mur',
  door: 'Porte',
  floor: 'Sol',
  roof: 'Toit',
}
const MATERIALS: readonly WallMaterial[] = ['wood', 'stone', 'metal']
const MATERIAL_LABEL: Record<WallMaterial, string> = { wood: 'BOIS', stone: 'PIERRE', metal: 'MÉTAL' }

/** Le coût d'une pièce, matériau compris pour mur/porte (spec construction R8). */
export function pieceCost(piece: Buildable, material: WallMaterial): ItemBag {
  if (piece === 'wall' || piece === 'door') return WALL_TIERS[material][piece].cost
  return STRUCTURE_COSTS[piece]
}

export interface BuildMenu {
  /** Rafraîchit l'affichage (grisé selon la bourse). */
  update(inv: Inventory): void
  setVisible(v: boolean): void
  /** La pièce armée (le fantôme la suit), ou `null`. */
  armed(): Buildable | null
  /** Le palier de matériau choisi pour mur/porte. */
  material(): WallMaterial
  /** Ranger le marteau : désarme et referme (R21). */
  disarm(): void
}

export function createBuildMenu(board: HTMLElement): BuildMenu {
  let armed: Buildable | null = null
  let materialIdx = 0
  let inv: Inventory = []

  const root = document.createElement('div')
  root.className = 'bmn'
  root.innerHTML = markup()
  board.appendChild(root)

  const rows = BUILDABLES.map((piece) => {
    const el = document.createElement('div')
    el.className = 'bmn-row hud-click'
    el.innerHTML = `<div class="bmn-head"><span class="bmn-name"></span><span class="bmn-arm">◤</span></div><div class="bmn-cost"></div>`
    el.addEventListener('click', () => {
      armed = armed === piece ? null : piece // bascule : recliquer désarme
      draw()
    })
    root.querySelector('.bmn-rows')!.appendChild(el)
    return { piece, el, name: el.querySelector<HTMLElement>('.bmn-name')!, cost: el.querySelector<HTMLElement>('.bmn-cost')! }
  })

  const tabs = MATERIALS.map((mat, i) => {
    const el = document.createElement('div')
    el.className = 'bmn-tab hud-click'
    el.textContent = MATERIAL_LABEL[mat]
    el.addEventListener('click', () => {
      materialIdx = i
      draw()
    })
    root.querySelector('.bmn-tabs')!.appendChild(el)
    return el
  })
  const palier = root.querySelector<HTMLElement>('.bmn-palier')!

  const have = (item: ItemId): number => inv.reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0)

  const draw = (): void => {
    const material = MATERIALS[materialIdx]!
    for (const row of rows) {
      const cost = pieceCost(row.piece, material)
      const ready = hasItems(inv, cost)
      const isArmed = armed === row.piece
      row.el.classList.toggle('bmn-armed', isArmed)
      row.el.classList.toggle('bmn-off', !ready && !isArmed)
      row.name.innerHTML = isArmed
        ? `${BUILDABLE_LABEL[row.piece]} <span class="bmn-tag">— ARMÉ</span>`
        : BUILDABLE_LABEL[row.piece]
      // Coût par matériau, le manquant en rouge (maquette : « fibre 2 (0) »).
      row.cost.innerHTML = (Object.entries(cost) as [ItemId, number][])
        .map(([item, need]) => {
          const enough = have(item) >= need
          return enough ? `${item} ${need}` : `<span class="bmn-miss">${item} ${need} (${have(item)})</span>`
        })
        .join(' · ')
    }
    tabs.forEach((t, i) => t.classList.toggle('bmn-tab-on', i === materialIdx))
    palier.textContent = `PALIER ${materialIdx + 1} / ${MATERIALS.length} · Mur & Porte suivent le palier`
  }
  draw()

  return {
    update(nextInv) {
      inv = nextInv
      draw()
    },
    setVisible(v) {
      // Explicite `flex` (pas `''`) : la règle CSS `.bmn{display:none}` reprendrait sinon.
      root.style.display = v ? 'flex' : 'none'
    },
    armed: () => armed,
    material: () => MATERIALS[materialIdx]!,
    disarm() {
      armed = null
      draw()
    },
  }
}

function markup(): string {
  return `
  <style>
    .bmn{position:absolute;left:0;top:0;bottom:150px;width:340px;background:rgba(20,16,12,.86);
      border-right:3px solid #14141a;border-bottom:3px solid #14141a;padding:24px 20px;display:none;flex-direction:column;pointer-events:auto;}
    .bmn-title{display:flex;align-items:center;gap:10px;margin-bottom:4px;}
    .bmn-title .bmn-hammer{font-size:20px;filter:grayscale(1) brightness(1.4);}
    .bmn-title .bmn-t{font-size:15px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .bmn-sub{font-size:11px;color:#6f6a60;letter-spacing:1px;margin-bottom:22px;}
    .bmn-rows{display:flex;flex-direction:column;gap:8px;}
    .bmn-row{border:2px solid #6b5a3a;background:rgba(107,90,58,.08);padding:11px 13px;transition:border-color .12s,background .12s;}
    .bmn-row.bmn-armed{border-color:#e8c66a;background:rgba(232,198,106,.1);}
    .bmn-row.bmn-off{border-color:#3a3a44;background:rgba(27,27,34,.4);}
    .bmn-head{display:flex;justify-content:space-between;align-items:center;}
    .bmn-name{font-size:14px;color:#e8e0c8;}
    .bmn-row.bmn-armed .bmn-name{color:#ffffff;}
    .bmn-row.bmn-off .bmn-name{color:#6f6a60;}
    .bmn-tag{color:#e8c66a;letter-spacing:1px;}
    .bmn-arm{font-size:11px;color:#e8c66a;opacity:0;}
    .bmn-row.bmn-armed .bmn-arm{opacity:1;}
    .bmn-cost{font-size:12px;color:#9a8f78;margin-top:4px;}
    .bmn-row.bmn-off .bmn-cost{color:#6f6a60;}
    .bmn-miss{color:#e05a4a;}
    .bmn-mat{margin-top:auto;border:2px solid #6b5a3a;background:rgba(107,90,58,.12);padding:13px;}
    .bmn-mat-h{font-size:11px;color:#9a8f78;letter-spacing:1px;margin-bottom:10px;}
    .bmn-tabs{display:flex;gap:0;border:2px solid #14141a;}
    .bmn-tab{flex:1;text-align:center;font-size:12px;padding:8px 0;background:#1b1b22;color:#6f6a60;letter-spacing:1px;}
    .bmn-tab.bmn-tab-on{background:#e8c66a;color:#14100c;font-weight:700;}
    .bmn-palier{font-size:11px;color:#6f6a60;letter-spacing:1px;margin-top:8px;}
  </style>
  <div class="bmn-title"><span class="bmn-hammer">🔨</span><span class="bmn-t">CONSTRUCTION</span></div>
  <div class="bmn-sub">RANGER LE MARTEAU POUR DÉSARMER</div>
  <div class="bmn-rows"></div>
  <div class="bmn-mat">
    <div class="bmn-mat-h">MATÉRIAU — CLIQUER POUR CYCLER</div>
    <div class="bmn-tabs"></div>
    <div class="bmn-palier"></div>
  </div>`
}
