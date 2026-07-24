/**
 * LA FENÊTRE DU BAS — « Monter le Feu d'un palier ? ».
 *
 * Sœur de `found-village-prompt.ts` : même grammaire (fenêtre-sur-le-monde, bord-haut
 * braise, sourcil, titre, filet, corps, bouton braise), même contrat (WorldScene décide
 * QUAND via `upgradableFire`, l'UI ne fait que montrer, la sim revalide `upgrade_fire`).
 *
 * Elle paraît quand on est le CHEF de son village, à portée de son Feu, et que le palier
 * n'est pas au maximum. Le coût du palier suivant est TOUJOURS affiché — même quand on ne
 * peut pas encore payer : c'est ainsi qu'on APPREND ce qu'il faut réunir (le bouton se
 * grise, le coût vire au « manque »). Monter le Feu agrandit son carré (R2) et débloque
 * des composants de palier supérieur (R6) — c'est le seul sink de matériaux lourds du jeu,
 * et la porte du contenu T2/T3.
 */
import type { ItemBag, ItemId, PlayerAction } from '@braises/sim'
import { ITEM_LABELS } from '../../render/item-art'
import { createPromptGate } from './prompt-gate'

export interface FireUpgradeContext {
  tier: number
  nextCost: ItemBag
  affordable: boolean
}

export interface FireUpgradePrompt {
  /** Le contexte d'amélioration, ou `null` = rien à portée : la fenêtre s'efface. */
  update(ctx: FireUpgradeContext | null): void
  destroy(): void
}

/** « 30 pierre taillée · 8 lingot de fer » — les noms français du jeu, en minuscules. */
function formatCost(cost: ItemBag): string {
  return (Object.entries(cost) as [ItemId, number][])
    .map(([item, n]) => `${n} ${ITEM_LABELS[item].toLowerCase()}`)
    .join(' · ')
}

export function createFireUpgradePrompt(board: HTMLElement, send: (a: PlayerAction) => void): FireUpgradePrompt {
  const root = document.createElement('div')
  root.className = 'fup'
  root.innerHTML = `
  <style>
    .fup{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);width:640px;text-align:center;display:none;}
    .fup-halo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;height:340px;
      background:radial-gradient(ellipse,rgba(201,139,58,.16),transparent 70%);pointer-events:none;}
    .fup-panel{position:relative;background:rgba(20,16,12,.9);border:3px solid #14141a;border-top:2px solid #c98b3a;padding:34px 44px 30px;}
    .fup-eyebrow{font-size:12px;color:#c98b3a;letter-spacing:4px;margin-bottom:18px;}
    .fup-title{font-size:22px;font-weight:700;color:#ffffff;letter-spacing:1px;line-height:1.4;}
    .fup-div{width:80px;height:1px;background:#6b5a3a;margin:18px auto;}
    .fup-body{font-size:14px;color:#e8e0c8;line-height:1.7;max-width:500px;margin:0 auto;}
    .fup-cost{font-size:13px;color:#e8c66a;letter-spacing:1px;margin-top:16px;}
    .fup.fup-short .fup-cost{color:#e0553f;}
    .fup-btn{display:inline-block;margin-top:22px;background:rgba(201,139,58,.14);border:2px solid #c98b3a;color:#e8c66a;
      font-size:15px;font-weight:700;letter-spacing:2px;padding:14px 34px;transition:background .12s ease,color .12s ease;}
    .fup-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
    .fup.fup-short .fup-btn{border-color:#6b5a3a;color:#8a7f68;background:rgba(40,34,26,.5);cursor:not-allowed;}
    .fup.fup-short .fup-btn:hover{background:rgba(40,34,26,.5);color:#8a7f68;}
    .fup-fine{font-size:11px;color:#8b8474;letter-spacing:1px;margin-top:16px;}
  </style>
  <div class="fup-halo"></div>
  <div class="fup-panel">
    <div class="fup-eyebrow">LE FEU DU FOYER</div>
    <div class="fup-title"></div>
    <div class="fup-div"></div>
    <div class="fup-body">Monter le Feu agrandit le carré du foyer et débloque des ouvrages de facture supérieure. Le cœur du village grandit avec ce qu'on lui donne.</div>
    <div class="fup-cost"></div>
    <div class="fup-btn hud-click"></div>
    <div class="fup-fine">t'éloigner du Feu referme cette fenêtre.</div>
  </div>`
  board.appendChild(root)

  const titleEl = root.querySelector<HTMLElement>('.fup-title')!
  const costEl = root.querySelector<HTMLElement>('.fup-cost')!
  const btn = root.querySelector<HTMLElement>('.fup-btn')!

  let current: FireUpgradeContext | null = null
  // Le garde anti-double-envoi : le handler sim de `upgrade_fire` RETIRE le coût ET monte le
  // palier à chaque appel validé — un double-clic (la fenêtre rouvre car `UIScene.update` la
  // rappelle chaque frame) coûterait deux paliers. Identité = le palier visé (voir prompt-gate).
  const gate = createPromptGate()

  btn.addEventListener('click', () => {
    if (!current || !current.affordable) return // le bouton grisé ne tire rien
    send({ type: 'upgrade_fire' })
    gate.acted(current.tier)
    current = null
    root.style.display = 'none'
  })

  return {
    update(ctx) {
      // On a tiré et le snapshot n'a pas encore bougé le palier : on reste MUET (et `current`
      // à null, donc un clic ne tire rien). Dès que l'état change (palier différent) ou qu'il
      // n'y a plus rien à portée (`ctx` null), le garde rend la main.
      if (gate.suppresses(ctx?.tier ?? null)) {
        current = null
        root.style.display = 'none'
        return
      }
      current = ctx
      if (!ctx) {
        root.style.display = 'none'
        return
      }
      const nextTier = ctx.tier + 1
      titleEl.textContent = `Monter le Feu au palier ${nextTier} ?`
      costEl.textContent = `Coût : ${formatCost(ctx.nextCost)}`
      btn.textContent = ctx.affordable ? `MONTER LE FEU — PALIER ${nextTier}` : 'MATÉRIAUX INSUFFISANTS'
      root.classList.toggle('fup-short', !ctx.affordable)
      root.style.display = 'block'
    },
    destroy() {
      root.remove()
    },
  }
}
