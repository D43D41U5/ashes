/**
 * LES SERPENTINS DU VENT (spec `vent.md` V9, décision d'Alexis 2026-08-24).
 *
 * ═══ POURQUOI DESSINER LE VENT, ALORS QU'ON A DIT L'INVERSE ═══
 *
 * Wind Waker ne dessine presque jamais le vent : il le rend lisible sur ce qu'il POUSSE, et
 * tout pousse dans le même sens. C'est le modèle du jeu — herbes couchées, fumée qui file,
 * braises emportées — et il ne change pas.
 *
 * Mais ce modèle a un angle mort : il ne dit rien LÀ OÙ IL N'Y A RIEN À POUSSER. Une lande
 * rase, un gué, un champ de cendre : le vent y devient invisible au moment précis où il
 * compte, c'est-à-dire quand un front approche. Le serpentin est le recours — l'autre pôle,
 * celui de Sea of Thieves : on rend le champ VISIBLE, en le traversant de rubans.
 *
 * ═══ TROIS RÈGLES QUI L'EMPÊCHENT DE DEVENIR DU BRUIT ═══
 *
 * 1. C'EST UN ÉVÉNEMENT, PAS UNE AMBIANCE. La densité suit le CARRÉ de la part de souffle
 *    au-dessus de l'ambiance : à l'ambiance il n'y en a aucun, jamais. Ils naissent quand le
 *    front approche — c'est-à-dire pendant l'AVANCE DE PHASE (`vent.md` V2), avant la pluie.
 *    Le serpentin est donc un PRÉSAGE, gagné, et non une décoration permanente.
 * 2. IL VIT DANS L'AIR, PAS AU SOL. En vue directe, tout ce qui bouge à l'écran est lu comme
 *    une entité. Le ruban est donc rapide, court, translucide et sans ombre — rien qui puisse
 *    se confondre avec du gibier ou un projectile.
 * 3. IL EST QUANTIFIÉ. Rectangles à bords francs sur la grille de 4 px des FX de lumière,
 *    comme le grain de la pluie — jamais un trait lissé qui trahirait la DA.
 *
 * Le CHAMP ci-dessous est pur (ni Phaser ni caméra) : c'est ce qui le rend testable en Node.
 */

import type { Vue } from './meteo-particules'
import { creerRng } from './meteo-particules'

/**
 * Le plafond. Petit par nature : au-delà, ce n'est plus une rafale, c'est un rideau.
 *
 * ⚠ CALIBRÉ À L'ŒIL, ET REVU À LA BAISSE. À 26, la planche du banc montrait des BARRES
 * horizontales régulières — on lisait un artefact de compression, pas du vent. Le compte n'est
 * qu'une moitié du remède : l'autre est l'effilage de la queue (voir `vent-layer`), sans lequel
 * un ruban d'épaisseur constante reste une barre, fût-elle seule.
 */
export const BUDGET_SERPENTINS = 14

/** La grille des FX de lumière — la même que le flocon (`meteo-layer`). */
export const GRAIN_PX = 4

/** Vitesse d'un ruban, en tuiles/s, à souffle plein. Un ruban TRAVERSE : il ne dérive pas. */
const VITESSE = 26
/**
 * LE TAUX DE NAISSANCE, EN RUBANS PAR SECONDE — et surtout pas par IMAGE.
 *
 * La première écriture en semait UN PAR IMAGE. À 60 fps le cadre se peuple en moins d'une
 * demi-seconde, ce qui est le bon geste ; mais le FX devenait alors fonction du framerate, et
 * le banc headless l'a montré sans appel — une image y dure une dizaine de secondes, et le
 * cadre plafonnait à cinq rubans là où le jeu en montre vingt-six. On ne l'aurait pas vu à
 * l'œil : on aurait jugé le FX sur l'instrument.
 */
const NAISSANCES_PAR_S = 60

/** Durée de vie, en secondes — le fuseau d'alpha s'y inscrit tout entier. */
const VIE_MIN = 0.75
const VIE_MAX = 1.5

export interface Serpentin {
  x: number
  y: number
  vx: number
  vy: number
  /** L'âge, en secondes. `vie < 0` = mort (le troupeau est un pool : on ne réalloue jamais). */
  vie: number
  duree: number
  /** Sa longueur propre, en tuiles — deux rubans côte à côte ne sont pas jumeaux. */
  longueur: number
}

/**
 * LE TROUPEAU. Pur : il ne connaît qu'un cadre en tuiles, un cap et une part de souffle.
 */
export class ChampSerpentins {
  readonly serpentins: Serpentin[] = []
  /** Combien vivent — LU PAR LE SMOKE. */
  vivants = 0
  /** Le compte visé cette image — LU PAR LE SMOKE. */
  cible = 0
  private readonly rng: () => number

  constructor(graine = 0x5e_7e_47_1c) {
    this.rng = creerRng(graine)
    for (let i = 0; i < BUDGET_SERPENTINS; i++) {
      this.serpentins.push({ x: 0, y: 0, vx: 0, vy: 0, vie: -1, duree: 1, longueur: 1 })
    }
  }

  vider(): void {
    for (const s of this.serpentins) s.vie = -1
    this.vivants = 0
    this.cible = 0
  }

  /**
   * UNE IMAGE. `dt` en secondes (borné par l'appelant), `vue` le cadre visible en tuiles,
   * `cap` le vecteur unitaire du vent, `part` la part de souffle au-dessus de l'ambiance
   * (0 au calme, 1 au cœur d'une bande).
   */
  update(dt: number, vue: Vue, cap: { x: number; y: number }, part: number): void {
    const u = Math.min(1, Math.max(0, part))
    // LE CARRÉ, et c'est le cœur de la règle n°1 : à mi-souffle il n'y a qu'un quart des
    // rubans. Une densité linéaire en aurait semé en permanence — du bruit, pas un présage.
    this.cible = Math.round(BUDGET_SERPENTINS * u * u)
    const n = Math.sqrt(cap.x * cap.x + cap.y * cap.y)
    const dx = n === 0 ? 1 : cap.x / n
    const dy = n === 0 ? 0 : cap.y / n

    let vivants = 0
    for (const s of this.serpentins) {
      if (s.vie < 0) continue
      s.vie += dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      // Il meurt de VIEILLESSE ou de sortie de cadre — jamais il ne rentre par l'autre bord
      // comme une goutte : une rafale passe, elle ne tourne pas en rond.
      const dehors = s.x < vue.x0 - 4 || s.x > vue.x1 + 4 || s.y < vue.y0 - 4 || s.y > vue.y1 + 4
      if (s.vie >= s.duree || dehors) {
        s.vie = -1
        continue
      }
      vivants++
    }

    // UNE BOURRASQUE MONTE, ELLE NE CLAQUE PAS : la naissance est cadencée EN SECONDES (voir
    // `NAISSANCES_PAR_S`), donc au moins un ruban dès qu'il en manque, et davantage si l'image
    // a été longue. Le plafond reste la cible : on ne dépasse jamais.
    let aNaitre = Math.min(this.cible - vivants, Math.max(1, Math.ceil(dt * NAISSANCES_PAR_S)))
    if (vivants < this.cible) {
      for (const s of this.serpentins) {
        if (aNaitre <= 0) break
        if (s.vie >= 0) continue
        this.naitre(s, vue, dx, dy, u)
        vivants++
        aNaitre--
      }
    }
    this.vivants = vivants
  }

  /** Il naît EN AMONT du cadre — du côté d'où le vent vient — et le traverse. */
  private naitre(s: Serpentin, vue: Vue, dx: number, dy: number, u: number): void {
    const largeur = vue.x1 - vue.x0
    const hauteur = vue.y1 - vue.y0
    const cx = (vue.x0 + vue.x1) / 2
    const cy = (vue.y0 + vue.y1) / 2
    // Le rayon qui met la naissance HORS du cadre quel que soit le cap : la demi-diagonale.
    const rayon = Math.sqrt(largeur * largeur + hauteur * hauteur) / 2
    // Un décalage par le travers, pour que les rubans ne partent pas tous du même point.
    const travers = (this.rng() - 0.5) * 2 * rayon
    s.x = cx - dx * rayon - dy * travers
    s.y = cy - dy * rayon + dx * travers
    // La vitesse suit le souffle : une rafale de front file, une bouffée traîne.
    const v = VITESSE * (0.55 + 0.45 * u) * (0.8 + 0.4 * this.rng())
    s.vx = dx * v
    s.vy = dy * v
    s.vie = 0
    s.duree = VIE_MIN + (VIE_MAX - VIE_MIN) * this.rng()
    s.longueur = 1.6 + 2.4 * this.rng()
  }
}

/**
 * L'ALPHA D'UN RUBAN — un FUSEAU : il s'allume, il file, il s'éteint. Jamais d'apparition ni
 * de disparition franche (ce serait lu comme un défaut de rendu, pas comme du vent).
 *
 * Exporté pour être gardé : c'est une pente continue, et les deux bouts valent zéro.
 */
export function alphaDuSerpentin(vie: number, duree: number): number {
  if (vie < 0 || vie >= duree) return 0
  const t = vie / duree
  // Une parabole 4·t·(1−t) : maximum 1 au milieu, zéro aux deux bouts, dérivée finie partout.
  return 4 * t * (1 - t)
}
