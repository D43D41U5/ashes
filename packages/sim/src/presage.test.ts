/**
 * LA HORDE DU CADRAN (décisions ⑫⑬⑭⑮⑱⑲, 2026-08-21) — elle se décide à l'AUBE (le préavis
 * de la veille), naît du sol le plus mort, vise le feu le plus PROCHE (village ou simple camp),
 * et l'aube suivante ne l'efface plus : elle la FIGE.
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, TERRAIN_GRASS, WORLD_EVENTS } from './balance'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { spawnHorde } from './worldevents'
import { drainEvents, type SimEvent } from './events'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { foundNpcVillage } from './worldgen'

/**
 * LES DEUX JOURS-REPÈRES (spec `saisons.md` S1-S4) — dérivés de la cadence des saisons.
 *
 * Ce fichier visait « l'acte II » (jour 40) pour la loterie du présage et « l'acte III »
 * (jour 55) pour la nuit d'assaut. L'arc à sens unique n'existe plus : la pression suit le
 * TOUR (S13, S15), creuse au cœur de l'Ardeur et pleine au cœur du Grand Froid. La montée
 * — là où la chance de horde est franche sans être acquise — est au cœur des Pluies ; la
 * nuit d'assaut est le cœur de l'hiver.
 */
const MI_PLUIES = Math.round(BALANCE.ACT_DAYS * 2.5)
const MI_GRAND_FROID = Math.round(BALANCE.ACT_DAYS * 3.5)

/** Un état posé JUSTE AVANT une aube du jour ~voulu (l'aube au sens de worldevents :
 *  (tick + cycleOffset) % TICKS_PER_CYCLE === 0). */
function veilleDAube(jour: number, seed = 1, largeur = 128): SimState {
  const state = createSim(seed, {
    map: createEmptyMap(largeur, 96, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(0, 1),
    calendarScale: 1,
  })
  let tick = (jour - 1) * TICKS_PER_SEASON_DAY
  tick -= (tick + state.cycleOffset) % TICKS_PER_CYCLE
  state.tick = tick - 2 // deux ticks avant l'aube exacte
  return state
}

const feuEn = (state: SimState, tx: number, ty: number): void => {
  state.structures.push({ id: 8000 + tx, type: 'fire', tx, ty, villageId: 0, hp: 100 } as never)
}

describe('la cible est le feu le plus proche (⑬)', () => {
  it('SANS AUCUN VILLAGE, un feu de camp suffit : la horde naît, le vise, et marche', () => {
    const state = veilleDAube(MI_GRAND_FROID)
    state.tick += 10 // à distance de l'aube : la poser PILE dessus la gèlerait au premier pas
    feuEn(state, 64, 48)
    const h = spawnHorde(state, 6)
    expect(h).not.toBeNull()
    expect(h!.fireTx).toBe(64)
    expect(h!.fireTy).toBe(48)
    expect(h!.villageId).toBeUndefined()
    expect(state.villages).toHaveLength(0) // « pas de village = jamais assiégé » est mort
    // Et elle MARCHE : la distance moyenne au feu décroît.
    const dist = (): number => {
      let somme = 0
      let n = 0
      for (const id of h!.memberEntityIds) {
        const e = state.entities.find((en) => en.id === id)
        if (!e || e.hp <= 0) continue
        somme += Math.sqrt((e.x - 64.5) * (e.x - 64.5) + (e.y - 48.5) * (e.y - 48.5))
        n += 1
      }
      return somme / n
    }
    const d0 = dist()
    for (let t = 0; t < 400; t++) step(state, [])
    expect(dist()).toBeLessThan(d0 - 3)
  })
})

describe('le présage de la veille (⑱) et son exécution', () => {
  /** Joue jusqu'à trouver une aube qui présage (la chance est une rampe, pas une garantie). */
  function chercherPresage(seed: number): { state: SimState; presage: SimEvent & { type: 'presage_horde' } } | null {
    const state = veilleDAube(MI_PLUIES, seed)
    foundNpcVillage(state, 64, 48, 0)
    drainEvents(state)
    for (let aube = 0; aube < 8; aube++) {
      for (let t = 0; t < 8 && state.presage === null; t++) step(state, [])
      const ev = drainEvents(state).find((e) => e.type === 'presage_horde')
      if (ev && state.presage) return { state, presage: ev as SimEvent & { type: 'presage_horde' } }
      // pas de chance à cette aube : avancer d'un cycle entier, jusqu'à 2 ticks avant la suivante
      const prochain = state.tick + TICKS_PER_CYCLE - ((state.tick + state.cycleOffset) % TICKS_PER_CYCLE) - 2
      while (state.tick < prochain) state.tick += 1
    }
    return null
  }

  it('l\'aube décide, le crépuscule exécute — et le présage porte l\'origine un jour à l\'avance', () => {
    const trouve = chercherPresage(3)
    expect(trouve).not.toBeNull()
    const { state, presage } = trouve!
    expect(state.presage!.at).toBeGreaterThan(state.tick) // la nuit est DEVANT
    expect(presage.x).toBe(state.presage!.x)
    // On avance jusqu'au crépuscule : la horde se lève, le présage est consommé.
    drainEvents(state)
    const cible = state.presage!.at
    state.tick = cible - 2
    for (let t = 0; t < 6; t++) step(state, [])
    const spawned = drainEvents(state).filter((e) => e.type === 'horde_spawned')
    expect(spawned).toHaveLength(1)
    expect(state.presage).toBeNull()
    expect(state.hordes).toHaveLength(1)
  })

  it('la faune DÉSERTE l\'origine au moment du présage (le signe qui se lit sans bandeau)', () => {
    // Une GRILLE de cerfs couvre la carte : où que l'origine tombe, il y en a près d'elle.
    const state = veilleDAube(MI_PLUIES, 3)
    foundNpcVillage(state, 64, 48, 0)
    for (let gy = 8; gy < 96; gy += 16) for (let gx = 8; gx < 128; gx += 16) spawnMonster(state, 'deer', gx + 0.5, gy + 0.5)
    drainEvents(state)
    let presage: (SimEvent & { type: 'presage_horde' }) | undefined
    for (let aube = 0; aube < 8 && !presage; aube++) {
      for (let t = 0; t < 8 && !presage; t++) {
        step(state, [])
        presage = drainEvents(state).find((e) => e.type === 'presage_horde') as typeof presage
      }
      if (presage) break
      const prochain = state.tick + TICKS_PER_CYCLE - ((state.tick + state.cycleOffset) % TICKS_PER_CYCLE) - 2
      while (state.tick < prochain) state.tick += 1
    }
    expect(presage).toBeDefined()
    // GARDE GÉOMÉTRIQUE : toute bête de gibier à portée de l'origine fuit, ET fuit DEPUIS elle.
    const r2 = WORLD_EVENTS.PRESAGE_FUITE_RAYON * WORLD_EVENTS.PRESAGE_FUITE_RAYON
    let touchees = 0
    for (const m of state.monsters) {
      if (m.type !== 'deer') continue
      const e = state.entities.find((en) => en.id === m.entityId)
      if (!e || e.hp <= 0) continue
      const d2 = (e.x - (presage!.x + 0.5)) * (e.x - (presage!.x + 0.5)) + (e.y - (presage!.y + 0.5)) * (e.y - (presage!.y + 0.5))
      if (d2 > r2 * 0.64) continue // marge : les bêtes ont pu marcher entre l'émission et l'assertion
      touchees += 1
      expect(m.fleeing, `le cerf en (${e.x.toFixed(0)},${e.y.toFixed(0)}) devrait fuir l'origine`).toBe(true)
    }
    expect(touchees).toBeGreaterThan(0) // la grille garantit qu'on a bien regardé quelque chose
  })
})

describe('l\'aube FIGE, elle n\'efface plus (⑮)', () => {
  it('les membres survivants deviennent des RELIQUES — rien ne s\'évapore sous les yeux', () => {
    const state = veilleDAube(MI_GRAND_FROID, 7)
    feuEn(state, 64, 48)
    state.tick += 10 // passé l'aube : on pose la horde en journée, pour la nuit à venir
    const h = spawnHorde(state, 5)
    expect(h).not.toBeNull()
    const ids = [...h!.memberEntityIds]
    // Un AVATAR RÉEL regarde la scène — À PORTÉE DE CLEARANCE des goules (les PNJ, eux, ne
    // comptent plus comme témoins — C6).
    const goule0 = state.entities.find((e) => e.id === ids[0])!
    const spectateurId = spawnEntity(state, goule0.x + 1.5, goule0.y)
    // On avance jusqu'à l'aube suivante.
    const aube = state.tick + TICKS_PER_CYCLE - ((state.tick + state.cycleOffset) % TICKS_PER_CYCLE)
    state.tick = aube - 2
    drainEvents(state)
    for (let t = 0; t < 5; t++) step(state, [])
    expect(drainEvents(state).some((e) => e.type === 'horde_dispersed')).toBe(true)
    expect(state.hordes).toHaveLength(0)
    // FIGÉS, PAS EFFACÉS : les corps survivants sont là, marqués reliques, sous les yeux.
    const survivants = ids.filter((id) => state.entities.some((e) => e.id === id && e.hp > 0))
    expect(survivants.length).toBeGreaterThan(0)
    for (const id of survivants) {
      const m = state.monsters.find((x) => x.entityId === id)!
      expect(m.hordeRelic).toBe(true)
      expect(m.expiresAt).toBeDefined()
    }
    // L'avatar s'en va — à l'OPPOSÉ des goules, hors de toute clearance : le balayage
    // les reprend, hors regard.
    const spectateur = state.entities.find((e) => e.id === spectateurId)!
    spectateur.x = goule0.x > 64 ? 2.5 : 125.5
    spectateur.y = goule0.y > 48 ? 2.5 : 93.5
    for (let t = 0; t < 3; t++) step(state, [])
    expect(ids.filter((id) => state.monsters.some((m) => m.entityId === id))).toHaveLength(0)
  })

  it('l\'avatar qui RESTE garde les reliques au monde — le décor n\'avoue jamais', () => {
    const state = veilleDAube(MI_GRAND_FROID, 7)
    feuEn(state, 64, 48)
    state.tick += 10
    const h = spawnHorde(state, 5)!
    const ids = [...h.memberEntityIds]
    const g0 = state.entities.find((e) => e.id === ids[0])!
    spawnEntity(state, g0.x + 1.5, g0.y) // il reste planté là, à portée de clearance
    const aube = state.tick + TICKS_PER_CYCLE - ((state.tick + state.cycleOffset) % TICKS_PER_CYCLE)
    state.tick = aube - 2
    for (let t = 0; t < 8; t++) step(state, [])
    // Les survivants d'avant l'aube sont TOUJOURS là (les morts au combat, eux, sont morts).
    const encoreLa = ids.filter((id) => state.monsters.some((m) => m.entityId === id))
    const vivantsAvantAube = ids.filter((id) => state.entities.some((e) => e.id === id))
    expect(encoreLa.length).toBe(vivantsAvantAube.length)
  })
})

describe('debug_horde (le smoke a besoin d\'une horde SANS loterie)', () => {
  it('plante une vraie horde, tout de suite, par la vraie chaîne', () => {
    const state = veilleDAube(MI_PLUIES, 5)
    state.tick += 10
    state.debug = true
    feuEn(state, 64, 48)
    const player = spawnEntity(state, 60.5, 48.5)
    drainEvents(state)
    step(state, [{ entityId: player, dx: 0, dy: 0, action: { type: 'debug_horde' } }])
    expect(state.hordes.length).toBe(1)
    expect(drainEvents(state).some((e) => e.type === 'horde_spawned')).toBe(true)
  })

  it('inerte hors debug', () => {
    const state = veilleDAube(MI_PLUIES, 5)
    state.tick += 10
    feuEn(state, 64, 48)
    const player = spawnEntity(state, 60.5, 48.5)
    step(state, [{ entityId: player, dx: 0, dy: 0, action: { type: 'debug_horde' } }])
    expect(state.hordes).toHaveLength(0)
  })
})
