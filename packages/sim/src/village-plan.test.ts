/**
 * L'ÉVOLUTION DES VILLAGES PNJ (spec `village-pnj-evolution.md`) — les critères R1-R10.
 *
 * Le monde de test est celui de `npc.test.ts` : herbe nue, ressources à distance de
 * corvée, `worldEvents: false` (on mesure une économie, pas une guerre). L'aube et le
 * crépuscule se REJOIGNENT en sautant `sim.tick` au bord du cycle — le calendrier est
 * une fonction du tick, le saut est légal et ne tire rien.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS } from './balance'
import { drainEvents, type SimEvent } from './events'
import { addItems, countOf } from './items'
import { createEmptyMap } from './map'
import type { ResourceNode } from './economy'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from './time'
import { addStructure, createVillage } from './village'
import { desiredOrders } from './village-plan'
import { refreshBoard } from './village-board'
import { foundNpcVillage } from './worldgen'

function npcVillageSim(count = 3): SimState {
  const map = createEmptyMap(28, 28, TERRAIN_GRASS)
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 24, ty: 12, stock: 12, regrowAt: 0 },
    { id: 2, type: 'tree', tx: 3, ty: 12, stock: 12, regrowAt: 0 },
    { id: 3, type: 'fiber_plant', tx: 12, ty: 24, stock: 8, regrowAt: 0 },
    { id: 4, type: 'rock', tx: 24, ty: 24, stock: 12, regrowAt: 0 },
  ]
  const sim = createSim(11, { map, nodes, worldEvents: false })
  foundNpcVillage(sim, 12, 12, count)
  drainEvents(sim)
  return sim
}

const granary = (sim: SimState) => sim.structures.find((s) => s.type === 'chest')!
const village = (sim: SimState) => sim.villages[0]!
const alive = (sim: SimState) =>
  sim.entities.filter((e) => village(sim).memberIds.includes(e.id) && e.hp > 0).length

function run(sim: SimState, ticks: number, collect?: SimEvent[]): void {
  for (let t = 0; t < ticks; t++) {
    step(sim, [])
    const evs = drainEvents(sim)
    if (collect) collect.push(...evs)
  }
}

/** Saute juste AVANT une phase du cycle (0 = aube, DAY_TICKS = crépuscule), puis la franchit. */
function crossPhase(sim: SimState, phase: number, collect?: SimEvent[]): void {
  const cur = (sim.tick + sim.cycleOffset) % TICKS_PER_CYCLE
  let delta = (phase - cur + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  if (delta <= 3) delta += TICKS_PER_CYCLE
  sim.tick += delta - 3
  run(sim, 6, collect)
}

describe('la fondation au campement (R1-R2)', () => {
  it('plus aucune house : des paillasses, le mobilier, palier 1', () => {
    const sim = npcVillageSim(3)
    const types = sim.structures.map((s) => s.type)
    expect(types.filter((t) => t === 'house')).toHaveLength(0)
    expect(types.filter((t) => t === 'paillasse')).toHaveLength(3)
    // Et RIEN d'autre que le Feu et le grenier : pas de mobilier — il ferait
    // couverture dans la mêlée (mesuré, voir village-plan.ts).
    expect(sim.structures).toHaveLength(5)
    expect(village(sim).buildTier).toBe(1)
  })

  it('la paillasse est un domicile : chaque PNJ en reçoit une', () => {
    const sim = npcVillageSim(2)
    run(sim, 3)
    const homes = sim.npcs.map((n) => n.homeId)
    expect(homes.every((h) => h !== null)).toBe(true)
    expect(new Set(homes).size).toBe(2) // jamais deux dormeurs sur le même lit
  })
})

describe('le plan directeur (R3)', () => {
  it('au palier 2, il veut la PALISSADE puis les logis — et rien deux fois (R15)', () => {
    const sim = npcVillageSim(3)
    village(sim).buildTier = 2
    const orders = desiredOrders(sim, village(sim))
    // 3 logis 4×4 : 16 sols + 15 murs + 1 porte chacun ; l'enceinte est une PALISSADE
    // (66 rondins sur l'anneau 9) percée d'une porte charretière de 2 vantaux.
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'floor')).toHaveLength(48)
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'wall')).toHaveLength(45)
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'palissade')).toHaveLength(66)
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'door')).toHaveLength(3 + 2)
    // L'ENCEINTE D'ABORD (R15, décision d'Alexis 2026-08-17) : la sonde de siège a montré
    // qu'aucun village ne fermait jamais son anneau de son vivant — les cendreux passaient
    // entre les maisons. On s'abrite avant de se loger.
    expect(orders[0]).toMatchObject({ action: 'pose', structure: 'palissade' })
    const premierSol = orders.findIndex((o) => o.action === 'pose' && o.structure === 'floor')
    const dernierePalissade = orders.map((o) => o.action === 'pose' && o.structure === 'palissade').lastIndexOf(true)
    expect(dernierePalissade).toBeLessThan(premierSol) // tout l'anneau avant la première chambre
    // Et TOUT l'anneau — vantaux de la porte charretière COMPRIS — porte le drapeau de
    // cadence : sans lui sur les vantaux, la porte traînait 14 min derrière son anneau
    // fermé, une brèche fixe de 2 tuiles (revue déterminisme, 2026-08-17).
    for (const [i, o] of orders.entries()) {
      if (o.action !== 'pose') continue
      if (i <= dernierePalissade + 2) expect(o.enceinte, `ordre ${i} (${o.structure})`).toBe(true)
      else expect(o.enceinte).toBeUndefined()
    }
  })

  it('le tableau porte UNE tâche build, seulement si le grenier paie', () => {
    const sim = npcVillageSim(2)
    village(sim).buildTier = 2
    addItems(granary(sim).inventory!, { wood: 100, berries: 20 }) // au-dessus des planchers (bois du Feu, ventre plein)
    refreshBoard(sim, village(sim))
    expect(village(sim).tasks.filter((t) => t.kind === 'build')).toHaveLength(1)
    // Grenier à sec : le premier ordre (un sol, 1 bois) devient impayable → aucune tâche.
    const sec = npcVillageSim(2)
    village(sec).buildTier = 2
    granary(sec).inventory = granary(sec).inventory!.map(() => null)
    refreshBoard(sec, village(sec))
    expect(village(sec).tasks.filter((t) => t.kind === 'build')).toHaveLength(0)
  })

  it('au palier 2, le village veut de la pierre (vers la barre du palier 3)', () => {
    const sim = npcVillageSim(2)
    village(sim).buildTier = 2
    refreshBoard(sim, village(sim))
    expect(village(sim).tasks.some((t) => t.kind === 'gather_stone')).toBe(true)
  })
})

describe('les PNJ bâtissent (R4-R5)', () => {
  it('sans marteau au village, ils le forgent et posent l\'enceinte — par le pipeline', () => {
    const sim = npcVillageSim(2)
    village(sim).buildTier = 2
    addItems(granary(sim).inventory!, { wood: 200, berries: 40, fiber: 10, stone: 10 })
    // Le chemin dur (pose d'arête, matériau) est désormais l'ANNEAU (R15 : l'enceinte
    // d'abord) — la palissade est une arête comme le mur l'était. La cadence fait qu'on
    // ne vérifie pas un volume ici : le volume et la survie se mesurent au banc (R11).
    const events: SimEvent[] = []
    run(sim, 11000, events)
    const forged = events.filter((e) => e.type === 'item_crafted' && e.recipeId === 'hammer')
    expect(forged.length).toBeGreaterThanOrEqual(1)
    const npcIds = new Set(sim.npcs.map((n) => n.entityId))
    const built = events.filter(
      (e): e is Extract<SimEvent, { type: 'structure_built' }> =>
        e.type === 'structure_built' && npcIds.has(e.ownerId),
    )
    expect(built.length).toBeGreaterThanOrEqual(2)
    expect(built.every((e) => e.structure === 'palissade')).toBe(true) // l'anneau avant tout (R15)
    // …et la pièce est bien une ARÊTE de bois du plan (pas une pose pleine tuile).
    const palissade = sim.structures.find((s) => s.id === built[0]!.structureId)!
    expect(palissade.edges).toBeDefined()
  })
})

describe('la montée de palier au surplus (R6)', () => {
  it('grenier garni → palier 2 à l’aube ; grenier de naissance → rien', () => {
    const sim = npcVillageSim(2)
    addItems(granary(sim).inventory!, { wood: 40, berries: 20 })
    const events: SimEvent[] = []
    crossPhase(sim, 0, events)
    expect(village(sim).buildTier).toBe(2)
    expect(events.some((e) => e.type === 'village_stage_up' && e.stage === 2)).toBe(true)

    const pauvre = npcVillageSim(2) // le grenier de naissance : food 10 < 15
    crossPhase(pauvre, 0)
    expect(village(pauvre).buildTier).toBe(1)
  })
})

describe('la porte rituelle (R7)', () => {
  it('ouvre à l’aube, ferme au crépuscule — et jamais chez un village à chef humain', () => {
    const sim = npcVillageSim(2)
    const gate = addStructure(sim, 'door', 12, 19, village(sim).id, 0, 'village', 'wood', 1)
    // Un village à chef HUMAIN, avec sa porte close : le rituel ne le touche pas.
    const chief = spawnEntity(sim, 24.5, 4.5)
    const humain = createVillage(sim, { chiefId: chief, tx: 24, ty: 4, npcsArrived: true })
    const porteHumaine = addStructure(sim, 'door', 24, 6, humain.id, chief, 'village', 'wood', 1)
    drainEvents(sim)

    crossPhase(sim, 0)
    expect(gate.open).toBe(true)
    expect(porteHumaine.open).toBeUndefined()
    crossPhase(sim, DAY_TICKS_PER_CYCLE)
    expect(gate.open).toBeUndefined() // `undefined` EST « close » : le snapshot reste léger
    expect(porteHumaine.open).toBeUndefined()
  })
})

describe('la prospérité attire (R9)', () => {
  it('au plafond du palier 1 rien n’arrive ; au palier 2 le colon vient, avec sa paillasse', () => {
    const sim = npcVillageSim(3) // 3 = le plafond du campement
    addItems(granary(sim).inventory!, { berries: 60 })
    village(sim).buildTier = 1
    // food 70 ≥ 18 mais effectif = plafond → personne. (La barre du palier 2 exige
    // du bois : le grenier n'en a pas, le palier ne monte pas pendant ce test.)
    crossPhase(sim, 0)
    expect(alive(sim)).toBe(3)

    village(sim).buildTier = 2 // plafond 6 : la porte s'ouvre
    const events: SimEvent[] = []
    crossPhase(sim, 0, events)
    expect(alive(sim)).toBe(4)
    expect(events.some((e) => e.type === 'settler_arrived')).toBe(true)
    expect(sim.structures.filter((s) => s.type === 'paillasse')).toHaveLength(4)
  })
})

describe('la palissade au marteau du joueur (décision 2026-08-01)', () => {
  it('se pose sur une arête ; la pose pleine-tuile est refusée avec son motif', () => {
    const sim = createSim(3, { map: createEmptyMap(32, 32, TERRAIN_GRASS) })
    const player = spawnEntity(sim, 15.5, 15.5)
    const e = sim.entities.find((x) => x.id === player)!
    addItems(e.inventory, { wood: 20, hammer: 1 })
    e.activeSlot = e.inventory.findIndex((s) => s?.item === 'hammer')
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    drainEvents(sim)

    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'build', structure: 'palissade', tx: 17, ty: 15, edges: 1 } }])
    const posee = sim.structures.find((s) => s.type === 'palissade')
    expect(posee).toBeDefined()
    expect(posee!.edges).toBe(1)
    expect(posee!.ownerId).toBe(player)

    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'build', structure: 'palissade', tx: 18, ty: 15 } }])
    const evs = drainEvents(sim)
    expect(evs.some((ev) => ev.type === 'action_rejected' && ev.reason === 'la palissade se pose sur une arête')).toBe(true)
    expect(sim.structures.filter((s) => s.type === 'palissade')).toHaveLength(1)
  })
})

describe('le déterminisme (R10)', () => {
  it('deux runs identiques, chantier compris, rendent le même état', () => {
    const world = (): SimState => {
      const sim = npcVillageSim(2)
      village(sim).buildTier = 2
      addItems(granary(sim).inventory!, { wood: 120, berries: 30, fiber: 8 })
      return sim
    }
    const a = world()
    const b = world()
    run(a, 3000)
    run(b, 3000)
    expect(JSON.stringify(a.structures)).toBe(JSON.stringify(b.structures))
    expect(JSON.stringify(a.villages)).toBe(JSON.stringify(b.villages))
    expect(countOf(granary(a).inventory!, 'wood')).toBe(countOf(granary(b).inventory!, 'wood'))
  })
})
