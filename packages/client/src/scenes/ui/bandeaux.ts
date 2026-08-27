/**
 * LES TROIS BANDEAUX — l'ALERTE, le CONSEIL et la DÉCOUVERTE, en DOM, en FILE, au-dessus
 * des panneaux.
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
 *
 * ─── LE TROISIÈME : LA DÉCOUVERTE (2026-08-25) ───
 *
 * Un lieu foulé pour la première fois s'ANNONCE — « Nouveau lieu découvert », puis son nom.
 * Le modèle est celui de The Long Dark, et il vient AVEC son revers : les noms des lieux ne
 * flottent plus en permanence au-dessus du paysage (`world/poi-layer`). Le monde se tait ;
 * l'écran parle une fois. C'est le même échange que fait TLD — pas de minimap, pas
 * d'étiquette suspendue, mais un moment quand on arrive quelque part.
 *
 * Sa place est le CENTRE HAUT, libre entre le conseil (haut) et l'alerte (bas) : c'est un
 * carton de titre, pas une notification de coin d'écran. Sa tenue est la plus longue des
 * trois — on ne lit pas un toponyme comme on lit un refus.
 *
 * SON ANIMATION EST UNE GÉOMÉTRIE CONTINUE, calculée ici à chaque frame depuis `now`, et non
 * une transition CSS nommée : le bandeau doit être vérifiable image par image en headless
 * (le harnais smoke fige la boucle), et une `animation` CSS y serait un état qu'on ne peut
 * ni lire ni stopper. Elle est PURE (`geometrieDecouverte`), donc prouvée au test.
 */
import { BARRE_H } from './barre-haute'
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
 * LA DÉCOUVERTE — trois temps, et les trois se voient.
 *
 * L'ENTRÉE monte (700 ms) : le carton arrive par le bas, l'interlettre du surtitre se
 * resserre, le filet s'ouvre. La TENUE (3,4 s) est la plus longue des trois canaux : on lit
 * deux lignes, dont un nom propre qu'on n'a jamais vu. La SORTIE (900 ms) repart vers le
 * HAUT et non vers le bas — arriver et repartir par le même côté ferait un yo-yo ; une
 * traversée se lit comme un passage.
 */
export const DECOUVERTE_ENTREE_MS = 700
export const DECOUVERTE_HOLD_MS = 3400
export const DECOUVERTE_SORTIE_MS = 900
/** Ce que `avancerCreneau` appelle « hold » : tout le temps de pleine présence, entrée comprise. */
export const DECOUVERTE_TENUE_MS = DECOUVERTE_ENTREE_MS + DECOUVERTE_HOLD_MS

/** Les BORNES EXACTES de la géométrie — chaque nombre est une extrémité de pente, pas un ease. */
/** De combien de px le carton monte à l'entrée, et de combien il s'élève encore en partant. */
const DEC_DY_ENTREE = 16
const DEC_DY_SORTIE = 12
/** L'interlettre du surtitre (px) : large aux deux bouts, serrée à pleine présence. */
const DEC_ECART_LARGE = 11
const DEC_ECART_SERRE = 3.4
/** L'échelle du nom : il grandit en arrivant, et continue de grandir en s'effaçant. */
const DEC_ECHELLE_MIN = 0.94
const DEC_ECHELLE_SORTIE = 1.04

/** L'état géométrique du carton de découverte à l'instant `now`. Pur — donc prouvé. */
export interface GeoDecouverte {
  opacite: number
  /** Décalage vertical, en px (positif = plus bas que sa place). */
  dy: number
  /** Interlettre du surtitre, en px. */
  ecart: number
  /** Échelle du nom. */
  echelle: number
  /** La part du filet qui est tracée, de 0 à 1. */
  filet: number
}

/**
 * LA PENTE, SUR TOUT L'ÉLÉMENT ET AUX DEUX BOUTS. Deux progressions indépendantes : `e`
 * monte de 0 à 1 pendant l'entrée, `s` monte de 0 à 1 pendant la sortie. Tout le reste s'en
 * dérive linéairement entre des bornes nommées — rien n'est posé par paliers, et l'état est
 * une fonction de `age` seul, donc reproductible à l'image près.
 */
export function geometrieDecouverte(depuis: number, now: number): GeoDecouverte {
  const age = now - depuis
  const e = clamp01(age / DECOUVERTE_ENTREE_MS)
  const s = clamp01((age - DECOUVERTE_TENUE_MS) / DECOUVERTE_SORTIE_MS)
  return {
    opacite: e * (1 - s),
    dy: (1 - e) * DEC_DY_ENTREE - s * DEC_DY_SORTIE,
    ecart: DEC_ECART_SERRE + (DEC_ECART_LARGE - DEC_ECART_SERRE) * ((1 - e) + s * 0.6),
    echelle: DEC_ECHELLE_MIN + (1 - DEC_ECHELLE_MIN) * e + (DEC_ECHELLE_SORTIE - 1) * s,
    filet: e * (1 - s * s),
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * LA FILE EST BORNÉE. Sans plafond, une rafale (une horde qui arrive pendant qu'on rate
 * trois poses) ferait défiler des messages périmés pendant une demi-minute — le joueur
 * lirait le passé. Au-delà, on garde les plus RÉCENTS : c'est ce qui vient de se passer
 * qui compte, pas ce qu'on a raté il y a vingt secondes.
 */
export const FILE_MAX = 4

export interface Bandeaux {
  /**
   * Une frame. Les trois files sont DRAINÉES ce tour-ci (elles peuvent être vides) ; le
   * module les met dans ses propres files et n'en montre qu'une à la fois par canal.
   * `decouvertes` porte des NOMS DE LIEU — le surtitre est écrit ici, pas par l'émetteur.
   */
  update(
    now: number,
    alertes: readonly string[],
    conseils: readonly string[],
    decouvertes?: readonly string[],
  ): void
  /** Ce qui est à l'écran, pour les gardes et les sondes. `null` = le créneau est libre. */
  visible(): { alerte: string | null; conseil: string | null; decouverte: string | null }
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
    /* DESCENDU SOUS LA BARRE HAUTE (2026-08-24) : il vivait à 72 px, très exactement la
       hauteur de la barre — il se serait peint derrière elle, à cheval sur son filet. */
    .bnd-conseil{top:${BARRE_H + 32}px;font-size:15px;color:#e8c66a;}
    /* L'ALERTE, en bas : le rouge du refus et du danger. */
    .bnd-alerte{bottom:110px;font-size:15px;color:#ff7a6b;}
    /* LA DÉCOUVERTE, au centre haut : un carton de titre. 30 % de la hauteur — MESURÉ (le
       carton était à 38 %, il tombait pile sur l'avatar, qui tient le centre de l'écran). Aucune
       transition CSS : tout vient de geometrieDecouverte, image par image. */
    /* PAS DE TRANSITION : l'opacité est calculée, pas interpolée par le navigateur — sinon
       une frame figée en headless montrerait un état qui n'est pas celui qu'on a calculé. */
    .bnd-dec{top:30%;display:none;transition:none;}
    .bnd-dec-sur{font-size:11px;color:#c0a074;text-transform:uppercase;}
    .bnd-dec-nom{font-size:30px;color:#f2ead0;margin-top:9px;transform-origin:50% 0;}
    /* LE FILET : un trait de braise sous le surtitre, qui s'ouvre du centre vers les bords.
       C'est lui qui donne l'ARRIVÉE — un texte qui apparaît n'arrive pas, il est là. */
    .bnd-dec-filet{height:2px;margin:7px auto 0;background:linear-gradient(90deg,
      rgba(201,139,58,0),rgba(232,198,106,.95),rgba(201,139,58,0));}
    /* Un SOL, comme celui du HUD : ces deux lignes se peignent sur le monde, à toute heure.
       Sans lui, l'alerte tombait à 1,7:1 sur l'herbe de midi — le message qui crie était le
       moins lisible du cadre. Le voile s'éteint sur les bords : une plaque à bord franc
       ferait une barre noire en travers d'un jeu qui n'en a aucune. */
    .bnd-l::before{content:'';position:absolute;inset:-14px -40px;z-index:-1;pointer-events:none;
      background:radial-gradient(ellipse at center,rgba(10,8,6,.82),rgba(10,8,6,.52) 58%,rgba(10,8,6,0) 84%);}
  </style>
  <div class="bnd-l bnd-conseil"></div>
  <div class="bnd-l bnd-alerte"></div>
  <div class="bnd-l bnd-dec">
    <div class="bnd-dec-sur">Nouveau lieu découvert</div>
    <div class="bnd-dec-filet"></div>
    <div class="bnd-dec-nom"></div>
  </div>`
  document.body.appendChild(root)

  const conseilEl = root.querySelector<HTMLElement>('.bnd-conseil')!
  const alerteEl = root.querySelector<HTMLElement>('.bnd-alerte')!
  const decEl = root.querySelector<HTMLElement>('.bnd-dec')!
  const decSurEl = root.querySelector<HTMLElement>('.bnd-dec-sur')!
  const decNomEl = root.querySelector<HTMLElement>('.bnd-dec-nom')!
  const decFiletEl = root.querySelector<HTMLElement>('.bnd-dec-filet')!
  const conseil: Creneau = { file: [], affiche: null, depuis: 0 }
  const alerte: Creneau = { file: [], affiche: null, depuis: 0 }
  const decouverte: Creneau = { file: [], affiche: null, depuis: 0 }

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

  /** LE CARTON. Tout son état visuel vient de la géométrie pure : ce bloc ne DÉCIDE rien,
   *  il pose des px et des opacités. `display:none` quand le créneau est libre — un carton
   *  vide à opacité 0 garderait son sol radial en travers de l'écran. */
  const peindreDecouverte = (now: number): void => {
    if (decouverte.affiche === null) {
      decEl.style.display = 'none'
      decNomEl.textContent = ''
      return
    }
    const g = geometrieDecouverte(decouverte.depuis, now)
    decEl.style.display = 'block'
    decNomEl.textContent = decouverte.affiche
    decEl.style.opacity = String(g.opacite)
    decEl.style.transform = `translate(-50%, ${g.dy}px)`
    decSurEl.style.letterSpacing = `${g.ecart}px`
    decNomEl.style.transform = `scale(${g.echelle})`
    decFiletEl.style.width = `${Math.round(g.filet * 240)}px`
  }

  return {
    update(now, alertes, conseils, decouvertes = []) {
      empiler(alerte.file, alertes)
      empiler(conseil.file, conseils)
      empiler(decouverte.file, decouvertes)
      avancerCreneau(alerte, now, ALERTE_HOLD_MS, ALERTE_FADE_MS)
      avancerCreneau(conseil, now, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)
      avancerCreneau(decouverte, now, DECOUVERTE_TENUE_MS, DECOUVERTE_SORTIE_MS)
      peindre(alerteEl, alerte, now, ALERTE_HOLD_MS, ALERTE_FADE_MS)
      peindre(conseilEl, conseil, now, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)
      peindreDecouverte(now)
    },
    visible() {
      return { alerte: alerte.affiche, conseil: conseil.affiche, decouverte: decouverte.affiche }
    },
    destroy() {
      root.remove()
    },
  }
}
