import { describe, it, expect } from 'vitest'
import { COMBAT, TEMPERATURE } from './balance'
import { drainEvents } from './events'
import { addItems } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'
import {
  advanceTemperature,
  AMBIANT_HYPOTHERMIE,
  ambientTemperature,
  cibleCorporelle,
  coldDamagePerTick,
  coldEffectRamp,
  coldSpeedFactor,
  coldStaminaRegenFactor,
  driftStep,
} from './temperature'
import { cycleOffsetForStartHour, DAY_TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** spawnEntity retourne un id → on récupère l'objet entité. */
function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/** Remplit toute la carte d'un terrain uniforme. (La carte est plate : le froid vient du BIOME,
 *  plus de l'altitude.) */
function flatMap(state: SimState, terrain: number): void {
  const n = state.map.width * state.map.height
  state.map.terrain = new Array(n).fill(terrain)
}

describe('jauge temperature', () => {
  it('un nouvel avatar naît au CORPS SAIN (37 °C)', () => {
    const state = createSim(1)
    expect(spawn(state, 5, 5).temperature).toBe(TEMPERATURE.CORPS_SAIN)
  })
})

describe('ambientTemperature', () => {
  it('fond de vallée, MIDI, acte I = air doux (≥ AMBIANT_DOUX)', () => {
    // MIDI, pas le tick 0 : depuis la rampe de nuit (`partDeNuit`), l'aube porte le plein
    // `NIGHT_COLD`. Ce cas dit « il fait doux de jour » — il lui faut une heure de jour.
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(12) })
    flatMap(state, 1 /* grass */)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThanOrEqual(TEMPERATURE.AMBIANT_DOUX)
  })

  it('glacier = un air qui TUE (≤ AMBIANT_HYPOTHERMIE) — le froid vient du BIOME, plus de l\'altitude', () => {
    const state = createSim(1)
    flatMap(state, 15 /* glacier */)
    expect(ambientTemperature(state, 5, 5)).toBeLessThanOrEqual(AMBIANT_HYPOTHERMIE)
  })

  it("près d'un feu, la cible remonte au chaud (> AMBIANT_DOUX)", () => {
    const state = createSim(1)
    flatMap(state, 15) // sinon glacial
    state.structures.push({ type: 'fire', tx: 5, ty: 5 } as never)
    expect(ambientTemperature(state, 5, 5)).toBeGreaterThan(TEMPERATURE.AMBIANT_DOUX)
  })

  it('sous abri, le froid nocturne est amorti (~moitié)', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit dès le tick 0
    flatMap(state, 1 /* grass */)
    const exposed = ambientTemperature(state, 5, 5)
    state.structures.push({ type: 'house', tx: 5, ty: 5 } as never)
    const sheltered = ambientTemperature(state, 5, 5)
    expect(sheltered).toBeGreaterThan(exposed)
    // La nuit MORD depuis le chantier tension : sous abri, elle est amortie de moitié —
    // DÉRIVÉ de `SHELTER_FACTOR`, jamais recopié (12 °C → 6 °C rendus).
    expect(sheltered - exposed).toBeCloseTo(TEMPERATURE.NIGHT_COLD * (1 - TEMPERATURE.SHELTER_FACTOR), 5)
  })
})

describe('dérive thermostat', () => {
  it("driftStep rapproche de l'ambiant ; une meilleure isolation ralentit", () => {
    const d1 = driftStep(100, 0, 1)
    const d2 = driftStep(100, 0, 2)
    expect(d1).toBeLessThan(100) // refroidit vers 0
    expect(100 - d2).toBeLessThan(100 - d1) // isolation 2 → moins de perte
  })

  it('un humain sur glacier refroidit strictement', () => {
    const state = createSim(1)
    flatMap(state, 15)
    const e = spawn(state, 5, 5)
    const before = e.temperature
    advanceTemperature(state)
    expect(e.temperature).toBeLessThan(before)
  })

  it('reste au CONFORT du corps sur un ambiant doux, indéfiniment', () => {
    const state = createSim(1, { calendarScale: 1 }) // reste en acte I
    flatMap(state, 1)
    const e = spawn(state, 5, 5)
    for (let i = 0; i < 5000; i++) advanceTemperature(state)
    expect(e.temperature).toBeGreaterThanOrEqual(TEMPERATURE.CORPS_CONFORT)
  })

  it('les monstres sont ignorés (pas de température)', () => {
    const state = createSim(1)
    flatMap(state, 15)
    const e = spawn(state, 5, 5)
    state.monsters.push({ entityId: e.id, type: 'cendreux' } as never)
    const before = e.temperature
    advanceTemperature(state)
    expect(e.temperature).toBe(before)
  })
})

describe('hypothermie', () => {
  it('aucun dégât au-dessus du seuil, dégât croissant en dessous', () => {
    // ⚠ CES NOMBRES SONT DES CORPS, pas des airs (deux échelles depuis le 2026-08-22).
    expect(coldDamagePerTick(TEMPERATURE.CORPS_SAIN)).toBe(0)
    expect(coldDamagePerTick(TEMPERATURE.CORPS_HYPOTHERMIE)).toBe(0) // AU seuil : rien encore
    expect(coldDamagePerTick(TEMPERATURE.CORPS_HYPOTHERMIE - 2)).toBeGreaterThan(0)
    expect(coldDamagePerTick(TEMPERATURE.CORPS_MORTEL)).toBeGreaterThan(coldDamagePerTick(TEMPERATURE.CORPS_HYPOTHERMIE - 2))
  })

  it('mourir de froid émet entity_died cause=cold', () => {
    const state = createSim(1)
    flatMap(state, 15)
    const e = spawn(state, 5, 5)
    e.temperature = TEMPERATURE.CORPS_MORTEL
    // hp sous le dégât max d'un tick (HYPOTHERMIA_DAMAGE_MAX ≈ 0.3) pour mourir dès ce tick.
    e.hp = 0.2
    state.events.length = 0
    advanceTemperature(state)
    const died = state.events.find((ev) => ev.type === 'entity_died')
    expect(died).toBeDefined()
    expect((died as { cause?: string }).cause).toBe('cold')
    // L'avatar meurt puis respawn au Feu de son village (R10) : hp remonte à RESPAWN_HP,
    // il ne reste pas figé à 0.
    expect(e.hp).toBe(COMBAT.RESPAWN_HP)
  })

  it('un humain nu sur glacier de nuit atteint l\'hypothermie par la seule dérive, puis perd des PV (critère #3)', () => {
    const state = createSim(1)
    flatMap(state, 15 /* glacier */)
    const e = spawn(state, 5, 5)

    let ticks = 0
    const maxTicks = 20000
    while (e.temperature >= TEMPERATURE.CORPS_HYPOTHERMIE && ticks < maxTicks) {
      advanceTemperature(state)
      ticks += 1
    }
    expect(ticks).toBeLessThan(maxTicks) // l'hypothermie doit être atteinte avant la borne

    const hpAtHypothermia = e.hp
    for (let i = 0; i < 50; i++) advanceTemperature(state)
    expect(e.hp).toBeLessThan(hpAtHypothermia)
    expect(e.hp).toBeLessThan(100)
  })

  it('le respawn au Feu dégèle la température (fix #1)', () => {
    const state = createSim(1)
    const e = spawn(state, 5, 5)
    e.temperature = TEMPERATURE.CORPS_MORTEL
    e.hp = 0.2
    advanceTemperature(state)
    expect(e.temperature).toBe(COMBAT.RESPAWN_TEMPERATURE)
  })
})

describe("tyrannie de l'acte", () => {
  it('même lieu/heure : ambiant strictement décroissant I → II → III', () => {
    const ambientAtDay = (day: number): number => {
      // MIDI : depuis la rampe de nuit (`partDeNuit`), le tick 0 est l'aube et porte le plein
      // `NIGHT_COLD`. Ce cas isole l'ACTE — il lui faut une heure sans froid nocturne.
      const state = createSim(1, { calendarScale: 1, cycleOffset: cycleOffsetForStartHour(12) })
      flatMap(state, 9 /* scree, offset biome 0 */)
      state.tick = (day - 1) * TICKS_PER_SEASON_DAY
      return ambientTemperature(state, 5, 5)
    }
    const a1 = ambientAtDay(10) // acte I  (≤ 21)
    const a2 = ambientAtDay(30) // acte II (Grand Froid, 22-42)
    const a3 = ambientAtDay(50) // acte III (Cendre, > 42)
    expect(a2).toBeLessThan(a1)
    expect(a3).toBeLessThan(a2)
  })
})

describe('engourdissement (malus)', () => {
  it("rampe : 0 au confort, 1 à l'hypothermie, linéaire", () => {
    expect(coldEffectRamp(TEMPERATURE.CORPS_CONFORT)).toBe(0)
    expect(coldEffectRamp(TEMPERATURE.CORPS_HYPOTHERMIE)).toBe(1)
    expect(coldEffectRamp((TEMPERATURE.CORPS_CONFORT + TEMPERATURE.CORPS_HYPOTHERMIE) / 2)).toBeCloseTo(0.5, 5)
  })
  it("facteurs = 1 au confort, < 1 dès l'engourdissement", () => {
    expect(coldSpeedFactor(TEMPERATURE.CORPS_SAIN)).toBe(1)
    expect(coldStaminaRegenFactor(TEMPERATURE.CORPS_SAIN)).toBe(1)
    expect(coldSpeedFactor(TEMPERATURE.CORPS_HYPOTHERMIE)).toBeLessThan(1)
    expect(coldStaminaRegenFactor(TEMPERATURE.CORPS_HYPOTHERMIE)).toBeLessThan(1)
  })
})

describe('le froid létal & la tenue d’hiver (V2-15/16, fork froid tranché)', () => {
  const T = TEMPERATURE

  it('LE FORK : la plaine est LÉTALE en acte III de nuit (le discours devient vrai)', () => {
    // Ambiant plaine (biome 0), acte III, nuit = BASE − ACT_COLD[2] − NIGHT_COLD.
    const plaineActIIINuit = T.BASE - T.ACT_COLD(3) - T.NIGHT_COLD
    // ⚠ DEUX ÉCHELLES DEPUIS LE 2026-08-22 : `plaineActIIINuit` est un AIR (−14 °C), et les
    // dégâts se lisent sur un CORPS. On passe donc par `cibleCorporelle` — l'endroit exact où
    // l'air devient une température de corps. L'ancienne jauge unique laissait comparer les
    // deux sans le voir ; ici la conversion est écrite, donc vérifiable.
    expect(plaineActIIINuit).toBeLessThan(AMBIANT_HYPOTHERMIE) // sous le seuil : cet air TUE
    expect(coldDamagePerTick(cibleCorporelle(plaineActIIINuit))).toBeGreaterThan(0)
  })

  it('la tenue d’hiver plancher AU-DESSUS de l’hypothermie → zéro dégât de froid', () => {
    expect(T.TENUE_FLOOR).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
    expect(coldDamagePerTick(cibleCorporelle(T.TENUE_FLOOR))).toBe(0)
  })

  it('sur glacier de nuit, la tenue d’hiver SAUVE : le nu MEURT de froid, le vêtu non', () => {
    // Carte VIDE en glacier (aucune source chaude parasite) + nuit : un ambiant
    // franchement mortel (0), où seule la tenue sauve.
    const cold = (): Parameters<typeof createSim>[1] => ({ map: createEmptyMap(96, 96, 15 /* glacier */), cycleOffset: DAY_TICKS_PER_CYCLE })
    const froid = createSim(1, cold())
    const nu = spawn(froid, 5, 5)
    const chaud = createSim(1, cold())
    const vetu = spawn(chaud, 5, 5)
    addItems(vetu.inventory, { tenue_hiver: 1 }) // on l'habille
    // Un corps DÉJÀ refroidi (30 °C : sous le confort, au-dessus de l'hypothermie) — assez
    // bas pour que la chute soit courte, assez haut pour que la tenue ait quelque chose à tenir.
    nu.temperature = 30
    vetu.temperature = 30
    for (let t = 0; t < 8000; t++) {
      advanceTemperature(froid)
      advanceTemperature(chaud)
    }
    // Le nu dérive vers l'ambiant glacial (0) et FINIT par mourir de froid ; le vêtu,
    // plancheré au-dessus de l'hypothermie par sa tenue, ne gèle JAMAIS.
    const geleNu = drainEvents(froid).some((e) => e.type === 'entity_died' && e.entityId === nu.id && e.cause === 'cold')
    const geleVetu = drainEvents(chaud).some((e) => e.type === 'entity_died' && e.entityId === vetu.id && e.cause === 'cold')
    expect(geleNu).toBe(true) // le nu a gelé
    expect(geleVetu).toBe(false) // le vêtu, jamais
    expect(vetu.hp).toBe(100) // et il n'a pas pris un seul PV de froid
    expect(vetu.temperature).toBeGreaterThan(T.CORPS_HYPOTHERMIE) // il reste au-dessus du seuil
  })
})
