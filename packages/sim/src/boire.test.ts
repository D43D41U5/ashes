/**
 * « ILS BOIVENT LA CHALEUR » (décisions d'Alexis ⑯⑰, 2026-08-21) — le cendreux consomme la
 * chaleur du feu (le bois fond plus vite) et celle des corps (le coup vole des degrés), il
 * s'en rassasie, et la satiété l'endort puis fond.
 */
import { describe, it, expect } from 'vitest'
import { CENDREUX, FIRE, FIRE_UPKEEP, TERRAIN_GRASS } from './balance'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { createEmptyMap } from './map'
import { advanceFire } from './fire'
import { advanceUpkeep } from './village'
import { spawnMonster } from './monsters'
import { countOf, inventoryOf } from './items'
import { drainEvents } from './events'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { foundNpcVillage } from './worldgen'

function nuitDuJour(jour: number, largeur = 64): SimState {
  const state = createSim(1, {
    map: createEmptyMap(largeur, 64, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(0),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  state.tick += 1 // hors de la frontière du cycle (l'aube brute de worldevents y vit)
  return state
}

/** Un feu LIBRE nourri de `bois` bûches, ancré et en flammes. */
function feuNourri(state: SimState, tx: number, ty: number, bois: number): { fuelWood: () => number } {
  const fuel = inventoryOf(FIRE.FUEL_SLOTS, { wood: bois })
  const s = { id: 7000 + tx, type: 'fire', tx, ty, villageId: 0, hp: 100, fuel } as never
  state.structures.push(s)
  return { fuelWood: () => countOf((s as { fuel: never }).fuel, 'wood') }
}

describe('boire un feu libre (⑯)', () => {
  it('un buveur au contact : le bois fond (1 + CONSO) fois plus vite que le feu témoin', () => {
    const state = nuitDuJour(55)
    const bu = feuNourri(state, 20, 20, 5)
    const temoin = feuNourri(state, 50, 50, 5) // personne autour : la combustion nominale
    spawnMonster(state, 'cendreux', 20.5, 21.2) // au contact (< BOIRE.CONTACT)
    // On n'appelle QUE la combustion : le monstre ne doit pas bouger pour ce banc.
    const ticks = Math.ceil((2 * FIRE.BURN_TICKS) / (1 + CENDREUX.BOIRE.CONSO)) + 2
    for (let t = 0; t < ticks; t++) {
      state.tick += 1
      advanceFire(state)
    }
    // Le feu bu a perdu ~2 bûches quand le témoin n'en a pas fini une.
    expect(bu.fuelWood()).toBeLessThanOrEqual(3)
    expect(temoin.fuelWood()).toBe(5)
  })

  it('boire RASSASIE (⑰) : la satiété du buveur monte au feu', () => {
    const state = nuitDuJour(55)
    feuNourri(state, 20, 20, 10)
    const id = spawnMonster(state, 'cendreux', 20.5, 21.2)
    const m = state.monsters.find((x) => x.entityId === id)!
    for (let t = 0; t < 100; t++) {
      state.tick += 1
      advanceFire(state)
    }
    expect(m.satiete ?? 0).toBeCloseTo(100 * CENDREUX.BOIRE.SATIETE_FEU_PAR_TICK, 3)
  })

  it('LES BRAISES NE SE BOIVENT PAS — le plancher de la spec : le ward tient', () => {
    const state = nuitDuJour(55)
    const fuel = inventoryOf(FIRE.FUEL_SLOTS, {})
    const s = { id: 7100, type: 'fire', tx: 20, ty: 20, villageId: 0, hp: 100, fuel, emberUntil: state.tick + FIRE.EMBER_TICKS } as never
    state.structures.push(s)
    spawnMonster(state, 'cendreux', 20.5, 21.2)
    const avant = (s as { emberUntil: number }).emberUntil
    for (let t = 0; t < 200; t++) {
      state.tick += 1
      advanceFire(state)
    }
    expect((s as { emberUntil: number }).emberUntil).toBe(avant) // pas un tick de braise volé
  })
})

describe('boire un corps (⑯)', () => {
  it('le coup d\'un cendreux VOLE la température de la victime — l\'aval du froid fait le reste', () => {
    const state = nuitDuJour(55)
    const frappe = spawnEntity(state, 30.5, 30.5)
    const loin = spawnEntity(state, 30.5, 40.5) // même plaine, même froid : le témoin de dérive
    spawnMonster(state, 'cendreux', 31.3, 30.5) // au contact : il mordra tout seul
    let coups = 0
    for (let t = 0; t < 80 && coups === 0; t++) {
      step(state, [])
      coups += drainEvents(state).filter((e) => e.type === 'entity_damaged' && e.entityId === frappe).length
    }
    expect(coups).toBeGreaterThan(0)
    const eFrappe = state.entities.find((e) => e.id === frappe)!
    const eLoin = state.entities.find((e) => e.id === loin)!
    const vol = eLoin.temperature - eFrappe.temperature
    expect(vol).toBeGreaterThan(CENDREUX.BOIRE.COUP_TEMP * 0.6) // le froid est entré
    expect(vol).toBeLessThanOrEqual(CENDREUX.BOIRE.COUP_TEMP * (coups + 0.5))
  })
})

describe('boire le Foyer d\'un village (⑯)', () => {
  it('des bouches au Foyer drainent le stock plus vite — jamais sous le PLANCHER', () => {
    const bu = nuitDuJour(55)
    foundNpcVillage(bu, 30, 30, 0)
    const temoin = nuitDuJour(55)
    foundNpcVillage(temoin, 30, 30, 0)
    const feu = { x: bu.villages[0]!.fireTx, y: bu.villages[0]!.fireTy }
    spawnMonster(bu, 'cendreux', feu.x + 0.5, feu.y + 1.2)
    spawnMonster(bu, 'cendreux', feu.x + 1.2, feu.y + 0.5)
    for (let t = 0; t < 400; t++) {
      bu.tick += 1
      temoin.tick += 1
      advanceUpkeep(bu)
      advanceUpkeep(temoin)
    }
    expect(bu.villages[0]!.fuel).toBeLessThan(temoin.villages[0]!.fuel) // le siège a des dents
    // Et le plancher : un stock presque à sec ne se laisse pas finir à la bouche.
    const aSec = nuitDuJour(55)
    foundNpcVillage(aSec, 30, 30, 0)
    aSec.villages[0]!.fuel = CENDREUX.BOIRE.FOYER_PLANCHER + 0.02
    const feu2 = { x: aSec.villages[0]!.fireTx, y: aSec.villages[0]!.fireTy }
    spawnMonster(aSec, 'cendreux', feu2.x + 0.5, feu2.y + 1.2)
    aSec.tick += 1
    advanceUpkeep(aSec)
    // La bouche s'est arrêtée au plancher — seul le drain naturel (minuscule) a parlé.
    expect(aSec.villages[0]!.fuel).toBeGreaterThan(
      CENDREUX.BOIRE.FOYER_PLANCHER - FIRE_UPKEEP.DRAIN_PER_TICK * FIRE_UPKEEP.ACT_FACTOR[2] * 4,
    )
  })
})

describe('la satiété fond (⑰)', () => {
  it('sans rien à boire, elle décroît et le champ disparaît à zéro', () => {
    const state = nuitDuJour(55)
    const id = spawnMonster(state, 'cendreux', 30.5, 30.5)
    const m = state.monsters.find((x) => x.entityId === id)!
    m.satiete = CENDREUX.BOIRE.SATIETE_DECAY * 10.5
    for (let t = 0; t < 8; t++) step(state, [])
    expect(m.satiete).toBeLessThan(CENDREUX.BOIRE.SATIETE_DECAY * 10.5)
    for (let t = 0; t < 20; t++) step(state, [])
    expect(m.satiete).toBeUndefined() // fondue — plus un octet dans le snapshot
  })
})
