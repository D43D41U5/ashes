/**
 * LA BARRE HAUTE — où je suis, où en est l'année, quel temps il fait.
 *
 * Elle remplace le coin haut-gauche du HUD (`hud-core`), qui écrivait tout le temps la même
 * ligne : « JOUR 51 — ACTE II — 14H ». Trois défauts d'un coup, et c'est ce qui l'a motivée :
 * la ligne disait l'acte en CHIFFRES ROMAINS alors que les saisons ont des noms depuis la
 * refonte du calendrier ; elle ne disait rien du DÉFILÉ (on savait le jour, jamais combien il
 * restait avant l'hiver) ; et sa ligne de lieu mélangeait la région et le lieu.
 *
 * ═══ LES TROIS BLOCS ═══
 *
 * À GAUCHE, OÙ JE SUIS — le toponyme, le lieu qu'on foule, l'air qu'il fait ici en °C. Le
 * médaillon d'en bas dit la température du CORPS ; celui-ci dit celle du MONDE, et c'est
 * l'information qui manquait : on ne savait jamais si l'endroit où l'on va est tenable.
 *
 * AU CENTRE, LE RUBAN DE L'ANNÉE — une fenêtre de 30 jours (une saison pile) à 23 px/jour, la
 * tête de lecture AU TIERS : dix jours derrière, vingt devant. La saison qui vient entre par
 * la droite et grossit, sans qu'aucun chiffre ne l'annonce (« le monde le dit, l'interface
 * non » — `saisons.md` S18/Q16). La barre nomme le PRÉSENT, elle ne prédit pas.
 *
 * À DROITE, LE CIEL ET L'HEURE — le dégradé n'est pas décoratif : c'est la loi d'ambiance du
 * jeu (`lighting.ts`), donc le ruban porte la teinte que le monde AURA à cette heure-là, et
 * l'aube y a la vraie pente. L'icône dit le temps qu'il fait AU POINT DU JOUEUR.
 *
 * ═══ CE QU'ELLE NE FAIT PAS ═══
 *
 * Aucune règle : tout arrive résolu par `UIScene`. Aucune couleur inventée non plus — les
 * quatre teintes de saison viennent de `teinte-saison.ts` (celles que le SOL portera) et le
 * ciel de `lighting.ts`. Les recopier ici, c'est la dérive que `palette.ts` raconte déjà
 * (« trois rouges pour un seul accent »).
 */
import { BALANCE, type GameTime, type MeteoAspect } from '@ashes/sim'
import { AMBIENT_KEYS } from '../../render/lighting'
import { CARDINAUX as CARDINAUX_SAISON } from '../../render/teinte-saison'
import { INK_OUTLINE, INK_OUTLINE_STRONG } from './hud-dom'
import { HEX } from './palette'

/** Hauteur de la barre. Le bandeau CONSEIL vit dessous (`bandeaux.ts`). */
export const BARRE_H = 72

/** Le ruban : une fenêtre d'une saison pile, tête de lecture au tiers. */
const PX_PAR_JOUR = 23
const FENETRE = PX_PAR_JOUR * BALANCE.ACT_DAYS
const TETE = Math.round(FENETRE / 3)
/** Le ruban de l'heure : ±5 h autour de la tête, elle aussi au tiers. */
const PX_PAR_HEURE = 22
const FENETRE_H = 216
const TETE_H = Math.round(FENETRE_H / 3)

/**
 * LA GRÂCE DE SORTIE D'UN LIEU (décision d'Alexis, 2026-08-24) — 500 ms, DÉRIVÉE.
 *
 * `lieuAt` est un test de rectangle : longer le bord d'une empreinte fait entrer et sortir à
 * chaque pas, et la barre clignoterait. On garde donc le lieu affiché un moment après la
 * sortie. La durée ne se choisit pas, elle est encadrée — patron de `GEL.HYSTERESIS` :
 *
 *   PLANCHER 440 ms — deux fois l'animation (220 ms). En dessous, la sortie s'amorce et se
 *   fait rattraper en plein vol : c'est un anti-rebond, pas une grâce.
 *   PLAFOND 500 ms — le temps de TRAVERSER LA PLUS PETITE EMPREINTE EN SPRINT (3 tuiles à
 *   6 t/s). Au-delà, un joueur qui court aurait franchi un lieu entier en lisant encore le
 *   précédent — juste au moment où ça compte, en passant devant une Tanière.
 *
 * Les deux bornes se rejoignent. Elle vit CÔTÉ CLIENT : c'est de l'affichage, la mettre dans
 * la sim changerait l'état et le replay. Comparée en ÂGE dans `update`, sur l'horloge Phaser,
 * jamais un `delayedCall` — l'horloge headless saute et enjamberait le front.
 */
export const LIEU_GRACE_MS = 500

/** Le mouvement d'entrée et de sortie d'un lieu (voir le CSS). */
const ANIM_MS = 220

/**
 * LE SOL DE LA BARRE — et sa garde.
 *
 * La barre pose du texte sur le monde, comme le coin haut-gauche avant elle : elle a donc
 * besoin du même sol, et de la même preuve. `hud-plaque.test` mesurait le contraste composite
 * du HUD sur les pires fonds relevés au banc (le sol de midi, une tache de soleil) ; la barre
 * introduit un fond DIFFÉRENT — un dégradé vertical, pas un voile radial — et y met le texte
 * le plus important de l'écran. Sans extension de la garde, ce texte serait passé sur un fond
 * que personne n'a mesuré, et le test serait resté vert en ne gardant plus rien.
 *
 * Les trois arrêts sont ceux du CSS, PARTAGÉS avec lui : le dégradé se construit à partir
 * d'eux (`solDeLaBarre`), donc une retouche « pour faire moins lourd » déplace la garde avec.
 */
export const BARRE_SOL_ENCRE = '12,9,7'
/**
 * `[position dans la hauteur, opacité]` — du haut de la barre à son bas.
 *
 * PRESQUE PLAT, et c'est voulu (2026-08-24) : la barre est sombre d'un bord à l'autre et de
 * haut en bas. La première version tombait à 0,62 sur son dernier cinquième — le rang des
 * numéros de jour y perdait son sol. Ce qui doit fondre, c'est ce qui vient APRÈS la barre :
 * `.bh-ombre` s'en charge, sous le filet.
 */
export const BARRE_SOL_ARRETS: readonly (readonly [number, number])[] = [
  [0, 0.96],
  [1, 0.92],
]
/** Le bas du rang de texte le plus bas de la barre (les numéros de jour du ruban), en part de
 *  la hauteur : c'est là que le sol est le plus mince sous une lettre. */
const BAS_DU_TEXTE = (10 + 37 + 10) / BARRE_H

/** L'opacité du sol à une hauteur donnée — l'interpolation même du dégradé CSS. */
export function opaciteDuSol(part: number): number {
  const arrets = BARRE_SOL_ARRETS
  for (let i = 1; i < arrets.length; i += 1) {
    const [p0, a0] = arrets[i - 1]!
    const [p1, a1] = arrets[i]!
    if (part <= p1) return a0 + ((a1 - a0) * (part - p0)) / (p1 - p0)
  }
  return arrets[arrets.length - 1]![1]
}

/** LA PIRE OPACITÉ SOUS UNE LETTRE de la barre — dérivée, jamais écrite. C'est elle que la
 *  garde de contraste éprouve. */
export const BARRE_ALPHA_MIN = opaciteDuSol(BAS_DU_TEXTE)

function solDeLaBarre(): string {
  const stops = BARRE_SOL_ARRETS.map(
    ([p, a]) => `rgba(${BARRE_SOL_ENCRE},${a}) ${(p * 100).toFixed(0)}%`,
  )
  return `linear-gradient(180deg,${stops.join(',')})`
}

/** `0xrrggbb` (Phaser) → `#rrggbb` (CSS). */
function hex(col: number): string {
  return '#' + col.toString(16).padStart(6, '0')
}

/**
 * LE CIEL DU RUBAN — la loi d'ambiance du jeu, composée sur un sol de plein jour.
 *
 * `AMBIENT_KEYS` donne, heure par heure, la teinte et l'opacité du voile que le monde porte.
 * Ce voile se pose en MULTIPLY sur le rendu : on refait ici le même mélange sur une couleur de
 * sol unique, et le ruban devient un échantillon honnête de la journée. L'aube et le
 * crépuscule y ont donc les vraies pentes — la chute de 20 h à 21 h est raide parce que
 * l'opacité y passe de 0,34 à 0,60 en une heure, pas parce qu'on l'a dessinée ainsi.
 *
 * `SOL_ETALON` est le seul nombre choisi à l'œil de tout le bloc : à pleine clarté, le ruban
 * était la chose la plus lumineuse de la barre et volait le regard.
 */
const SOL_ETALON = [0xa6, 0x9e, 0x8a] as const

function cielDuJour(): string {
  const stops = AMBIENT_KEYS.map((k) => {
    const t = [(k.color >> 16) & 255, (k.color >> 8) & 255, k.color & 255]
    const canal = (i: number): number =>
      Math.round(SOL_ETALON[i]! * (1 - k.alpha) + ((SOL_ETALON[i]! * t[i]!) / 255) * k.alpha)
    return `rgb(${canal(0)},${canal(1)},${canal(2)}) ${((k.hour / 24) * 100).toFixed(2)}%`
  })
  return `linear-gradient(90deg,${stops.join(',')})`
}

/**
 * LA TEINTE D'UNE SAISON — celle que le SOL portera, pas un accent de HUD.
 *
 * Les quatre cardinaux de `teinte-saison.ts` sont les couleurs vers lesquelles le décor se
 * fond au cœur de chaque saison. Le ruban les reprend telles quelles : sa bande a donc la
 * couleur de la vallée ce jour-là, et l'année se lit en un coup d'œil — vert tendre, or,
 * roux, gris-bleu. C'est la même idée que la couleur du Feu d'un village : diégétique.
 */
function teinteDeSaison(phase: number): string {
  return hex(CARDINAUX_SAISON[(phase - 1) % CARDINAUX_SAISON.length]!.teinte.cible)
}

/** Le remplissage d'une bande : sa teinte, très diluée — le nom doit rester lisible dessus. */
function fondDeSaison(phase: number): string {
  const c = CARDINAUX_SAISON[(phase - 1) % CARDINAUX_SAISON.length]!.teinte.cible
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},.20)`
}

/** L'encre d'une température d'air : ce qui brûle, ce qui va, ce qui mord. */
function encreDuFroid(c: number): string {
  if (c >= 18) return HEX.emberDeep
  if (c >= 8) return HEX.ember
  if (c >= 0) return HEX.body
  return HEX.gel
}

export interface BarreHauteState {
  time: GameTime
  /** La région (`toponymeAt`) — undefined hors de toute zone nommée. */
  toponyme: string | undefined
  /** Le lieu qu'on foule (`lieuAt`) — undefined dehors. Son nom porte déjà son sort. */
  lieu: string | undefined
  /** L'air qu'il fait ici, en °C — undefined tant que le monde n'a rien dit. */
  ambiant: number | undefined
  /** Le ciel au point du joueur — `null` par temps dégagé (→ soleil ou lune). */
  ciel: MeteoAspect | null
  /** Le caractère de la saison, déjà nommé — undefined deux saisons sur trois. */
  caractere: string | undefined
  /** L'horloge Phaser : c'est elle qui mesure la grâce de sortie. */
  now: number
}

export interface BarreHaute {
  update(s: BarreHauteState): void
  setVisible(v: boolean): void
  destroy(): void
}

/**
 * ═══ CE QUE LA BARRE MONTRE, EN NOMBRES — le cœur PUR ═══
 *
 * Tout ce que la barre décide se calcule ici, sans toucher au DOM : la grâce de sortie, les
 * deux bouts du mouvement, l'encre du froid, le glissement du tapis, l'icône du ciel. Le
 * module qui peint n'a plus qu'à poser des valeurs.
 *
 * Ce n'est pas un raffinement, c'est ce qui rend la barre TESTABLE. Le paquet client n'a pas
 * de DOM sous vitest — et surtout la transition de 220 ms appartient au navigateur : on ne la
 * photographie pas en vol. Ce qui se garde, ce sont les DEUX BOUTS qu'elle interpole, et ils
 * sont ici.
 */
export interface VueBarre {
  zone: string
  zoneTaille: string
  zoneLs: string
  zoneEncre: string
  lieuNom: string
  lieuH: string
  lieuOp: string
  lieuX: string
  airVisible: boolean
  airTxt: string
  airEncre: string
  an: string
  jour: string
  tapisX: number
  caractere: string | null
  caractereEncre: string
  heureTxt: string
  cielX: number
  ico: string
}

/** Le dernier lieu traversé, et quand — l'état minuscule que la grâce demande. */
export interface MemoireDuLieu {
  nom: string | undefined
  vuA: number
}

export const MEMOIRE_VIERGE: MemoireDuLieu = { nom: undefined, vuA: -Infinity }

/** La vue, et la mémoire qui va avec — pure, sans effet de bord. */
export function vueDeLaBarre(
  s: BarreHauteState,
  avant: MemoireDuLieu,
): { vue: VueBarre; memoire: MemoireDuLieu } {
  const { time } = s
  // Le nom du dernier lieu SURVIT à la sortie : sans lui, le rang se viderait au premier tick
  // dehors et s'éteindrait d'un coup au lieu de repartir en glissant.
  const memoire: MemoireDuLieu = s.lieu !== undefined ? { nom: s.lieu, vuA: s.now } : avant
  // LA GRÂCE : on tient le lieu un instant après en être sorti (voir LIEU_GRACE_MS).
  const tenu = s.lieu !== undefined || (memoire.nom !== undefined && s.now - memoire.vuA < LIEU_GRACE_MS)
  const c = s.ambiant === undefined ? 0 : Math.round(s.ambiant)
  const centre = (time.seasonDay - 1) * PX_PAR_JOUR + PX_PAR_JOUR / 2
  const heure = Math.floor(time.hourOfCycle)
  return {
    memoire,
    vue: {
      zone: (s.toponyme ?? '').toUpperCase(),
      // La zone se RÉDUIT VERS LE HAUT quand un lieu s'ouvre sous elle : elle passe d'un titre
      // à une ligne de contexte, et remonte d'elle-même (le bloc est centré dans la barre).
      zoneTaille: tenu ? '11px' : '13px',
      zoneLs: tenu ? '3px' : '2px',
      zoneEncre: tenu ? HEX.faint : HEX.dim,
      lieuNom: (memoire.nom ?? '').toUpperCase(),
      lieuH: tenu ? '24px' : '0px',
      lieuOp: tenu ? '1' : '0',
      // Il ENTRE PAR LA GAUCHE en se déplaçant vers la droite, et repart par où il est venu.
      lieuX: tenu ? 'translateX(0)' : 'translateX(-16px)',
      airVisible: s.ambiant !== undefined,
      airTxt: `${c > 0 ? '+' : ''}${c} °C`,
      airEncre: encreDuFroid(c),
      an: `AN ${time.tour}`,
      jour: `JOUR ${time.seasonDay}`,
      // Le tapis glisse d'un jour à l'autre ; la tête, elle, ne bouge jamais.
      tapisX: Math.round(TETE - centre),
      caractere: s.caractere === undefined ? null : s.caractere.toUpperCase(),
      caractereEncre: teinteDeSaison(time.phase),
      heureTxt: `${String(heure).padStart(2, '0')}H`,
      // Le ciel est une TUILE de 24 h répétée : on ne fait que la faire glisser. `+24` garde
      // l'origine positive quand la fenêtre déborde avant minuit.
      cielX: Math.round(TETE_H - ((heure + 24) * PX_PAR_HEURE + PX_PAR_HEURE / 2)),
      ico: s.ciel ?? (time.isNight ? 'lune' : 'soleil'),
    },
  }
}

export function createBarreHaute(board: HTMLElement): BarreHaute {
  const root = document.createElement('div')
  root.className = 'bh'
  root.innerHTML = markup()
  board.appendChild(root)

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const zoneEl = $('.bh-zone')
  const lieuRang = $('.bh-lieu')
  const lieuNomEl = $('.bh-lieu-nom')
  const airEl = $('.bh-air')
  const airTexteEl = $('.bh-air-txt')
  const airIcoEl = $('.bh-air-ico')
  const anEl = $('.bh-an')
  const tapisEl = $('.bh-tapis')
  const jourEl = $('.bh-jour')
  const caractereEl = $('.bh-caractere')
  const caractereNomEl = $('.bh-caractere-nom')
  const caractereFiletEl = $('.bh-caractere-filet')
  const cielEl = $('.bh-ciel')
  const heureEl = $('.bh-heure')
  const icones = new Map<string, HTMLElement>()
  for (const el of root.querySelectorAll<HTMLElement>('.bh-ico')) icones.set(el.dataset.ico!, el)

  cielEl.style.backgroundImage = cielDuJour()

  let memoireLieu: MemoireDuLieu = MEMOIRE_VIERGE
  /** Le jour dont le tapis est peint — il ne se rebâtit qu'au changement de jour. */
  let jourPeint = -1

  return {
    setVisible(v) {
      root.style.display = v ? '' : 'none'
    },

    destroy() {
      root.remove()
    },

    update(s) {
      const { vue, memoire } = vueDeLaBarre(s, memoireLieu)
      memoireLieu = memoire

      zoneEl.textContent = vue.zone
      zoneEl.style.fontSize = vue.zoneTaille
      zoneEl.style.letterSpacing = vue.zoneLs
      zoneEl.style.color = vue.zoneEncre

      lieuNomEl.textContent = vue.lieuNom
      lieuRang.style.height = vue.lieuH
      lieuRang.style.opacity = vue.lieuOp
      lieuRang.style.transform = vue.lieuX

      airEl.style.display = vue.airVisible ? '' : 'none'
      airTexteEl.textContent = vue.airTxt
      airTexteEl.style.color = vue.airEncre
      // Le thermomètre est un TRAIT, comme les icônes de ciel : deux boîtes CSS posées côte à
      // côte par le flex ne s'empilent jamais en thermomètre — elles ne dessinaient rien.
      airIcoEl.setAttribute('stroke', vue.airEncre)

      anEl.textContent = vue.an
      jourEl.textContent = vue.jour
      // Le tapis se REBÂTIT seulement quand le jour change — pas soixante fois par seconde
      // pour un ruban qui avance d'un pixel toutes les deux minutes.
      if (s.time.seasonDay !== jourPeint) {
        jourPeint = s.time.seasonDay
        tapisEl.innerHTML = tapis(s.time)
      }
      tapisEl.style.transform = `translateX(${vue.tapisX}px)`

      caractereEl.style.visibility = vue.caractere === null ? 'hidden' : ''
      caractereNomEl.textContent = vue.caractere ?? ''
      caractereNomEl.style.color = vue.caractereEncre
      caractereFiletEl.style.background = vue.caractereEncre

      heureEl.textContent = vue.heureTxt
      cielEl.style.backgroundPosition = `${vue.cielX}px 3px`
      for (const [nom, el] of icones) el.style.display = nom === vue.ico ? '' : 'none'
    },
  }

  /** Les bandes de saison, les graduations et la couture de l'an — en HTML, d'un bloc. */
  function tapis(time: GameTime): string {
    const acte = Math.floor((time.seasonDay - 1) / BALANCE.ACT_DAYS) + 1
    const parts: string[] = []
    // Cinq saisons de part et d'autre : de quoi couvrir la fenêtre à tout moment.
    for (let a = Math.max(1, acte - 2); a <= acte + 3; a += 1) {
      const phase = ((a - 1) % BALANCE.ACTS_PER_YEAR) + 1
      const x = (a - 1) * BALANCE.ACT_DAYS * PX_PAR_JOUR
      const w = BALANCE.ACT_DAYS * PX_PAR_JOUR
      const teinte = teinteDeSaison(phase)
      parts.push(
        `<div class="bh-bande" style="left:${x}px;width:${w}px;background:${fondDeSaison(phase)};border-color:${teinte}"></div>`,
      )
      // Le nom se RÉPÈTE le long de sa bande — l'idiome du ruban imprimé : à toute position
      // du tapis, il y en a un dans la fenêtre.
      for (let k = 12; k < w - 130; k += 320) {
        parts.push(`<div class="bh-nom" style="left:${x + k}px;color:${teinte}">${SAISONS[phase - 1]}</div>`)
      }
      // La couture de l'an, au premier jour de la première saison.
      if (phase === 1) parts.push(`<i class="bh-couture" style="left:${x}px"></i>`)
    }
    // Un filet par jour, plus fort tous les dix — où se pose le numéro du jour de l'an.
    const d0 = Math.max(1, time.seasonDay - 22)
    for (let d = d0; d <= time.seasonDay + 34; d += 1) {
      const x = (d - 1) * PX_PAR_JOUR + PX_PAR_JOUR / 2
      const fort = d % 10 === 0
      parts.push(`<i class="bh-tick${fort ? ' bh-tick-fort' : ''}" style="left:${x}px"></i>`)
      if (fort) parts.push(`<div class="bh-num" style="left:${x}px">${d}</div>`)
    }
    // CE QUI EST PASSÉ S'ÉTEINT : un voile du premier jour jusqu'à la tête.
    parts.push(`<div class="bh-passe" style="width:${Math.round((time.seasonDay - 1) * PX_PAR_JOUR + PX_PAR_JOUR / 2)}px"></div>`)
    return parts.join('')
  }
}

/** Les quatre noms, en capitales de HUD. L'ordre EST celui des phases (`nomDeSaison`). */
const SAISONS = ['ÉCLOSION', 'ARDEUR', 'PLUIES', 'GRAND FROID'] as const

/** Le fondu des deux bouts d'un ruban : pas de bord franc dans un jeu qui n'en a aucun. */
function masque(a: number, b: number): string {
  const g = `linear-gradient(90deg,rgba(0,0,0,0) 0,#000 ${a}%,#000 ${b}%,rgba(0,0,0,0) 100%)`
  return `-webkit-mask-image:${g};mask-image:${g};`
}

function markup(): string {
  return `
  <style>
    .bh{position:absolute;left:0;right:0;top:0;height:${BARRE_H}px;pointer-events:none;}
    /* PLEIN D'UN BORD À L'AUTRE (2026-08-24, Alexis : « toute la barre doit avoir un fond
       sombre »). Le voile s'éteignait à 5 % et 95 % : le lieu à gauche et l'heure à droite
       reposaient sur un fond qui s'efface — les deux bouts de la barre étaient les moins
       lisibles. La retenue du HUD (un voile qui s'éteint, pas une dalle) vaut pour une plaque
       DE COIN, qui ferait un rectangle noir dans un angle ; une barre va d'un bord à l'autre,
       elle n'a pas d'angle à trahir. Ce qui fond, c'est ce qui vient APRÈS elle : l'ombre
       sous le filet. */
    .bh-fond{position:absolute;inset:0;background:${solDeLaBarre()};}
    .bh-filet{position:absolute;left:0;right:0;top:${BARRE_H}px;height:1px;background:rgba(107,90,58,.55);}
    .bh-ombre{position:absolute;left:0;right:0;top:${BARRE_H + 1}px;height:22px;
      background:linear-gradient(180deg,rgba(12,9,7,.42),rgba(12,9,7,0));}
    .bh-rang{position:absolute;inset:0;display:flex;align-items:center;gap:28px;padding:0 26px;}

    /* ── OÙ JE SUIS ── */
    .bh-ou{width:310px;display:flex;flex-direction:column;justify-content:center;}
    /* Le passage d'un état à l'autre est une ANIMATION, pas une bascule : le lieu se déplace
       VERS LA DROITE en apparaissant et son rang s'ouvre ; la zone se RÉDUIT VERS LE HAUT.
       Les trois rangs restent MONTÉS en permanence — un rang démonté ne s'anime pas en
       partant, il disparaît. */
    .bh-zone{${INK_OUTLINE}transition:font-size ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),
      letter-spacing ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),color ${ANIM_MS}ms ease;}
    .bh-lieu{overflow:hidden;display:flex;align-items:center;gap:7px;
      transition:height ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),opacity 160ms ease,
      transform ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1);}
    .bh-lieu-nom{font-size:14px;font-weight:700;letter-spacing:1px;color:${HEX.bodyBright};white-space:nowrap;${INK_OUTLINE_STRONG}}
    .bh-lieu-los{width:9px;height:9px;border:1.6px solid ${HEX.bodyBright};transform:rotate(45deg);flex-shrink:0;}
    .bh-air{display:flex;align-items:center;gap:7px;margin-top:4px;}
    .bh-air-txt{font-size:12px;letter-spacing:1px;${INK_OUTLINE}}
    .bh-air-ico{flex-shrink:0;}
    /* Un HUD ne s'impose pas à qui a demandé le calme : le changement reste, le mouvement part. */
    @media (prefers-reduced-motion: reduce){
      .bh-zone,.bh-lieu{transition:none;}
    }

    /* ── LE RUBAN DE L'ANNÉE ── */
    .bh-centre{flex-grow:1;display:flex;align-items:center;gap:14px;justify-content:center;}
    .bh-an{width:58px;flex-shrink:0;text-align:right;font-size:11px;letter-spacing:3px;color:${HEX.faint};${INK_OUTLINE}}
    .bh-fenetre{position:relative;width:${FENETRE}px;height:52px;overflow:hidden;flex-shrink:0;${masque(6, 94)}}
    .bh-tapis{position:absolute;left:0;top:0;height:52px;width:12000px;transition:transform .3s ease;}
    .bh-bande{position:absolute;top:6px;height:26px;border-top:2px solid;border-left:2px solid;}
    .bh-nom{position:absolute;top:12px;font-size:10px;letter-spacing:3px;opacity:.88;white-space:nowrap;
      text-shadow:0 0 4px rgba(12,9,7,.95),0 0 2px rgba(12,9,7,.95);}
    .bh-tick{position:absolute;top:25px;width:1px;height:9px;background:rgba(139,132,116,.42);}
    .bh-tick-fort{top:20px;height:14px;background:${HEX.faint};}
    .bh-num{position:absolute;top:37px;transform:translateX(-50%);font-size:10px;letter-spacing:1px;color:${HEX.faint};}
    .bh-couture{position:absolute;top:4px;width:2px;height:30px;background:${HEX.borderWarm};}
    .bh-passe{position:absolute;left:0;top:6px;height:26px;background:rgba(10,8,6,.60);}
    /* LA TÊTE DE LECTURE, au tiers — elle ne bouge jamais, c'est le monde qui défile. */
    .bh-tete{position:absolute;left:${TETE - 1}px;top:2px;width:2px;height:34px;background:${HEX.emberBright};
      box-shadow:0 0 8px rgba(232,198,106,.6);}
    .bh-tete-los{position:absolute;left:${TETE - 5}px;top:3px;width:9px;height:9px;background:${HEX.emberBright};
      transform:rotate(45deg);}
    .bh-jour{position:absolute;left:${TETE}px;top:36px;transform:translateX(-50%);padding:1px 7px;
      background:${HEX.emberBright};color:${HEX.bgWarm};font-size:10px;font-weight:700;letter-spacing:2px;}
    .bh-caractere{width:146px;flex-shrink:0;display:flex;align-items:center;gap:9px;}
    .bh-caractere-filet{width:3px;height:26px;flex-shrink:0;}
    .bh-caractere-tag{font-size:9px;letter-spacing:2px;color:${HEX.faint};}
    .bh-caractere-nom{font-size:11px;font-weight:700;letter-spacing:1px;white-space:nowrap;${INK_OUTLINE}}

    /* ── LE CIEL ET L'HEURE ── */
    .bh-droite{width:310px;display:flex;align-items:center;justify-content:flex-end;gap:12px;}
    .bh-ciel-fen{position:relative;width:${FENETRE_H}px;height:34px;overflow:hidden;${masque(12, 88)}}
    .bh-ciel{position:absolute;inset:0;background-size:${24 * PX_PAR_HEURE}px 16px;background-repeat:repeat-x;
      transition:background-position .3s ease;}
    .bh-ciel-tete{position:absolute;left:${TETE_H - 1}px;top:1px;width:2px;height:20px;background:${HEX.emberBright};
      box-shadow:0 0 6px rgba(232,198,106,.55);}
    .bh-heure{font-size:15px;font-weight:700;letter-spacing:1px;color:${HEX.title};${INK_OUTLINE_STRONG}}
    .bh-ico{flex-shrink:0;}
  </style>
  <div class="bh-fond"></div>
  <div class="bh-filet"></div>
  <div class="bh-ombre"></div>
  <div class="bh-rang">
    <div class="bh-ou">
      <div class="bh-zone"></div>
      <div class="bh-lieu"><i class="bh-lieu-los"></i><div class="bh-lieu-nom"></div></div>
      <div class="bh-air">
        <svg class="bh-air-ico" width="9" height="12" viewBox="0 0 8 12" fill="none" stroke-width="1.3">
          <path d="M4 1.6v5.2" stroke-linecap="round"/>
          <circle cx="4" cy="9.2" r="2.2"/>
        </svg>
        <span class="bh-air-txt"></span>
      </div>
    </div>

    <div class="bh-centre">
      <div class="bh-an"></div>
      <div class="bh-fenetre">
        <div class="bh-tapis"></div>
        <i class="bh-tete"></i>
        <i class="bh-tete-los"></i>
        <div class="bh-jour"></div>
      </div>
      <div class="bh-caractere">
        <i class="bh-caractere-filet"></i>
        <div>
          <div class="bh-caractere-tag">CARACTÈRE</div>
          <div class="bh-caractere-nom"></div>
        </div>
      </div>
    </div>

    <div class="bh-droite">
      <div class="bh-ciel-fen"><div class="bh-ciel"></div><i class="bh-ciel-tete"></i></div>
      ${icones()}
      <div class="bh-heure"></div>
    </div>
  </div>`
}

/**
 * LES SEPT TEMPS, au trait — les six aspects que `aspectAuPoint` rend au point du joueur
 * (`meteo.md` R11-R13 : la classe du front, plus la dérivation neige/blizzard au froid), plus
 * le soleil et la lune quand le ciel est dégagé. Dessinés en SVG et non en glyphes : le jeu
 * n'a pas d'émoji, et un trait se recolore.
 */
function icones(): string {
  const svg = (nom: string, teinte: string, corps: string): string =>
    `<svg class="bh-ico" data-ico="${nom}" width="17" height="17" viewBox="0 0 16 16" fill="none" ` +
    `stroke="${teinte}" stroke-width="1.4" style="display:none">${corps}</svg>`
  const nuage = `<path d="M4.5 10.5h7a2.5 2.5 0 0 0 0-5 3.5 3.5 0 0 0-6.8-.8 2.9 2.9 0 0 0-.2 5.8Z" stroke-linejoin="round"/>`
  const neigeux = '#9fbcc6'
  return [
    svg(
      'soleil',
      HEX.emberBright,
      `<circle cx="8" cy="8" r="3.1"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3" stroke-linecap="round"/>`,
    ),
    svg('lune', HEX.gel, `<path d="M11.4 10.6A5 5 0 0 1 5.4 4.6a5 5 0 1 0 6 6Z" stroke-linejoin="round"/>`),
    svg('pluie', HEX.gel, `${nuage}<path d="M5.6 12.4v1.9M8 12.8v1.9M10.4 12.4v1.9" stroke-linecap="round"/>`),
    svg('neige', neigeux, `${nuage}<path d="M5.6 12.6v1.6M4.8 13.4h1.6M10.4 12.6v1.6M9.6 13.4h1.6" stroke-linecap="round"/>`),
    svg('orage', HEX.emberBright, `${nuage}<path d="M8.8 12 6.9 14.6h1.6l-.6 1.8" stroke-linejoin="round" stroke-linecap="round"/>`),
    svg(
      'blizzard',
      neigeux,
      `<path d="M4.5 10h7a2.5 2.5 0 0 0 0-5 3.5 3.5 0 0 0-6.8-.8 2.9 2.9 0 0 0-.2 5.8Z" stroke-linejoin="round"/>` +
        `<path d="M2.6 12.6h6.2M4.4 15h6.2M11.2 12.2v1.4M10.4 12.9h1.6" stroke-linecap="round"/>`,
    ),
    svg('brouillard', HEX.dim, `<path d="M2.6 4.6h10.2M1.8 7.5h11.6M3.4 10.4h9.4M2.6 13.3h8.2" stroke-linecap="round"/>`),
    svg(
      'vent_de_cendre',
      HEX.emberDeep,
      `<path d="M1.8 5.4h7.4a1.8 1.8 0 1 0-1.3-3.1" stroke-linecap="round"/>` +
        `<path d="M1.8 9h9a1.9 1.9 0 1 1-1.4 3.2" stroke-linecap="round"/>` +
        `<path d="M1.8 12.6h4.6" stroke-linecap="round"/>`,
    ),
  ].join('')
}
