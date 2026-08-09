/**
 * LES EAUX DES ZONES — les gardes de la couche II (spec `stratigraphie.md` S-A5/S-A6).
 *
 * Sur la VRAIE carte, après TOUTES les passes (les invariants d'eau se jugent sur l'état
 * final — un seuil percé après coup peut défaire ce qu'une passe a promis, c'est arrivé à
 * la Racine). La beauté se juge sur PNG ; ici on garde les PROMESSES : le Lac Mort a son
 * lac, la Tourbière ses mares, la Sylve son eau (donc sa chasse possible), R45 et A16
 * tiennent hors Racine comme dedans.
 */
import { describe, expect, it } from 'vitest'
import { generateZonedTerrain } from './zonegen'
import { TERRAINS, TERRAIN_DEEP_WATER } from './balance'
import { isWater } from './map'

const CARTE = generateZonedTerrain(7)
const { map, graphe, zone, rampe } = CARTE
const W = map.width
const H = map.height

const zoneId = (slug: string): number => graphe.zones.find((z) => z.def.slug === slug)!.id

/** Les composantes 4-connexes d'eau D'UNE zone, en tuiles, triées grandes d'abord. */
function plansDEau(zid: number): number[][] {
  const vu = new Uint8Array(W * H)
  const plans: number[][] = []
  for (let i = 0; i < W * H; i++) {
    if (vu[i] === 1 || zone[i] !== zid || !isWater(map.terrain[i]!)) continue
    const comp: number[] = [i]
    vu[i] = 1
    for (let t = 0; t < comp.length; t++) {
      const k = comp[t]!
      const kx = k % W
      for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < W ? k + 1 : -1, k - W, k + W]) {
        if (v < 0 || v >= W * H || vu[v] === 1 || zone[v] !== zid || !isWater(map.terrain[v]!)) continue
        vu[v] = 1
        comp.push(v)
      }
    }
    plans.push(comp)
  }
  return plans.sort((a, b) => (b.length - a.length) || (a[0]! - b[0]!))
}

describe('les eaux des zones (couche II)', () => {
  it('S-A5 — le Lac Mort a ENFIN son lac : un plan d\'eau majeur, avec un cœur profond', () => {
    const plans = plansDEau(zoneId('lac_mort'))
    expect(plans.length).toBeGreaterThan(0)
    const lac = plans[0]!
    expect(lac.length, 'le plan d\'eau majeur est trop petit pour être LE lac').toBeGreaterThanOrEqual(400)
    const profondes = lac.filter((i) => map.terrain[i] === TERRAIN_DEEP_WATER).length
    expect(profondes, 'le lac n\'a pas de cœur profond').toBeGreaterThan(0)
  })

  it('S-A5 — la Tourbière a ses mares : plusieurs plans d\'eau distincts, à taille de mare', () => {
    const mares = plansDEau(zoneId('tourbiere')).filter((p) => p.length >= 32)
    expect(mares.length, `${mares.length} mare(s) d'au moins 32 tuiles`).toBeGreaterThanOrEqual(3)
  })

  it('la Sylve a son eau — la condition de sa chasse (l\'eau commande la faune)', () => {
    const plans = plansDEau(zoneId('sylve'))
    const total = plans.reduce((a, p) => a + p.length, 0)
    expect(total, 'aucune eau dans la Sylve').toBeGreaterThan(50)
  })

  it('R45 hors Racine — aucun profond au contact orthogonal d\'une terre marchable sèche', () => {
    // Garde exhaustive : tout l'espace, une seule propriété — la leçon des gardes de géométrie.
    const racine = graphe.racine
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        if (map.terrain[i] !== TERRAIN_DEEP_WATER || zone[i] === racine) continue
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          const t = map.terrain[j]!
          if (isWater(t)) continue
          if (TERRAINS[t]?.walkable !== true) continue
          // Une terre sèche marchable d'une AUTRE zone au contact du profond est un mur de
          // frontière légitime (R5) — le même compromis que la passe 3.5 de la Racine.
          if (zone[j] !== zone[i]) continue
          expect.fail(`profond en (${x},${y}) au contact d'une terre marchable de sa zone en ${j}`)
        }
      }
    }
  })

  it('A16 généralisé — aucune eau de zone dans un couloir de seuil', () => {
    for (let i = 0; i < W * H; i++) {
      if (rampe[i] !== 1) continue
      expect(isWater(map.terrain[i]!), `de l'eau sur la rampe en ${i % W},${Math.floor(i / W)}`).toBe(false)
    }
  })

  it('est déterministe : même seed, mêmes eaux', () => {
    const bis = generateZonedTerrain(7)
    expect(bis.map.terrain.length).toBe(map.terrain.length)
    let diff = 0
    for (let i = 0; i < map.terrain.length; i++) {
      if (bis.map.terrain[i] !== map.terrain[i]) diff++
    }
    expect(diff).toBe(0)
  })
})
