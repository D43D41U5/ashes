import { describe, it, expect } from 'vitest'
import { BALANCE, COMBAT, TEMPERATURE } from './balance'
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
import { cycleOffsetForStartHour, jourDeSaison, TICKS_PER_SEASON_DAY, YEAR_DAYS } from './time'

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

/**
 * LE CŒUR D'UNE SAISON, en jour de l'année — DÉRIVÉ d'`ACT_DAYS`, jamais écrit (`saisons.md`
 * S1 : quatre saisons de trente jours, 1 l'Éclosion · 2 l'Ardeur · 3 les Pluies · 4 le Grand
 * Froid). Le socle est une COURBE du jour de l'année depuis le 2026-08-23 (S4) : ses quatre
 * cardinaux tombent au cœur des saisons, donc c'est là — et seulement là — qu'un climat se
 * lit sans être mélangé à celui de sa voisine.
 */
const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2

/** Pose l'état au jour de saison voulu. Le montage ouvre au jour 1 (défaut de `createSim`) et
 *  tourne à l'échelle 1, donc un jour de saison vaut `TICKS_PER_SEASON_DAY` ticks pile. */
function auJour(state: SimState, jour: number): void {
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
}

describe('jauge temperature', () => {
  it('un nouvel avatar naît au CORPS SAIN (37 °C)', () => {
    const state = createSim(1)
    expect(spawn(state, 5, 5).temperature).toBe(TEMPERATURE.CORPS_SAIN)
  })
})

describe('ambientTemperature', () => {
  it("fond de vallée, MIDI, au cœur de l'Éclosion = air doux (≥ AMBIANT_DOUX)", () => {
    // MIDI, pas le tick 0 : depuis la rampe de nuit (`partDeNuit`), l'aube porte le plein
    // écart nocturne. Ce cas dit « il fait doux de jour » — il lui faut une heure de jour.
    // Et le CŒUR du printemps, pas son premier jour : l'Éclosion S'OUVRE ENCORE GELÉE (+3 °C
    // au jour 1) et dégèle sur ses trente jours — le dégel EST le contenu du printemps
    // (`saisons.md` S4, O1 close). Au cardinal, +8 °C : deux degrés au-dessus du seuil, la
    // garde reste vivante.
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(12, 1) })
    flatMap(state, 1 /* grass */)
    auJour(state, coeurDe(1))
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
    // MINUIT, et non « le tick de crépuscule » : la longueur du jour est SAISONNIÈRE depuis
    // `saisons.md` S6 (la nuit passe de 12,6 min l'été à 23,4 min l'hiver), donc seule une
    // heure murale désigne encore la pleine nuit à toute saison.
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(0, 1) })
    flatMap(state, 1 /* grass */)
    const exposed = ambientTemperature(state, 5, 5)
    state.structures.push({ type: 'house', tx: 5, ty: 5 } as never)
    const sheltered = ambientTemperature(state, 5, 5)
    expect(sheltered).toBeGreaterThan(exposed)
    // La nuit MORD depuis le chantier tension : sous abri, elle est amortie de moitié — DÉRIVÉ
    // de `SHELTER_FACTOR` ET de l'écart DU JOUR, jamais recopié. `ECART_NUIT` est une courbe
    // depuis `saisons.md` S5 (six degrés au cœur de l'Ardeur, quatorze à celui du Grand Froid) :
    // un chiffre écrit ici ne vaudrait que pour un jour de l'année, et mentirait les 119 autres.
    expect(sheltered - exposed).toBeCloseTo(
      TEMPERATURE.ECART_NUIT(jourDeSaison(state)) * (1 - TEMPERATURE.SHELTER_FACTOR),
      5,
    )
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
    // MIDI au cœur de l'Ardeur : le socle y culmine à +26 °C (`saisons.md` S4). L'ambiant doux
    // est la PRÉMISSE de ce cas, pas sa garde — on la veut donc large, pas serrée. L'échelle 1
    // tient le jour en place, et `advanceTemperature` n'avance pas le tick : l'air ne bouge pas
    // des 5 000 pas de dérive.
    const state = createSim(1, { calendarScale: 1, cycleOffset: cycleOffsetForStartHour(12, 1) })
    flatMap(state, 1)
    auJour(state, coeurDe(2))
    const e = spawn(state, 5, 5)
    expect(ambientTemperature(state, 5, 5), 'la prémisse : cet air-là est doux').toBeGreaterThanOrEqual(
      TEMPERATURE.AMBIANT_DOUX,
    )
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

describe('la tyrannie de la saison', () => {
  it("même lieu/heure : l'Ardeur brûle, les Pluies tiédissent, le Grand Froid mord", () => {
    const ambientAtDay = (day: number): number => {
      // MIDI : depuis la rampe de nuit (`partDeNuit`), le tick 0 est l'aube et porte le plein
      // écart nocturne. Ce cas isole la SAISON — il lui faut une heure sans froid nocturne.
      const state = createSim(1, { calendarScale: 1, cycleOffset: cycleOffsetForStartHour(12, 1) })
      flatMap(state, 9 /* scree, offset biome 0 */)
      auJour(state, day)
      return ambientTemperature(state, 5, 5)
    }
    // L'acte n'est plus un palier qui monte et ne redescend jamais : c'est une SAISON, et le
    // socle est une courbe du jour de l'année (`saisons.md` S1/S4). On lit les trois cardinaux
    // du versant descendant — le seul endroit où « strictement décroissant » a encore un sens.
    const ardeur = ambientAtDay(coeurDe(2))
    const pluies = ambientAtDay(coeurDe(3))
    const grandFroid = ambientAtDay(coeurDe(4))
    expect(pluies).toBeLessThan(ardeur)
    expect(grandFroid).toBeLessThan(pluies)
    // ET L'ANNÉE TOURNE (S1) : l'Éclosion qui SUIT cet hiver est déjà remontée au-dessus de lui.
    // La garde qui interdit de retomber dans l'escalier — la pression de long terme vient du
    // TOUR et du front de Cendre, plus de l'avancée dans l'arc.
    expect(ambientAtDay(coeurDe(1) + YEAR_DAYS)).toBeGreaterThan(grandFroid)
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

  it('LE FORK : la plaine est LÉTALE au cœur du Grand Froid, de nuit (le discours devient vrai)', () => {
    // Ambiant plaine (biome 0), minuit, cœur du Grand Froid. LU SUR LE VRAI MONDE et non
    // recomposé de constantes : `ACT_COLD` n'existe plus (`saisons.md` S4 l'a remplacé par la
    // courbe `SOCLE`, et la valeur EST le degré au lieu d'être un froid soustrait de `BASE`).
    // La Brume, le front et la Cendre ne peuvent qu'enfoncer ce chiffre plus bas.
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(0, 1) })
    flatMap(state, 1 /* grass — la plaine, aucun offset de biome */)
    auJour(state, coeurDe(4))
    const plaineHiverNuit = ambientTemperature(state, 5, 5)
    // ⚠ DEUX ÉCHELLES DEPUIS LE 2026-08-22 : `plaineHiverNuit` est un AIR (−16 °C : socle −2,
    // écart de nuit 14), et les dégâts se lisent sur un CORPS. On passe donc par
    // `cibleCorporelle` — l'endroit exact où l'air devient une température de corps.
    // L'ancienne jauge unique laissait comparer les deux sans le voir ; ici la conversion est
    // écrite, donc vérifiable.
    expect(plaineHiverNuit).toBeLessThan(AMBIANT_HYPOTHERMIE) // sous le seuil : cet air TUE
    expect(coldDamagePerTick(cibleCorporelle(plaineHiverNuit))).toBeGreaterThan(0)
  })

  it('la tenue d’hiver plancher AU-DESSUS de l’hypothermie → zéro dégât de froid', () => {
    expect(T.TENUE_FLOOR).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
    expect(coldDamagePerTick(cibleCorporelle(T.TENUE_FLOOR))).toBe(0)
  })

  it('sur glacier de nuit, la tenue d’hiver SAUVE : le nu MEURT de froid, le vêtu non', () => {
    // Carte VIDE en glacier (aucune source chaude parasite) + MINUIT : un ambiant franchement
    // mortel (le plancher `AMBIANT_MIN`), où seule la tenue sauve. L'heure murale, et non un
    // tick de crépuscule : la longueur du jour est saisonnière depuis `saisons.md` S6.
    const cold = (): Parameters<typeof createSim>[1] => ({ map: createEmptyMap(96, 96, 15 /* glacier */), cycleOffset: cycleOffsetForStartHour(0, 1) })
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
