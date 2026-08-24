import { describe, expect, it } from 'vitest'
import { createEmptyMap, lieuAt, toponymeAt, zoneAt, zoneIdAt, type WorldMap } from './map'

describe('WorldMap.zoneIdAt', () => {
  it('lit la grille de zones au pas du bloc ; -1 sur une carte sans zones', () => {
    const map: WorldMap = createEmptyMap(4, 4, 1)
    expect(zoneIdAt(map, 1, 1)).toBe(-1) // pas de grille → -1 (garde de connexité inerte)

    // 2×2 blocs au pas de 2 : chaque quart de la carte est une zone.
    map.zoneGrid = [3, 5, 7, 9]
    map.zonePas = 2
    expect(zoneIdAt(map, 0, 0)).toBe(3) // bloc (0,0)
    expect(zoneIdAt(map, 3, 0)).toBe(5) // bloc (1,0)
    expect(zoneIdAt(map, 0, 3)).toBe(7) // bloc (0,1)
    expect(zoneIdAt(map, 3, 3)).toBe(9) // bloc (1,1)
    // Deux tuiles voisines de blocs différents rendent des ids différents : c'est ce qui laisse la
    // garde de `carveDistanceToMain` refuser de percer une frontière de zone.
    expect(zoneIdAt(map, 1, 0)).not.toBe(zoneIdAt(map, 2, 0))
  })
})

/**
 * LES DEUX LECTURES D'UN POINT (barre haute, 2026-08-24). `map.zones` mélange les toponymes
 * (sans `kind`) et les lieux (avec `kind`) ; `zoneAt` rend la première des deux, quelle qu'elle
 * soit. La barre en fait DEUX rangs, il lui faut deux lectures qui ne se confondent jamais.
 */
describe('toponymeAt / lieuAt', () => {
  /** Une carte où un lieu est POSÉ DANS une région, et où l'ordre du tableau est PIÉGÉ : le
   *  lieu vient en premier, donc `zoneAt` répond le lieu — le défaut qu'on corrige. */
  const carte = (): WorldMap => {
    const map = createEmptyMap(64, 64, 1)
    map.zones = [
      { name: 'le Gisement', x: 10, y: 10, w: 4, h: 4, kind: 'gisement' },
      { name: 'la Vieille Sylve', x: 0, y: 0, w: 40, h: 40 },
    ]
    return map
  }

  it('le toponyme ignore les lieux, même quand ils passent devant dans le tableau', () => {
    const map = carte()
    expect(zoneAt(map, 12, 12)?.name).toBe('le Gisement') // le défaut, tel quel
    expect(toponymeAt(map, 12, 12)).toBe('la Vieille Sylve')
    expect(toponymeAt(map, 30, 30)).toBe('la Vieille Sylve')
    expect(toponymeAt(map, 50, 50)).toBeUndefined()
  })

  it('le lieu ignore les toponymes, et rend undefined hors de toute empreinte', () => {
    const map = carte()
    expect(lieuAt(map, 12, 12)?.name).toBe('le Gisement')
    expect(lieuAt(map, 30, 30)).toBeUndefined() // dans la région, dans aucun lieu
  })

  /**
   * LA RÉGION VIENT DU GRAPHE, PAS D'UN RECTANGLE — le défaut vu en jouant (2026-08-24) : la
   * première version cherchait un rectangle sans `kind` et rendait une ligne VIDE sur la vraie
   * carte, où les régions vivent dans `zoneDefs` adressées par `zoneGrid`.
   */
  it('la région se lit sur la GRILLE de zones quand la carte en a une', () => {
    const map = createEmptyMap(4, 4, 1)
    map.zoneDefs = [
      { slug: 'pres_bas', nom: 'les Prés Bas', tier: 0 },
      { slug: 'sylve', nom: 'la Vieille Sylve', tier: 1 },
    ]
    map.zoneGrid = [0, 1, 1, 0]
    map.zonePas = 2
    // Un lieu posé DANS la région ne masque pas son nom.
    map.zones = [{ name: 'la Tanière', x: 0, y: 0, w: 2, h: 2, kind: 'taniere' }]
    expect(toponymeAt(map, 0, 0)).toBe('les Prés Bas')
    expect(toponymeAt(map, 3, 0)).toBe('la Vieille Sylve')
    expect(lieuAt(map, 0, 0)?.name).toBe('la Tanière') // les deux lectures cohabitent
  })

  it('la borne haute de l’empreinte est EXCLUE — la même convention que poisAt', () => {
    const map = carte()
    expect(lieuAt(map, 13.9, 13.9)?.name).toBe('le Gisement')
    expect(lieuAt(map, 14, 12)).toBeUndefined()
    expect(lieuAt(map, 12, 14)).toBeUndefined()
  })

  it('deux empreintes qui se recouvrent : la PLUS PETITE gagne, quel que soit l’ordre', () => {
    const map = createEmptyMap(64, 64, 1)
    const grand = { name: 'les Ruines', x: 0, y: 0, w: 10, h: 10, kind: 'ruines' }
    const petit = { name: 'la Tanière', x: 4, y: 4, w: 3, h: 3, kind: 'taniere' }
    map.zones = [grand, petit]
    expect(lieuAt(map, 5, 5)?.name).toBe('la Tanière')
    map.zones = [petit, grand]
    expect(lieuAt(map, 5, 5)?.name).toBe('la Tanière')
    expect(lieuAt(map, 1, 1)?.name).toBe('les Ruines') // hors du petit, le grand parle
  })

  it('à surface ÉGALE, le plus petit index tranche — donc la réponse est STABLE', () => {
    const map = createEmptyMap(64, 64, 1)
    map.zones = [
      { name: 'la Saline', x: 0, y: 0, w: 4, h: 4, kind: 'saline' },
      { name: 'le Verger sauvage', x: 2, y: 2, w: 4, h: 4, kind: 'verger' },
    ]
    expect(lieuAt(map, 3, 3)?.name).toBe('la Saline')
  })
})
