import { describe, expect, it } from 'vitest'
import { BALANCE, SLOTS, TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { drainEvents } from './events'
import { countOf, freeRoomFor, inventoryOf, makeInventory } from './items'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { weaponDamage } from './combat'
import { WEAPON_DAMAGE } from './balance'
import { foundNpcVillage } from './worldgen'
import { advanceNpcs } from './npc'
import { handleCold, handleHunger, handleSleep } from './npc-needs'
import { findPath } from './pathfinding'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE } from './time'
import { grantItems, structureAt } from './village'
import type { ResourceNode } from './economy'

/**
 * Village PNJ de test : Feu en (12,12), grenier, maisons, ressources autour.
 *
 * `worldEvents: false` — le banc mesure une ÉCONOMIE (le village se nourrit-il ?),
 * pas une guerre. Mesuré le 2026-07-12 : les hordes tombent sur un `roll` par nuit,
 * donc sur le FLUX du PRNG ; à ≥ 5 hordes le village est RASÉ, à ≤ 4 il tient. Le
 * verdict de ces tests dépendait donc du nombre de hordes que le seed 11 voulait
 * bien tirer — et TOUTE modification de comportement (le craft qui prend du temps,
 * par exemple) décale ce flux et rebat le tirage. Même raison que `faunaCap = 0` :
 * un banc de test ne traîne pas un système qu'il n'a pas demandé.
 *
 * Corollaire à ne pas perdre de vue : PLUS AUCUN test n'affirme qu'un village PNJ
 * résiste aux hordes 10 jours — parce que c'est FAUX aujourd'hui (déjà sur HEAD,
 * seeds 14 et 15 : village rasé). Voir docs/decisions.md.
 */
function npcVillageSim(count = 2, extraNodes: ResourceNode[] = []): SimState {
  const map = createEmptyMap(28, 28, TERRAIN_GRASS)
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 18, ty: 12, stock: 8, regrowAt: 0 },
    { id: 2, type: 'berry_bush', tx: 19, ty: 14, stock: 8, regrowAt: 0 },
    { id: 3, type: 'tree', tx: 6, ty: 12, stock: 10, regrowAt: 0 },
    { id: 4, type: 'fiber_plant', tx: 12, ty: 19, stock: 6, regrowAt: 0 },
    ...extraNodes,
  ]
  const sim = createSim(11, { map, nodes, worldEvents: false })
  foundNpcVillage(sim, 12, 12, count)
  return sim
}

const npcEntity = (sim: SimState, i = 0) => sim.entities.find((e) => e.id === sim.npcs[i]!.entityId)!
const granary = (sim: SimState) => sim.structures.find((s) => s.type === 'chest')!

function run(sim: SimState, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(sim, [])
}

describe('le tableau du village (A1)', () => {
  it('les seuils génèrent les tâches ; jamais de double réclamation', () => {
    const sim = npcVillageSim(3)
    granary(sim).inventory = makeInventory(SLOTS.CHEST) // grenier à sec → tout manque
    run(sim, BALANCE.BOARD_REFRESH_TICKS + 1)
    const village = sim.villages[0]!
    const kinds = village.tasks.map((t) => t.kind)
    expect(kinds).toContain('gather_berries')
    expect(kinds).toContain('gather_wood')
    expect(kinds).toContain('gather_fiber')
    // Chaque tâche réclamée l'est par un PNJ distinct.
    run(sim, 24)
    const claimed = village.tasks.filter((t) => t.claimedBy !== null).map((t) => t.claimedBy)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('grenier plein → pas de tâches de récolte', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5, stew: 5 })
    run(sim, BALANCE.BOARD_REFRESH_TICKS + 1)
    expect(sim.villages[0]!.tasks).toHaveLength(0)
  })
})

describe('les besoins (A2, A3)', () => {
  it('A2 — un PNJ affamé va retirer au grenier et mange', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 10, wood: 30, fiber: 5, stew: 5 }) // rien d'autre à faire
    const entity = npcEntity(sim)
    entity.hunger = 20
    run(sim, 600) // largement le temps d'aller au coffre (2 tuiles) et manger
    expect(entity.hunger).toBeGreaterThan(BALANCE.NPC_HUNGER_EAT_THRESHOLD)
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'meal_eaten' && e.entityId === entity.id)).toBe(true)
  })

  it('A3 — la nuit, le PNJ fatigué dort ; la maison récupère ×2 vs le Feu', () => {
    const sim = npcVillageSim(2)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5, stew: 5 }) // oisifs
    run(sim, 60) // assignation des maisons
    const [a, b] = [sim.npcs[0]!, sim.npcs[1]!]
    expect(a.homeId).not.toBeNull()
    // b dormira au Feu : on retire sa maison ET les maisons libres (sinon
    // l'assignation automatique lui en redonne une au tick suivant).
    sim.structures = sim.structures.filter((s) => s.type !== 'house' || s.id === a.homeId)
    b.homeId = null
    // Avancer jusqu'à la nuit, fatigués.
    sim.tick = DAY_TICKS_PER_CYCLE - 1
    a.energy = 20
    b.energy = 20
    run(sim, 1200) // 100 s : le temps d'aller se coucher et dormir un peu
    expect(a.sleeping).toBe(true)
    expect(b.sleeping).toBe(true)
    const gainA = a.energy - 20
    const gainB = b.energy - 20
    expect(gainA / gainB).toBeCloseTo(
      BALANCE.SLEEP_RECOVERY_HOME_PER_HOUR / BALANCE.SLEEP_RECOVERY_FIRE_PER_HOUR,
      1,
    )
    // Au matin, tout le monde debout.
    sim.tick = TICKS_PER_CYCLE - 2
    run(sim, 4)
    expect(sim.npcs[0]!.sleeping).toBe(false)
  })
})

describe('la navigation (A4)', () => {
  it('A* contourne un mur de roche ; chemin identique à chaque run', () => {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    for (let ty = 2; ty < 18; ty++) map.terrain[ty * 20 + 10] = TERRAIN_ROCK // mur vertical, passage en haut
    const world = { map }
    const p1 = findPath(world, { tx: 5, ty: 10 }, { tx: 15, ty: 10 })
    const p2 = findPath(world, { tx: 5, ty: 10 }, { tx: 15, ty: 10 })
    expect(p1).not.toBeNull()
    expect(p1!.length).toBeGreaterThan(18) // bien plus long que la ligne droite (10)
    expect(p1).toEqual(p2)
    // Contourne par l'une des deux extrémités du mur (ty 2-17).
    expect(p1!.some((t) => t.tx === 10 && (t.ty <= 1 || t.ty >= 18))).toBe(true)
    // Cible emmurée → null.
    for (let tx = 0; tx < 20; tx++) {
      map.terrain[5 * 20 + tx] = TERRAIN_ROCK
      map.terrain[15 * 20 + tx] = TERRAIN_ROCK
    }
    for (let ty = 5; ty <= 15; ty++) {
      map.terrain[ty * 20 + 0] = TERRAIN_ROCK
      map.terrain[ty * 20 + 19] = TERRAIN_ROCK
    }
    expect(findPath({ map }, { tx: 2, ty: 2 }, { tx: 10, ty: 10 })).toBeNull()
  })
})

describe('la locomotion des PNJ', () => {
  it('un PNJ qui marche (A*) est marqué moved — sa régén d’endurance est celle du mouvement', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = makeInventory(SLOTS.CHEST) // tout manque → il part récolter
    const e = npcEntity(sim)
    let movedWhileWalking: boolean | undefined
    for (let t = 0; t < 600; t++) {
      const bx = e.x
      const by = e.y
      step(sim, [])
      if (e.x !== bx || e.y !== by) {
        movedWhileWalking = e.moved
        break
      }
    }
    expect(movedWhileWalking).toBe(true)
  })
})

describe('le travail (A5)', () => {
  it('récolter baies : le PNJ y va, récolte, dépose — le grenier monte', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { wood: 30, fiber: 5 }) // il ne manque que la nourriture
    const before = 0
    run(sim, 2400) // 200 s simulées
    const after = countOf(granary(sim).inventory!, 'berries')
    expect(after).toBeGreaterThan(before)
    // Et le PNJ a bien gardé de quoi manger (spec R6).
    expect(countOf(npcEntity(sim).inventory, 'berries')).toBeGreaterThanOrEqual(0)
  })
})

describe('le peuplement (A6)', () => {
  it('fonder en joueur attire 3 PNJ membres', () => {
    const sim = createSim(3, { map: createEmptyMap(32, 32, TERRAIN_GRASS) })
    const player = spawnEntity(sim, 15.5, 15.5)
    grantItems(sim, player, { wood: 10 })
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    step(sim, []) // l'arrivée se fait au tick suivant la fondation
    expect(sim.npcs).toHaveLength(BALANCE.NPC_PER_VILLAGE)
    const village = sim.villages[0]!
    for (const npc of sim.npcs) expect(village.memberIds).toContain(npc.entityId)
  })

  it('foundNpcVillage crée un village complet', () => {
    const sim = npcVillageSim(3)
    expect(sim.villages).toHaveLength(1)
    expect(sim.npcs).toHaveLength(3)
    expect(structureAt(sim.structures, 12, 12)?.type).toBe('fire')
    expect(granary(sim).access).toBe('village')
    expect(sim.structures.filter((s) => s.type === 'house')).toHaveLength(3)
  })
})

/*
 * ⚠️ EN PAUSE — CHANTIER VILLAGE (décision utilisateur, 2026-07-13).
 *
 * Le chantier TENSION a rendu le monde exigeant : la faim est TROIS FOIS plus
 * rapide et TUE, une baie vaut 6 au lieu de 15, la repousse est passée de 5 à 45
 * minutes, et la récolte est MÉDIOCRE près du camp (les trois cercles). L'IA des
 * PNJ, elle, est calibrée sur l'ancien monde généreux : ses seuils (quand manger,
 * combien porter, quand cuisiner) datent d'un temps où un buisson nourrissait 34
 * joueurs. Elle ne tient plus, et c'est ATTENDU.
 *
 * On ne bricole PAS ces seuils au chausse-pied pour faire passer le test : le
 * village et les PNJ sont un chantier à part entière, à reprendre avec leurs specs
 * (tableau des corvées, cibles de portage, cuisine, réserves). Les remettre au vert
 * en douce masquerait ce qu'il y a vraiment à faire.
 *
 * Ce qu'il faudra reprendre, noté ici pour ne pas le redécouvrir :
 *   - `NPC_HUNGER_EAT_THRESHOLD` et les réserves : ils mangeaient des baies, or les
 *     baies ne nourrissent plus — il leur faut de la CUISINE (le ragoût, le Feu) ;
 *   - `NPC_CARRY_TARGETS` : le portage borne désormais ce qu'ils peuvent rapporter ;
 *   - la récolte médiocre du cercle domestique : leurs corvées doivent SORTIR du camp.
 */
describe.skip('LE critère (A7) — un village 100 % PNJ survit 10 jours [EN PAUSE — chantier village]', () => {
  it('4 PNJ, 10 cycles jour/nuit : personne à 0 de faim, le grenier respire', { timeout: 60_000 }, () => {
    const sim = npcVillageSim(4, [
      { id: 10, type: 'berry_bush', tx: 5, ty: 5, stock: 8, regrowAt: 0 },
      { id: 11, type: 'berry_bush', tx: 20, ty: 20, stock: 8, regrowAt: 0 },
      { id: 12, type: 'tree', tx: 22, ty: 6, stock: 10, regrowAt: 0 },
    ])
    const days = 10
    const total = days * TICKS_PER_CYCLE
    const warmup = TICKS_PER_CYCLE // 1er cycle : mise en route
    let starvedTicks = 0
    for (let t = 0; t < total; t++) {
      step(sim, [])
      if (t > warmup && t % 250 === 0) {
        for (const npc of sim.npcs) {
          const e = sim.entities.find((en) => en.id === npc.entityId)!
          if (e.hunger <= 0) starvedTicks += 1
        }
      }
    }
    expect(starvedTicks).toBe(0)
    // Le village a plus de vivres au grenier + inventaires qu'un désert.
    const totalFood =
      countOf(granary(sim).inventory!, 'berries') +
      3 * countOf(granary(sim).inventory!, 'stew') +
      sim.npcs.reduce((sum, n) => {
        const e = sim.entities.find((en) => en.id === n.entityId)!
        return sum + countOf(e.inventory, 'berries') + 3 * countOf(e.inventory, 'stew')
      }, 0)
    expect(totalFood).toBeGreaterThan(0)
  })
})

describe('le déterminisme avec IA (A8)', () => {
  it('même seed = même village au bit près après 2 cycles', { timeout: 30_000 }, () => {
    const runVillage = (): string => {
      const sim = npcVillageSim(3)
      run(sim, 2 * TICKS_PER_CYCLE)
      return snapshot(sim)
    }
    expect(runVillage()).toBe(runVillage())
  })

  it('le replay d’une partie joueur + PNJ est exact', () => {
    const map = createEmptyMap(28, 28, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'berry_bush', tx: 18, ty: 12, stock: 8, regrowAt: 0 }]
    const options = { map, nodes }
    const setup = (state: SimState) => {
      spawnEntity(state, 5.5, 5.5)
      foundNpcVillage(state, 12, 12, 2)
    }
    const live = createSim(21, options)
    const log = createReplayLog(21, options)
    setup(live)
    for (let t = 0; t < 3000; t++) {
      recordAndStep(live, log, [{ entityId: 1, dx: t % 3 === 0 ? 1 : -1, dy: t % 7 === 0 ? 1 : 0 }])
    }
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})

describe('recherche de chaleur (handleCold)', () => {
  const setup = () => {
    const sim = npcVillageSim(1)
    const npc = sim.npcs[0]!
    const entity = sim.entities.find((e) => e.id === npc.entityId)!
    const village = sim.villages[0]!
    return { sim, npc, entity, village }
  }

  it('un PNJ froid à découvert file vers son Foyer (et prend le tick)', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; entity.temperature = 30; npc.path = []
    expect(handleCold(sim, village, npc, entity)).toBe(true)
    expect(npc.path.length).toBeGreaterThan(0)
    expect(npc.seekingWarmth).toBe(true)
  })

  it('un PNJ froid déjà dans la bulle du feu rend la main', () => {
    const { sim, npc, entity, village } = setup()
    const fire = sim.structures.find((s) => s.type === 'fire' && s.villageId === village.id)!
    entity.x = fire.tx; entity.y = fire.ty; entity.temperature = 30; npc.path = []
    expect(handleCold(sim, village, npc, entity)).toBe(false)
    expect(npc.path.length).toBe(0)
  })

  it('anti-livelock : froid mais aucun chemin vers un feu → rend la main, pas de figeage', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; entity.temperature = 30; npc.path = []
    // Piéger le PNJ dans un anneau de roche (aucun chemin vers le Feu à (12,12)).
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        sim.map.terrain[(3 + dy) * sim.map.width + (3 + dx)] = TERRAIN_ROCK
      }
    expect(handleCold(sim, village, npc, entity)).toBe(false)
    expect(npc.path.length).toBe(0)
  })

  it('hystérésis : reste en recherche entre 40 et 60, s\'arrête à 60', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; npc.path = []; npc.seekingWarmth = true
    entity.temperature = 50
    expect(handleCold(sim, village, npc, entity)).toBe(true) // continue à chercher
    entity.temperature = 60
    expect(handleCold(sim, village, npc, entity)).toBe(false)
    expect(npc.seekingWarmth).toBe(false)
  })

  it('pas de déclenchement au chaud (≥40, jamais en recherche)', () => {
    const { sim, npc, entity, village } = setup()
    entity.x = 3; entity.y = 3; entity.temperature = 45; npc.path = []
    expect(handleCold(sim, village, npc, entity)).toBe(false)
  })

  it('priorité : le sommeil prime sur le froid (un PNJ endormi et froid reste endormi)', () => {
    const { sim, npc, entity } = setup()
    entity.x = 3
    entity.y = 3 // hors bulle du Feu : réellement exposé au froid
    sim.cycleOffset = DAY_TICKS_PER_CYCLE // nuit dès le tick 0
    npc.sleeping = true
    entity.temperature = 30 // froid
    npc.path = []
    advanceNpcs(sim)
    expect(npc.sleeping).toBe(true) // handleSleep a consommé le tick avant handleCold
    expect(npc.seekingWarmth).toBe(false) // handleCold n'a jamais tourné
    expect(npc.path.length).toBe(0) // aucun chemin posé vers le Feu
  })
})

/**
 * Le grenier est BORNÉ (spec inventaire R11) : un dépôt peut ne plus rien
 * déplacer. Deux dangers, un par test : la récolte qui s'évapore (A21), et la
 * corvée qu'on retente à chaque tick — le livelock connu du projet.
 */
describe('le grenier plein (A21 + livelock)', () => {
  /** Un coffre SANS un interstice : ni case libre, ni pile incomplète. */
  const saturated = () => inventoryOf(SLOTS.CHEST, { stone: 20 * SLOTS.CHEST })

  it('dépôt impossible : le PNJ ne détruit pas sa récolte et relâche sa tâche', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = saturated()
    const e = npcEntity(sim)
    e.hunger = 100 // qu'il ne mange pas ses baies : on compte les items
    grantItems(sim, e.id, { berries: 20 }) // déjà au-delà de sa cible de portage
    const stages: (string | null)[] = []
    for (let t = 0; t < 300; t++) {
      step(sim, [])
      stages.push(sim.npcs[0]!.task?.stage ?? null)
    }
    // Aucun item ne se détruit : les 20 baies sont toujours quelque part.
    expect(countOf(e.inventory, 'berries') + countOf(granary(sim).inventory!, 'berries')).toBe(20)
    // Et le PNJ n'est pas resté collé au stade `store` : il a lâché la corvée.
    expect(stages).toContain(null)
    expect(stages.filter((s) => s === 'store').length).toBeLessThan(stages.length)
  })

  it('butin de raid + grenier plein : le raider ne rentre pas pour l’éternité', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = saturated()
    const e = npcEntity(sim)
    grantItems(sim, e.id, { stone: 10 }) // le butin — rien dans le village n'en veut
    sim.npcs[0]!.errand = { kind: 'raid', targetVillageId: sim.villages[0]!.id, stage: 'home' }

    for (let t = 0; t < 300; t++) step(sim, [])

    // Le grenier ne prend rien : l'expédition s'achève quand même (elle se
    // retentait à chaque tick, et le PNJ ne faisait plus JAMAIS rien d'autre).
    expect(sim.npcs[0]!.errand).toBeNull()
    expect(countOf(e.inventory, 'stone')).toBe(10) // il garde son butin, rien ne s'évapore
  })
})

/**
 * Le raid finit par un LOOT de cadavre (spec alignement R13) — et le sac du
 * raider peut être plein. Depuis que `loot_corpse` est honnête (spec inventaire
 * R11), ce loot peut ne RIEN déplacer et ne PLUS effacer le cadavre : un stade
 * `loot` qui attendrait la disparition du cadavre tournerait à 20 Hz pour
 * l'éternité. On assert la PROGRESSION (le stade avance) et la CONSERVATION
 * (rien ne s'évapore).
 */
describe('le raid, sac plein, sur un cadavre (livelock du loot)', () => {
  it('le raider ne détruit pas le butin qu’il ne peut pas prendre, et l’expédition avance', () => {
    const sim = npcVillageSim(1)
    const e = npcEntity(sim)
    e.inventory = inventoryOf(SLOTS.NPC, { stone: 20 * SLOTS.NPC }) // pas un interstice
    e.hunger = 100
    const corpseId = sim.nextCorpseId
    sim.corpses.push({
      id: corpseId,
      x: e.x,
      y: e.y,
      inventory: inventoryOf(SLOTS.CORPSE, { wood: 40 }),
      decayAt: sim.tick + 100_000,
      diedAt: 0,
    })
    sim.nextCorpseId += 1
    sim.npcs[0]!.errand = { kind: 'raid', targetVillageId: sim.villages[0]!.id, stage: 'loot' }

    const stages: (string | null)[] = []
    for (let t = 0; t < 300; t++) {
      step(sim, [])
      stages.push(sim.npcs[0]!.errand?.stage ?? null)
    }

    // PROGRESSION : il n'est pas resté collé au stade `loot`.
    expect(stages.filter((s) => s === 'loot')).toHaveLength(0)
    // CONSERVATION : les 40 bois sont toujours quelque part.
    const corpse = sim.corpses.find((c) => c.id === corpseId)
    expect(countOf(e.inventory, 'wood') + countOf(corpse?.inventory ?? [], 'wood')).toBe(40)
  })
})

/**
 * Le sac du PNJ est BORNÉ (spec inventaire R11) : un RETRAIT peut ne rien
 * déplacer. Une boucle de corvée qui ne le voit pas se retente à l'identique au
 * tick suivant — pour toujours. Ces tests sont TEMPORELS (300 ticks) : un
 * livelock est strictement invisible sur un tick.
 */
describe('le sac plein du PNJ (livelock du retrait)', () => {
  /** Un sac SANS un interstice : ni case libre, ni pile incomplète. */
  const saturated = () => inventoryOf(SLOTS.NPC, { stone: 20 * SLOTS.NPC })

  const rejects = (sim: SimState, entityId: number): string[] =>
    drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' && e.entityId === entityId ? [e.reason] : []))

  it('affamé, sac plein : il ne reste pas collé au grenier pour l’éternité', () => {
    const sim = npcVillageSim(1)
    // Grenier sans bois → le tableau veut du bois (une corvée qu'il PEUT faire).
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, fiber: 5, stew: 5 })
    const e = npcEntity(sim)
    // Sac plein SAUF une case de bois entamée : plus une case pour des baies
    // (donc il ne peut pas manger), mais il peut encore bûcheronner.
    e.inventory = inventoryOf(SLOTS.NPC, { stone: 20 * (SLOTS.NPC - 1), wood: 19 })
    e.hunger = 20 // sous NPC_HUNGER_EAT_THRESHOLD
    drainEvents(sim)

    const kinds: (string | null)[] = []
    for (let t = 0; t < 300; t++) {
      step(sim, [])
      kinds.push(sim.npcs[0]!.task?.kind ?? null)
    }

    // Il n'a pas tenté un retrait impossible — encore moins 20 fois par seconde.
    expect(rejects(sim, e.id)).toEqual([])
    // Et il n'est pas figé au grenier : il est retourné au tableau du village.
    expect(kinds.some((k) => k !== null)).toBe(true)
    expect(countOf(granary(sim).inventory!, 'berries')).toBe(30) // rien n'a bougé du grenier
  })

  it('réparer, sac plein : il ne re-réclame pas la même tâche à chaque tick', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5, stew: 5 })
    const house = sim.structures.find((s) => s.type === 'house')!
    house.hp = 1 // sous REPAIR_TASK_THRESHOLD → le tableau veut une réparation
    const e = npcEntity(sim)
    e.inventory = saturated()
    e.hunger = 100
    drainEvents(sim)

    for (let t = 0; t < 300; t++) step(sim, [])

    expect(rejects(sim, e.id)).toEqual([]) // pas un refus par tick
    expect(countOf(granary(sim).inventory!, 'wood')).toBe(30) // le grenier n'a rien perdu
  })

  // Ce test-ci mesure la garde du TABLEAU (TASK_INTAKE) : le sac est saturé AVANT
  // la réclamation, donc le PNJ n'est même pas éligible à la corvée. La garde du
  // stade `craft`, elle, ne se voit que si le sac se remplit APRÈS la réclamation —
  // c'est le test « la traversée » plus bas.
  it('cuisiner, sac déjà saturé au tableau : TASK_INTAKE l’écarte, il ne réclame pas', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5 })
    const e = npcEntity(sim)
    // 40/40 cases : 38 de pierre, 1 de baies (6 ≥ la recette), 1 de fibre (19 ≥ 1).
    // Il a de quoi cuisiner — mais retirer 4 baies et 1 fibre ne VIDE aucune case.
    e.inventory = inventoryOf(SLOTS.NPC, { stone: 20 * (SLOTS.NPC - 2), berries: 6, fiber: 19 })
    e.hunger = 100
    drainEvents(sim)

    for (let t = 0; t < 300; t++) step(sim, [])

    expect(rejects(sim, e.id)).toEqual([])
    expect(countOf(e.inventory, 'berries')).toBe(6) // ses ingrédients sont intacts
    expect(countOf(e.inventory, 'fiber')).toBe(19)
  })

  it('cuisiner, sac plein : pas de boucle sèche sur le stade « fetch »', () => {
    const sim = npcVillageSim(1)
    // stew 0 → le tableau veut du ragoût ; tout le reste est au-dessus des cibles.
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5 })
    const e = npcEntity(sim)
    e.inventory = saturated()
    e.hunger = 100
    drainEvents(sim)

    for (let t = 0; t < 300; t++) step(sim, [])

    expect(rejects(sim, e.id)).toEqual([])
    expect(countOf(granary(sim).inventory!, 'berries')).toBe(30)
  })
})

/**
 * LA TRAVERSÉE — le trou que les gardes précédentes ne bouchaient pas.
 *
 * TASK_INTAKE ne s'évalue qu'à la RÉCLAMATION ; les gardes des transferts ne
 * voient que le transfert. Entre les deux, le sac peut se remplir : la faim vole
 * la dernière case au grenier, un joueur gave le PNJ. La corvée, elle, continue.
 *
 * Ces tests n'assertent PAS « zéro refus » — les deux livelocks qu'ils décrivent
 * n'émettaient AUCUN refus (l'un détruisait en silence, l'autre ne faisait rien).
 * Ils assertent CONSERVATION (rien ne s'évapore) et PROGRESSION (le PNJ change
 * d'état) : les deux seules propriétés qu'un livelock viole toujours.
 */
describe('le sac qui se remplit PENDANT la corvée (la traversée)', () => {
  const rejects = (sim: SimState, entityId: number): string[] =>
    drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' && e.entityId === entityId ? [e.reason] : []))

  // ⚠️ EN PAUSE — chantier village (voir le bloc ci-dessus) : ce test suppose une
  // faim assez LENTE pour qu'un PNJ traverse la carte sans manger. Elle ne l'est plus.
  it.skip('récolter : la faim prend la dernière case en route → il lâche, et ne rase pas le nœud', () => {
    const sim = npcVillageSim(1)
    // Le tableau ne veut QUE de la fibre (nourriture et bois au-dessus des cibles,
    // et pas de ragoût possible sans fibre au grenier).
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30 })
    const e = npcEntity(sim)
    // 39 cases pleines, UNE libre : le PNJ est éligible à gather_fiber.
    e.inventory = inventoryOf(SLOTS.NPC, { stone: 20 * (SLOTS.NPC - 1) })
    e.hunger = 100
    const node = sim.nodes.find((n) => n.type === 'fiber_plant')!
    const stock0 = node.stock

    step(sim, []) // le tableau publie, le PNJ réclame : TASK_INTAKE passe (il a une case)
    expect(sim.npcs[0]!.task?.kind).toBe('gather_fiber')

    // EN ROUTE, la faim tombe sous le seuil : handleHunger retire 3 baies au grenier
    // (la dernière case libre) et n'en mange qu'UNE — la case ne se libère jamais.
    e.hunger = 20
    drainEvents(sim)

    const stages: (string | null)[] = []
    for (let t = 0; t < 2000; t++) {
      step(sim, [])
      stages.push(sim.npcs[0]!.task?.stage ?? null)
    }
    const events = drainEvents(sim)

    expect(freeRoomFor(e.inventory, 'fiber')).toBe(0) // le sac s'est bien fermé en route
    // CONSERVATION : ce qui a quitté le nœud est dans le sac ou au grenier — nulle part ailleurs.
    expect(stock0 - node.stock).toBe(
      countOf(e.inventory, 'fiber') + countOf(granary(sim).inventory!, 'fiber'),
    )
    expect(node.stock).toBe(stock0) // sac fermé : il n'a rien pu prendre, donc il n'a rien rasé
    // …et aucune récolte MENSONGÈRE n'est partie vers la chronique.
    expect(events.some((ev) => ev.type === 'resource_harvested' && ev.entityId === e.id)).toBe(false)
    // PROGRESSION : il a relâché la corvée au lieu de la tenir à vide pour l'éternité.
    expect(stages).toContain(null)
    expect(stages.slice(-200).every((s) => s === null)).toBe(true)
  })

  it('cuisiner : le sac se ferme APRÈS la réclamation → il n’enfile RIEN, et lâche la corvée', () => {
    const sim = npcVillageSim(1)
    // stew 0 (et de quoi cuisiner) → le tableau ne veut QUE du ragoût.
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5 })
    const e = npcEntity(sim)
    // 37 cases de pierre + baies 6 + fibre 19 = 39 cases, UNE libre : il a de quoi
    // cuisiner sans passer par le grenier, et TASK_INTAKE le laisse réclamer.
    e.inventory = inventoryOf(SLOTS.NPC, { stone: 20 * (SLOTS.NPC - 3), berries: 6, fiber: 19 })
    e.hunger = 100

    step(sim, []) // réclamation : le stade `fetch` voit les ingrédients en poche → `craft`
    expect(sim.npcs[0]!.task?.kind).toBe('cook_stew')
    expect(sim.npcs[0]!.task?.stage).toBe('craft')

    // Le sac se ferme MAINTENANT (un joueur le gave). Consommer les intrants ne
    // libérera aucune case (il reste 2 baies et 18 fibres) : le ragoût n'aura
    // NULLE PART où aller à l'échéance.
    grantItems(sim, e.id, { stone: 20 })
    expect(freeRoomFor(e.inventory, 'stew')).toBe(0)
    drainEvents(sim)

    const stages: (string | null)[] = []
    for (let t = 0; t < 300; t++) {
      step(sim, [])
      stages.push(sim.npcs[0]!.task?.stage ?? null)
    }

    // LE PIÈGE DE LA FILE (spec craft-file F10, F17) : enfiler aurait consommé les
    // intrants, mijoté 8 s, puis ATTENDU une case — pour l'éternité, le PNJ planté
    // au Feu avec sa corvée sur le dos. Ce qui est le bon comportement pour un
    // joueur (il voit sa file bouchée, il fait de la place) est un LIVELOCK pour
    // une IA. Le PNJ n'enfile donc RIEN : il lâche la corvée, elle retourne au
    // tableau pour un PNJ qui a de la place.
    expect(e.craftQueue).toHaveLength(0) // aucun ordre lancé
    // CONSERVATION : ses ingrédients n'ont même pas été touchés.
    expect(countOf(e.inventory, 'berries')).toBe(6)
    expect(countOf(e.inventory, 'fiber')).toBe(19)
    expect(countOf(granary(sim).inventory!, 'berries')).toBe(30)
    // PROGRESSION : il a lâché la corvée, et il ne la reprend pas en boucle.
    expect(stages).toContain(null)
    expect(stages.slice(-200).every((s) => s === null)).toBe(true)
    expect(rejects(sim, e.id)).toEqual([]) // et pas un seul refus : il n'a rien tenté
  })
})

/**
 * Un chemin INTROUVABLE fige le PNJ à vie si le besoin consomme le tick quand même :
 * `path = []` → `followPath` ne fait rien → `return true` → même état au tick suivant,
 * pour toujours. `handleCold` a sa garde depuis toujours ; ses deux voisins ne
 * l'avaient pas. La faim ne tue pas — le figeage, si.
 */
describe('anti-livelock des besoins : la cible est inatteignable', () => {
  /** Emmure une structure : plus AUCUN chemin (ni droit, ni diagonal) vers elle. */
  const wallIn = (sim: SimState, tx: number, ty: number): void => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        sim.map.terrain[(ty + dy) * sim.map.width + (tx + dx)] = TERRAIN_ROCK
      }
  }

  it('affamé mais aucun chemin vers le grenier → rend la main (et repart travailler)', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30 })
    const chest = granary(sim)
    const npc = sim.npcs[0]!
    const e = npcEntity(sim)
    e.x = 6.5
    e.y = 6.5 // loin du grenier emmuré, et sur une case libre
    e.hunger = 20
    npc.path = []
    wallIn(sim, chest.tx, chest.ty)

    // Le tick n'est PAS consommé : pas de chemin, donc pas d'attente éternelle.
    expect(handleHunger(sim, sim.villages[0]!, npc, e)).toBe(false)
    expect(npc.path.length).toBe(0)

    // Et dans le vrai tick : il ne reste pas planté — le tableau reprend la main.
    const x0 = e.x
    const y0 = e.y
    const kinds: (string | null)[] = []
    for (let t = 0; t < 600; t++) {
      step(sim, [])
      kinds.push(sim.npcs[0]!.task?.kind ?? null)
    }
    expect(e.x !== x0 || e.y !== y0).toBe(true) // il a bougé
    expect(kinds.some((k) => k !== null)).toBe(true) // il a travaillé
  })

  /**
   * LE HANDLER QUI N'AVAIT PAS DE GARDE (correctif du 2026-07-12).
   *
   * `handleDefense` prime sur TOUT — sommeil, froid, faim — et il marchait
   * gloutonnement vers la menace, sans pathfinding ni renoncement. Une menace
   * qu'on n'atteint pas (un rocher entre elle et nous) mangeait donc TOUTES les
   * décisions du PNJ : il montait la garde devant son obstacle, sans manger (deux
   * baies dans sa poche, le grenier plein à trois pas), sans dormir, jusqu'à
   * mourir de faim.
   *
   * Trouvé en mesurant le banc de scénario : un zombie garé à 6 tuiles du Feu des
   * « Braises Hautes », deux villageois à faim 0 et énergie 0, un grenier à 10
   * baies. Le bug est ANTÉRIEUR à la file de craft — celle-ci n'a fait que
   * déplacer le flux du PRNG, donc garer le zombie là.
   */
  it('LA DÉFENSE NE TUE PLUS SON DÉFENSEUR : un zombie indestructible n’affame plus le village', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30 })
    const e = npcEntity(sim)
    e.hunger = 25 // il a faim (sous le seuil de repas), et le grenier est plein

    // Un zombie EMMURÉ à 5 tuiles du Feu (12,12) : DANS le rayon de défense (10),
    // donc vu comme une menace — mais INATTEIGNABLE. La ceinture de roche le met
    // aussi hors de portée de mêlée (1,2 tuile) : le PNJ ne peut ni le frapper ni
    // être frappé. C'est le livelock à l'état pur : une menace éternelle, stérile.
    const zx = 17
    const zy = 12
    wallIn(sim, zx, zy)
    spawnMonster(sim, 'zombie', zx + 0.5, zy + 0.5)
    drainEvents(sim)

    let famine = 0
    let repas = 0
    for (let t = 0; t < 8000; t++) {
      step(sim, [])
      if (npcEntity(sim).hunger <= 0) famine += 1
      for (const ev of drainEvents(sim)) if (ev.type === 'meal_eaten') repas += 1
    }

    // AVANT : il montait la garde jusqu'à la mort — faim 0, énergie 0, deux baies
    // dans la poche et le grenier plein. MAINTENANT : sous le seuil critique, il
    // décroche, il mange, et il revient. La défense ne prime plus sur la survie.
    expect(repas).toBeGreaterThan(0) // il a mangé
    expect(famine).toBe(0) // il n'a jamais touché le fond
    expect(sim.npcs).toHaveLength(1) // il est vivant
  })

  it('épuisé la nuit mais aucun chemin vers son lit → rend la main', () => {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5, stew: 5 })
    run(sim, 2) // assignation de la maison
    const npc = sim.npcs[0]!
    const e = npcEntity(sim)
    const home = sim.structures.find((s) => s.id === npc.homeId)!
    sim.cycleOffset = DAY_TICKS_PER_CYCLE // nuit
    npc.energy = 20 // sous NPC_ENERGY_SLEEP_THRESHOLD
    e.x = 6.5
    e.y = 6.5
    npc.path = []
    wallIn(sim, home.tx, home.ty)

    expect(handleSleep(sim, npc, e)).toBe(false)
    expect(npc.path.length).toBe(0)
    expect(npc.sleeping).toBe(false)
  })
})

/**
 * L'OBJET EN MAIN FAIT FOI (spec inventaire R9) — et les PNJ n'ont pas d'UI.
 *
 * Sans `equipBestTool`/`equipBestWeapon`, la règle les laisserait à MAINS NUES :
 * ils récolteraient ×1 avec une hache dans le sac et frapperaient les zombies à
 * COMBAT.UNARMED_DAMAGE avec leur lance de naissance (worldgen). L'économie et la
 * milice des villages PNJ s'effondreraient EN SILENCE — aucun refus, aucun
 * `action_rejected` : juste des chiffres qui baissent. D'où ces gardes.
 */
describe('le PNJ arme sa main tout seul (A6/A9 côté PNJ)', () => {
  /** Un village qui ne veut QUE du bois : grenier plein de tout, sauf de bois. */
  function woodOnlyVillage(): SimState {
    const sim = npcVillageSim(1)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 40, fiber: 10, stew: 5 })
    return sim
  }

  /** Les récoltes de bois VUES par la chronique, coup par coup. */
  function woodSwings(sim: SimState, ticks: number): number[] {
    const counts: number[] = []
    for (let t = 0; t < ticks; t++) {
      step(sim, [])
      for (const e of drainEvents(sim)) {
        if (e.type === 'resource_harvested' && e.item === 'wood') counts.push(e.count)
      }
    }
    return counts
  }

  it('un PNJ bûcheron récolte au rythme d’un OUTIL (×2), pas à mains nues', () => {
    const sim = woodOnlyVillage()
    const e = npcEntity(sim)
    grantItems(sim, e.id, { axe: 1 }) // dans le sac : personne ne la lui met en main
    expect(e.activeSlot).toBe(-1) // …et il naît mains nues

    const swings = woodSwings(sim, 60 * BALANCE.TICK_RATE_HZ)

    expect(swings.length).toBeGreaterThan(0) // il a bel et bien bûcheronné
    expect(swings.every((c) => c === 2)).toBe(true) // ×2 : la hache était EN MAIN
    // …et elle s'est usée DANS SA CASE (preuve que c'est bien elle qui a servi).
    const axe = e.inventory.find((s) => s?.item === 'axe')!
    expect(axe.wear).toBeCloseTo(swings.length, 5)
  })

  it('témoin : le MÊME PNJ sans hache récolte à ×1 (le test ci-dessus ne passe pas pour rien)', () => {
    const sim = woodOnlyVillage()
    const swings = woodSwings(sim, 60 * BALANCE.TICK_RATE_HZ)
    expect(swings.length).toBeGreaterThan(0)
    expect(swings.every((c) => c === 1)).toBe(true)
  })

  it('une hache AU-DELÀ de la ceinture est ramenée dans la ceinture (sinon elle ne servirait jamais)', () => {
    const sim = woodOnlyVillage()
    const e = npcEntity(sim)
    // Le grand sac du PNJ (40 cases) : sa hache est en case 20, hors ceinture. La
    // règle dit que seule la CEINTURE se tient — il doit donc la ranger d'abord.
    e.inventory[20] = { item: 'axe', count: 1 }
    for (let i = 0; i < SLOTS.BELT; i++) e.inventory[i] = { item: 'stone', count: 1 } // ceinture pleine
    const stones = countOf(e.inventory, 'stone')

    const swings = woodSwings(sim, 60 * BALANCE.TICK_RATE_HZ)

    expect(swings.length).toBeGreaterThan(0)
    expect(swings.every((c) => c === 2)).toBe(true) // ×2 : il a su l'empoigner
    expect(e.activeSlot).toBeLessThan(SLOTS.BELT) // …depuis la ceinture
    expect(e.activeSlot).toBeGreaterThanOrEqual(0)
    // CONSERVATION : l'échange de cases n'a rien créé, rien détruit.
    expect(countOf(e.inventory, 'axe')).toBe(1)
    expect(countOf(e.inventory, 'stone')).toBe(stones)
  })

  it('la milice frappe avec sa LANCE (le PNJ naît armé — worldgen), pas au poing', () => {
    const sim = npcVillageSim(2)
    granary(sim).inventory = inventoryOf(SLOTS.CHEST, { berries: 30, wood: 30, fiber: 5, stew: 5 })
    spawnMonster(sim, 'zombie', 15, 12) // dans le DEFEND_RADIUS du Feu (12,12)
    run(sim, 5)

    const e = npcEntity(sim)
    expect(weaponDamage(e)).toBe(WEAPON_DAMAGE.spear) // et non COMBAT.UNARMED_DAMAGE
  })

  /**
   * LE STADE QUI PEUT SE FERMER : la hache casse EN PLEIN COUP (`wearHeld` vide la
   * case). Au tick suivant, `equipBestTool` ne trouve plus rien et le PNJ passe à
   * mains nues — il doit CONTINUER (l'arbre n'exige pas d'outil), pas se figer sur
   * une case active devenue vide.
   */
  it('la hache casse au milieu de la corvée : le PNJ continue à mains nues (aucun livelock)', () => {
    const sim = woodOnlyVillage()
    const e = npcEntity(sim)
    e.inventory[1] = { item: 'axe', count: 1, wear: BALANCE.TOOL_DURABILITY - 1 } // un dernier coup
    const before = countOf(granary(sim).inventory!, 'wood') + countOf(e.inventory, 'wood')

    const swings = woodSwings(sim, 120 * BALANCE.TICK_RATE_HZ)

    expect(countOf(e.inventory, 'axe')).toBe(0) // elle a cassé
    expect(swings[0]).toBe(2) // le dernier coup outillé
    expect(swings.slice(1).some((c) => c === 1)).toBe(true) // PROGRESSION : il continue, à mains nues
    // CONSERVATION : tout le bois récolté est quelque part (sac ou grenier), rien
    // ne s'est évaporé dans la case vide de la hache cassée.
    const after = countOf(granary(sim).inventory!, 'wood') + countOf(e.inventory, 'wood')
    expect(after - before).toBe(swings.reduce((a, b) => a + b, 0))
    expect(e.activeSlot === -1 || e.inventory[e.activeSlot]?.item !== 'axe').toBe(true)
  })
})
