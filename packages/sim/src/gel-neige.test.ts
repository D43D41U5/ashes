/**
 * G9 — LA NEIGE A DEUX HAUTEURS (spec `gel.md`, décision d'Alexis 2026-08-22).
 *
 * Le niveau d'une tuile (nue / poudreuse / jusqu'aux genoux) se dérive de la couverture de
 * `neigeAuSol` par un seuil positionnel ; il commande le pas quel que soit le terrain dessous.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, GEL, TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER, TERRAINS, TICK_DT_S } from './balance'
import { moveAvatar } from './collision'
import {
  NEIGE_GENOUX, NEIGE_NUE, NEIGE_POUDREUSE, neigeAuSol, niveauDeNeige, niveauPourCouverture, seuilDeNeige, vitesseSurNeige,
} from './gel'
import { createEmptyMap, setTile } from './map'
import { frontDuCycle } from './meteo'
import { createSim, type SimState } from './sim'
import { calendarScaleForSeasonCycles, TICKS_PER_CYCLE } from './time'

const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

describe('le seuil et le niveau', () => {
  it('le seuil est borné, positionnel, et le niveau est monotone en couverture', () => {
    const seuils = new Set<number>()
    for (let tx = 0; tx < 40; tx++) {
      for (let ty = 0; ty < 40; ty++) {
        const s = seuilDeNeige(tx, ty)
        expect(s).toBeGreaterThanOrEqual(GEL.NEIGE_SEUIL_MIN)
        expect(s).toBeLessThanOrEqual(GEL.NEIGE_SEUIL_MAX)
        expect(seuilDeNeige(tx, ty)).toBe(s)
        seuils.add(Math.round(s * 20))
        let avant = 0
        for (let c = 0; c <= 1.0001; c += 0.02) {
          const n = niveauPourCouverture(c, tx, ty)
          expect(n).toBeGreaterThanOrEqual(avant) // la neige monte : jamais un niveau qui retombe
          avant = n
        }
        expect(niveauPourCouverture(0, tx, ty)).toBe(NEIGE_NUE)
        expect(niveauPourCouverture(1, tx, ty)).toBeGreaterThanOrEqual(NEIGE_POUDREUSE)
      }
    }
    expect(seuils.size).toBeGreaterThan(5) // des plaques, pas une marche unique
  })

  it('à couverture pleine, le manteau est fermé et ~45 % en est profond, en plaques', () => {
    const W = 64
    let profondes = 0
    let isolees = 0
    const prof = (x: number, y: number) => niveauPourCouverture(1, x, y) === NEIGE_GENOUX
    for (let y = 1; y < W - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        expect(niveauPourCouverture(1, x, y)).not.toBe(NEIGE_NUE)
        if (!prof(x, y)) continue
        profondes++
        if (!prof(x - 1, y) && !prof(x + 1, y) && !prof(x, y - 1) && !prof(x, y + 1)) isolees++
      }
    }
    const part = profondes / ((W - 2) * (W - 2))
    expect(part).toBeGreaterThan(0.3)
    expect(part).toBeLessThan(0.6)
    expect(isolees / profondes).toBeLessThan(0.05)
  })

  it('la profonde est le CŒUR de la plaque : toute tuile profonde a un seuil plus bas que ses voisines poudreuses', () => {
    // À mi-couverture, une tuile profonde a forcément un seuil ≤ couverture − PROFONDE, et
    // une poudreuse un seuil > couverture − PROFONDE : la profonde est là où la neige est
    // arrivée en premier. C'est la définition, vérifiée sur tout un champ.
    const c = 0.75
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const n = niveauPourCouverture(c, x, y)
        const s = seuilDeNeige(x, y)
        if (n === NEIGE_GENOUX) expect(s).toBeLessThanOrEqual(c - GEL.NEIGE_PROFONDE)
        if (n === NEIGE_POUDREUSE) expect(s).toBeGreaterThan(c - GEL.NEIGE_PROFONDE)
      }
    }
  })
})

/** Le premier cycle neigeux de la saison — le rembobinage retrouve les VRAIES élections. */
function cycleNeigeux(): number {
  for (let c = GEL.MEMOIRE_CYCLES; c < 400; c++) {
    const f = frontDuCycle(c, SCALE)
    if (f && (f.type === 'neige' || f.type === 'blizzard')) return c
  }
  throw new Error('aucun cycle neigeux')
}

/** Une carte : herbe, une ROUTE au milieu, un gué et un lac. */
function carte(): ReturnType<typeof createEmptyMap> {
  const map = createEmptyMap(40, 20, TERRAIN_GRASS)
  for (let ty = 0; ty < 20; ty++) {
    setTile(map, 10, ty, TERRAIN_ROAD)
    setTile(map, 20, ty, TERRAIN_SHALLOW_WATER)
    setTile(map, 30, ty, TERRAIN_DEEP_WATER)
  }
  return map
}

function simEnneige(): { sim: SimState; tx: number } {
  const c = cycleNeigeux()
  const front = frontDuCycle(c, SCALE)!
  const sim = createSim(2026, { map: carte(), calendarScale: SCALE, meteoActive: true })
  sim.tick = front.endTick
  // Une colonne que la bande a bien traversée : au bout de la traversée.
  const tx = front.edge === 0 || front.edge === 2 ? 2 : sim.map.width - 3
  return { sim, tx }
}

describe('le niveau d’une tuile du monde', () => {
  it('après un front neigeux, des tuiles sont sous la neige ; l’eau, jamais (même gelée)', () => {
    const { sim } = simEnneige()
    let neige = 0
    for (let ty = 0; ty < sim.map.height; ty++) {
      for (let tx = 0; tx < sim.map.width; tx++) {
        const n = niveauDeNeige(sim, tx, ty)
        if (tx === 20 || tx === 30) expect(n).toBe(NEIGE_NUE)
        else {
          expect(n).toBe(niveauPourCouverture(neigeAuSol(sim, tx, ty), tx, ty)) // une seule loi
          if (n !== NEIGE_NUE) neige++
        }
      }
    }
    expect(neige).toBeGreaterThan(0) // la prémisse : il y a bien de la neige
  })

  it('le pas : poudreuse ×0,95, genoux ×0,75, QUEL QUE SOIT le terrain — la route sous la neige n’est plus une route', () => {
    const { sim } = simEnneige()
    // On cherche une tuile de ROUTE et une tuile d'HERBE de chaque niveau, sur toute la carte.
    const vus = new Map<string, { tx: number; ty: number }>()
    for (let ty = 1; ty < sim.map.height - 1; ty++) {
      for (const tx of [10, 5]) {
        const n = niveauDeNeige(sim, tx, ty)
        vus.set(`${tx === 10 ? 'route' : 'herbe'}-${n}`, { tx, ty })
      }
    }
    const world = { map: sim.map, structures: [], nodes: [], moverVillageId: null, etat: sim }
    const pas = (tx: number, ty: number): number => {
      // Un pas vers le bas, depuis le centre de la tuile : la vitesse se lit sur le déplacement.
      const m = moveAvatar(world, tx + 0.5, ty + 0.5, 0, 1, TICK_DT_S)
      return (m.y - (ty + 0.5)) / (BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)
    }
    let verifies = 0
    for (const [cle, { tx, ty }] of vus) {
      const niveau = Number(cle.split('-')[1])
      const attendu = niveau === NEIGE_GENOUX ? GEL.VITESSE_GENOUX
        : niveau === NEIGE_POUDREUSE ? GEL.VITESSE_POUDREUSE
          : TERRAINS[tx === 10 ? TERRAIN_ROAD : TERRAIN_GRASS]!.speedFactor
      expect(vitesseSurNeige(sim, tx, ty)).toBe(niveau === NEIGE_NUE ? undefined : attendu)
      expect(pas(tx, ty), cle).toBeCloseTo(attendu, 6)
      verifies++
    }
    expect(verifies).toBeGreaterThanOrEqual(2)
    // Et la prémisse de la règle « quel que soit le terrain » : une route ET une herbe sous la
    // neige ont été comparées (sinon la garde ne garde que l'herbe).
    expect([...vus.keys()].some((k) => k.startsWith('route-') && !k.endsWith('-0'))).toBe(true)
  })

  it('sans neige, le terrain garde son pas (la route est plus rapide)', () => {
    const sim = createSim(2026, { map: carte(), calendarScale: SCALE, meteoActive: false })
    sim.tick = 10 * TICKS_PER_CYCLE
    const world = { map: sim.map, structures: [], nodes: [], moverVillageId: null, etat: sim }
    const m = moveAvatar(world, 10.5, 5.5, 0, 1, TICK_DT_S)
    expect((m.y - 5.5) / (BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S)).toBeCloseTo(TERRAINS[TERRAIN_ROAD]!.speedFactor, 6)
    expect(vitesseSurNeige(sim, 10, 5)).toBeUndefined()
  })
})
