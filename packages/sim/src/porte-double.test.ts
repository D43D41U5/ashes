/**
 * LA PORTE DOUBLE (spec construction R27, demande d'Alexis 2026-08-01) — « un seul cadre,
 * 2 battants se rejoignant au centre », constructible en horizontal ou vertical.
 *
 * Elle se DÉRIVE, elle ne se pose pas : deux `door` sur des arêtes colinéaires adjacentes
 * s'apparient (`doorPairs`), et `toggle_door` pousse les deux battants d'un geste. Rien de
 * neuf dans l'état — c'est ce que ce fichier doit prouver des deux côtés : la question pure
 * d'abord (l'appariement, balayé sur son espace), puis l'action réelle (seed + inputs).
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS } from './balance'
import { doorPairs } from './construction'
import { EDGE_BITS, EDGE_E, EDGE_N, EDGE_O, EDGE_S, edgeStep } from './geometry'
import { drainEvents, type SimEvent } from './events'
import { createEmptyMap } from './map'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { grantItems, structureAt, type Structure } from './village'

// ─── Le banc : le même que `wall-edges-joueur.test.ts` — colon, foyer, marteau ───

function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(160, 160, TERRAIN_GRASS) })
}

function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}

function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

function slotOf(sim: SimState, id: number, item: string): number {
  return sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s?.item === item)
}

function batisseur(sim: SimState, x: number, y: number): number {
  const id = spawnEntity(sim, x + 0.5, y + 0.5)
  grantItems(sim, id, { campfire: 1, hammer: 1, wood: 80, stone: 40, cut_stone: 40 })
  act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
  act(sim, id, { type: 'place_campfire', tx: x + 1, ty: y })
  act(sim, id, { type: 'found_village', structureId: structureAt(sim.structures, x + 1, y)!.id })
  act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'hammer') })
  drainEvents(sim)
  return id
}

// ─────────────────────────────────────────────────────────────────────────────
// LA QUESTION PURE — l'appariement, balayé sur son espace.
//
// Quatre bits, deux axes, deux adresses par arête : l'espace est petit, on le prend en
// entier plutôt que de choisir l'exemple où une inversion ne se verrait pas.

const porte = (id: number, tx: number, ty: number, edges: number): Structure =>
  ({ id, type: 'door', tx, ty, villageId: 1, ownerId: 1, access: 'village', hp: 150, edges }) as Structure

describe('la porte double se DÉRIVE (R27) — `doorPairs`, la question pure', () => {
  it('deux vantaux colinéaires adjacents s’apparient — sur les quatre bits', () => {
    for (const bit of EDGE_BITS) {
      // Le voisin COLINÉAIRE porte le même bit sur la tuile suivante LE LONG de l'arête :
      // en X pour une arête horizontale (N/S), en Y pour une verticale (E/O) — c'est la
      // perpendiculaire du pas de franchissement (`edgeStep`).
      const { dx } = edgeStep(bit)
      const [vx, vy] = dx === 0 ? [1, 0] : [0, 1]
      const a = porte(1, 10, 10, bit)
      const b = porte(2, 10 + vx, 10 + vy, bit)
      const paires = doorPairs([a, b])
      expect(paires.get(1)?.pair.id, `bit ${bit} : a voit b`).toBe(2)
      expect(paires.get(2)?.pair.id, `bit ${bit} : b voit a`).toBe(1)
      // La moitié `a` du cadre est celle à l'ouest / au nord — ici la porte 1, toujours.
      expect(paires.get(1)?.premiere, `bit ${bit} : 1 est la première moitié`).toBe(true)
      expect(paires.get(2)?.premiere, `bit ${bit} : 2 est la seconde`).toBe(false)
    }
  })

  it('les DEUX ADRESSES d’une arête (R25) donnent la même paire', () => {
    // Même ligne physique, aucune tuile commune : « (10,10)+S » côtoie « (11,11)+N ».
    const h = doorPairs([porte(1, 10, 10, EDGE_S), porte(2, 11, 11, EDGE_N)])
    expect(h.get(1)?.pair.id).toBe(2)
    expect(h.get(1)?.premiere, 'la moitié OUEST reste la première').toBe(true)
    // Et en vertical : « (10,10)+E » côtoie « (11,11)+O ».
    const v = doorPairs([porte(1, 10, 10, EDGE_E), porte(2, 11, 11, EDGE_O)])
    expect(v.get(1)?.pair.id).toBe(2)
    expect(v.get(1)?.premiere, 'la moitié NORD reste la première').toBe(true)
  })

  it('perpendiculaires, espacées, seules ou sur la MÊME arête : aucune paire', () => {
    expect(doorPairs([porte(1, 10, 10, EDGE_N), porte(2, 11, 10, EDGE_O)]).size, 'perpendiculaires').toBe(0)
    expect(doorPairs([porte(1, 10, 10, EDGE_N), porte(2, 12, 10, EDGE_N)]).size, 'un trou entre elles').toBe(0)
    expect(doorPairs([porte(1, 10, 10, EDGE_N)]).size, 'un vantail seul').toBe(0)
    // Deux portes sur la même arête : hors contrat de pose (`edge_taken`) — on n'apparie pas.
    expect(doorPairs([porte(1, 10, 10, EDGE_N), porte(2, 10, 10, EDGE_N)]).size, 'la même arête').toBe(0)
    // Et un mur mitoyen n'est pas un vantail.
    const mur = { id: 3, type: 'wall', tx: 11, ty: 10, villageId: 1, ownerId: 1, access: 'village', hp: 200, edges: EDGE_N } as Structure
    expect(doorPairs([porte(1, 10, 10, EDGE_N), mur]).size, 'un mur ne s’apparie pas').toBe(0)
  })

  it('une file de TROIS vantaux n’apparie personne — et retombe à deux, elle s’apparie', () => {
    // À trois, quel couple forme le cadre ? Toute réponse serait un choix silencieux : la
    // règle dit « exactement deux », et la démolition d'un bout rend la paire aux survivants.
    const trois = [porte(1, 10, 10, EDGE_N), porte(2, 11, 10, EDGE_N), porte(3, 12, 10, EDGE_N)]
    expect(doorPairs(trois).size).toBe(0)
    const restants = trois.filter((s) => s.id !== 3)
    expect(doorPairs(restants).get(1)?.pair.id, 'sans le troisième, le cadre se referme').toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// L'ACTION RÉELLE — seed + inputs → état attendu.

describe('pousser un vantail pousse les deux (R27)', () => {
  /** Deux vantaux mitoyens sur les arêtes nord de (41,43) et (42,43) — un cadre horizontal.
   *  Même site que la porte simple de R26 : l'arête est libre des deux côtés. */
  const poserPorteDouble = (sim: SimState, id: number): [Structure, Structure] => {
    act(sim, id, { type: 'build', structure: 'door', tx: 41, ty: 43, material: 'wood', edges: EDGE_N })
    act(sim, id, { type: 'build', structure: 'door', tx: 42, ty: 43, material: 'wood', edges: EDGE_N })
    expect(rejections(sim)).toEqual([])
    const a = sim.structures.find((s) => s.type === 'door' && s.tx === 41 && s.ty === 43)!
    const b = sim.structures.find((s) => s.type === 'door' && s.tx === 42 && s.ty === 43)!
    return [a, b]
  }
  const venirALaPorte = (sim: SimState, id: number): void => {
    const moi = sim.entities.find((e) => e.id === id)!
    moi.x = 41.5
    moi.y = 43.5
  }

  it('les deux battants s’ouvrent d’un geste — et chacun émet son fait', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const [a, b] = poserPorteDouble(sim, id)
    venirALaPorte(sim, id)
    act(sim, id, { type: 'toggle_door', structureId: a.id })
    const faits = drainEvents(sim).filter(
      (e): e is Extract<SimEvent, { type: 'door_toggled' }> => e.type === 'door_toggled',
    )
    expect(faits).toHaveLength(2)
    expect(faits.map((f) => f.structureId).sort()).toEqual([a.id, b.id].sort())
    for (const f of faits) expect(f).toMatchObject({ open: true, byEntityId: id })
    expect(sim.structures.find((s) => s.id === a.id)?.open).toBe(true)
    expect(sim.structures.find((s) => s.id === b.id)?.open, 'l’apparié suit').toBe(true)

    // ET ILS SE REFERMENT ENSEMBLE — la clé `open` DISPARAÎT des deux (R26 : `undefined` est close).
    act(sim, id, { type: 'toggle_door', structureId: a.id })
    expect(drainEvents(sim).filter((e) => e.type === 'door_toggled')).toHaveLength(2)
    for (const vid of [a.id, b.id]) {
      const v = sim.structures.find((s) => s.id === vid)!
      expect(Object.keys(v).includes('open'), 'la clé elle-même s’en va').toBe(false)
    }
  })

  it('deux battants DÉSACCORDÉS se réalignent — et seul celui qui change parle', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const [a, b] = poserPorteDouble(sim, id)
    venirALaPorte(sim, id)
    // Un cadre désaccordé (l'apparié ouvert à la main — un état hérité, pas un geste).
    b.open = true
    drainEvents(sim)
    act(sim, id, { type: 'toggle_door', structureId: a.id })
    // L'état RÉSULTANT du visé s'applique aux deux : a s'ouvre, b l'était déjà — UN seul fait.
    const faits = drainEvents(sim).filter((e) => e.type === 'door_toggled')
    expect(faits).toHaveLength(1)
    expect(faits[0]).toMatchObject({ structureId: a.id, open: true })
    expect(sim.structures.find((s) => s.id === b.id)?.open).toBe(true)
  })

  it('sans droit sur l’apparié, seul le visé bascule', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const [a, b] = poserPorteDouble(sim, id)
    venirALaPorte(sim, id)
    // L'apparié passe à un AUTRE propriétaire, en privé : le geste ne l'atteint plus.
    b.access = 'private'
    b.ownerId = id + 999
    drainEvents(sim)
    act(sim, id, { type: 'toggle_door', structureId: a.id })
    expect(drainEvents(sim).filter((e) => e.type === 'door_toggled')).toHaveLength(1)
    expect(sim.structures.find((s) => s.id === a.id)?.open).toBe(true)
    expect(sim.structures.find((s) => s.id === b.id)?.open, 'la porte d’un autre ne bouge pas').toBeUndefined()
  })

  it('en VERTICAL aussi : deux vantaux empilés en Y font un cadre', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'door', tx: 43, ty: 41, material: 'wood', edges: EDGE_O })
    act(sim, id, { type: 'build', structure: 'door', tx: 43, ty: 42, material: 'wood', edges: EDGE_O })
    expect(rejections(sim)).toEqual([])
    const a = sim.structures.find((s) => s.type === 'door' && s.ty === 41)!
    const b = sim.structures.find((s) => s.type === 'door' && s.ty === 42)!
    const moi = sim.entities.find((e) => e.id === id)!
    moi.x = 43.5
    moi.y = 41.5
    act(sim, id, { type: 'toggle_door', structureId: a.id })
    expect(rejections(sim)).toEqual([])
    expect(sim.structures.find((s) => s.id === a.id)?.open).toBe(true)
    expect(sim.structures.find((s) => s.id === b.id)?.open).toBe(true)
  })

  it('démolir un vantail rend l’autre SIMPLE — la dérivation suit l’état, sans rien à nettoyer', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const [a, b] = poserPorteDouble(sim, id)
    act(sim, id, { type: 'demolish', structureId: a.id })
    expect(sim.structures.find((s) => s.id === a.id)).toBeUndefined()
    expect(doorPairs(sim.structures).get(b.id)).toBeUndefined()
    // Et le survivant se pousse SEUL : un battant, un fait.
    venirALaPorte(sim, id)
    drainEvents(sim)
    act(sim, id, { type: 'toggle_door', structureId: b.id })
    expect(drainEvents(sim).filter((e) => e.type === 'door_toggled')).toHaveLength(1)
  })

  it('une partie à porte double rejoue au bit près', () => {
    const options = { map: createEmptyMap(120, 120, TERRAIN_GRASS) }
    const setup = (state: SimState): void => {
      const nouveau = spawnEntity(state, 40.5, 40.5)
      grantItems(state, nouveau, { campfire: 1, hammer: 1, wood: 80, stone: 40 })
    }
    const sim = createSim(11, options)
    const log = createReplayLog(11, options)
    setup(sim)
    const id = sim.entities[0]!.id
    const jouer = (action: PlayerAction): void => {
      recordAndStep(sim, log, [{ entityId: id, dx: 0, dy: 0, action }])
    }
    jouer({ type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
    jouer({ type: 'place_campfire', tx: 41, ty: 40 })
    jouer({ type: 'found_village', structureId: structureAt(sim.structures, 41, 40)!.id })
    jouer({ type: 'set_active_slot', slot: slotOf(sim, id, 'hammer') })
    // Le cadre à un pas du colon (portée de BRAS pour la bascule — un rejeu ne téléporte pas).
    jouer({ type: 'build', structure: 'door', tx: 40, ty: 41, material: 'wood', edges: EDGE_N })
    jouer({ type: 'build', structure: 'door', tx: 41, ty: 41, material: 'wood', edges: EDGE_N })
    const a = sim.structures.find((s) => s.type === 'door' && s.tx === 40)!
    const b = sim.structures.find((s) => s.type === 'door' && s.tx === 41)!
    jouer({ type: 'toggle_door', structureId: a.id })
    jouer({ type: 'toggle_door', structureId: a.id })
    jouer({ type: 'toggle_door', structureId: b.id })
    expect(sim.structures.find((s) => s.id === a.id)?.open, 'le geste sur B rouvre AUSSI a').toBe(true)
    expect(sim.structures.find((s) => s.id === b.id)?.open).toBe(true)
    expect(snapshot(runReplay(log, setup))).toBe(snapshot(sim))
  })
})
