/**
 * LE DIFF DES NŒUDS POUR LA SAUVEGARDE — le second palier du gel de la Veillée.
 *
 * ── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────────
 *
 * MESURÉ le 2026-07-28 dans le Worker du navigateur : sortir la carte de l'autosave a
 * ramené la sauvegarde de 69,7 à 9,20 Mo et le gel du monde de ~2,45 s à ~0,2 s. Sur ces
 * 9,20 Mo restants, **9,12 sont les nœuds** — 125 686 objets réécrits deux fois par minute
 * alors qu'entre deux sauvegardes, une poignée seulement a bougé : celles qu'on a récoltées.
 *
 * Le reste (entités, structures, villages, monstres, PNJ…) tient dans 0,03 Mo.
 *
 * ── CE QUI BOUGE, ET CE QUI NAÎT AVEC LE MONDE ──────────────────────────────────
 *
 * Un nœud a une part FIXE — `id`, `type`, `tx`, `ty` : il ne se déplace pas, ne change pas
 * d'essence. Et une part MOBILE — `stock`, `regrowAt`, `depletions`, `forgetAt`. Seule la
 * seconde a une raison d'être réécrite ; la première s'écrit une fois, avec la carte, dans
 * le même enregistrement de naissance du monde.
 *
 * ── POURQUOI CE CODE VIT DANS /sim (même raison que `node-shadow.ts`) ───────────
 *
 * Ce n'est pas de la logique de jeu, et ça n'a rien à faire dans un seul hôte : la
 * persistance serveur (PostgreSQL, write-behind — Phase Vallée) aura exactement le même
 * besoin, et deux copies auraient divergé. C'est de la mécanique de sérialisation, pure,
 * sans horloge ni E/S — elle passe le garde-fou de pureté sans exception.
 *
 * ── CE SUR QUOI LE RECOLLAGE REPOSE ─────────────────────────────────────────────
 *
 * `state.nodes` n'est JAMAIS réordonné. Les quatre seuls écrits du dépôt sont des `filter`
 * (`cendre.ts:235`, `poi-batis.ts:296`, `worldgen.ts:29` — qui préservent l'ordre) et un
 * `push` (`poi-batis.ts:390` — qui ajoute à la fin). La liste courante est donc toujours
 * « la base, moins des disparus, plus des nouveaux à la fin », et se reconstruit exactement.
 *
 * Ce n'est pas une hypothèse qu'on documente : le diff porte l'EMPREINTE de la suite
 * d'identifiants attendue, et `appliqueDiffNoeuds` REFUSE de rendre une liste qui ne lui
 * correspond pas. Le jour où un système triera les nœuds, la reprise criera au lieu de
 * rendre un monde silencieusement décalé — et c'est alors ce fichier qu'il faudra revoir.
 */
import type { ResourceNode } from './economy'

/** Ce qui BOUGE dans un nœud — le reste naît avec le monde et ne change plus. */
export interface NoeudMuable {
  id: number
  stock: number
  regrowAt: number
  /** Absents la plupart du temps, et VRAIMENT absents : le monde les `delete` quand il oublie. */
  depletions?: number
  forgetAt?: number
}

/** Ce qui a changé depuis la base écrite au disque. */
export interface DiffNoeuds {
  /** Les nœuds dont l'état mobile a bougé (récolte, repousse, épuisement oublié). */
  bouges: NoeudMuable[]
  /** Les identifiants de ceux qui n'existent plus — la Cendre en dévore par milliers. */
  disparus: number[]
  /** Ceux NÉS depuis la base : les lieux bâtis en posent, l'agriculture en posera. */
  nes: ResourceNode[]
  /** Empreinte de la suite d'identifiants attendue après recollage (voir l'en-tête). */
  empreinte: number
}

/**
 * L'ÉTAT MOBILE DE LA BASE, en tableaux typés indexés par `id` — jamais dans `SimState`.
 *
 * Même choix, et pour la même raison mesurée, que `node-shadow.ts` : une `Map` de 125 686
 * entrées coûtait douze millisecondes par balayage là où un tableau typé en coûte moins
 * d'une. Ici le balayage n'a lieu qu'à la sauvegarde (toutes les 30 s), mais garder une
 * COPIE des 125 686 objets aurait pesé des dizaines de mégaoctets de tas pour rien.
 */
export interface BaseNoeuds {
  /** Ce nœud figurait-il dans la base ? (1 = oui) */
  connu: Uint8Array
  stock: Float64Array
  regrowAt: Float64Array
  /** −1 = le champ était ABSENT (distinct de 0, qui ne se produit pas : le monde `delete`). */
  depletions: Float64Array
  forgetAt: Float64Array
}

/** −1 marque un champ optionnel absent — un `depletions` vaut 1 au minimum quand il existe. */
const ABSENT = -1

function tailleParId(nodes: readonly ResourceNode[]): number {
  let max = -1
  for (const n of nodes) if (n.id > max) max = n.id
  return max + 1
}

/** Relève l'état mobile d'une liste de nœuds — la référence contre laquelle on diffe ensuite. */
export function baseDepuisNoeuds(nodes: readonly ResourceNode[]): BaseNoeuds {
  const n = tailleParId(nodes)
  const base: BaseNoeuds = {
    connu: new Uint8Array(n),
    stock: new Float64Array(n),
    regrowAt: new Float64Array(n),
    depletions: new Float64Array(n).fill(ABSENT),
    forgetAt: new Float64Array(n).fill(ABSENT),
  }
  for (const nd of nodes) {
    base.connu[nd.id] = 1
    base.stock[nd.id] = nd.stock
    base.regrowAt[nd.id] = nd.regrowAt
    base.depletions[nd.id] = nd.depletions ?? ABSENT
    base.forgetAt[nd.id] = nd.forgetAt ?? ABSENT
  }
  return base
}

/**
 * L'empreinte d'une SUITE d'identifiants. `Math.imul` et les entiers 32 bits sont dans les
 * opérations autorisées à /sim : elle vaut la même chose sur Node et dans un navigateur.
 * L'indice entre dans le mélange — deux mêmes nœuds dans un autre ordre ne donnent pas la
 * même empreinte, et c'est précisément ce qu'on veut attraper.
 */
function empreinteDesIds(nodes: readonly ResourceNode[]): number {
  let h = 0x811c9dc5
  for (let i = 0; i < nodes.length; i++) {
    h = (Math.imul(h ^ (i + 0x9e3779b9), 0x85ebca6b) ^ Math.imul(nodes[i]!.id | 0, 0xc2b2ae35)) | 0
  }
  return (h ^ nodes.length) >>> 0
}

/** Ce qui a changé entre la base et l'état courant. Ne modifie ni l'une ni l'autre. */
export function diffNoeuds(nodes: readonly ResourceNode[], base: BaseNoeuds): DiffNoeuds {
  const bouges: NoeudMuable[] = []
  const nes: ResourceNode[] = []
  const vivant = new Uint8Array(base.connu.length)

  for (const nd of nodes) {
    if (nd.id >= base.connu.length || base.connu[nd.id] === 0) {
      nes.push(nd) // né depuis la base : il part en entier, on n'a rien à quoi le comparer
      continue
    }
    vivant[nd.id] = 1
    const dep = nd.depletions ?? ABSENT
    const oub = nd.forgetAt ?? ABSENT
    if (
      base.stock[nd.id] !== nd.stock ||
      base.regrowAt[nd.id] !== nd.regrowAt ||
      base.depletions[nd.id] !== dep ||
      base.forgetAt[nd.id] !== oub
    ) {
      const m: NoeudMuable = { id: nd.id, stock: nd.stock, regrowAt: nd.regrowAt }
      if (nd.depletions !== undefined) m.depletions = nd.depletions
      if (nd.forgetAt !== undefined) m.forgetAt = nd.forgetAt
      bouges.push(m)
    }
  }

  const disparus: number[] = []
  for (let id = 0; id < base.connu.length; id++) {
    if (base.connu[id] === 1 && vivant[id] === 0) disparus.push(id)
  }

  return { bouges, disparus, nes, empreinte: empreinteDesIds(nodes) }
}

/**
 * Recolle la base et son diff. JETTE si le résultat ne correspond pas à l'empreinte —
 * on ne rend JAMAIS un monde à moitié compris (même doctrine que `deserializeSim`).
 *
 * Les nœuds retouchés sont rebâtis dans l'ORDRE CANONIQUE des clés (`id, type, tx, ty,
 * stock, regrowAt`, puis `depletions`, puis `forgetAt`) — celui dans lequel le monde les
 * crée, et celui dans lequel il les remet après les avoir oubliés. Sans ça, un nœud
 * épuisé-puis-pardonné-puis-ré-épuisé se relirait avec ses clés dans un autre ordre.
 */
export function appliqueDiffNoeuds(base: readonly ResourceNode[], diff: DiffNoeuds): ResourceNode[] {
  const partis = new Set(diff.disparus)
  const parId = new Map(diff.bouges.map((m) => [m.id, m]))

  const out: ResourceNode[] = []
  for (const nd of base) {
    if (partis.has(nd.id)) continue
    const m = parId.get(nd.id)
    if (!m) {
      out.push(nd)
      continue
    }
    const refait: ResourceNode = { id: nd.id, type: nd.type, tx: nd.tx, ty: nd.ty, stock: m.stock, regrowAt: m.regrowAt }
    if (m.depletions !== undefined) refait.depletions = m.depletions
    if (m.forgetAt !== undefined) refait.forgetAt = m.forgetAt
    out.push(refait)
  }
  for (const nd of diff.nes) out.push(nd)

  const vue = empreinteDesIds(out)
  if (vue !== diff.empreinte) {
    throw new Error(
      `Nœuds irrecollables : la suite d'identifiants ne correspond pas (${vue} ≠ ${diff.empreinte}, ${out.length} nœuds). ` +
        "Un système a réordonné `state.nodes` — voir l'en-tête de `node-baseline.ts`.",
    )
  }
  return out
}
