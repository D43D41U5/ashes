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
  // ⚠ LE VERDICT 'brule' N'A PLUS DE SOURCE depuis le 2026-08-24 (le front est retiré, et avec
  //   lui `map.cendre`/`cendreMax` du monde joué). Les cas qui le produisaient par le champ de
  //   cendre sont retirés ici ; la MACHINERIE du sort brûlé (usure, pièces qui brûlent, toponyme)
  //   reste en place et testée en direct sur la valeur — elle attend sa nouvelle source.
  it('une carte sans Cendrière ni route rend un lieu INTACT', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('intact')
  })

  it('une sente à portée rend le lieu PILLÉ', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    map.terrain[30 * 64 + 30] = TERRAIN_ROAD
    expect(sortDuLieu(map, 10, 10, fp, fp)).toBe('pille')
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
  const intacte = () => simAvec(() => {})
  const pillee = () => simAvec((map) => { map.terrain[19 * 64 + 40] = TERRAIN_ROAD })

  // (« le feu ne laisse que la pierre » et « le feu ne prend pas la pierre des petits lieux » :
  //  retirés le 2026-08-24 — ils fabriquaient un champ de cendre à la main pour forcer le verdict
  //  'brule', qui n'a plus de source. Les règles qu'ils gardaient vivent toujours dans
  //  `poi-batis`, et le toponyme comme l'usure restent testés en direct plus bas.)

  it('les pillards prennent les contenants, pas les meubles', () => {
    const s = pillee()
    const types = new Set(s.structures.map((st) => st.type))
    expect(types.has('table')).toBe(true)
    expect(types.has('chest')).toBe(false)
    expect(types.has('tonneau')).toBe(false)
    expect(types.has('etagere')).toBe(false)
  })

  it('pillé < intact : l’usure des murs suit le sort', () => {
    const hp = (s: ReturnType<typeof intacte>) => s.structures.find((st) => st.type === 'wall')!.hp
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
  })

  it('le verdict reste déterministe : deux générations, mêmes pièces, mêmes stocks', () => {
    const cle = (s: ReturnType<typeof intacte>) =>
      [...s.structures.map((st) => `${st.type}@${st.tx},${st.ty}:${st.hp}`),
        ...s.nodes.map((n) => `${n.type}@${n.tx},${n.ty}:${n.stock}`)]
    expect(cle(pillee())).toEqual(cle(pillee()))
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
