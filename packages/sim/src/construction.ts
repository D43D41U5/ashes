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
import { TERRAINS } from './balance'
import { chebyshev } from './geometry'
import { terrainAt, type WorldMap } from './map'
import type { StructureType } from './items'

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

/**
 * Les types de COMPOSANTS (atomes actifs d'une fonction, spec construction R8).
 * VIDE en tranche 1 — la Forge (tranche 2) y ajoutera l'enclume, le four d'acier,
 * etc. Un `Set` local (pas dans le SimState) : simple test d'appartenance.
 */
const COMPONENT_TYPES = new Set<StructureType>()

/** Cette structure est-elle un COMPOSANT ? (les barrières et le Feu n'en sont pas). */
export function isComponent(type: StructureType): boolean {
  return COMPONENT_TYPES.has(type)
}
