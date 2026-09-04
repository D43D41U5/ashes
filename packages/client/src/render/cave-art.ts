/**
 * ═══ LA CAVE — ce qu'on voit sous une butte, et la gueule par où l'on y entre (spec `etages.md` §17) ═══
 *
 * *Alexis, 2026-09-02 : « la grotte doit susciter autant la curiosité que l'inquiétude. Ce n'est
 * pas un souci s'il n'y a pas de nœuds ou d'animaux : le rendu VIDE doit être époustouflant. »*
 *
 * La première livraison peignait la salle avec le sol du PLATEAU teinté par sa clarté — et la
 * capture (`smoke --scenario cave`) montrait des tuiles grises en cinq bandes de gris sur un noir
 * quadrillé : aucun volume, aucune matière, aucun signe qu'on soit sous quelque chose. Une cave
 * n'est pas un plateau baissé : c'est un CREUX dans une masse, et tout ce fichier ne dit que ça.
 *
 * ═══ LES QUATRE RÈGLES DU DESSIN ═══
 *
 * ① **LA PIERRE EST LA MÊME, MAIS ELLE EST FROIDE.** Tout part de `TERRAIN_COLORS[TERRAIN_ROCK]`,
 *    comme la falaise, le plateau et le socle — une butte creuse n'est pas faite d'une seconde
 *    matière. Mais rien ici n'a vu le soleil : `froid()` retire le rouge et pousse le bleu. C'est
 *    l'unique écart, il est minuscule, et c'est lui qui dit « sous terre » avant toute lumière.
 *
 * ② **LE SOL EST CLAIR, LA MASSE EST SOMBRE, LA PAROI EST ENTRE LES DEUX.** La règle du plateau
 *    (*ce qui regarde le ciel est la chose la plus claire*) retournée : ici rien ne regarde le ciel,
 *    et c'est ce qu'on foule qui reste le plus lisible. Le sol vaut plus du DOUBLE de la roche qui
 *    l'entoure (garde en test) — sans quoi la salle ne se découpe pas de la masse.
 *
 * ③ **L'EAU EST PARTOUT, EN SIGNES.** Plaques humides, flaques qui reflètent un pixel, coulures
 *    sur les parois, dents de calcite au linteau : une cave respire par ce qui suinte. Aucune de ces
 *    figures ne dépasse trois pixels de large — la DA dit que le détail ne porte pas la lecture,
 *    la valeur oui ; ces signes sont des PONCTUATIONS, pas du décor.
 *
 * ④ **LA GUEULE EST UNE FISSURE, PAS UN RECTANGLE.** Le premier dessin posait trois tuiles de noir
 *    à joues droites : un trou aux ciseaux. Une gueule est une roche qui se fend et s'enfonce — ses
 *    bords sont DENTELÉS, elle s'élargit vers le bas, et ce qu'on voit dedans s'assombrit en
 *    montant. Les parties de roche restent TRANSPARENTES : c'est la vraie paroi qui se voit autour,
 *    et l'entaille se lit comme creusée dans le mur, pas posée devant.
 *
 * ⚠ **LE DESSIN EST PUR, LE RENDU NE L'EST PAS** — même partition que `cliff-art` et
 * `plateau-art` : chaque figure rend un tableau de rectangles, testable sans navigateur ;
 * `makeCaveTextures` ne fait que les rejouer. Les rectangles d'ici portent un ALPHA optionnel
 * (`RectArtA`) : une coulure, une ombre portée ou une tache d'humidité se posent SUR la matière,
 * elles ne la remplacent pas.
 */
import type Phaser from 'phaser'
import { TERRAIN_BOULDERS, TERRAIN_ROCK, TERRAIN_SCREE } from '@ashes/sim'
import { CLIFF_TILE_PX, dessinDeParoi, VARIANTES_PAROI, type RectArt } from './cliff-art'
import { TERRAIN_COLORS } from './terrain-colors'

/** Un rectangle d'art qui peut être translucide. `a` absent = opaque (le `RectArt` ordinaire). */
export interface RectArtA extends RectArt {
  a?: number
}

const P = CLIFF_TILE_PX

/** LA PIERRE — la même source que la falaise et le plateau. Repeindre la roche repeint la cave. */
const PIERRE = TERRAIN_COLORS[TERRAIN_ROCK] ?? 0x6d6d70

const canal = (c: number, d: number, f: number): number =>
  Math.max(0, Math.min(255, Math.round(((c >> d) & 255) * f)))
/** Un ton de la pierre à un rapport de valeur donné, sans changer sa teinte. */
const teindre = (c: number, f: number): number =>
  (canal(c, 16, f) << 16) | (canal(c, 8, f) << 8) | canal(c, 0, f)
export const lum = (c: number): number =>
  0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

/**
 * LE FROID — la pierre qui n'a jamais vu le soleil. Le rouge tombe à 92 %, le bleu monte à 110 % :
 * un écart de teinte que l'œil ne NOMME pas mais qui suffit, sur tout le cadre, à dire qu'on a
 * quitté le jour. `f` est le rapport de valeur, comme `ton` dans `cliff-art`.
 */
export function froid(c: number, f: number): number {
  return (canal(c, 16, 0.92 * f) << 16) | (canal(c, 8, 0.96 * f) << 8) | canal(c, 0, 1.1 * f)
}

/** Un hash entier pur et stable (le même partout : mêmes cailloux à chaque cuisson). */
function hachis(seed: number): () => number {
  let h = 0x9e3779b9 ^ Math.imul(seed + 1, 0x85ebca6b)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
    return h >>> 0
  }
}

/** Période des dalles du sol, en tuiles — la même que le plateau : un motif qui se referme sur la
 *  tuile se lit comme un carrelage (la leçon de `cliff-art`, payée deux fois déjà). */
export const PERIODE_CAVE = 4
const D = PERIODE_CAVE * P

/** Le sol de cave se cuit pour ces terrains-là (`terrainDeCave` ne rend que ces deux-là). */
export const TERRAINS_DE_CAVE: readonly number[] = [TERRAIN_SCREE, TERRAIN_BOULDERS]

// ═══ ① LE SOL ═══════════════════════════════════════════════════════════════════════════════

/** La valeur du sol : 1,15 fois la pierre — le plus clair de la cave, jamais aussi clair que le
 *  plateau (1,5), qui a le ciel. Les blocs sont un cran plus sombres : une matière plus rude. */
const SOL_VALEUR: Readonly<Record<number, number>> = { [TERRAIN_SCREE]: 1.15, [TERRAIN_BOULDERS]: 1.06 }
const GRAIN_CLAIR = 1.16
const GRAIN_SOMBRE = 0.78
const HUMIDE = 0.88
const FENTE = 0.6
/** L'eau : sombre et BLEUE — elle reflète un ciel qu'il n'y a pas, donc surtout de l'ombre. */
const EAU = 0.5
const EAU_BLEU = 1.22
const REFLET = 1.7

/** Les plaques humides de la période, en espace de période. Larges, molles : des TACHES de valeur,
 *  pas des lignes (la leçon du plateau — « la variation de grande échelle se fait en taches »). */
const PLAQUES: readonly (readonly [number, number, number, number])[] = [
  [3, 5, 14, 9], [30, 12, 18, 7], [12, 34, 11, 12], [44, 40, 15, 10], [52, 2, 9, 6],
]
/** Fentes courtes, sans lèvre. */
const FISSURES: readonly (readonly [number, number, number, number])[] = [
  [7, 22, 19, 22], [41, 47, 52, 47], [25, 3, 25, 12], [58, 24, 58, 33], [16, 52, 16, 61],
]
/** Deux flaques par période : `[x, y, w, h]`. Assez rares pour rester un événement. */
const FLAQUES: readonly (readonly [number, number, number, number])[] = [[20, 40, 7, 4], [47, 17, 5, 3]]
/** Les blocs d'un sol de BLOCS : leur dessus prend un peu de jour, leur pied en perd. */
const BLOCS: readonly (readonly [number, number, number, number])[] = [[9, 12, 5, 4], [37, 30, 6, 4], [55, 52, 4, 3]]

function gravier(semis: number): Array<[number, number, number, number]> {
  const g: Array<[number, number, number, number]> = []
  const h = hachis(semis)
  for (let k = 0; k < 80; k++) {
    const v = h()
    g.push([(v >>> 8) % D, (v >>> 17) % D, 1 + ((v >>> 3) & 1), (v >>> 2) & 1])
  }
  return g
}
const GRAVIERS = [gravier(0), gravier(1)]

/** La tache de valeur d'une tuile de la période : cinq crans, −4 % … +4 %. */
function tacheDe(phase: number): number {
  let h = Math.imul(phase + 1, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b)
  return 1 + (((h >>> 7) % 5) - 2) * 0.02
}

/**
 * LE SOL D'UNE CAVE. `phase` = `(tx % 4) + 4 · (ty % 4)`, la position de la tuile dans la période
 * (c'est elle qui fait courir les fentes et les flaques d'une tuile à l'autre). Le résultat est
 * OPAQUE : c'est de la matière, tout ce qui suit se pose dessus.
 */
export function dessinDuSolDeCave(phase: number, terrainId: number): RectArtA[] {
  const base = froid(PIERRE, SOL_VALEUR[terrainId] ?? SOL_VALEUR[TERRAIN_SCREE]!)
  const px0 = (phase % PERIODE_CAVE) * P
  const py0 = Math.floor(phase / PERIODE_CAVE) * P
  const r: RectArtA[] = [{ x: 0, y: 0, w: P, h: P, c: teindre(base, tacheDe(phase)) }]
  const poser = (x: number, y: number, w: number, h: number, c: number, a?: number): void => {
    const x0 = Math.max(x, px0)
    const y0 = Math.max(y, py0)
    const x1 = Math.min(x + w, px0 + P)
    const y1 = Math.min(y + h, py0 + P)
    if (x1 > x0 && y1 > y0) r.push(a === undefined ? { x: x0 - px0, y: y0 - py0, w: x1 - x0, h: y1 - y0, c } : { x: x0 - px0, y: y0 - py0, w: x1 - x0, h: y1 - y0, c, a })
  }
  // Les plaques humides d'abord : tout le reste se pose dessus.
  for (const [x, y, w, h] of PLAQUES) poser(x, y, w, h, teindre(base, HUMIDE))
  // Les blocs, sur un sol de blocs seulement — trois par période, avec un dessus et un pied.
  if (terrainId === TERRAIN_BOULDERS) {
    for (const [x, y, w, h] of BLOCS) {
      poser(x, y, w, h, teindre(base, 0.94))
      poser(x, y, w, 1, teindre(base, 1.18))
      poser(x, y + h - 1, w, 1, teindre(base, 0.66))
    }
  }
  for (const [x, y, w, clair] of GRAVIERS[phase & 1]!) {
    poser(x, y, w, 1, teindre(base, clair === 1 ? GRAIN_CLAIR : GRAIN_SOMBRE))
  }
  for (const [ax, ay, bx, by] of FISSURES) {
    if (ay === by) poser(ax, ay, bx - ax, 1, teindre(base, FENTE))
    else poser(ax, ay, 1, by - ay, teindre(base, FENTE))
  }
  // Les flaques : un rectangle aux angles rognés, une eau sombre et bleue, un reflet d'un pixel.
  for (const [x, y, w, h] of FLAQUES) {
    const eau = froid(base, EAU)
    const bleu = (((eau >> 16) & 255) << 16) | (((eau >> 8) & 255) << 8) | canal(eau, 0, EAU_BLEU)
    poser(x + 1, y, w - 2, 1, bleu)
    poser(x, y + 1, w, h - 2, bleu)
    poser(x + 1, y + h - 1, w - 2, 1, bleu)
    poser(x + 1, y + 1, 2, 1, teindre(bleu, REFLET))
  }
  return r
}

// ═══ LES SIGNES AU SOL — os, éboulis, flaque : rares, posés par tuile ══════════════════════════

/** Les figures qu'une tuile peut porter en plus de son sol. Transparentes autour. */
export type SigneDeCave = 'os' | 'eboulis-0' | 'eboulis-1' | 'flaque-0' | 'flaque-1'
export const SIGNES_DE_CAVE: readonly SigneDeCave[] = ['os', 'eboulis-0', 'eboulis-1', 'flaque-0', 'flaque-1']

const OS = 0xd9d4c4
const OS_OMBRE = 0x9c978a

export function dessinDuSigne(signe: SigneDeCave): RectArtA[] {
  const r: RectArtA[] = []
  const ombre = (x: number, y: number, w: number, h: number, a: number): void => { r.push({ x, y, w, h, c: 0x05060a, a }) }
  if (signe === 'os') {
    // Un long os avec ses deux têtes, et un crâne à trois pixels — ce qu'il faut pour que l'œil
    // lise « quelqu'un est mort ici » sans qu'on ait rien à lui expliquer.
    ombre(4, 10, 8, 1, 0.45)
    r.push({ x: 4, y: 9, w: 7, h: 1, c: OS })
    r.push({ x: 3, y: 8, w: 2, h: 2, c: OS })
    r.push({ x: 10, y: 8, w: 2, h: 2, c: OS })
    r.push({ x: 4, y: 9, w: 1, h: 1, c: OS_OMBRE })
    ombre(11, 7, 3, 1, 0.45)
    r.push({ x: 11, y: 4, w: 3, h: 3, c: OS })
    r.push({ x: 11, y: 5, w: 1, h: 1, c: 0x14151c })
    r.push({ x: 13, y: 5, w: 1, h: 1, c: 0x14151c })
    r.push({ x: 12, y: 6, w: 1, h: 1, c: OS_OMBRE })
    return r
  }
  if (signe === 'eboulis-0' || signe === 'eboulis-1') {
    const blocs = signe === 'eboulis-0'
      ? [[2, 6, 5, 4], [9, 3, 4, 3], [7, 11, 3, 2]] as const
      : [[8, 7, 6, 4], [2, 2, 4, 3], [4, 12, 3, 2]] as const
    for (const [x, y, w, h] of blocs) {
      ombre(x, y + h, w + 1, 1, 0.5)
      r.push({ x, y, w, h, c: froid(PIERRE, 0.78) })
      r.push({ x, y, w, h: 1, c: froid(PIERRE, 1.12) })
      r.push({ x: x + w - 1, y: y + 1, w: 1, h: h - 1, c: froid(PIERRE, 0.55) })
    }
    return r
  }
  // Une flaque plus grande que celles de la période : la nappe où le plafond goutte depuis toujours.
  const [x, y, w, h] = signe === 'flaque-0' ? [3, 5, 9, 6] : [6, 2, 7, 9]
  const eau = froid(PIERRE, EAU)
  const bleu = (((eau >> 16) & 255) << 16) | (((eau >> 8) & 255) << 8) | canal(eau, 0, EAU_BLEU)
  r.push({ x: x + 1, y, w: w - 2, h: 1, c: bleu })
  r.push({ x, y: y + 1, w, h: h - 2, c: bleu })
  r.push({ x: x + 1, y: y + h - 1, w: w - 2, h: 1, c: bleu })
  r.push({ x: x + 1, y: y + 1, w: 2, h: 1, c: teindre(bleu, REFLET) })
  r.push({ x: x + w - 3, y: y + h - 2, w: 1, h: 1, c: teindre(bleu, 1.3) })
  return r
}

// ═══ ② LA MASSE — la roche autour de la salle ══════════════════════════════════════════════

/** La roche se tuile sur une PÉRIODE de 4 tuiles : à 16 px, le premier jet rendait une grille
 *  sur tout l'écran (vu à la capture). Une seule image de 64×64, et le raccord ne se devine plus. */
export const ROCHE_PX = D
/** La valeur de la masse : la moitié de la pierre. Sombre, mais de la MATIÈRE — la lumière d'une
 *  torche doit pouvoir la révéler, sans quoi les murs n'existent que par leur absence. */
const ROCHE_VALEUR = 0.5

export function dessinDeLaRocheDeCave(): RectArtA[] {
  const t = (f: number): number => froid(PIERRE, ROCHE_VALEUR * f)
  const r: RectArtA[] = [{ x: 0, y: 0, w: D, h: D, c: t(1) }]
  // Des plaques de tailles différentes, hors phase, qui ne touchent jamais les quatre bords.
  for (const [x, y, w, h, f] of [
    [2, 3, 14, 9, 1.1], [21, 1, 11, 13, 0.9], [37, 6, 18, 7, 1.14], [4, 17, 9, 14, 0.86],
    [18, 20, 16, 10, 1.06], [40, 18, 13, 12, 0.92], [56, 15, 7, 9, 1.08], [1, 36, 20, 8, 1.12],
    [26, 34, 9, 18, 0.88], [39, 35, 22, 10, 1.04], [9, 48, 13, 12, 0.9], [30, 55, 17, 7, 1.1],
    [50, 49, 12, 13, 0.85],
  ] as const) r.push({ x, y, w, h, c: t(f) })
  // Des fentes, plus franches que sur le sol : la masse est FENDUE, c'est par là qu'elle suinte.
  for (const [x, y, w, h] of [
    [8, 6, 1, 9], [27, 12, 6, 1], [46, 9, 1, 12], [13, 26, 8, 1], [33, 22, 1, 7],
    [58, 30, 1, 10], [5, 41, 1, 11], [42, 44, 9, 1], [21, 57, 1, 6], [52, 58, 7, 1],
  ] as const) r.push({ x, y, w, h, c: t(0.36) })
  // Quatre éclats : l'eau sur la roche accroche un pixel. Rares — un scintillement, pas un semis.
  for (const [x, y] of [[12, 9], [49, 22], [24, 38], [58, 54]] as const) r.push({ x, y, w: 1, h: 1, c: t(1.7) })
  return r
}

// ═══ LA PAROI — la falaise, refroidie, qui suinte ═══════════════════════════════════════════

/** La paroi d'une cave part de celle de la falaise (même dessin, même masque, mêmes variantes)
 *  et perd un tiers de sa valeur : rien ne l'éclaire d'en haut. Son arête ne dépasse pas le sol. */
const PAROI_VALEUR = 0.66
const COULURE = 0x080a10
const DENT = froid(PIERRE, 0.24)

/**
 * `mask` : bit 1 = arête (rangée du haut), 2 = est ouvert, 4 = ouest ouvert, 8 = pied (rangée du
 * bas) — le masque de `dessinDeParoi`, tel quel. `variant` : 0 … `VARIANTES_PAROI − 1`.
 */
export function dessinDeParoiDeCave(mask: number, variant: number): RectArtA[] {
  const r: RectArtA[] = dessinDeParoi(mask, variant).map((q) => ({ ...q, c: froid(q.c, PAROI_VALEUR) }))
  const h = hachis(mask * 31 + variant)
  // Deux coulures par tuile : un pixel de large, cinq à neuf de long, tombant du haut de la tuile.
  for (let k = 0; k < 2; k++) {
    const v = h()
    const x = 2 + (v % 12)
    const long = 5 + ((v >>> 8) % 5)
    const y0 = (mask & 1) !== 0 ? 2 : 0
    r.push({ x, y: y0, w: 1, h: Math.min(P - y0, long), c: COULURE, a: 0.45 })
  }
  // Les dents au linteau : sur l'arête seulement, deux par tuile. Une tache de trois pixels et une
  // pointe — de la calcite qui pend, lue comme une silhouette, jamais comme un objet.
  if ((mask & 1) !== 0) {
    for (let k = 0; k < 2; k++) {
      const v = h()
      const x = 1 + (v % 12)
      r.push({ x, y: 2, w: 3, h: 1, c: DENT })
      r.push({ x: x + 1, y: 3, w: 1, h: 1 + ((v >>> 9) & 1), c: DENT })
    }
  }
  return r
}

// ═══ L'OMBRE PORTÉE ET LA LÈVRE — ce qui creuse la salle dans la masse ═══════════════════════

/** Les crans d'ombre au pied d'une paroi (côté nord de la tuile de sol) : `[épaisseur, alpha]`. */
const OMBRE_N: readonly (readonly [number, number])[] = [[3, 0.5], [3, 0.3], [2, 0.14]]
const OMBRE_EO: readonly (readonly [number, number])[] = [[2, 0.42], [2, 0.24], [2, 0.1]]
const OMBRE_S: readonly (readonly [number, number])[] = [[2, 0.35], [2, 0.18]]
const OMBRE = 0x05060a

/**
 * L'OCCLUSION d'un bord de sol contre la roche. `cote` : 1 = nord (le pied de la paroi), 2 = est,
 * 4 = ouest, 8 = sud (le surplomb de la masse qui est devant). Une bande translucide, quantifiée
 * en crans — la même grammaire que l'ombre de la falaise (`OMBRE_CRANS`).
 */
export function dessinDOmbreDeCave(cote: number): RectArtA[] {
  const r: RectArtA[] = []
  let d = 0
  if (cote === 1) for (const [e, a] of OMBRE_N) { r.push({ x: 0, y: d, w: P, h: e, c: OMBRE, a }); d += e }
  else if (cote === 8) for (const [e, a] of OMBRE_S) { r.push({ x: 0, y: P - d - e, w: P, h: e, c: OMBRE, a }); d += e }
  else if (cote === 2) for (const [e, a] of OMBRE_EO) { r.push({ x: P - d - e, y: 0, w: e, h: P, c: OMBRE, a }); d += e }
  else for (const [e, a] of OMBRE_EO) { r.push({ x: d, y: 0, w: e, h: P, c: OMBRE, a }); d += e }
  return r
}

/** La lèvre : le trait d'un pixel qui garde la SILHOUETTE de la salle quand tout est noir. Pâle et
 *  froide — une arête mouillée qui accroche ce qu'il reste de lumière. */
export const LEVRE = froid(PIERRE, 1.6)
export function dessinDeLevre(cote: number): RectArtA[] {
  if (cote === 1) return [{ x: 0, y: 0, w: P, h: 1, c: LEVRE }]
  if (cote === 8) return [{ x: 0, y: P - 1, w: P, h: 1, c: LEVRE }]
  if (cote === 2) return [{ x: P - 1, y: 0, w: 1, h: P, c: LEVRE }]
  return [{ x: 0, y: 0, w: 1, h: P, c: LEVRE }]
}

// ═══ ④ LA GUEULE — vue de dehors ════════════════════════════════════════════════════════════

/** Combien de rangées la gueule occupe : les deux rangées de paroi du chapeau, plus le seuil. */
export const GUEULE_RANGEES = 3
/**
 * La gueule fait DEUX TUILES de large (Alexis, 2026-09-02 : « la gueule de 2, ça me va ») — une
 * fente d'une tuile se lisait comme une fissure, pas comme une entrée. /sim élit une PAIRE de
 * tuiles de jupe (`creuserLaCave`), et le client la dessine en UNE image de 32 px depuis la
 * tuile ouest de la paire.
 */
export const GUEULE_LARGEUR = 2 * P
/**
 * Le profil de l'ouverture, rangée par rangée, sur les DEUX rangées de paroi (32 lignes) :
 * `[gauche, droite]` inclus (sur 0..31), ou `null` pour de la roche pleine. Étroite en haut — la
 * fissure — et qui s'évase en descendant jusqu'à vingt-six pixels : une porte, pas une fente.
 * Le bord ouest tombe droit avec un renflement (un bloc qui n'a pas cédé), le bord est se
 * délite par à-coups : deux lèvres différentes, aucune symétrie — la roche s'est fendue.
 */
const PROFIL: readonly (readonly [number, number] | null)[] = [
  null, null, null, null,
  [14, 17], [13, 18], [12, 19], [11, 20], [10, 21], [9, 22], [8, 23], [8, 24], [7, 25], [7, 25], [6, 26], [5, 26],
  [5, 27], [5, 27], [4, 28], [4, 28], [3, 28], [3, 28], [4, 29], [3, 29], [3, 28], [3, 29], [3, 28], [3, 28],
  [4, 28], [3, 28], [3, 28], [3, 28],
]
/** Le fond de la gueule : de presque noir (en haut, loin dans la roche) à un cinquième de la
 *  pierre (au seuil). Encore plus froid que la cave : ce qu'on voit par une fente, c'est la nuit. */
const GUEULE_FOND_HAUT = 0.05
const GUEULE_FOND_BAS = 0.22
const LEVRE_OUEST = froid(PIERRE, 1.35)
const LEVRE_EST = 0x14161e
const TACHE = 0x0a0c12

/** La couleur du fond à une ligne donnée de l'ouverture (0 = la plus haute ligne ouverte). */
function fondDeGueule(ligne: number, total: number): number {
  const t = total <= 1 ? 1 : ligne / (total - 1)
  const c = froid(PIERRE, GUEULE_FOND_HAUT + t * (GUEULE_FOND_BAS - GUEULE_FOND_HAUT))
  // Le fond tire au bleu-nuit : rouge à 70 %, bleu à 110 % — une fente sur la nuit.
  return (canal(c, 16, 0.7) << 16) | (canal(c, 8, 0.85) << 8) | canal(c, 0, 1.1)
}

/**
 * LA GUEULE, par rangée : 0 et 1 = les deux rangées de paroi qu'elle fend, 2 = le SEUIL au sol.
 * Les parties de roche sont TRANSPARENTES — la paroi ordinaire se voit à travers, l'entaille est
 * dedans. Le seuil n'est qu'une tache : la terre piétinée qui sort du trou, et trois cailloux.
 */
export function dessinDeLaGueule(rang: number): RectArtA[] {
  const r: RectArtA[] = []
  if (rang >= 2) {
    // Le seuil : une tache sombre qui s'éteint en descendant, comme une ombre qui sort du trou.
    r.push({ x: 3, y: 0, w: 26, h: 3, c: TACHE, a: 0.45 })
    r.push({ x: 5, y: 3, w: 22, h: 3, c: TACHE, a: 0.28 })
    r.push({ x: 8, y: 6, w: 16, h: 4, c: TACHE, a: 0.13 })
    for (const [x, y, w] of [[6, 7, 1], [12, 4, 1], [17, 11, 2], [23, 9, 1], [26, 5, 1], [9, 12, 1]] as const) {
      r.push({ x, y, w, h: 1, c: 0x1b1d24, a: 0.6 })
    }
    return r
  }
  const ouvertes = PROFIL.filter((p) => p !== null).length
  // Le dégradé du fond court sur les DEUX rangées : la seconde reprend là où la première s'arrête.
  // (Recompté à zéro par rangée, il recommençait au noir à la couture — mesuré [8,10,17] puis
  // [4,4,7] sur la même colonne, le 2026-09-02.)
  let ligne = PROFIL.slice(0, rang * P).filter((p) => p !== null).length
  for (let y = 0; y < P; y++) {
    const abs = rang * P + y
    const p = PROFIL[abs]
    if (p === null || p === undefined) {
      // Roche pleine — mais au-dessus de la fente, elle est MOUILLÉE : la tache d'humidité qui
      // marque, sur toute paroi réelle, l'endroit d'où l'air froid sort.
      if (abs < 4) r.push({ x: 10 + (abs & 1), y, w: 12 - (abs & 1) * 2, h: 1, c: TACHE, a: 0.18 + abs * 0.05 })
      continue
    }
    const [g, d] = p
    r.push({ x: g, y, w: d - g + 1, h: 1, c: fondDeGueule(ligne, ouvertes) })
    // Les lèvres de la fente : le bord ouest prend le jour (soleil au nord-ouest, la convention
    // de `cliff-art`), le bord est passe dans l'ombre. C'est ce couple qui CREUSE au lieu de poser.
    r.push({ x: g - 1, y, w: 1, h: 1, c: LEVRE_OUEST })
    r.push({ x: d + 1, y, w: 1, h: 1, c: LEVRE_EST })
    ligne++
  }
  // Le linteau : la première ligne ouverte est bouchée d'ombre — le surplomb vu de dessous.
  if (rang === 0) {
    const p = PROFIL[4]!
    r.push({ x: p[0], y: 4, w: p[1] - p[0] + 1, h: 1, c: 0x020304 })
  }
  // Au bas de la seconde rangée, le SOL de la salle que le jour touche encore : une bande de
  // toute la largeur de la fente, qui s'éclaire en descendant vers le seuil et s'éteint vers le
  // haut, où la nuit de la cave la mange. C'est ce que l'œil vient chercher — il y a un sol,
  // donc un dedans, là-derrière. (La première écriture la faisait de six pixels au milieu : une
  // dent grise plantée dans le trou, vue à la capture zoomée.)
  if (rang === 1) {
    for (let y = 9; y < P; y++) {
      const p = PROFIL[P + y]
      if (!p) continue
      const t = (y - 9) / (P - 1 - 9)
      // La chute est lente en haut (la pénombre s'installe) et vive au seuil (la marche prend le jour).
      r.push({ x: p[0] + 1, y, w: p[1] - p[0] - 1, h: 1, c: fondDeSol(t * t) })
    }
    // La marche du seuil : une arête claire au ras du sol, le nez de la dalle que l'on franchit.
    const p = PROFIL[2 * P - 1]!
    r.push({ x: p[0] + 1, y: P - 1, w: p[1] - p[0] - 1, h: 1, c: froid(PIERRE, 0.62) })
  }
  return r
}

/**
 * LA GUEULE ENTIÈRE, en UNE image de `GUEULE_LARGEUR` × `GUEULE_RANGEES` rangées (32×48). Trois
 * images empilées laissaient passer, à tout zoom fractionnaire (2,25 au 1280×720), une ligne
 * d'un pixel entre deux rangées — claire, en travers du noir : mesurée [49,49,52] sur un fond à
 * [8,8,11], absente aux zooms 2 et 3. (La cause — `gl.REPEAT` sur les textures POT + MSAA qui
 * extrapole l'UV hors du quad — est soignée depuis par `epinglerLaTuile` pour les tuiles de
 * grille ; la gueule reste en une image parce que son dessin est UN dessin.)
 */
export function dessinDeLaGueuleEntiere(): RectArtA[] {
  const r: RectArtA[] = []
  for (let rang = 0; rang < GUEULE_RANGEES; rang++) {
    for (const q of dessinDeLaGueule(rang)) r.push({ ...q, y: q.y + rang * P })
  }
  return r
}

/** Le sol de la salle vu par la fente, de la pénombre (t = 0) au seuil éclairé (t = 1) — la
 *  matière du sol de cave (`froid`), jamais la nuit bleue du fond : c'est un sol, pas un trou. */
function fondDeSol(t: number): number {
  return froid(PIERRE, 0.14 + t * 0.34)
}

/**
 * LE FLANC — ce que la gueule fait à la paroi qui la borde. `cote` : 4 = la tuile à l'OUEST de la
 * gueule, 2 = celle à l'EST. Une bande sombre contre l'ouverture (la roche y est humide, et dans
 * l'ombre du trou) et deux fissures qui en partent : le mur s'est fendu, il n'a pas été percé.
 */
export function dessinDuFlanc(cote: number): RectArtA[] {
  const r: RectArtA[] = []
  const bandes: readonly (readonly [number, number])[] = [[1, 0.36], [1, 0.24], [1, 0.14], [1, 0.06]]
  let d = 0
  for (const [e, a] of bandes) {
    r.push({ x: cote === 4 ? P - d - e : d, y: 0, w: e, h: P, c: OMBRE, a })
    d += e
  }
  const fentes = cote === 4 ? [[11, 3, 4], [9, 9, 6]] as const : [[1, 5, 5], [2, 12, 4]] as const
  for (const [x, y, w] of fentes) r.push({ x, y, w, h: 1, c: COULURE, a: 0.5 })
  return r
}

// ═══ LE JOUR QUI ENTRE — vu de dedans ═══════════════════════════════════════════════════════

/** La hauteur, en rangées, de la nappe de jour qui entre par la gueule et s'éteint en avançant. */
export const JOUR_RANGEES = 3
/**
 * LA NAPPE DE JOUR au sol, blanche et translucide, à TEINTER de la couleur de l'heure. Elle part
 * du seuil (en BAS de l'image : la gueule est au sud de la salle) et s'éteint vers le nord par
 * crans de quatre pixels — la lumière est quantifiée au grain de l'art, jamais lissée. Elle
 * s'élargit en avançant, comme une lumière qui passe une porte.
 */
export function dessinDuJour(): RectArtA[] {
  const r: RectArtA[] = []
  const H = JOUR_RANGEES * P
  const crans = H / 4
  const milieu = GUEULE_LARGEUR / 2
  for (let k = 0; k < crans; k++) {
    // k = 0 en haut (le fond), crans − 1 en bas (le seuil).
    const t = (k + 1) / crans
    const a = 0.04 + t * t * 0.52
    const demi = Math.round(milieu - t * 6) // de 10 px de chaque côté au seuil à 16 (toute la gueule) au fond
    r.push({ x: milieu - demi, y: k * 4, w: demi * 2, h: 4, c: 0xffffff, a })
  }
  return r
}

/** LE DEHORS, vu par la gueule depuis la salle : un rectangle de jour entre deux jambages. À
 *  teinter de l'heure — et c'est la SEULE chose de la cave qui prend la couleur du ciel. */
export function dessinDuDehors(): RectArtA[] {
  const L = GUEULE_LARGEUR
  return [
    { x: 2, y: 2, w: L - 4, h: P - 2, c: 0xffffff },
    { x: 0, y: 0, w: 2, h: P, c: 0x07080c },
    { x: L - 2, y: 0, w: 2, h: P, c: 0x07080c },
    { x: 0, y: 0, w: L, h: 2, c: 0x07080c },
    { x: 2, y: 2, w: L - 4, h: 1, c: 0x000000, a: 0.5 },
  ]
}

// ═══ LA LUEUR — ce qui vit dans le noir ═════════════════════════════════════════════════════

/** Le vert-bleu d'un lichen qui luit. En ADD sur du noir, ce sont les seuls points de couleur
 *  d'une salle éteinte : assez pour qu'on se demande ce que c'est, pas assez pour éclairer. */
export const LUEUR = 0x4fe3c3
export const VARIANTES_LUEUR = 2
export function dessinDeLueur(variant: number): RectArtA[] {
  const amas = variant === 0
    ? [[3, 4, 2, 1, 0.9], [4, 5, 1, 1, 0.5], [11, 9, 2, 2, 0.8], [13, 11, 1, 1, 0.4], [6, 12, 1, 1, 0.6]] as const
    : [[9, 2, 1, 2, 0.8], [10, 3, 1, 1, 0.4], [2, 10, 2, 1, 0.9], [4, 11, 1, 1, 0.5], [13, 6, 1, 1, 0.6]] as const
  return amas.map(([x, y, w, h, a]) => ({ x, y, w, h, c: LUEUR, a }))
}

// ═══ LES CLÉS ET LA CUISSON ═════════════════════════════════════════════════════════════════

export function caveKey(family: string, a: number | string = 0, b: number | string = 0): string {
  return `cv-${family}-${a}-${b}`
}
export const ROCHE_CAVE_KEY = 'cv-roche'
export const JOUR_KEY = 'cv-jour'
export const DEHORS_KEY = 'cv-dehors'
export const GUEULE_KEY = caveKey('gueule')

/** Le nombre de masques de paroi utiles : {arête, pied, arête+pied} × {est, ouest ouverts}. */
const MASQUES_PAROI: readonly number[] = ((): number[] => {
  const out: number[] = []
  for (const rangee of [1, 8, 9]) for (const eo of [0, 2, 4, 6]) out.push(rangee | eo)
  return out
})()

/**
 * Génère les textures de la cave — appelé une fois au boot, après `makeCliffTextures`. Sol :
 * 2 terrains × 16 phases. Signes : 5. Paroi : 12 masques × 8 variantes. Ombres et lèvres : 4 + 4.
 * Gueule : 1 (32×48), flancs : 2, jour (32×48), dehors (32×16), roche (64×64), lueurs : 2. **~170 images**,
 * presque toutes de 16×16.
 */
export function makeCaveTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()
  const rejouer = (rects: readonly RectArtA[], key: string, w = P, h = P): void => {
    for (const r of rects) g.fillStyle(r.c, r.a ?? 1).fillRect(r.x, r.y, r.w, r.h)
    g.generateTexture(key, w, h)
    g.clear()
  }
  for (const t of TERRAINS_DE_CAVE) {
    for (let phase = 0; phase < PERIODE_CAVE * PERIODE_CAVE; phase++) rejouer(dessinDuSolDeCave(phase, t), caveKey('sol', t, phase))
  }
  for (const s of SIGNES_DE_CAVE) rejouer(dessinDuSigne(s), caveKey('signe', s))
  for (const mask of MASQUES_PAROI) {
    for (let v = 0; v < VARIANTES_PAROI; v++) rejouer(dessinDeParoiDeCave(mask, v), caveKey('paroi', mask, v))
  }
  for (const cote of [1, 2, 4, 8]) {
    rejouer(dessinDOmbreDeCave(cote), caveKey('ombre', cote))
    rejouer(dessinDeLevre(cote), caveKey('levre', cote))
  }
  rejouer(dessinDeLaGueuleEntiere(), GUEULE_KEY, GUEULE_LARGEUR, GUEULE_RANGEES * P)
  for (const cote of [2, 4]) rejouer(dessinDuFlanc(cote), caveKey('flanc', cote))
  rejouer(dessinDuJour(), JOUR_KEY, GUEULE_LARGEUR, JOUR_RANGEES * P)
  rejouer(dessinDuDehors(), DEHORS_KEY, GUEULE_LARGEUR, P)
  rejouer(dessinDeLaRocheDeCave(), ROCHE_CAVE_KEY, ROCHE_PX, ROCHE_PX)
  for (let v = 0; v < VARIANTES_LUEUR; v++) rejouer(dessinDeLueur(v), caveKey('lueur', v))
  g.destroy()
}
