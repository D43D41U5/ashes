import { describe, expect, it } from 'vitest'
import { createEmptyMap, poisAt, poiCenter } from './map'
import { TERRAIN_GRASS } from './balance'
import { POI_CHARGES, poiFamily } from './poi-discovery'
import { createSim, spawnEntity, step, type SimState } from './sim'

/** Carte de test : 3 zones, dont une SANS `kind` (un simple toponyme). */
function mapWithZones() {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push({ name: 'le Belvédère I', x: 10, y: 10, w: 2, h: 2, kind: 'belvedere' }) // poiId 0
  map.zones.push({ name: 'le Pont', x: 20, y: 20, w: 4, h: 4 }) //                          poiId 1 — PAS un POI
  map.zones.push({ name: 'le Cairn I', x: 30, y: 30, w: 1, h: 1, kind: 'cairn' }) //        poiId 2
  return map
}

describe('poisAt', () => {
  it('retourne le poiId de la zone foulée', () => {
    expect(poisAt(mapWithZones(), 10.5, 10.5)).toEqual([0])
  })

  it('ignore les zones sans kind (les toponymes ne sont pas des lieux)', () => {
    expect(poisAt(mapWithZones(), 21, 21)).toEqual([])
  })

  it('ne retourne rien hors de toute zone', () => {
    expect(poisAt(mapWithZones(), 50, 50)).toEqual([])
  })

  it('retourne TOUTES les zones qui se recouvrent, pas seulement la première', () => {
    const map = mapWithZones()
    map.zones.push({ name: 'la Grotte I', x: 10, y: 10, w: 2, h: 2, kind: 'grotte' }) // poiId 3, superposée
    expect(poisAt(map, 10.5, 10.5)).toEqual([0, 3])
  })
})

describe('poiCenter', () => {
  it('donne le centre du rectangle', () => {
    expect(poiCenter({ name: 'x', x: 10, y: 20, w: 4, h: 2 })).toEqual({ x: 12, y: 21 })
  })
})

describe('POI_CHARGES', () => {
  it('charge les onze lieux de famille reward, et EUX SEULS', () => {
    const charged = Object.keys(POI_CHARGES).sort()
    expect(charged).toEqual(
      ['arbre', 'arche', 'belvedere', 'cairn', 'cascade', 'erratique', 'grotte', 'petroglyphes', 'sanctuaire', 'source_chaude', 'tarn'].sort(),
    )
  })

  it('ne charge que des POI de famille reward', () => {
    for (const kind of Object.keys(POI_CHARGES)) {
      expect(poiFamily(kind)).toBe('reward')
    }
  })

  it('répartit les onze en 4 savoir / 3 répit / 4 récit', () => {
    const count = (d: string) => Object.values(POI_CHARGES).filter((c) => c.devise === d).length
    expect(count('savoir')).toBe(4)
    expect(count('repit')).toBe(3)
    expect(count('recit')).toBe(4)
  })
})

/** Une sim de test avec une carte à zones et un joueur posé où on veut. */
function simWith(zones: { name: string; x: number; y: number; w: number; h: number; kind?: string }[]) {
  const map = createEmptyMap(64, 64, TERRAIN_GRASS)
  map.zones.push(...zones)
  const state = createSim(1, { map })
  const playerId = spawnEntity(state, 0.5, 0.5)
  return { state, playerId }
}

/** Téléporte le joueur et joue un tick sans input (le pas est déjà fait). */
function walkTo(state: SimState, playerId: number, x: number, y: number) {
  const p = state.entities.find((e) => e.id === playerId)!
  p.x = x
  p.y = y
  state.events.length = 0
  step(state, [])
}

describe('la règle de base : un lieu foulé entre dans la carte', () => {
  it('au tick 0, le joueur ne connaît AUCUN lieu', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([])
  })

  it('fouler un Gisement (aucune charge) suffit à le connaître, et émet poi_discovered', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(1)
  })

  it('le retraverser n’émet plus rien (idempotent)', () => {
    const { state, playerId } = simWith([{ name: 'le Gisement I', x: 10, y: 10, w: 2, h: 2, kind: 'gisement' }])
    walkTo(state, playerId, 10.5, 10.5)
    walkTo(state, playerId, 10.6, 10.6) // toujours dedans, tick suivant
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([0])
    expect(state.events.filter((e) => e.type === 'poi_discovered')).toHaveLength(0)
  })

  it('une zone SANS kind (un toponyme) n’entre jamais dans la carte', () => {
    const { state, playerId } = simWith([{ name: 'le Pont', x: 10, y: 10, w: 2, h: 2 }])
    walkTo(state, playerId, 10.5, 10.5)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toEqual([])
  })
})
