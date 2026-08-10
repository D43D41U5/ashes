/**
 * LE SORT DES LIEUX — la garde du récit spatial (spec `stratigraphie.md` S-R17/S-R18/S-A13).
 *
 * Deux niveaux : le verdict lui-même (unitaire, sur cartes fabriquées — chaque cause prouvée
 * par différence), puis la promesse sur la VRAIE carte (les trois sorts existent, et le rang
 * « l'intact est plus loin des routes que le pillé » tient — en rang, jamais en valeur).
 */
import { describe, expect, it } from 'vitest'
import { SORT_DES_LIEUX, nomSelonSort, sortDuLieu, usureSelonSort } from './sort-des-lieux'
import { PLANS, buildPoiStructures } from './poi-batis'
import { createEmptyMap } from './map'
import { NODE_DEFS, TERRAIN_GRASS, TERRAIN_ROAD } from './balance'
import { createSim } from './sim'
import { POI_TYPES } from './poi'

const fp = POI_TYPES.find((t) => t.slug === 'ferme_ruinee')!.footprint

describe('sortDuLieu — le verdict et ses causes', () => {
  it('une carte sans Cendrière ni route rend un lieu INTACT', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('intact')
  })

  it('la proximité du front (sous la part calibrée) rend le lieu BRÛLÉ', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    map.cendreMax = 100
    map.cendre = new Array(64 * 64).fill(1000)
    // Le centre du lieu (19,19) sous la part brûlée : le feu est passé là.
    map.cendre[19 * 64 + 19] = 100 * SORT_DES_LIEUX.PART_BRULEE - 1
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('brule')
  })

  it('une sente à portée rend le lieu PILLÉ — et le feu GAGNE sur la route', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    map.terrain[30 * 64 + 30] = TERRAIN_ROAD
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('pille')
    // La même carte, mais le feu est passé : brûlé, la route n'y change rien.
    map.cendreMax = 100
    map.cendre = new Array(64 * 64).fill(1000)
    map.cendre[19 * 64 + 19] = 0
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('brule')
  })

  it('la route au-delà du rayon ne pille pas', () => {
    const map = createEmptyMap(128, 128, TERRAIN_GRASS)
    // Centre du lieu : (19,19). Une route à plus de RAYON_ROUTE en Chebyshev.
    const loin = 19 + SORT_DES_LIEUX.RAYON_ROUTE + 2
    map.terrain[loin * 128 + loin] = TERRAIN_ROAD
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('intact')
  })
})

describe('ce que le sort fait au bâti', () => {
  const simAvec = (prep: (map: ReturnType<typeof createEmptyMap>) => void) => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    map.zones.push({ name: 'essai', x: 10, y: 10, w: fp, h: fp, kind: 'ferme_ruinee' })
    prep(map)
    const sim = createSim(7, { map })
    buildPoiStructures(sim, 7)
    return sim
  }
  const brulee = () => simAvec((map) => {
    map.cendreMax = 100
    map.cendre = new Array(64 * 64).fill(1000).fill(0, 0, 64 * 40)
  })
  const intacte = () => simAvec(() => {})
  const pillee = () => simAvec((map) => { map.terrain[19 * 64 + 40] = TERRAIN_ROAD })

  it('le feu ne laisse que la pierre : plus une table, plus un toit — l’âtre reste', () => {
    const s = brulee()
    const types = new Set(s.structures.map((st) => st.type))
    expect(types.has('atre')).toBe(true)
    for (const t of ['table', 'banc', 'paillasse', 'etagere', 'tonneau', 'chest', 'roof']) {
      expect(types.has(t as never), `${t} devrait avoir brûlé`).toBe(false)
    }
  })

  it('le feu ne prend pas la pierre des petits lieux : l’autel et le mur bas restent, la charrette brûle', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    const fpO = POI_TYPES.find((t) => t.slug === 'oratoire')!.footprint
    const fpC = POI_TYPES.find((t) => t.slug === 'charrette')!.footprint
    map.zones.push({ name: 'o', x: 10, y: 10, w: fpO, h: fpO, kind: 'oratoire' })
    map.zones.push({ name: 'c', x: 40, y: 40, w: fpC, h: fpC, kind: 'charrette' })
    map.cendreMax = 100
    map.cendre = new Array(64 * 64).fill(0) // tout le monde a brûlé
    const sim = createSim(7, { map })
    buildPoiStructures(sim, 7)
    const types = new Set(sim.structures.map((st) => st.type))
    expect(types.has('autel'), 'un autel de pierre ne brûle pas').toBe(true)
    expect(types.has('mur_bas'), 'un mur bas de pierre ne brûle pas').toBe(true)
    expect(types.has('charrette'), 'une charrette de bois brûle').toBe(false)
    expect(types.has('tonneau')).toBe(false)
  })

  it('les pillards prennent les contenants, pas les meubles', () => {
    const s = pillee()
    const types = new Set(s.structures.map((st) => st.type))
    expect(types.has('table')).toBe(true)
    expect(types.has('chest')).toBe(false)
    expect(types.has('tonneau')).toBe(false)
    expect(types.has('etagere')).toBe(false)
  })

  it('brûlé < pillé < intact : l’usure des murs suit le sort', () => {
    const hp = (s: ReturnType<typeof intacte>) => s.structures.find((st) => st.type === 'wall')!.hp
    expect(hp(brulee())).toBeLessThan(hp(pillee()))
    expect(hp(pillee())).toBeLessThan(hp(intacte()))
  })

  it('la fouille : pillé garde un plancher, intact garde tout — le combien, jamais le si', () => {
    const stock = (s: ReturnType<typeof intacte>) =>
      s.nodes.filter((n) => n.type === 'rubble').map((n) => n.stock)
    const base = NODE_DEFS.rubble.stock
    for (const st of stock(pillee())) {
      expect(st).toBeGreaterThanOrEqual(1)
      expect(st).toBeLessThan(base)
    }
    for (const st of stock(intacte())) expect(st).toBe(base * SORT_DES_LIEUX.STOCK_INTACT)
    for (const st of stock(brulee())) expect(st).toBe(base)
  })

  it('le verdict reste déterministe : deux générations, mêmes pièces, mêmes stocks', () => {
    const cle = (s: ReturnType<typeof intacte>) =>
      [...s.structures.map((st) => `${st.type}@${st.tx},${st.ty}:${st.hp}`),
        ...s.nodes.map((n) => `${n.type}@${n.tx},${n.ty}:${n.stock}`)]
    expect(cle(brulee())).toEqual(cle(brulee()))
  })
})

describe('le toponyme dit le sort', () => {
  it('la ferme se nomme d’après son sort, la grotte garde son nom', () => {
    expect(nomSelonSort('ferme_ruinee', 'la Ferme ruinée', 'brule')).toBe('la Ferme brûlée')
    expect(nomSelonSort('ferme_ruinee', 'la Ferme ruinée', 'pille')).toBe('la Ferme pillée')
    expect(nomSelonSort('ferme_ruinee', 'la Ferme ruinée', 'intact')).toBe('la Ferme muette')
    expect(nomSelonSort('grotte', 'la Grotte', 'brule')).toBe('la Grotte')
  })

  it('les lieux de l’étage 1 aussi — et seulement là où le sort veut dire quelque chose', () => {
    expect(nomSelonSort('ruines', 'les Ruines', 'brule')).toBe('les Ruines brûlées')
    expect(nomSelonSort('ruines', 'les Ruines', 'intact')).toBe('les Ruines muettes')
    expect(nomSelonSort('epave', "l'Épave d'avalanche", 'pille')).toBe("l'Épave pillée")
    // L'oratoire de pierre ne brûle pas, l'épave d'avalanche non plus : le nom de table reste.
    expect(nomSelonSort('oratoire', 'l’Oratoire', 'brule')).toBe('l’Oratoire')
    expect(nomSelonSort('epave', "l'Épave d'avalanche", 'brule')).toBe("l'Épave d'avalanche")
    // Et « abandonnée » dit déjà l'intact : pas de nom d'oubli en double.
    expect(nomSelonSort('charrette', 'la Charrette abandonnée', 'intact')).toBe('la Charrette abandonnée')
  })

  it('l’usure ne dépasse jamais le neuf : une cabane debout intacte reste à 1', () => {
    expect(usureSelonSort(PLANS.cabane!.usure, 'intact')).toBe(1)
    expect(usureSelonSort(PLANS.ferme_ruinee!.usure, 'brule'))
      .toBeLessThan(PLANS.ferme_ruinee!.usure)
  })
})
