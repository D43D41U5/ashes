import { describe, it, expect } from 'vitest'
import { BALANCE, BRAISE, COMBAT, TEMPERATURE } from './balance'
import { chargePleine } from './braise'
import { respawn } from './combat'
import { drainEvents } from './events'
import { addItems } from './items'
import { createEmptyMap } from './map'
import { palierDuSol } from './etages'
import { TERRASSES } from './terrasses'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import {
  advanceTemperature,
  airNonBorneAt,
  airRessenti,
  AMBIANT_HYPOTHERMIE,
  ambientTemperature,
  cransExiges,
  baselineTemperatureAt,
  cibleCorporelle,
  coldDamagePerTick,
  coldEffectRamp,
  coldSpeedFactor,
  coldStaminaRegenFactor,
  driftStep,
  isSheltered,
  socleDuJour,
} from './temperature'
import { cycleOffsetForStartHour, jourDeSaison, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, YEAR_DAYS } from './time'

/** spawnEntity retourne un id → on récupère l'objet entité. */
function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/**
 * ⚠ **VIDE LA BRAISE — à n'employer que pour éprouver le FROID NU** (`braise.md` B-R6, 2026-10-03).
 *
 * Depuis que le corps lit un déficit en crans et non l'air, un avatar naît avec une braise PLEINE
 * et le froid ne l'atteint plus pendant deux cycles : une garde qui veut mesurer ce que l'air fait
 * à un corps doit donc DIRE qu'il n'a rien pour se couvrir. La prémisse était implicite avant la
 * braise ; elle est écrite maintenant, et c'est mieux.
 */
function sansBraise(e: Entity): Entity {
  e.braise = { niveau: 0, charge: 0 }
  return e
}

/**
 * Remplit toute la carte d'un terrain uniforme — et la laisse SANS `map.palier`, donc **au palier
 * 0 partout** (`palierDuSol` rend 0 sur une carte qui n'en porte pas).
 *
 * ⚠ Depuis le 2026-09-30 (`FROID_PAR_ETAGE`), ce n'est plus « la carte est plate » : c'est un
 * choix de montage. Ces gardes-là isolent le BIOME et l'HEURE, et le froid d'étage y est nul par
 * construction. Celles qui éprouvent l'altitude montent leur carte avec `carteEnPaliers`,
 * plus bas — sans quoi elles passeraient **au vert à vide**.
 */
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

  it('glacier = un air qui TUE (≤ AMBIANT_HYPOTHERMIE) — au palier 0, le BIOME suffit déjà', () => {
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
    // …et il RESTE à terre (2026-08-31) : le froid tue, il ne relève pas. Le réveil au Feu
    // (R10) appartient au geste du joueur — c'est `respawn` qui remonte les PV.
    expect(e.hp).toBe(0)
    expect(e.downedAt).toBe(state.tick)
    respawn(state, e)
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

  it('le réveil au Feu dégèle la température (fix #1)', () => {
    const state = createSim(1)
    const e = spawn(state, 5, 5)
    e.temperature = TEMPERATURE.CORPS_MORTEL
    e.hp = 0.2
    advanceTemperature(state) // le froid l'emporte…
    respawn(state, e) // …et c'est le RÉVEIL qui dégèle (2026-08-31), pas la mort
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

  it('ce qui PLANCHE le ressenti au-dessus de l’hypothermie, c’est la braise — plus un vêtement', () => {
    // L'HÉRITIÈRE de « la tenue d'hiver plancher au-dessus de l'hypothermie » (retirée le
    // 2026-10-03, B-R15) : la même inégalité, sur ce qui la tient désormais. Une braise qui COUVRE
    // rend `AMBIANT_DOUX` quelle que soit la demande — c'est le plancher, et il se vide.
    for (const demande of [0, 1, 2, 3, 4]) {
      const couverte = { niveau: demande, charge: chargePleine(demande) } // couvre n'importe quelle demande
      expect(airRessenti(demande, couverte), `demande ${demande}`).toBe(T.AMBIANT_DOUX)
    }
    expect(T.AMBIANT_DOUX).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
    expect(coldDamagePerTick(cibleCorporelle(T.AMBIANT_DOUX))).toBe(0)
    // ⚠ ET LE CONTRÔLE QUI MANQUAIT AVANT : un corps que rien ne couvre, lui, prend des dégâts.
    expect(coldDamagePerTick(cibleCorporelle(airRessenti(1, { niveau: 0, charge: 0 })))).toBeGreaterThan(0)
  })

  it('sur glacier de nuit, LE VÊTU MEURT COMME LE NU — la tenue ne planche plus rien (B-A9)', () => {
    // ═══ LE CRITÈRE B-A9 AU MOT : « le froid tue sans vêtement » ═══
    //
    // Cette garde affirmait l'inverse exact jusqu'au 2026-10-03 (« la tenue SAUVE »). Elle garde son
    // montage — carte VIDE en glacier, aucune source chaude parasite, MINUIT à l'heure murale (la
    // longueur du jour est saisonnière, `saisons.md` S6) — et retourne sa conclusion : ce qui sauve
    // est la braise, et elle seule. MESURÉ avant le retrait : une tenue dans le sac tenait les
    // QUATRE paliers du Grand Froid indéfiniment (31,40 °C, 100 PV) ; c'est ça qui n'est plus.
    const cold = (): Parameters<typeof createSim>[1] => ({ map: createEmptyMap(96, 96, 15 /* glacier */), cycleOffset: cycleOffsetForStartHour(0, 1) })
    const froid = createSim(1, cold())
    const nu = sansBraise(spawn(froid, 5, 5))
    const chaud = createSim(1, cold())
    const vetu = sansBraise(spawn(chaud, 5, 5))
    addItems(vetu.inventory, { tenue_hiver: 1 }) // on l'habille — et ça ne change RIEN
    // Un corps DÉJÀ refroidi (30 °C : sous le confort, au-dessus de l'hypothermie) — assez bas pour
    // que la chute soit courte. Les deux braises sont VIDES : c'est la prémisse, sans elle le froid
    // n'atteint aucun des deux corps et la garde mesurerait son montage.
    nu.temperature = 30
    vetu.temperature = 30
    for (let t = 0; t < 8000; t++) {
      advanceTemperature(froid)
      advanceTemperature(chaud)
    }
    const geleNu = drainEvents(froid).some((e) => e.type === 'entity_died' && e.entityId === nu.id && e.cause === 'cold')
    const geleVetu = drainEvents(chaud).some((e) => e.type === 'entity_died' && e.entityId === vetu.id && e.cause === 'cold')
    expect(geleNu, 'le nu gèle — la prémisse : cet air tue').toBe(true)
    expect(geleVetu, 'ET LE VÊTU AUSSI : plus aucun objet ne garde du froid').toBe(true)
    // Au bit : le vêtement ne déplace plus la moindre décimale du corps.
    expect(vetu.temperature).toBe(nu.temperature)
  })
})

describe('la thermogenèse — la faim suit le froid RESSENTI (décision d’Alexis, 2026-08-29)', () => {
  const T = TEMPERATURE

  /** La pente ATTENDUE d'un tick complet (`step`) : le drain de base (`advanceEconomy`) plus
   *  le surcoût thermique (`advanceTemperature`) pour un manque donné — le même manque que la
   *  dérive du corps, sur le ressenti APRÈS feu, abri et tenue. */
  const penteParTick = (manque: number): number =>
    (BALANCE.HUNGER_PER_CYCLE_HOUR + manque * BALANCE.HUNGER_COLD_PER_DEGREE_HOUR) /
    (TICKS_PER_CYCLE / 24)

  /** Pente de faim OBSERVÉE sur `n` ticks complets — sur `step`, jamais sur une phase seule :
   *  la loi vit dans DEUX passes (base en économie, surcoût en température). */
  const penteObservee = (state: SimState, e: Entity, n: number): number => {
    const h = e.hunger
    for (let t = 0; t < n; t++) step(state, [])
    return (h - e.hunger) / n
  }

  it('sur glacier, le drain = base + manque MAXIMAL × coefficient (l’air est au plancher du monde)', () => {
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(12, 1) })
    flatMap(state, 15 /* glacier */)
    // ⚠ BRAISE VIDE — ET CE N'EST PAS PARCE QUE LE GLACIER SERAIT COUVERT. `cransExiges` y vaut 2
    //   et une braise NÉE n'en couvre qu'UN (B-R7b, `floor`) : le drain ne tomberait donc pas à
    //   zéro, il tomberait à `penteParTick(22)` — un cran de retard — au lieu des
    //   `penteParTick(24)` que cette garde mesure. L'écart est de 6 %, et c'est précisément pour ça
    //   que la prémisse doit être ÉCRITE : à vide, le déficit de 2 crans rend `clampTemp(6 − 44)`
    //   = `AMBIANT_MIN`, donc le manque maximal est EXACTEMENT celui d'avant la braise, au bit.
    const e = sansBraise(spawn(state, 5, 5))
    // La prémisse rend la garde stable : cet air est CLAMPÉ à `AMBIANT_MIN`, donc le manque
    // vaut exactement `AMBIANT_DOUX − AMBIANT_MIN` quoi que la météo ajoute par-dessus.
    expect(ambientTemperature(state, 5, 5)).toBe(T.AMBIANT_MIN)
    expect(penteObservee(state, e, 200)).toBeCloseTo(penteParTick(T.AMBIANT_DOUX - T.AMBIANT_MIN), 6)
  })

  it('près d’un feu, le surcoût tombe à ZÉRO — se chauffer, c’est économiser des vivres', () => {
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(12, 1) })
    flatMap(state, 15 /* glacier — sans le feu, le plein tarif du cas précédent */)
    state.structures.push({ id: 9200, type: 'fire', tx: 6, ty: 5, villageId: 0, hp: 100 } as never)
    const e = spawn(state, 5, 5)
    expect(
      ambientTemperature(state, 5, 5),
      'la prémisse : la bulle du feu rend cet air doux',
    ).toBeGreaterThanOrEqual(T.AMBIANT_DOUX)
    expect(penteObservee(state, e, 200)).toBeCloseTo(penteParTick(0), 6)
  })

  it('CE qui PLAFONNE la note, c’est le déficit d’UN cran — plus la tenue d’hiver', () => {
    // L'héritière de « la tenue PLAFONNE la note » (B-R15). Le plafond existe toujours, il a
    // changé de main : un cran de retard vaut `BRAISE.DEFICIT_DEGRES`, et c'est le manque que la
    // thermogenèse paie — quel que soit le froid réel dehors (ici le glacier, bien plus bas).
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(12, 1) })
    flatMap(state, 15 /* glacier */)
    const e = spawn(state, 5, 5)
    // Le corps garde la braise de sa naissance : pleine de 2 crans, elle n'en COUVRE qu'un dès le
    // premier tick de froid (`floor`, B-R7b). Le glacier de midi en demande 2 → il manque
    // EXACTEMENT un cran, tout le temps que dure la mesure.
    expect(cransExiges(state, e.x, e.y), 'la prémisse : le glacier demande 2 crans à midi').toBe(2)
    expect(e.braise!.charge, 'et la braise est bien celle de la naissance').toBe(chargePleine(0))
    expect(penteObservee(state, e, 200)).toBeCloseTo(penteParTick(BRAISE.DEFICIT_DEGRES), 6)
  })

  it('au-dessus de l’air doux, AUCUN surcoût — l’Ardeur vit au tarif de base, au bit près', () => {
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(12, 1) })
    flatMap(state, 1 /* grass */)
    auJour(state, coeurDe(2))
    const e = spawn(state, 5, 5)
    expect(
      ambientTemperature(state, 5, 5),
      'la prémisse : cet air-là est doux',
    ).toBeGreaterThanOrEqual(T.AMBIANT_DOUX)
    expect(penteObservee(state, e, 200)).toBeCloseTo(penteParTick(0), 6)
  })
})

describe('FROID_PAR_ETAGE — monter refroidit (braise.md B-R4b, étape 1 du § 3)', () => {
  /**
   * UNE CARTE QUI PORTE DES PALIERS — en bandes horizontales de quatre lignes, un palier chacune.
   *
   * ⚠ C'EST LA GARDE DE LA GARDE : sans `map.palier`, `palierDuSol` rend 0 partout et **tout ce
   * bloc passerait au vert à vide** — le piège que braise.md § 3 étape 1 nomme lui-même. Et c'est
   * `map.palier` (le SOL) et non `entity.etage` : l'étage d'un corps est effacé au sol, un terme
   * qui s'y appuierait serait inerte.
   * `number[]` et non `Uint8Array` : `SimState` doit rester JSON-sérialisable.
   */
  function carteEnPaliers(state: SimState): void {
    flatMap(state, 9 /* scree, offset biome 0 — on isole l'altitude */)
    const { width, height } = state.map
    const palier: number[] = new Array(width * height)
    for (let ty = 0; ty < height; ty++) {
      const p = Math.min(TERRASSES.PALIERS - 1, ty >> 2)
      for (let tx = 0; tx < width; tx++) palier[ty * width + tx] = p
    }
    state.map.palier = palier
  }

  /** Le milieu de la bande du palier `p` — MIDI, biome neutre, sans météo. */
  const yDe = (p: number): number => p * 4 + 1.5

  const mondeAuJour = (jour: number): SimState => {
    const state = createSim(1, { calendarScale: 1, cycleOffset: cycleOffsetForStartHour(12, 1), meteoActive: false })
    carteEnPaliers(state)
    auJour(state, jour)
    return state
  }

  it('la prémisse : la carte de montage porte bien quatre paliers distincts', () => {
    // Un contrôle POSITIF avant les lois : si cette garde tombe, les suivantes ne prouvent rien.
    const state = mondeAuJour(coeurDe(2))
    const vus = new Set<number>()
    for (let p = 0; p < TERRASSES.PALIERS; p++) vus.add(palierDuSol(state.map, 5, Math.floor(yDe(p))))
    expect([...vus].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
  })

  it('UN PALIER DE PLUS = FROID_PAR_ETAGE DE MOINS, exactement — à tous les paliers, aux quatre saisons', () => {
    const fautes: string[] = []
    for (const phase of [1, 2, 3, 4]) {
      const state = mondeAuJour(coeurDe(phase))
      for (let p = 0; p + 1 < TERRASSES.PALIERS; p++) {
        // L'air NON borné : `clampTemp` écrase le saut dès le palier 1 (voir la garde du clamp).
        const ici = airNonBorneAt(state, 5.5, yDe(p), state.tick)
        const dessus = airNonBorneAt(state, 5.5, yDe(p + 1), state.tick)
        const saut = ici - dessus
        if (saut !== TEMPERATURE.FROID_PAR_ETAGE) fautes.push(`saison ${phase}, p${p}→p${p + 1} : saut de ${saut} (${TEMPERATURE.FROID_PAR_ETAGE} attendu) — ${ici} puis ${dessus}`)
      }
    }
    expect(fautes, fautes.join('\n')).toHaveLength(0)
  })

  it("L'ALTITUDE NE S'ABRITE PAS : sous un toit, le saut vaut encore FROID_PAR_ETAGE ENTIER", () => {
    // Décision d'Alexis, 2026-09-30 : « Non — l'altitude ne s'abrite pas. » Le terme vit dans le
    // groupe du SOCLE, HORS du facteur d'abri — sinon un toit diviserait la montagne par deux et
    // B-R7 tomberait (c'est la braise, pas un toit, qui est la porte de l'altitude).
    // ⚠ CETTE GARDE EST LA SEULE QUI TIENNE CETTE DÉCISION : déplacer le terme à l'intérieur du
    // facteur d'abri rendrait `SHELTER_FACTOR × FROID_PAR_ETAGE` et la ferait rougir. VÉRIFIÉ par
    // mutation le 2026-09-30 (terme déplacé dans le groupe de l'exposition : saut de 14, ✗).
    const state = mondeAuJour(coeurDe(4))
    for (let p = 0; p + 1 < TERRASSES.PALIERS; p++) {
      state.structures.length = 0
      // Le même toit sur les deux tuiles : l'exposition s'annule, seul le socle reste.
      state.structures.push({ type: 'house', tx: 5, ty: Math.floor(yDe(p)) } as never)
      state.structures.push({ type: 'house', tx: 5, ty: Math.floor(yDe(p + 1)) } as never)
      const ici = airNonBorneAt(state, 5.5, yDe(p), state.tick)
      const dessus = airNonBorneAt(state, 5.5, yDe(p + 1), state.tick)
      // ⚠ `isSheltered` prend des coordonnées de TUILE (`s.tx === tx`), pas des coordonnées
      // monde — la lire en 5,5 rendrait `false` en silence et l'égalité passerait au vert à vide.
      expect(isSheltered(state, 5, Math.floor(yDe(p))), `abri au palier ${p}`).toBe(true)
      expect(isSheltered(state, 5, Math.floor(yDe(p + 1))), `abri au palier ${p + 1}`).toBe(true)
      expect(ici - dessus, `sous abri, p${p}→p${p + 1} : ${ici} puis ${dessus}`).toBe(TEMPERATURE.FROID_PAR_ETAGE)
    }
  })

  it("UN ÉTAGE = UNE SAISON : l'amplitude de l'année EST le pas d'un palier (B-R4b)", () => {
    // La loi d'Alexis — « un hiver correspond à un été de l'étage supérieur » — n'est vraie que
    // si le pas d'altitude égale l'amplitude du `SOCLE`. Ce n'est pas un hasard heureux : c'est
    // une ÉGALITÉ, et si la courbe `SOCLE` change d'amplitude, `FROID_PAR_ETAGE` doit suivre.
    const ardeur = socleDuJour(coeurDe(2), 0)
    const grandFroid = socleDuJour(coeurDe(4), 0)
    expect(ardeur - grandFroid, `SOCLE : Ardeur ${ardeur} → Grand Froid ${grandFroid}`).toBe(TEMPERATURE.FROID_PAR_ETAGE)
    // Et la conséquence, lue sur l'air : l'hiver du palier k vaut l'été du palier k+1.
    const hiver = mondeAuJour(coeurDe(4))
    const ete = mondeAuJour(coeurDe(2))
    for (let p = 0; p + 1 < TERRASSES.PALIERS; p++) {
      expect(airNonBorneAt(hiver, 5.5, yDe(p), hiver.tick), `hiver p${p} vs été p${p + 1}`)
        .toBe(airNonBorneAt(ete, 5.5, yDe(p + 1), ete.tick))
    }
  })

  it("LE CLAMP TIENT L'ANCRE DU CORPS : la lecture BORNÉE ne descend jamais sous AMBIANT_MIN", () => {
    // `AMBIANT_MIN` = −18 est l'ancre du modèle du corps (« air à AMBIANT_MIN ⇒ corps à
    // CORPS_MORTEL »). Le froid d'étage vit HORS du clamp pour la demande en crans (B-R4), mais
    // la lecture bornée — celle que lit tout le reste du jeu — reste inchangée : c'est ce qui
    // permet à `cibleCorporelle`, `PENTE_CORPS` et `CORPS_MORTEL` de ne pas bouger d'un cheveu.
    const state = mondeAuJour(coeurDe(4))
    for (let p = 0; p < TERRASSES.PALIERS; p++) {
      const borne = baselineTemperatureAt(state, 5.5, yDe(p), state.tick)
      expect(borne, `borné au palier ${p}`).toBeGreaterThanOrEqual(TEMPERATURE.AMBIANT_MIN)
    }
    // ET LA CONTREPARTIE, QUI EST LE MOTIF DE L'ÉTAPE 3 : au sommet, le borné SATURE — il ne
    // sait plus dire de combien on est trop haut. Seul le non borné le sait.
    const haut = TERRASSES.PALIERS - 1
    expect(baselineTemperatureAt(state, 5.5, yDe(haut), state.tick)).toBe(TEMPERATURE.AMBIANT_MIN)
    expect(airNonBorneAt(state, 5.5, yDe(haut), state.tick)).toBeLessThan(TEMPERATURE.AMBIANT_MIN)
  })
})
