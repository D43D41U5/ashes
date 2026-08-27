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
 * Une par écran au plus, jamais deux — pas de la fumée partout. Une fumerolle fréquente ferait
 * un banc de brouillard permanent et tuerait la lisibilité de ce qui doit rester une TERRE NUE.
 * C'est le même parti que les charniers : espacées, et donc des repères.
 *
 * ⚠ « Trois ou quatre par foyer » a longtemps été écrit ici, et c'était une INTENTION prise pour
 * une mesure : le semis n'en donnait qu'une et demie au jour 240 (mesuré le 2026-08-25). Le
 * réglage porte désormais ses vrais nombres et l'instrument qui les rend — voir `MAILLE`.
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
import { auCoeurDeLaCendre, cadranDeFoyer, caracteresDeLaCarte, estSolCendre, foyerDeLaTuile } from './cendre'
import { TERRAINS, TERRAIN_BURNT_FOREST } from './balance'
import type { WorldMap } from './map'
import type { ResourceNode } from './economy'

export const FUMEROLLE = {
  /**
   * ═══ LE SEMIS — RESSERRÉ D'UN FACTEUR 4 (Alexis, 2026-08-25 : « il n'y a pas assez de
   * fumerolles dans les cendres ») ═══
   *
   * `MAILLE` est le côté d'une maille en tuiles (une fumerolle au plus par maille) et `PART` la
   * fraction des mailles qui en portent une. Ensemble, ils font d'elles un LIEU ou une texture.
   *
   * CE QUI A DÉCIDÉ DU CHIFFRE, ET IL N'ÉTAIT PAS LISIBLE DANS LE CODE. « Une maille de 56, une
   * sur trois » ne dit pas combien on en croise : la cendre n'a pris qu'une part de la vallée, et
   * c'est ELLE le dénominateur. MESURÉ (`tools/diag-fumerolle.mts`, seed 2026, dix foyers) sous
   * l'ancien semis : **3 bouches dans toute la vallée au jour 120, 16 au jour 240** — soit UNE
   * POUR ~14 000 TUILES DE CENDRE, c'est-à-dire une tous les dix-neuf écrans. On pouvait traverser
   * la cendrière d'un bout à l'autre sans en voir une seule. Ce n'était pas de la rareté, c'était
   * une absence.
   *
   * À 48 / 0,80 : **15 bouches au jour 120, 69 au jour 240**, une pour ~3 200 tuiles — une tous
   * les quatre écrans et demi. Et la promesse d'origine tient TOUJOURS, parce qu'elle a cessé
   * d'être un espoir : l'écart minimal est désormais DÉRIVÉ (voir `JEU`) et mesuré à 38-44 tuiles
   * à tous les horizons, soit plus d'un écran. Elles restent des repères ; elles ne sont plus
   * un mythe.
   *
   * ⚠ C'EST AUSSI UN CHANGEMENT DE DIFFICULTÉ, PAS SEULEMENT DE DÉCOR — voir `FROID`. La part du
   * cœur de la cendre qui tombe sous un souffle froid passe de ~1 % à ~5 % (rayon 7, jour 240).
   * C'est borné, mais ce sont autant de puits de froid qui réveillent les Cendreux en été.
   *
   * ⚠ ET LA DENSITÉ SE PAIE EN RÉGULARITÉ, PAS EN ESPACEMENT. C'est le choix qui a été fait ici,
   * et il est explicite : voir `JEU`.
   */
  MAILLE: 48,
  PART: 0.8,

  /**
   * LA PART DE LA MAILLE OÙ LA BOUCHE PEUT TOMBER — et c'est ELLE qui tient la promesse « une
   * seule à la fois », pas la maille.
   *
   * Le tirage court sur la fraction CENTRALE de la maille, donc deux voisines de mailles
   * adjacentes ne peuvent jamais s'approcher à moins de `MAILLE × (1 − JEU)` : le plancher
   * d'écart est DÉRIVÉ, il n'est pas espéré. À `0,25`, il vaut 36 tuiles sur une maille de 48 —
   * exactement la largeur d'un écran (`ECRAN_TUILES`), et c'est de là que le nombre vient.
   *
   * ⚠ C'EST LE PRIX DE LA DENSITÉ, ET IL FAUT LE DIRE : resserrer le jeu REND LE SEMIS PLUS
   * RÉGULIER. Il valait 0,50 quand les bouches étaient quatre fois plus rares — on pouvait
   * s'offrir du désordre parce que deux voisines ne se rencontraient jamais. À densité haute, le
   * désordre et l'espacement se disputent la même maille : on garde l'ESPACEMENT (qui est la
   * promesse) et on paie en régularité. Ce qui casse la grille, ce sont les 20 % de mailles
   * VIDES (`PART`) — sans elles, ce serait un treillis.
   */
  JEU: 0.25,

  /** La largeur d'un écran, en tuiles — l'étalon de l'espacement (mémoire : un rayon se juge
   *  contre le CADRE, jamais contre l'art). Il ne sert qu'à dériver et à garder `JEU`. */
  ECRAN_TUILES: 36,

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
function placeDeLaBouche(seed: number, mx: number, my: number): { tx: number; ty: number } {
  const sel = (seed ^ 0x46554d45) | 0 /* 'FUME' */
  const M = FUMEROLLE.MAILLE
  // ⚠ LE TIRAGE EST BORNÉ AU CŒUR DE LA MAILLE. Sans ça, deux bouches de mailles voisines peuvent
  //   tomber de part et d'autre de leur bord commun : MESURÉ, des voisines à 21 tuiles, soit deux
  //   fumerolles dans le MÊME écran — la promesse « un lieu, pas une texture » tombait sur la
  //   queue de la distribution. Borné à `JEU`, l'écart minimal vaut `M × (1 − JEU)` : il est
  //   DÉRIVÉ de la maille, et il ne peut pas se démentir quand la maille bouge.
  const J = FUMEROLLE.JEU
  const bord = M * ((1 - J) / 2)
  const dx = Math.floor(bord + hash2(mx, my, (sel ^ 0x1111) | 0) * M * J)
  const dy = Math.floor(bord + hash2(mx, my, (sel ^ 0x2222) | 0) * M * J)
  return { tx: mx * M + dx, ty: my * M + dy }
}

/**
 * ═══ …ET CETTE MAILLE EN PORTE-T-ELLE UNE ? — LE CARACTÈRE DU FOYER PÈSE ICI (`cendre.md` R21) ═══
 *
 * La PLACE se tire d'abord, la PART se teste ensuite : il faut savoir QUELLE fosse tient la
 * tuile pour savoir de combien sa part est multipliée. À caractère neutre le tirage est
 * identique au précédent, bit pour bit — la Salée sature à 1 (aucune maille vide), la Gueule
 * tombe à 0,24.
 *
 * ⚠ **LE CARACTÈRE MODULE LA PART, JAMAIS LA PORTE.** Le seuil d'éveil reste
 * `auCoeurDeLaCendre` chez l'appelant : une Gueule fume peu, elle ne fume pas ailleurs.
 *
 * ⚠ **ET IL SE LIT SUR LE TERRITOIRE STATIQUE (`foyerDeLaTuile`), JAMAIS SUR LE FRONT** — voir
 * `cendre.ts` : gater sur « la cendre est-elle arrivée » faisait se REFERMER des bouches déjà
 * ouvertes, en laissant leur nœud derrière.
 */
function bouchePotentielle(
  map: WorldMap,
  seed: number,
  mx: number,
  my: number,
): { tx: number; ty: number } | null {
  const b = placeDeLaBouche(seed, mx, my)
  const k = foyerDeLaTuile(map, b.tx, b.ty)
  const f = cadranDeFoyer(caracteresDeLaCarte(map, seed), k, 'fumerolles')
  const part = FUMEROLLE.PART * f
  const sel = (seed ^ 0x46554d45) | 0 /* 'FUME' */
  if (hash2(mx, my, sel) >= (part > 1 ? 1 : part)) return null
  return b
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
      const b = bouchePotentielle(map, seed, mx, my)
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
  const b = bouchePotentielle(map, seed, Math.floor(tx / M), Math.floor(ty / M))
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
    // LE SOUFFLE SUIT LE CARACTÈRE DE SA FOSSE (R21) — la Muette souffle 40 % plus froid.
    const k = foyerDeLaTuile(map, b.tx, b.ty)
    const froid = FUMEROLLE.FROID * cadranDeFoyer(caracteresDeLaCarte(map, seed), k, 'froid')
    const f = froid * (1 - d / R)
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
      const b = bouchePotentielle(map, seed, mx, my)
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
    // LE STOCK SUIT LE CARACTÈRE DE SA FOSSE (R21) — la Salée rend trois fois plus de sel. C'est
    // LÀ que sa promesse se tient : `PART` valant déjà 0,80, la multiplier ne rendait que +25 %
    // de bouches, tandis que `SEL_STOCK` a toute la place qu'il faut.
    const k = foyerDeLaTuile(map, b.tx, b.ty)
    const sel = Math.round(stock * cadranDeFoyer(caracteresDeLaCarte(map, seed), k, 'sel'))
    nodes.push({ id, type: 'fumerolle', tx: b.tx, ty: b.ty, stock: sel, regrowAt: 0 })
    ouvertes += 1
  }
  return ouvertes
}
