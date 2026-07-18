/**
 * LA CONSTRUCTION ÉMERGENTE (spec `docs/specs/construction.md`).
 *
 * TRANCHE 1 — l'invariant de NAVIGABILITÉ (R7). Les tranches suivantes (Forge,
 * Atelier, Grenier, Ferme) grefferont ici la reconnaissance d'amas (R9), le
 * palier par contenu (R10) et la détection d'enceinte (R14).
 *
 * Tout y est PUR et à ordre de parcours FIXE : déterministe, donc compatible avec
 * l'invariant de rejeu au bit près (§7). On y prend des FORMES minimales (`{tx,ty,
 * type}`, `{x,y,hp}`) plutôt que les types `Structure`/`Entity` — pour rester
 * découplé de `village.ts`/`sim.ts` (aucun cycle d'import) et directement testable.
 */
import { BALANCE, COMPONENT_TYPES, FUNCTIONS, TERRAINS, type ComponentType, type FunctionId } from './balance'
import { emitEvent } from './events'
import { chebyshev } from './geometry'
import { terrainAt, type WorldMap } from './map'
import type { StructureType } from './items'
import type { SimState } from './sim'

/** La forme minimale d'une structure posée, pour les vérifs de navigabilité. */
export interface PlacedStructure {
  tx: number
  ty: number
  type: StructureType
}

/**
 * Cette structure BLOQUE-t-elle le passage, pour l'invariant de navigabilité (R7) ?
 *
 * Murs, Feu, coffres et composants (four, atelier…) BLOQUENT ; portes, sols et
 * toits laissent passer — les pièces molles ne comptent pas (R14), et la porte est
 * ce qui rend une enceinte navigable (on entre dans sa forge). La maison reste
 * franchissable (héritage V3). NB : distinct de `structureBlocks` (village.ts), qui
 * dépend du déplaceur (une porte s'ouvre pour les membres) ; ici la vue est absolue.
 */
export function blocksNavigation(type: StructureType): boolean {
  return type !== 'door' && type !== 'floor' && type !== 'roof' && type !== 'house'
}

const tileIndex = (map: WorldMap, tx: number, ty: number): number => ty * map.width + tx

/**
 * Flood-fill des tuiles PASSABLES atteignables depuis le Feu, borné à `region`,
 * en 4-connexité et à ordre de parcours FIXE. Le Feu sert d'AMORCE (sa tuile bloque,
 * mais on part de là) ; on ne s'étend que vers des tuiles marchables non bloquées.
 *
 * `blocked` = index des tuiles portant une structure bloquante. Retourne l'ensemble
 * des index de tuiles VISITÉES (Feu compris) — une tuile bloquante n'y entre jamais,
 * mais on saura la dire « atteignable » si l'un de ses voisins l'est (adjacence).
 */
function floodFromFire(
  map: WorldMap,
  blocked: ReadonlySet<number>,
  region: { x0: number; y0: number; x1: number; y1: number },
  fireTx: number,
  fireTy: number,
): Set<number> {
  const visited = new Set<number>()
  const inRegion = (tx: number, ty: number): boolean => tx >= region.x0 && tx <= region.x1 && ty >= region.y0 && ty <= region.y1
  const passable = (tx: number, ty: number): boolean =>
    inRegion(tx, ty) && !blocked.has(tileIndex(map, tx, ty)) && (TERRAINS[terrainAt(map, tx, ty)]?.walkable ?? false)

  const start = tileIndex(map, fireTx, fireTy)
  visited.add(start)
  // File FIFO explicite (pas de récursion) — ordre de parcours reproductible.
  const queue: { tx: number; ty: number }[] = [{ tx: fireTx, ty: fireTy }]
  // Voisinage à ordre FIXE (N, S, O, E) : le déterminisme du flood-fill en dépend.
  const NEIGHBORS = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ] as const
  for (let head = 0; head < queue.length; head++) {
    const { tx, ty } = queue[head]!
    for (const { dx, dy } of NEIGHBORS) {
      const nx = tx + dx
      const ny = ty + dy
      const idx = tileIndex(map, nx, ny)
      if (visited.has(idx)) continue
      if (!passable(nx, ny)) continue
      visited.add(idx)
      queue.push({ tx: nx, ty: ny })
    }
  }
  return visited
}

/** Une structure est-elle ADJACENTE (4-voisins) à une tuile visitée ? (on peut s'en approcher) */
function adjacentReachable(map: WorldMap, visited: ReadonlySet<number>, tx: number, ty: number): boolean {
  return (
    visited.has(tileIndex(map, tx, ty - 1)) ||
    visited.has(tileIndex(map, tx, ty + 1)) ||
    visited.has(tileIndex(map, tx - 1, ty)) ||
    visited.has(tileIndex(map, tx + 1, ty))
  )
}

/**
 * L'INVARIANT DE NAVIGABILITÉ (spec construction R7). La pose d'une structure
 * BLOQUANTE `add` est-elle sûre ? On REFUSE tout ce qui déconnecterait le Feu du
 * « dehors », isolerait un composant, ou piégerait un PNJ. C'est la contrepartie
 * qui rend le placement libre sûr : on ne peut pas murer son propre Feu.
 *
 * Méthode : flood-fill des passables atteignables depuis le Feu, AVANT et APRÈS la
 * pose (bornés au carré du Feu + une marge = le « dehors »). On refuse si un ANCRE
 * atteignable AVANT ne l'est plus APRÈS — le dehors, tout composant, tout PNJ vivant
 * de la zone. Le comparatif avant/après évite de punir une poche de terrain
 * préexistante (eau, falaise) qu'aucun mur n'a créée.
 *
 * Poser une pièce NON bloquante (porte, sol, toit) est toujours sûr : on sort tout de
 * suite. C'est ce qui fait de la PORTE la clé d'une enceinte navigable.
 */
export function placementKeepsNavigable(
  map: WorldMap,
  structures: readonly PlacedStructure[],
  entities: readonly { id: number; x: number; y: number; hp: number }[],
  actingId: number,
  fire: { tx: number; ty: number },
  radius: number,
  add: PlacedStructure,
): boolean {
  if (!blocksNavigation(add.type)) return true

  const region = {
    x0: Math.max(0, fire.tx - (radius + 1)),
    y0: Math.max(0, fire.ty - (radius + 1)),
    x1: Math.min(map.width - 1, fire.tx + (radius + 1)),
    y1: Math.min(map.height - 1, fire.ty + (radius + 1)),
  }

  const blockedBefore = new Set<number>()
  for (const s of structures) if (blocksNavigation(s.type)) blockedBefore.add(tileIndex(map, s.tx, s.ty))
  const blockedAfter = new Set<number>(blockedBefore)
  blockedAfter.add(tileIndex(map, add.tx, add.ty))

  const before = floodFromFire(map, blockedBefore, region, fire.tx, fire.ty)
  const after = floodFromFire(map, blockedAfter, region, fire.tx, fire.ty)

  // ANCRE 1 — le DEHORS : la couronne de tuiles au bord du carré (Chebyshev = radius+1).
  // Si le Feu la touchait avant et ne la touche plus, on l'a muré (ou muré le composant).
  for (let ty = region.y0; ty <= region.y1; ty++) {
    for (let tx = region.x0; tx <= region.x1; tx++) {
      if (chebyshev(tx, ty, fire.tx, fire.ty) !== radius + 1) continue
      const idx = tileIndex(map, tx, ty)
      if (before.has(idx) && !after.has(idx)) return false
    }
  }

  // ANCRE 2 — les COMPOSANTS : chacun doit rester accostable depuis le Feu.
  for (const s of structures) {
    if (!isComponent(s.type)) continue
    if (adjacentReachable(map, before, s.tx, s.ty) && !adjacentReachable(map, after, s.tx, s.ty)) return false
  }

  // ANCRE 3 — les PNJ : on ne piège personne (sauf le bâtisseur, libre de s'emmurer).
  for (const e of entities) {
    if (e.id === actingId || e.hp <= 0) continue
    const idx = tileIndex(map, Math.floor(e.x), Math.floor(e.y))
    if (before.has(idx) && !after.has(idx)) return false
  }

  return true
}

/** L'ensemble des types de COMPOSANTS (dérivé de `COMPONENTS`, source unique). */
const COMPONENT_SET = new Set<StructureType>(COMPONENT_TYPES)

/** Cette structure est-elle un COMPOSANT ? (les barrières et le Feu n'en sont pas). */
export function isComponent(type: StructureType): boolean {
  return COMPONENT_SET.has(type)
}

// ─── LA RECONNAISSANCE D'AMAS & DE FONCTIONS (spec construction R9-R10, R14) ──

/** La forme minimale d'une structure pour la reconnaissance (découplé de `Structure`). */
export interface RecogStructure {
  id: number
  type: StructureType
  tx: number
  ty: number
  villageId: number
}

/**
 * UNE FONCTION RECONNUE (spec construction R9-R10). Émerge d'un AMAS ; son `tier`
 * est la richesse de l'amas ; elle est ANCRÉE au composant primaire (identité stable
 * quand on enrichit/appauvrit l'amas). `enclosed` = murée + toitée (R13-R14).
 */
export interface RecognizedFunction {
  functionId: FunctionId
  tier: number
  /** Tuile du composant PRIMAIRE (ancre). */
  tx: number
  ty: number
  villageId: number
  enclosed: boolean
  /** Les tuiles des composants de l'AMAS (triées) — le Grenier y branche sa
   *  conservation, et le client y trace le liseré (R22). */
  componentTiles: { tx: number; ty: number }[]
}

/** Ordre de tri des tuiles : par y puis x — l'ordre CANONIQUE, déterministe. */
function tileBefore(a: { tx: number; ty: number }, b: { tx: number; ty: number }): boolean {
  return a.ty !== b.ty ? a.ty < b.ty : a.tx < b.tx
}

/**
 * Regroupe les composants en AMAS (spec construction R9) : deux composants à ≤
 * `AMAS_RADIUS` (Chebyshev) sont dans le même amas (transitif — flood-fill). Ordre
 * de parcours FIXE (composants triés par tuile d'abord) : déterministe (§7).
 */
function clusterComponents(components: readonly RecogStructure[]): RecogStructure[][] {
  const sorted = [...components].sort((a, b) => (tileBefore(a, b) ? -1 : tileBefore(b, a) ? 1 : 0))
  const amasList: RecogStructure[][] = []
  const assigned = new Set<number>() // index dans `sorted`
  const r = BALANCE.AMAS_RADIUS
  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) continue
    const amas: RecogStructure[] = []
    const queue = [i]
    assigned.add(i)
    for (let head = 0; head < queue.length; head++) {
      const cur = sorted[queue[head]!]!
      amas.push(cur)
      for (let k = 0; k < sorted.length; k++) {
        if (assigned.has(k)) continue
        const other = sorted[k]!
        if (chebyshev(cur.tx, cur.ty, other.tx, other.ty) <= r) {
          assigned.add(k)
          queue.push(k)
        }
      }
    }
    amasList.push(amas)
  }
  return amasList
}

/**
 * LES FONCTIONS RECONNUES dans l'état courant (spec construction R9-R10). PURE et
 * déterministe : mêmes structures → mêmes fonctions, dans le même ordre. Chaque amas
 * peut porter PLUSIEURS fonctions (une forge ET un atelier se touchent, R9) ; deux
 * amas distincts = deux fonctions (pas d'unicité, R11).
 */
export function recognizeFunctions(structures: readonly RecogStructure[]): RecognizedFunction[] {
  const components = structures.filter((s) => isComponent(s.type))
  const amasList = clusterComponents(components)
  const result: RecognizedFunction[] = []
  const functionIds = Object.keys(FUNCTIONS) as FunctionId[]
  for (const amas of amasList) {
    const present = new Set<ComponentType>(amas.map((c) => c.type as ComponentType))
    for (const functionId of functionIds) {
      const def = FUNCTIONS[functionId]
      // Palier = plus haut T dont la recette (cumulative) est satisfaite.
      let tier = 0
      for (let t = 0; t < def.recipeByTier.length; t++) {
        if (def.recipeByTier[t]!.every((ct) => present.has(ct))) tier = t + 1
        else break
      }
      if (tier === 0) continue
      // Ancre = tuile canonique du composant PRIMAIRE (recipeByTier[0][0]).
      const primary = def.recipeByTier[0]![0]!
      const anchors = amas.filter((c) => c.type === primary)
      const anchor = anchors.reduce((best, c) => (tileBefore(c, best) ? c : best))
      result.push({
        functionId,
        tier,
        tx: anchor.tx,
        ty: anchor.ty,
        villageId: anchor.villageId,
        enclosed: def.enclosureBonus !== null && isEnclosed(amas, structures),
        componentTiles: amas.map((c) => ({ tx: c.tx, ty: c.ty })),
      })
    }
  }
  // Tri canonique (fonction, ancre) — un flux d'événements stable au rejeu.
  return result.sort(
    (a, b) =>
      a.functionId < b.functionId ? -1 : a.functionId > b.functionId ? 1 : tileBefore(a, b) ? -1 : tileBefore(b, a) ? 1 : 0,
  )
}

/**
 * L'AMAS EST-IL CLOS + TOITÉ (spec construction R13-R14) ? Flood-fill de l'INTÉRIEUR
 * depuis les composants, en traversant tout SAUF les murs et portes (la clôture) ; on
 * plafonne à `ENCLOSURE_CAP` tuiles. Débordé (pas de clôture) → non clos. Clos, l'amas
 * est TOITÉ si chaque tuile intérieure est COUVERTE : un toit, ou un solide (composant/
 * coffre/Feu) qui tient lieu de couverture. Une tuile nue ou un simple sol = un trou.
 * Déterministe (ordre de parcours fixe).
 */
function isEnclosed(amas: readonly RecogStructure[], structures: readonly RecogStructure[]): boolean {
  const CAP = 400
  const wallDoor = new Set<string>()
  const byTile = new Map<string, RecogStructure>()
  for (const s of structures) {
    const k = `${s.tx},${s.ty}`
    if (s.type === 'wall' || s.type === 'door') wallDoor.add(k)
    // Une tuile ne porte qu'un solide (invariant 1-structure/tuile) ; on indexe le
    // premier rencontré — suffit pour dire « couverte » (toit/composant/coffre/Feu).
    if (!byTile.has(k)) byTile.set(k, s)
  }
  const interior = new Set<string>()
  const queue: { tx: number; ty: number }[] = []
  for (const c of amas) {
    const k = `${c.tx},${c.ty}`
    if (!interior.has(k)) {
      interior.add(k)
      queue.push({ tx: c.tx, ty: c.ty })
    }
  }
  const NEI = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ] as const
  for (let head = 0; head < queue.length; head++) {
    if (interior.size > CAP) return false // débordé : pas de clôture
    const { tx, ty } = queue[head]!
    for (const { dx, dy } of NEI) {
      const nx = tx + dx
      const ny = ty + dy
      const k = `${nx},${ny}`
      if (interior.has(k) || wallDoor.has(k)) continue
      interior.add(k)
      queue.push({ tx: nx, ty: ny })
    }
  }
  // Clos (borné) : chaque tuile intérieure doit être COUVERTE.
  for (const k of interior) {
    const s = byTile.get(k)
    const covered = s !== undefined && (s.type === 'roof' || isComponent(s.type) || s.type === 'chest' || s.type === 'fire')
    if (!covered) return false
  }
  return true
}

/** Clé d'identité d'une fonction reconnue : (fonction, ancre). Stable tant que le
 *  composant primaire reste en place — enrichir/appauvrir l'amas la conserve. */
function functionKey(f: RecognizedFunction): string {
  return `${f.functionId}@${f.tx},${f.ty}`
}

/**
 * RECALCULE les fonctions reconnues et ÉMET les changements (spec construction R9-R10).
 * Appelée à chaque mutation de structure (pose/démolition/destruction). Diff par
 * identité (fonction, ancre) : une fonction NOUVELLE, montée/descendue de palier, ou
 * dont l'enceinte bascule → `function_changed` ; une fonction DISPARUE → `tier` 0.
 * `state.functions` est l'état canonique (dans le snapshot).
 */
export function refreshFunctions(state: SimState): void {
  const next = recognizeFunctions(state.structures)
  const prev = state.functions
  const prevByKey = new Map(prev.map((f) => [functionKey(f), f]))
  const nextKeys = new Set(next.map(functionKey))
  const emit = (f: RecognizedFunction, tier: number): void => {
    emitEvent(state, {
      type: 'function_changed',
      tick: state.tick,
      functionId: f.functionId,
      villageId: f.villageId,
      tx: f.tx,
      ty: f.ty,
      tier,
      enclosed: tier > 0 && f.enclosed,
    })
  }
  for (const f of next) {
    const p = prevByKey.get(functionKey(f))
    if (p === undefined || p.tier !== f.tier || p.enclosed !== f.enclosed) emit(f, f.tier)
  }
  for (const p of prev) {
    if (!nextKeys.has(functionKey(p))) emit(p, 0) // perdue
  }
  state.functions = next
}
