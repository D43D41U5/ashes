/**
 * L'ART DE LA CASCADE — la nappe d'eau qui tombe d'une paroi tournée au SUD, et son écume au pied.
 *
 * ═══ POURQUOI ELLE EXISTE (spec `terrasses.md` T-A9, décision d'Alexis du 2026-09-04) ═══
 *
 * Un fleuve qui descend d'un palier vers le sud passait par la PAROI DE ROCHE commune
 * (`cliff-layer`, T-R8) : entre l'eau haute et l'eau basse, deux rangées de pierre — un BARRAGE,
 * lu comme tel sur la capture `terrasse-cascade`. Les chutes qui regardent le nord, l'est ou
 * l'ouest n'ont pas de face à peindre et vivent dans le shader d'eau (`water-field.chutesDe`,
 * T-R8quater) ; celle qui FAIT FACE est la seule dont on voit la nappe, et le quad d'eau se
 * dessine SOUS la paroi — il ne peut pas la peindre. C'est donc un SPRITE de la couche des
 * parois, à la place de la roche : « ok mais en sorte qu'elle soit belle (particules, effet de
 * lumière etc...) ».
 *
 * ═══ LA GRAMMAIRE — celle des chutes du shader, pas une autre ═══
 *
 *   • CELLULES DE 2 PX MONDE (`GRAIN_CHUTE` du shader) : la nappe se dessine sur la grille de
 *     l'ART, la moitié du grain de l'eau — à 4 px la lèvre ferait une barre.
 *   • TROIS TONS + LA MASSE, jamais un dégradé : le BLANC de l'écume (`ecumeCol` du shader), le
 *     CLAIR (l'eau mêlée de blanc à 42 %), l'EAU (la couleur nue du terrain), le SOMBRE du pli
 *     (l'eau mêlée d'un bleu de nuit à 45 %). Les mêmes mélanges que `pied()` dans le shader :
 *     une chute latérale et une chute de face sont la même eau.
 *   • AU PAS DE TEMPS (`CHUTE_HZ` = 10, comme `floor(t × CHUTE_HZ)` dans le shader), jamais un
 *     glissé : les filets sautent de `PAS_CELLULES` cellules par pas. Deux cellules — 40 px monde
 *     par seconde — parce qu'une nappe de face TOMBE ; le rideau latéral n'en montre qu'une
 *     tranche et se contente d'une. Le cycle boucle sur `FRAMES` pas (7 × 2 ≡ 0 mod 7).
 *   • LES COLONNES TRAVERSENT LES TUILES, comme la paroi (`cliff-art`, PERIODE) : la phase d'un
 *     filet vient de sa colonne MONDE (`tx % PHASES` × 8 + cellule), sans quoi une chute de
 *     quatre tuiles montrerait quatre fois le même rideau.
 *
 * Tout est en RECTANGLES pleins (`RectArt`), comme la falaise ; la texture se bake une fois par
 * (rangée, pas, phase) dans `makeCliffTextures`. Aucune logique de jeu : de l'eau qu'on regarde.
 */
import type { RectArt } from './cliff-art'
import { LIFT_TUILES } from './framing'

/** La cellule de la nappe : 2 px monde, la grille de l'art (le shader dit `GRAIN_CHUTE`). */
export const CELLULE_PX = 2
/** Cellules par tuile, dans chaque sens. */
const CELLULES = 16 / CELLULE_PX
/** Le pas de temps des filets — le même que `CHUTE_HZ` du shader : toutes les chutes du monde
 *  sautent au même instant. */
export const CHUTE_HZ = 10
/** De combien de cellules la nappe descend par pas. */
export const PAS_CELLULES = 2
/** La période d'un filet, en cellules (2 de blanc, 2 de clair, 3 d'eau — le rideau du shader). */
const PERIODE_FILET = 7
/** Combien de pas avant que le dessin ne se répète : `FRAMES × PAS_CELLULES ≡ 0 (mod PERIODE)`. */
export const CHUTE_FRAMES = PERIODE_FILET
/** Combien de phases de colonne — la période du dessin en tuiles, comme `PHASES_PAROI`. */
export const CHUTE_PHASES = 4
/** Combien de rangées d'écran une chute d'un cran occupe : la hauteur d'un palier. */
export const CHUTE_RANGEES = LIFT_TUILES

/** Le pas de l'écume au pied, en pas de chute : les trous de l'écume changent tous les 3 pas
 *  (`mod(fr, 3)` dans le shader), les bulles dérivent d'une cellule par pas sur 6. */
export const ECUME_FRAMES = 6

// ── LA PALETTE : dérivée de l'eau DU SHADER, jamais posée à la main (« la couleur se calibre
//    contre son fond »). Un canal à la fois, comme `cliff-art.assombrir`.
/** La masse de la nappe : `daySky` du shader d'eau, (0.34, 0.45, 0.56) — l'eau du large de jour,
 *  celle qu'une nappe AÉRÉE renvoie (elle ne laisse pas voir le fond). Pas `TERRAIN_COLORS` :
 *  le shader ne montre jamais cette couleur nue (`col = mix(bottom, sky, skyMix)`), et regardée
 *  le 2026-09-04 à côté du bief, la nappe au bleu du terrain jurait — plus saturée que toute
 *  eau du jeu. */
const EAU = 0x57738f
const canal = (c: number, d: number): number => (c >> d) & 255
/** `mix(a, b, t)` du shader, canal par canal, arrondi. */
const melanger = (a: number, b: number, t: number): number => {
  const m = (d: number): number => Math.min(255, Math.round(canal(a, d) + (canal(b, d) - canal(a, d)) * t))
  return (m(16) << 16) | (m(8) << 8) | m(0)
}
/** `ecumeCol` du shader : (1.0, 0.99, 0.94). */
export const BLANC = 0xfffcf0
export const CLAIR = melanger(EAU, BLANC, 0.42)
export const SOMBRE = melanger(EAU, 0x0a1429, 0.45)
export { EAU }
/** Les tons de la nappe — la garde vérifie qu'aucun autre ne s'y glisse. */
export const TONS_CHUTE: readonly number[] = [BLANC, CLAIR, EAU, SOMBRE]

/** Un hash entier, pur et positionnel — pas de RNG : le dessin d'une colonne ne dépend que de
 *  sa place dans le monde. Rend 0..`n − 1`. */
export function tirage(a: number, b: number, n: number): number {
  let h = (a * 374761393 + b * 668265263 + 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1103515245) | 0
  return ((h ^ (h >>> 16)) >>> 0) % n
}

/**
 * Le filet d'une colonne : la nature de l'eau qui y tombe. Une nappe n'est pas uniforme — des
 * FILETS blancs (l'eau qui se déchire), des NAPPES claires (l'eau lisse, pleine), des PLIS
 * sombres (le creux entre deux filets). C'est l'alternance des trois, colonne par colonne, qui
 * fait lire une chute et non une bande bleue ; chacune a sa période de 7 cellules.
 */
const FILETS: readonly (readonly number[])[] = [
  [BLANC, BLANC, CLAIR, EAU, EAU, EAU, CLAIR], // le filet : deux de blanc, une traîne claire
  [CLAIR, CLAIR, BLANC, CLAIR, CLAIR, EAU, EAU], // la nappe : claire, une crête blanche
  [SOMBRE, SOMBRE, EAU, CLAIR, EAU, SOMBRE, SOMBRE], // le pli : sombre, un éclat au passage
]
/** Le tirage des filets : plus de filets et de nappes que de plis — une chute est claire. */
const PART_FILETS: readonly number[] = [0, 0, 1, 1, 1, 2, 2]

/** La colonne monde `cx` (cellule) : son filet et sa phase de départ. */
function colonne(cx: number): { filet: readonly number[]; phase: number } {
  return {
    filet: FILETS[PART_FILETS[tirage(cx, 1, PART_FILETS.length)]!]!,
    phase: tirage(cx, 2, PERIODE_FILET),
  }
}

/**
 * LA NAPPE — la rangée d'écran `k` (0 = sous la lèvre, `CHUTE_RANGEES − 1` = le pied) d'une chute
 * d'un cran, au pas `frame`, pour la colonne de tuile de phase `phase`.
 *
 * De haut en bas : LA LÈVRE (cellule 0 blanche, cellule 1 blanche ou claire — le bourrelet où
 * l'eau bascule, celui de `levreN` dans le shader), puis les filets qui tombent, puis L'ÉCUME du
 * pied sur la dernière cellule (blanche, et la précédente trouée — elle continue sur l'eau du bas
 * par `dessinDEcume`). Tout est opaque : c'est de l'eau devant de la roche.
 */
export function dessinDeChute(k: number, frame: number, phase: number): RectArt[] {
  const r: RectArt[] = []
  const derniere = CHUTE_RANGEES - 1
  const decalage = (frame * PAS_CELLULES) % PERIODE_FILET
  for (let x = 0; x < CELLULES; x++) {
    const cx = phase * CELLULES + x
    const { filet, phase: ph } = colonne(cx)
    for (let y = 0; y < CELLULES; y++) {
      const cy = k * CELLULES + y // la cellule depuis le haut de la nappe
      let c: number
      if (k === 0 && y === 0) c = BLANC
      else if (k === 0 && y === 1) c = tirage(cx, 3, 3) === 0 ? BLANC : CLAIR
      else if (k === derniere && y === CELLULES - 1) c = BLANC
      else if (k === derniere && y === CELLULES - 2) c = tirage(cx + 97 * (frame % 3), 4, 4) === 0 ? CLAIR : BLANC
      else c = filet[(((cy - decalage + ph) % PERIODE_FILET) + PERIODE_FILET) % PERIODE_FILET]!
      r.push({ x: x * CELLULE_PX, y: y * CELLULE_PX, w: CELLULE_PX, h: CELLULE_PX, c })
    }
  }
  return r
}

/** Combien de rangées de cellules l'écume occupe sur l'eau du bas — au-delà, l'eau du shader
 *  reste nue (les bulles et la brume, ce sont les particules qui les portent). */
export const ECUME_RANGEES = 5

/**
 * L'ÉCUME AU PIED — posée SUR l'eau basse (translucide, alpha en crans), à la tuile qui reçoit
 * la chute. Le profil du pied du shader (`pied()`, T-R8quater) : une cellule d'écume pleine
 * trouée d'un quart, une seconde à moitié, puis trois cellules de bulles qui dérivent en
 * s'éloignant — et rien au-delà. Les trous changent tous les trois pas, les bulles descendent
 * d'une cellule par pas.
 */
export function dessinDEcume(frame: number, phase: number): RectArt[] {
  const r: RectArt[] = []
  const trous = frame % 3
  for (let x = 0; x < CELLULES; x++) {
    const cx = phase * CELLULES + x
    for (let y = 0; y < ECUME_RANGEES; y++) {
      let a = 0
      if (y === 0) a = tirage(cx + 97 * trous, 5, 4) === 0 ? 0 : 0.85
      else if (y === 1) a = tirage(cx + 97 * trous, 6, 2) === 0 ? 0 : 0.4
      else {
        // Les bulles : une cellule sur six, qui DESCEND avec le pas — l'eau du bas emporte
        // l'écume vers le sud, loin de la chute.
        const d = y + 1 // cellules depuis la chute, 3..5
        const derive = (((d - frame) % ECUME_FRAMES) + ECUME_FRAMES) % ECUME_FRAMES
        if (tirage(cx, 7 + derive, 6) === 0) a = 0.35 - 0.1 * (d - 3)
      }
      if (a > 0) r.push({ x: x * CELLULE_PX, y: y * CELLULE_PX, w: CELLULE_PX, h: CELLULE_PX, c: BLANC, a })
    }
  }
  return r
}
