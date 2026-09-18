/**
 * ═══ LA LOI DU BANC GI — la part PURE de l'onglet `#gi` de l'Atelier (`banc-gi.ts`) ═══
 *
 * Spec `lumiere-globale.md` : LG-A1 (« chaque passe a sa garde de pixels … étant donné une scène fixe
 * dont l'oracle connaît le champ »), LG-A3 (la pureté à l'écran) et LG-A14 (le coût, et la gate par
 * classe de GPU). Tout ce qui n'a pas besoin d'un GPU vit ici, sans Phaser : la SCÈNE FIXE, les seuils,
 * la classe d'un GPU d'après son nom, la comparaison d'une cible relue. `banc-gi-loi.test.ts` prouve
 * les PRÉMISSES de la scène par l'oracle avant qu'aucun GPU ne la rende — une garde verte sur une scène
 * sans face, sans rebond ou sans ombre croisant la lumière n'aurait rien éprouvé (mémoire du projet :
 * « une garde prouve sa prémisse »).
 *
 * ═══ LA SCÈNE — le coin du feu et la lisière (les planches 1 à 3) ═══
 * Sur une carte d'herbe de 120 × 80 tuiles, la caméra du jeu (1280 × 720) posée à dix tuiles du bord :
 *   · LE COIN DU FEU : un mur d'arête OUEST sur six tuiles et un mur d'arête NORD sur sept, joints à
 *     l'angle ; un feu à leur pied, dans l'angle — les deux faces INTÉRIEURES des bandes reçoivent le
 *     direct et le renvoient (les faces de BANDE, LG-R4) ; l'ombre d'astre du mur nord tombe dans
 *     l'angle, SUR la lumière du feu (la prémisse de la composition, LG-R5/LG-R8) ;
 *   · deux tuiles de mur PLEIN (sans arête) à l'est du feu — les faces de CELLULE ;
 *   · un carré de roche (terrain plein) et une pierre (nœud plein) — les autres sortes d'occludeur ;
 *   · LA LISIÈRE : cinq arbres en quinconce et un second feu au sud — leurs FÛTS (2 × 2 texels) sont
 *     des cellules pleines, et leurs CARTES (une silhouette synthétique, `banc-gi.ts` la cuit) jettent
 *     l'ombre d'astre des arbres (LG-R8) dans la lumière du second feu.
 * L'astre : la dérive d'un après-midi (l'ombre part à l'est), la force de l'ombre au jeu à 80 % de
 * `SHADOW_ALPHA`. Le plancher de nuit : un Mn bleuté, comme le voile d'une nuit claire. Tout est fixe :
 * ni heure, ni battement, ni vent — le banc mesure la chaîne, pas le monde.
 */
import { EDGE_N, EDGE_O, LUMIERE, TERRAIN_GRASS, TERRAIN_ROCK, createEmptyMap, type MondeEclaire, type ResourceNode, type Structure } from '@ashes/sim'
import { TILE_PX } from '../render/framing'
import type { CarteMonde, SourceGi } from '../render/gi/champ-gpu'
import type { Fenetre } from '../render/gi/grille'
import { GI } from '../render/gi/reglages'

const T = LUMIERE.TEXELS_PAR_TUILE

/** La scène, en tuiles et en px monde. */
export const SCENE = {
  MAP_W: 120,
  MAP_H: 80,
  /** La vue du jeu, et son coin nord-ouest en px monde (dix tuiles : la fenêtre du champ, à huit tuiles
   *  de marge, commence à la tuile 2 — jamais hors carte). */
  VUE_W: 1280,
  VUE_H: 720,
  SCROLL_X: 10 * TILE_PX,
  SCROLL_Y: 10 * TILE_PX,
  /** Le coin du feu : l'angle (tuile), la longueur des deux murs, le feu dans l'angle. */
  COIN: { tx: 30, ty: 28, ouest: 6, nord: 7 },
  FEU_1: { tx: 32, ty: 31 },
  /** Les deux tuiles de mur plein, l'une sous l'autre. */
  PLEIN: { tx: 36, ty: 32 },
  /** Le carré de roche (2 × 2 tuiles) et la pierre. */
  ROCHE: { tx: 40, ty: 30 },
  PIERRE: { tx: 34, ty: 34 },
  /** La lisière : les pieds des arbres, et le feu qui les éclaire. */
  ARBRES: [
    { tx: 26, ty: 37 },
    { tx: 28, ty: 38 },
    { tx: 30, ty: 39 },
    { tx: 32, ty: 38 },
    { tx: 34, ty: 39 },
  ],
  FEU_2: { tx: 30, ty: 41 },
  /** La portée des deux feux, en tuiles (celle d'un Feu de village au repos), et leur force (LG-R6 : 1 =
   *  le feu neutre, ni engagement ni souffle). */
  PORTEE_TUILES: 6,
  FORCE: 1,
  /** La silhouette synthétique d'un fût, en px : une carte opaque de 6 × 20, debout sur son pied. */
  FUT_W: 6,
  FUT_H: 20,
  /** La clé de sa texture — cuite par `banc-gi.ts` à la création de la scène. */
  CLE_FUT: 'banc-gi-fut',
  /** La profondeur d'affichage du quad du champ (le regard, en ADD sur le noir). */
  DEPTH: 10,
} as const

/**
 * L'ASTRE DU BANC — `derive` comme `deriveDOmbre` un après-midi (l'ombre part à l'EST), `a` comme
 * `SHADOW_ALPHA × forceDeLOmbre` au jeu (`WorldScene` → `ChampGpu.update`) : 0,42 est `SHADOW_ALPHA`
 * (`scenes/world/contact-shadow.ts`, redit ici parce que ce module tire Phaser), à 80 % de force.
 * `banc-gi-loi.test.ts` tient le nombre égal à celui du jeu.
 */
export const ASTRE_DU_BANC = { derive: 0.5, a: 0.42 * 0.8 } as const

/** Le plancher de nuit du banc, par canal : un voile bleuté de nuit claire (Mn, LG-R5). */
export const MN_DU_BANC: readonly [number, number, number] = [0.22, 0.24, 0.3]

/** Le monde fixe. Un seul objet par banc : `nodeAt` indexe les nœuds par l'identité du tableau. */
export function mondeDuBanc(): MondeEclaire {
  const map = createEmptyMap(SCENE.MAP_W, SCENE.MAP_H, TERRAIN_GRASS)
  const structures: Structure[] = []
  const nodes: ResourceNode[] = []
  const structure = (type: Structure['type'], tx: number, ty: number, edges?: number): void => {
    // Les champs que `occlusionAuGrain` lit : le type, la tuile, les arêtes, l'étage (absent = le sol).
    // Le reste (accès, PV, village) ne compte pas pour la lumière.
    const s = { id: structures.length + 1, type, tx, ty, villageId: 0, ownerId: 0, access: 'public', hp: 100 } as unknown as Structure
    if (edges !== undefined) s.edges = edges
    structures.push(s)
  }
  const { COIN } = SCENE
  // Le mur ouest descend de l'angle ; le mur nord part de l'angle vers l'est ; l'angle porte les deux.
  for (let i = 0; i < COIN.ouest; i++) structure('wall', COIN.tx, COIN.ty + i, i === 0 ? EDGE_N | EDGE_O : EDGE_O)
  for (let i = 1; i < COIN.nord; i++) structure('wall', COIN.tx + i, COIN.ty, EDGE_N)
  structure('wall', SCENE.PLEIN.tx, SCENE.PLEIN.ty)
  structure('wall', SCENE.PLEIN.tx, SCENE.PLEIN.ty + 1)
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) map.terrain[(SCENE.ROCHE.ty + dy) * map.width + SCENE.ROCHE.tx + dx] = TERRAIN_ROCK
  nodes.push({ id: 1, type: 'rock', tx: SCENE.PIERRE.tx, ty: SCENE.PIERRE.ty, stock: 5, regrowAt: 0 } as unknown as ResourceNode)
  SCENE.ARBRES.forEach((a, i) => nodes.push({ id: 2 + i, type: 'tree', tx: a.tx, ty: a.ty, stock: 5, regrowAt: 0 } as unknown as ResourceNode))
  return { map, structures, nodes }
}

/** Les deux feux, au centre de leur tuile (LG-R17), en px monde. */
export function sourcesDuBanc(): SourceGi[] {
  return [SCENE.FEU_1, SCENE.FEU_2].map((f) => ({
    worldX: (f.tx + 0.5) * TILE_PX,
    worldY: (f.ty + 0.5) * TILE_PX,
    radiusTiles: SCENE.PORTEE_TUILES,
    force: SCENE.FORCE,
  }))
}

/** Les cartes des fûts (LG-R8) : la silhouette synthétique, debout sur le pied de chaque arbre. */
export function cartesDuBanc(): CarteMonde[] {
  return SCENE.ARBRES.map((a) => {
    const piedX = (a.tx + 0.5) * TILE_PX
    const piedY = (a.ty + 1) * TILE_PX
    return { cle: SCENE.CLE_FUT, x: piedX, y: piedY, originX: 0.5, originY: 1, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, piedX, piedY }
  })
}

/**
 * La fenêtre que `ChampGpu.update` alloue pour cette vue — la même arithmétique (la marge, le palier,
 * jamais le besoin nu). Elle sert au TEST des prémisses ; au banc, c'est la grille du GPU qui fait foi
 * (`grilleDuChamp`), et un désaccord entre les deux se verrait aux comptes.
 */
export function fenetreDuBanc(): Fenetre & { readonly gw: number; readonly gh: number } {
  const x0 = Math.floor(SCENE.SCROLL_X / TILE_PX) - GI.MARGE_TUILES
  const y0 = Math.floor(SCENE.SCROLL_Y / TILE_PX) - GI.MARGE_TUILES
  const P = GI.PALIER_TEXELS
  const besoinW = (Math.ceil((SCENE.SCROLL_X + SCENE.VUE_W) / TILE_PX) + GI.MARGE_TUILES - x0 + 1) * T
  const besoinH = (Math.ceil((SCENE.SCROLL_Y + SCENE.VUE_H) / TILE_PX) + GI.MARGE_TUILES - y0 + 1) * T
  const gw = Math.ceil(besoinW / P) * P
  const gh = Math.ceil(besoinH / P) * P
  return { x0, y0, x1: x0 + gw / T - 1, y1: y0 + gh / T - 1, gw, gh }
}

// ═══ LES SEUILS ═══

/** LG-A2, « seuils de moi » : ≤ 1 niveau en moyenne, moins de 1 % des texels à plus de 3 niveaux. */
export const SEUILS = { MOYENNE: 1, PART_SUP3: 0.01 } as const

/** L'écart d'une cible relue à ce qu'on attend, en NIVEAUX (sur 255) — la forme de `EcartCible`. */
export interface Ecart {
  /** Les texels comparés. */
  readonly n: number
  readonly moyenne: number
  readonly partSup3: number
  readonly max: number
  /** Les texels que l'attendu met à autre chose que zéro : la PRÉMISSE (une garde à zéro n'a rien éprouvé). */
  readonly nonNuls: number
}

/**
 * Compare `canaux` canaux sur `n` texels : `lu` rend l'OCTET relu, `ref` la valeur attendue dans [0, 1],
 * arrondie ici comme l'octet auquel on la compare (sinon la quantification facture un demi-niveau par
 * texel). `garder` choisit les texels (les libres, par exemple).
 */
export function ecartDe(
  n: number,
  canaux: number,
  lu: (k: number, c: number) => number,
  ref: (k: number, c: number) => number,
  garder: (k: number) => boolean = () => true,
): Ecart {
  let compares = 0
  let somme = 0
  let sup3 = 0
  let max = 0
  let nonNuls = 0
  for (let k = 0; k < n; k++) {
    if (!garder(k)) continue
    compares++
    let pire = 0
    let vif = false
    for (let c = 0; c < canaux; c++) {
      const attendu = Math.round(Math.min(1, Math.max(0, ref(k, c))) * 255)
      if (attendu > 0) vif = true
      const d = Math.abs(lu(k, c) - attendu)
      somme += d
      if (d > pire) pire = d
    }
    if (vif) nonNuls++
    if (pire > 3) sup3++
    if (pire > max) max = pire
  }
  return {
    n: compares,
    moyenne: compares > 0 ? somme / (compares * canaux) : 0,
    partSup3: compares > 0 ? sup3 / compares : 0,
    max,
    nonNuls,
  }
}

/** Le verdict d'un écart aux seuils LG-A2 — et sa prémisse : quelque chose de non nul à comparer. */
export function tient(e: Ecart): boolean {
  return e.nonNuls > 0 && e.moyenne <= SEUILS.MOYENNE && e.partSup3 < SEUILS.PART_SUP3
}

/** L'écart, en une ligne lisible. */
export function direLEcart(e: Ecart): string {
  const pc = (e.partSup3 * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  return `${e.moyenne.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} niveau en moyenne, ${pc} % au-delà de 3, ${e.max} au pire, sur ${e.n.toLocaleString('fr-FR')} texels (${e.nonNuls.toLocaleString('fr-FR')} non nuls)`
}

// ═══ LA CLASSE D'UN GPU, ET SA GATE (LG-A14) ═══

export type ClasseGpu = 'integre' | 'dedie' | 'logiciel' | 'inconnue'

/** Les seuils tranchés par Alexis (LG-Q7, « les deux seuils ») : 2 ms par image intégré, 4 ms dédié. */
export const GATES_MS: Readonly<Record<'integre' | 'dedie', number>> = { integre: 2, dedie: 4 }

/**
 * La classe d'après le nom que `WEBGL_debug_renderer_info` rend. Une heuristique de noms, pas une
 * base : « en cas de doute, elle se dit à la main » (LG-A14) — le banc laisse choisir. Un rendu
 * LOGICIEL (SwiftShader, llvmpipe) n'est d'aucune classe : son coût est indicatif, jamais une gate.
 */
export function classeDuGpu(nom: string): ClasseGpu {
  const n = nom.toLowerCase()
  if (/swiftshader|llvmpipe|softpipe|software|mesa offscreen|basic render driver/.test(n)) return 'logiciel'
  if (/geforce|rtx|gtx|quadro|tesla|nvidia|radeon (rx|pro|r9|r7|hd|vii)|arc a\d|arc b\d|firepro/.test(n)) return 'dedie'
  if (/intel|iris|uhd|hd graphics|xe graphics|apple (m\d|gpu)|apple m|adreno|mali|powervr|radeon\(tm\)|vega \d|ryzen|graphics 6\d\d/.test(n)) return 'integre'
  return 'inconnue'
}

/** La gate d'une classe, en ms — `null` : pas de gate (logiciel, ou classe inconnue non tranchée). */
export function gateDe(classe: ClasseGpu): number | null {
  return classe === 'integre' || classe === 'dedie' ? GATES_MS[classe] : null
}

/** Le libellé d'une classe. */
export function nomDeClasse(classe: ClasseGpu): string {
  return classe === 'integre' ? 'GPU intégré' : classe === 'dedie' ? 'GPU dédié' : classe === 'logiciel' ? 'rendu logiciel (pas de GPU)' : 'classe inconnue'
}

/** La médiane d'une série (la mesure de LG-A14 : « en médiane de 3 »). */
export function mediane(a: readonly number[]): number {
  const s = a.slice().sort((x, y) => x - y)
  return s[s.length >> 1] ?? 0
}
