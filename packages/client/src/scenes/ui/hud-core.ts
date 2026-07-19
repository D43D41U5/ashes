/**
 * LE HUD DE BASE (maquette Turn 2A), en DOM — « HUD posé sur le monde ».
 *
 * La bande toujours à l'écran : la ligne du jour + le lieu + le Feu du village
 * (haut-gauche), les toasts de récolte (haut-droite), les MÉDAILLONS de vitale et la
 * ligne poids/blessures/métiers (bas-gauche), la CEINTURE façon Rust (bas-centre).
 * Rendu ISO à la maquette, par-dessus le canvas (voir `hud-dom.ts`) : médaillons-
 * liquide, contour d'encre sur le texte, encre + 2 accents.
 *
 * PUREMENT DE L'AFFICHAGE + DEUX GESTES. Aucune règle de jeu : les valeurs viennent du
 * snapshot (relayées par `UIScene`). Les deux seules actions : cliquer une case de
 * ceinture (→ `set_active_slot`) ; survoler un médaillon (→ le chiffre exact). Les icônes
 * sont les VRAIES (pixel-art généré au boot), extraites en data-URL — pas les émojis de
 * la maquette, qui n'étaient qu'un mannequin.
 *
 * ÉCARTS À LA MAQUETTE, ASSUMÉS (à trancher par Alexis) : (1) le poids reste ABSTRAIT
 * « / 30 », pas en « KG » (décision actée #4) ; (2) 4 médaillons + le poids en ligne
 * secondaire (comme la maquette 2A), là où le HUD Phaser en faisait un 5ᵉ disque ;
 * (3) le Feu du village garde son MOT (tiède/neutre/sombre) au lieu des 5 pips de
 * magnitude — « prévisible dans le sens, flou dans la magnitude » ; (4) les blessures
 * gardent leur LIBELLÉ (jambe/bras/saignement), pas un simple compte.
 */
import {
  CARRY,
  carryTier,
  carryWeight,
  durabilityOf,
  skillLevel,
  SLOTS,
  TEMPERATURE,
  type CarryTier,
  type Entity,
  type Inventory,
  type ItemId,
  type SkillId,
} from '@braises/sim'
import type Phaser from 'phaser'
import { ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { vitalIconKey, type VitalId } from '../../render/vital-art'
import { INK_OUTLINE, INK_OUTLINE_STRONG } from './hud-dom'
import { HEX, VITAL_HEX } from './palette'

const BELT = SLOTS.BELT

/** La couleur du poids par palier (spec portage P11). Les SEUILS, eux, viennent de
 *  `carryTier` (/sim) : le HUD montre la règle, il ne la redéfinit pas. */
const CARRY_COLOR: Record<CarryTier, string> = {
  light: '#7e8a94',
  medium: HEX.ember,
  heavy: HEX.emberDeep,
  overloaded: HEX.alert,
}

const SKILL_LABELS: Record<SkillId, string> = {
  woodcutting: 'Bûcheron',
  mining: 'Mineur',
  foraging: 'Cueilleur',
  crafting: 'Artisan',
}

/** Les 4 vitales en médaillon (le poids, lui, passe en ligne secondaire — maquette 2A). */
const VITALS: { id: Exclude<VitalId, 'carry'>; label: string; max: number; warn?: number }[] = [
  { id: 'hp', label: 'PV', max: 100 },
  { id: 'stamina', label: 'ENDURANCE', max: 100 },
  { id: 'hunger', label: 'FAIM', max: 100, warn: 0 },
  { id: 'temperature', label: 'TEMP', max: 100, warn: TEMPERATURE.HYPOTHERMIA },
]

export interface HudCoreState {
  dayLine: string
  zone: string | undefined
  villageLine: string
  boardLine: string
  hp: number
  stamina: number
  hunger: number
  temperature: number
  wounds: Entity['wounds']
  skills: Partial<Record<SkillId, number>>
  inv: Inventory
  activeSlot: number
  /** Sac ouvert → les vitales redeviennent opaques, la ceinture s'efface (sa rangée est
   *  dans la grille). */
  characterMenuOpen: boolean
  now: number
}

export interface HudCore {
  update(s: HudCoreState): void
  /** Un butin récolté vient d'entrer : on l'empile en toast (haut-droite). */
  pushToast(item: ItemId, count: number): void
  setVisible(v: boolean): void
}

export function createHudCore(
  board: HTMLElement,
  game: Phaser.Game,
  onSlot: (slot: number) => void,
): HudCore {
  // Les icônes pixel-art, extraites une fois en data-URL (le DOM ne lit pas les textures Phaser).
  const urls = new Map<string, string>()
  const iconUrl = (key: string): string => {
    let u = urls.get(key)
    if (u === undefined) {
      u = game.textures.getBase64(key)
      urls.set(key, u)
    }
    return u
  }

  const root = document.createElement('div')
  root.className = 'hc'
  root.innerHTML = markup()
  board.appendChild(root)

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const dayEl = $('.hc-day')
  const zoneEl = $('.hc-zone')
  const villageEl = $('.hc-village')
  const boardEl = $('.hc-board')
  const toastsEl = $('.hc-toasts')
  const woundsEl = $('.hc-wounds')
  const weightEl = $('.hc-weight')
  const skillsEl = $('.hc-skills')

  // ── Les 4 médaillons : disque cerné, remplissage-liquide, icône SILHOUETTE, infobulle ──
  const fills = new Map<string, HTMLElement>()
  const tips = new Map<string, HTMLElement>()
  const vitalsWrap = $('.hc-vitals')
  for (const v of VITALS) {
    const cell = document.createElement('div')
    cell.className = 'hc-med'
    cell.innerHTML =
      `<div class="hc-tip"></div>` +
      `<div class="hc-disc"><div class="hc-fill"></div>` +
      `<img class="hc-vicon" src="${iconUrl(vitalIconKey(v.id))}" alt=""></div>`
    vitalsWrap.appendChild(cell)
    fills.set(v.id, cell.querySelector<HTMLElement>('.hc-fill')!)
    tips.set(v.id, cell.querySelector<HTMLElement>('.hc-tip')!)
  }

  // ── La ceinture : BELT cases cliquables (→ set_active_slot) ──
  const beltWrap = $('.hc-belt')
  const slots: {
    cell: HTMLElement
    num: HTMLElement
    icon: HTMLImageElement
    count: HTMLElement
    wearBg: HTMLElement
    wear: HTMLElement
  }[] = []
  for (let i = 0; i < BELT; i++) {
    const cell = document.createElement('div')
    cell.className = 'hc-slot hud-click'
    cell.innerHTML =
      `<span class="hc-num">${i + 1}</span>` +
      `<img class="hc-iicon" alt="" style="display:none">` +
      `<span class="hc-count"></span>` +
      `<div class="hc-wearbg" style="display:none"><div class="hc-wear"></div></div>`
    cell.addEventListener('click', () => onSlot(i))
    beltWrap.appendChild(cell)
    slots.push({
      cell,
      num: cell.querySelector<HTMLElement>('.hc-num')!,
      icon: cell.querySelector<HTMLImageElement>('.hc-iicon')!,
      count: cell.querySelector<HTMLElement>('.hc-count')!,
      wearBg: cell.querySelector<HTMLElement>('.hc-wearbg')!,
      wear: cell.querySelector<HTMLElement>('.hc-wear')!,
    })
  }

  // ── Les toasts de récolte (haut-droite) : fusion par item, fondu après un délai ──
  const TOAST_MS = 2600
  const FADE_MS = 500
  interface Toast {
    item: ItemId
    total: number
    at: number
    el: HTMLElement
  }
  const toasts: Toast[] = []

  return {
    setVisible(v) {
      root.style.display = v ? '' : 'none'
    },

    pushToast(item, count) {
      const now = performanceNow()
      const existing = toasts.find((t) => t.item === item)
      if (existing) {
        existing.total += count
        existing.at = now
        existing.el.style.opacity = '1'
        existing.el.querySelector<HTMLElement>('.hc-tval')!.textContent = `+${existing.total} ${label(item)}`
        return
      }
      const el = document.createElement('div')
      el.className = 'hc-toast'
      el.innerHTML = `<span class="hc-tval">+${count} ${label(item)}</span> <span class="hc-ttot"></span>`
      toastsEl.prepend(el)
      toasts.push({ item, total: count, at: now, el })
    },

    update(s) {
      lastNow = s.now // l'horloge que `pushToast` réutilise entre deux frames
      dayEl.textContent = s.dayLine
      zoneEl.textContent = s.zone ? s.zone.toUpperCase() : ''
      zoneEl.style.display = s.zone ? '' : 'none'
      villageEl.textContent = s.villageLine
      villageEl.style.display = s.villageLine ? '' : 'none'
      boardEl.textContent = s.boardLine
      boardEl.style.display = s.boardLine ? '' : 'none'

      // En jeu le HUD s'efface un peu ; sac ouvert il redevient opaque, et la ceinture
      // s'efface (sa rangée est dans la grille du sac — sinon deux ceintures à l'écran).
      root.style.setProperty('--hud-alpha', s.characterMenuOpen ? '1' : '.85')
      beltWrap.style.display = s.characterMenuOpen ? 'none' : ''

      // Vitales : hauteur du liquide + couleur (rouge sous le seuil d'alarme) + infobulle.
      const vals: Record<string, number> = {
        hp: s.hp,
        stamina: s.stamina,
        hunger: s.hunger,
        temperature: s.temperature,
      }
      for (const v of VITALS) {
        const cur = vals[v.id]!
        const frac = Math.min(1, Math.max(0, cur / v.max))
        const warn = v.warn !== undefined && cur <= v.warn
        const fill = fills.get(v.id)!
        fill.style.height = `${(frac * 100).toFixed(1)}%`
        fill.style.background = warn ? HEX.alert : VITAL_HEX[v.id].fill
        fill.style.borderTopColor = warn ? HEX.alert : VITAL_HEX[v.id].rim
        tips.get(v.id)!.textContent = `${v.label} ${Math.ceil(cur)} / ${v.max}`
      }

      // Ligne secondaire : poids (couleur par palier), blessures (libellé, rouge), métiers.
      const carry = carryWeight(s.inv)
      const tier = carryTier(carry / CARRY.CAPACITY)
      weightEl.textContent = `▲ ${carry.toFixed(carry % 1 ? 1 : 0)} / ${CARRY.CAPACITY}`
      weightEl.style.color = CARRY_COLOR[tier]
      const wounds = [
        s.wounds.leg ? 'jambe blessée' : null,
        s.wounds.arm ? 'bras blessé' : null,
        s.wounds.bleeding ? 'SAIGNEMENT (X : bander)' : null,
      ].filter(Boolean)
      woundsEl.textContent = wounds.length ? `■ ${wounds.join(' · ')}` : ''
      woundsEl.style.display = wounds.length ? '' : 'none'
      const skillsText = (Object.keys(SKILL_LABELS) as SkillId[])
        .map((id) => ({ id, level: skillLevel(s.skills[id] ?? 0) }))
        .filter(({ level }) => level > 0)
        .map(({ id, level }) => `⚒ ${SKILL_LABELS[id]} ${level}`)
        .join('  ')
      skillsEl.textContent = skillsText
      skillsEl.style.display = skillsText ? '' : 'none'

      // Ceinture : icône réelle, compte, usure, surlignage de la case tenue.
      for (let i = 0; i < BELT; i++) {
        const slot = s.inv[i] ?? null
        const sv = slots[i]!
        const active = i === s.activeSlot
        sv.cell.classList.toggle('hc-slot-active', active)
        sv.num.style.color = active ? HEX.ember : HEX.dim
        if (!slot) {
          sv.icon.style.display = 'none'
          sv.count.textContent = ''
          sv.wearBg.style.display = 'none'
          continue
        }
        sv.icon.src = iconUrl(itemIconKey(slot.item))
        sv.icon.style.display = ''
        sv.count.textContent = slot.count > 1 ? `×${slot.count}` : ''
        if (slot.wear !== undefined && slot.wear > 0) {
          const left = Math.max(0, 1 - slot.wear / durabilityOf(slot.item))
          sv.wearBg.style.display = ''
          sv.wear.style.width = `${(left * 100).toFixed(0)}%`
        } else {
          sv.wearBg.style.display = 'none'
        }
      }

      // Fondu des toasts échus.
      for (let k = toasts.length - 1; k >= 0; k--) {
        const t = toasts[k]!
        const age = s.now - t.at
        if (age > TOAST_MS + FADE_MS) {
          t.el.remove()
          toasts.splice(k, 1)
        } else if (age > TOAST_MS) {
          t.el.style.opacity = String(Math.max(0, 1 - (age - TOAST_MS) / FADE_MS))
        }
      }
    },
  }

  function label(item: ItemId): string {
    return (ITEM_LABELS[item] ?? item).toUpperCase()
  }
  // L'horloge des toasts suit le `now` que `update` reçoit ; `pushToast` peut arriver
  // hors update, on y prend donc le dernier `now` connu.
  function performanceNow(): number {
    return lastNow
  }
}

let lastNow = 0

function markup(): string {
  return `
  <style>
    .hc{--hud-alpha:.85;}
    /* haut-gauche : jour, lieu, village, tableau */
    .hc-tl{position:absolute;top:24px;left:26px;}
    .hc-day{font-size:15px;font-weight:700;color:#ffffff;letter-spacing:1px;${INK_OUTLINE_STRONG}}
    .hc-zone{font-size:12px;color:#9a8f78;letter-spacing:2px;margin-top:3px;${INK_OUTLINE}}
    .hc-village{font-size:12px;color:#c8b88a;letter-spacing:1px;margin-top:6px;${INK_OUTLINE}}
    .hc-board{font-size:12px;color:#9a8f78;letter-spacing:1px;margin-top:3px;${INK_OUTLINE}}
    /* haut-droite : toasts */
    .hc-toasts{position:absolute;top:24px;right:26px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
    .hc-toast{font-size:14px;color:#e8e0c8;letter-spacing:1px;${INK_OUTLINE_STRONG}transition:opacity .3s ease;}
    .hc-toast .hc-tval{color:#c98b3a;}
    /* bas-gauche : médaillons + ligne secondaire */
    /* z-index 10 : les vitales restent visibles PAR-DESSUS l'écran personnage (3A),
       comme la maquette (« la fenêtre ne les recouvre pas »). */
    .hc-bl{position:absolute;left:26px;bottom:24px;opacity:var(--hud-alpha);z-index:10;}
    .hc-vitals{display:flex;gap:12px;align-items:flex-end;}
    /* Le médaillon capte le survol (→ l'infobulle) ; ailleurs le HUD laisse le clic
       filer au monde. Une petite zone morte bas-gauche, comme tout HUD. */
    .hc-med{position:relative;pointer-events:auto;}
    .hc-disc{position:relative;width:70px;height:70px;border-radius:50%;background:#1b1b22;border:3px solid #14141a;overflow:hidden;box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .hc-fill{position:absolute;left:0;bottom:0;width:100%;height:0;background:#b0473c;border-top:2px solid #cf6a5c;transition:height .18s ease;}
    .hc-vicon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30px;height:30px;image-rendering:pixelated;filter:brightness(0);}
    .hc-tip{position:absolute;bottom:78px;left:50%;transform:translateX(-50%);background:#14100c;border:2px solid #14141a;padding:4px 8px;font-size:11px;color:#e8e0c8;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s ease;}
    .hc-med:hover .hc-tip{opacity:1;}
    .hc-2nd{display:flex;gap:16px;align-items:center;margin-top:10px;flex-wrap:wrap;max-width:900px;}
    .hc-weight{font-size:12px;letter-spacing:1px;${INK_OUTLINE}}
    .hc-wounds{font-size:12px;color:#e05a4a;letter-spacing:1px;${INK_OUTLINE}}
    .hc-skills{font-size:12px;color:#9a8f78;letter-spacing:1px;${INK_OUTLINE}}
    /* bas-centre : ceinture */
    .hc-belt{position:absolute;left:50%;transform:translateX(-50%);bottom:26px;display:flex;gap:5px;opacity:var(--hud-alpha);}
    .hc-slot{position:relative;width:78px;height:78px;background:rgba(27,27,34,.8);border:3px solid #14141a;box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .hc-slot-active{background:rgba(27,27,34,.86);border-color:#c98b3a;box-shadow:0 0 0 1px #14141a,0 3px 0 rgba(0,0,0,.5);}
    .hc-num{position:absolute;top:3px;left:5px;font-size:11px;color:#9a8f78;${INK_OUTLINE}}
    .hc-iicon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;image-rendering:pixelated;}
    .hc-count{position:absolute;bottom:3px;right:5px;font-size:11px;color:#e8e0c8;${INK_OUTLINE}}
    .hc-wearbg{position:absolute;left:4px;right:4px;bottom:5px;height:4px;background:#3a2f22;}
    .hc-wear{height:100%;background:#c98b3a;}
  </style>
  <div class="hc-tl">
    <div class="hc-day"></div>
    <div class="hc-zone"></div>
    <div class="hc-village"></div>
    <div class="hc-board"></div>
  </div>
  <div class="hc-toasts"></div>
  <div class="hc-bl">
    <div class="hc-vitals"></div>
    <div class="hc-2nd">
      <span class="hc-weight"></span>
      <span class="hc-wounds"></span>
      <span class="hc-skills"></span>
    </div>
  </div>
  <div class="hc-belt"></div>`
}
