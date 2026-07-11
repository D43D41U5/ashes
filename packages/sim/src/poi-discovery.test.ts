import { describe, expect, it } from 'vitest'
import { createEmptyMap, poisAt, poiCenter } from './map'
import { TERRAIN_GRASS } from './balance'
import { POI_CHARGES, poiFamily } from './poi-discovery'

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
