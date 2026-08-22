/**
 * LA PILE D'ARTISANAT, en bas à droite (spec craft-file F15-F16 ; maquette « Pile
 * d'artisanat », décision d'Alexis du 2026-08-22).
 *
 * ─── CE QU'ELLE RÉPARE ───
 *
 * Le craft parlait à DEUX endroits : la file en bas à droite (un panneau cadré, une ligne par
 * ordre) et, quand un objet sortait, un chip « FABRIQUÉ » empilé dans les toasts de récolte EN
 * HAUT à droite. Le regard devait traverser l'écran pour suivre une seule chose. Désormais une
 * SEULE colonne, ancrée au coin, porte tout : ce qui est PRÈS du coin est MAINTENANT.
 *
 * ─── UNE TUILE, QUI VIT ───
 *
 * Une tuile par ordre de la sim (`CraftOrder`). La MÊME tuile traverse ses phases — elle ne se
 * remplace jamais par un toast :
 *   - wait    : en attente, tout éteint (gris) ;
 *   - run     : en tête, la barre ambre monte, les secondes restantes ;
 *   - paused  : la station a été quittée (F7) — gris, la barre garde sa place ;
 *   - blocked : l'objet est prêt, le sac est plein (F10) — rouge, pleine barre ;
 *   - done    : l'ordre est SORTI par le haut (son `item_crafted`) — vert, tenu `FINI_HOLD_MS` ;
 *   - depop   : elle glisse vers le coin, s'efface, et sa hauteur se referme (`DEPOP_MS`) — la
 *               pile descend d'un cran sans saut.
 * Pause et sac plein ne passent JAMAIS au vert : la tuile s'arrête, elle ne sort que quand
 * l'objet est vraiment entré dans le sac. Une annulation (✕) retire la tuile sans cérémonie.
 *
 * Le vert est celui de la faim (`VITAL_HEX.hunger`) : déjà dans la palette, pas un troisième
 * accent inventé — la grammaire « encre + 2 accents » reste intacte.
 *
 * ─── LA MÉCANIQUE EST PURE, ET PROUVÉE À PART ───
 *
 * La sim ne numérote pas ses ordres : la file est positionnelle. `reconcile` fait le lien entre
 * ce que la pile montrait et ce que la sim dit maintenant, à partir des `item_crafted` drainés
 * ce tour : un événement pour la sortie de la tête décrémente son lot, et quand le lot tombe à
 * zéro la tuile est FINIE (elle sort en vert). Ce qui disparaît de la file SANS événement a été
 * annulé. Les phases `done`/`depop` se lisent sur l'horloge Phaser (`now`), en NIVEAU — jamais
 * un timer parallèle (mémoire : une transition qui DOIT partir se pilote par âge ≥ seuil).
 */
import { BALANCE, RECIPES, type CraftOrder, type ItemId, type PlayerAction, type RecipeId } from '@ashes/sim'
import type Phaser from 'phaser'
import { ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { INK_OUTLINE } from './hud-dom'
import { HEX, VITAL_HEX } from './palette'

/** FINI : le vert se tient le temps d'être vu — un souffle, une coche — puis la tuile s'en va. */
export const FINI_HOLD_MS = 900
/** DÉPOP : glissé + fondu (55 %), puis la hauteur se referme (45 %). */
export const DEPOP_MS = 320

export type TilePhase = 'wait' | 'run' | 'paused' | 'blocked' | 'done' | 'depop'

/** Le modèle d'une tuile — pur, sans DOM. `key` est l'identité locale (la sim n'en donne pas). */
export interface TileModel {
  key: number
  recipeId: RecipeId
  count: number
  /** 0..1 — la barre. */
  progress: number
  remainingTicks: number
  phase: TilePhase
  /** Depuis quand la tuile est `done` (horloge Phaser). 0 tant qu'elle est vivante. */
  since: number
}

/** Ce que la sim dit d'un ordre, relu dans la tuile qui le porte. */
function sync(t: TileModel, o: CraftOrder, head: boolean): TileModel {
  const blocked = o.remainingTicks === 0
  const phase: TilePhase = blocked ? 'blocked' : o.paused ? 'paused' : head ? 'run' : 'wait'
  const progress = blocked ? 1 : o.totalTicks > 0 ? Math.max(0, Math.min(1, (o.totalTicks - o.remainingTicks) / o.totalTicks)) : 0
  return { ...t, count: o.count, progress, remainingTicks: o.remainingTicks, phase }
}

/**
 * UN TOUR : les tuiles vivantes d'avant, la file de la sim maintenant, les `item_crafted`
 * drainés entre les deux. Rend les tuiles vivantes (dans l'ordre de la file) et celles qui
 * viennent de FINIR (à faire sortir en vert).
 *
 * Un `item_crafted` ne peut venir que de la TÊTE (la sim ne travaille qu'elle). S'il porte la
 * sortie de la tête, c'est une unité de son lot : à zéro, la tuile a fini et la suivante devient
 * tête. Le reste se réconcilie par rang et par recette : une tuile dont la recette ne correspond
 * plus à son rang a été annulée ; un ordre sans tuile en reçoit une neuve, en attente.
 */
export function reconcile(
  live: readonly TileModel[],
  queue: readonly CraftOrder[],
  crafted: readonly ItemId[],
  now: number,
  nextKey: () => number,
): { live: TileModel[]; finished: TileModel[] } {
  const finished: TileModel[] = []
  const rest = live.map((t) => ({ ...t }))
  for (const item of crafted) {
    const head = rest[0]
    if (head === undefined || RECIPES[head.recipeId].output !== item) continue
    head.count -= 1
    if (head.count <= 0) {
      rest.shift()
      finished.push({ ...head, count: 0, progress: 1, phase: 'done', since: now })
    }
  }
  const out: TileModel[] = []
  let j = 0
  for (let i = 0; i < queue.length; i++) {
    const o = queue[i]!
    while (j < rest.length && rest[j]!.recipeId !== o.recipeId) j++ // annulée : on la saute
    const t: TileModel =
      j < rest.length
        ? rest[j++]!
        : { key: nextKey(), recipeId: o.recipeId, count: o.count, progress: 0, remainingTicks: o.remainingTicks, phase: 'wait', since: now }
    out.push(sync(t, o, i === 0))
  }
  return { live: out, finished }
}

/** La phase d'une tuile FINIE à l'instant `now` — `null` quand elle a fini de sortir. */
export function finishedPhase(since: number, now: number): 'done' | 'depop' | null {
  const age = now - since
  if (age < FINI_HOLD_MS) return 'done'
  if (age < FINI_HOLD_MS + DEPOP_MS) return 'depop'
  return null
}

export interface CraftQueueView {
  /**
   * Une frame. `queue` est la file de la sim, `crafted` les `item_crafted` drainés ce tour (ils
   * peuvent être vides), `now` l'horloge Phaser.
   */
  update(queue: readonly CraftOrder[], crafted: readonly ItemId[], now: number): void
  setVisible(v: boolean): void
}

interface TileDom {
  el: HTMLElement
  icon: HTMLImageElement
  name: HTMLElement
  mult: HTMLElement
  state: HTMLElement
  bar: HTMLElement
  x: HTMLElement
}

const PHASE_CLASSES: readonly string[] = ['cq-wait', 'cq-run', 'cq-paused', 'cq-blocked', 'cq-done', 'cq-depop']

export function createCraftQueueView(
  board: HTMLElement,
  game: Phaser.Game,
  send: (a: PlayerAction) => void,
): CraftQueueView {
  const green = VITAL_HEX.hunger
  const root = document.createElement('div')
  root.className = 'cq'
  root.innerHTML =
    `<style>
    /* LA COLONNE : ancrée au coin, transparente au clic — seul le ✕ rallume le pointeur (un
       panneau cliquable d'un bloc volait la molette et le glisser au monde). z-index 10 : elle
       se voit PAR-DESSUS l'écran personnage (maquette 3A), comme les vitales. */
    .cq{position:absolute;right:26px;bottom:26px;width:312px;z-index:10;pointer-events:none;display:none;
      flex-direction:column;align-items:stretch;gap:6px;}
    .cq-h{display:flex;justify-content:flex-end;padding:0 2px;}
    .cq-n{font-size:12px;color:${HEX.faint};letter-spacing:2px;${INK_OUTLINE}}
    /* LA TUILE : un seul composant ; ses phases ne changent que des couleurs et deux animations. */
    .cq-t{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 6px;background:rgba(20,16,12,.82);
      border:2px solid ${HEX.ink};border-left:3px solid ${HEX.ink};overflow:hidden;transform-origin:right center;
      transition:border-color .2s ease,background-color .2s ease;}
    .cq-ic{width:40px;height:40px;flex:0 0 40px;background:${HEX.panel};border:2px solid ${HEX.ink};
      display:flex;align-items:center;justify-content:center;position:relative;opacity:.7;}
    .cq-ic img{width:32px;height:32px;image-rendering:pixelated;}
    .cq-ck{position:absolute;right:-6px;bottom:-6px;width:20px;height:20px;padding:1px;background:rgba(20,16,12,.9);display:none;}
    .cq-body{display:flex;flex-direction:column;gap:5px;flex-grow:1;min-width:0;}
    .cq-line{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}
    .cq-name{font-size:14px;color:${HEX.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cq-mult{color:${HEX.faint};}
    .cq-state{font-size:11px;color:${HEX.faint};letter-spacing:1px;white-space:nowrap;}
    .cq-barbg{height:6px;background:${HEX.panel};border:1px solid ${HEX.ink};}
    .cq-bar{height:100%;width:0;background:${HEX.faint};transition:background-color .2s ease;}
    .cq-x{font-size:14px;color:${HEX.faint};padding:0 2px;flex:0 0 auto;}
    .cq-x:hover{color:${HEX.alert};}
    /* EN COURS : ambre, les secondes. */
    .cq-run{border-left-color:${HEX.ember};}
    .cq-run .cq-ic,.cq-blocked .cq-ic,.cq-done .cq-ic,.cq-depop .cq-ic{background:${HEX.armed};opacity:1;}
    .cq-run .cq-name,.cq-paused .cq-name,.cq-blocked .cq-name,.cq-done .cq-name,.cq-depop .cq-name{color:${HEX.body};}
    .cq-run .cq-state{font-size:12px;color:${HEX.emberBright};}
    .cq-run .cq-bar{background:${HEX.ember};}
    /* EN PAUSE : la barre grise garde sa place, l'état dit pourquoi. */
    .cq-paused{border-left-color:${HEX.faint};}
    .cq-paused .cq-state{color:${HEX.ember};}
    /* SAC PLEIN : rouge, pleine barre — le signal d'une file bouchée (F10). */
    .cq-blocked{border-left-color:${HEX.alert};}
    .cq-blocked .cq-state,.cq-blocked .cq-x{color:${HEX.alert};}
    .cq-blocked .cq-bar{background:${HEX.alert};}
    /* FINI : vert ; le ✕ s'éteint, la coche arrive. Plus rien à cliquer. */
    .cq-done,.cq-depop{border-left-color:${green.fill};pointer-events:none;}
    .cq-done .cq-state,.cq-depop .cq-state{color:${green.rim};font-weight:700;}
    .cq-done .cq-bar,.cq-depop .cq-bar{background:${green.fill};}
    .cq-done .cq-x,.cq-depop .cq-x{opacity:0;}
    .cq-done .cq-ck,.cq-depop .cq-ck{display:block;}
    @media (prefers-reduced-motion: no-preference){
      /* Un souffle : la tuile se gonfle de 3 % et s'éclaire, puis se pose. */
      .cq-done{animation:cq-pop .38s cubic-bezier(.2,.9,.3,1.25);}
      @keyframes cq-pop{0%{transform:scale(1);box-shadow:0 0 0 rgba(138,154,74,0);}
        40%{transform:scale(1.035);box-shadow:0 0 18px rgba(138,154,74,.55);}
        100%{transform:scale(1);box-shadow:0 0 0 rgba(138,154,74,0);}}
      /* Elle glisse vers le coin et s'efface, PUIS sa hauteur se referme : la pile descend d'un cran. */
      .cq-depop{animation:cq-out ${DEPOP_MS}ms cubic-bezier(.4,0,1,1) forwards;}
      @keyframes cq-out{0%{opacity:1;transform:translateX(0);max-height:64px;margin-bottom:0;}
        55%{opacity:0;transform:translateX(28px);max-height:64px;margin-bottom:0;}
        100%{opacity:0;transform:translateX(28px);max-height:0;padding-top:0;padding-bottom:0;border-top-width:0;border-bottom-width:0;margin-bottom:-6px;}}
    }
    @media (prefers-reduced-motion: reduce){
      .cq-depop{opacity:0;transition:opacity .2s linear;}
    }
    </style>` + `<div class="cq-h"><span class="cq-n"></span></div>`
  board.appendChild(root)

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

  const countEl = root.querySelector<HTMLElement>('.cq-n')!
  let gated = false
  let keyCounter = 0
  const nextKey = (): number => ++keyCounter
  let live: TileModel[] = []
  let finished: TileModel[] = []
  const doms = new Map<number, TileDom>()
  let lastOrder = ''

  const build = (t: TileModel): TileDom => {
    const el = document.createElement('div')
    el.className = 'cq-t'
    el.innerHTML =
      `<div class="cq-ic"><img alt="">` +
      `<svg class="cq-ck" viewBox="0 0 20 20" fill="none" stroke="${green.rim}" stroke-width="2.5" stroke-linecap="square"><path d="M4 10.5 L8.5 15 L16 6"></path></svg></div>` +
      `<div class="cq-body"><div class="cq-line"><span class="cq-name"></span><span class="cq-state"></span></div>` +
      `<div class="cq-barbg"><div class="cq-bar"></div></div></div>` +
      `<span class="cq-x hud-click">✕</span>`
    const name = el.querySelector<HTMLElement>('.cq-name')!
    name.innerHTML = `${ITEM_LABELS[RECIPES[t.recipeId].output]} <span class="cq-mult"></span>`
    const x = el.querySelector<HTMLElement>('.cq-x')!
    // L'index se lit AU CLIC : la tuile peut avoir changé de rang depuis sa création.
    x.addEventListener('click', () => {
      const i = live.findIndex((l) => l.key === t.key)
      if (i >= 0) send({ type: 'cancel_craft', index: i })
    })
    const d: TileDom = {
      el,
      icon: el.querySelector<HTMLImageElement>('img')!,
      name,
      mult: el.querySelector<HTMLElement>('.cq-mult')!,
      state: el.querySelector<HTMLElement>('.cq-state')!,
      bar: el.querySelector<HTMLElement>('.cq-bar')!,
      x,
    }
    d.icon.src = iconUrl(itemIconKey(RECIPES[t.recipeId].output))
    return d
  }

  const stateText = (t: TileModel): string => {
    switch (t.phase) {
      case 'wait':
        return 'EN ATTENTE'
      case 'run':
        return `${Math.ceil(t.remainingTicks / BALANCE.TICK_RATE_HZ)} s`
      case 'paused':
        return 'PAUSE'
      case 'blocked':
        return 'SAC PLEIN'
      default:
        return 'FABRIQUÉ'
    }
  }

  const paint = (t: TileModel): void => {
    let d = doms.get(t.key)
    if (d === undefined) {
      d = build(t)
      doms.set(t.key, d)
    }
    const cls = `cq-${t.phase}`
    if (!d.el.classList.contains(cls)) {
      d.el.classList.remove(...PHASE_CLASSES)
      d.el.classList.add(cls)
    }
    d.mult.textContent = t.count > 0 ? `×${t.count}` : ''
    d.state.textContent = stateText(t)
    d.bar.style.width = `${(t.progress * 100).toFixed(0)}%`
  }

  return {
    setVisible(v) {
      gated = v
      if (!v) root.style.display = 'none'
    },
    update(queue, crafted, now) {
      const r = reconcile(live, queue, crafted, now, nextKey)
      live = r.live
      finished = finished.concat(r.finished)
      // Les tuiles finies avancent en NIVEAU sur l'horloge : `done`, `depop`, puis plus rien.
      const still: TileModel[] = []
      for (const t of finished) {
        const p = finishedPhase(t.since, now)
        if (p === null) continue
        still.push(p === t.phase ? t : { ...t, phase: p })
      }
      finished = still

      // Cachée si l'attente est cachée (chargement) OU s'il n'y a plus rien : une pile vide
      // n'est pas un état à montrer. Les tuiles finies comptent — elles sont en train de sortir.
      if (!gated || (live.length === 0 && finished.length === 0)) {
        root.style.display = 'none'
        if (live.length === 0 && finished.length === 0) {
          for (const d of doms.values()) d.el.remove()
          doms.clear()
          lastOrder = ''
        }
        return
      }
      root.style.display = 'flex'
      const n = live.length
      countEl.textContent = n === 0 ? '' : `${n} ORDRE${n > 1 ? 'S' : ''}`

      // LA PILE SE LIT DU COIN VERS LE HAUT : la tête en bas, la file au-dessus, et ce qui
      // vient de finir sous la tête — il sort par le coin. Le DOM, lui, va du haut vers le bas.
      const order = live.slice().reverse().concat(finished)
      for (const t of order) paint(t)
      // NE RÉORDONNER QUE SUR CHANGEMENT DE COMPOSITION : déplacer un nœud entre `mousedown`
      // et `mouseup` tuerait le clic sur ✕. Les tuiles restent en place, seules leurs
      // couleurs et leur barre bougent.
      const sig = order.map((t) => t.key).join(',')
      if (sig !== lastOrder) {
        lastOrder = sig
        const keep = new Set(order.map((t) => t.key))
        for (const [k, d] of doms) {
          if (!keep.has(k)) {
            d.el.remove()
            doms.delete(k)
          }
        }
        for (const t of order) root.appendChild(doms.get(t.key)!.el)
      }
    },
  }
}
