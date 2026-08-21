/**
 * LA FENÊTRE DES RÉFUGIÉS (V2-25, GDD §520) — « des survivants sur la route ».
 *
 * Elle paraît quand on s'approche d'un groupe de réfugiés. Trois gestes, trois boutons — le
 * dilemme d'alignement en clair : les RECRUTER (ils rejoignent mon village, +population,
 * Foyer), les NOURRIR (des vivres, Foyer), les DÉPOUILLER (leur maigre bien, Meute). Les
 * REFOULER, c'est ne rien faire : s'éloigner, ils repartent seuls. Zéro règle ici : la fenêtre
 * POSE l'action, la sim tranche (portée, village requis pour recruter, vivres pour nourrir).
 *
 * Rendu DOM (patron de la fenêtre « Fonder un village »), bord-haut braise.
 */
import type { PlayerAction } from '@ashes/sim'
import { createPromptGate } from './prompt-gate'

export interface RefugeePrompt {
  /** `near` = le groupe à portée (ou `null` : la fenêtre s'efface). */
  update(near: { groupId: number; count: number } | null): void
  destroy(): void
}

export function createRefugeePrompt(board: HTMLElement, send: (a: PlayerAction) => void): RefugeePrompt {
  const root = document.createElement('div')
  root.className = 'rfp'
  root.innerHTML = `
  <style>
    .rfp{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);width:640px;text-align:center;display:none;}
    .rfp-halo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;height:340px;
      background:radial-gradient(ellipse,rgba(201,139,58,.16),transparent 70%);pointer-events:none;}
    /* LE POINTEUR SE RALLUME ICI, ET C'ÉTAIT LE SEUL PANNEAU DU HUD À L'OUBLIER.
       (Pas de backtick dans ce commentaire : il vit DANS le template literal du CSS.)

       .hud-overlay et .hud-board sont en pointer-events:none (hud-dom.ts) — la planche
       laisse passer les clics vers le monde, et chaque contrôle cliquable les rallume SUR
       LUI-MÊME (la classe .hud-click, ou son propre pointer-events:auto comme fire-panel
       et build-menu). Les six autres modules montés sur la planche le font. Celui-ci, non :
       ses trois boutons — RECRUTER / NOURRIR / DÉPOUILLER — n'ont JAMAIS pu recevoir un
       clic, ni même un survol, et il n'existe aucune voie clavier (ce fichier est le seul
       émetteur de recruit_refugees / feed_refugees / rob_refugees). Le seul dilemme
       d'alignement à trois voies de la Veillée se soldait toujours par « refouler ».
       (Audit UX 2026-08-20, P0.1 — le seul constat bloquant. Gardé par hud-pointeur.test.)

       On le pose sur la CARTE et non sur les seuls boutons : un clic qui manque un bouton
       de deux pixels ne doit pas partir frapper le monde à travers la fenêtre ouverte. Le
       halo, lui, reste transparent au clic — c'est une lueur, pas une surface. */
    .rfp-panel{position:relative;background:rgba(20,16,12,.9);border:3px solid #14141a;border-top:2px solid #c98b3a;padding:30px 44px 26px;pointer-events:auto;}
    .rfp-eyebrow{font-size:12px;color:#c98b3a;letter-spacing:4px;margin-bottom:16px;}
    .rfp-title{font-size:21px;font-weight:700;color:#ffffff;letter-spacing:1px;line-height:1.4;}
    .rfp-div{width:80px;height:1px;background:#6b5a3a;margin:16px auto;}
    .rfp-body{font-size:13.5px;color:#e8e0c8;line-height:1.6;max-width:520px;margin:0 auto;}
    .rfp-row{display:flex;gap:14px;justify-content:center;margin-top:22px;}
    .rfp-btn{background:rgba(201,139,58,.14);border:2px solid #c98b3a;color:#e8c66a;font-size:14px;font-weight:700;
      letter-spacing:1px;padding:12px 22px;cursor:pointer;transition:background .12s ease,color .12s ease;}
    .rfp-btn:focus-visible{outline:2px solid #e8c66a;outline-offset:2px;}
    .rfp-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
    .rfp-btn.rob{border-color:#d5624a;color:#e79a86;}
    .rfp-btn.rob:hover{background:rgba(213,98,74,.22);color:#f2c9bd;}
    .rfp-fine{font-size:11px;color:#8b8474;letter-spacing:1px;margin-top:14px;}
  </style>
  <div class="rfp-halo"></div>
  <div class="rfp-panel">
    <div class="rfp-eyebrow">SUR LA ROUTE</div>
    <div class="rfp-title">Des réfugiés. <span class="rfp-count"></span></div>
    <div class="rfp-div"></div>
    <div class="rfp-body">Les recruter les fait rejoindre votre Feu. Les nourrir les réchauffe. Les dépouiller vous nourrit — au prix de votre âme.</div>
    <div class="rfp-row">
      <button class="rfp-btn" data-verb="recruit">RECRUTER</button>
      <button class="rfp-btn" data-verb="feed">NOURRIR</button>
      <button class="rfp-btn rob" data-verb="rob">DÉPOUILLER</button>
    </div>
    <div class="rfp-fine">S'éloigner, c'est les refouler — ils repartiront seuls.</div>
  </div>`
  board.appendChild(root)
  const countEl = root.querySelector<HTMLElement>('.rfp-count')!

  let current: { groupId: number; count: number } | null = null
  // Le garde anti-double-envoi : sans lui, un double-clic « NOURRIR » dépense deux fois les
  // vivres avant l'arrivée du snapshot (la fenêtre rouvre car `UIScene.update` la rappelle
  // chaque frame). Identité = l'id du groupe (voir prompt-gate). Un geste par groupe : le
  // dilemme d'alignement se joue en un choix, pas en martelant un bouton.
  const gate = createPromptGate()
  root.querySelectorAll<HTMLButtonElement>('.rfp-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!current) return
      const g = current.groupId
      const verb = btn.dataset.verb
      if (verb === 'recruit') send({ type: 'recruit_refugees', groupId: g })
      else if (verb === 'feed') send({ type: 'feed_refugees', groupId: g })
      else send({ type: 'rob_refugees', groupId: g })
      gate.acted(g)
      current = null
      root.style.display = 'none'
    })
  })

  return {
    update(near) {
      // On a agi et le snapshot n'a pas encore bougé le groupe : on reste muet (et `current`
      // null) tant que le MÊME groupe revient. Recruté/dépouillé → il disparaît (`near` null) ;
      // s'éloigner (refouler) → null aussi : le garde rend la main.
      if (gate.suppresses(near?.groupId ?? null)) {
        current = null
        root.style.display = 'none'
        return
      }
      current = near
      if (near) countEl.textContent = near.count > 1 ? `Ils sont ${near.count}.` : `Un survivant.`
      root.style.display = near ? 'block' : 'none'
    },
    destroy() {
      root.remove()
    },
  }
}
