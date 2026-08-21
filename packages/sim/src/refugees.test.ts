/**
 * LES RÉFUGIÉS (V2-25, GDD §520) — arrivée cadencée, et les quatre gestes : recruter (+PNJ,
 * Foyer), nourrir (Foyer), refouler (ils repartent), dépouiller (Meute). Headless, sim-first.
 */
import { describe, expect, it } from 'vitest'
import { REFUGEES, SLOTS, TERRAIN_GRASS, TERRAIN_ROAD } from './balance'
import { drainEvents } from './events'
import { countOf, inventoryOf } from './items'
import { createEmptyMap } from './map'
import { advanceRefugees } from './refugees'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { applyVillageAction, getVillageOf, grantItems } from './village'
import { foundNpcVillage } from './worldgen'
import { rngNext } from './rng'

/** L'événement de recrutement, tel que les tests R12 le lisent. */
type Recrutement = { villageId: number; byEntityId: number; count: number }

/** Une carte avec une route (bande) pour que les réfugiés aient où arriver. */
function roadSim(): SimState {
  const map = createEmptyMap(96, 96, TERRAIN_GRASS)
  for (let x = 10; x < 40; x++) map.terrain[20 * 96 + x] = TERRAIN_ROAD
  return createSim(42, { map, worldEvents: true, calendarScale: 720 })
}

/** Amène la sim au jour 6 (PERIOD_DAYS, échelle 720 → tick 12000) et déclenche l'arrivée. */
function spawnAGroup(sim: SimState) {
  sim.tick = 12000 // seasonDayAtTick(12000, 720) = 6 ; 6 % 6 === 0 → arrivée
  advanceRefugees(sim)
  return sim.refugeeGroups[0]!
}

describe('les réfugiés (V2-25)', () => {
  it('arrivent sur une route à la cadence, et émettent refugees_arrived', () => {
    const sim = roadSim()
    drainEvents(sim)
    const g = spawnAGroup(sim)
    expect(sim.refugeeGroups).toHaveLength(1)
    expect(g.count).toBe(REFUGEES.COUNT)
    expect(sim.map.terrain[g.ty * 96 + g.tx]).toBe(TERRAIN_ROAD)
    expect(drainEvents(sim).some((e) => e.type === 'refugees_arrived')).toBe(true)
  })

  it('RECRUTER : les survivants rejoignent le village (+PNJ) et réchauffent (Foyer)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, g.tx + 0.5, g.ty + 0.5) // à portée du groupe
    grantItems(sim, id, { wood: 30, stone: 20 })
    applyVillageAction(sim, id, { type: 'light_fire' })
    const v = getVillageOf(sim, id)!
    const membersBefore = v.memberIds.length
    const me = sim.entities.find((e) => e.id === id)!
    const warmthBefore = me.warmth
    applyVillageAction(sim, id, { type: 'recruit_refugees', groupId: g.id })
    expect(sim.refugeeGroups).toHaveLength(0) // le groupe est absorbé
    expect(getVillageOf(sim, id)!.memberIds.length).toBeGreaterThan(membersBefore) // +PNJ
    expect(me.warmth).toBeGreaterThan(warmthBefore) // Foyer
  })

  it('LA RUMEUR (annales.md R12) : nourrir révèle le lieu porteur d\u2019annales le plus proche DU GROUPE', () => {
    const sim = roadSim()
    // Deux lieux humains : la Ferme est PLUS PROCHE du groupe (route en y=20) que la Charrette.
    sim.map.zones.push(
      { name: 'la Ferme brûlée I', x: 12, y: 30, w: 2, h: 2, kind: 'ferme_ruinee' }, // 0 — proche
      { name: 'la Charrette II', x: 80, y: 80, w: 2, h: 2, kind: 'charrette' }, //      1 — loin
      { name: 'le Tarn I', x: 14, y: 24, w: 2, h: 2, kind: 'tarn' }, //                 2 — plus proche MAIS sans annales
    )
    sim.map.annales = [
      { ere: 1, type: 'fondation', x: 13, y: 31, lieu: 'ferme_ruinee', cause: 'eau' },
      { ere: 1, type: 'fondation', x: 81, y: 81, lieu: 'charrette', cause: 'route' },
    ]
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, g.tx + 0.5, g.ty + 0.5)
    grantItems(sim, id, REFUGEES.FEED_COST)
    drainEvents(sim)
    applyVillageAction(sim, id, { type: 'feed_refugees', groupId: g.id })

    const me = sim.entities.find((e) => e.id === id)!
    expect(me.knownPois, 'la Ferme, mémoire de leur route').toContain(0)
    expect(me.knownPois, 'le Tarn est plus proche mais la rumeur parle des GENS').not.toContain(2)
    const events = drainEvents(sim)
    const rumeur = events.find((e) => e.type === 'refugee_rumeur')
    expect(rumeur).toMatchObject({ poiId: 0, kind: 'ferme_ruinee', name: 'la Ferme brûlée I', byEntityId: id })
    expect(events.some((e) => e.type === 'poi_discovered')).toBe(true)
  })

  it('la rumeur se tait quand le nourricier sait déjà tout — nourrir reste un acte, pas un farm de carte', () => {
    const sim = roadSim()
    sim.map.zones.push({ name: 'la Ferme brûlée I', x: 12, y: 30, w: 2, h: 2, kind: 'ferme_ruinee' })
    sim.map.annales = [{ ere: 1, type: 'fondation', x: 13, y: 31, lieu: 'ferme_ruinee', cause: 'eau' }]
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, g.tx + 0.5, g.ty + 0.5)
    const me = sim.entities.find((e) => e.id === id)!
    me.knownPois.push(0) // il connaît déjà la Ferme
    grantItems(sim, id, REFUGEES.FEED_COST)
    drainEvents(sim)
    applyVillageAction(sim, id, { type: 'feed_refugees', groupId: g.id })
    expect(drainEvents(sim).some((e) => e.type === 'refugee_rumeur')).toBe(false)
    expect(me.knownPois).toEqual([0]) // rien de neuf, rien de perdu
  })

  it('DÉPOUILLER : on prend leur bien, et ça refroidit (Meute)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const loot = countOf(g.inventory, 'fiber')
    expect(loot).toBeGreaterThan(0)
    const id = spawnEntity(sim, g.tx + 0.5, g.ty + 0.5)
    const me = sim.entities.find((e) => e.id === id)!
    applyVillageAction(sim, id, { type: 'rob_refugees', groupId: g.id })
    expect(sim.refugeeGroups).toHaveLength(0)
    expect(countOf(me.inventory, 'fiber')).toBe(loot) // le bien a changé de mains
    expect(me.warmth).toBeLessThan(0) // prédation
  })

  it('REFOULER : sans intervention, ils repartent à `until` (refugees_left)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    drainEvents(sim)
    sim.tick = g.until // l'heure du départ (un autre groupe peut arriver ce jour-là : on suit LE nôtre)
    advanceRefugees(sim)
    expect(sim.refugeeGroups.some((x) => x.id === g.id)).toBe(false) // le groupe d'origine est parti
    expect(drainEvents(sim).some((e) => e.type === 'refugees_left' && e.groupId === g.id)).toBe(true)
  })

  it('trop loin : le geste est refusé (rien ne se passe)', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, g.tx + 20, g.ty + 20) // hors de portée
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'rob_refugees', groupId: g.id } }])
    expect(sim.refugeeGroups).toHaveLength(1) // toujours là
  })
})

/**
 * R12 (village-pnj-evolution) — LE VILLAGE SE RÉPARE AUX RÉFUGIÉS (décision d'Alexis,
 * 2026-08-17). Le groupe arrive au tick 12000 ; la fenêtre du joueur court un demi-séjour
 * (NPC_CLAIM_TICKS = 28800 à l'échelle du banc) : le premier tick de recrutement PNJ est
 * donc 40800 — un jour de saison (17) qui n'est PAS un multiple de PERIOD_DAYS, aucun
 * groupe neuf ne vient brouiller le compte.
 */
describe('R12 — le village PNJ se répare aux réfugiés', () => {
  const CLAIM_TICK = 12000 + REFUGEES.NPC_CLAIM_TICKS

  /** Un village PNJ de 3, amputé de `blesses` membres (hp 0 — `vivants` les voit morts). */
  function villagePnj(sim: SimState, tx: number, ty: number, blesses: number) {
    const v = foundNpcVillage(sim, tx, ty, 3)
    for (const id of v.memberIds.slice(0, blesses)) {
      sim.entities.find((e) => e.id === id)!.hp = 0
    }
    return v
  }
  const vivants = (sim: SimState, v: { memberIds: number[] }) =>
    sim.entities.filter((e) => v.memberIds.includes(e.id) && e.hp > 0).length

  it('à mi-séjour, le village amputé prend CE QU\'IL LUI MANQUE — le reliquat attend, et le flux RNG ne bouge pas', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const v = villagePnj(sim, 60, 60, 1) // 2 vivants pour une fondation à 3 → manque 1
    drainEvents(sim)

    sim.tick = CLAIM_TICK - 1 // la fenêtre du joueur court encore
    advanceRefugees(sim)
    expect(vivants(sim, v)).toBe(2)
    expect(g.count).toBe(REFUGEES.COUNT)

    sim.tick = CLAIM_TICK
    const rngAvant = sim.rngState
    advanceRefugees(sim)
    // R10 : la DÉCISION ne tire rien — le seul pas de PRNG est celui, délibéré, de
    // `spawnEntity` (« le spawn fait partie de l'histoire déterministe »), un par recrue.
    expect(sim.rngState).toBe(rngNext(rngAvant))
    expect(vivants(sim, v)).toBe(3) // réparé à l'effectif de fondation…
    expect(g.count).toBe(REFUGEES.COUNT - 1) // …et pas plus : le reliquat attend
    expect(sim.refugeeGroups.some((x) => x.id === g.id)).toBe(true)
    const evt = drainEvents(sim).find((e) => e.type === 'refugees_recruited') as Recrutement | undefined
    expect(evt).toBeDefined()
    expect(evt!.villageId).toBe(v.id)
    expect(evt!.byEntityId).toBe(0) // c'est le village qui agit
    expect(evt!.count).toBe(1)

    sim.tick = CLAIM_TICK + 1 // au complet : plus rien, le groupe reste disponible
    advanceRefugees(sim)
    expect(vivants(sim, v)).toBe(3)
    expect(g.count).toBe(REFUGEES.COUNT - 1)
  })

  it('un village de JOUEUR amputé ne recrute jamais tout seul — la règle est PNJ-seulement', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const id = spawnEntity(sim, 60.5, 60.5)
    grantItems(sim, id, { wood: 30, stone: 20 })
    applyVillageAction(sim, id, { type: 'light_fire' })
    sim.entities.find((e) => e.id === id)!.hp = 0 // le fondateur est à terre : village « en manque »
    drainEvents(sim)
    sim.tick = CLAIM_TICK
    advanceRefugees(sim)
    expect(g.count).toBe(REFUGEES.COUNT) // personne n'a été pris
    expect(drainEvents(sim).some((e) => e.type === 'refugees_recruited')).toBe(false)
  })

  it('β-garde : un grenier qui ne peut pas nourrir ne recrute pas — regarni, il recrute', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const v = villagePnj(sim, 60, 60, 1)
    const grenier = sim.structures.find((s) => s.type === 'chest' && s.villageId === v.id)!
    grenier.inventory = inventoryOf(SLOTS.CHEST, {}) // le piège du j24-25 : rien à manger
    drainEvents(sim)
    sim.tick = CLAIM_TICK
    advanceRefugees(sim)
    expect(vivants(sim, v)).toBe(2) // personne ne rejoint une table vide
    expect(g.count).toBe(REFUGEES.COUNT)
    grenier.inventory = inventoryOf(SLOTS.CHEST, { berries: REFUGEES.NPC_CLAIM_MIN_FOOD })
    sim.tick = CLAIM_TICK + 1
    advanceRefugees(sim)
    expect(vivants(sim, v)).toBe(3) // la table remise, le village se répare
  })

  it('deux villages en manque : le plus PROCHE du groupe gagne', () => {
    const sim = roadSim()
    const g = spawnAGroup(sim)
    const loin = villagePnj(sim, 88, 88, 1)
    const pres = villagePnj(sim, g.tx + 8, Math.min(90, g.ty + 8), 1)
    drainEvents(sim)
    sim.tick = CLAIM_TICK
    advanceRefugees(sim)
    const evt = drainEvents(sim).find((e) => e.type === 'refugees_recruited') as Recrutement | undefined
    expect(evt!.villageId).toBe(pres.id)
    expect(vivants(sim, pres)).toBe(3)
    expect(vivants(sim, loin)).toBe(2) // il attendra le prochain tick / le reliquat
  })
})
