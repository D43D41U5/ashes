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
import { hash2, RELIEF, TERRAIN_ROCK } from '@ashes/sim'
import { COTE_E, COTE_N, COTE_O, COTE_S, PAVE } from './paves'
import { CHUTE_FRAMES, CHUTE_PHASES, CHUTE_RANGEES, dessinDeChute, dessinDEcume, ECUME_FRAMES } from './chute-art'
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

/** Un rectangle plein — l'unité du dessin. Tout l'art de la falaise en est fait. `a` : l'alpha,
 *  absent = opaque. Seule la LÈVRE s'en sert — ses liserés se posent SUR le sol du palier, qu'elle
 *  ne connaît pas (voir `dessinDeLevre`) ; la roche, elle, est toujours pleine. */
export interface RectArt {
  x: number
  y: number
  w: number
  h: number
  c: number
  a?: number
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

/**
 * ═══ LA LÈVRE — LE BORD D'UN PALIER VU DE DESSUS, DANS LA GRAMMAIRE DU PAVÉ (2026-09-04) ═══
 *
 * *Alexis : « je ne vois pas du tout la délimitation entre les étages si les falaises ne font pas
 * face à la caméra — inspiré du design liseré pour le sol ».* Et c'était exact : seule la PAROI
 * (face sud) se dessinait ; au nord, à l'est et à l'ouest, deux paliers se touchaient à deux
 * hauteurs sans qu'un pixel ne le dise — `HORS_PALIER` avait même retiré le liseré de pavé qui
 * y restait, parce qu'il se lisait comme une couture de chunk. Une terrasse n'avait donc de
 * silhouette qu'à l'endroit où elle nous regarde.
 *
 * Le bord d'un palier est de la ROCHE NUE — c'est le rebord de la marche de LTTP : une bande de
 * pierre court sur tout le POURTOUR du dessus, et le sol du palier (herbe, éboulis) vient
 * MORDRE dedans avec la frange irrégulière des pavés. Trois choses s'y lisent, de l'extérieur
 * vers l'intérieur :
 *
 *  • **l'ARÊTE**, au ras du vide — celle du dessus de falaise, telle quelle : deux rangées
 *    claires au nord (`RIM_N`, `RIM_N2`), un pixel clair à l'ouest, un pixel sombre à l'est. Au
 *    SUD, la paroi porte déjà la sienne : la lèvre s'y arrête à la roche.
 *  • **la ROCHE**, `FRANGE_MIN..FRANGE_MAX` px de pierre par colonne de 4 px (la maille de la
 *    frange des pavés, `PAVE.FRANGE_*`), avec le grain du dessus.
 *  • **le CONTOUR du sol**, dans les mots exacts du pavé : le sol est un pavé posé SUR la roche
 *    — son bord bas et ses bords latéraux prennent le `LISERE`, son bord haut l'`ARETE_HAUTE`,
 *    la rangée au-dessus d'un bord bas la `TRANCHE` ; et la roche sous lui reçoit son `OMBRE`,
 *    sa `PENOMBRE`, son `OMBRE_LATERALE`. Rien n'est inventé : mêmes facteurs, même maille.
 *
 * ⚠ **LA LÈVRE NE CONNAÎT PAS LE SOL.** Elle se pose en sprite sur le sol du palier, quel qu'il
 * soit (pavé de pré, dessus de mesa) : la roche est OPAQUE, et le contour du sol est un VOILE
 * d'alpha (`RectArt.a`) — noir pour assombrir, blanc pour éclairer — qui teinte ce qui est
 * dessous. C'est ce qui la rend unique pour tous les terrains : 15 masques × 8 franges, et non
 * autant par matière.
 *
 * ⚠ **LE COIN RENTRANT EST UNE PIÈCE À PART.** Deux bandes qui se rejoignent à l'angle CONVEXE
 * d'un plateau se recouvrent dans la même tuile (masque à deux côtés). Mais à l'angle RENTRANT,
 * la bande nord d'une tuile et la bande ouest de sa voisine se touchent par un seul pixel de
 * diagonale : l'anneau se rompt. La tuile de l'angle porte donc un CARRÉ de roche dans son coin
 * (`dessinDeCoin`), et seulement quand aucun de ses deux côtés n'est déjà ouvert — un côté
 * ouvert couvre le coin de sa bande.
 */
export const LEVRE = {
  /** Franges par masque : la lèvre d'un long bord ne doit pas se répéter à l'œil. Tirée au hash
   *  de la tuile, comme le semis de strate de la paroi. */
  VARIANTES: 8,
  /** L'arête nord de la lèvre : les deux rangées du dessus de falaise. Est et ouest : un pixel. */
  ARETE_N_PX: 2,
  ARETE_LAT_PX: 1,
  /**
   * L'OMBRE DU FLANC EST sur le sol du bas — LA MÊME que l'ombre du pied (`OMBRE_CRANS`), couchée
   * vers l'est : le soleil est au nord-ouest à ~45°, une ombre jetée à l'est est aussi large que
   * celle jetée au sud. Elle a d'abord été la moitié (4/3/1) ; à l'A/B (2026-09-04) l'œil prenait
   * ce liseré pour le contour de la lèvre, et le bord est se lisait plat, pas en chute. Trois
   * crans, jamais un dégradé. Le flanc OUEST, lui, prend le jour : rien.
   */
  OMBRE_FLANC: OMBRE_CRANS,
} as const

const P = CLIFF_TILE_PX

/** La profondeur de roche d'une colonne (ou ligne) de 4 px d'un côté, `FRANGE_MIN..FRANGE_MAX`,
 *  par le hash de la variante — la même loi que la frange des pavés, dans l'espace des variantes
 *  plutôt que dans celui de la carte (la lèvre est une texture, pas une cuisson). */
function frangeDeLevre(variant: number, cote: number, along: number): number {
  const n = PAVE.FRANGE_MAX - PAVE.FRANGE_MIN + 1
  return PAVE.FRANGE_MIN + Math.floor(hash2(variant * 16 + cote, along, 0x1e7e) * n)
}

/** Le masque de roche d'une lèvre : 1 = roche, 0 = le sol du palier, qu'on laisse voir. `cotes` :
 *  bit 1 = nord, 2 = est, 4 = ouest, 8 = sud. */
function rocheDeLevre(cotes: number, variant: number): Uint8Array {
  const m = new Uint8Array(P * P)
  for (let x = 0; x < P; x++) {
    const c = x >> 2
    if (cotes & 1) {
      const d = LEVRE.ARETE_N_PX + frangeDeLevre(variant, COTE_N, c)
      for (let y = 0; y < d; y++) m[y * P + x] = 1
    }
    if (cotes & 8) {
      const d = frangeDeLevre(variant, COTE_S, c)
      for (let y = P - d; y < P; y++) m[y * P + x] = 1
    }
  }
  for (let y = 0; y < P; y++) {
    const r = y >> 2
    if (cotes & 4) {
      const d = LEVRE.ARETE_LAT_PX + frangeDeLevre(variant, COTE_O, r)
      for (let x = 0; x < d; x++) m[y * P + x] = 1
    }
    if (cotes & 2) {
      const d = LEVRE.ARETE_LAT_PX + frangeDeLevre(variant, COTE_E, r)
      for (let x = P - d; x < P; x++) m[y * P + x] = 1
    }
  }
  return m
}

/** Les quatre coins rentrants, dans l'ordre des bits de `levreDe(...).coins`. */
export const COINS = ['nw', 'ne', 'sw', 'se'] as const

/** Le carré de roche d'un coin rentrant : il prolonge la bande nord (ou sud) de la voisine ouest
 *  et la bande ouest (ou est) de la voisine nord, à leur profondeur nominale. */
function rocheDeCoin(coin: number, variant: number): Uint8Array {
  const m = new Uint8Array(P * P)
  const nord = coin < 2
  const ouest = (coin & 1) === 0
  const hh = (nord ? LEVRE.ARETE_N_PX : 0) + frangeDeLevre(variant, 4 + coin, 0)
  const ww = LEVRE.ARETE_LAT_PX + frangeDeLevre(variant, 4 + coin, 1)
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < ww; x++) m[(nord ? y : P - 1 - y) * P + (ouest ? x : P - 1 - x)] = 1
  }
  return m
}

/**
 * HABILLER un masque de roche : la pierre et son grain, l'ombre que le sol lui porte, les arêtes
 * des côtés ouverts — puis, sur le sol, le contour en voile d'alpha. Une tuile 16 × 16 émise en
 * RUNS par rangée (même couleur, même alpha), pas en pixels : c'est ce qu'on rejoue au boot.
 */
function habiller(roche: Uint8Array, cotes: number, variant: number): RectArt[] {
  const dedans = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < P && y < P
  // Hors tuile, on ne sait rien : ni roche ni sol — aucun bord n'y naît. (La voisine porte les
  // siens ; au pire, la marche de frange à la couture des tuiles perd son pixel de contour.)
  const estRoche = (x: number, y: number): boolean => dedans(x, y) && roche[y * P + x] === 1
  const estSol = (x: number, y: number): boolean => dedans(x, y) && roche[y * P + x] === 0
  // Le grain du dessus — les deux semis fixes de `dessinDuDessus`, sur la roche seulement.
  const v = variant & 1
  const grainSombre = new Set((v === 0
    ? [[3, 4], [9, 2], [13, 7], [5, 11], [11, 13], [7, 8]]
    : [[2, 6], [8, 4], [12, 10], [4, 13], [14, 3], [6, 2]]).flatMap(([x, y]) => [y! * P + x!, y! * P + x! + 1]))
  const grainClair = new Set((v === 0
    ? [[6, 5], [12, 3], [2, 10], [10, 11], [14, 14]]
    : [[4, 3], [10, 7], [13, 12], [3, 8], [7, 14]]).map(([x, y]) => y! * P + x!))

  const r: RectArt[] = []
  for (let y = 0; y < P; y++) {
    let run: RectArt | null = null
    for (let x = 0; x < P; x++) {
      let c = -1
      let a = 1
      if (estRoche(x, y)) {
        const i = y * P + x
        c = grainSombre.has(i) ? TOP_DARK : grainClair.has(i) ? TOP_LIGHT : TOP_BASE
        // L'OMBRE DU SOL SUR LA ROCHE — le pavé sur le terrain du dessous, mot pour mot.
        if (estSol(x, y - 1) || estSol(x, y - 2)) c = assombrir(c, PAVE.OMBRE)
        else if (estSol(x, y - 3)) c = assombrir(c, PAVE.PENOMBRE)
        else if (estSol(x - 1, y) || estSol(x + 1, y)) c = assombrir(c, PAVE.OMBRE_LATERALE)
        // L'ARÊTE, par-dessus tout : c'est le bord qui prend le jour (ou l'ombre, à l'est).
        if ((cotes & 1) !== 0 && y < LEVRE.ARETE_N_PX) c = y === 0 ? RIM_N : RIM_N2
        else if ((cotes & 4) !== 0 && x < LEVRE.ARETE_LAT_PX) c = RIM_W
        else if ((cotes & 2) !== 0 && x >= P - LEVRE.ARETE_LAT_PX) c = RIM_E
      } else if (estRoche(x, y + 1) || estRoche(x - 1, y) || estRoche(x + 1, y)) {
        // LE CONTOUR DU SOL — le pavé, mot pour mot : liseré en bas et sur les côtés…
        c = 0x000000
        a = 1 - PAVE.LISERE
      } else if (estRoche(x, y - 1)) {
        // … arête haute, éclairée, en haut…
        c = 0xffffff
        a = PAVE.ARETE_HAUTE - 1
      } else if (estRoche(x, y + 2)) {
        // … et la tranche, une rangée au-dessus du bord bas.
        c = 0x000000
        a = 1 - PAVE.TRANCHE
      }
      if (c < 0) {
        run = null
        continue
      }
      if (run !== null && run.c === c && (run.a ?? 1) === a) {
        run.w += 1
        continue
      }
      run = a < 1 ? { x, y, w: 1, h: 1, c, a } : { x, y, w: 1, h: 1, c }
      r.push(run)
    }
  }
  return r
}

/** LA LÈVRE d'une tuile de palier : `cotes` = ses côtés OUVERTS (bit 1 = nord, 2 = est, 4 = ouest,
 *  8 = sud — les trois premiers comme `dessinDuDessus`), `variant` sa frange. Transparente là où
 *  le sol du palier reste à voir. */
export function dessinDeLevre(cotes: number, variant: number): RectArt[] {
  return habiller(rocheDeLevre(cotes & 15, variant), cotes & 15, variant)
}

/** LE COIN RENTRANT d'une tuile de palier (`coin` : l'indice dans `COINS`) : le carré de roche
 *  qui referme l'anneau entre la bande d'une voisine et celle de l'autre. */
export function dessinDeCoin(coin: number, variant: number): RectArt[] {
  return habiller(rocheDeCoin(coin & 3, variant), 0, variant)
}

/**
 * OÙ VA LA LÈVRE — lu des hauteurs voisines, jamais stocké. `plusBas(dx, dy)` dit si la voisine
 * à cet offset est PLUS BASSE que la tuile (l'appelant y met ce qu'il sait : une rampe qui monte
 * jusqu'ici n'ouvre pas le sud, elle est le passage).
 *
 * `cotes` : les bits de `dessinDeLevre`. `coins` : bit 1 = nord-ouest, 2 = nord-est, 4 = sud-ouest,
 * 8 = sud-est (l'ordre de `COINS`) — un coin ne se pose que si sa DIAGONALE est plus basse et
 * qu'AUCUN de ses deux côtés ne l'est : sinon la bande du côté le couvre déjà.
 */
export function levreDe(plusBas: (dx: number, dy: number) => boolean): { cotes: number; coins: number } {
  const n = plusBas(0, -1)
  const e = plusBas(1, 0)
  const w = plusBas(-1, 0)
  const s = plusBas(0, 1)
  const cotes = (n ? 1 : 0) | (e ? 2 : 0) | (w ? 4 : 0) | (s ? 8 : 0)
  let coins = 0
  if (!n && !w && plusBas(-1, -1)) coins |= 1
  if (!n && !e && plusBas(1, -1)) coins |= 2
  if (!s && !w && plusBas(-1, 1)) coins |= 4
  if (!s && !e && plusBas(1, 1)) coins |= 8
  return { cotes, coins }
}

/** La variante de lèvre d'une tuile : au hash de sa position — pur, stable, sans état. */
export function varianteDeLevre(tx: number, ty: number): number {
  return Math.floor(hash2(tx, ty, 0x1e7e) * LEVRE.VARIANTES)
}

/** Clé d'une texture de falaise. `top` = le dessus, `face` = la paroi, `ombre` = l'ombre portée au
 *  pied, `levre` = le bord d'un palier vu de dessus, `coin` = son coin rentrant, `flanc` = l'ombre
 *  que le flanc est jette sur le sol du bas, `chute` = la nappe d'eau qui remplace la paroi sous
 *  un fleuve (`chute-art`, mask = la rangée, variant = phase × pas), `ecume` = son écume au pied. */
export function cliffKey(family: 'top' | 'face' | 'ombre' | 'levre' | 'coin' | 'flanc' | 'chute' | 'ecume', mask: number, variant: number): string {
  return `cf-${family}-${mask}-${variant}`
}

/** La variante d'une texture de chute : la phase de colonne (`tx % CHUTE_PHASES`) et le pas de
 *  temps, en un seul entier — c'est ce que la couche demande à chaque image. */
export function varianteDeChute(phase: number, frame: number): number {
  return phase * CHUTE_FRAMES + frame
}
export function varianteDEcume(phase: number, frame: number): number {
  return phase * ECUME_FRAMES + frame
}

/**
 * Génère les textures de falaise — appelé une fois au boot, comme les nœuds et les lieux.
 * Dessus : 8 masques × 2 variantes. Paroi : 16 masques × 4 variantes. Ombre : 1.
 */
export function makeCliffTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()
  const rejouer = (rects: readonly RectArt[], key: string): void => {
    for (const r of rects) g.fillStyle(r.c, r.a ?? 1).fillRect(r.x, r.y, r.w, r.h)
    g.generateTexture(key, CLIFF_TILE_PX, CLIFF_TILE_PX)
    g.clear()
  }

  for (let mask = 0; mask < 8; mask++) {
    for (let v = 0; v < VARIANTES_DESSUS; v++) rejouer(dessinDuDessus(mask, v), cliffKey('top', mask, v))
  }
  for (let mask = 0; mask < 16; mask++) {
    for (let v = 0; v < VARIANTES_PAROI; v++) rejouer(dessinDeParoi(mask, v), cliffKey('face', mask, v))
  }
  // La lèvre : 15 masques de côtés × 8 franges ; le coin rentrant : 4 × 8.
  for (let cotes = 1; cotes < 16; cotes++) {
    for (let v = 0; v < LEVRE.VARIANTES; v++) rejouer(dessinDeLevre(cotes, v), cliffKey('levre', cotes, v))
  }
  for (let coin = 0; coin < 4; coin++) {
    for (let v = 0; v < LEVRE.VARIANTES; v++) rejouer(dessinDeCoin(coin, v), cliffKey('coin', coin, v))
  }
  // La cascade : `CHUTE_RANGEES` rangées × 4 phases × 7 pas ; son écume : 4 phases × 6 pas.
  for (let k = 0; k < CHUTE_RANGEES; k++) {
    for (let p = 0; p < CHUTE_PHASES; p++) {
      for (let f = 0; f < CHUTE_FRAMES; f++) rejouer(dessinDeChute(k, f, p), cliffKey('chute', k, varianteDeChute(p, f)))
    }
  }
  for (let p = 0; p < CHUTE_PHASES; p++) {
    for (let f = 0; f < ECUME_FRAMES; f++) rejouer(dessinDEcume(f, p), cliffKey('ecume', 0, varianteDEcume(p, f)))
  }

  let y = 0
  for (const [h, a] of OMBRE_CRANS) {
    g.fillStyle(0x0a090e, a).fillRect(0, y, CLIFF_TILE_PX, h)
    y += h
  }
  g.generateTexture(cliffKey('ombre', 0, 0), CLIFF_TILE_PX, CLIFF_TILE_PX)
  g.clear()
  // L'ombre du flanc est : les mêmes crans, couchés — elle part du bord OUEST de la tuile du bas.
  let x = 0
  for (const [w, a] of LEVRE.OMBRE_FLANC) {
    g.fillStyle(0x0a090e, a).fillRect(x, 0, w, CLIFF_TILE_PX)
    x += w
  }
  g.generateTexture(cliffKey('flanc', 0, 0), CLIFF_TILE_PX, CLIFF_TILE_PX)
  g.clear()

  g.destroy()
}
