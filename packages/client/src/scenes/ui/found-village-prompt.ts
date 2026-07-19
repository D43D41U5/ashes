/**
 * LA FENÊTRE DU BAS — « Fonder un village ici ? ».
 *
 * Elle paraît quand on s'approche d'un feu de camp qu'on a planté (un feu LIBRE,
 * à soi) et qu'on n'a pas encore de foyer. Un clic sur OUI fonde le village : le
 * feu devient le Feu du foyer, on en est le Chef. L'IGNORER (s'éloigner, ne pas
 * cliquer) laisse le feu tel quel — une simple source de chaleur et une station de
 * cuisine. C'est le seul moment où « allumer un feu » et « fonder un village » se
 * rejoignent, et c'est un CHOIX, jamais un automatisme (décision utilisateur).
 *
 * Rendu ISO à la maquette Turn 5A, en DOM (voir `hud-dom.ts`) : fenêtre-sur-le-monde
 * à bord-haut braise, sourcil, titre, filet, corps, bouton braise. Zéro règle de jeu
 * ici : elle POSE l'action `found_village`, la sim tranche.
 */
import type { PlayerAction } from '@braises/sim'

export interface FoundVillagePrompt {
  /** `foundable` = le feu promouvable (ou `null` = rien à portée : la fenêtre s'efface). */
  update(foundable: { structureId: number } | null): void
  destroy(): void
}

export function createFoundVillagePrompt(board: HTMLElement, send: (a: PlayerAction) => void): FoundVillagePrompt {
  const root = document.createElement('div')
  root.className = 'fvp'
  root.innerHTML = `
  <style>
    .fvp{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);width:640px;text-align:center;display:none;}
    .fvp-halo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;height:340px;
      background:radial-gradient(ellipse,rgba(201,139,58,.16),transparent 70%);pointer-events:none;}
    .fvp-panel{position:relative;background:rgba(20,16,12,.9);border:3px solid #14141a;border-top:2px solid #c98b3a;padding:34px 44px 30px;}
    .fvp-eyebrow{font-size:12px;color:#c98b3a;letter-spacing:4px;margin-bottom:18px;}
    .fvp-title{font-size:22px;font-weight:700;color:#ffffff;letter-spacing:1px;line-height:1.4;}
    .fvp-div{width:80px;height:1px;background:#6b5a3a;margin:18px auto;}
    .fvp-body{font-size:14px;color:#e8e0c8;line-height:1.7;max-width:500px;margin:0 auto;}
    .fvp-btn{display:inline-block;margin-top:26px;background:rgba(201,139,58,.14);border:2px solid #c98b3a;color:#e8c66a;
      font-size:15px;font-weight:700;letter-spacing:2px;padding:14px 34px;transition:background .12s ease,color .12s ease;}
    .fvp-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
    .fvp-fine{font-size:11px;color:#6f6a60;letter-spacing:1px;margin-top:16px;}
  </style>
  <div class="fvp-halo"></div>
  <div class="fvp-panel">
    <div class="fvp-eyebrow">UN FEU DE CAMP BRÛLE ICI</div>
    <div class="fvp-title">Faire de ce feu le Feu du foyer&nbsp;?</div>
    <div class="fvp-div"></div>
    <div class="fvp-body">Fonder ici, c'est cesser d'être un survivant pour devenir le Chef d'un village. La flamme deviendra le Feu — le cœur qui tient les tiens en vie tant qu'il brûle.</div>
    <div class="fvp-btn hud-click">FONDER UN VILLAGE ICI</div>
    <div class="fvp-fine">t'éloigner referme cette invitation — le feu restera une simple source de chaleur.</div>
  </div>`
  board.appendChild(root)

  let current: { structureId: number } | null = null

  root.querySelector<HTMLElement>('.fvp-btn')!.addEventListener('click', () => {
    if (!current) return
    send({ type: 'found_village', structureId: current.structureId })
    // On FERME tout de suite (optimiste). Le foyer n'est fondé côté sim qu'au prochain
    // snapshot ; d'ici là, un second clic renverrait un `found_village` refusé (« déjà un
    // foyer ») dans le flux d'événements — un bouton qui a tiré se tait. Le snapshot suivant
    // confirmera (foundableFire repasse à null).
    current = null
    root.style.display = 'none'
  })

  return {
    update(foundable) {
      current = foundable
      root.style.display = foundable ? 'block' : 'none'
    },
    destroy() {
      root.remove()
    },
  }
}
