/**
 * LES PAYS — la vallée cesse d'être un tapis, elle devient une contrée.
 *
 * LE CONSTAT (audit du 2026-07-13, mesuré sur la vraie carte). Trois seeds
 * produisaient **le même lieu re-mélangé** : une couronne de pics, une ceinture
 * dorée, un tapis forêt/lande au même grain du nord au sud. La métrique le dit
 * sèchement — on découpe la carte en blocs de 150 tuiles et on compare leurs
 * compositions : le rapport « blocs lointains / blocs voisins » valait **1,58**.
 * Autrement dit, la carte a bien une structure — mais c'est un GRADIENT
 * concentrique (le bord monte, le fond descend), pas un pays à quartiers. « Un
 * peu plus loin » promettait donc toujours la même chose.
 *
 * CE QUI EXISTAIT DÉJÀ, ET QUI NE SE VOYAIT PAS. `paintAlpineBands` mélangeait
 * deux champs de bruit basse fréquence appelés « quartiers macro » (`macroWet`,
 * `macroRock`). C'était l'intention juste, exprimée dans le mauvais outil : un
 * bruit continu ne fabrique pas de LIEUX, il fabrique un dégradé. Il n'a pas de
 * frontière, donc pas de dedans ni de dehors ; pas de centre, donc pas de nom.
 * On ne peut pas dire « je vais à la Tourbière » à un champ de bruit.
 *
 * CE QU'ON FAIT. Un semis de SITES sur un treillis jitteré, à maille **absolue**
 * (300 tuiles) — et ce détail est le cœur de l'affaire : à maille absolue, une
 * carte deux fois plus grande a **quatre fois plus de pays**, au lieu des mêmes
 * en plus gros. C'est le seul geste qui fasse payer l'échelle. Chaque site tire
 * un CARACTÈRE (la Tourbière, la Vieille Sylve, le Versant Brûlé, les Hauts
 * Alpages…) parmi ceux que son altitude autorise, et un NOM. Une tuile appartient
 * au site le plus proche, la position d'interrogation étant déformée par un bruit
 * — d'où des frontières organiques, jamais des polygones.
 *
 * L'identité n'est pas une couleur de sol : le caractère décale l'HUMIDITÉ (donc
 * la bande de biome : tourbière ↔ prairie ↔ lande) et la densité des BOSQUETS
 * (vieille forêt, brûlis). Ce qui change la végétation change la vitesse sous les
 * pieds, le couvert, la température, **les lieux qui peuvent y naître** (la table
 * des POI est indexée par biome) et le gibier qui y vit. Un pays se traverse
 * autrement, il se récolte autrement, il ne contient pas les mêmes choses.
 *
 * ET C'EST MOINS CHER. Les deux `fbmWarp2` des quartiers macro coûtaient 18
 * appels de `gradientNoise2` par tuile ; le warp des pays en coûte 6. On y gagne
 * douze — la passe des bandes devient plus rapide qu'avant.
 *
 * Pur et déterministe : `hash2` pour les sites, les caractères et les noms ;
 * `fbm2` pour le warp ; comparaisons de distances AU CARRÉ (aucune racine, aucune
 * trigonométrie).
 */
import { distSq } from './geometry'
import type { WorldMap, Zone } from './map'
import { fbm2, hash2 } from './noise'

/** Constantes de forme — contenu de carte, pas d'équilibrage. */
export const PAYS = {
  /**
   * Côté d'une cellule du treillis, EN TUILES ABSOLUES (pas une fraction de la
   * carte). 1200×1800 → 4×6 = 24 sites. 2400×3600 → 8×12 = 96 sites.
   *
   * C'est LE bouton, et c'est aussi la leçon : `POI_PLACEMENT.SPACING_FRAC` est
   * une fraction, et c'est pourquoi la carte cible (2400×3600) porte 69 lieux
   * quand celle du jeu en porte 75 — quatre fois plus de terre, autant de lieux.
   * Une maille relative rend l'échelle gratuite ET vide. Une maille absolue la
   * fait payer.
   */
  CELL_TILES: 300,
  /** Décalage du site dans sa cellule. < 0,5 → il y reste (le balayage local suffit). */
  JITTER: 0.3,
  /**
   * Amplitude du warp des frontières, en tuiles — ce qui les rend organiques.
   *
   * 30 NE SUFFISAIT PAS : sur des cellules de 300, c'est un dixième de maille, et
   * **le treillis se voyait**. Une carte des pays qui ressemble à un carrelage
   * n'est pas une contrée, c'est un cadastre.
   *
   * 80 tord franchement. La borne est le REPLI DU PLAN : le déplacement doit rester
   * injectif, donc sa dérivée doit rester sous 1. La pente maximale d'un `fbm2`
   * vaut environ 2,5 par longueur d'onde ; ici `80 × 2,5 / 380 ≈ 0,53`. On est
   * bien en deçà — la frontière serpente, elle ne se recroise pas.
   */
  WARP_AMP: 80,
  /** Longueur d'onde du warp. Grande devant l'amplitude → pas de repli du plan. */
  WARP_SCALE: 380,
  /** Sur quelle largeur (tuiles) les caractères de deux pays voisins se fondent.
   *  Sans ce fondu, la frontière serait une COUTURE nette — la marque du procédural. */
  BLEND_TILES: 60,
}

/** Un caractère de pays : ce qui le rend reconnaissable sous les pieds. */
export interface Caractere {
  slug: string
  /** Le nom générique. Un qualificatif tiré à la seed s'y ajoute. */
  nom: string
  /** Décalage d'humidité appliqué au champ `wet` de `bandFor`. Le levier n°1 :
   *  il déplace la bande (tourbière ↔ prairie ↔ lande, forêt dense ↔ pinède). */
  wet: number
  /**
   * Décalage d'altitude APPARENTE pour le choix du biome — le levier n°2, et il
   * était indispensable : `bandFor` ne lit l'humidité QU'EN DESSOUS de 0,55. Au
   * dessus (alpage, éboulis, roche, neige), le caractère d'un pays n'avait aucune
   * prise, et tout le haut de la vallée était identique partout.
   *
   * Positif = ce pays paraît plus haut qu'il n'est (le Pierrier gagne son éboulis,
   * sa roche affleure) ; négatif = plus bas (l'Alpage garde sa pelouse là où le
   * voisin n'a plus que des cailloux). **L'altitude RÉELLE ne bouge pas** : ni le
   * relief, ni l'eau, ni le froid, ni le rendu — seul le tapis végétal change. Un
   * pays n'est pas un ascenseur.
   *
   * Volontairement PETIT (±0,04, soit moins de la moitié d'une bande) : au-delà,
   * l'ordre altitude↔terrain — un invariant testé — commencerait à se brouiller.
   */
  elev?: number
  /** Bornes d'altitude de BASE du site — un caractère de fond ne naît pas sur un pic. */
  minElev: number
  maxElev: number
  /** Multiplicateurs de densité des bosquets semés (`paintScatterBiomes`).
   *  C'est ce qui donne à la Vieille Sylve ses gros bois et au Versant Brûlé ses cendres. */
  oldGrowth?: number
  burnt?: number
  boulders?: number
  flowers?: number
}

/**
 * LA TABLE DES CARACTÈRES. Chacun doit être reconnaissable EN MARCHANT, pas
 * seulement vu d'avion : c'est pourquoi le levier est l'humidité (qui change le
 * terrain, donc la vitesse, le couvert, et les lieux qui peuvent y naître) et non
 * une teinte.
 *
 * Les bornes d'altitude se lisent contre `BANDS` (alpinegen.ts) : le fond s'arrête
 * à 0,32, la forêt à 0,55, l'alpage à 0,64, et l'éboulis — dernier terrain
 * praticable — à 0,73. Un site plus haut est un REMPART : la montagne, sans
 * caractère propre.
 */
export const CARACTERES: readonly Caractere[] = [
  // ── LE FOND (< 0,32) — c'est là que la vie se joue ──
  /**
   * LA TOURBIÈRE — À EXEMPLAIRE UNIQUE, et son biais est fort exprès.
   *
   * Elle ne se tire PAS au sort comme les autres : elle naît dans **la cuvette la
   * plus profonde de la vallée** (cf. `derivePays`), et il n'y en a qu'une. Mesuré
   * avant ce changement : deux à SIX Tourbières par carte, et 13 % de la vallée
   * noyée (24 % au pire). Une vallée n'a pas six marais ; elle a UN marais, et on
   * sait où il est.
   *
   * Son biais d'humidité passe de 0,22 à **0,35**, et c'est ce chiffre qui rend le
   * marais IMPOSSIBLE ailleurs — par construction, pas par chance. Hors d'elle,
   * `wet = 0,55 × humidité + 0,115`, et l'humidité est bornée à 1 : donc
   * `wet ≤ 0,665`, toujours. Avec `BANDS.MARSH_WET = 0,67`, aucun pays sans biais
   * ne peut atteindre le marais — pas sur une seed malchanceuse : JAMAIS. Et
   * dedans, +0,35 en fait un vrai marais (≈ 95 % de son fond).
   */
  { slug: 'tourbiere', nom: 'la Tourbière', wet: 0.35, elev: -0.02, minElev: 0, maxElev: 0.32 },
  { slug: 'prairie', nom: 'la Prairie', wet: 0, elev: -0.03, minElev: 0, maxElev: 0.34, flowers: 2.2 },
  { slug: 'lande', nom: 'la Lande', wet: -0.2, elev: 0.02, minElev: 0, maxElev: 0.34, boulders: 1.6 },
  // ── LES PENTES BOISÉES (0,32 – 0,55) ──
  { slug: 'sylve', nom: 'la Vieille Sylve', wet: 0.18, elev: -0.04, minElev: 0.3, maxElev: 0.56, oldGrowth: 6 },
  { slug: 'brule', nom: 'le Versant Brûlé', wet: -0.1, elev: 0.01, minElev: 0.3, maxElev: 0.56, burnt: 7 },
  { slug: 'pinede', nom: 'la Pinède', wet: -0.22, elev: 0.02, minElev: 0.3, maxElev: 0.56 },
  // ── LES HAUTEURS PRATICABLES (0,55 – 0,73) ──
  { slug: 'alpage', nom: 'les Hauts Alpages', wet: 0.05, elev: -0.04, minElev: 0.52, maxElev: 0.7, flowers: 2 },
  { slug: 'pierrier', nom: 'le Pierrier', wet: -0.18, elev: 0.04, minElev: 0.52, maxElev: 0.74, boulders: 2.4 },
]

/** Au-delà, le site est dans la montagne : pas de pays, pas de nom. */
export const REMPART = 0.74

/** Les qualificatifs — c'est eux qui font qu'un lieu se raconte. */
const QUALIFIANTS = [
  'aux Corbeaux', 'du Loup', 'des Cendres', 'du Vieux', 'aux Loutres', 'du Silence',
  'des Brumes', 'du Nord', 'aux Cerfs', 'de la Pierre', 'du Torrent', 'des Ombres',
  'aux Aigles', 'de la Faim', 'du Givre', 'aux Sangliers',
]

export interface Pays {
  id: number
  /** Le site, en tuiles (le centre du pays — là où son nom se pose). */
  x: number
  y: number
  /** `undefined` = un rempart : de la montagne, pas un pays. */
  caractere?: Caractere
  nom: string
}

export interface Contree {
  cols: number
  rows: number
  cellW: number
  cellH: number
  seed: number
  pays: Pays[]
  /** L'`id` de l'UNIQUE Tourbière — la cuvette la plus profonde. `-1` si la carte
   *  n'a aucun site hors des remparts (carte dégénérée). */
  marais: number
}

/**
 * Le semis des sites et le tirage de leur caractère. O(sites) — négligeable.
 * `baseElevation` donne l'altitude d'un point AVANT toute retouche : c'est elle
 * qui décide si un site est un fond, une pente, une hauteur ou un rempart.
 */
export function derivePays(
  width: number,
  height: number,
  seed: number,
  baseElevation: (x: number, y: number) => number,
): Contree {
  const cols = Math.max(2, Math.round(width / PAYS.CELL_TILES))
  const rows = Math.max(2, Math.round(height / PAYS.CELL_TILES))
  const cellW = width / cols
  const cellH = height / rows

  // ── Les sites, et l'altitude de base de chacun ──
  const sites: { id: number; x: number; y: number; el: number }[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const id = j * cols + i
      // Le site : le centre de sa cellule, décalé de moins d'une demi-cellule —
      // il ne peut donc PAS en sortir, ce qui garantit qu'un balayage des cellules
      // voisines suffit à trouver le plus proche.
      const jx = (hash2(i, j, (seed ^ 0x5041) | 0) * 2 - 1) * PAYS.JITTER
      const jy = (hash2(j, i, (seed ^ 0x5942) | 0) * 2 - 1) * PAYS.JITTER
      const x = (i + 0.5 + jx) * cellW
      const y = (j + 0.5 + jy) * cellH
      sites.push({ id, x, y, el: baseElevation(Math.round(x), Math.round(y)) })
    }
  }

  /**
   * LA TOURBIÈRE NAÎT DANS LA CUVETTE LA PLUS PROFONDE — une seule, toujours.
   *
   * On ne la tire pas au sort : elle est une DESTINATION (elle portera la tourbe,
   * et elle sera close). Une vallée n'a pas six marais ; elle a UN marais, et on
   * sait où il est. Le site le plus bas de la vallée est à la fois le plus juste
   * géologiquement (l'eau s'y accumule) et le plus stable (aucun tirage, donc
   * aucune seed malchanceuse où elle n'existerait pas).
   *
   * Départage par `id` croissant à égalité d'altitude — déterministe.
   */
  let marais = -1
  let plusBas = 2
  for (const s of sites) {
    if (s.el >= REMPART) continue // la montagne ne fait pas un marais
    if (s.el < plusBas) { plusBas = s.el; marais = s.id }
  }

  const pays: Pays[] = []
  for (const s of sites) {
    if (s.el >= REMPART) {
      pays.push({ id: s.id, x: s.x, y: s.y, nom: 'les Remparts' }) // la montagne : pas de caractère
      continue
    }
    const q = QUALIFIANTS[Math.min(QUALIFIANTS.length - 1, Math.floor(hash2(seed, s.id, 0x51) * QUALIFIANTS.length))]!
    if (s.id === marais) {
      const t = CARACTERES.find((c) => c.slug === 'tourbiere')!
      pays.push({ id: s.id, x: s.x, y: s.y, caractere: t, nom: `${t.nom} ${q}` })
      continue
    }
    // Tous les autres tirent parmi les caractères que leur altitude autorise —
    // la Tourbière EXCLUE : elle est déjà attribuée, et il n'y en a qu'une.
    const eligibles = CARACTERES.filter(
      (c) => c.slug !== 'tourbiere' && s.el >= c.minElev && s.el <= c.maxElev,
    )
    // Toujours non vide : les tranches se recouvrent et couvrent [0, REMPART).
    const pick = eligibles[Math.min(eligibles.length - 1, Math.floor(hash2(s.id, seed, 0x43) * eligibles.length))]!
    pays.push({ id: s.id, x: s.x, y: s.y, caractere: pick, nom: `${pick.nom} ${q}` })
  }
  return { cols, rows, cellW, cellH, seed, pays, marais }
}

/**
 * À qui appartient cette tuile, et à quel point ? On déforme la position
 * d'interrogation (domain warp) puis on cherche le site le plus proche — d'où des
 * frontières qui serpentent au lieu de polygones.
 *
 * `blend` ∈ [0,1] : 1 au cœur du pays, il tombe vers 0,5 à la frontière. Il sert à
 * FONDRE le caractère du pays avec celui de son voisin le plus proche — sans quoi
 * la frontière serait une couture nette, et le procédural avouerait.
 *
 * Le balayage porte sur les cellules à ±2 : les cellules ne sont pas carrées
 * (400×300 sur la carte du jeu) et le warp déplace le point de 30 tuiles — un
 * voisinage 3×3 raterait parfois le vrai plus proche.
 */
export interface Echantillon {
  pays: Pays
  voisin: Pays
  /** Poids du pays propre, dans [0,5 ; 1]. */
  poids: number
  /** Distance à la frontière la plus proche, en tuiles (0 dessus). */
  marge: number
}

export function paysAt(c: Contree, x: number, y: number): Echantillon {
  const wx = x + PAYS.WARP_AMP * (fbm2(x, y, PAYS.WARP_SCALE, (c.seed ^ 0x1b56c4f9) | 0) * 2 - 1)
  const wy = y + PAYS.WARP_AMP * (fbm2(x, y, PAYS.WARP_SCALE, (c.seed ^ 0x7d2ac03b) | 0) * 2 - 1)
  const ci = Math.floor(wx / c.cellW)
  const cj = Math.floor(wy / c.cellH)

  let best: Pays | undefined
  let bestD = Infinity
  let second: Pays | undefined
  let secondD = Infinity
  for (let j = cj - 2; j <= cj + 2; j++) {
    if (j < 0 || j >= c.rows) continue
    for (let i = ci - 2; i <= ci + 2; i++) {
      if (i < 0 || i >= c.cols) continue
      const p = c.pays[j * c.cols + i]!
      const d = distSq(wx, wy, p.x, p.y)
      if (d < bestD) { secondD = bestD; second = best; bestD = d; best = p }
      else if (d < secondD) { secondD = d; second = p }
    }
  }
  const p = best ?? c.pays[0]!
  const v = second ?? p

  // Distances RÉELLES (la racine est nécessaire ici : on compare un écart à une
  // largeur en tuiles, pas deux distances entre elles). `sqrt` est autorisé.
  const da = Math.sqrt(bestD)
  const db = Math.sqrt(secondD === Infinity ? bestD : secondD)
  // (db − da) = 0 exactement sur la frontière, et croît vers le cœur.
  const t = Math.min(1, (db - da) / PAYS.BLEND_TILES)
  return { pays: p, voisin: v, poids: 0.5 + 0.5 * t, marge: (db - da) / 2 }
}

/**
 * LE CHAMP DES PAYS, CALCULÉ UNE FOIS — qui possède quoi, et à quelle distance de
 * la frontière.
 *
 * `paysAt` coûte deux `fbm2` (six appels de bruit) par interrogation, et trois
 * passes de la génération l'interrogent : les bandes de biome (par tuile), les
 * bosquets (par graine), et désormais les ENCEINTES (qui ont besoin de la distance
 * à la frontière pour y lever une crête). Le payer trois fois serait absurde.
 *
 * LA MARGE EST LA CLÉ DES ENCEINTES. `db − da` (l'écart entre les distances aux
 * deux sites les plus proches) vaut exactement 0 sur la frontière et croît de 2 par
 * tuile quand on s'en éloigne le long de la ligne des sites — donc `(db − da) / 2`
 * EST la distance à la frontière, en tuiles. C'est ce champ qu'on sculpte pour
 * lever un mur de roche là où deux pays se touchent.
 */
export interface ChampPays {
  width: number
  height: number
  /** `id` du pays propriétaire de la tuile. */
  owner: Int32Array
  /** `id` du pays voisin le plus proche (celui d'en face, par-delà la frontière). */
  voisin: Int32Array
  /** Distance à la frontière la plus proche, en tuiles. 0 dessus, croît vers le cœur. */
  marge: Float64Array
}

export function computeChampPays(c: Contree, width: number, height: number): ChampPays {
  const N = width * height
  const owner = new Int32Array(N)
  const voisin = new Int32Array(N)
  const marge = new Float64Array(N)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = paysAt(c, x, y)
      const i = y * width + x
      owner[i] = e.pays.id
      voisin[i] = e.voisin.id
      marge[i] = e.marge
    }
  }
  return { width, height, owner, voisin, marge }
}

/** L'échantillon d'une tuile, lu dans le champ — O(1), zéro bruit. */
export function echantillonAt(c: Contree, f: ChampPays, x: number, y: number): Echantillon {
  const i = y * f.width + x
  const m = marginAt(f, x, y)
  // `poids` se redérive exactement de la marge : × 2 puis ÷ 2 sont exacts en
  // flottant, donc le résultat est identique au bit près à celui de `paysAt`.
  const t = Math.min(1, (2 * m) / PAYS.BLEND_TILES)
  return {
    pays: c.pays[owner(f, x, y)]!,
    voisin: c.pays[f.voisin[i]!]!,
    poids: 0.5 + 0.5 * t,
    marge: m,
  }
}

export const owner = (f: ChampPays, x: number, y: number): number => f.owner[y * f.width + x]!
export const marginAt = (f: ChampPays, x: number, y: number): number => f.marge[y * f.width + x]!

/**
 * Le décalage d'humidité en une tuile — le caractère du pays, fondu avec celui de
 * son voisin près de la frontière. Un rempart n'a pas de caractère : son biais est
 * nul (la montagne est la montagne).
 */
export function wetBiasAt(e: Echantillon): number {
  const a = e.pays.caractere?.wet ?? 0
  const b = e.voisin.caractere?.wet ?? 0
  return e.poids * a + (1 - e.poids) * b
}

/**
 * Le décalage d'altitude APPARENTE — le levier du pays en HAUTEUR, là où
 * l'humidité n'est plus lue par `bandFor` (au-dessus de 0,55). Fondu de la même
 * façon aux frontières. L'altitude réelle n'est jamais touchée : ni le relief, ni
 * l'eau, ni le froid, ni le rendu. Seul le tapis végétal s'y trompe.
 */
export function elevBiasAt(e: Echantillon): number {
  const a = e.pays.caractere?.elev ?? 0
  const b = e.voisin.caractere?.elev ?? 0
  return e.poids * a + (1 - e.poids) * b
}

/**
 * Les toponymes des pays — de PETITES zones posées au centre de chaque pays, pas
 * des rectangles qui le couvriraient.
 *
 * C'est délibéré : `zoneAt` (map.ts) rend la PREMIÈRE zone contenant le point, et
 * le survol de la carte s'en sert pour nommer ce qu'on montre. Une zone à la
 * taille du pays masquerait tous les lieux et tous les gués qu'il contient — le
 * joueur survolerait une Grotte et lirait « la Tourbière ». Un nom de pays est une
 * ÉTIQUETTE, posée en son cœur, comme sur une carte d'état-major.
 *
 * Sans `kind` : c'est un toponyme, donc la carte le montre dès le premier jour —
 * on cache les LIEUX, jamais la forme du pays (spec `lieux.md`).
 */
export function paysToponymes(c: Contree, map: WorldMap): Zone[] {
  const out: Zone[] = []
  const r = 6
  for (const p of c.pays) {
    if (!p.caractere) continue // les remparts ne se nomment pas
    const x = Math.max(0, Math.min(map.width - 2 * r - 1, Math.round(p.x) - r))
    const y = Math.max(0, Math.min(map.height - 2 * r - 1, Math.round(p.y) - r))
    out.push({ name: p.nom, x, y, w: 2 * r + 1, h: 2 * r + 1 })
  }
  return out
}
