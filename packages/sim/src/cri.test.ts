/**
 * LE CRI DE FUREUR ET LE PLAFOND GLOBAL (décisions d'Alexis ④⑤⑥ + hypothèse ⑳, 2026-08-21 ;
 * ré-ancré sur l'année qui tourne le 2026-08-23, `docs/specs/saisons.md` S4-S5 et S15).
 *
 * Sous le froid extrême, un cendreux qui voit une proie appelle — et l'appel réveille LE SOL.
 * La borne est double : le plafond du cri suit le froid de l'année, et tout passe sous le
 * plafond GLOBAL — qui compte ce qu'il borne (jamais le sédiment déjà borné ailleurs).
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, CENDREUX, TERRAIN_GRASS } from './balance'
import { createSim, spawnEntity, type SimState } from './sim'
import { createEmptyMap } from './map'
import { cendreuxSousPression, plafondGlobal, placeSousPlafondGlobal, spawnMonster } from './monsters'
import { cendreuxStep, willRiseAsCendreux } from './cendreux'
import { advanceReveils } from './morts'
import { drainEvents } from './events'
import { cycleOffsetForStartHour, seasonRamp, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/**
 * LE CŒUR D'UNE SAISON, en jour de l'année — dérivé d'`ACT_DAYS`, jamais écrit : 15, 45, 75,
 * 105. La fureur est un cran de FROID : elle se cherche au cœur du Grand Froid (la plaine y
 * tombe à −16 °C la nuit, sous `TORPEUR.FUREUR`) et jamais au cœur de l'Ardeur (+20).
 */
const coeurDeSaison = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
const ECLOSION = coeurDeSaison(1)
const ARDEUR = coeurDeSaison(2)
const PLUIES = coeurDeSaison(3)
const GRAND_FROID = coeurDeSaison(4)

function nuitDuJour(jour: number): SimState {
  const state = createSim(1, {
    map: createEmptyMap(96, 64, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(0),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  state.tick += 1
  return state
}

/** Fait penser et agir UN cendreux, tick par tick, sans le reste du monde. */
function stepCendreux(state: SimState, id: number, ticks: number): void {
  const m = state.monsters.find((x) => x.entityId === id)!
  const e = state.entities.find((x) => x.id === id)!
  for (let t = 0; t < ticks; t++) {
    state.tick += 1
    cendreuxStep(state, m, e)
  }
}

describe('un crieur par proie à la fois (décision sur mesure, 2026-08-21)', () => {
  it('deux cendreux voient la même proie : UN seul cri — le second attend la fin du cooldown du premier', () => {
    const state = nuitDuJour(GRAND_FROID)
    const proie = spawnEntity(state, 51.5, 33.5)
    const a = spawnMonster(state, 'cendreux', 47.5, 32.5) // tous deux du même côté, à ~4 tuiles
    const b = spawnMonster(state, 'cendreux', 47.5, 34.5)
    drainEvents(state)
    // La proie se dérobe devant les deux (kite de banc, mémoire « une phase seule n'est pas un
    // tick » : atteinte, ils armeraient un coup que le harnais ne résout jamais) : vue, jamais prise.
    const tenir = (ticks: number) => {
      for (let t = 0; t < ticks; t++) {
        state.tick += 1
        for (const id of [a, b]) {
          const m = state.monsters.find((x) => x.entityId === id)!
          const e = state.entities.find((x) => x.id === id)!
          cendreuxStep(state, m, e)
        }
        const ea = state.entities.find((x) => x.id === a)!
        const eb = state.entities.find((x) => x.id === b)!
        const p = state.entities.find((x) => x.id === proie)!
        p.x = Math.max(ea.x, eb.x) + 4
        p.y = 33.5
      }
    }
    tenir(40)
    const cris1 = drainEvents(state).filter((e) => e.type === 'cendreux_cri')
    expect(cris1).toHaveLength(1) // b a vu la proie autant qu'a, et s'est tu : a la TIENT
    expect(state.monsters.find((m) => m.entityId === a)!.criPreyId ?? state.monsters.find((m) => m.entityId === b)!.criPreyId).toBe(proie)
    // Le cooldown du crieur expire : l'autre peut appeler à son tour.
    tenir(CENDREUX.CRI.COOLDOWN + 20)
    const cris2 = drainEvents(state).filter((e) => e.type === 'cendreux_cri')
    expect(cris2.length).toBeGreaterThanOrEqual(1)
  })
})

describe('le cri de fureur (④⑤)', () => {
  it('nuit du Grand Froid (T = −16 °C ≤ FUREUR), une proie en vue : il crie, et le SOL se lève en salve', () => {
    const state = nuitDuJour(GRAND_FROID)
    spawnEntity(state, 50.5, 32.5) // la proie
    const id = spawnMonster(state, 'cendreux', 47.5, 32.5) // à 3 tuiles : vue pleine la nuit
    drainEvents(state)
    const rng = state.rngState
    stepCendreux(state, id, 1)
    const cris = drainEvents(state).filter((e) => e.type === 'cendreux_cri')
    expect(cris).toHaveLength(1)
    expect(cris[0]).toMatchObject({ x: 50.5, y: 32.5 })
    // La salve plante UN site par tick de décision — au fil des pensées, pas d'un coup.
    const k = Math.round(seasonRamp(0, CENDREUX.CRI.PLAFOND_FIN, GRAND_FROID))
    expect(k).toBeGreaterThanOrEqual(2) // 6 → 2 le 2026-08-21 (mesure) : deux réveils par cri au cœur de l'hiver
    // LA PROIE SE DÉROBE (kite de banc) : sans quoi il l'atteint, arme son coup, et le
    // harnais — qui n'appelle pas advanceCombat — le laisse en wind-up éternel, salve gelée
    // (mémoire « une phase seule n'est pas un tick »). Elle reste à 4 tuiles : vue, jamais prise.
    const m = state.monsters.find((x) => x.entityId === id)!
    const ent = state.entities.find((x) => x.id === id)!
    const proie = state.entities[0]!
    for (let t = 0; t < 80; t++) {
      state.tick += 1
      proie.x = ent.x + 4
      proie.y = ent.y
      cendreuxStep(state, m, ent)
    }
    expect(state.reveils.length).toBeGreaterThanOrEqual(k - 1)
    expect(state.reveils.length).toBeLessThanOrEqual(k)
    // Chaque réveil est pour ELLE, et il est planté PRÈS du lieu vu (couronne UNDEAD).
    for (const r of state.reveils) {
      expect(r.preyId).toBe(state.entities[0]!.id)
      const dx = r.x - 50.5
      const dy = r.y - 32.5
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(11)
    }
    // ET AUCUN PAS DE PRNG : crier ne déplace pas le flux seedé du monde (patron A28).
    expect(state.rngState).toEqual(rng)
  })

  it('le cooldown tient : pas deux cris dans la même demi-minute', () => {
    const state = nuitDuJour(GRAND_FROID)
    spawnEntity(state, 50.5, 32.5)
    const id = spawnMonster(state, 'cendreux', 47.5, 32.5)
    drainEvents(state)
    stepCendreux(state, id, 120)
    expect(drainEvents(state).filter((e) => e.type === 'cendreux_cri')).toHaveLength(1)
  })

  it('la nuit TIÈDE ne crie jamais (la fureur est un cran de froid, pas un réflexe)', () => {
    const state = nuitDuJour(ARDEUR) // cœur de l'été : plaine de nuit à +20 °C, très au-dessus de FUREUR
    spawnEntity(state, 50.5, 32.5)
    const id = spawnMonster(state, 'cendreux', 49.5, 32.5) // à 1 tuile : même la vue plancher le voit
    drainEvents(state)
    stepCendreux(state, id, 120)
    expect(drainEvents(state).some((e) => e.type === 'cendreux_cri')).toBe(false)
  })

  it('le plafond du cri SUIT LE FROID : 0 au cœur de l\'Ardeur, PLAFOND_FIN au cœur du Grand Froid', () => {
    // La salve n'a plus de « début de saison » ni de « fin » : elle respire avec l'année
    // (S15). Ce qui reste vrai, et qui est le contrat, c'est qu'elle monte SANS REDESCENDRE de
    // l'été à l'hiver — le cri est le crescendo de la marche vers le Grand Froid.
    expect(Math.round(seasonRamp(0, CENDREUX.CRI.PLAFOND_FIN, ARDEUR))).toBe(0)
    expect(Math.round(seasonRamp(0, CENDREUX.CRI.PLAFOND_FIN, GRAND_FROID))).toBe(CENDREUX.CRI.PLAFOND_FIN)
    let prev = 0
    for (let jour = ARDEUR; jour <= GRAND_FROID; jour++) {
      const k = Math.round(seasonRamp(0, CENDREUX.CRI.PLAFOND_FIN, jour))
      expect(k).toBeGreaterThanOrEqual(prev)
      prev = k
    }
  })
})

describe('le plafond global (⑳ — hypothèse de travail)', () => {
  it('il respire avec l\'année : au plancher au cœur de l\'Ardeur, au plafond au cœur du Grand Froid', () => {
    // Il ne « monte plus avec le jour », et il ne se clampe plus après une fin de saison qui
    // n'existe pas : la vallée se remplit vers l'hiver et se vide vers l'été (S15). Les deux
    // bornes se lisent EXACTEMENT aux cardinaux de la courbe, pas à des jours choisis.
    expect(plafondGlobal(nuitDuJour(ARDEUR))).toBe(CENDREUX.GLOBAL.DEBUT)
    expect(plafondGlobal(nuitDuJour(GRAND_FROID))).toBe(CENDREUX.GLOBAL.FIN)
    // Les deux saisons de transition sont STRICTEMENT entre les deux, des deux côtés de l'été.
    for (const entredeux of [ECLOSION, PLUIES]) {
      expect(plafondGlobal(nuitDuJour(entredeux))).toBeGreaterThan(CENDREUX.GLOBAL.DEBUT)
      expect(plafondGlobal(nuitDuJour(entredeux))).toBeLessThan(CENDREUX.GLOBAL.FIN)
    }
  })

  it('PLEIN, la vallée ne relève plus personne — et abattre rouvre la porte', () => {
    const state = nuitDuJour(ECLOSION)
    const toit = plafondGlobal(state)
    for (let i = 0; i < toit; i++) spawnMonster(state, 'cendreux', 10.5 + (i % 8), 10.5 + Math.floor(i / 8))
    expect(placeSousPlafondGlobal(state)).toBe(false)
    const seul = spawnEntity(state, 80.5, 50.5) // loin de tout feu, seul
    const e = state.entities.find((x) => x.id === seul)!
    expect(willRiseAsCendreux(state, e)).toBe(false) // plein : pas de levée
    // Un réveil déjà planté MEURT au terme au lieu d'émerger (le mur dur, R8bis : pas de queue).
    state.reveils.push({ x: 80.5, y: 52.5, at: state.tick, preyId: seul })
    advanceReveils(state)
    expect(state.reveils).toHaveLength(0)
    expect(state.monsters.filter((m) => m.type === 'cendreux').length).toBe(toit) // rien n'est sorti
    // On en abat un : la porte se rouvre.
    const premier = state.monsters.find((m) => m.type === 'cendreux')!
    state.entities.find((x) => x.id === premier.entityId)!.hp = 0
    expect(placeSousPlafondGlobal(state)).toBe(true)
    expect(willRiseAsCendreux(state, e)).toBe(true)
  })

  it('IL COMPTE CE QU\'IL BORNE : ni les résidents de Repaire, ni les gardes de convoi — mais les reliques, oui', () => {
    const state = nuitDuJour(ECLOSION)
    const resident = spawnMonster(state, 'cendreux', 10.5, 10.5)
    state.monsters.find((m) => m.entityId === resident)!.homePoi = 3 // borné par le cap de son lieu
    const garde = spawnMonster(state, 'cendreux', 12.5, 10.5)
    state.monsters.find((m) => m.entityId === garde)!.expiresAt = state.tick + 99999 // borné par son balayage
    const relique = spawnMonster(state, 'cendreux', 14.5, 10.5)
    const mRelique = state.monsters.find((m) => m.entityId === relique)!
    mRelique.expiresAt = state.tick + 99999
    mRelique.hordeRelic = true // l'aube l'a figée : elle PÈSE encore sur le joueur
    const rodeur = spawnMonster(state, 'cendreux', 16.5, 10.5)
    void rodeur
    expect(cendreuxSousPression(state)).toBe(2) // la relique + le rôdeur ; pas le sédiment
  })
})
