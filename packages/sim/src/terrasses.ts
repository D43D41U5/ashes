/**
 * ═══ LES TERRASSES INTRAZONE — le sol lui-même a des paliers (spec `terrasses.md`) ═══
 *
 * Décision d'Alexis (2026-09-03) : **trois paliers, coupés aux terciles de `altLarge`** — la
 * grande ondulation du socle, celle qui creuse déjà les lacs. Le pays n'est plus une plaine
 * piquée de mesas : c'est un escalier de terrasses, chacune bordée d'une paroi qui regarde le
 * SUD (« le nord est le haut »), qu'on monte par des rampes élues au bord.
 *
 * Ce fichier ne fait qu'UNE chose : il rend `palier[i]` pour chaque tuile, et la liste des
 * rampes qui relient un palier au suivant. Il ne repeint aucune tuile de `terrain` — le sol
 * d'avant est intact au bit près (T-R1 : la donnée est ADDITIVE). Les étages creux qui en
 * découlent (le dessus des mesas à `palier + 1`, les caves à `palier − 1`, les tuiles de rampe
 * au niveau du haut) se construisent dans `zonegen.ts`, à partir de ce que l'on rend ici.
 *
 * ⚠ **AUCUN TIRAGE.** Tout est lecture du socle et du terrain, balayages row-major, départages
 * géométriques (le sud, puis l'ouest). Le flux du PRNG n'est pas touché d'un bit — le piège
 * documenté du dépôt (changer un décompte décale le flux et casse des tests sans rapport).
 *
 * ⚠ RÉGLAGES DE CARTE, à côté du générateur (`balance.ts` en tête : ce qui se règle en
 * REGARDANT UNE CARTE vit avec le générateur).
 */
import { CREUX } from './racine-relief'
import { TasPF, type Socle } from './socle'
import { isWater, MARCHABLE } from './map'
import { TERRAIN_ROAD } from './balance'
import type { Escalier } from './zonegen-hydro'

export type { Escalier } from './zonegen-hydro'

export const TERRASSES = {
  /** Combien de paliers — trois, aux terciles de `altLarge` (décision du 2026-09-03). */
  PALIERS: 3,
  /**
   * En dessous de cette taille (tuiles marchables d'un seul tenant, même palier), une poche de
   * terrasse est une MIETTE : fondue dans le palier voisin majoritaire. Mesuré (graine 2026) :
   * 291 miettes pour 12 222 tuiles, contre 147 composantes qui restent — sans ce seuil, le pays
   * est un damier de socles d'une cellule.
   */
  MIETTE_TUILES: 96,
  /**
   * Une rampe tous les N tuiles de bord entre deux composantes : le joueur ne longe pas un mur
   * un écran entier (≈ 36 tuiles) sans trouver où monter.
   */
  RAMPE_PAS: 48,
  /**
   * La largeur d'une marche creusée par T-R5 (rayon Chebyshev) : une bande intermédiaire de
   * `2·MARCHE + 1` tuiles au moins, assez pour qu'une rampe y tienne (deux rangées du haut).
   */
  MARCHE: 2,
  /**
   * Borne des points fixes (rabaisser → miettes → rampes → garantir). Chaque tour de garantie
   * érode d'une marche une région sans côte sud ; la borne est large, la sortie est précoce.
   */
  TOURS: 32,
  /**
   * SUR L'ESCALIER, LA NATURE ENJAMBE LES TERRASSES : les deux couronnes (le Bois Noir, la Combe
   * brumeuse) sont des massifs de 3 000 à 13 000 tuiles dont le corps est le TERRAIN — ils ne
   * sont pas des assises. Aplanir un bois de 13 000 tuiles sur un palier soulevait 4 097 tuiles
   * de rive au-dessus de la rivière qui le traverse (graine 2026 : la rivière, figée sur
   * l'escalier, restait à 0 dans un bois monté à 1 — sa frange de marais perchée). Les lieux
   * BÂTIS et le monument (le Cercle, 24 × 24) restent des assises : un bâti ne se coupe pas
   * d'une falaise. (L'alternative — garder les couronnes en assise et laisser l'eau suivre —
   * revenait à la côte, l'eau perchée qu'on est venu tuer ; consigné le 2026-09-05.)
   */
  KINDS_SANS_ASSISE: ['bois_noir', 'combe_brumeuse'] as readonly string[],
} as const

/** Une rampe de terrasse : une COLONNE de connecteur, tuile du palier `de` sous une tuile du
 *  palier `vers = de + 1`. Trois colonnes voisines font une rampe (`CREUX.RAMPE_LARGEUR`). */
export interface RampeDeTerrasse {
  x: number
  y: number
  de: number
  vers: number
}

export interface Terrasses {
  /** Le palier de chaque tuile, `0..PALIERS−1`. */
  palier: Int8Array
  /** Les colonnes de rampe, dans l'ordre de leur élection. */
  rampes: RampeDeTerrasse[]
  /** Combien de tours le point fixe a pris — un diagnostic (la borne est `TERRASSES.TOURS`). */
  tours: number
}

const VOISINS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** L'index de la cellule du socle sous la tuile (x, y) — bornée à la grille. */
function celluleDe(socle: Socle, x: number, y: number): number {
  const M = CREUX.MOTIF
  const kx = Math.min(socle.cols - 1, Math.max(0, Math.floor(x / M) - socle.mx0))
  const ky = Math.min(socle.rows - 1, Math.max(0, Math.floor(y / M) - socle.my0))
  return ky * socle.cols + kx
}

/**
 * ═══ 1. QUANTIFIER — le palier d'une CELLULE de motif (8×8, rectiligne par construction) ═══
 *
 * Les terciles se prennent sur les cellules qui portent du MARCHABLE (échantillon : une tuile
 * sur deux) : l'eau et la roche ne pèsent pas dans le partage, sans quoi les lacs — au fond
 * par construction — tireraient tout le palier 0 sous l'eau. Mesuré (graine 2026) :
 * 33 / 33 / 34 % du marchable par palier.
 *
 * Rendu PAR CELLULE parce que c'est ce que lit le tracé des sentes (`SENTES.COUT_PALIER`) —
 * les routes cherchent le col AVANT que les rampes ne soient élues, et c'est sur ce même champ
 * que `poserLesTerrasses` démarre : un seul fait, deux lecteurs.
 */
export function quantifierLesPaliers(
  socle: Socle,
  terrain: readonly number[],
  width: number,
  height: number,
  paliers: number = TERRASSES.PALIERS,
): Int8Array {
  const vals: number[] = []
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (MARCHABLE[terrain[y * width + x]!] !== 1) continue
      vals.push(socle.altLarge[celluleDe(socle, x, y)]!)
    }
  }
  vals.sort((a, b) => a - b)
  const seuils: number[] = []
  for (let k = 1; k < paliers; k++) seuils.push(vals.length > 0 ? vals[Math.floor((k / paliers) * (vals.length - 1))]! : Infinity)
  const out = new Int8Array(socle.cols * socle.rows)
  for (let k = 0; k < out.length; k++) {
    const a = socle.altLarge[k]!
    let p = 0
    while (p < seuils.length && a >= seuils[p]!) p++
    out[k] = p
  }
  return out
}

/**
 * ═══ 1b. L'ESCALIER (N3, décision du 2026-09-05) — les paliers AVANT l'eau ═══
 *
 * Même partage que `quantifierLesPaliers` (terciles, échantillon marchable), sur un champ qui
 * diffère en un seul point : `altLarge` REMPLIE (priority-flood depuis le bord du pays, comme
 * l'hydrologie remplit `alt`), pas `altLarge` nue. Une cuvette de la grande ondulation est
 * ainsi relevée à son col avant qu'on ne la coupe — d'où LA propriété dont tout le reste
 * découle : de toute cellule part vers le bord un chemin de valeur non croissante, donc de
 * PALIER NON CROISSANT. Aucune terrasse n'est close par des terrasses plus hautes : l'eau qui
 * y tombe a toujours une sortie sans monter. C'est ce qui permet à l'hydrologie de naître SUR
 * l'escalier (`alt + palier · H`) sans jamais faire un lac qui chevauche deux paliers.
 *
 * Ce que ça change par rapport aux terciles nus (l'alternative, consignée) : rien hors des
 * cuvettes closes de `altLarge` — là, les terciles nus donnaient un palier bas ENFERMÉ dans du
 * haut, et l'eau qui y naissait devenait un méga-lac au col, chevauchant les paliers.
 *
 * Rend le palier par CELLULE (ce que lisent les sentes) et par TUILE (ce que l'hydrologie
 * complète pour l'eau qu'elle pose, puis ce dont `poserLesTerrasses` part).
 */
export function quantifierLEscalier(
  socle: Socle,
  terrain: readonly number[],
  width: number,
  height: number,
  paliers: number = TERRASSES.PALIERS,
): Escalier {
  const M = CREUX.MOTIF
  const { cols, rows } = socle
  const n = cols * rows
  // Le pays et son bord : la définition de `tracerLHydrologie`, à l'identique.
  const dansLePays = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    if (socle.dedans[k] !== 1) continue
    const kx = k % cols
    const x = (socle.mx0 + kx) * M + M / 2
    const y = (socle.my0 + (k - kx) / cols) * M + M / 2
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    dansLePays[k] = 1
  }
  const rempli = new Float64Array(n)
  const ferme = new Uint8Array(n)
  const tas = new TasPF(n)
  for (let k = 0; k < n; k++) rempli[k] = socle.altLarge[k]!
  for (let k = 0; k < n; k++) {
    if (dansLePays[k] !== 1) continue
    const kx = k % cols
    const ky = (k - kx) / cols
    let base = false
    for (let dy = -1; dy <= 1 && !base; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const vx = kx + dx
        const vy = ky + dy
        if (vx < 0 || vy < 0 || vx >= cols || vy >= rows || dansLePays[vy * cols + vx] !== 1) { base = true; break }
      }
    }
    if (!base) continue
    ferme[k] = 1
    tas.pousse(rempli[k]!, k)
  }
  // ⚠ SANS L'EPSILON de l'hydrologie. Elle en met un (`filled[k] + ε`) pour que chaque cellule
  // d'une cuvette ait un exutoire strict ; ici il ferait le contraire de ce qu'on veut : une
  // cuvette remplie devient un PLAT — toutes ses cellules au col, à la même valeur — et un
  // tercile qui tombe DANS ce plat (grand lac : des dizaines de cellules à col + k·ε) coupait le
  // lac en deux paliers, d'où des îles de 8 × 8 à un cran au-dessus de leur lac (MESURÉ graine
  // 7 : 4 972 tuiles de terre hors d'atteinte, T-A2). Un plat entier tombe du même côté.
  while (tas.taille > 0) {
    const k = tas.tire()
    const kx = k % cols
    const ky = (k - kx) / cols
    const fk = rempli[k]!
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const vx = kx + dx
        const vy = ky + dy
        if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue
        const v = vy * cols + vx
        if (ferme[v] === 1 || dansLePays[v] !== 1) continue
        ferme[v] = 1
        rempli[v] = socle.altLarge[v]! > fk ? socle.altLarge[v]! : fk
        tas.pousse(rempli[v]!, v)
      }
    }
  }
  const vals: number[] = []
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (MARCHABLE[terrain[y * width + x]!] !== 1) continue
      vals.push(rempli[celluleDe(socle, x, y)]!)
    }
  }
  vals.sort((a, b) => a - b)
  const seuils: number[] = []
  for (let k = 1; k < paliers; k++) seuils.push(vals.length > 0 ? vals[Math.floor((k / paliers) * (vals.length - 1))]! : Infinity)
  const cellules = new Int8Array(n)
  for (let k = 0; k < n; k++) {
    const a = rempli[k]!
    let p = 0
    while (p < seuils.length && a >= seuils[p]!) p++
    cellules[k] = p
  }
  const palierTuile = new Int8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) palierTuile[y * width + x] = cellules[celluleDe(socle, x, y)]!
  }
  return { cellules, palierTuile }
}

/**
 * LE SURCOÛT D'UN PAS DE SENTE ENTRE DEUX CELLULES DE PALIERS DIFFÉRENTS — sauf en montant vers
 * le NORD (ou en descendant vers le sud : la même arête), là où une rampe peut exister. Une
 * route réelle cherche le col ; celle-ci cherche l'endroit où l'on monte de face.
 */
export function franchitUnPalier(cellules: Int8Array, cols: number, de: number, v: number): boolean {
  const pd = cellules[de]!
  const pv = cellules[v]!
  if (pd === pv) return false
  if (v === de - cols && pv === pd + 1) return false // vers le nord, un cran plus haut
  if (v === de + cols && pv === pd - 1) return false // vers le sud, un cran plus bas
  return true
}

/**
 * ═══ LA PASSE — quantifier, nappes, assises, ±1, miettes, rampes, garantir ═══
 *
 * `assises` : des paquets de tuiles qui doivent tenir sur UN palier (set-pieces, lieux, mesas).
 * `lacs` : les tuiles que les passes d'eau ont inondées EN NAPPE (`map.lacs`) — l'eau plate,
 * qui prend UN palier ; toute autre eau COULE et garde le palier de son sol, en cascades.
 * L'eau qui COULE (toute eau hors `lacs`) est plate en travers de son lit et ne descend qu'en
 * cascades le long de lui (§2b, les côtes) — rien à passer, elle se lit dans `terrain`.
 * `reservees` : des tuiles où aucune rampe de terrasse ne peut se poser (les portes des mesas).
 *
 * ⚠ LA NAPPE EST UNE DONNÉE, PAS UNE LECTURE DU TERRAIN. La passe a d'abord deviné la rivière
 * à la tuile — une bande à `PECHE_RAYON_RIVIERE` du fil, la définition de la pêche — et deviné
 * faux deux fois, dans les deux sens. ① Un fil ne s'arrête pas au lac qu'il rejoint, il le
 * TRAVERSE : sa bande découpait dans le grand lac un ruban « rivière » au palier de son sol
 * (graine 2026 : un coin de 13 × 12 tuiles d'eau profonde à 2 dans un lac à 1, une digue de
 * parois en diagonale à 30 tuiles de toute rive). Retirer « l'eau libre » (sans terre à R + 1)
 * de la bande laissait encore un SEUIL de sept tuiles flottant devant chaque embouchure — et
 * ② prenait pour un lac le milieu de tout fleuve large (sans terre à R + 1 non plus) : 43
 * « lacs » sous les fils de la graine 2026 pour une poignée de vraies cuvettes, chacun nivelé
 * au plus bas de son tronçon, donc une digue en travers du fleuve à chaque montée du sol. Rien
 * à la tuile ne sépare une eau large d'une eau plate ; seule la passe qui a INONDÉ le sait.
 * MESURÉ (graine 2026, monde joué) : 2 610 contacts en pleine eau entre la bande et une nappe
 * avec la bande, 344 au mieux de ses variantes ; avec la donnée, la marche tombe à la rive.
 */
export function poserLesTerrasses(
  terrain: readonly number[],
  width: number,
  height: number,
  socle: Socle,
  cellules: Int8Array,
  lacs: readonly number[],
  assises: readonly (readonly number[])[],
  reservees: ReadonlySet<number> = new Set(),
  palierTuile: Int8Array | null = null,
): Terrasses {
  const N = width * height
  const palier = new Int8Array(N)
  // ═══ L'ESCALIER (N3, 2026-09-05) : L'EAU EST NÉE SUR LES TERRASSES, ELLE NE BOUGE PLUS ═══
  //
  // Quand `palierTuile` est là, l'hydrologie a déjà posé chaque eau sur SON palier — le lac
  // sur celui de sa cuvette, le cours sur celui de sa cellule et jamais au-dessus de la terre
  // qu'il touche. Alors la passe ne DEVINE plus le palier de l'eau (ni `niveler`, ni les
  // côtes, ni les orphelins d'eau) : l'eau est FIGÉE, et la seule règle qui la concerne est
  // qu'aucune passe ne rabaisse une terre SOUS l'eau qu'elle borde — l'eau perchée, c'est
  // exactement le défaut qu'on est venu tuer. Ce qui peut encore bouger l'eau : ±1 et les
  // descentes de terre, qui ABAISSENT l'eau courante voisine avec la terre (une cascade se
  // déplace) — jamais l'eau d'un lac, jamais vers le haut.
  const escalier = palierTuile !== null
  if (palierTuile !== null) palier.set(palierTuile)
  else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) palier[y * width + x] = cellules[celluleDe(socle, x, y)]!
    }
  }
  const marchable = (i: number): boolean => MARCHABLE[terrain[i]!] === 1
  const eau = (i: number): boolean => isWater(terrain[i]!)

  // ── LE CONTINENT — seule la terre qu'on peut ATTEINDRE À PLAT a voix au chapitre ──────────
  //
  // Une île vraie (de la terre que l'eau profonde ou la roche coupe de tout, avant même les
  // terrasses) n'a rien à décider : personne n'y marche. Or elle VOTAIT — sa cellule pesait
  // dans le niveau du lac qui l'entoure et dans celui des côtes qui la longent. MESURÉ graine
  // 2026 : un îlot de roche à 0 dans le grand lac tenait le lac à 0 et l'embouchure du fleuve à
  // 0 pendant que la presqu'île de 988 tuiles qu'il bordait montait à 1 rejoindre le continent —
  // stranded entre deux eaux qu'elle n'avait plus le droit de traverser. Alors : la terre hors
  // du continent ne vote pas, et elle SUIT l'eau qui la borde (`suivreLEau`) — un îlot est au
  // niveau de son lac, jamais un puits dans l'eau ni une butte que rien ne rejoint.
  const continent = new Uint8Array(N)
  {
    const vu = new Uint8Array(N)
    const file: number[] = []
    let meilleure: number[] = []
    for (let dep = 0; dep < N; dep++) {
      if (vu[dep] === 1 || !marchable(dep)) continue
      file.length = 0
      file.push(dep)
      vu[dep] = 1
      for (let h = 0; h < file.length; h++) {
        const i = file[h]!
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (vu[j] === 1 || !marchable(j)) continue
          vu[j] = 1
          file.push(j)
        }
      }
      if (file.length > meilleure.length) meilleure = file.slice()
    }
    for (const i of meilleure) continent[i] = 1
  }
  /** De la terre qui VOTE : marchable, hors d'eau, sur le continent. */
  const vote = (i: number): boolean => marchable(i) && !eau(i) && continent[i] === 1

  // ── LES BLOCS — ce qui ne se fend jamais : une nappe, une assise ──────────────────────────
  //
  // Quand une tuile d'un bloc doit changer de palier (rabaisser, miette, garantie), tout le bloc
  // change avec elle : un lac n'a qu'un niveau, un lieu ne se coupe pas d'une falaise. Une tuile
  // n'appartient qu'à un bloc — le dernier enregistré gagne, et c'est sans conséquence : deux
  // blocs qui se recouvrent finissent au même palier par transitivité, une tuile à la fois.
  const blocDe = new Int32Array(N).fill(-1)
  const tuilesDuBloc: number[][] = []
  /** 1 si le bloc est de l'EAU FIGÉE — l'eau d'un lac (sans sa rive) ou la côte d'un fleuve :
   *  ni miette ni garantie ne la déplacent, seuls `niveler`/`aplanir` et le ±1 en bloc. */
  const blocEstNappe: number[] = []
  const enregistrerLeBloc = (tuiles: readonly number[], nappe = false): number => {
    const id = tuilesDuBloc.length
    tuilesDuBloc.push(tuiles.slice())
    blocEstNappe.push(nappe ? 1 : 0)
    for (const i of tuiles) blocDe[i] = id
    return id
  }
  /** Cette tuile est-elle de l'eau figée — lac ou côte de fleuve — au moment où on regarde ? */
  const deLaNappe = (i: number): boolean => {
    const b = blocDe[i]!
    return b >= 0 && blocEstNappe[b] === 1
  }
  /** L'eau qu'aucune miette ni garantie ne déplace : sur l'escalier, TOUTE l'eau ; sinon la nappe. */
  const figee = (i: number): boolean => (escalier ? eau(i) : deLaNappe(i))
  /** Le palier du lac que borde cette tuile (le plus haut), −1 si elle n'en borde aucun. */
  const plancherLac = (i: number): number => {
    let haut = -1
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of VOISINS4) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (deLaNappe(j) && palier[j]! > haut) haut = palier[j]!
    }
    return haut
  }
  /** Une terre descend à `q` : l'eau COURANTE qu'elle borde, si plus haute, descend avec elle
   *  (une cascade se déplace ; l'eau ne reste jamais au-dessus de sa rive). Escalier seulement. */
  const abaisserLEauVoisine = (i: number, q: number): void => {
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of VOISINS4) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (eau(j) && !deLaNappe(j) && palier[j]! > q) palier[j] = q
    }
  }
  /** La plus basse eau (nappe ou courante) que borde la tuile, −1 s'il n'y en a pas. Une terre
   *  ne monte jamais au-dessus : c'est L'INVARIANT de l'escalier (aucune eau ne domine une terre
   *  qu'elle touche — et réciproquement, une terre qui monte au-dessus de son eau la perche). */
  const eauVoisineLaPlusBasse = (i: number): number => {
    let bas = -1
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of VOISINS4) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (eau(j) && (bas < 0 || palier[j]! < bas)) bas = palier[j]!
    }
    return bas
  }
  /** Pose un palier sur une tuile — et sur tout son bloc, si elle en a un. Rend `true` si
   *  quelque chose a bougé. Sur l'escalier : l'eau d'un lac ne bouge pas, une terre ne descend
   *  jamais sous le lac qu'elle borde (tout le bloc reste alors), et l'eau courante suit la
   *  terre qui descend. */
  const poser = (i: number, p: number): boolean => {
    const b = blocDe[i]!
    const tuiles: readonly number[] = b < 0 ? [i] : tuilesDuBloc[b]!
    if (escalier) {
      for (const j of tuiles) if (!eau(j) && palier[j]! > p && plancherLac(j) > p) return false
    }
    let bouge = false
    for (const j of tuiles) {
      if (escalier && deLaNappe(j)) continue
      if (palier[j] === p) continue
      const descend = palier[j]! > p
      palier[j] = p
      bouge = true
      if (escalier && descend && !eau(j)) abaisserLEauVoisine(j, p)
    }
    return bouge
  }

  // ── 2. LES NAPPES — une eau de LAC connexe prend UN palier, le plus bas ──────────────────
  // Le lac est celui que les passes d'eau ont inondé (`lacs`, voir l'en-tête) — et RIEN d'autre
  // : un fleuve, un chenal, une résurgence gardent le palier de leur sol et descendent en
  // cascades. Une tuile de lac qui n'est plus de l'eau (isthme comblé, seuil rouvert) n'entre
  // dans aucune nappe : `eau()` a le dernier mot. Ce que la bande d'avant appelait `riviere`
  // est ici « l'eau qui n'est pas du lac » — la terre reste à 0 : c'est elle qui fait la RIVE.
  const riviere = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (eau(i)) riviere[i] = 1
  for (const i of lacs) if (i >= 0 && i < N) riviere[i] = 0
  // UNE NAPPE, C'EST L'EAU — profond et haut-fonds — ET ELLE NE SE FEND JAMAIS : ni la miette ni
  // la garantie n'en détachent une tuile (`fondre` les laisse, `garantir` passe son chemin). Sa
  // RIVE — la tuile marchable au contact, hors rivière — VOTE (le lac se tient au niveau de sa
  // rive la plus basse) mais n'est pas du bloc : la rive haute tombe à pic dans l'eau, et c'est
  // le bon dessin — la falaise au bord du lac, le pied dans l'eau. Ce que ça coûte, et qu'on
  // ACCEPTE (2026-09-03) : la ceinture de haut-fond sous une rive haute, quand aucune rampe ne
  // la rejoint (flanc est/ouest, rive sud), ne se marche plus — c'est du lac. L'autre option
  // était de la remonter au palier de la rive (la garantie le faisait) : la paroi passait alors
  // UNE TUILE AU LARGE, en pleine eau, tout autour des lacs — 1 492 haut-fonds versants sur la
  // graine 2026 (4 %), 1 830 sur la 4242 ; et la rive dans le bloc (l'écriture d'avant) ne
  // faisait que déplacer le problème d'une tuile vers la terre.
  const nappes: { eau: number[]; rive: number[]; bloc: number }[] = []
  {
    const vu = new Uint8Array(N)
    const file: number[] = []
    const rive: number[] = []
    for (let dep = 0; dep < N; dep++) {
      if (vu[dep] === 1 || !eau(dep) || riviere[dep] === 1) continue
      file.length = 0
      rive.length = 0
      file.push(dep)
      vu[dep] = 1
      for (let h = 0; h < file.length; h++) {
        const i = file[h]!
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (vu[j] === 1 || riviere[j] === 1) continue
          if (!eau(j)) {
            // La rive VOTE si elle est du continent ; un îlot enclos dans l'eau suit le lac (voir
            // `continent`).
            if (marchable(j)) { vu[j] = 1; if (continent[j] === 1) rive.push(j) }
            continue
          }
          vu[j] = 1
          file.push(j)
        }
      }
      // Une rive marquée `vu` ne l'est que pour SA nappe : deux lacs séparés d'une tuile la
      // partagent, et le bloc de la seconde l'emporte (transitivité, voir les blocs).
      for (const j of rive) vu[j] = 0
      // La nappe reste UN BLOC pour la suite (voir les assises) : elle ne se fend jamais.
      nappes.push({ eau: file.slice(), rive: rive.slice(), bloc: enregistrerLeBloc(file, true) })
    }
  }
  /**
   * NIVELER — chaque nappe au PLUS BAS DE SES RIVES, et de ses rives seulement : un lac se tient
   * au niveau de sa rive la plus basse, la rive haute tombe à pic dedans (la falaise au bord du
   * lac). Ses propres tuiles ne votent pas : le socle sous un lac est une CUVETTE, toujours plus
   * bas que son bord — lu au socle, un lac cerné de rives à 1 tombait à 0, et sa ceinture de
   * haut-fond (marchable, à 0, coupée de tout) remontait à 1 par miette : un lac dont le bord
   * d'eau tenait un palier au-dessus de son milieu (12 nappes sur la graine 2026, le grand lac
   * compris). Sans rive marchable (une eau enclose dans la roche), ses tuiles décident.
   *
   * ⚠ ET ON NIVELLE À CHAQUE TOUR, pas une fois : les rives bougent pour leurs raisons (une
   * poche fondue par la garantie, une miette, ±1 qui rabaisse une rive à pic de deux crans), et
   * le lac SUIT sa rive la plus basse. Toute rive vote, quel que soit son bloc (celle d'un lieu
   * vote pour son lieu) ; seule l'eau de la nappe bouge. Rend le nombre de nappes déplacées.
   */
  const niveler = (): number => {
    if (escalier) return 0 // le lac est né sur son palier (voir l'en-tête) : rien à deviner
    let n = 0
    for (const { eau: tuiles, rive, bloc } of nappes) {
      let bas: number = TERRASSES.PALIERS
      let basDesTuiles: number = TERRASSES.PALIERS
      for (const i of rive) if (palier[i]! < bas) bas = palier[i]!
      for (const i of tuiles) if (blocDe[i] === bloc && palier[i]! < basDesTuiles) basDesTuiles = palier[i]!
      // SANS RIVE (une eau close dans la roche, ou que seule une rivière touche) : la nappe suit
      // ce qui la borde encore — le marchable au contact, le plus bas — et sinon ses tuiles.
      if (bas >= TERRASSES.PALIERS) {
        for (const i of tuiles) {
          if (blocDe[i] !== bloc) continue
          const x = i % width
          const y = (i - x) / width
          for (const [dx, dy] of VOISINS4) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const j = ny * width + nx
            if (blocDe[j] !== bloc && marchable(j) && palier[j]! < bas) bas = palier[j]!
          }
        }
      }
      if (bas >= TERRASSES.PALIERS) bas = basDesTuiles
      if (bas >= TERRASSES.PALIERS) continue
      let bouge = false
      for (const i of tuilesDuBloc[bloc]!) if (blocDe[i] === bloc && palier[i] !== bas) { palier[i] = bas; bouge = true }
      if (bouge) n++
    }
    return n
  }
  niveler()

  // ── 2b. LES FLEUVES — l'eau qui coule est plate EN TRAVERS, elle ne descend qu'en long ──
  //
  // Un fleuve suivait ses berges (les orphelins, §3b) : le profond prenait le palier de la rive
  // la plus proche, et quand les deux rives ne s'accordaient pas, le fleuve se FENDAIT dans sa
  // longueur — la moitié ouest à 0, la moitié est à 1, une marche en pleine eau tout le long du
  // courant (graine 4242 : 4 229 tuiles d'eau libre en désaccord, la 909 : 175, la 2026 : 137).
  // Or la surface d'une eau qui coule est de niveau d'une rive à l'autre ; ce qu'elle fait,
  // c'est DESCENDRE le long de son cours. D'où les CÔTES : des FRONTS de distance à
  // l'embouchure. Chaque corps d'eau courante se parcourt depuis ce qui le termine — son contact
  // avec un lac, ou le bord du monde — en distance octile entière (5 tout droit, 7 en diagonale :
  // des fronts ronds, donc EN TRAVERS du lit quelle que soit son orientation ; en distance de
  // Manhattan, un lit droit gardait des fronts à 45° après chaque coude), et une côte est une
  // composante connexe d'un même front (cinq unités = une tuile). Une côte prend UN palier, le
  // plus bas de ce qu'elle touche hors de l'eau courante : la terre marchable de ses deux rives,
  // ou l'eau d'un lac qu'elle rejoint. Sans contact (un front en plein milieu d'un fleuve large),
  // elle suit sa côte d'aval — celle par laquelle on l'a atteinte. Un corps qui ne touche ni lac
  // ni bord (une mare de zone) part de sa première tuile : ce qui compte, c'est que ses fronts
  // soient en travers, pas d'où ils partent. Une côte est un BLOC d'eau figée : ±1 la déplace
  // entière, rien d'autre ne la touche — et `aplanir` la repose à chaque tour, comme `niveler`.
  //
  // ⚠ PAS « la tuile de fil la plus proche ». C'était la première forme : toute l'eau d'un
  // AFFLUENT (sans fil à lui) se rattachait à l'unique tuile du fleuve où il se jette — un
  // affluent entier en UNE côte, nivelée à sa rive la plus basse : une gorge sur tout son cours
  // (graine 2026 : deux côtes de 1 435 et 1 448 tuiles, la 4242 : 539). Et 40 % de l'eau profonde
  // (les cours qui finissent dans un lac, sans exutoire) n'a pas de fil du tout.
  // CE QUE ÇA NE FAIT PAS, exprès : forcer l'eau à ne jamais REMONTER le long de son cours (le
  // fleuve monte autant qu'il descend, 57 montées pour 63 descentes sur la 2026 — le lit est
  // tracé sur le creux, les paliers sur `altLarge`) — une décision de paysage, pas de passe :
  // des gorges sur tout l'aval de chaque fleuve.
  const cotes: number[][] = []
  const coteDe = new Int32Array(N).fill(-1)
  /** La côte d'AVAL de chaque côte (−1 pour celle de l'embouchure) : le repli sans contact. */
  const coteAval: number[] = []
  const blocDeCote: number[] = []
  // SUR L'ESCALIER, PAS DE CÔTES : l'eau courante tient déjà le palier que l'hydrologie lui a
  // donné le long de son cours (non croissant par construction) ; deviner ses fronts ne
  // ferait que le défaire.
  if (!escalier) {
    const DROIT = 5
    const DIAG = 7
    const dist = new Int32Array(N).fill(-1)
    const parent = new Int32Array(N).fill(-1)
    const courante = (i: number): boolean => riviere[i] === 1
    // Dial : des seaux par distance, un par unité — la file est FIFO dans chaque seau, l'ordre
    // ne dépend que de l'ordre d'insertion. Les seaux tournent sur DIAG + 1 rangs.
    const seaux: number[][] = []
    for (let k = 0; k <= DIAG; k++) seaux.push([])
    const parcourir = (graines: readonly number[]): void => {
      for (const i of graines) { dist[i] = 0; seaux[0]!.push(i) }
      let d = 0
      let restants = graines.length
      while (restants > 0) {
        const seau = seaux[d % (DIAG + 1)]!
        for (let h = 0; h < seau.length; h++) {
          const i = seau[h]!
          restants--
          if (dist[i] !== d) continue // déjà atteint de plus près
          const x = i % width
          const y = (i - x) / width
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              const j = ny * width + nx
              if (!courante(j)) continue
              const nd = d + (dx !== 0 && dy !== 0 ? DIAG : DROIT)
              if (dist[j]! >= 0 && dist[j]! <= nd) continue
              dist[j] = nd
              parent[j] = i
              seaux[nd % (DIAG + 1)]!.push(j)
              restants++
            }
          }
        }
        seau.length = 0
        d++
      }
    }
    // Les embouchures : l'eau courante au contact d'un lac, ou au bord du monde.
    const embouchures: number[] = []
    for (let i = 0; i < N; i++) {
      if (!courante(i)) continue
      const x = i % width
      const y = (i - x) / width
      let bout = x === 0 || y === 0 || x === width - 1 || y === height - 1
      for (const [dx, dy] of VOISINS4) {
        if (bout) break
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (deLaNappe(ny * width + nx)) bout = true
      }
      if (bout) embouchures.push(i)
    }
    parcourir(embouchures)
    for (let i = 0; i < N; i++) if (courante(i) && dist[i]! < 0) parcourir([i]) // les corps sans embouchure
    // Les côtes : composantes 8-CONNEXES d'un même front (dist ÷ DROIT). ⚠ Pas 4-connexes :
    // un front oblique (l'embouchure au coin du lit, graine 2026 en (944, 506)) est une chaîne
    // de diagonales — en 4-connexité elle se casse en bouts d'une ou deux tuiles, chacun collé à
    // SA rive, et le lit se fend en long comme avant (988 tuiles de plateau perdues, la 2026).
    const front = (i: number): number => Math.floor(dist[i]! / DROIT)
    const file: number[] = []
    for (let s = 0; s < N; s++) {
      if (!courante(s) || coteDe[s]! >= 0) continue
      const id = cotes.length
      const f = front(s)
      cotes.push([s])
      coteAval.push(-1)
      coteDe[s] = id
      file.length = 0
      file.push(s)
      for (let h = 0; h < file.length; h++) {
        const i = file[h]!
        const x = i % width
        const y = (i - x) / width
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const j = ny * width + nx
            if (coteDe[j]! >= 0 || !courante(j) || front(j) !== f) continue
            coteDe[j] = id
            cotes[id]!.push(j)
            file.push(j)
          }
        }
      }
    }
    // L'aval d'une côte : la côte du parent de n'importe laquelle de ses tuiles, hors elle-même.
    // Les parents sont plus près de l'embouchure, donc déjà en côte — sauf dans le même front.
    for (let id = 0; id < cotes.length; id++) {
      for (const i of cotes[id]!) {
        const p = parent[i]!
        if (p >= 0 && coteDe[p] !== id) { coteAval[id] = coteDe[p]!; break }
      }
    }
    for (const c of cotes) blocDeCote.push(enregistrerLeBloc(c, true))
  }
  // CE QUI DÉCIDE DU PALIER D'UNE CÔTE — ses VOTANTS : la terre du continent sur ses deux rives
  // et l'eau de lac qu'elle touche, hors de toute côte ; sans votant, son aval. Lu par `aplanir`
  // à chaque tour, et par la garantie, qui doit savoir si l'eau SUIVRA la terre qu'elle monte.
  // Terrain et blocs figés : calculé une fois.
  const voteursDuBloc: number[][] = tuilesDuBloc.map(() => [])
  const avalDuBloc = new Int32Array(tuilesDuBloc.length).fill(-1)
  for (const { rive, bloc } of nappes) voteursDuBloc[bloc] = rive
  for (let id = 0; id < cotes.length; id++) {
    const b = blocDeCote[id]!
    const v = voteursDuBloc[b]!
    const vu = new Set<number>()
    for (const i of cotes[id]!) {
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of VOISINS4) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (coteDe[j]! >= 0 || vu.has(j)) continue
        if (vote(j) || deLaNappe(j)) { vu.add(j); v.push(j) }
      }
    }
    if (coteAval[id]! >= 0) avalDuBloc[b] = blocDeCote[coteAval[id]!]!
  }
  /** Rend le nombre de côtes déplacées. De l'embouchure vers l'amont : l'aval est déjà posé. */
  const aplanir = (): number => {
    let n = 0
    for (let id = 0; id < cotes.length; id++) {
      const b = blocDeCote[id]!
      let bas: number = TERRASSES.PALIERS
      for (const j of voteursDuBloc[b]!) if (palier[j]! < bas) bas = palier[j]!
      if (bas >= TERRASSES.PALIERS) {
        const a = avalDuBloc[b]!
        if (a < 0) continue
        bas = palier[tuilesDuBloc[a]![0]!]!
      }
      let bouge = false
      for (const i of cotes[id]!) if (palier[i] !== bas) { palier[i] = bas; bouge = true }
      if (bouge) n++
    }
    return n
  }

  // ── 2c. LES ÎLOTS — la terre hors du continent SUIT l'eau qui la borde ─────────────────────
  // Pièce par pièce (4-connexe), au plus bas de l'eau figée au contact ; sans eau au contact (une
  // poche dans la roche), elle garde son palier — personne ne la voit de près. Une fois par tour,
  // après `niveler` et `aplanir`.
  const ilots: number[][] = []
  {
    const vu = new Uint8Array(N)
    for (let dep = 0; dep < N; dep++) {
      if (vu[dep] === 1 || !marchable(dep) || eau(dep) || continent[dep] === 1) continue
      const piece = [dep]
      vu[dep] = 1
      for (let h = 0; h < piece.length; h++) {
        const i = piece[h]!
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (vu[j] === 1 || !marchable(j) || eau(j) || continent[j] === 1) continue
          vu[j] = 1
          piece.push(j)
        }
      }
      ilots.push(piece)
    }
  }
  // Sur l'escalier, l'îlot suit l'eau LA PLUS HAUTE qu'il borde (toute eau, pas seulement la
  // nappe) : un banc entre deux marches d'une cascade ne peut pas être sous l'eau d'amont.
  const suivreLEau = (): number => {
    let n = 0
    for (const piece of ilots) {
      let bas: number = escalier ? -1 : TERRASSES.PALIERS
      for (const i of piece) {
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (escalier) { if (eau(j) && palier[j]! > bas) bas = palier[j]! }
          else if (deLaNappe(j) && palier[j]! < bas) bas = palier[j]!
        }
      }
      if (bas >= TERRASSES.PALIERS || bas < 0) continue
      let bouge = false
      for (const i of piece) if (palier[i] !== bas) { palier[i] = bas; bouge = true }
      if (bouge) n++
    }
    return n
  }

  // ── 3. LES ASSISES — un lieu ne se coupe pas d'une falaise ────────────────────────────────
  //
  // Chaque assise prend son palier MAJORITAIRE (à égalité, le plus bas) sur ses tuiles hors
  // eau — l'eau appartient à sa nappe. Et l'assise reste UN BLOC pour toute la suite : quand
  // une de ses tuiles doit bouger (rabaisser, miette, garantie), tout le bloc bouge avec elle.
  for (const a of assises) {
    const votes = new Array<number>(TERRASSES.PALIERS).fill(0)
    const tuiles: number[] = []
    for (const i of a) {
      if (i < 0 || i >= N || eau(i)) continue
      tuiles.push(i)
      votes[palier[i]!]! += 1
    }
    if (tuiles.length === 0) continue
    let cible = 0
    for (let p = 1; p < votes.length; p++) if (votes[p]! > votes[cible]!) cible = p
    // SUR L'ESCALIER, UN LIEU N'EST JAMAIS SOUS SON EAU : l'eau de son emprise et celle que sa
    // terre borde tiennent leur palier (figées) ; s'il en est plus haute que la majorité, le
    // lieu monte à elle — une mare dans un creux du lieu est permise, un lieu au fond de son
    // étang ne l'est pas. (L'alternative — le lieu suit son eau la plus basse — perchait
    // l'autre eau ; consigné.)
    if (escalier) {
      for (const i of a) if (i >= 0 && i < N && eau(i) && palier[i]! > cible) cible = palier[i]!
      for (const i of tuiles) {
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (eau(j) && palier[j]! > cible) cible = palier[j]!
        }
      }
    }
    for (const i of tuiles) palier[i] = cible
    enregistrerLeBloc(tuiles)
  }

  // ── 3b. LES ORPHELINS — ce qui n'est ni marchable ni d'un bloc n'a pas de palier à soi ────
  //
  // Le profond d'une rivière, la roche d'un massif, le mur : personne n'y marche, aucun bloc ne
  // les tient, et les passes qui suivent (miettes, garantie) déplacent des COMPOSANTES MARCHABLES
  // — elles ne les voient pas. Laissés au palier de leur cellule, ils restaient derrière : le
  // cœur profond d'un fleuve un cran sous ses haut-fonds quand la garantie avait remonté la
  // vallée, et le client dressait une paroi EN PLEINE EAU le long du courant (233 tuiles
  // profondes hors lac en désaccord avec toutes leurs voisines marchables, 1 208 de roche, graine
  // 2026). La règle : un orphelin SUIT SES BERGES — il prend le palier de la tuile marchable (ou
  // du bloc) la plus proche, et à distance égale la plus BASSE (l'eau se tient au bas de ses
  // rives ; ±1 relève ensuite ce qui dépasse). L'ordre de parcours — largeur d'abord depuis tout
  // le marchable et les blocs, puis chaque couche lit la précédente — ne dépend que du terrain :
  // calculé une fois, rejoué à chaque tour du point fixe, aucun tirage.
  const { orphelins, bergesDe } = ((): { orphelins: number[]; bergesDe: Int32Array } => {
    const orphelins: number[] = []
    const dist = new Int32Array(N).fill(-1)
    const file: number[] = []
    for (let i = 0; i < N; i++) if (marchable(i) || blocDe[i]! >= 0) { dist[i] = 0; file.push(i) }
    for (let h = 0; h < file.length; h++) {
      const i = file[h]!
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of VOISINS4) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (dist[j] !== -1) continue
        dist[j] = dist[i]! + 1
        file.push(j)
        orphelins.push(j)
      }
    }
    // Chaque orphelin retient ses berges : les voisines de la couche d'avant (dist − 1).
    const bergesDe = new Int32Array(orphelins.length * 4).fill(-1)
    for (let o = 0; o < orphelins.length; o++) {
      const i = orphelins[o]!
      const x = i % width
      const y = (i - x) / width
      let k = 0
      for (const [dx, dy] of VOISINS4) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (dist[j] === dist[i]! - 1) bergesDe[o * 4 + k++] = j
      }
    }
    return { orphelins, bergesDe }
  })()
  /** Rend le nombre d'orphelins déplacés. Dans l'ordre des couches : une couche lit la précédente. */
  const assujettir = (): number => {
    let n = 0
    for (let o = 0; o < orphelins.length; o++) {
      let bas: number = TERRASSES.PALIERS
      for (let k = 0; k < 4; k++) {
        const j = bergesDe[o * 4 + k]!
        if (j >= 0 && palier[j]! < bas) bas = palier[j]!
      }
      const i = orphelins[o]!
      if (escalier && eau(i)) continue // l'eau profonde est née sur son palier, elle y reste
      if (bas < TERRASSES.PALIERS && palier[i] !== bas) { palier[i] = bas; n++ }
    }
    return n
  }

  // ── 4. ±1 (T-R5) : on RABAISSE le haut au contact d'un bas trop bas, jusqu'au point fixe ──
  const rabaisser = (): number => {
    let total = 0
    for (let tour = 0; tour < 4 * TERRASSES.PALIERS; tour++) {
      let n = 0
      for (let i = 0; i < N; i++) {
        const p = palier[i]!
        if (p < 2) continue
        const x = i % width
        const y = (i - x) / width
        let bas = p
        if (x > 0 && palier[i - 1]! < bas) bas = palier[i - 1]!
        if (x + 1 < width && palier[i + 1]! < bas) bas = palier[i + 1]!
        if (y > 0 && palier[i - width]! < bas) bas = palier[i - width]!
        if (y + 1 < height && palier[i + width]! < bas) bas = palier[i + width]!
        if (p - bas < 2) continue
        // ON CREUSE UNE MARCHE LARGE, pas un trait : rabaisser la seule tuile de contact laissait
        // une bande d'UNE tuile au palier intermédiaire, où aucune rampe ne tient (la rampe veut
        // deux rangées du haut, `colonneMonte`) — 1 193 composantes perdues sur la graine 2026,
        // presque toutes des traits. `MARCHE` tuiles autour du contact descendent avec elle.
        for (let dy = -TERRASSES.MARCHE; dy <= TERRASSES.MARCHE; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -TERRASSES.MARCHE; dx <= TERRASSES.MARCHE; dx++) {
            const nx = x + dx
            if (nx < 0 || nx >= width) continue
            const j = ny * width + nx
            if (palier[j]! > bas + 1 && poser(j, bas + 1)) n++
          }
        }
      }
      total += n
      if (n === 0) break
    }
    return total
  }

  // ── Les composantes : 4-connexes, marchables, de même palier — en CSR, pour les parcourir
  //    par identifiant sans rebalayer la carte à chaque miette. ──
  const comp = new Int32Array(N)
  let nComp = 0
  let taille: Int32Array = new Int32Array(0)
  let palierDe: Int8Array = new Int8Array(0)
  /** 1 si la composante N'EST QUE de l'eau de nappe (une ceinture de lac) : rien ne la déplace. */
  let deNappe: Uint8Array = new Uint8Array(0)
  let debut: Int32Array = new Int32Array(0)
  let membres: Int32Array = new Int32Array(0)
  const etiqueter = (): void => {
    comp.fill(-1)
    const tailles: number[] = []
    const pals: number[] = []
    const pures: number[] = []
    const file: number[] = []
    for (let dep = 0; dep < N; dep++) {
      if (comp[dep] !== -1 || !marchable(dep)) continue
      const id = tailles.length
      const p = palier[dep]!
      let pure = 1
      file.length = 0
      file.push(dep)
      comp[dep] = id
      for (let h = 0; h < file.length; h++) {
        const i = file[h]!
        if (!figee(i)) pure = 0
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (comp[j] !== -1 || !marchable(j) || palier[j] !== p) continue
          comp[j] = id
          file.push(j)
        }
      }
      tailles.push(file.length)
      pals.push(p)
      pures.push(pure)
    }
    nComp = tailles.length
    taille = Int32Array.from(tailles)
    palierDe = Int8Array.from(pals)
    deNappe = Uint8Array.from(pures)
    debut = new Int32Array(nComp + 1)
    for (let id = 0; id < nComp; id++) debut[id + 1] = debut[id]! + taille[id]!
    membres = new Int32Array(debut[nComp]!)
    const curseur = debut.slice(0, nComp)
    for (let i = 0; i < N; i++) {
      const id = comp[i]!
      if (id < 0) continue
      membres[curseur[id]!] = i
      curseur[id]! += 1
    }
  }
  /** Le palier voisin majoritaire d'une composante (à égalité, le plus bas) — −1 sans voisin. */
  const palierVoisinMajoritaire = (id: number, seulement?: (voisin: number) => boolean): number => {
    const votes = new Array<number>(TERRASSES.PALIERS).fill(0)
    let total = 0
    for (let m = debut[id]!; m < debut[id + 1]!; m++) {
      const i = membres[m]!
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of VOISINS4) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const v = comp[ny * width + nx]!
        if (v < 0 || v === id) continue
        if (seulement !== undefined && !seulement(v)) continue
        votes[palierDe[v]!]! += 1
        total++
      }
    }
    if (total === 0) return -1
    // COMPATIBLE AVEC TOUTES SES VOISINES (±1, T-R5) : une miette à 1 entre du 0 et du 2 ne se
    // fond dans aucun des deux — fondue à 2, `rabaisser` la ramenait à 1 le tour d'après, et
    // ainsi de suite jusqu'à la borne. Elle est la marche entre les deux : elle reste.
    let cible = -1
    for (let p = 0; p < votes.length; p++) {
      if (votes[p] === 0) continue
      let compatible = true
      for (let q = 0; q < votes.length; q++) if (votes[q]! > 0 && Math.abs(q - p) > 1) compatible = false
      if (compatible && (cible < 0 || votes[p]! > votes[cible]!)) cible = p
    }
    return cible
  }
  /** Fond toute une composante dans un palier — assises comprises, eau de nappe exceptée. */
  // ⚠ FONDRE DÉTACHE : une composante fondue quitte son bloc, elle n'entraîne pas le bloc avec
  // elle. Sinon la part d'une assise que la roche isole faisait basculer le lieu entier à chaque
  // tour, jusqu'à la borne. Et L'EAU D'UNE NAPPE NE SE FOND PAS : un haut-fond pris dans une
  // composante fondue (le bord d'eau au niveau de la rive basse, qu'une rivière ou la roche
  // coupe de tout) RESTE au lac — seul `niveler` déplace l'eau d'un lac, et il la déplace
  // entière (T-A3, sans exception). Ce qu'on fondait avant se tenait au palier de ce qui le
  // rejoignait et versait dans la nappe : une paroi en pleine eau, une tuile au large.
  // Sur l'escalier : toute l'eau reste (figée) ; une terre qui DESCEND ne passe pas sous un lac
  // qu'elle borde (la composante reste alors), et l'eau courante qu'elle borde descend avec.
  const fondre = (id: number, cible: number): boolean => {
    const descend = cible < palierDe[id]!
    if (escalier) {
      // Sur l'escalier, une miette ne quitte pas son eau : elle ne descend pas sous la nappe
      // qu'elle borde, et ne MONTE pas au-dessus d'une eau qu'elle touche (MESURÉ graine 2026 :
      // la ceinture de marais d'un lac en cuvette, fondue dans le plateau voisin, faisait 13
      // plaques de marais perchées au-dessus de leur lac).
      for (let m = debut[id]!; m < debut[id + 1]!; m++) {
        const i = membres[m]!
        if (eau(i)) continue
        if (descend) { if (plancherLac(i) > cible) return false }
        else {
          const b = eauVoisineLaPlusBasse(i)
          if (b >= 0 && b < cible) return false
        }
      }
    }
    for (let m = debut[id]!; m < debut[id + 1]!; m++) {
      const i = membres[m]!
      if (figee(i)) continue
      blocDe[i] = -1
      palier[i] = cible
      if (escalier && descend) abaisserLEauVoisine(i, cible)
    }
    return true
  }

  // ── 4b. LES MIETTES — fondues dans le palier voisin majoritaire ───────────────────────────
  const fondreLesMiettes = (): number => {
    let n = 0
    for (let id = 0; id < nComp; id++) {
      if (taille[id]! >= TERRASSES.MIETTE_TUILES) continue
      // UNE NAPPE N'EST PAS UNE MIETTE : l'eau tient sur un palier (T-A3), et fondre ne la déplace
      // pas de toute façon. Une composante MÊLÉE (un îlot et son bout de ceinture) se fond, elle :
      // seule sa terre bouge, l'eau reste au lac.
      if (deNappe[id] === 1) continue
      const cible = palierVoisinMajoritaire(id)
      if (cible < 0 || cible === palierDe[id]) continue
      if (fondre(id, cible)) n++
    }
    return n
  }

  // ── 5. LES RAMPES — élues au bord SUD, trois colonnes, aucun tirage ───────────────────────
  //
  // Une colonne : une tuile HAUTE (x, y) au palier p+1 sur une tuile BASSE (x, y+1) au palier p,
  // toutes deux marchables ; la basse est le connecteur. Les trois colonnes (x−1..x+1) doivent
  // monter, et la rangée nord-nord (y−1) porter le haut : on gravit une rampe pour arriver
  // quelque part, pas pour ressortir au niveau du sol (la leçon de la colonne 577).
  //
  // LE PIED PEUT ÊTRE DANS LES HAUT-FONDS, LA TÊTE JAMAIS — un gué. La nappe tient son palier
  // (§2) et n'a de rive haute qu'au-dessus d'elle : sans rampe qui descende DANS l'eau, aucune
  // ceinture de lac ne se rejoignait plus, ni la poche de terre qu'elle enferme, ni la banquette
  // coincée entre le lac et le plateau (MESURÉ graine 4242 : 422 tuiles de terre et 3 874 de
  // haut-fond perdues, et le point fixe qui bat 32 tours). La tête reste hors d'eau : on ne
  // monte pas SUR un lac.
  const demi = CREUX.RAMPE_LARGEUR >> 1
  const teteDeRampe = (i: number): boolean => marchable(i) && !eau(i) && !reservees.has(i)
  const piedDeRampe = (i: number): boolean => marchable(i) && !reservees.has(i)
  const colonneMonte = (x: number, y: number, p: number): boolean => {
    if (y < 1 || y + 1 >= height) return false
    const h = y * width + x
    const b = h + width
    const nn = h - width
    if (!teteDeRampe(h) || !piedDeRampe(b) || !marchable(nn)) return false
    return palier[b] === p && palier[h] === p + 1 && palier[nn] === p + 1
  }
  // ⚠ LE MÊME `p` POUR LES TROIS COLONNES — celui du bas de la colonne du milieu. Chaque colonne
  // jugée sur SON propre bas laissait passer une rampe dont le flanc montait 0→1 pendant que
  // le milieu montait 1→2 : le connecteur du flanc se disait `de: 1` sur une tuile de palier 0
  // (MESURÉ : 23 des 1 070 connecteurs de la graine 2026, non marchables à leur `de`).
  const rampeMonte = (x: number, y: number): boolean => {
    if (x - demi < 0 || x + demi >= width || y + 1 >= height) return false
    const p = palier[(y + 1) * width + x]!
    for (let d = -demi; d <= demi; d++) if (!colonneMonte(x + d, y, p)) return false
    return true
  }
  let rampes: RampeDeTerrasse[] = []
  /** Les paires (haut, bas) de composantes qu'une rampe relie déjà — clé `haut * nComp + bas`. */
  let reliees = new Map<number, RampeDeTerrasse[]>()
  const elire = (x: number, y: number, pris: Uint8Array): void => {
    const b = (y + 1) * width + x
    const h = y * width + x
    const cle = comp[h]! * nComp + comp[b]!
    const r: RampeDeTerrasse = { x, y: y + 1, de: palier[b]!, vers: palier[h]! }
    let liste = reliees.get(cle)
    if (liste === undefined) { liste = []; reliees.set(cle, liste) }
    liste.push(r)
    for (let d = -demi; d <= demi; d++) {
      pris[b + d] = 1
      rampes.push({ x: x + d, y: y + 1, de: r.de, vers: r.vers })
    }
  }
  /** Une candidate est-elle à moins de `RAMPE_PAS` (Chebyshev) d'une rampe déjà élue pour sa paire ? */
  const tropPres = (cle: number, x: number, y: number): boolean => {
    const deja = reliees.get(cle)
    if (deja === undefined) return false
    for (const r of deja) {
      if (Math.abs(r.x - x) < TERRASSES.RAMPE_PAS && Math.abs(r.y - (y + 1)) < TERRASSES.RAMPE_PAS) return true
    }
    return false
  }
  const elireLesRampes = (): void => {
    rampes = []
    reliees = new Map()
    const pris = new Uint8Array(N)
    const libre = (x: number, y: number): boolean => {
      for (let d = -demi; d <= demi; d++) if (pris[(y + 1) * width + x + d] === 1) return false
      return true
    }
    // Toutes les candidates, groupées par paire (haut, bas), dans l'ordre ouest → est puis
    // nord → sud : c'est l'ordre du départage.
    const parPaire = new Map<number, { x: number; y: number }[]>()
    for (let x = demi; x + demi < width; x++) {
      for (let y = 1; y + 1 < height; y++) {
        if (!rampeMonte(x, y)) continue
        const cle = comp[y * width + x]! * nComp + comp[(y + 1) * width + x]!
        let l = parPaire.get(cle)
        if (l === undefined) { l = []; parPaire.set(cle, l) }
        l.push({ x, y })
      }
    }
    // (i) D'ABORD LES SENTES : là où la route du bas continue au nord par la route du haut, la
    //     rampe est là — la route monte par le col qu'elle a cherché.
    for (const [, l] of parPaire) {
      for (const c of l) {
        const h = c.y * width + c.x
        if (terrain[h] !== TERRAIN_ROAD || terrain[h + width] !== TERRAIN_ROAD) continue
        if (!libre(c.x, c.y)) continue
        elire(c.x, c.y, pris)
      }
    }
    // (ii) PUIS UNE PAR PAIRE — la plus à l'ouest ; (iii) puis une tous les `RAMPE_PAS` le long
    //      du bord, à distance de toutes celles de la paire.
    for (const [cle, l] of parPaire) {
      for (const c of l) {
        if (!libre(c.x, c.y) || tropPres(cle, c.x, c.y)) continue
        elire(c.x, c.y, pris)
      }
    }
  }

  // ── 6. GARANTIR — ce que les rampes n'atteignent pas rejoint son voisin atteint ──────────
  //
  // Le patron de `garantirLaConnexite` : on OUVRE, on ne raisonne pas. Depuis la plus grande
  // composante, par les rampes (la marche `(tuile, niveau)` du jeu) ; chaque PIÈCE de terre d'un
  // seul tenant qu'on n'atteint pas descend au palier de sa voisine atteinte LA PLUS BASSE — ou,
  // poche au fond d'un cirque, MONTE rejoindre sa voisine atteinte à p + 1, l'eau qui la suit
  // avec (`monter`) ; ou, banquette sans face sud, reçoit une descente creusée (§6b). Les îles
  // vraies (aucune voisine marchable) restent ce qu'elles sont : le monde sans terrasse ne les
  // atteignait pas non plus.
  // ── 6b. LA DESCENTE CREUSÉE — quand rien ne fond et qu'aucune rampe ne peut naître ────────
  //
  // La banquette entre un lac et son plateau, quand le pays MONTE VERS LE SUD : le lac au nord
  // (0), la banquette (1), le plateau au sud (2). Aucune face sud nulle part — le plateau est au
  // sud d'elle, le lac au nord — donc aucune rampe (§5) ; monter la rejoindre, ±1 la referait
  // (§6) ; descendre au lac, ±1 en recreuserait une autre dans le plateau, cinq tuiles par tour.
  // MESURÉ graine 4242 : 1 890 tuiles de terre dans 11 banquettes, toutes sur la rive sud d'un
  // même lac ; 431 sur la 909.
  //
  // Alors ON CREUSE — ce qu'un level designer ferait : une RAVINE en L dans le plateau, depuis
  // la banquette. Un chenal de `RAMPE_LARGEUR` colonnes qui s'enfonce de deux rangées au sud,
  // puis un bras de deux rangées qui tourne à l'est (ou à l'ouest) sur `RAMPE_LARGEUR` colonnes
  // de plus. Entre la banquette et le bras, il reste une LANGUE de plateau de deux rangées, au
  // NORD du bras : c'est la face sud que la rampe cherchait — elle s'y élira au tour suivant,
  // toute seule, par la règle ordinaire. On ne fait que baisser des tuiles : le point fixe tient.
  //
  //        lac                 (0)
  //        banquette           (1)  ← la composante hors d'atteinte
  //        chenal | LANGUE  #  (1 | 2)   la langue : 2 rangées de plateau, rampe sur sa face sud
  //        bras   bras  bras   (1)       ↑ la rampe descend ici, vers le sud
  //        plateau             (2)
  //
  // Les tuiles creusées sont de la terre marchable, hors lieu et hors bloc, au palier p+1 et
  // de la composante atteinte ; et tout le halo d'une tuile reste entre p et p+1 — on ne creuse
  // pas contre une marche que ±1 aurait ensuite à refaire.
  //
  // ET LE MIROIR, SUR L'ESCALIER (`piece` donnée) : le plateau hors d'atteinte est AU SUD d'une
  // terre atteinte plus basse — ses faces vers elle regardent le nord ou l'est, aucune rampe
  // ne peut y descendre (§5). On creuse la même ravine, depuis la terre atteinte, DANS la pièce :
  // le chenal en descend au palier atteint, la langue reste à la pièce, et la rampe s'élit sur
  // sa face sud. MESURÉ graine 2026 : sans ce miroir, la garantie fondait la presqu'île entière
  // (1176-1199, 68-95) d'un cran — et la mesa bâtie dessus gardait son chapeau à 2 sur une jupe
  // à 0 (T-A4). Le contrat des terrasses N3, c'est que l'escalier reste : on creuse avant de
  // fondre.
  const creuserUneDescente = (
    terre: number[], p: number, atteinte: Uint8Array, piece: ((j: number) => boolean) | null = null,
  ): boolean => {
    const L = CREUX.RAMPE_LARGEUR
    const terreDuPlateau = (j: number): boolean =>
      (piece === null ? atteinte[j] === 1 : piece(j)) && palier[j] === p + 1 && marchable(j) && !eau(j) && !reservees.has(j) && blocDe[j]! < 0
    for (const i of terre) {
      const x = i % width
      const y = (i - x) / width
      if (y + 6 >= height) continue
      if (!terreDuPlateau(i + width)) continue
      for (const sens of [1, -1]) {
        if (x - 1 < 0 || x + 1 >= width || x + sens * (2 * L) < 0 || x + sens * (2 * L) >= width) continue
        const col = (k: number): number => x + sens * k
        let ok = true
        // Le halo : colonnes −1..2L, rangées y..y+5, tout entre p et p+1.
        for (let k = -1; k <= 2 * L && ok; k++) {
          for (let r = 0; r <= 5; r++) {
            const j = (y + r) * width + col(k)
            const q = palier[j]!
            if (q < p || q > p + 1) { ok = false; break }
            // Sur l'escalier, on ne creuse pas contre une eau à p+1 : elle resterait perchée.
            if (escalier && q === p + 1 && eau(j)) { ok = false; break }
          }
        }
        if (!ok) continue
        // Le chenal et le bras : à creuser ; la langue : la tête de rampe, qui reste.
        for (let k = 0; k < 2 * L && ok; k++) {
          for (let r = 1; r <= 4; r++) {
            if (!terreDuPlateau((y + r) * width + col(k))) { ok = false; break }
          }
        }
        if (!ok) continue
        for (let k = 0; k < 2 * L; k++) {
          for (let r = 1; r <= 4; r++) if (r >= 3 || k < L) palier[(y + r) * width + col(k)] = p
        }
        return true
      }
    }
    return false
  }

  // ET L'ENTAILLE PAR LE FLANC, sur l'escalier : la terre atteinte plus basse borde la pièce par
  // l'EST ou l'OUEST (le cas du contact nord est la ravine miroir ci-dessus). On creuse dans la
  // pièce un chenal de `RAMPE_LARGEUR` colonnes sur deux rangées, au palier atteint, depuis le
  // flanc : sa rangée du haut est une FACE SUD du plateau — la rampe s'y élit toute seule, avec
  // les deux rangées de plateau qu'elle veut au-dessus (`colonneMonte`).
  //
  //        plateau  plateau  plateau   (p)   ← nn puis tête de rampe, deux rangées
  //   ⟶  chenal   chenal   chenal    (p−1) ← creusé depuis la terre atteinte à gauche
  //        chenal   chenal   chenal    (p−1)
  //        plateau  plateau  plateau   (p)
  //
  // Même discipline que la ravine : que de la terre marchable de la pièce, hors lieu et hors bloc,
  // et tout le halo entre p−1 et p, sans eau à p.
  const creuserUneEntaille = (terre: number[], p: number, atteinte: Uint8Array, piece: (j: number) => boolean): boolean => {
    const L = CREUX.RAMPE_LARGEUR
    const terreDeLaPiece = (j: number): boolean =>
      piece(j) && palier[j] === p && marchable(j) && !eau(j) && !reservees.has(j) && blocDe[j]! < 0
    for (const t of terre) {
      const xt = t % width
      const y = (t - xt) / width
      if (y < 3 || y + 2 >= height) continue
      for (const sens of [1, -1]) {
        const x0 = xt - sens // la terre atteinte, d'où l'on creuse
        if (x0 < 0 || x0 >= width || x0 + sens * (L + 1) < 0 || x0 + sens * (L + 1) >= width) continue
        const j0 = y * width + x0
        if (atteinte[j0] === 0 || palier[j0] !== p - 1 || eau(j0)) continue
        let ok = true
        // Le halo : colonnes x0..x0+sens·(L+1), rangées y−3..y+2, tout entre p−1 et p.
        for (let k = 0; k <= L + 1 && ok; k++) {
          for (let r = -3; r <= 2; r++) {
            const j = (y + r) * width + x0 + sens * k
            const q = palier[j]!
            if (q < p - 1 || q > p) { ok = false; break }
            if (q === p && eau(j)) { ok = false; break }
          }
        }
        if (!ok) continue
        // Le chenal (rangées y, y+1) à creuser ; au-dessus, deux rangées de la pièce qui restent.
        for (let k = 1; k <= L && ok; k++) {
          for (let r = -2; r <= 1; r++) {
            if (!terreDeLaPiece((y + r) * width + x0 + sens * k)) { ok = false; break }
          }
        }
        if (!ok) continue
        for (let k = 1; k <= L; k++) for (let r = 0; r <= 1; r++) palier[(y + r) * width + x0 + sens * k] = p - 1
        return true
      }
    }
    return false
  }

  // ET L'ENCOCHE DANS LE PLATEAU, le miroir de l'entaille : la pièce est la POCHE, plus basse que
  // la terre atteinte qui la borde par l'est ou l'ouest (une bande de marais au fond d'une gorge
  // dont le nord est roche : aucune face sud, ni au plateau ni à la poche). On creuse dans le
  // plateau atteint un chenal de `RAMPE_LARGEUR` colonnes sur deux rangées, AU PALIER DE LA
  // POCHE, depuis son flanc : la rangée du haut du chenal est une face sud du plateau, et les
  // deux rangées de plateau au-dessus sont la tête que la rampe demande. MESURÉ avant (graine
  // 2026) : 27 tuiles de marais et de berge à 0 le long d'un bras du grand lac, entre le plateau
  // à 1 et l'eau, sous la roche du bord du pays — hors d'atteinte, rien à monter (l'eau à 0 les
  // borde), rien à creuser vers le sud (l'eau continue).
  //
  //        plateau  plateau  plateau   (p+1) ← nn puis tête de rampe, deux rangées
  //   ⟵  chenal   chenal   chenal    (p)   ← creusé dans le plateau, depuis la poche à gauche
  //        chenal   chenal   chenal    (p)
  //        plateau  plateau  plateau   (p+1)
  //
  // Même discipline : que du plateau atteint, marchable, hors lieu et hors bloc ; le halo entre
  // p et p+1, sans eau à p+1 (elle resterait perchée sur le chenal).
  const creuserUneEncoche = (terre: number[], p: number, atteinte: Uint8Array): boolean => {
    const L = CREUX.RAMPE_LARGEUR
    const terreDuPlateau = (j: number): boolean =>
      atteinte[j] === 1 && palier[j] === p + 1 && marchable(j) && !eau(j) && !reservees.has(j) && blocDe[j]! < 0
    for (const t of terre) {
      const xt = t % width
      const y = (t - xt) / width
      if (y < 3 || y + 2 >= height) continue
      for (const sens of [1, -1]) {
        if (xt + sens * (L + 1) < 0 || xt + sens * (L + 1) >= width) continue
        if (!terreDuPlateau(y * width + xt + sens)) continue
        let ok = true
        // Le halo : colonnes xt..xt+sens·(L+1), rangées y−3..y+2, tout entre p et p+1.
        for (let k = 0; k <= L + 1 && ok; k++) {
          for (let r = -3; r <= 2; r++) {
            const j = (y + r) * width + xt + sens * k
            const q = palier[j]!
            if (q < p || q > p + 1) { ok = false; break }
            if (q === p + 1 && eau(j)) { ok = false; break }
          }
        }
        if (!ok) continue
        // Le chenal (rangées y, y+1) à creuser ; au-dessus, deux rangées de plateau qui restent.
        for (let k = 1; k <= L && ok; k++) {
          for (let r = -2; r <= 1; r++) {
            if (!terreDuPlateau((y + r) * width + xt + sens * k)) { ok = false; break }
          }
        }
        if (!ok) continue
        for (let k = 1; k <= L; k++) for (let r = 0; r <= 1; r++) palier[(y + r) * width + xt + sens * k] = p
        return true
      }
    }
    return false
  }

  const garantir = (): number => {
    if (nComp === 0) return 0
    const adj: number[][] = Array.from({ length: nComp }, () => [])
    for (const cle of reliees.keys()) {
      const h = Math.floor(cle / nComp)
      const b = cle - h * nComp
      adj[h]!.push(b)
      adj[b]!.push(h)
    }
    let racine = 0
    for (let id = 1; id < nComp; id++) if (taille[id]! > taille[racine]!) racine = id
    const atteint = new Uint8Array(nComp)
    atteint[racine] = 1
    const file = [racine]
    for (let h = 0; h < file.length; h++) {
      for (const v of adj[file[h]!]!) if (atteint[v] === 0) { atteint[v] = 1; file.push(v) }
    }
    // L'ATTEINTE SE LIT À LA TUILE : ce qui bouge dans ce tour est atteint dès qu'il a bougé, et
    // les suivantes le voient tel qu'il est maintenant — sans que le reste de sa composante le soit.
    const atteinte = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (comp[i]! >= 0 && atteint[comp[i]!] === 1) atteinte[i] = 1
    /** Une tuile marchable, atteinte, au palier `p` : ce qu'on rejoint en montant. */
    const contactHaut = (j: number, p: number): boolean => atteinte[j] === 1 && palier[j] === p && marchable(j)
    /** Une tuile plus basse que `p` touche-t-elle l'une de `tuiles` ? (±1 nous en redescendrait.) */
    const plusBasQue = (tuiles: readonly number[], p: number): boolean => {
      for (const i of tuiles) {
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (palier[ny * width + nx]! < p) return true
        }
      }
      return false
    }
    const vu = new Uint8Array(N)
    /** La pièce de terre de chaque tuile visitée (index dans `pieces`), −1 sinon. */
    const pieceDe = new Int32Array(N).fill(-1)
    const pieces: number[][] = []
    /** 1 quand la pièce a été jugée ce tour (descendue, montée, ou laissée). */
    const decidee: number[] = []
    // ── MONTER, ET L'EAU AVEC — la fermeture de ce qui suit ──────────────────────────────────
    //
    // On ne monte que ce que l'eau laissera monter. Une côte ou une nappe suit ses VOTANTS
    // (`voteursDuBloc`) : si tous seront à p + 1 — la terre de la composante qui monte avec elle,
    // ce qui est déjà plus haut, un bloc d'eau qui monte aussi —, `aplanir`/`niveler` la
    // reposeront à p + 1 au tour suivant ; on la pose tout de suite, pour que le tour la voie.
    // Sinon elle reste, et ce que seule cette eau reliait au continent ne monte pas non plus :
    // c'est la presqu'île de 988 tuiles (graine 2026) qu'on ne laisse plus en l'air. Et une île
    // que le continent ne rejoint que par l'eau (la rivière du sud à 1, cascade sur son bord à
    // 0 — 2 863 tuiles, même graine) monte AVEC sa rivière : le gué remonte jusqu'à elle.
    //
    // La fermeture : depuis une pièce, de proche en proche, les blocs d'eau au palier p qui
    // PEUVENT suivre et les pièces de la composante qui les bordent ; elle vaut si elle touche
    // quelque part une tuile atteinte à p + 1 — par la terre ou par l'eau (l'amont d'une côte).
    const monter = (depart: number, p: number): boolean => {
      const dansFermeture = new Set<number>() // pièces
      const blocsMontes = new Set<number>()
      /** Le bloc `b` peut-il suivre à p + 1 ? Mémo à trois états ; en cours = oui (ils montent ensemble). */
      const okDuBloc = new Map<number, number>()
      const peutSuivre = (b: number): boolean => {
        const memo = okDuBloc.get(b)
        if (memo !== undefined) return memo !== 2
        okDuBloc.set(b, 3)
        let ok = blocEstNappe[b] === 1 && palier[tuilesDuBloc[b]![0]!] === p && !plusBasQue(tuilesDuBloc[b]!, p)
        if (ok) {
          const v = voteursDuBloc[b]!
          if (v.length === 0) {
            const a = avalDuBloc[b]!
            ok = a < 0 || palier[tuilesDuBloc[a]![0]!]! > p || peutSuivre(a)
          }
          for (const j of v) {
            if (!ok) break
            if (palier[j]! > p) continue
            if (palier[j]! < p) { ok = false; break }
            if (deLaNappe(j)) { ok = peutSuivre(blocDe[j]!); continue }
            // De la terre à p : elle doit être de la composante, et pouvoir monter (pas de plus bas
            // à côté) — elle sera de la fermeture par ce bloc même.
            ok = comp[j] === comp[depart] && !plusBasQue(pieces[pieceDe[j]!]!, p)
          }
        }
        okDuBloc.set(b, ok ? 1 : 2)
        return ok
      }
      let amorce = false
      const filePieces = [pieceDe[depart]!]
      dansFermeture.add(pieceDe[depart]!)
      const fileBlocs: number[] = []
      // SUR L'ESCALIER, L'EAU SUIT TUILE À TUILE, ET SEULEMENT AVEC TOUTES SES BERGES. Une eau à p
      // que borde une pièce qui monte DOIT monter avec elle — sinon la pièce se retrouverait en
      // gorge au-dessus d'elle, avec sa frange de marais perchée ; et elle ne le peut que si
      // chaque terre qu'elle touche est de la fermeture ou déjà plus haute (un lac ne bouge jamais :
      // la pièce qui le borde ne monte pas, elle attend sa rampe ou sa descente). D'une eau à
      // l'eau voisine, on suit tant qu'on peut — la marche se fait là où la rivière quitte ce qui
      // monte, pas au milieu d'un lit.
      const eauxSuivies = new Set<number>()
      const fileEaux: number[] = []
      let impossible = false
      const eauPeutSuivre = (j: number): boolean => {
        if (deLaNappe(j)) return false
        const x = j % width
        const y = (j - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const v = ny * width + nx
          if (palier[v]! < p) return false
          if (palier[v]! > p || eau(v) || !marchable(v)) continue
          if (comp[v] !== comp[depart] || pieceDe[v]! < 0 || plusBasQue(pieces[pieceDe[v]!]!, p)) return false
        }
        return true
      }
      const surEau = (j: number, depuisLaTerre: boolean): void => {
        if (eauxSuivies.has(j)) return
        if (!eauPeutSuivre(j)) { if (depuisLaTerre) impossible = true; return }
        eauxSuivies.add(j)
        fileEaux.push(j)
      }
      const voisinsDe = (tuiles: readonly number[], surTuile: (j: number) => void): void => {
        for (const i of tuiles) {
          const x = i % width
          const y = (i - x) / width
          for (const [dx, dy] of VOISINS4) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            surTuile(ny * width + nx)
          }
        }
      }
      const surVoisin = (j: number, depuisLaTerre = true): void => {
        if (contactHaut(j, p + 1)) { amorce = true; return }
        if (palier[j] !== p) return
        if (escalier && eau(j)) { surEau(j, depuisLaTerre); return }
        if (deLaNappe(j)) {
          const b = blocDe[j]!
          if (blocsMontes.has(b) || !peutSuivre(b)) return
          blocsMontes.add(b)
          fileBlocs.push(b)
          return
        }
        if (comp[j] !== comp[depart] || dansFermeture.has(pieceDe[j]!)) return
        if (plusBasQue(pieces[pieceDe[j]!]!, p)) return
        dansFermeture.add(pieceDe[j]!)
        filePieces.push(pieceDe[j]!)
      }
      const surVoisinDEau = (j: number): void => surVoisin(j, false)
      while ((filePieces.length > 0 || fileBlocs.length > 0 || fileEaux.length > 0) && !impossible) {
        const k = filePieces.pop()
        if (k !== undefined) { voisinsDe(pieces[k]!, surVoisin); continue }
        const e = fileEaux.pop()
        if (e !== undefined) { voisinsDe([e], surVoisinDEau); continue }
        voisinsDe(tuilesDuBloc[fileBlocs.pop()!]!, surVoisin)
      }
      if (!amorce || impossible) return false
      for (const k of dansFermeture) {
        decidee[k] = 1
        for (const i of pieces[k]!) {
          blocDe[i] = -1
          palier[i] = p + 1
          atteinte[i] = 1
        }
      }
      for (const b of blocsMontes) {
        for (const i of tuilesDuBloc[b]!) { palier[i] = p + 1; if (marchable(i)) atteinte[i] = 1 }
      }
      for (const i of eauxSuivies) { palier[i] = p + 1; if (marchable(i)) atteinte[i] = 1 }
      return true
    }
    /** Découpe la pièce de terre (4-connexe, hors nappe, même composante) qui porte `graine`. */
    const decouper = (graine: number): number[] => {
      const id = comp[graine]!
      const k = pieces.length
      const terre = [graine]
      pieces.push(terre)
      decidee.push(0)
      vu[graine] = 1
      pieceDe[graine] = k
      for (let h = 0; h < terre.length; h++) {
        const i = terre[h]!
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (comp[j] !== id || figee(j) || vu[j] === 1) continue
          vu[j] = 1
          pieceDe[j] = k
          terre.push(j)
        }
      }
      return terre
    }
    let n = 0
    for (let id = 0; id < nComp; id++) {
      if (atteint[id] === 1) continue
      // UNE CEINTURE DE LAC QUE RIEN NE REJOINT RESTE AU LAC (voir les nappes) : elle n'est pas
      // perdue, elle est de l'eau — T-A2 la compte à part.
      if (deNappe[id] === 1) continue
      // CE QUI BOUGE, C'EST LA TERRE D'UN SEUL TENANT — pas la composante. Une composante mêle la
      // terre et l'eau (le gué la traverse), mais l'eau ne descend et ne monte qu'avec ses votants :
      // fondre la composante entière laissait EN L'AIR tout ce que seule l'eau reliait à la
      // voisine rejointe. Alors chaque pièce de terre 4-connexe (hors nappe) décide POUR ELLE —
      // et ce qu'elle entraîne en montant, c'est la fermeture de `monter`.
      // Toutes les pièces de la composante d'abord : la fermeture d'une montée doit pouvoir lire
      // n'importe laquelle en entier (ses plus bas à côté) avant qu'on l'ait jugée.
      const premiere = pieces.length
      for (let m = debut[id]!; m < debut[id + 1]!; m++) {
        const graine = membres[m]!
        if (!figee(graine) && vu[graine] === 0) decouper(graine)
      }
      for (let k = premiere; k < pieces.length; k++) {
        if (decidee[k] === 1) continue
        decidee[k] = 1
        const terre = pieces[k]!
        const p = palier[terre[0]!]!
        // LA VOISINE ATTEINTE LA PLUS BASSE — atteinte, pas n'importe laquelle : deux poches
        // voisines, toutes deux hors d'atteinte, se fondaient chacune dans le palier de l'autre et
        // ÉCHANGEAIENT leurs paliers à chaque tour, jusqu'à la borne (5 composantes, graine 2026).
        // Par T-R5 elle est à p−1 ou p+1 (à p, on serait la même composante) : on descend d'un
        // cran vers elle — ou, POCHE au fond d'un cirque, on MONTE la rejoindre, l'eau avec. Sans
        // voisine atteinte : on attend qu'une voisine le devienne (ou c'est une île vraie, hors du
        // continent en 2D déjà — elle ne regarde pas la garantie).
        let bas: number = TERRASSES.PALIERS
        for (const i of terre) {
          const x = i % width
          const y = (i - x) / width
          for (const [dx, dy] of VOISINS4) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const j = ny * width + nx
            if (atteinte[j] === 0) continue
            if (palier[j]! < bas) bas = palier[j]!
          }
        }
        // L'ÎLE DANS SON LAC (escalier) : aucune terre atteinte ne la touche — mais sa ceinture
        // de haut-fond (la même composante : l'eau du lac à p, que le gué traverse) touche
        // peut-être un plateau atteint au sud. On y creuse la descente (§6b) : la rampe aura le
        // pied dans l'eau, et l'île se rejoint par sa ceinture. MESURÉ avant : une cellule de
        // 8 × 8 qui émerge d'un lac (le palier au-dessus du sien) faisait 64 tuiles de terre
        // hors d'atteinte sur les graines 2026 et 909 (T-A2), sa ceinture avec.
        if (escalier && bas === TERRASSES.PALIERS) {
          const ceinture: number[] = []
          for (let m = debut[id]!; m < debut[id + 1]!; m++) {
            const j = membres[m]!
            if (eau(j) && atteinte[j] === 0) ceinture.push(j)
          }
          if (ceinture.length > 0 && creuserUneDescente(ceinture, p, atteinte)) n++
          continue
        }
        // Sur l'escalier, LA PIÈCE AU-DESSUS D'UNE TERRE ATTEINTE SE CREUSE AVANT DE FONDRE : la
        // ravine miroir (voir `creuserUneDescente`), depuis les tuiles atteintes à p − 1 qui la
        // bordent par le nord. La garantie ne rabote un palier qu'à défaut.
        if (escalier && bas === p - 1) {
          const seuil: number[] = []
          for (const i of terre) {
            if (i < width) continue
            const j = i - width
            if (atteinte[j] === 1 && palier[j] === bas && !eau(j)) seuil.push(j)
          }
          const dansLaPiece = (j: number): boolean => pieceDe[j] === k
          if (seuil.length > 0 && creuserUneDescente(seuil, bas, atteinte, dansLaPiece)) { n++; continue }
          if (creuserUneEntaille(terre, p, atteinte, dansLaPiece)) { n++; continue }
        }
        // Sur l'escalier, on ne descend pas sous un lac qu'on borde : la pièce attend sa rampe
        // ou sa descente creusée, comme une banquette.
        let sousUnLac = false
        if (escalier && bas < p) for (const i of terre) if (plancherLac(i) > bas) { sousUnLac = true; break }
        if (bas < p && !sousUnLac) {
          // FONDRE DÉTACHE (voir `fondre`) : la terre quitte son bloc et prend le palier de la
          // voisine ; rejointe, elle est atteinte. L'eau qu'elle bordait suit ses votants au tour
          // suivant (`aplanir`, `niveler`) — ou, sur l'escalier, descend avec elle tout de suite.
          for (const i of terre) {
            blocDe[i] = -1
            palier[i] = bas
            atteinte[i] = 1
            if (escalier) abaisserLEauVoisine(i, bas)
          }
          n++
          continue
        }
        // ON NE MONTE PAS SI QUELQUE CHOSE EST PLUS BAS À CÔTÉ — n'importe quelle tuile, eau ou
        // roche : ±1 nous en redescendrait au tour suivant, et la banquette entre un lac et son
        // plateau battait ainsi jusqu'à la borne (2 composantes × 32 tours, graine 4242). Elle
        // attend sa rampe vers le bas (le gué, §5), ou la descente creusée (§6b) si un plateau
        // atteint la domine, ou reste ce qu'elle est.
        // Sur l'escalier, LA POCHE SOUS UN PLATEAU ATTEINT SE CREUSE AVANT DE MONTER : la descente
        // (§6b) depuis le plateau au sud, sinon l'encoche depuis le plateau à l'est ou à l'ouest
        // (`creuserUneEncoche`) — l'une et l'autre ne touchent que la lisière du plateau atteint
        // et laissent l'eau de la poche où elle est née.
        if (escalier && bas === p + 1) {
          if (creuserUneDescente(terre, p, atteinte) || creuserUneEncoche(terre, p, atteinte)) { n++; continue }
        }
        if (plusBasQue(terre, p)) {
          if (!escalier && bas === p + 1 && creuserUneDescente(terre, p, atteinte)) n++
          continue
        }
        if (monter(terre[0]!, p)) n++
      }
    }
    return n
  }

  // ── LE POINT FIXE — borné, et le dernier mot revient toujours à ±1 puis aux rampes ────────
  const calmer = (): void => {
    rabaisser()
    etiqueter()
    const mi = fondreLesMiettes()
    const ni = niveler() + aplanir() + suivreLEau()
    if (mi + ni > 0) { rabaisser(); etiqueter() }
    // Les orphelins en dernier, une fois les composantes posées — et si les suivre a creusé un
    // écart de deux (une berge à p − 1, l'autre à p + 1), ±1 le referme et ils suivent encore.
    if (assujettir() > 0 && rabaisser() > 0) { assujettir(); etiqueter() }
    elireLesRampes()
  }
  let tours = 0
  for (let tour = 0; tour < TERRASSES.TOURS; tour++) {
    tours = tour + 1
    calmer()
    if (garantir() === 0) break
    // La garantie a bougé des tuiles : ce qu'elle a laissé de ±1 se répare au tour suivant — ou
    // tout de suite si c'était le dernier, pour que le rendu et les rampes voient le champ final.
    if (tour + 1 === TERRASSES.TOURS) calmer()
  }
  return { palier, rampes, tours }
}

/** `true` si au moins une tuile n'est pas au palier 0 — sinon la carte n'a pas besoin du champ. */
export function aDesPaliers(palier: Int8Array): boolean {
  for (let i = 0; i < palier.length; i++) if (palier[i] !== 0) return true
  return false
}
