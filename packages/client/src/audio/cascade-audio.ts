/**
 * LA VOIX DE LA CASCADE (B1, reprise de l'eau — 2026-09-12). `cascade-fx.ts` faisait tomber des
 * gouttes, monter la brume et vaciller la lueur d'une chute parfaitement MUETTE.
 *
 * ═══ CE QU'ELLE EST ═══
 * Une NAPPE (`SoundEngine.nappe('cascade')` : bruit passe-bas grave qui respire), UNE pour tout le
 * monde, dont la cible — niveau, côté, voile — se RECALCULE depuis toutes les colonnes de chute de
 * la carte (`CliffLayer.toutesLesChutes`) et l'auditeur (l'avatar) : chaque colonne se PLACE par
 * `placer` (la même loi que tout son du jeu — plein sous `PLEIN_TUILES × MASSE`, queue jusqu'à
 * `PORTEE_TUILES × MASSE`, silence au-delà), et les colonnes s'ajoutent EN PUISSANCE : deux bruits
 * incohérents font √2, pas 2 — une chute large de quatre tuiles gronde deux fois plus qu'une
 * colonne, pas quatre. Le côté est le barycentre des puissances, le voile leur moyenne, coupée au
 * timbre (`min`, la règle de `buildSound` : deux passe-bas ne se cascadent pas).
 *
 * ═══ POURQUOI TOUTES LES CHUTES, PAS CELLES DE L'IMAGE ═══
 * `CliffLayer.chutes` ne liste que ce que la caméra montre ; une voix qui les suivrait naîtrait au
 * bord de l'écran, d'un bloc. Le son porte AU-DELÀ du cadre (décision d'Alexis, 2026-08-27 : on
 * entend le loup avant de le voir) — la chute aussi : à `MASSE`, ~40 tuiles, un peu plus loin que
 * le demi-cadre et demi. C'est ce qui fait qu'on marche VERS un grondement.
 *
 * Une seule nappe et non une par chute : deux chutes voisines sont le même bruit, et une par
 * colonne (76 colonnes sur le cadrage cascade de T-A9) serait 76 sources pour un seul son.
 *
 * ⚠ ESTHÉTIQUE À VALIDER À L'OREILLE (doctrine de tout l'audio du dépôt) : gains BAS, un lit
 * permanent reste sous les lits du ciel (≤ 0,06). Se cale au banc d'écoute — panneau « L'EAU »
 * (atelier `#son`), qui joue cette même cible sur le vrai moteur.
 */
import type { FormeDeNappe, Nappe } from './engine'
import { COMPENSATION_PAN, placer, PORTEE, VOILE_TRANSPARENT_HZ } from './spatial'

/** Une colonne de chute : la tuile haute `(tx, ty)`, l'eau du pied en `(tx, ty + 1)` — `ChuteVue`. */
export interface ColonneDeChute {
  tx: number
  ty: number
}

export const CASCADE = {
  /** Le gain d'UNE colonne, « ici » (sous `PLEIN_TUILES × PORTEE`), au tympan. */
  GAIN_COLONNE: 0.028,
  /** Le plafond du lit, quelle que soit la largeur de la chute — le grondement reste un décor. */
  GAIN_MAX: 0.06,
  /** La coupe du timbre (Hz) : un grondement, pas un crépitement (la pluie coupe à 1 600-2 000). */
  HZ: 900,
  /** La puissance : une masse d'eau qui retombe — `MASSE`, comme l'éboulis (plein à 4,5 t, porte à 40). */
  PORTEE: PORTEE.MASSE,
  /** Le fondu des cibles (s) — plus court que le ciel (1,2) : on LONGE une chute en marchant. */
  FONDU_S: 0.5,
  /** La cadence de la relecture (ms) : l'auditeur bouge d'un demi-pas entre deux, pas besoin de plus. */
  CADENCE_MS: 200,
} as const

export interface CibleDeCascade {
  /** Le niveau tendu à la nappe — AU TYMPAN × `COMPENSATION_PAN` (la nappe porte un panner). */
  gain: number
  /** La coupe (Hz) : le timbre, voilé par la distance. */
  hz: number
  /** Le côté (−`PAN_MAX`..`PAN_MAX`), barycentre des puissances. 0 sans colonne à portée. */
  pan: number
  /** Combien de colonnes sont à portée — la sonde. */
  colonnes: number
}

const REPOS: CibleDeCascade = { gain: 0, hz: CASCADE.HZ, pan: 0, colonnes: 0 }

/**
 * LA CIBLE de la nappe pour un auditeur en (`x`, `y`) (tuiles) et les colonnes de la carte.
 * `dehors` (0..1) : la part du ciel qu'on a au-dessus de soi (`dehorsIci`) — sous la roche, la
 * chute du plateau se tait comme la pluie.
 *
 * Pure, sans état : c'est elle que le banc joue, et que le test garde.
 */
export function cibleDeLaCascade(colonnes: readonly ColonneDeChute[], x: number, y: number, dehors = 1): CibleDeCascade {
  if (dehors <= 0 || colonnes.length === 0) return REPOS
  let energie = 0
  let panPondere = 0
  let voilePondere = 0
  let n = 0
  for (let k = 0; k < colonnes.length; k++) {
    const c = colonnes[k]!
    // La source : le milieu de la colonne, à la lèvre — là où l'eau bascule.
    const p = placer(c.tx + 0.5 - x, c.ty + 1 - y, CASCADE.PORTEE)
    if (!p) continue
    // `placer` rend le gain COMPENSÉ (× √2 pour le panner) : on revient à l'atténuation nue
    // pour sommer des puissances qui valent 1 « ici ».
    const a = p.gain / COMPENSATION_PAN
    const e = a * a
    energie += e
    panPondere += e * p.pan
    voilePondere += e * (p.lowpass ?? VOILE_TRANSPARENT_HZ)
    n += 1
  }
  if (n === 0 || energie <= 0) return REPOS
  const tympan = Math.min(CASCADE.GAIN_MAX, CASCADE.GAIN_COLONNE * Math.sqrt(energie)) * dehors
  return {
    gain: tympan * COMPENSATION_PAN,
    hz: Math.min(CASCADE.HZ, voilePondere / energie),
    pan: panPondere / energie,
    colonnes: n,
  }
}

export class SonsDeLaCascade {
  /** La sonde du smoke et des tests : la dernière cible calculée, au tympan. */
  readonly sonde = { gain: 0, pan: 0, hz: CASCADE.HZ as number, colonnes: 0 }
  private nappe: Nappe | null = null
  private derniere: CibleDeCascade | null = null
  private prochaineLecture = -Infinity

  /**
   * Chaque image : la nappe suit l'auditeur. `ouvre` rend la nappe ou `null` tant que l'audio
   * dort (patron du thème) — et on ne l'ouvre qu'à la PREMIÈRE colonne à portée : un monde sans
   * chute, ou un joueur qui n'en approche jamais, ne fait pas tourner une source pour rien.
   */
  update(
    ouvre: (forme: FormeDeNappe) => Nappe | null,
    colonnes: readonly ColonneDeChute[],
    x: number,
    y: number,
    dehors: number,
    nowMs: number,
  ): void {
    if (nowMs < this.prochaineLecture) return
    this.prochaineLecture = nowMs + CASCADE.CADENCE_MS
    const c = cibleDeLaCascade(colonnes, x, y, dehors)
    this.sonde.gain = c.gain / COMPENSATION_PAN
    this.sonde.pan = c.pan
    this.sonde.hz = c.hz
    this.sonde.colonnes = c.colonnes
    if (c.gain > 0) this.nappe ??= ouvre('cascade')
    // Tant que l'audio dort, AUCUNE cible n'est « posée » : la mémoriser ferait sauter la pose
    // au réveil (la garde de `meteo-audio`).
    if (this.nappe === null) {
      this.derniere = null
      return
    }
    const d = this.derniere
    if (d && Math.abs(d.gain - c.gain) < 0.0005 && Math.abs(d.hz - c.hz) < 1 && Math.abs(d.pan - c.pan) < 0.005) return
    this.derniere = c
    this.nappe.regler(c.gain, c.hz, CASCADE.FONDU_S, c.pan)
  }

  /** Taire la chute — au `shutdown` de la scène, comme le ciel (`SonsDuCiel.taire`) : une nappe
   *  est branchée sur le master du moteur, qui survit à la scène ; sans ça elle gronde sur le menu. */
  taire(): void {
    this.nappe?.arreter()
    this.nappe = null
    this.derniere = null
    this.prochaineLecture = -Infinity
    this.sonde.gain = 0
    this.sonde.pan = 0
    this.sonde.hz = CASCADE.HZ
    this.sonde.colonnes = 0
  }
}
