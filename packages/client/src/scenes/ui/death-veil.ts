/**
 * LE VOILE DE MORT — le moment d'enjeu, enfin rendu (audit UI/UX P1).
 *
 * La mort du joueur n'avait AUCUN retour client : un saut de caméra muet au respawn.
 * Or c'est le moment central du jeu. Ce voile lui donne un corps et une voix, dans le
 * ton du GDD (une vallée condamnée, la mort comme jalon d'un récit) — issu d'un vote de
 * design multi-agents (« death-moment »), dont on retient :
 *  - un FONDU de cendre SEMI-opaque (le monde transparaît en fantôme), distinct de
 *    l'écran de RUPTURE (`fatal.ts`, opaque : la rupture est un arrêt, la mort non) ;
 *  - un DRAIN de couleur façon Don't Starve, en pur CSS (`backdrop-filter`) ;
 *  - le registre VOUS (tout le HUD parle VOUS — passer à TU ne serait cohérent qu'en
 *    basculant TOUT le HUD, hors sujet ici) ;
 *  - la cause RÉSOLUE du vrai flux (froid, faim, saignement, tueur nommé…) ;
 *  - PAS de rouge d'alerte (rouge = blocage/erreur ; la mort n'est pas une erreur) ;
 *  - la conséquence qui compte : la dépouille reste où l'on tombe, et l'on garde ce
 *    que l'on sait (anti-panique).
 *
 * Rendu en DOM sur `document.body` — PAS sur la planche du HUD, qui est `transform`-
 * scalée (un `inset:0` s'y effondrerait, et un `position:fixed` s'y ancrerait quand
 * même, car un ancêtre transformé devient le bloc conteneur du fixed). Le voile veut
 * le VRAI plein écran : il vit donc à la racine. Purement présentationnel : la sim a
 * DÉJÀ fait respawn (le voile ne bloque rien), il se lève et retombe tout seul.
 */

import { ensureGameFont, GAME_FONT } from './game-font'

/** La cause de la chute, telle que la porte l'événement `entity_died` de la sim. */
export type DeathCause = 'cold' | 'hunger' | 'lightning' | null

/**
 * LA LIGNE DE CAUSE (pure, testée) — résolue du vrai flux d'événements. `killerType`
 * vient du snapshot (le monstre d'`byEntityId`), `null` si le tueur n'est pas un monstre
 * connu. Toujours au passé, factuel, sans point d'exclamation.
 */
export function deathLine(cause: DeathCause, byEntityId: number, killerType: string | null): string {
  if (cause === 'cold') return 'Le froid vous a pris.'
  if (cause === 'hunger') return 'La faim vous a emporté.'
  if (cause === 'lightning') return 'La foudre vous a frappé.'
  // Saignement : la sim ne pose ni cause ni tueur (byEntityId 0) — la mort la plus
  // opaque du jeu, enfin nommée. (Inféré ; exact tant que seul le saignement y mène.)
  if (byEntityId === 0) return 'Vous vous êtes vidé de votre sang.'
  if (killerType === 'wolf') return 'Un loup vous a abattu.'
  if (killerType === 'boar') return 'Un sanglier vous a encorné.'
  if (killerType === 'cendreux') return 'Un Cendreux vous a repris.'
  if (killerType !== null) return 'Vous avez été abattu.' // toute bête sans réplique à elle
  return 'Vous êtes tombé, sans témoin.' // tueur disparu / PNJ / joueur non nommable
}

export interface DeathVeil {
  /** Le joueur est tombé : lève le voile (cause + conséquence). `firstDeath` ajoute
   *  l'invite « retournez-y » (une fois). `hadLoot` faux → MAINS VIDES : pas de dépouille à
   *  reprendre, on ne la promet pas (mort-suite 4). Le RETRAIT est piloté par UIScene sur
   *  l'horloge Phaser (`hide()`), pas par un timer JS. */
  show(cause: DeathCause, byEntityId: number, killerType: string | null, firstDeath: boolean, hadLoot: boolean): void
  /** Laisse retomber le voile (fondu de sortie). Idempotent. */
  hide(): void
  /** Branche le geste de sortie. Le voile ne se retire plus tout seul (décision ⑥). */
  onRelever(cb: () => void): void
  destroy(): void
}

// ── Le rythme du voile ─────────────────────────────────────────────────────────────
// La DURÉE VISIBLE (entrée + maintien) est comptée par UIScene sur l'horloge Phaser,
// comme le fait le bandeau d'erreur — window.setTimeout n'est PAS fiable ici (il vit
// hors du rAF que Phaser met en pause) et le voile restait ou disparaissait à contretemps.
/**
 * LE FILET, PAS L'HORLOGE (décision d'Alexis, 2026-08-20, question ⑥).
 *
 * Le voile se retirait à 3 200 ms — la valeur EXACTE de `SAVE_MS`, la notification
 * d'autosauvegarde. Le moment le plus grave de la partie pesait donc autant qu'un « partie
 * sauvegardée », et il s'en allait sans qu'on ait rien fait : on ne CHOISISSAIT pas de
 * repartir, on était remis en jeu. C'est le geste qui referme désormais.
 *
 * Ce délai-ci ne rythme plus rien : il empêche seulement l'écran de devenir un piège si le
 * bouton se taisait. Trente secondes — largement au-delà de toute lecture, assez court pour
 * qu'on ne reste pas coincé.
 */
export const DEATH_VEIL_FILET_MS = 30000
/** Durée du fondu CSS (entrée ET sortie de l'opacité/translation). Exporté : WorldScene
 *  s'en sert pour SNAPPER la caméra au respawn pile quand le voile est OPAQUE (le saut
 *  reste caché), pas avant (on verrait le monde traverser). */
export const DEATH_FADE_MS = 550
const FADE_MS = DEATH_FADE_MS

export function createDeathVeil(): DeathVeil {
  // La police du jeu, POSÉE et pas héritée : ce voile monte sur `document.body`, qui n'en
  // déclare aucune — un `inherit` y récupérait la serif par défaut du navigateur.
  ensureGameFont()
  // Idempotent : un voile résiduel (rebuild de scène, HMR) est retiré avant d'en poser
  // un neuf — sinon deux `.death-veil` s'empilent sur `body` et l'un masque l'autre.
  document.querySelectorAll('.death-veil').forEach((n) => n.remove())
  const root = document.createElement('div')
  root.className = 'death-veil'
  root.innerHTML = `
  <style>
    .death-veil{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;
      opacity:0;transition:opacity ${FADE_MS}ms ease;pointer-events:none;
      background:rgba(20,20,26,.86);
      -webkit-backdrop-filter:grayscale(.75) saturate(.35) brightness(.85);
      backdrop-filter:grayscale(.75) saturate(.35) brightness(.85);}
    .death-veil.dv-on{opacity:1;}
    /* La SEULE chaleur à l'écran : la braise du Feu qui appelle déjà, en bas. */
    .dv-glow{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:900px;height:420px;
      background:radial-gradient(ellipse at bottom,rgba(201,139,58,.20),transparent 68%);pointer-events:none;}
    .dv-card{position:relative;text-align:center;max-width:720px;padding:0 44px;transform:translateY(10px);
      transition:transform ${FADE_MS}ms ease;font-family:${GAME_FONT};}
    .death-veil.dv-on .dv-card{transform:translateY(0);}
    .dv-title{font-size:30px;font-weight:700;color:#c98b3a;letter-spacing:6px;
      text-shadow:0 2px 0 #14141a,0 0 18px rgba(201,139,58,.25);}
    .dv-cause{font-size:17px;color:#e6ddc8;letter-spacing:.5px;margin-top:20px;}
    .dv-div{width:80px;height:1px;background:#6b5a3a;margin:26px auto;}
    .dv-corpse{font-size:15px;color:#c0a074;line-height:1.7;max-width:520px;margin:0 auto;}
    .dv-learn{font-size:13px;color:#8a8172;margin-top:12px;letter-spacing:.5px;}
    .dv-skills{font-size:13px;color:#6f8a70;margin-top:18px;letter-spacing:.5px;}
    /* ON SE RELÈVE, ON N'EST PAS REMIS EN JEU (décision d'Alexis, 2026-08-20, question ⑥).
       Le voile se retirait sur un minuteur de 3 200 ms — EXACTEMENT la durée de la notification
       d'autosauvegarde. Le moment le plus grave de la partie pesait autant qu'un « partie
       sauvegardée », et il s'en allait sans qu'on ait rien fait. La distinction que le jeu fait
       déjà (la stèle de saison est TERMINALE, le voile de mort est temporisé) est juste ; c'est
       le dosage qui ne l'était pas.
       Le couple de la stèle, en un seul bouton — et le POINTEUR SE RALLUME dessus : le voile est
       pointer-events:none, exactement comme la planche du HUD où trois boutons de réfugiés
       n'ont jamais pu recevoir un clic. On ne refait pas ce défaut-là. */
    .dv-btn{margin-top:30px;background:transparent;border:2px solid #6b5a3a;color:#9a8f78;
      font-family:${GAME_FONT};font-size:14px;font-weight:700;letter-spacing:3px;padding:11px 26px;
      cursor:pointer;pointer-events:auto;transition:color .14s ease,border-color .14s ease,background .14s ease;}
    .dv-btn:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
    .dv-btn:focus-visible{outline:2px solid #c98b3a;outline-offset:3px;}
  </style>
  <div class="dv-glow"></div>
  <div class="dv-card">
    <div class="dv-title">VOUS ÊTES TOMBÉ</div>
    <div class="dv-cause"></div>
    <div class="dv-div"></div>
    <div class="dv-corpse">Votre dépouille repose là où vous êtes tombé, avec tout ce que vous portiez.</div>
    <div class="dv-learn">Retournez-y la reprendre — ou laissez-la au monde.</div>
    <div class="dv-skills">Vos mains, elles, n'ont rien oublié.</div>
    <button class="dv-btn" type="button">SE RELEVER</button>
  </div>`
  document.body.appendChild(root)
  const causeEl = root.querySelector<HTMLElement>('.dv-cause')!
  const btnEl = root.querySelector<HTMLButtonElement>('.dv-btn')!
  const learnEl = root.querySelector<HTMLElement>('.dv-learn')!
  const corpseEl = root.querySelector<HTMLElement>('.dv-corpse')!
  const CORPSE_WITH_LOOT = 'Votre dépouille repose là où vous êtes tombé, avec tout ce que vous portiez.'
  const CORPSE_EMPTY = 'Vous ne portiez rien — la mort ne vous a rien pris.'

  // La fin du fondu de SORTIE pose display:none — piloté par l'événement `transitionend`
  // (pas un timer) : l'opacité atteint 0, on cache. Fiable et sans horloge parallèle.
  const onFadeOut = (e: TransitionEvent): void => {
    if (e.propertyName === 'opacity' && !root.classList.contains('dv-on')) root.style.display = 'none'
  }
  root.addEventListener('transitionend', onFadeOut)

  return {
    show(cause, byEntityId, killerType, firstDeath, hadLoot) {
      // LA VISIBILITÉ D'ABORD — elle ne doit dépendre d'AUCUN sous-élément. On lève le
      // voile, puis on le remplit. Reflow forcé avant d'armer la transition, sinon
      // display:none→flex « avale » le fondu (pas de transition depuis un état non peint).
      root.style.display = 'flex'
      void root.offsetWidth
      root.classList.add('dv-on')
      causeEl.textContent = deathLine(cause, byEntityId, killerType)
      // MAINS VIDES (mort-suite 4) : sans butin, aucun cadavre — on ne promet pas de dépouille
      // à reprendre (ce serait un mensonge, et le traqueur ne pointera vers rien). On dit la
      // vérité rassurante, et on masque l'invite « retournez-y ».
      corpseEl.textContent = hadLoot ? CORPSE_WITH_LOOT : CORPSE_EMPTY
      // « Retournez-y » n'a de sens qu'à la première mort AVEC un sac à récupérer.
      learnEl.style.display = firstDeath && hadLoot ? '' : 'none'
      // Le geste prend la main : on le met au FOCUS pour que ENTRÉE et ESPACE le déclenchent
      // sans souris — un écran modal sans sortie clavier est un piège (question ⑩).
      btnEl.focus()
    },
    /** Le geste du joueur : « SE RELEVER ». C'est LUI qui referme, plus un minuteur. */
    onRelever(cb) {
      btnEl.addEventListener('click', cb)
    },
    hide() {
      // On retire dv-on : l'opacité fond vers 0 (transition CSS ${FADE_MS}ms), puis
      // `onFadeOut` (transitionend) pose display:none. Aucun timer JS.
      root.classList.remove('dv-on')
    },
    destroy() {
      root.removeEventListener('transitionend', onFadeOut)
      root.remove()
    },
  }
}
