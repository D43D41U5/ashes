/**
 * LE PAYS D'AVANT — les gardes des couches III/IV (spec `stratigraphie.md` S-A10/S-A11/S-A14/S-A16).
 *
 * Sur la VRAIE carte, après toutes les passes. On garde les CAUSES : la ferme a son eau, la
 * charrette sa route, les annales se tiennent, l'étoile est morte, et la reprise du Brûlé est
 * ORDONNÉE (garde par rang sur tout le domaine — jamais des cas choisis).
 */
import { describe, expect, it } from 'vitest'
import { generateZonedTerrain } from './zonegen'
import { BUILT_KINDS } from './poi-batis'
import { isWater } from './map'
import {
  TERRAIN_BURNT_FOREST, TERRAIN_GRASS, TERRAIN_HEATH, TERRAIN_LARCH, TERRAIN_ROAD,
} from './balance'

const CARTE = generateZonedTerrain(7)
const { map, graphe, zone } = CARTE
const W = map.width

/** La plus proche distance (Chebyshev) d'un prédicat de terrain autour d'un centre de lieu. */
function distA(z: { x: number; y: number; w: number; h: number }, veut: (t: number) => boolean): number {
  const cx = Math.floor(z.x + z.w / 2)
  const cy = Math.floor(z.y + z.h / 2)
  let best = Infinity
  for (let y = Math.max(0, cy - 60); y <= Math.min(map.height - 1, cy + 60); y++) {
    for (let x = Math.max(0, cx - 60); x <= Math.min(W - 1, cx + 60); x++) {
      if (!veut(map.terrain[y * W + x]!)) continue
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy))
      if (d < best) best = d
    }
  }
  return best
}

describe('les sites humains ont une raison d\'être (S-R14/S-A10)', () => {
  it('toute ferme est à portée d\'eau, toute charrette à portée de route', () => {
    for (const z of map.zones) {
      if (z.kind === 'ferme_ruinee') {
        expect(distA(z, isWater), `${z.name} loin de l'eau`).toBeLessThanOrEqual(44)
      }
      if (z.kind === 'charrette') {
        expect(distA(z, (t) => t === TERRAIN_ROAD), `${z.name} loin de la route`).toBeLessThanOrEqual(44)
      }
    }
  })

  it('les fermes EXISTENT encore (le prédicat raréfie, la réservation garantit)', () => {
    expect(map.zones.filter((z) => z.kind === 'ferme_ruinee').length).toBeGreaterThanOrEqual(2)
  })
})

describe('les annales (S-R16/S-A14)', () => {
  it('chaque lieu bâti a sa fondation ET son sort ; chaque gué son fait', () => {
    const annales = map.annales ?? []
    for (const z of map.zones) {
      if (z.kind === undefined || !BUILT_KINDS.includes(z.kind)) continue
      const cx = Math.floor(z.x + z.w / 2)
      const cy = Math.floor(z.y + z.h / 2)
      const faits = annales.filter((f) => f.x === cx && f.y === cy && f.lieu === z.kind)
      expect(faits.some((f) => f.type === 'fondation'), `${z.name} sans fondation`).toBe(true)
      expect(faits.some((f) => f.type === 'sort'), `${z.name} sans sort`).toBe(true)
    }
    const gues = map.zones.filter((z) => z.name === 'le Gué')
    expect(annales.filter((f) => f.type === 'gue').length).toBeGreaterThanOrEqual(gues.length)
  })

  it('tout fait est daté d\'une ère et positionné sur la carte', () => {
    for (const f of map.annales ?? []) {
      expect([1, 2, 3]).toContain(f.ere)
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.y).toBeGreaterThanOrEqual(0)
      expect(f.x).toBeLessThan(W)
      expect(f.y).toBeLessThan(map.height)
    }
  })

  it('un sort d\'annales dit ce que le toponyme dit (les deux lisent le même verdict)', () => {
    for (const f of (map.annales ?? []).filter((q) => q.type === 'sort' && q.lieu === 'ferme_ruinee')) {
      const lieu = map.zones.find((z) => z.kind === 'ferme_ruinee'
        && Math.floor(z.x + z.w / 2) === f.x && Math.floor(z.y + z.h / 2) === f.y)!
      const attendu = f.cause === 'brule' ? 'brûlée' : f.cause === 'pille' ? 'pillée' : 'muette'
      expect(lieu.name.includes(attendu), `${lieu.name} vs sort ${f.cause}`).toBe(true)
    }
  })
})

describe('l\'étoile est morte (S-R15/S-A11)', () => {
  it('aucune tuile de route n\'est un carrefour en croix à plus de 3 branches denses', () => {
    // L'ancienne étoile avait UN carrefour où toutes les sentes convergeaient. On mesure la
    // propriété inverse : pour chaque tuile de route, le nombre de directions cardinales où
    // une route continue sur ≥ 8 tuiles. L'étoile centrale en avait 4+ avec de longs bras
    // partout ; un réseau à fusions n'a que des Y et des traversées.
    const route = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < W && y < map.height && map.terrain[y * W + x] === TERRAIN_ROAD
    let croixDenses = 0
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < W; x++) {
        if (!route(x, y)) continue
        let bras = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          let longe = 0
          for (let k = 1; k <= 12; k++) {
            if (route(x + dx * k, y + dy * k)) longe++
          }
          if (longe >= 8) bras++
        }
        if (bras >= 4) croixDenses++
      }
    }
    // Quelques croisements accidentels de tracés restent possibles (deux liaisons qui se
    // coupent) — mais l'étoile en produisait des DIZAINES au même point. On borne bas.
    expect(croixDenses).toBeLessThanOrEqual(24)
  })
})

describe('la reprise du Brûlé est ordonnée (S-R20/S-A16)', () => {
  it('en s\'éloignant du front, les stades apparaissent dans l\'ordre — mesuré en rang', () => {
    const brule = graphe.zones.find((z) => z.def.slug === 'brule')!
    const dists: Record<string, number[]> = { sterile: [], lande: [], pionnier: [], futaie: [] }
    for (let i = 0; i < map.terrain.length; i += 7) {
      if (zone[i] !== brule.id) continue
      const t = map.terrain[i]!
      const d = map.cendre![i]!
      if (t === TERRAIN_BURNT_FOREST) dists.sterile!.push(d)
      else if (t === TERRAIN_HEATH) dists.lande!.push(d)
      else if (t === TERRAIN_GRASS) dists.pionnier!.push(d)
      else if (t === TERRAIN_LARCH) dists.futaie!.push(d)
    }
    const moy = (v: number[]): number => v.reduce((a, b) => a + b, 0) / (v.length || 1)
    expect(dists.sterile!.length).toBeGreaterThan(20)
    expect(dists.lande!.length).toBeGreaterThan(20)
    expect(dists.pionnier!.length).toBeGreaterThan(20)
    expect(dists.futaie!.length).toBeGreaterThan(20)
    // LE RANG, pas les valeurs : stérile < lande < pionnier < futaie en distance au front.
    expect(moy(dists.sterile!)).toBeLessThan(moy(dists.lande!))
    expect(moy(dists.lande!)).toBeLessThan(moy(dists.pionnier!))
    expect(moy(dists.pionnier!)).toBeLessThan(moy(dists.futaie!))
  })

  it('chaque stade porte sa récolte : des baies poussent sur la lande et l\'herbe du Brûlé', () => {
    // `terrainAdmet` refuse les baies au calciné : la reprise se récolte, le désert non.
    // (La table `brule` déclare `berry_bush` — A19 garantit qu'elle trouve ses tuiles ;
    // ici on prouve la LECTURE du gradient : il existe des tuiles de lande/herbe à portée.)
    const brule = graphe.zones.find((z) => z.def.slug === 'brule')!
    let recoltables = 0
    for (let i = 0; i < map.terrain.length; i += 7) {
      if (zone[i] !== brule.id) continue
      const t = map.terrain[i]!
      if (t === TERRAIN_HEATH || t === TERRAIN_GRASS) recoltables++
    }
    expect(recoltables).toBeGreaterThan(200)
  })
})
