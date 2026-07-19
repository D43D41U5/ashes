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
  skillLevel,
  type CarryTier,
  type Inventory,
  type ItemId,
  type PlayerAction,
  type RecipeId,
  type SkillId,
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

/** Les 4 métiers, à gauche : emblème (une icône d'objet du métier), libellé, niveau, barre.
 *  Le niveau vient de `skillLevel` (/sim) — l'écran montre la règle, il ne la refait pas. */
const SKILL_META: { id: SkillId; label: string; item: ItemId }[] = [
  { id: 'woodcutting', label: 'Bûcheron', item: 'axe' },
  { id: 'mining', label: 'Mineur', item: 'pickaxe' },
  { id: 'foraging', label: 'Cueilleur', item: 'berries' },
  { id: 'crafting', label: 'Artisan', item: 'hammer' },
]

/** Le paperdoll autour de l'avatar. DÉCORATIF pour l'instant : aucun système d'équipement
 *  n'existe encore dans /sim (le seul « equip » est l'outil en case active). Les cases sont
 *  posées vides — le jour où l'équipement existera, elles s'y brancheront (spec à écrire). */
const EQUIP_LEFT: { key: string; label: string }[] = [
  { key: 'head', label: 'TÊTE' },
  { key: 'chest', label: 'TORSE' },
  { key: 'hands', label: 'MAINS' },
]
const EQUIP_RIGHT: { key: string; label: string }[] = [
  { key: 'back', label: 'DOS' },
  { key: 'legs', label: 'JAMBES' },
  { key: 'feet', label: 'PIEDS' },
]

export interface HudCharacter {
  update(s: {
    open: boolean
    inv: Inventory
    activeSlot: number
    stations: readonly StationId[]
    container: OpenContainerView | null
    skills: Partial<Record<SkillId, number>>
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
  const skillsWrap = $('.hch-skills')

  // ── L'avatar : le VRAI sprite du monde (`spr-player`), à ses proportions (carré, pixel) —
  //    la même effigie qu'en jeu, pour que le joueur se reconnaisse. ──
  $<HTMLImageElement>('.hch-av').src = game.textures.getBase64('spr-player')

  // ── Les cartes de métier (à gauche) : bâties une fois, la barre repeinte à l'update. ──
  const skillBars: { fill: HTMLElement; lvl: HTMLElement }[] = SKILL_META.map((sk) => {
    const el = document.createElement('div')
    el.className = 'hch-sk'
    el.innerHTML =
      `<div class="hch-sk-ic"><img src="${iconUrl(sk.item)}" alt=""></div>` +
      `<div class="hch-sk-mid">` +
      `<div class="hch-sk-top"><span class="hch-sk-name">${sk.label}</span><span class="hch-sk-lvl">niv 0</span></div>` +
      `<div class="hch-sk-bar"><div class="hch-sk-fill"></div></div></div>`
    skillsWrap.appendChild(el)
    return { fill: el.querySelector<HTMLElement>('.hch-sk-fill')!, lvl: el.querySelector<HTMLElement>('.hch-sk-lvl')! }
  })

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
    belt: boolean
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
      belt,
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
    // La ceinture affiche « ×N » comme au HUD (elle ne doit pas changer d'un écran à l'autre).
    c.count.textContent = slot.count > 1 ? (c.belt ? '×' : '') + slot.count : ''
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

      // Les métiers (à gauche) : niveau + fraction vers le suivant. La fraction, c'est la
      // partie décimale de √(xp/100) — les paliers de `skillLevel` tombent aux entiers.
      for (let i = 0; i < SKILL_META.length; i++) {
        const xp = s.skills[SKILL_META[i]!.id] ?? 0
        const level = skillLevel(xp)
        const frac = xp > 0 ? Math.min(1, Math.max(0, Math.sqrt(xp / 100) - level)) : 0
        skillBars[i]!.lvl.textContent = `niv ${level}`
        skillBars[i]!.fill.style.width = `${(frac * 100).toFixed(0)}%`
      }

      // À gauche, un seul locataire : le butin d'un conteneur ouvert PRIME sur les métiers
      // (on loote, on ne consulte pas ses stats) ; sinon les métiers reprennent la place.
      skillsWrap.style.display = container ? 'none' : ''

      // Le conteneur ouvert : sa colonne de butin (cases `side:container`).
      if (container) {
        contWrap.style.display = 'block'
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
    /* Écran façon Rust : la CEINTURE ne bouge pas (identique au HUD, bas-centre), le SAC
       se pose juste au-dessus d'elle, l'ARTISANAT tient une colonne à droite — pas d'onglet.
       Coordonnées dans le plan 1920×1080 (voir hud-dom.ts). */
    .hch{position:absolute;inset:0;background:#14100c;display:none;pointer-events:auto;
      background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.012) 0 2px,transparent 2px 4px);}
    .hch-close{position:absolute;top:24px;right:30px;font-size:12px;color:#6f6a60;letter-spacing:1px;}

    /* SAC : bas-centre, colonnes ALIGNÉES sur la ceinture, posé JUSTE au-dessus d'elle.
       bottom = 26 (ceinture) + 78 (sa hauteur) + 16 (interstice ≤20). */
    .hch-sac{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);display:flex;flex-direction:column;}
    .hch-sac-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;}
    .hch-sac-t{font-size:13px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .hch-weight{font-size:12px;letter-spacing:1px;}
    .hch-bag{display:grid;grid-template-columns:repeat(${COLS},78px);grid-auto-rows:78px;gap:5px;}
    .hch-cell{position:relative;background:#1b1b22;border:3px solid #14141a;}
    .hch-active{background:#241d14;border-color:#c98b3a;}
    .hch-ic{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;image-rendering:pixelated;pointer-events:none;}
    .hch-num{position:absolute;top:3px;left:5px;font-size:11px;color:#9a8f78;}
    .hch-ct{position:absolute;bottom:3px;right:5px;font-size:11px;color:#e8e0c8;}
    .hch-wbg{position:absolute;left:4px;right:4px;bottom:5px;height:4px;background:#3a2f22;}
    .hch-w{height:100%;background:#c98b3a;}

    /* PAPERDOLL : l'avatar (effigie pixel du vrai sprite du monde) encadré, debout sur une
       braise, flanqué de deux colonnes de slots d'équipement — DÉCORATIFS pour l'instant
       (aucun système d'équipement en /sim). Posé JUSTE au-dessus du sac. */
    /* Le bloc fait la LARGEUR DE L'INVENTAIRE (493 = la grille du sac, étiré par .hch-sac) :
       les deux colonnes de slots aux bords, le portrait au centre. Haut (2×) et bien séparé
       du sac par la marge. Les 3 slots se répartissent sur toute la hauteur (haut/milieu/bas). */
    /* PERSONNAGE : ancré en HAUT, top aligné sur ARTISANAT (top:70), largeur de l'inventaire. */
    .hch-perso{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:493px;}
    .hch-doll-h{font-size:17px;font-weight:700;color:#ffffff;letter-spacing:1px;margin-bottom:14px;}
    .hch-doll{display:flex;align-items:center;justify-content:space-between;}
    .hch-eqcol{display:flex;flex-direction:column;justify-content:space-between;height:492px;}
    .hch-eq{position:relative;width:78px;height:78px;background:rgba(27,27,34,.5);border:3px solid #14141a;display:grid;place-items:center;}
    .hch-eq-lbl{font-size:9px;color:#6f6a60;letter-spacing:1px;}
    .hch-portrait{position:relative;width:300px;height:492px;border:3px solid #2a2a34;background:#16120d;
      background-image:radial-gradient(ellipse at 50% 50%,rgba(201,139,58,.14),rgba(20,16,12,0) 60%);display:grid;place-items:center;overflow:hidden;}
    .hch-portrait::after{content:'';position:absolute;bottom:118px;left:50%;transform:translateX(-50%);width:150px;height:18px;
      background:radial-gradient(ellipse,rgba(201,139,58,.4),rgba(201,139,58,0) 70%);}
    /* MÊMES PROPORTIONS QU'EN JEU : l'emprise du joueur est 1×1,6 tuile (widthTiles/heightTiles
       de spr-player dans snapshot-view.ts) — donc un rectangle vertical, pas un carré. Centré. */
    .hch-av{position:relative;width:150px;height:240px;image-rendering:pixelated;filter:drop-shadow(0 0 10px rgba(201,139,58,.25));}

    /* MÉTIERS : colonne à GAUCHE, verticalement centrée — emblème + niveau + barre de braise
       vers le niveau suivant. S'efface quand un conteneur ouvre (le butin reprend la gauche). */
    .hch-skills{position:absolute;left:60px;top:50%;transform:translateY(-50%);width:250px;display:flex;flex-direction:column;gap:12px;}
    .hch-sk-h{font-size:13px;color:#c98b3a;letter-spacing:2px;margin-bottom:2px;}
    .hch-sk{display:flex;align-items:center;gap:12px;background:#16120d;border:3px solid #14141a;padding:10px 12px;}
    .hch-sk-ic{width:40px;height:40px;background:#1b1b22;border:2px solid #2a2a34;display:grid;place-items:center;flex:0 0 auto;}
    .hch-sk-ic img{width:28px;height:28px;image-rendering:pixelated;}
    .hch-sk-mid{flex:1;min-width:0;}
    .hch-sk-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
    .hch-sk-name{font-size:14px;color:#e8e0c8;letter-spacing:1px;}
    .hch-sk-lvl{font-size:12px;color:#c98b3a;letter-spacing:1px;}
    .hch-sk-bar{height:5px;background:#2a2320;}
    .hch-sk-fill{height:100%;background:#c98b3a;transition:width .2s ease;}

    /* CEINTURE : COPIE EXACTE du HUD (hud-core .hc-belt / .hc-slot) — même taille, même
       place, même style, pour qu'ouvrir le sac ne la fasse ni sauter ni changer. Redessinée
       ici (et non le HUD) pour que le glisser-déposer vers la ceinture marche, comme Rust. */
    .hch-belt{position:absolute;left:50%;transform:translateX(-50%);bottom:26px;display:flex;gap:5px;}
    .hch-cell-belt{width:78px;height:78px;background:rgba(27,27,34,.8);box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .hch-cell-belt.hch-active{background:rgba(27,27,34,.86);box-shadow:0 0 0 1px #14141a,0 3px 0 rgba(0,0,0,.5);}

    /* CONTENEUR ouvert (coffre, dépouille) : à GAUCHE, aligné bas — là où Rust met les
       habits. Caché tant qu'aucun conteneur n'est ouvert (basculé au JS). */
    .hch-cont{position:absolute;left:60px;bottom:120px;display:none;}
    .hch-cont-title{font-size:11px;color:#c98b3a;letter-spacing:1px;margin-bottom:8px;}
    .hch-cont-grid{display:grid;grid-template-columns:repeat(${COLS},66px);grid-auto-rows:66px;gap:6px;}
    .hch-cont-grid .hch-cell{width:66px;height:66px;}

    /* ARTISANAT : colonne à DROITE, toujours visible (pas d'onglet), dégagée du bas-centre. */
    .hch-art{position:absolute;top:70px;right:60px;width:600px;bottom:150px;display:flex;flex-direction:column;min-width:0;}
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
    .hch-ghost{position:fixed;width:44px;height:44px;image-rendering:pixelated;pointer-events:none;z-index:60;transform:translate(-50%,-50%);opacity:.85;}
  </style>
  <div class="hch-close">TAB — FERMER</div>
  <div class="hch-art">
    <div class="hch-art-h"><span class="hch-art-t">ARTISANAT</span><span class="hch-art-hint">MOLETTE POUR DÉFILER</span></div>
    <input class="hch-search" type="text" placeholder="rechercher une recette…" spellcheck="false">
    <div class="hch-list"></div>
    <div class="hch-note"></div>
  </div>
  <div class="hch-cont"><div class="hch-cont-title"></div><div class="hch-cont-grid"></div></div>
  <div class="hch-skills"><div class="hch-sk-h">MÉTIERS</div></div>
  <div class="hch-perso">
    <div class="hch-doll-h">PERSONNAGE</div>
    <div class="hch-doll">
      <div class="hch-eqcol">${EQUIP_LEFT.map((e) => `<div class="hch-eq" data-eq="${e.key}"><span class="hch-eq-lbl">${e.label}</span></div>`).join('')}</div>
      <div class="hch-portrait"><img class="hch-av" alt=""></div>
      <div class="hch-eqcol">${EQUIP_RIGHT.map((e) => `<div class="hch-eq" data-eq="${e.key}"><span class="hch-eq-lbl">${e.label}</span></div>`).join('')}</div>
    </div>
  </div>
  <div class="hch-sac">
    <div class="hch-sac-h"><span class="hch-sac-t">SAC</span><span class="hch-weight"></span></div>
    <div class="hch-bag"></div>
  </div>
  <div class="hch-belt"></div>`
}

function moveGhost(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}
