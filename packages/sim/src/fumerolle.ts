/**
 * ═══ LES FUMEROLLES — des trous qui fument FROID (décision d'Alexis, 2026-08-24) ═══
 *
 * *« j'aimerais qu'on ajoute des fumerolles dans les biomes de cendrières. Des trous qui émettent
 * de la fumée froide. »* Puis, sur les quatre pistes proposées : *« fais tout »*.
 *
 * Elles font donc QUATRE choses à la fois, et c'est ce qui les justifie — un décor de plus n'aurait
 * pas mérité un fichier :
 *
 *   ① ELLES SE VOIENT — un trou et sa colonne de fumée, au cœur de la corruption (`clutter`).
 *   ② ELLES REFROIDISSENT — un terme local dans `froidDuMonde`, à la place que le cortège de
 *     l'ancien front a laissée vide. Le cœur devient traversable, pas habitable.
 *   ③ ELLES DÉPOSENT DU SEL — la seule raison d'ALLER dans la cendre. Le sel était différé depuis
 *     le 2026-07-12 ; `peche.md` note que c'est le séchage qui porte la conserve, faute de lui.
 *   ④ ELLES SONT L'ANCRE DE LA BRUME — et ça, c'est le rachat. Depuis le retrait du front, la
 *     Brume ne se lève plus : son corridor s'élisait sur la bande qui le précédait. Or sa propre
 *     spec dit *« une nappe de froid létal SORT DE LA CENDRIÈRE »* — les fumerolles sont
 *     littéralement les trous par où elle sort. Un système entier revient pour le prix d'un point.
 *
 * ═══ UN LIEU, PAS UNE TEXTURE ═══
 *
 * Trois ou quatre par foyer, repérables à un écran — pas de la fumée partout. Une fumerolle
 * fréquente ferait un banc de brouillard permanent et tuerait la lisibilité de ce qui doit rester
 * une TERRE NUE. C'est le même parti que les charniers : rares, et donc des repères.
 *
 * ═══ ZÉRO ÉTAT, ZÉRO PASSE DE WORLDGEN ═══
 *
 * Une fumerolle n'est pas posée : elle se DÉRIVE. Un semis positionnel (hash par maille) dit où
 * elles pourraient être ; le cœur de la cendre dit lesquelles sont réveillées. Elles apparaissent
 * donc au fil de la corruption sans qu'on ait rien semé ni rangé — et le client les retrouve en
 * appelant les mêmes fonctions, comme pour tout le reste de la cendre.
 *
 * Pur et déterministe : `hash2`, `+ - * /`, `floor` (invariant n°2).
 */
import { hash2 } from './noise'
import { auCoeurDeLaCendre, estSolCendre } from './cendre'
import { TERRAINS, TERRAIN_BURNT_FOREST } from './balance'
import type { WorldMap } from './map'
import type { ResourceNode } from './economy'

export const FUMEROLLE = {
  /**
   * LA MAILLE DU SEMIS, en tuiles — une fumerolle au plus par maille. C'est le réglage qui fait
   * d'elles un LIEU et non une texture.
   *
   * MESURÉ (seed 2026, dix foyers) : **1,1 fumerolle par foyer à la fin de l'an 1**, 4,6 au jour
   * 240, 8,6 à l'an 7 — elles naissent avec la corruption, comme elle. Voisines : 28 tuiles au
   * minimum (MESURÉ après le resserrement du tirage — un écran en fait 36), 66 en médiane.
   */
  MAILLE: 56,

  /**
   * LA PART DES MAILLES QUI EN PORTENT UNE. À 0,30, une maille sur trois — les deux autres
   * laissent la terre nue, qui est le sujet. *Ordre de grandeur, à regarder sur une carte.*
   */
  PART: 0.3,

  /**
   * LE RAYON DE SON SOUFFLE, en tuiles — ce que le froid et la fumée couvrent. 7 : on la voit
   * venir, on la contourne d'un pas de côté. Ce n'est pas une zone, c'est un obstacle.
   */
  RAYON: 7,

  /**
   * LE FROID AU TROU, en degrés retirés à la température de base. ⚠ **CE NOMBRE RÉVEILLE LES
   * MORTS** : `CENDREUX.TORPEUR` lit le froid de base (éveil nul à +6 °C, plein à −14 °C), donc
   * une fumerolle rend les Cendreux actifs autour d'elle **même en été**. C'est assumé — Alexis a
   * pris la piste en connaissance de cause — mais c'est LE bouton à tourner si le cœur de la
   * cendre devient invivable : à 9, une fumerolle creuse un puits de froid net sans faire tomber
   * la vallée entière d'une saison.
   */
  FROID: 9,

  /** Le stock de sel d'une fumerolle. Bas : on y revient, on ne la vide pas en une fois. */
  SEL_STOCK: 4,
} as const

/**
 * Y A-T-IL UNE FUMEROLLE À CETTE MAILLE, et où ? — la position est fixe pour une maille donnée.
 *
 * On tire DEUX fois : une fois pour « cette maille en porte-t-elle une », une fois pour sa place
 * dans la maille. Sans le second tirage, toutes les fumerolles tomberaient sur la même fraction de
 * leur maille et le semis se lirait comme une grille.
 */
function bouchePotentielle(seed: number, mx: number, my: number): { tx: number; ty: number } | null {
  const sel = (seed ^ 0x46554d45) | 0 /* 'FUME' */
  if (hash2(mx, my, sel) >= FUMEROLLE.PART) return null
  const M = FUMEROLLE.MAILLE
  // ⚠ LE TIRAGE EST BORNÉ AU CŒUR DE LA MAILLE (le quart central de chaque côté). Sans ça, deux
  //   bouches de mailles voisines peuvent tomber de part et d'autre de leur bord commun : MESURÉ,
  //   des voisines à 21 tuiles, soit deux fumerolles dans le MÊME écran — la promesse « un lieu,
  //   pas une texture » tombait sur la queue de la distribution. Borné, l'écart minimal vaut la
  //   demi-maille (28 tuiles), et le semis reste irrégulier au regard.
  const dx = Math.floor(M * 0.25 + hash2(mx, my, (sel ^ 0x1111) | 0) * M * 0.5)
  const dy = Math.floor(M * 0.25 + hash2(mx, my, (sel ^ 0x2222) | 0) * M * 0.5)
  return { tx: mx * M + dx, ty: my * M + dy }
}

/** Cette tuile PEUT-elle porter une fumerolle ? Il faut un sol de cendre, et qu'on puisse y venir. */
function solTenable(map: WorldMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const t = map.terrain[ty * map.width + tx]
  if (t === undefined) return false
  // Le sol d'origine peut être n'importe quoi : c'est la CENDRE qui décide, et elle est dérivée.
  // On exige seulement que la tuile se marche — une fumerolle dans une falaise ne se visite pas.
  return TERRAINS[t]?.walkable === true || t === TERRAIN_BURNT_FOREST || estSolCendre(t)
}

/**
 * LES FUMEROLLES ÉVEILLÉES autour d'un point, dans un rayon donné (en tuiles).
 *
 * Une bouche n'existe que si le CŒUR de la corruption l'a atteinte : elles apparaissent donc au
 * fil de la cendre, sans qu'on ait rien semé. On balaie les mailles qui touchent la zone demandée
 * — jamais la carte : le coût ne dépend que du rayon.
 */
export function fumerollesAutour(
  map: WorldMap,
  cx: number,
  cy: number,
  rayon: number,
  avancees: readonly number[],
  seed: number,
): { tx: number; ty: number }[] {
  const M = FUMEROLLE.MAILLE
  const out: { tx: number; ty: number }[] = []
  const m0x = Math.floor((cx - rayon) / M)
  const m1x = Math.floor((cx + rayon) / M)
  const m0y = Math.floor((cy - rayon) / M)
  const m1y = Math.floor((cy + rayon) / M)
  for (let my = m0y; my <= m1y; my++) {
    for (let mx = m0x; mx <= m1x; mx++) {
      const b = bouchePotentielle(seed, mx, my)
      if (!b) continue
      if (!solTenable(map, b.tx, b.ty)) continue
      // ⚠ AU CŒUR SEULEMENT : une fumerolle sur la frange fumerait sur un sol encore tiède, et le
      //   joueur la verrait naître sous ses pieds. Elles disent le PROFOND.
      if (!auCoeurDeLaCendre(map, b.tx, b.ty, avancees, seed)) continue
      out.push(b)
    }
  }
  return out
}

/** Y a-t-il une fumerolle EXACTEMENT ici ? (le rendu et la récolte le demandent par tuile) */
export function fumerolleIci(
  map: WorldMap,
  tx: number,
  ty: number,
  avancees: readonly number[],
  seed: number,
): boolean {
  const M = FUMEROLLE.MAILLE
  const b = bouchePotentielle(seed, Math.floor(tx / M), Math.floor(ty / M))
  if (!b || b.tx !== tx || b.ty !== ty) return false
  return solTenable(map, tx, ty) && auCoeurDeLaCendre(map, tx, ty, avancees, seed)
}

/**
 * LE FROID D'UNE FUMEROLLE en un point — en degrés à RETIRER, `0` si aucune ne souffle ici.
 *
 * Une PENTE continue du trou vers le bord de son souffle : le joueur sent le froid monter en
 * approchant, il ne le prend pas en pleine figure au franchissement d'un cercle. C'est la même
 * exigence que partout ailleurs (`CENDREUX.TORPEUR` : « jamais de seuil qui commande »).
 *
 * On ne garde que la PLUS FROIDE des bouches proches — deux fumerolles côte à côte ne cumulent
 * pas leur souffle en un point mortel ; elles font une zone plus large, ce qui est plus lisible.
 */
export function froidDeFumerolle(
  map: WorldMap,
  x: number,
  y: number,
  avancees: readonly number[],
  seed: number,
): number {
  if (!map.cendreCout) return 0
  const R = FUMEROLLE.RAYON
  const bouches = fumerollesAutour(map, Math.floor(x), Math.floor(y), R, avancees, seed)
  let pire = 0
  for (const b of bouches) {
    const dx = b.tx + 0.5 - x
    const dy = b.ty + 0.5 - y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d >= R) continue
    const f = FUMEROLLE.FROID * (1 - d / R)
    if (f > pire) pire = f
  }
  return pire
}

/**
 * TOUTES LES FUMEROLLES ÉVEILLÉES DE LA CARTE. Bon marché : on balaie les MAILLES, pas les tuiles
 * — une carte de production en compte ~420, contre 1,3 million de tuiles.
 */
export function toutesLesFumerolles(
  map: WorldMap,
  avancees: readonly number[],
  seed: number,
): { tx: number; ty: number }[] {
  const M = FUMEROLLE.MAILLE
  const out: { tx: number; ty: number }[] = []
  if (!map.cendreCout) return out
  const mx1 = Math.floor((map.width - 1) / M)
  const my1 = Math.floor((map.height - 1) / M)
  for (let my = 0; my <= my1; my++) {
    for (let mx = 0; mx <= mx1; mx++) {
      const b = bouchePotentielle(seed, mx, my)
      if (!b) continue
      if (b.tx >= map.width || b.ty >= map.height) continue
      if (!solTenable(map, b.tx, b.ty)) continue
      if (!auCoeurDeLaCendre(map, b.tx, b.ty, avancees, seed)) continue
      out.push(b)
    }
  }
  return out
}

/**
 * ═══ L'ESPACE D'IDS DES FUMEROLLES — dérivé de la POSITION, jamais de `max + 1` ═══
 *
 * Même axiome que le filon de la Brume : un id est FIXE. Ici il se tire de la maille — deux
 * fumerolles n'en partagent jamais, et la même bouche garde le sien d'une partie à l'autre, ce qui
 * rend son stock et sa repousse stables à la reprise.
 */
const FUMEROLLE_ID_BASE = 2_000_000

export function idDeFumerolle(map: WorldMap, tx: number, ty: number): number {
  const M = FUMEROLLE.MAILLE
  const mx = Math.floor(tx / M)
  const my = Math.floor(ty / M)
  return FUMEROLLE_ID_BASE + my * Math.ceil(map.width / M) + mx
}

/**
 * LES FUMEROLLES QUI VIENNENT DE S'ÉVEILLER SE POSENT — une fois par bascule de jour.
 *
 * ⚠ ELLES SONT DES NŒUDS, et pas seulement un prédicat, parce qu'on les RÉCOLTE : le stock, la
 * repousse, l'usure et l'épuisement sont déjà écrits pour les nœuds. Réinventer une récolte
 * dérivée aurait été une seconde loi — le patron du filon de la Brume, exactement.
 *
 * Rend le nombre de bouches ouvertes ce jour-là.
 */
export function ouvrirLesFumerolles(
  nodes: ResourceNode[],
  map: WorldMap,
  avancees: readonly number[],
  seed: number,
  stock: number,
): number {
  if (!map.cendreCout) return 0
  const bouches = toutesLesFumerolles(map, avancees, seed)
  if (bouches.length === 0) return 0
  const connus = new Set<number>()
  for (const n of nodes) if (n.type === 'fumerolle') connus.add(n.id)
  const occupees = new Set<number>()
  for (const n of nodes) occupees.add(n.ty * map.width + n.tx)
  let ouvertes = 0
  for (const b of bouches) {
    const id = idDeFumerolle(map, b.tx, b.ty)
    if (connus.has(id)) continue
    // Une tuile ne porte qu'un nœud : si quelque chose occupe déjà la bouche, elle attendra que
    // la cendre l'ait fait tomber (R13). Rien ne se perd, la fumerolle s'ouvrira plus tard.
    if (occupees.has(b.ty * map.width + b.tx)) continue
    nodes.push({ id, type: 'fumerolle', tx: b.tx, ty: b.ty, stock, regrowAt: 0 })
    ouvertes += 1
  }
  return ouvertes
}
