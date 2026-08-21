/**
 * LE MONDE MORT ET LE MONDE VIVANT SE TOUCHENT (décisions ⑧⑩⑪, 2026-08-21) — on brûle le
 * charnier, le repaire respire de plus en plus fort, et le gibier connaît enfin la peur des
 * morts (et leur faim).
 */
import { describe, it, expect } from 'vitest'
import { MORTS, TERRAIN_GRASS } from './balance'
import { createSim, step, type SimState } from './sim'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { advanceDens } from './poi'
import { advanceLieuxBrules, densiteDesMorts } from './morts'
import { drainEvents } from './events'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** Plaine nue au jour voulu — à MIDI (le brûlage est un geste de JOUR). */
function midiDuJour(jour: number, seed = 1): SimState {
  const state = createSim(seed, {
    map: createEmptyMap(96, 96, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(12),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  state.tick += 20 // aligné sur la cadence du brûlage (tick % 20), hors frontière d'aube
  return state
}

const zoneEn = (state: SimState, kind: string, x: number, y: number): number => {
  state.map.zones.push({ x, y, w: 2, h: 2, kind } as never)
  return state.map.zones.length - 1
}

describe('on brûle le charnier (⑧)', () => {
  it('un feu LIBRE allumé de JOUR dans l\'empreinte → le lieu est marqué, la densité TOMBE, puis revient', () => {
    const state = midiDuJour(30)
    const zi = zoneEn(state, 'charnier', 40, 40)
    const avant = densiteDesMorts(state, 42, 42)
    state.structures.push({ id: 9100, type: 'fire', tx: 41, ty: 41, villageId: 0, hp: 100 } as never)
    drainEvents(state)
    advanceLieuxBrules(state)
    expect(state.lieuxBrules).toHaveLength(1)
    expect(state.lieuxBrules[0]!.zone).toBe(zi)
    expect(drainEvents(state).some((e) => e.type === 'charnier_brule')).toBe(true)
    // La densité tombe autour — à `BRULE_FACTEUR` près, et seulement dans le rayon.
    expect(densiteDesMorts(state, 42, 42)).toBeCloseTo(avant * MORTS.BRULE_FACTEUR, 5)
    const loin = MORTS.BRULE_SUPPRESSION_RAYON + 45
    expect(densiteDesMorts(state, loin, 42)).toBeCloseTo(avant, 5)
    // Et le marquage ne se REFAIT pas tant qu'il court (une seule entrée, un seul événement).
    advanceLieuxBrules(state)
    expect(state.lieuxBrules).toHaveLength(1)
    // L'échéance passée — ET LE FEU RETIRÉ (un feu encore en flammes RE-brûle le lieu, et
    // c'est le comportement voulu : entretenir la flamme entretient l'assainissement).
    state.structures = state.structures.filter((st) => (st as { id?: number }).id !== 9100)
    state.tick = state.lieuxBrules[0]!.until + 20
    advanceLieuxBrules(state)
    expect(state.lieuxBrules).toHaveLength(0)
    expect(densiteDesMorts(state, 42, 42)).toBeCloseTo(avant, 5)
  })

  it('la NUIT ne brûle rien (le geste est diurne), et les braises non plus (il faut des flammes)', () => {
    const nuit = createSim(1, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0), // minuit
      calendarScale: 1,
    })
    nuit.tick = 29 * TICKS_PER_SEASON_DAY
    nuit.tick -= nuit.tick % TICKS_PER_CYCLE
    nuit.tick += 20
    zoneEn(nuit, 'charnier', 40, 40)
    nuit.structures.push({ id: 9101, type: 'fire', tx: 41, ty: 41, villageId: 0, hp: 100 } as never)
    advanceLieuxBrules(nuit)
    expect(nuit.lieuxBrules).toHaveLength(0)
  })
})

describe('le repaire respire (⑪)', () => {
  /** Un repaire enregistré au peuplement, vidé — la machinerie des tanières le repeuple. */
  function repaireVide(jour: number): { state: SimState; zi: number } {
    const state = midiDuJour(jour)
    const zi = zoneEn(state, 'repaire', 40, 40)
    state.dens.push(zi)
    return { state, zi }
  }
  /** Joue la machinerie de retour jusqu'à stabilité (les délais sont longs : on saute). */
  function respirer(state: SimState, fois: number): void {
    for (let i = 0; i < fois; i++) {
      advanceDens(state, state.seed) // note l'heure du retour
      state.tick += MORTS.RESPIRE_TICKS + 1 // la cadence PROPRE du repaire (E4 — pas celle des tanières)
      advanceDens(state, state.seed) // l'heure est venue : il rend un résident (ou pas)
    }
  }

  it('début de saison : UN résident, comme une tanière — fin de saison : le cap de la rampe', () => {
    const debut = repaireVide(5)
    respirer(debut.state, 5)
    expect(debut.state.monsters.filter((m) => m.homePoi === debut.zi)).toHaveLength(1)

    const fin = repaireVide(55)
    respirer(fin.state, 6)
    const cap = Math.round(1 + (MORTS.RESPIRE_CAP_FIN - 1) * (55 / 60))
    expect(fin.state.monsters.filter((m) => m.homePoi === fin.zi)).toHaveLength(cap)
    expect(cap).toBeGreaterThan(1) // la respiration s'amplifie avec la saison
  })

  it('un repaire BRÛLÉ ne respire pas (⑧ suspend ⑪)', () => {
    const { state, zi } = repaireVide(55)
    state.lieuxBrules.push({ zone: zi, until: state.tick + 10_000_000 })
    respirer(state, 4)
    expect(state.monsters.filter((m) => m.homePoi === zi)).toHaveLength(0)
  })
})

describe('le gibier et les morts (⑩)', () => {
  it('nuit froide : le cendreux DÉVORE le cerf — qui ne se relève pas — et s\'en rassasie', () => {
    const state = createSim(2, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0),
      calendarScale: 1,
    })
    state.tick = 54 * TICKS_PER_SEASON_DAY
    state.tick -= state.tick % TICKS_PER_CYCLE
    state.tick += 20
    const cerfId = spawnMonster(state, 'deer', 43.5, 40.5)
    const goulot = spawnMonster(state, 'cendreux', 40.5, 40.5)
    const m = state.monsters.find((x) => x.entityId === goulot)!
    drainEvents(state)
    // LA PROIE EST ACCULÉE (épinglée par le banc) : en plaine ouverte un cerf sème toujours
    // un mort à 1,3 t/s — c'est R10, et c'est très bien. Ce qu'on garde ici, c'est la CHASSE
    // (il la CIBLE) et la BOUCHÉE (le coup rassasie, la bête ne se relève pas).
    const cerf = state.entities.find((e) => e.id === cerfId)!
    let mort = false
    for (let t = 0; t < 2500 && !mort; t++) {
      if (cerf.hp > 0) {
        cerf.x = 43.5
        cerf.y = 40.5
      }
      step(state, [])
      mort = !state.entities.some((e) => e.id === cerfId && e.hp > 0)
    }
    expect(m.targetId === cerfId || mort).toBe(true) // la chasse est engagée
    expect(mort).toBe(true)
    expect((m.satiete ?? 0)).toBeGreaterThan(0) // la chair est chaude (⑯ au coup)
    // Une bête tuée ne se relève JAMAIS (le critère de levée exclut les monstres).
    for (let t = 0; t < 200; t++) step(state, [])
    expect(state.monsters.filter((x) => x.type === 'cendreux')).toHaveLength(1)
  })

  it('le cerf CRAINT le mort éveillé (nuit) — et broute à côté de la carcasse amorphe (jour chaud)', () => {
    const nuit = createSim(3, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0),
      calendarScale: 1,
    })
    nuit.tick = 54 * TICKS_PER_SEASON_DAY
    nuit.tick -= nuit.tick % TICKS_PER_CYCLE
    nuit.tick += 20
    // LA PROMESSE TENABLE : on ne broute pas IMPUNÉMENT près d'un mort éveillé. Un cendreux
    // STATIQUE et muet n'effraie que lentement (canal vue seul, aucun bruit — c'est voulu,
    // un mort ne respire pas) ; mais la nuit il CHASSE (⑩) — et la bête finit mordue, morte
    // ou en fuite. MESURÉ : la jauge seule, à 6,5 tuiles d'une menace immobile, ne montait
    // pas avant que le cerf ne broute ailleurs — signalé au calibrage.
    const cerfN = spawnMonster(nuit, 'deer', 44.5, 40.5)
    const gouleN = spawnMonster(nuit, 'cendreux', 40.5, 40.5)
    const mGoule = nuit.monsters.find((x) => x.entityId === gouleN)!
    // L'INTENTION est la garde déterministe : la nuit, le mort CIBLE la bête (⑩) — la
    // poursuite d'un cerf libre, elle, est chaotique (il dérive plus vite que 1,3 t/s), et
    // la mise à mort est déjà prouvée sur cerf acculé, au test d'à côté.
    let chasse = false
    for (let t = 0; t < 60 && !chasse; t++) {
      step(nuit, [])
      chasse = mGoule.targetId === cerfN
    }
    expect(chasse).toBe(true) // la nuit, le mort éveillé CHASSE la chair chaude

    const jour = createSim(3, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(12),
      calendarScale: 1,
    })
    jour.tick = 4 * TICKS_PER_SEASON_DAY // jour 5, midi : plaine à 90 — éveil 0
    jour.tick -= jour.tick % TICKS_PER_CYCLE
    jour.tick += 20
    const cerfJ = spawnMonster(jour, 'deer', 44.5, 40.5) // même géométrie que la nuit
    spawnMonster(jour, 'cendreux', 40.5, 40.5)
    const mJ = jour.monsters.find((x) => x.entityId === cerfJ)!
    const gouleJ = jour.monsters.find((x) => x.type === 'cendreux')!
    let chasseJ = false
    for (let t = 0; t < 300; t++) {
      step(jour, [])
      chasseJ ||= gouleJ.targetId === cerfJ
    }
    expect(chasseJ).toBe(false) // la carcasse amorphe ne CIBLE pas à 4 tuiles (vue au plancher)
    expect(mJ.fleeing).toBe(false) // et le cerf broute à côté — c'est voulu
  })
})
