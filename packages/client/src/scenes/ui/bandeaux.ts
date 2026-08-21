/**
 * LES DEUX BANDEAUX — l'ALERTE et le CONSEIL, en DOM, en FILE, au-dessus des panneaux.
 *
 * ─── LE DÉFAUT QU'ILS RÉPARENT (audit UX 2026-08-20, P0.2 — défaut cardinal) ───
 *
 * Le canal d'alerte était **une case unique**. `publishError` écrivait une VALEUR
 * (`{ reason, at }`), et huit émetteurs se la partageaient : le refus d'une action, la nuit
 * qui tombe, le hurlement du loup, le raclement dans le noir, le télégraphe de la Cendre —
 * et le départ de l'Arche. Deux faits dans la même fenêtre de 2,5 s, et le second effaçait
 * le premier avant que personne l'ait lu. Le canal CONSEIL avait le même patron, avec une
 * fenêtre trois fois plus longue.
 *
 * Pire : leur unique lecteur était un `Phaser.GameObjects.Text`, donc peint SUR LE CANVAS —
 * c'est-à-dire **sous** `.hch` (l'écran sac/artisanat/métiers, `inset:0` opaque) et sous
 * `.fpn` (le modal du Feu, 72 %). Or ce sont exactement les écrans d'où partent les gestes
 * d'objet, de coffre et de Feu, avec leurs quinze motifs de refus. Sac ouvert, une action
 * refusée ne produisait **ni son ni image** — et le silence sonore avait justement été
 * DÉCIDÉ au motif qu'« il y a déjà un toast » (`audio/inventaire.ts`), un toast que le
 * joueur ne pouvait pas voir.
 *
 * ─── CE QUI CHANGE ───
 *
 * ① UNE FILE, PAS UNE VALEUR — le patron que le dépôt emploie déjà pour les récoltes
 *    (`publishPickup` : « aucune ne doit être écrasée »). Rien ne se perd, tout passe à son
 *    tour.
 * ② EN DOM, AU-DESSUS DES PANNEAUX (z-index 55 : au-dessus du HUD à 40 et des écrans de
 *    menu à 50, SOUS les voiles à 60/70/80 — un refus n'a rien à dire par-dessus la mort).
 * ③ SUR `document.body`, comme les voiles, et NON sur la planche du HUD : celle-ci est
 *    `transform`-scalée (0,667 à 1280×800), et y poser du texte rejouerait le défaut des
 *    deux régimes d'échelle — un 14 px de maquette rendu à 9 px.
 *
 * ─── DEUX TONS, DEUX PLACES, ET C'EST DÉLIBÉRÉ ───
 *
 * Le conseil ENSEIGNE, l'alerte CRIE (audit UI/UX P2-7) : places distinctes (haut / bas),
 * encres distinctes, durées distinctes. On répare le canal, on ne fusionne pas les registres.
 */
import { GAME_FONT, ensureGameFont } from './game-font'
import { INK_OUTLINE_STRONG } from './hud-dom'

/** L'ALERTE : courte et pressante — un refus, un danger. Elle ne s'attarde pas. */
export const ALERTE_HOLD_MS = 2500
/** Le CONSEIL : on LIT une règle, on ne la subit pas. Tenue longue, puis fondu. */
export const CONSEIL_HOLD_MS = 6000
export const CONSEIL_FADE_MS = 3000
/** Le fondu de l'alerte, court comme elle. */
export const ALERTE_FADE_MS = 600

/**
 * LA FILE EST BORNÉE. Sans plafond, une rafale (une horde qui arrive pendant qu'on rate
 * trois poses) ferait défiler des messages périmés pendant une demi-minute — le joueur
 * lirait le passé. Au-delà, on garde les plus RÉCENTS : c'est ce qui vient de se passer
 * qui compte, pas ce qu'on a raté il y a vingt secondes.
 */
export const FILE_MAX = 4

export interface Bandeaux {
  /**
   * Une frame. `alertes` et `conseils` sont les files DRAINÉES ce tour-ci (elles peuvent
   * être vides) ; le module les met dans sa propre file et n'en montre qu'une à la fois.
   */
  update(now: number, alertes: readonly string[], conseils: readonly string[]): void
  /** Ce qui est à l'écran, pour les gardes et les sondes. `null` = le créneau est libre. */
  visible(): { alerte: string | null; conseil: string | null }
  destroy(): void
}

/** Un créneau : sa file, ce qu'il montre, et depuis quand. Pur état, testé à part. */
interface Creneau {
  file: string[]
  affiche: string | null
  depuis: number
}

/**
 * LA MÉCANIQUE DU CRÉNEAU, extraite et PURE — c'est elle qui porte la correction, donc
 * c'est elle qu'on prouve. Rend le texte à peindre (ou `null`), et fait avancer la file.
 *
 * La règle : on ne remplace JAMAIS un message avant qu'il ait fini son temps. C'est tout
 * le défaut d'origine, en une ligne.
 */
export function avancerCreneau(c: Creneau, now: number, holdMs: number, fadeMs: number): void {
  if (c.affiche !== null && now - c.depuis < holdMs + fadeMs) return // il parle encore
  c.affiche = c.file.shift() ?? null
  if (c.affiche !== null) c.depuis = now
}

/** Empile en gardant les plus RÉCENTS si ça déborde. */
export function empiler(file: string[], neufs: readonly string[], max = FILE_MAX): void {
  for (const t of neufs) file.push(t)
  if (file.length > max) file.splice(0, file.length - max)
}

/** L'opacité d'un message à l'instant `now` — pleine encre, puis fondu. */
export function opacite(depuis: number, now: number, holdMs: number, fadeMs: number): number {
  const age = now - depuis
  if (age <= holdMs) return 1
  if (age >= holdMs + fadeMs) return 0
  return 1 - (age - holdMs) / fadeMs
}

export function createBandeaux(): Bandeaux {
  ensureGameFont()
  const root = document.createElement('div')
  root.className = 'bnd'
  root.innerHTML = `
  <style>
    /* z-index 55 : AU-DESSUS du HUD (40) et des écrans de menu (50) — c'était tout le
       défaut, l'alerte se peignait sous l'écran qui venait de la provoquer — mais SOUS les
       voiles (mort 60, pause 70, stèle 80) : un refus n'a rien à dire par-dessus la mort.
       Transparent au clic : un bandeau ne doit jamais voler un geste au monde. */
    .bnd{position:fixed;inset:0;z-index:55;pointer-events:none;font-family:${GAME_FONT};}
    .bnd-l{position:absolute;left:50%;transform:translateX(-50%);max-width:min(760px,86vw);
      text-align:center;line-height:1.5;letter-spacing:.5px;${INK_OUTLINE_STRONG}
      transition:opacity .15s linear;}
    /* LE CONSEIL, en haut : encre chaude neutre. On apprend à jouer, on n'échoue pas. */
    .bnd-conseil{top:72px;font-size:15px;color:#e8c66a;}
    /* L'ALERTE, en bas : le rouge du refus et du danger. */
    .bnd-alerte{bottom:110px;font-size:15px;color:#ff7a6b;}
    /* Un SOL, comme celui du HUD : ces deux lignes se peignent sur le monde, à toute heure.
       Sans lui, l'alerte tombait à 1,7:1 sur l'herbe de midi — le message qui crie était le
       moins lisible du cadre. Le voile s'éteint sur les bords : une plaque à bord franc
       ferait une barre noire en travers d'un jeu qui n'en a aucune. */
    .bnd-l::before{content:'';position:absolute;inset:-14px -40px;z-index:-1;pointer-events:none;
      background:radial-gradient(ellipse at center,rgba(10,8,6,.82),rgba(10,8,6,.52) 58%,rgba(10,8,6,0) 84%);}
  </style>
  <div class="bnd-l bnd-conseil"></div>
  <div class="bnd-l bnd-alerte"></div>`
  document.body.appendChild(root)

  const conseilEl = root.querySelector<HTMLElement>('.bnd-conseil')!
  const alerteEl = root.querySelector<HTMLElement>('.bnd-alerte')!
  const conseil: Creneau = { file: [], affiche: null, depuis: 0 }
  const alerte: Creneau = { file: [], affiche: null, depuis: 0 }

  const peindre = (el: HTMLElement, c: Creneau, now: number, hold: number, fade: number): void => {
    if (c.affiche === null) {
      el.textContent = ''
      el.style.display = 'none'
      return
    }
    el.style.display = 'block'
    el.textContent = c.affiche
    el.style.opacity = String(opacite(c.depuis, now, hold, fade))
  }

  return {
    update(now, alertes, conseils) {
      empiler(alerte.file, alertes)
      empiler(conseil.file, conseils)
      avancerCreneau(alerte, now, ALERTE_HOLD_MS, ALERTE_FADE_MS)
      avancerCreneau(conseil, now, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)
      peindre(alerteEl, alerte, now, ALERTE_HOLD_MS, ALERTE_FADE_MS)
      peindre(conseilEl, conseil, now, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)
    },
    visible() {
      return { alerte: alerte.affiche, conseil: conseil.affiche }
    },
    destroy() {
      root.remove()
    },
  }
}
