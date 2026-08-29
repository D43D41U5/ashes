/**
 * ═══ LA CHARBONNIÈRE — CE QUE LA CENDRE REND (spec `cendre.md` R25) ═══
 *
 * *Décision d'Alexis, 2026-08-27 (piste ④ du catalogue de l'écosystème) : « le charbon de bois est
 * le combustible de forge du pauvre ». R24 lui a donné son USAGE (deux charbons fondent un lingot
 * de fer) ; R25 lui donne sa GÉOGRAPHIE.*
 *
 * ═══ POURQUOI ELLE EXISTE ═══
 *
 * R14 promet que **« la cendre tire autant qu'elle pousse »**. Depuis R22/R23, la cendre mûre est
 * le pire sol de la vallée — plus froide, pleine de morts — et elle ne rendait toujours **rien**.
 * La charbonnière est la contrepartie : un fût calciné qu'on écharbonne, dans le cœur, là où le
 * danger est le plus haut.
 *
 * ═══ LES QUATRE CHOIX QUI LA DÉFINISSENT ═══
 *
 *   ① **SUR LA FORÊT BRÛLÉE, ET NULLE PART AILLEURS.** Le cœur RECYCLE les sols de la Cendrière
 *      (R11a) : ce qui était boisé y devient `TERRAIN_BURNT_FOREST`. La charbonnière ne pousse
 *      donc que là où il y avait du BOIS — la cendre de pré ne rend pas de charbon. La géographie
 *      d'avant continue de commander celle d'après, ce qui donne au joueur une carte à lire.
 *   ② **AU CŒUR PROFOND (bande CROÛTE et au-delà, > `NUE_TUILES`).** La frange est déjà
 *      exploitable (R14 : on y coupe avant que ça brûle) et la bande nue reste vide EXPRÈS
 *      (R20). Le charbon commence donc là où la cendre a PRIS — un aller-retour, pas une
 *      cueillette de bordure.
 *   ③ **NON RENOUVELABLE, et c'est R15 qui le dicte** — rien ne repousse dans la cendre. Chaque
 *      foyer est un GISEMENT FINI : on le vide, il ne revient pas. C'est ce qui empêche la
 *      charbonnière de devenir une rente et garde la cendre du côté du « on y VA » plutôt que du
 *      « on y VIT ». Elle se distingue en cela de la fumerolle, qui est une tournée.
 *   ④ **À MAINS NUES, la hache aidant.** Le geste n'est pas le sujet — c'est d'avoir osé venir
 *      qui l'est (le mot de la fumerolle, et il vaut deux fois ici, sous R23).
 *
 * ═══ DÉRIVÉE, COMME TOUT LE RESTE DE LA CENDRE ═══
 *
 * Semis positionnel par `hash2` (maille + part) × un prédicat dérivé — le gabarit littéral de la
 * fumerolle. Aucune passe de worldgen : la charbonnière **apparaît au fil de la corruption**, et
 * son id se tire de sa maille, donc son stock survit à une reprise de partie.
 *
 * Pur et déterministe : `+ - * /`, `floor`, `min`, `max` (invariant n°2).
 */
import { TERRAIN_BURNT_FOREST } from './balance'
import { BANDE_CROUTE, bandeDeCendre, terrainCendre } from './cendre'
import type { ResourceNode } from './economy'
import type { WorldMap } from './map'
import { hash2 } from './noise'

export const CHARBONNIERE = {
  /**
   * LE CÔTÉ D'UNE MAILLE, en tuiles — au plus une charbonnière par maille.
   *
   * **24, la moitié de la maille des fumerolles (48).** Elles sont plus communes qu'une bouche :
   * une fumerolle est un LIEU (on la voit de loin, elle ancre la Brume), une charbonnière est une
   * RESSOURCE — on vient en chercher plusieurs, sinon le voyage ne paie pas son danger. Mais elle
   * reste plus rare qu'un arbre : ce n'est pas une forêt, c'est un cimetière de fûts.
   *
   * **CALIBRÉE SUR LE TOTAL, pas sur l'espacement** (`tools/diag-charbonniere.mts`, seed 2026) —
   * une charbonnière étant un gisement FINI, ce qui compte est ce que la vallée porte en tout :
   *
   *     maille 32 : j.240 → 12 fûts (30 lingots) · j.600 → 38 · j.1200 → 74
   *     maille 24 : j.240 → 36 fûts (90 lingots) · j.600 → 87 · j.1200 → 136   ← retenue
   *     maille 16 : j.240 → 68 fûts (170 lingots) · j.600 → 199 · j.1200 → 307
   *
   * À 32, la fosse la plus riche n'en portait **qu'une à trois** en milieu de partie : on ne fait
   * pas un voyage dans le pire sol de la vallée pour deux charbons. À 24, elle en porte **jusqu'à
   * dix** — une expédition. À 16, la cendre devenait une exploitation, et l'acier n'aurait plus
   * eu de raison d'être minier.
   */
  MAILLE: 24,
  /** La part des mailles qui en portent une. À 0,55, un peu plus d'une maille sur deux : le semis
   *  garde des trous, donc des directions qui rendent plus que d'autres. */
  PART: 0.55,
  /** La part du CŒUR de la maille où la place se tire — le même verrou que `FUMEROLLE.JEU` :
   *  sans lui, deux charbonnières de mailles voisines peuvent se coller de part et d'autre de
   *  leur bord commun. L'écart minimal vaut `MAILLE × (1 − JEU)`, donc il suit la maille. */
  JEU: 0.6,
  /**
   * CE QU'UN FÛT REND, en charbons. **5, soit deux lingots et demi** (R24 : deux charbons par
   * lingot) — une charbonnière ne fait pas un outil à elle seule, il en faut une poignée.
   * `NODE_DEFS.charbonniere.stock` en dérive, et une garde confronte les deux.
   */
  STOCK: 5,
} as const

/**
 * ═══ L'ESPACE D'IDS — dérivé de la POSITION, jamais de `max + 1` ═══
 *
 * Même axiome que la fumerolle et le filon de la Brume : un id est FIXE, tiré de la maille. La
 * même charbonnière garde le sien d'une partie à l'autre, donc son stock ENTAMÉ est stable à la
 * reprise — ce qui compte double pour un gisement qui ne repousse pas.
 *
 * ⚠ La base est distincte de celle des fumerolles (2 000 000), et l'écart couvre toute carte
 * jouable : une carte de 2,5 M de tuiles ne fait que ~2 500 mailles de 32.
 */
const CHARBONNIERE_ID_BASE = 3_000_000

export function idDeCharbonniere(map: WorldMap, tx: number, ty: number): number {
  const M = CHARBONNIERE.MAILLE
  return CHARBONNIERE_ID_BASE + Math.floor(ty / M) * Math.ceil(map.width / M) + Math.floor(tx / M)
}

/**
 * CE SOL PORTE-T-IL DU BOIS BRÛLÉ, une fois la cendre passée ? — soit il l'est déjà (la
 * Cendrière d'origine), soit il le DEVIENDRA au cœur (`terrainCendre` sur du boisé).
 */
function futCalcine(t: number | undefined): boolean {
  if (t === undefined) return false
  return t === TERRAIN_BURNT_FOREST || terrainCendre(t, true) === TERRAIN_BURNT_FOREST
}

/** Où tomberait la charbonnière de cette maille — la place est fixe, la maille en porte une ou non. */
function placeDuFut(seed: number, mx: number, my: number): { tx: number; ty: number } {
  const sel = (seed ^ 0x43484152) | 0 /* 'CHAR' */
  const M = CHARBONNIERE.MAILLE
  const J = CHARBONNIERE.JEU
  const bord = M * ((1 - J) / 2)
  const dx = Math.floor(bord + hash2(mx, my, (sel ^ 0x1111) | 0) * M * J)
  const dy = Math.floor(bord + hash2(mx, my, (sel ^ 0x2222) | 0) * M * J)
  return { tx: mx * M + dx, ty: my * M + dy }
}

/** …et cette maille en porte-t-elle une ? (deux tirages : la place, puis la part — même ordre que
 *  la fumerolle, pour que les deux semis se lisent pareil). */
function futPotentiel(seed: number, mx: number, my: number): { tx: number; ty: number } | null {
  const b = placeDuFut(seed, mx, my)
  const sel = (seed ^ 0x43484152) | 0 /* 'CHAR' */
  if (hash2(mx, my, sel) >= CHARBONNIERE.PART) return null
  return b
}

/**
 * CETTE TUILE PORTE-T-ELLE UNE CHARBONNIÈRE ? — le sol, puis la bande.
 *
 * ⚠ **LE TERRAIN DÉCIDE, ET C'EST LE SEUL PRÉDICAT QUI REGARDE LE SOL** : `TERRAIN_BURNT_FOREST`
 * est le sol que le cœur donne à ce qui était BOISÉ (`terrainCendre`, R11a). Une cendre de pré, un
 * chaos de blocs ou une roche n'en portent pas. C'est ce qui fait qu'une expédition au charbon se
 * PRÉPARE : on va vers l'ancienne forêt, pas n'importe où dans le gris.
 *
 * ⚠⚠ **ET ON NE LIT PAS `map.terrain` EN FACE — LA CENDRE N'Y EST JAMAIS ÉCRITE.** Elle est
 * DÉRIVÉE du tick, du premier au dernier jour (« zéro octet dans le `SimState` ») : la carte
 * garde son sol d'ORIGINE pour toujours, et c'est `terrainCendre` qui dit ce que ce sol DEVIENT
 * une fois pris. La première écriture comparait `map.terrain[i]` à `TERRAIN_BURNT_FOREST` et
 * rendait **zéro charbonnière sur toute la carte** — la garde A30 l'a attrapée du premier coup.
 * On demande donc au sol d'origine ce qu'il rendrait au cœur ; la Cendrière, elle, est DÉJÀ du
 * brûlé, et elle compte aussi (c'est la plus vieille cendre de la vallée).
 */
export function charbonniereIci(
  map: WorldMap,
  tx: number,
  ty: number,
  avancees: readonly number[],
  seed: number,
): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  if (!futCalcine(map.terrain[ty * map.width + tx])) return false
  const M = CHARBONNIERE.MAILLE
  const b = futPotentiel(seed, Math.floor(tx / M), Math.floor(ty / M))
  if (!b || b.tx !== tx || b.ty !== ty) return false
  return bandeDeCendre(map, tx, ty, avancees, seed) >= BANDE_CROUTE
}

/**
 * TOUTES LES CHARBONNIÈRES DE LA CARTE — le balayage complet, pour le tick journalier et les
 * sondes. Le coût est celui des mailles (~2 500 sur une carte de production), pas des tuiles.
 */
export function toutesLesCharbonnieres(
  map: WorldMap,
  avancees: readonly number[],
  seed: number,
): { tx: number; ty: number }[] {
  const M = CHARBONNIERE.MAILLE
  const out: { tx: number; ty: number }[] = []
  for (let my = 0; my <= Math.floor((map.height - 1) / M); my++) {
    for (let mx = 0; mx <= Math.floor((map.width - 1) / M); mx++) {
      const b = futPotentiel(seed, mx, my)
      if (!b) continue
      if (b.tx >= map.width || b.ty >= map.height) continue
      if (!futCalcine(map.terrain[b.ty * map.width + b.tx])) continue
      if (bandeDeCendre(map, b.tx, b.ty, avancees, seed) < BANDE_CROUTE) continue
      out.push(b)
    }
  }
  return out
}

/**
 * LES CHARBONNIÈRES QUE LA CENDRE VIENT D'ATTEINDRE deviennent des nœuds — rend combien s'en
 * sont ouvertes. Patron littéral de `ouvrirLesFumerolles`, y compris ses deux prudences :
 *
 *   · une tuile ne porte qu'un nœud, donc une charbonnière sous un arbre encore debout ATTEND
 *     que la cendre l'ait fait tomber (R13). Rien ne se perd, elle s'ouvrira un autre jour ;
 *   · un id déjà connu ne se rouvre jamais.
 *
 * ⚠ **ET C'EST CE QUI REND LE GISEMENT FINI, SANS UN OCTET D'ÉTAT.** Un nœud vidé n'est jamais
 * RETIRÉ de `state.nodes` (`depleteNode` le laisse à `stock 0`) : la charbonnière épuisée reste
 * donc là, connue, et le semis passe son chemin. C'est `NodeDef.fini` qui lui interdit en plus de
 * repousser — la même marque `regrowAt = 0` que le défrichement, celle que le client sait déjà
 * lire pour ne pas animer une pousse qui n'arrivera jamais.
 */
export function ouvrirLesCharbonnieres(
  nodes: ResourceNode[],
  map: WorldMap,
  avancees: readonly number[],
  seed: number,
): number {
  if (!map.cendreCout) return 0
  const futs = toutesLesCharbonnieres(map, avancees, seed)
  if (futs.length === 0) return 0
  const connus = new Set<number>()
  for (const n of nodes) if (n.type === 'charbonniere') connus.add(n.id)
  const occupees = new Set<number>()
  for (const n of nodes) occupees.add(n.ty * map.width + n.tx)
  let ouvertes = 0
  for (const f of futs) {
    const id = idDeCharbonniere(map, f.tx, f.ty)
    if (connus.has(id)) continue
    if (occupees.has(f.ty * map.width + f.tx)) continue
    nodes.push({ id, type: 'charbonniere', tx: f.tx, ty: f.ty, stock: CHARBONNIERE.STOCK, regrowAt: 0 })
    ouvertes += 1
  }
  return ouvertes
}
