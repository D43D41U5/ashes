/**
 * LES SERPENTINS DU VENT (spec `vent.md` V9, décision d'Alexis 2026-08-24 ; TRACÉ CHOISI SUR
 * PLANCHE LE 2026-08-25 — « le tourbillon », parmi six tracés animés à l'échelle du jeu).
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
 *    une entité. Le ruban est donc court, translucide et sans ombre — rien qui puisse se
 *    confondre avec du gibier ou un projectile.
 * 3. IL EST QUANTIFIÉ. Rectangles à bords francs sur une grille, comme le grain de la pluie —
 *    jamais un trait lissé qui trahirait la DA.
 *
 * ═══ CE QUE LA PLANCHE A CHANGÉ (2026-08-25) ═══
 *
 * Le premier tracé était une TRAÎNÉE DROITE. Sous un front le cap est cardinal (V1) : quatorze
 * traînées droites sont quatorze parallèles de même épaisseur, et l'œil y lit un artefact de
 * compression, pas de l'air. Il manquait une DIRECTION QUI CHANGE LE LONG DU RUBAN.
 *
 * Le tracé retenu est **le tourbillon** : le ruban file droit, mais sa tête tourne sur un petit
 * cercle dont le rayon s'ouvre et se referme UNE FOIS au milieu de sa vie. Aux deux bouts il est
 * droit ; au milieu il vrille. C'est un événement dans l'événement.
 *
 * ⚠ LA POSITION EST DÉRIVÉE, PAS INTÉGRÉE. `x += vx·dt` ne se remonte pas : or la traînée EST
 * la position de la tête aux instants passés. Tout se calcule donc en forme close depuis
 * l'origine et l'âge — `positionSerpentin(s, τ)`. C'est ce qui permet de peindre la trace sans
 * garder d'historique, sans allocation, et de la tester en Node.
 *
 * Le CHAMP ci-dessous est pur (ni Phaser ni caméra) : c'est ce qui le rend testable.
 * `Math.sin`/`cos` sont autorisés — on est CÔTÉ CLIENT (voir `meteo-particules`).
 */

import type { Vue } from './meteo-particules'
import { creerRng } from './meteo-particules'

/**
 * Le plafond. Petit par nature : au-delà, ce n'est plus une rafale, c'est un rideau.
 *
 * ⚠ CALIBRÉ À L'ŒIL, ET REVU À LA BAISSE DEUX FOIS. 26 → 14 (des barres régulières se lisaient
 * comme de la compression), puis 14 → 9 sur la planche : « moins, mais sur tout l'écran ». Le
 * compte n'a jamais été le vrai remède — la couverture, si (voir `naitre`).
 */
export const BUDGET_SERPENTINS = 9

/**
 * La grille du ruban, en px monde. DEMI-GRILLE : les FX de lumière (pluie, feu) sont à 4 px,
 * le ruban est à 2 — décision d'Alexis sur planche, contre « lignes assez fines ». Le pixel
 * natif de l'art est à 1 (16 px par tuile) : on est à mi-chemin, pas hors DA.
 */
export const GRAIN_PX = 2

/**
 * Vitesse d'un ruban, en tuiles/s, à souffle plein.
 *
 * ⚠ 26 AVANT LA PLANCHE, ET C'ÉTAIT LE DEUXIÈME DÉFAUT : à 26, un ruban traverse le cadre
 * (35,6 tuiles) en 1,4 s — il n'a pas le temps d'être lu. À 11, il met 3,2 s.
 */
const VITESSE = 11

/**
 * LE TAUX DE NAISSANCE, EN RUBANS PAR SECONDE — et surtout pas par IMAGE.
 *
 * La première écriture en semait UN PAR IMAGE. À 60 fps le cadre se peuple en moins d'une
 * demi-seconde, ce qui est le bon geste ; mais le FX devenait alors fonction du framerate, et
 * le banc headless l'a montré sans appel — une image y dure une dizaine de secondes, et le
 * cadre plafonnait à cinq rubans là où le jeu en montre neuf. On ne l'aurait pas vu à l'œil :
 * on aurait jugé le FX sur l'instrument.
 */
const NAISSANCES_PAR_S = 60

/**
 * Durée de vie, en secondes — le fuseau d'alpha s'y inscrit tout entier.
 *
 * ⚠ ELLE EST TAILLÉE SUR LA TRAVERSÉE, pas sur le confort : à 11 tuiles/s, franchir les 35,6
 * tuiles du cadre demande 3,2 s. Une vie plus courte (c'était 0,75–1,5 s) laisse l'AVAL DU
 * CADRE VIDE — le ruban meurt de vieillesse avant d'y arriver, et le vent ne souffle que d'un
 * côté de l'écran. C'est la moitié du remède à « ils n'évoluent pas sur tout l'écran ».
 */
const VIE_MIN = 3
const VIE_MAX = 4.6

/** Longueur MOYENNE de la traînée, en tuiles (chaque ruban la tire au hasard autour). */
const LONGUEUR = 1.6
/** Le rayon de la vrille, en tuiles, au sommet de la bosse. */
const RAYON = 0.5
/** Combien de tours la tête fait pendant la vrille. */
const TOURS = 1.1
/**
 * Combien de temps dure la vrille, EN SECONDES — et non en part de la vie.
 *
 * ⚠ C'EST CE QUI DÉCOUPLE LE LOOK DE LA COUVERTURE. Écrite en part de la vie, la vrille
 * ralentissait dès qu'on allongeait la vie pour peupler l'aval du cadre : deux réglages sans
 * rapport se tiraient dessus, et « corriger l'écran vide » aurait défait le tracé choisi.
 * En secondes, la vrille garde exactement la cadence vue sur planche, quelle que soit la vie.
 * 1,2 s place la pulsation au MILIEU de ce que la planche montrait (elle y variait de 4,3 à
 * 8,5 rad/s selon la durée tirée) : ni le ruban le plus mou, ni le plus nerveux.
 */
const DUREE_VRILLE = 1.2

export interface Serpentin {
  /** L'ORIGINE : d'où il est parti. La position courante s'en DÉRIVE (`positionSerpentin`). */
  x0: number
  y0: number
  /** La tête, à l'instant courant — recalculée à chaque image, jamais accumulée. */
  x: number
  y: number
  /** La vitesse de translation (le cap × la vitesse) : elle ne porte PAS la vrille. */
  vx: number
  vy: number
  /** L'âge, en secondes. `vie < 0` = mort (le troupeau est un pool : on ne réalloue jamais). */
  vie: number
  duree: number
  /** Sa longueur propre, en tuiles — deux rubans côte à côte ne sont pas jumeaux. */
  longueur: number
  /** La pulsation de sa vrille, en rad/s — dérivée de sa durée, pour faire TOURS tours. */
  omega: number
  /** Sa phase de vrille : deux rubans ne vrillent pas du même côté. */
  phase: number
}

/**
 * LA POSITION DE LA TÊTE À L'ÂGE τ — en forme close, donc REMONTABLE : c'est ce qui permet à
 * la couche de peindre la traînée (« où était la tête il y a un huitième de seconde ») sans
 * garder le moindre historique.
 *
 * Trois termes : l'origine, la translation dans le cap, et la vrille — un vecteur tournant
 * dont le rayon suit une bosse `sin³` (nulle aux deux bouts de la vie, pleine au milieu).
 */
export function positionSerpentin(s: Serpentin, tau: number, dans: { x: number; y: number }): void {
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
  const ux = v === 0 ? 1 : s.vx / v
  const uy = v === 0 ? 0 : s.vy / v
  // La bosse est CENTRÉE sur la mi-vie et large de `DUREE_VRILLE` : droit avant, droit après.
  const t = 0.5 + (tau - s.duree / 2) / DUREE_VRILLE
  const bosse = t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t)
  const r = RAYON * bosse * bosse * bosse
  const th = s.omega * tau + s.phase
  const c = Math.cos(th)
  const si = Math.sin(th)
  // Base locale : (−uy, ux) est le TRAVERS, (ux, uy) le cap. Le cercle vit dans ce plan.
  dans.x = s.x0 + s.vx * tau + r * (-uy * c + ux * si)
  dans.y = s.y0 + s.vy * tau + r * (ux * c + uy * si)
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
  private readonly tete = { x: 0, y: 0 }

  constructor(graine = 0x5e_7e_47_1c) {
    this.rng = creerRng(graine)
    for (let i = 0; i < BUDGET_SERPENTINS; i++) {
      this.serpentins.push({
        x0: 0, y0: 0, x: 0, y: 0, vx: 0, vy: 0,
        vie: -1, duree: 1, longueur: 1, omega: 1, phase: 0,
      })
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
      positionSerpentin(s, s.vie, this.tete)
      s.x = this.tete.x
      s.y = this.tete.y
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

  /**
   * Il naît EN AMONT du cadre — du côté d'où le vent vient — et le traverse. Jamais dans le
   * cadre : un ruban qui se formerait sous le nez du joueur se lirait comme une apparition.
   *
   * ⚠ LE TRAVERS SE MESURE SUR LA COUPE DU CADRE, PAS SUR LA DEMI-DIAGONALE. L'écriture d'avant
   * semait sur un disque de rayon la demi-diagonale : par le travers, une bonne moitié des
   * rubans naissait hors marge et mourait à l'image SUIVANTE, sans s'être vue. Le troupeau
   * paraissait plein (`vivants` les comptait) et l'écran restait vide — l'autre moitié du
   * remède à « ils n'évoluent pas sur tout l'écran ».
   */
  private naitre(s: Serpentin, vue: Vue, dx: number, dy: number, u: number): void {
    const largeur = vue.x1 - vue.x0
    const hauteur = vue.y1 - vue.y0
    const cx = (vue.x0 + vue.x1) / 2
    const cy = (vue.y0 + vue.y1) / 2
    // Ce qu'il faut reculer pour être hors cadre dans CE cap, et la largeur de la coupe.
    const amont = (Math.abs(dx) * largeur + Math.abs(dy) * hauteur) / 2 + 1
    const coupe = (Math.abs(dy) * largeur + Math.abs(dx) * hauteur) / 2 + 1
    const travers = (this.rng() - 0.5) * 2 * coupe
    s.x0 = cx - dx * amont - dy * travers
    s.y0 = cy - dy * amont + dx * travers
    // La vitesse suit le souffle : une rafale de front file, une bouffée traîne.
    const v = VITESSE * (0.55 + 0.45 * u) * (0.8 + 0.4 * this.rng())
    s.vx = dx * v
    s.vy = dy * v
    s.vie = 0
    s.duree = VIE_MIN + (VIE_MAX - VIE_MIN) * this.rng()
    s.longueur = LONGUEUR * (0.72 + 0.56 * this.rng())
    // La vrille fait TOURS tours en DUREE_VRILLE secondes — même cadence pour tous.
    s.omega = (2 * Math.PI * TOURS) / DUREE_VRILLE
    s.phase = this.rng() * 2 * Math.PI
    s.x = s.x0
    s.y = s.y0
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
