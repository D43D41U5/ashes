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
import { BALANCE, FUNCTIONS, TERRAIN_SHALLOW_WATER, TERRAINS, type ComponentType, type FunctionId } from './balance'
import { STRUCTURE_TYPES, bloqueNavigation, isComponent, piece } from './pieces'
import { emitEvent } from './events'
import { chebyshev, EDGE_E, EDGE_N, EDGE_S, edgeBits, edgeStep, isSingleEdge, oppositeEdge } from './geometry'
import { terrainAt, type WorldMap } from './map'
import type { StructureType } from './items'
import type { SimState } from './sim'

/** La forme minimale d'une structure posée, pour les vérifs de navigabilité. */
export interface PlacedStructure {
  tx: number
  ty: number
  type: StructureType
  /** Les ARÊTES portées (bits N/E/S/O), si c'est un mur mince. Absent = la tuile entière.
   *  `murs()` en dépend, et donc les deux remplissages : une pose d'arête doit pouvoir se
   *  soumettre au même verdict de navigabilité qu'une pose pleine tuile. */
  edges?: number
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
  return bloqueNavigation(type)
}

/**
 * ═══ CE QU'ON BÂTIT SUR L'EAU LIBRE — une LISTE, pas une exception ═══
 *
 * Décision d'Alexis (2026-07-31) : l'eau peu profonde est INCONSTRUCTIBLE, sauf le sol.
 *
 * Elle ne l'était pas. Le gué est `walkable` (on le traverse à mi-jambes, à vitesse 0,5) et
 * toutes les portes de pose ne demandaient QUE ça — si bien qu'on plantait son feu de camp
 * dans la rivière, qu'on y fondait son Foyer, qu'on y posait sa forge et sa parcelle de
 * ferme. Les deux sites qui portaient le test l'écrivaient pourtant noir sur blanc,
 * `// eau, roche…` : l'intention était là, seule l'eau PROFONDE la recevait.
 *
 * Et c'est une LISTE parce que la question va se rouvrir : le pont, le ponton, la passerelle
 * sont des pièces dont le sens même est de se poser sur l'eau. Le jour où elles arrivent,
 * elles s'ajoutent ici — on ne rouvre pas la porte de terrain.
 *
 * Le SOL y est déjà : c'est la seule pièce qui porte sa propre assise (des planches sur
 * l'eau), et la seule qui ne bloque rien.
 */
export const POSABLE_SUR_EAU: readonly StructureType[] = STRUCTURE_TYPES.filter((t) => piece(t).eau)

/**
 * L'UNIQUE PORTE DE TERRAIN de la construction (spec construction R5).
 *
 * Les quatre gestes de pose du joueur — `place_campfire`, `build`, `place_component`,
 * `light_fire` — la traversent, et le fantôme du client la partage : une seule vérité,
 * donc aucun fantôme vert là où la sim refuse.
 *
 * NB : `walkable` reste le premier filtre, donc l'eau PROFONDE refuse tout, sol compris —
 * c'est le comportement d'avant, inchangé. Le jour où un PONT doit enjamber la rivière
 * profonde, c'est cette ligne-ci qu'on rouvre, et elle seule.
 *
 * NB2 : le marais, la tourbière et la roselière (terrains 8/18/19) restent constructibles.
 * Ils sont mouillés, mais ce sont des SOLS — le rendu les peint au grain de sol, quand le
 * gué, lui, passe au shader d'eau. On ne bâtit pas dans ce qu'on voit couler.
 */
export function terrainConstructible(terrain: number, type: StructureType): boolean {
  if (!TERRAINS[terrain]?.walkable) return false // roche, falaise, glacier, eau profonde, vide
  if (terrain !== TERRAIN_SHALLOW_WATER) return true // terre ferme (marais compris)
  return POSABLE_SUR_EAU.includes(type)
}

/**
 * ═══ L'OCCUPATION EST À QUATRE COUCHES, PLUS À TROIS ═══
 *
 * Une tuile portait un SOL, un TOIT et un SOLIDE — trois couches, une pièce chacune. Depuis que
 * le joueur pose sur les ARÊTES, il y en a une quatrième, et elle n'appartient même pas tout à
 * fait à la tuile : **les quatre arêtes**, qu'elle partage avec ses quatre voisines.
 *
 * `solidAt` (village.ts) rendait « la première structure qui n'est ni sol ni toit », ce qui
 * attrape un mur d'arête. Trois portes de pose s'y adossaient, et le branchement du mode arête
 * les cassait toutes les trois d'un coup — sans qu'aucune ne LÈVE, elles auraient juste refusé :
 *   • le COIN d'une pièce, qui porte deux arêtes, devenait impossible à fermer (la deuxième pose
 *     trouvait la première et disait « tuile occupée ») ;
 *   • on ne pouvait plus ADOSSER un four ni un coffre à son propre mur ;
 *   • ni planter un feu de camp contre une clôture.
 *
 * D'où ces deux questions, exactes chacune sur sa couche. Elles prennent la FORME minimale
 * (`{tx, ty, type, edges?}`) pour rester sans cycle d'import avec `village.ts`.
 */
export interface EdgeAware {
  tx: number
  ty: number
  type: StructureType
  edges?: number
}

/** La structure qui prend cette tuile ENTIÈRE — ni sol, ni toit, ni mur d'arête. */
export function fullTileAt<T extends EdgeAware>(structures: readonly T[], tx: number, ty: number): T | undefined {
  // « Prend la tuile ENTIÈRE » = la COUCHE déclarée au registre est `tuile` (ni sol, ni toit),
  // et la pièce ne vit pas sur une arête.
  return structures.find((s) => s.tx === tx && s.ty === ty && piece(s.type).occupe === 'tuile' && s.edges === undefined)
}

/**
 * LA BARRIÈRE QUI PORTE CETTE ARÊTE — vue des DEUX CÔTÉS, et c'est tout l'enjeu.
 *
 * Le mur entre (5,5) et (5,6) s'écrit « (5,5) + SUD » ou « (5,6) + NORD » : même maçonnerie,
 * deux adresses (`edgeBits`). La collision le sait depuis toujours (elle consulte le voisin) ;
 * la POSE devait l'apprendre, sinon le joueur qui contourne son mur et vise depuis l'autre côté
 * le rebâtit une seconde fois — **il paie deux fois, et deux sprites se superposent dans une
 * bande de 8 px**. Rien ne l'aurait dit : les deux structures sont parfaitement légales.
 *
 * On ne CANONISE pas l'adresse pour autant (« toute arête se stocke en S ou en E ») : la Ferme
 * générée pose ses murs sur la tuile du DEHORS, une convention qui porte du sens de jeu, et la
 * découpe de façade la lit. La question symétrique suffit et ne perturbe rien en aval.
 */
export function edgeBarrierAt<T extends EdgeAware>(
  structures: readonly T[], tx: number, ty: number, bit: number,
): T | undefined {
  const { dx, dy } = edgeStep(bit)
  const oppose = oppositeEdge(bit)
  const nx = tx + dx
  const ny = ty + dy
  for (const s of structures) {
    if (s.edges === undefined) continue
    if (s.tx === tx && s.ty === ty && (s.edges & bit) !== 0) return s
    if (s.tx === nx && s.ty === ny && (s.edges & oppose) !== 0) return s
  }
  return undefined
}

/**
 * ═══ LA PORTE DOUBLE — une DÉRIVATION, pas une pièce (spec construction R27) ═══
 *
 * « Un seul cadre, 2 battants se rejoignant au centre » (Alexis, 2026-08-01). Le modèle n'a ni
 * largeur ni multi-tuile — une structure est `{tx,ty}` + `edges`, et la porte charretière des
 * villages PNJ est DÉJÀ deux vantaux adjacents (`village-plan.ts`). La porte double n'est donc
 * pas un type qu'on pose : elle se LIT — deux `door` sur des arêtes colinéaires adjacentes
 * forment une paire, que le rendu dessine en un seul cadre et que `toggle_door` pousse ensemble.
 *
 * L'ADRESSE CANONIQUE, d'abord : une arête a deux adresses (voir `edgeBarrierAt`), donc deux
 * vantaux mitoyens peuvent s'écrire « (x,y)+S » et « (x+1,y+1)+N » — même ligne physique, aucune
 * tuile commune. On ramène chaque porte au COIN NORD-OUEST de son arête (S → la tuile du
 * dessous, E → la tuile de droite) : deux arêtes sont colinéaires adjacentes si leurs adresses
 * canoniques se suivent le long de leur propre axe — X pour une arête horizontale (bits N/S),
 * Y pour une verticale (bits E/O). C'est ce qui rend l'horizontal et le vertical symétriques.
 *
 * LA FILE DOIT COMPTER EXACTEMENT DEUX PORTES. À trois vantaux colinéaires, quel couple forme le
 * cadre ? N'importe quelle réponse serait un choix silencieux qui déciderait qui s'ouvre avec
 * qui — toutes restent donc simples, et la règle se dit en une phrase. Ni le matériau ni le
 * village n'entrent dans l'appariement : la géométrie seule décide (c'est `toggle_door` qui
 * vérifie le DROIT sur chaque battant, comme toujours).
 *
 * Rendu en UNE passe sur le tableau (le client la refait à chaque snapshot) ; la `Map` rendue
 * n'entre jamais dans `SimState` — c'est un dérivé, comme la reconnaissance d'amas.
 */
export interface DoorPairing<T> {
  /** L'autre vantail du cadre. */
  pair: T
  /** `true` = la moitié OUEST (cadre horizontal) ou NORD (vertical) : son vantail s'accroche au
   *  jambage extérieur de ce côté-là. Le rendu en tire la famille (`door2a`/`door2b`). */
  premiere: boolean
}

export function doorPairs<T extends EdgeAware & { id: number }>(
  structures: readonly T[],
): Map<number, DoorPairing<T>> {
  const cle = (x: number, y: number, h: boolean): string => `${h ? 'h' : 'v'}${x},${y}`
  const parArete = new Map<string, T[]>()
  const canon = new Map<number, { x: number; y: number; h: boolean }>()
  for (const s of structures) {
    if (s.type !== 'door' || s.edges === undefined || !isSingleEdge(s.edges)) continue
    const h = s.edges === EDGE_N || s.edges === EDGE_S
    const c = { x: s.tx + (s.edges === EDGE_E ? 1 : 0), y: s.ty + (s.edges === EDGE_S ? 1 : 0), h }
    canon.set(s.id, c)
    const k = cle(c.x, c.y, h)
    const deja = parArete.get(k)
    if (deja) deja.push(s)
    else parArete.set(k, [s])
  }
  const paires = new Map<number, DoorPairing<T>>()
  for (const [id, c] of canon) {
    // Deux portes sur la MÊME arête : hors contrat de pose (`edge_taken`) — personne ne s'apparie.
    if (parArete.get(cle(c.x, c.y, c.h))!.length !== 1) continue
    const dx = c.h ? 1 : 0
    const dy = c.h ? 0 : 1
    const avant = parArete.get(cle(c.x - dx, c.y - dy, c.h))
    const apres = parArete.get(cle(c.x + dx, c.y + dy, c.h))
    // La file d'exactement deux : UN voisin colinéaire, sain, et rien au-delà de lui.
    if (avant !== undefined && apres === undefined) {
      if (avant.length !== 1 || parArete.has(cle(c.x - 2 * dx, c.y - 2 * dy, c.h))) continue
      paires.set(id, { pair: avant[0]!, premiere: false })
    } else if (apres !== undefined && avant === undefined) {
      if (apres.length !== 1 || parArete.has(cle(c.x + 2 * dx, c.y + 2 * dy, c.h))) continue
      paires.set(id, { pair: apres[0]!, premiere: true })
    }
  }
  return paires
}

/**
 * CE QUI BLOQUE LE FRANCHISSEMENT de (tx,ty) vers son voisin — la question qu'une bête qui
 * chasse doit poser, et qu'elle posait de travers.
 *
 * `advanceMonsters` demandait `solidAt(destination)` : « qu'y a-t-il sur la tuile où je veux
 * aller ? ». Avec des murs pleins c'était la même question ; avec un mur d'arête, non — le mur
 * qui me barre la route peut être déclaré sur MA tuile (bit vers la destination), et la
 * destination, elle, est vide. La bête ne trouvait alors rien à frapper, avançait, se cognait à
 * la bande, et **restait là pour l'éternité** : une enceinte de murs minces aurait été un mur
 * que les pillards ignorent, c'est-à-dire une défense qui ne défend pas.
 *
 * Rend la structure à frapper, ou `undefined` si le passage est libre. `blocks` filtre selon le
 * déplaceur (une porte s'ouvre pour les membres) — la même question que la collision se pose.
 */
export function crossingBlocker<T extends EdgeAware>(
  structures: readonly T[], tx: number, ty: number, dx: number, dy: number, blocks: (s: T) => boolean,
): T | undefined {
  const nx = tx + dx
  const ny = ty + dy
  const { ici, la } = edgeBits(dx, dy)
  // La destination prise EN ENTIER : on n'y entre pas, quelle que soit l'arête.
  const pleine = fullTileAt(structures, nx, ny)
  if (pleine !== undefined && blocks(pleine)) return pleine
  for (const s of structures) {
    if (s.edges === undefined || !blocks(s)) continue
    if (s.tx === tx && s.ty === ty && (s.edges & ici) !== 0) return s
    if (s.tx === nx && s.ty === ny && (s.edges & la) !== 0) return s
  }
  return undefined
}

const tileIndex = (map: WorldMap, tx: number, ty: number): number => ty * map.width + tx

/**
 * ═══ LE FRANCHISSEMENT, ET NON PLUS LA TUILE ═══
 *
 * C'est le SEUL endroit où le modèle d'arête force l'abstraction tuile à céder. Les deux
 * remplissages de ce fichier — l'invariant de navigabilité (R7) et la détection d'enceinte
 * (R13-R14) — demandaient « cette tuile est-elle bloquée ? ». Avec des murs minces, la question
 * juste est « ce PASSAGE est-il bloqué ? » : une tuile bordée d'un mur au nord se traverse très
 * bien d'est en ouest.
 *
 * Ces deux gardes ne sont pas décoratives : ce sont elles qui empêchent un joueur d'emmurer son
 * propre Feu, et elles décident du bonus d'enceinte. Se tromper ici ne se verrait qu'en partie.
 *
 * Les quatre bits et la paire `edgeBits` viennent de `geometry.ts` : le joueur en POSE
 * désormais, donc la même valeur traverse le réseau, le fantôme et la collision — une seule
 * définition, ou une inversion N/S dans une copie donnerait un mur qui arrête ailleurs.
 */

/**
 * Peut-on passer de (tx,ty) vers son voisin (tx+dx, ty+dy) ? Un mur mince coupe le passage
 * qu'il porte, de l'un OU l'autre côté — deux tuiles voisines partagent une arête, et il suffit
 * que l'une la déclare. Les structures SANS `edges` gardent la règle historique : elles bloquent
 * leur tuile, donc on n'y entre pas.
 */
function crossingBlocked(
  parEdges: Map<number, number>, pleines: ReadonlySet<number>, map: WorldMap,
  tx: number, ty: number, dx: number, dy: number,
): boolean {
  const nx = tx + dx
  const ny = ty + dy
  if (pleines.has(tileIndex(map, nx, ny))) return true // la voisine est prise en entier
  const { ici, la } = edgeBits(dx, dy)
  if (((parEdges.get(tileIndex(map, tx, ty)) ?? 0) & ici) !== 0) return true
  if (((parEdges.get(tileIndex(map, nx, ny)) ?? 0) & la) !== 0) return true
  return false
}

/** Les deux tables que les remplissages consultent : arêtes par tuile, et tuiles pleines. */
function murs(map: WorldMap, structures: readonly { tx: number; ty: number; type: StructureType; edges?: number }[],
  bloque: (t: StructureType) => boolean): { parEdges: Map<number, number>; pleines: Set<number> } {
  const parEdges = new Map<number, number>()
  const pleines = new Set<number>()
  for (const s of structures) {
    if (!bloque(s.type)) continue
    const i = tileIndex(map, s.tx, s.ty)
    if (s.edges === undefined) pleines.add(i)
    else parEdges.set(i, (parEdges.get(i) ?? 0) | s.edges)
  }
  return { parEdges, pleines }
}

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
  murs: { parEdges: Map<number, number>; pleines: ReadonlySet<number> },
  region: { x0: number; y0: number; x1: number; y1: number },
  fireTx: number,
  fireTy: number,
): Set<number> {
  const visited = new Set<number>()
  const inRegion = (tx: number, ty: number): boolean => tx >= region.x0 && tx <= region.x1 && ty >= region.y0 && ty <= region.y1
  const passable = (tx: number, ty: number): boolean =>
    inRegion(tx, ty) && !murs.pleines.has(tileIndex(map, tx, ty)) && (TERRAINS[terrainAt(map, tx, ty)]?.walkable ?? false)

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
      // ET LE FRANCHISSEMENT LUI-MÊME : un mur mince ne prend pas la tuile d'en face, il coupe
      // le passage. Sans ce test, une enceinte de murs minces serait invisible au remplissage.
      if (crossingBlocked(murs.parEdges, murs.pleines, map, tx, ty, dx, dy)) continue
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

  // AVANT / APRÈS, en ARÊTES : `murs` sépare les tuiles prises en entier (comportement
  // historique) des arêtes déclarées. Le comparatif reste le même — on ne punit pas une poche
  // de terrain préexistante, on ne refuse que ce que CETTE pose ferme.
  const avant = murs(map, structures, blocksNavigation)
  const apres = murs(map, [...structures, add], blocksNavigation)

  const before = floodFromFire(map, avant, region, fire.tx, fire.ty)
  const after = floodFromFire(map, apres, region, fire.tx, fire.ty)

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

/** Cette structure est-elle un COMPOSANT ? La famille le dit (registre `pieces.ts`). */
export { isComponent } from './pieces'

// ─── LA RECONNAISSANCE D'AMAS & DE FONCTIONS (spec construction R9-R10, R14) ──

/** La forme minimale d'une structure pour la reconnaissance (découplé de `Structure`). */
export interface RecogStructure {
  id: number
  type: StructureType
  tx: number
  ty: number
  villageId: number
  /** Les arêtes occupées (modèle de mur mince) — la détection d'enceinte en dépend. */
  edges?: number
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
/*
 * `functionForStation` A DISPARU (2026-08-01). Elle re-balayait `FUNCTIONS.recipeByTier` à
 * l'envers pour retrouver la fonction depuis un NOM DE STATION — un détour qui n'existait
 * que parce que `Recipe.station` aplatissait l'exigence en un type d'objet. La recette
 * déclare désormais sa fonction elle-même (`requiert.fonction`) : il n'y a plus rien à
 * retrouver.
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
  // LES ARÊTES CLÔTURANTES, par tuile. Une enceinte de murs MINCES n'occupe aucune tuile : sans
  // cette table, le remplissage de l'intérieur passerait à travers et déclarerait « débordé ».
  const closEdges = new Map<string, number>()
  const roofTiles = new Set<string>()
  for (const s of structures) {
    const k = `${s.tx},${s.ty}`
    if (s.type === 'wall' || s.type === 'door') {
      if (s.edges === undefined) wallDoor.add(k)
      else closEdges.set(k, (closEdges.get(k) ?? 0) | s.edges)
    }
    // Le TOIT est une couche à part (décision d'Alexis : il se superpose au reste) :
    // une tuile est « couverte » si un toit s'y trouve, quoi qu'il y ait dessous.
    if (s.type === 'roof') roofTiles.add(k)
  }
  const coupe = (tx: number, ty: number, dx: number, dy: number): boolean => {
    const { ici, la } = edgeBits(dx, dy)
    if (((closEdges.get(`${tx},${ty}`) ?? 0) & ici) !== 0) return true
    return ((closEdges.get(`${tx + dx},${ty + dy}`) ?? 0) & la) !== 0
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
      if (coupe(tx, ty, dx, dy)) continue // l'arête close arrête le remplissage
      interior.add(k)
      queue.push({ tx: nx, ty: ny })
    }
  }
  // Clos (borné) : chaque tuile intérieure doit porter un TOIT (entièrement toité, R14).
  for (const k of interior) if (!roofTiles.has(k)) return false
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
