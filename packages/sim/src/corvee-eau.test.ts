/**
 * LA CORVÉE D'EAU — « temps de trajet » (reprise de l'eau D2, décision d'Alexis).
 *
 * L'eau n'est ni un stock ni un item : la corvée EST le coût du trajet, bras occupés ∝ distance
 * à l'eau. Ces gardes PROUVENT LA PRÉMISSE plutôt que de la supposer (`une-garde-prouve-sa-premisse`) :
 *   · le chercheur de berge trouve VRAIMENT l'eau au loin (pas seulement l'eau collée au Feu) ;
 *   · un villageois fait l'aller-retour sur une distance NON TRIVIALE, mesurée sur la carte ;
 *   · et surtout, le coût CROÎT avec la distance — sans quoi « temps de trajet » ne veut rien dire
 *     (une eau à 2 tuiles passerait un test de « il est allé et revenu » sans rien prouver).
 */
import { describe, expect, it } from 'vitest'
import { FIRE_UPKEEP, SLOTS, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { inventoryOf } from './items'
import { createEmptyMap, eauLaPlusProcheMarchable, isWater, setTile, terrainAt } from './map'
import { createSim, step, type SimState } from './sim'
import { foundNpcVillage } from './worldgen'

const FEU_TX = 12
const FEU_TY = 12
const cheb = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

/**
 * Un village PNJ à UN habitant, sur un monde plat, avec UNE tuile d'eau posée où on la nomme.
 * Grenier plein et Feu au plein : plus aucune corvée concurrente n'est postée (la course à l'eau
 * est alors la seule chose que le villageois puisse faire — on ISOLE le trajet).
 */
function villageAvecEau(waterTx: number, waterTy: number): SimState {
  const map = createEmptyMap(48, 48, TERRAIN_GRASS)
  setTile(map, waterTx, waterTy, TERRAIN_SHALLOW_WATER)
  const sim = createSim(11, { map, nodes: [], worldEvents: false })
  foundNpcVillage(sim, FEU_TX, FEU_TY, 1)
  const chest = sim.structures.find((s) => s.type === 'chest')!
  chest.inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 45, fiber: 5, stew: 5 })
  sim.villages[0]!.fuel = FIRE_UPKEEP.CAPACITY
  return sim
}

/**
 * Pousse UNE course à l'eau et la déroule jusqu'au retour au Feu. Rend la distance de la berge
 * (mesurée par le VRAI chercheur), le nombre de ticks que la course a occupé le villageois, la
 * distance maximale atteinte (a-t-il vraiment marché jusqu'à l'eau ?) et s'il est rentré.
 */
function derouleCourse(waterTx: number, waterTy: number): {
  dist: number
  ticks: number
  maxDist: number
  rentre: boolean
} {
  const sim = villageAvecEau(waterTx, waterTy)
  const village = sim.villages[0]!
  const npc = sim.npcs[0]!
  const ent = () => sim.entities.find((e) => e.id === npc.entityId)!

  const packed = eauLaPlusProcheMarchable(sim.map, FEU_TX, FEU_TY, 20000)
  const bankTx = packed % sim.map.width
  const bankTy = (packed - bankTx) / sim.map.width
  const dist = cheb(bankTx, bankTy, FEU_TX, FEU_TY)

  // On ne laisse QUE la course à l'eau sur le tableau (grenier plein, Feu au plein garantissent
  // qu'aucune autre n'est postée ; on pose la nôtre à la main pour ne pas attendre la cadence).
  village.tasks = [{ id: village.nextTaskId, kind: 'fetch_water', priority: 1, claimedBy: null }]
  village.nextTaskId += 1

  let ticks = 0
  let maxDist = 0
  let atteintBerge = false
  const cap = dist * 30 + 400
  for (; ticks < cap; ticks++) {
    step(sim, [])
    const e = ent()
    const d = cheb(Math.floor(e.x), Math.floor(e.y), FEU_TX, FEU_TY)
    if (d > maxDist) maxDist = d
    if (cheb(Math.floor(e.x), Math.floor(e.y), bankTx, bankTy) <= 1) atteintBerge = true
    // Course finie : la tâche a quitté le tableau (dropTask true au retour) et le villageois est
    // revenu près du Feu. On mesure AVANT que la cadence n'en reposte une.
    if (atteintBerge && !village.tasks.some((t) => t.kind === 'fetch_water') && npc.task === null && d <= 2) break
  }
  return { dist, ticks, maxDist, rentre: cheb(Math.floor(ent().x), Math.floor(ent().y), FEU_TX, FEU_TY) <= 2 }
}

describe('la corvée d’eau — temps de trajet (D2)', () => {
  it('le chercheur de berge trouve l’eau AU LOIN, bordée de la tuile qu’on a posée', () => {
    const map = createEmptyMap(48, 48, TERRAIN_GRASS)
    setTile(map, 40, 12, TERRAIN_SHALLOW_WATER) // une seule eau, à 28 tuiles du Feu
    const packed = eauLaPlusProcheMarchable(map, FEU_TX, FEU_TY, 20000)
    expect(packed).toBeGreaterThanOrEqual(0)
    const tx = packed % map.width
    const ty = (packed - tx) / map.width
    // La berge rendue est marchable, et EFFECTIVEMENT au bord de NOTRE eau (pas d'une autre).
    expect(terrainAt(map, tx, ty)).toBe(TERRAIN_GRASS)
    let bordeNotreEau = false
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++)
        if (isWater(terrainAt(map, tx + ox, ty + oy)) && tx + ox === 40 && ty + oy === 12) bordeNotreEau = true
    expect(bordeNotreEau, 'la berge borde la tuile d’eau posée').toBe(true)
    // Et elle est LOIN : la distance de trajet est le sujet même du mécanisme.
    expect(cheb(tx, ty, FEU_TX, FEU_TY)).toBe(27)
  })

  it('sans eau atteignable, le chercheur rend -1 (course inerte, pas de plantage)', () => {
    const map = createEmptyMap(48, 48, TERRAIN_GRASS) // aucune eau
    expect(eauLaPlusProcheMarchable(map, FEU_TX, FEU_TY, 20000)).toBe(-1)
  })

  it('le villageois va PUISER au loin et revient au Feu', () => {
    const r = derouleCourse(40, 12) // eau à 28 → berge à 27
    expect(r.dist).toBeGreaterThanOrEqual(20) // non trivial : pas une eau collée au Feu
    expect(r.maxDist).toBeGreaterThanOrEqual(r.dist - 1) // il a bien atteint la berge
    expect(r.rentre).toBe(true) // et il est revenu au Feu
  })

  it('le COÛT croît avec la distance — c’est « temps de trajet », pas un forfait', () => {
    const proche = derouleCourse(18, 12) // eau à 6 → berge à 5
    const loin = derouleCourse(40, 12) // eau à 28 → berge à 27
    expect(loin.dist).toBeGreaterThan(proche.dist)
    // Le surcoût d'une berge plus lointaine vaut AU MOINS l'aller-retour supplémentaire (marche à
    // 0,2 tuile/tick → le vrai facteur est ~10× ; on affirme un plancher très large mais ∝).
    expect(loin.ticks - proche.ticks).toBeGreaterThanOrEqual(2 * (loin.dist - proche.dist))
  })
})
