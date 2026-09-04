/**
 * L'ART DES FALAISES — le DESSUS d'ardoise, et la PAROI qu'on voit de face.
 *
 * La falaise est LE SQUELETTE de la carte (« on ne trouve pas une porte, on suit un mur »). Elle a
 * d'abord été une tache sombre plate (Alexis : *« les falaises ne ressemblent pas à des falaises, à
 * des blocs noirs »*), puis une paroi en volume avec des contremarches et une ombre portée, puis —
 * pivot RimWorld du 2026-07-17 — une simple tuile de roche vue de dessus, la carte étant devenue
 * plate.
 *
 * ═══ LA PAROI REVIENT — décision d'Alexis du 2026-08-31, proposition « P2 · la marche » ═══
 *
 * *« va sur P2 »*, puis *« commence par l'art de la face »*. Le monde redevient une pile de
 * TERRASSES : une masse de roche montre son DESSUS partout, sauf sur ses deux dernières rangées
 * SUD, qui se dressent en PAROI — la grammaire de Zelda LTTP, des niveaux discrets et des parois
 * franches, jamais de pente douce. Ce qui est peint en roche reste infranchissable : la géométrie
 * ne ment pas (c'est ce qui a fait préférer P2 au « surplomb », qui peignait de la roche sur de
 * l'herbe qu'on foule).
 *
 * **Le rôle d'une tuile se LIT du terrain, il ne se stocke pas** (`roleDeFalaise`) : on compte les
 * tuiles de roche sous soi. Zéro dessous → on est le pied de la masse ; une → on est la rangée du
 * haut de la paroi ; deux ou plus → on est le dessus. Une masse d'UNE tuile (les murs de frontière
 * d'aujourd'hui) est donc à la fois arête et pied : elle rend une paroi de 16 px, et le jour où
 * `murerLesAretes` l'épaissira à trois tuiles, la même règle rendra un dessus et deux rangées de
 * paroi, sans une ligne de plus ici.
 *
 * ═══ LA PALETTE EST CONSTANTE, ET ELLE EST CELLE DE LA PIERRE ═══
 *
 * On ne module PAS la falaise par la teinte de sa zone (contrairement au sol) : le squelette doit se
 * reconnaître PARTOUT au premier regard — c'était précisément le défaut du Gouffre, où l'aplat
 * sombre se noyait dans le sol sombre.
 *
 * ⚠ **MAIS ELLE N'EST PLUS INVENTÉE** (Alexis, 2026-09-01 : *« essaye de faire en sorte que la
 * falaise ait une couleur LOGIQUE — pierre par défaut, terre rocailleuse si besoin »*). Elle était
 * une ardoise froide et violette, choisie pour n'avoir « aucun parent dans les terrains » — et
 * c'était le problème : une falaise est de la ROCHE, le jeu sait déjà de quelle couleur est sa
 * roche (`TERRAIN_COLORS[TERRAIN_ROCK]`), et deux réponses à la même question finissent toujours
 * par diverger. La palette se DÉRIVE donc de la pierre, en une seule ligne de code et non treize
 * littéraux : chaque ton garde son RAPPORT DE VALEUR à la base (c'est lui qui fait le dessin —
 * l'arête qui prend le jour, la chute de la paroi, le pied dans l'ombre) et prend la TEINTE de la
 * pierre. Repeindre la roche du jeu repeint donc sa falaise, par construction.
 *
 * Et la falaise s'ÉCLAIRCIT de 49 % en passant à la pierre (luminance 73 → 109) : c'est la vraie
 * couleur d'un caillou vu au soleil, et c'est aussi ce qui la sort du sol sombre du Gouffre mieux
 * qu'une teinte inventée ne le faisait.
 *
 * Tout est en RECTANGLES — du pixel-art de code, direction artistique du projet : des angles droits.
 * Le soleil est au NORD-OUEST : l'arête haute et le bord ouest prennent le jour, le bord est et le
 * pied sont dans l'ombre. Déterminisme : les variantes sont choisies par `hash2(tx, ty)` — pur,
 * stable, sans état.
 *
 * ⚠ **LE DESSIN EST PUR, LE RENDU NE L'EST PAS.** Chaque figure rend une LISTE DE RECTANGLES
 * (`RectArt[]`), testable sans navigateur et rejouable ailleurs (planche hors-jeu) ; `makeCliffTextures`
 * ne fait que la rejouer dans un `Graphics` de Phaser. Deux dessins d'un même objet dérivent — on
 * l'a payé ailleurs dans ce dépôt ; il n'y en a qu'un ici.
 */
import type Phaser from 'phaser'
import { RELIEF, TERRAIN_ROCK } from '@ashes/sim'
import { TERRAIN_COLORS } from './terrain-colors'

/**
 * LA PIERRE — l'unique source de la palette (voir l'en-tête). C'est la couleur que le jeu donne
 * déjà à `TERRAIN_ROCK` : la falaise EST de la roche, elle n'a pas à en inventer une autre.
 */
const PIERRE = TERRAIN_COLORS[TERRAIN_ROCK] ?? 0x6d6d70
/**
 * Un ton de la palette, par son RAPPORT DE VALEUR au dessus de pierre. C'est ce rapport qui fait
 * le dessin — l'arête qui prend le jour (1,88), la chute de la paroi, le pied dans l'ombre
 * (0,38) — et il est repris tel quel de l'ardoise d'avant, au centième : le dessin ne bouge pas
 * d'un pixel, seule sa teinte change.
 */
const ton = (rapport: number): number => {
  const c = (d: number): number => Math.min(255, Math.round(((PIERRE >> d) & 255) * rapport))
  return (c(16) << 16) | (c(8) << 8) | c(0)
}

/** La palette de la pierre — constante sur toute la carte (voir l'en-tête). */
const TOP_BASE = ton(1)
const TOP_DARK = ton(0.82)
const TOP_LIGHT = ton(1.21)
const RIM_N = ton(1.88) // liseré nord : le soleil est au nord-ouest
const RIM_N2 = ton(1.49)
const RIM_W = ton(1.51)
const RIM_E = ton(0.45)

/**
 * ═══ LA PAROI S'ASSOMBRIT DU CIEL VERS SON PIED, EN HUIT CRANS ═══
 *
 * Deuxième refus sur planche : deux rangées, deux tons plats, et la paroi rendait une assise de
 * **grosses briques** — la couture était pile à la limite des tuiles, là où l'œil la cherche. La
 * chute de valeur doit être CONTINUE sur toute la hauteur de la paroi, la limite de tuile ne doit
 * rien annoncer. Huit crans donc, répartis sur les deux rangées (0-3 en haut, 4-7 en bas), ou sur
 * les seize pixels d'une masse d'une seule rangée.
 *
 * Et les trois valeurs de colonne se resserrent : un écart trop franc entre colonnes fait dominer
 * la verticale, et le quadrillage revient. C'est la chute, pas la colonne, qui dit « paroi ».
 */
/**
 * ⚠ **LA PAROI EST PLUS SOMBRE QUE LE DESSUS — et elle ne l'était pas.** Héritée de l'ardoise,
 * elle partait à 1,43 × la base quand le dessus vaut 1 : le MUR était plus clair que le PLAT
 * qu'il porte, ce qui est faux de toute surface au monde (un plan vertical ne voit qu'une moitié
 * de ciel). Sous le violet sombre, personne ne le lisait ; sous la pierre, la mesa perdait sa
 * silhouette — le haut du mur venait toucher la valeur du plateau et l'on ne voyait plus où
 * l'un finissait. Elle part donc SOUS le dessus (0,86) et tombe jusqu'au pied.
 *
 * Et les trois tons s'écartent un peu plus qu'avant (0,86 / 0,76 / 0,66 contre 1,43 / 1,27 /
 * 1,12) : sur une paroi devenue sombre, des facettes trop proches rendent un panneau lisse. Ce
 * qui doit rester interdit, c'est la RÉGULARITÉ — pas le contraste (voir `COLONNES`).
 */
const COLONNE_BASE = [ton(0.86), ton(0.76), ton(0.66)] as const
const canal = (c: number, d: number, f: number): number => Math.min(255, Math.round(((c >> d) & 255) * f))
const assombrir = (c: number, f: number): number =>
  (canal(c, 16, f) << 16) | (canal(c, 8, f) << 8) | canal(c, 0, f)
/**
 * ⚠ **LA CHUTE EST CONTINUE, PIXEL PAR PIXEL — et c'est ce qui sépare la ROCHE de la MAÇONNERIE**
 * (Alexis, 2026-09-01 : *« et la texture aussi »*). Elle se faisait par CRANS de quatre pixels :
 * huit paliers plats empilés. Sous l'ardoise sombre, l'œil les lisait comme un dégradé ; sous la
 * PIERRE, plus claire, les paliers sont ressortis — et croisés aux joints verticaux ils rendaient
 * un **appareillage de blocs de béton**, ce que la spec du dessus avait déjà refusé une fois
 * (« deux rangées à tons plats font une assise de grosses briques »). Le même défaut, un cran
 * plus bas : ce n'était plus la limite de tuile qui faisait le joint, c'était le palier.
 *
 * `RAMPE[teinte][ligne]` porte donc UNE valeur par ligne de pixels sur toute la hauteur de la
 * paroi (`RELIEF.PAROI_RANGEES × 16`), la même chute totale qu'avant (1 → 0,475).
 */
const LIGNES_PAROI = RELIEF.PAROI_RANGEES * 16
const RAMPE: readonly (readonly number[])[] = COLONNE_BASE.map((base) =>
  Array.from({ length: LIGNES_PAROI }, (_, k) => assombrir(base, 1 - (k / (LIGNES_PAROI - 1)) * 0.525)))
/** Le creux entre deux colonnes, et sa lèvre ouest qui prend le jour. Ce sont des FACTEURS, pas
 *  des couleurs : ils suivent la chute de valeur de leur colonne, sinon la cannelure devient une
 *  rayure claire posée par-dessus — ce que la planche a montré au premier essai. */
const JOINT_F = 0.52
const LEVRE_F = 1.22
const GRAIN_SOMBRE = ton(0.70)
const GRAIN_CLAIR = ton(1.38)
const PIED = ton(0.38)

export const CLIFF_TILE_PX = 16

/**
 * Combien de rangées d'une masse se dressent en paroi. ⚠ **La vérité est dans `/sim`** : c'est
 * `epaissirLesFalaises` qui donne cette épaisseur au terrain, et si les deux nombres divergeaient,
 * le rendu dessinerait une paroi là où l'on marche. Un seul nombre, celui du monde.
 */
export const PAROI_RANGEES = RELIEF.PAROI_RANGEES

/** Un rectangle plein — l'unité du dessin. Tout l'art de la falaise en est fait. */
export interface RectArt {
  x: number
  y: number
  w: number
  h: number
  c: number
}

/**
 * ═══ LES COLONNES TRAVERSENT LES TUILES — sinon c'est un mur de BRIQUES ═══
 *
 * Première écriture, refusée sur planche : chaque tuile portait ses propres colonnes, larges de
 * trois à six pixels, et sa strate à la même hauteur. À l'écran, une paroi de trente tuiles rendait
 * un **appareillage de briques** — la faute n'était pas le dessin d'une tuile mais sa PÉRIODE : à
 * 16 px, tout motif qui se referme sur la tuile se lit comme un joint de maçonnerie.
 *
 * Les colonnes vivent donc sur une période de **64 px — quatre tuiles** : le tableau ci-dessous est
 * découpé en quatre PHASES, et la couche choisit la phase par `tx % 4`. Une colonne de quinze
 * pixels enjambe alors deux tuiles, et le regard ne trouve plus de grille. Les strates suivent la
 * même règle, avec une hauteur par phase : elles marchent au lieu de s'aligner.
 */
const PERIODE = 64
/** Largeur, indice de valeur — la somme fait `PERIODE`. Trois colonnes seulement : un joint tous
 *  les vingt pixels environ. Serrées, elles refont une grille. */
const COLONNES: readonly (readonly [number, number])[] = [[9, 1], [23, 0], [14, 2], [18, 1]]

/** Le nombre de variantes de chaque famille. Le dessus en a deux depuis toujours ; la paroi en a
 *  huit : quatre PHASES de colonne (imposées par `tx`) × deux semis de strate (tirés au hash). */
export const VARIANTES_DESSUS = 2
export const PHASES_PAROI = 4
export const VARIANTES_PAROI = PHASES_PAROI * 2

/** La valeur d'une colonne à l'abscisse `xp` de la période, et si ce pixel en est le JOINT est. */
function colonneA(xp: number): { teinte: number; joint: boolean } {
  let x = 0
  for (const [w, teinte] of COLONNES) {
    if (xp < x + w) return { teinte, joint: xp === x + w - 1 }
    x += w
  }
  return { teinte: 0, joint: false }
}

/**
 * LE DESSUS — la roche vue de dessus. `mask` encode les bords OUVERTS (bit 1 = nord, 2 = est,
 * 4 = ouest) : c'est là que court le liseré éclairé, le trait qu'on longe comme une arête de
 * montagne. Dessin inchangé depuis 2026-07-17 : on ne rouvre pas ce qui se lit déjà.
 */
export function dessinDuDessus(mask: number, variant: number): RectArt[] {
  const r: RectArt[] = [{ x: 0, y: 0, w: 16, h: 16, c: TOP_BASE }]
  const v = variant & 1
  // La roche mouchetée — deux semis fixes, pour que deux tuiles voisines ne se répètent pas.
  const dark: Array<[number, number]> = v === 0
    ? [[3, 4], [9, 2], [13, 7], [5, 11], [11, 13], [7, 8]]
    : [[2, 6], [8, 4], [12, 10], [4, 13], [14, 3], [6, 2]]
  const light: Array<[number, number]> = v === 0
    ? [[6, 5], [12, 3], [2, 10], [10, 11], [14, 14]]
    : [[4, 3], [10, 7], [13, 12], [3, 8], [7, 14]]
  for (const [x, y] of dark) r.push({ x, y, w: 2, h: 1, c: TOP_DARK })
  for (const [x, y] of light) r.push({ x, y, w: 1, h: 1, c: TOP_LIGHT })
  // Une fissure de surface, en équerre — pas une diagonale : la DA est aux angles droits.
  if (v === 0) {
    r.push({ x: 5, y: 6, w: 3, h: 1, c: TOP_DARK }, { x: 8, y: 6, w: 1, h: 2, c: TOP_DARK })
  } else {
    r.push({ x: 9, y: 9, w: 3, h: 1, c: TOP_DARK }, { x: 9, y: 10, w: 1, h: 2, c: TOP_DARK })
  }
  // Les liserés : la lumière vient du nord-ouest. C'est le trait qui rend l'arête lisible.
  if (mask & 1) {
    r.push({ x: 0, y: 0, w: 16, h: 1, c: RIM_N }, { x: 0, y: 1, w: 16, h: 1, c: RIM_N2 })
  }
  if (mask & 4) r.push({ x: 0, y: 0, w: 1, h: 16, c: RIM_W })
  if (mask & 2) r.push({ x: 15, y: 0, w: 1, h: 16, c: RIM_E })
  return r
}

/**
 * LA PAROI — la roche vue de FACE. `mask` : bit 1 = c'est l'ARÊTE (rien de la paroi au-dessus),
 * bit 2 = est ouvert, bit 4 = ouest ouvert, bit 8 = c'est le PIED (rien de la paroi en dessous).
 *
 * Peu de marques, et c'est délibéré : à 16 px la tuile, c'est l'écart de VALEUR qui porte la
 * lecture, pas le détail. Des colonnes, un joint d'un pixel entre elles, une strate rompue, une
 * arête claire en haut, un pied noir en bas, et quelques éclats de grain — rien d'autre. Une paroi
 * bavarde redevient un mur.
 */
export function dessinDeParoi(mask: number, variant: number): RectArt[] {
  const r: RectArt[] = []
  const phase = variant % PHASES_PAROI
  const semis = Math.floor(variant / PHASES_PAROI) // le tirage qui rompt les strates
  const arete = (mask & 1) !== 0
  const pied = (mask & 8) !== 0
  // Où suis-je dans la chute de valeur ? Une masse d'UNE rangée la parcourt entière (8 crans de
  // 2 px) ; sinon la rangée du haut prend les crans 0-3 et celle du pied les crans 4-7, de sorte
  // que la limite entre les deux tuiles n'annonce RIEN.
  // Où suis-je dans la chute ? Une masse d'UNE rangée la parcourt entière (elle est arête ET
  // pied, donc on l'étire) ; sinon la rangée du haut prend la première moitié et le pied la
  // seconde, de sorte que la limite entre les deux tuiles n'annonce RIEN.
  const ligne0 = arete ? 0 : 16
  const etire = arete && pied ? PAROI_RANGEES : 1
  for (let x = 0; x < 16; x++) {
    const xp = (phase * 16 + x) % PERIODE
    const { teinte, joint } = colonneA(xp)
    // La CANNELURE : le creux à l'est d'une colonne, la lèvre à l'ouest de la suivante — le
    // soleil est au nord-ouest. ⚠ elle TRAVERSE la limite des tuiles : une cannelure qui se
    // refermerait sur chaque rangée remettrait le trait horizontal qu'on vient de chasser.
    const f = joint ? JOINT_F : colonneA((xp + PERIODE - 1) % PERIODE).joint ? LEVRE_F : 0
    for (let y = 0; y < 16; y++) {
      const ligne = Math.min(LIGNES_PAROI - 1, ligne0 + y * etire)
      const base = RAMPE[teinte]![ligne]!
      // ⚠ **UNE FRACTURE EST UNE LIGNE ROMPUE.** Le joint courait d'un bout à l'autre de la
      // paroi : sur la pierre claire, ces verticales continues croisant les paliers rendaient un
      // appareillage. La roche ne se fend pas au cordeau — le joint s'INTERROMPT par tronçons,
      // tirés d'un hash positionnel (pur, stable, sans état) sur des segments de cinq pixels.
      const rompu = f > 0 && ((xp * 13 + Math.floor((ligne0 + y) / 5) * 41 + semis * 7) % 5) === 0
      r.push({ x, y, w: 1, h: 1, c: f > 0 && !rompu ? assombrir(base, f) : base })
    }
  }
  // Le GRAIN de la roche : quelques éclats, semés — jamais une strate qui traverse. Une paroi
  // bavarde redevient un mur ; c'est la VALEUR des colonnes qui porte la lecture, pas le détail.
  for (let y = 3; y < 14; y++) {
    for (let x = 0; x < 16; x++) {
      const xp = phase * 16 + x
      const n = (xp * 7 + y * 23 + semis * 29) % 31
      if (n === 0) r.push({ x, y, w: 2 - (x === 15 ? 1 : 0), h: 1, c: GRAIN_SOMBRE })
      else if (n === 17) r.push({ x, y, w: 1, h: 1, c: GRAIN_CLAIR })
    }
  }
  if (arete) {
    r.push({ x: 0, y: 0, w: 16, h: 1, c: RIM_N }, { x: 0, y: 1, w: 16, h: 1, c: RIM_N2 })
  }
  if (pied) r.push({ x: 0, y: 14, w: 16, h: 2, c: PIED })
  if (mask & 4) r.push({ x: 0, y: 0, w: 1, h: 16, c: RIM_W })
  if (mask & 2) r.push({ x: 15, y: 0, w: 1, h: 16, c: RIM_E })
  return r
}

/**
 * L'OMBRE PORTÉE au pied de la paroi — trois crans, jamais un dégradé (le sol du projet n'a
 * d'aérographe nulle part). Elle se pose sur la tuile de sol qui suit le pied.
 */
export const OMBRE_CRANS: readonly (readonly [number, number])[] = [[8, 0.46], [6, 0.22], [2, 0.1]]

/** Le rôle d'une tuile de falaise, lu du terrain — jamais stocké. */
export type RoleFalaise = 'dessus' | 'paroi'

export interface Falaise {
  role: RoleFalaise
  /** Paroi seulement : est-ce l'arête haute ? le pied ? Une masse d'une rangée est les deux. */
  arete: boolean
  pied: boolean
}

/**
 * QUI SUIS-JE : dessus, ou paroi ? On COMPTE la roche sous soi, et rien d'autre.
 *
 * `estRoche` doit rendre `true` hors carte (l'anneau de bordure en est) — sans quoi la dernière
 * rangée du monde se dresserait en paroi devant le vide.
 */
export function roleDeFalaise(
  estRoche: (tx: number, ty: number) => boolean,
  tx: number,
  ty: number,
): Falaise {
  let sous = 0
  while (sous < PAROI_RANGEES && estRoche(tx, ty + sous + 1)) sous += 1
  if (sous >= PAROI_RANGEES) return { role: 'dessus', arete: false, pied: false }
  // On est dans les `PAROI_RANGEES` dernières rangées : paroi. L'arête est en haut de la paroi —
  // soit la masse s'arrête là, soit la rangée du dessus est un dessus.
  const hautDeParoi = !estRoche(tx, ty - 1) || sous + 1 >= PAROI_RANGEES
  return { role: 'paroi', arete: hautDeParoi, pied: sous === 0 }
}

/** Clé d'une texture de falaise. `top` = le dessus, `face` = la paroi, `ombre` = l'ombre portée. */
export function cliffKey(family: 'top' | 'face' | 'ombre', mask: number, variant: number): string {
  return `cf-${family}-${mask}-${variant}`
}

/**
 * Génère les textures de falaise — appelé une fois au boot, comme les nœuds et les lieux.
 * Dessus : 8 masques × 2 variantes. Paroi : 16 masques × 4 variantes. Ombre : 1.
 */
export function makeCliffTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()
  const rejouer = (rects: readonly RectArt[], key: string): void => {
    for (const r of rects) g.fillStyle(r.c).fillRect(r.x, r.y, r.w, r.h)
    g.generateTexture(key, CLIFF_TILE_PX, CLIFF_TILE_PX)
    g.clear()
  }

  for (let mask = 0; mask < 8; mask++) {
    for (let v = 0; v < VARIANTES_DESSUS; v++) rejouer(dessinDuDessus(mask, v), cliffKey('top', mask, v))
  }
  for (let mask = 0; mask < 16; mask++) {
    for (let v = 0; v < VARIANTES_PAROI; v++) rejouer(dessinDeParoi(mask, v), cliffKey('face', mask, v))
  }

  let y = 0
  for (const [h, a] of OMBRE_CRANS) {
    g.fillStyle(0x0a090e, a).fillRect(0, y, CLIFF_TILE_PX, h)
    y += h
  }
  g.generateTexture(cliffKey('ombre', 0, 0), CLIFF_TILE_PX, CLIFF_TILE_PX)
  g.clear()

  g.destroy()
}
