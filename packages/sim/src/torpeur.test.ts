/**
 * LE CADRAN UNIQUE DU CENDREUX — la torpeur par la température (décisions d'Alexis
 * 2026-08-21, spec `docs/superpowers/specs/2026-08-21-cendreux-pression-croissante-design.md`).
 *
 * Ce que ce fichier épingle : l'éveil est une PENTE, ses ancres reproduisent l'ancienne
 * table d'actes sur la nuit de plaine (0 / 0,5 / 1), la géographie parle (la neige rend le
 * Névé dangereux dès l'acte I), l'allure d'un but ne tombe jamais à zéro (pas de statue),
 * et la rampe de saison est CLAMPÉE au jour 60 (la Cendre finale n'extrapole pas).
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, CENDREUX, MONSTER_DEFS, NIGHT_HUNT, TERRAIN_GRASS } from './balance'
import { createSim, type SimState } from './sim'
import { createEmptyMap } from './map'
import { spawnMonster, advanceMonsters } from './monsters'
import { eveilCendreuxAt } from './temperature'
import { cycleOffsetForStartHour, seasonRamp, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** Un état posé au jour de saison voulu, à MINUIT, sur plaine nue (patron du banc `nuits`). */
function nuitDuJour(jour: number, seed = 1): SimState {
  const state = createSim(seed, {
    map: createEmptyMap(64, 64, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(0),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  return state
}

describe('l\'éveil — la pente de température', () => {
  it('les ancres de la nuit de plaine REPRODUISENT l\'ancienne table d\'actes : 0, 0,5, 1', () => {
    // C'est le contrat central du cadran : CHAUD=60/FROID=10 ne sont pas des goûts, ce sont
    // les températures nocturnes de plaine des trois actes (90 − ACT_COLD − NIGHT_COLD).
    expect(eveilCendreuxAt(nuitDuJour(5), 32, 32, nuitDuJour(5).tick)).toBe(0)
    expect(eveilCendreuxAt(nuitDuJour(30), 32, 32, nuitDuJour(30).tick)).toBeCloseTo(0.5, 5)
    expect(eveilCendreuxAt(nuitDuJour(55), 32, 32, nuitDuJour(55).tick)).toBe(1)
  })

  it('l\'éveil de minuit ne DESCEND jamais au fil de la saison (la pression monte)', () => {
    // Garde exhaustive plutôt que cas choisis : on balaie toute la saison.
    let prev = -1
    for (let jour = 1; jour <= BALANCE.SEASON_DAYS; jour += 1) {
      const s = nuitDuJour(jour)
      const e = eveilCendreuxAt(s, 32, 32, s.tick)
      expect(e).toBeGreaterThanOrEqual(prev)
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeLessThanOrEqual(1)
      prev = e
    }
  })

  it('la géographie parle : la neige éveille dès le JOUR d\'acte I (le Névé est dangereux jour 1)', () => {
    const state = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), calendarScale: 1 })
    // tick 0 = jour, acte I : plaine à 90 → éveil 0. On pose de la neige (BIOME_OFFSET −40).
    state.map.terrain[32 * 64 + 40] = 10 // neige
    expect(eveilCendreuxAt(state, 32.5, 32.5, state.tick)).toBe(0) // l'herbe dort
    expect(eveilCendreuxAt(state, 40.5, 32.5, state.tick)).toBeGreaterThan(0) // la neige veille
  })

  it('de jour tiède, un cendreux avec un BUT avance quand même — lentement, jamais statue', () => {
    // GAIT_MIN : « presque amorphe » n'est pas « immobile en marche ». Nuit d'acte I (éveil
    // 0) contre nuit d'acte III (éveil 1) : les deux BOUGENT, la froide va plus vite.
    const marche = (jour: number): number => {
      const state = nuitDuJour(jour)
      state.structures.push({ type: 'fire', tx: 45, ty: 32, villageId: 0 } as never)
      const id = spawnMonster(state, 'cendreux', 30.5, 32.5)
      const ent = state.entities.find((e) => e.id === id)!
      const x0 = ent.x
      for (let t = 0; t < 200; t++) advanceMonsters(state)
      return ent.x - x0
    }
    const tiede = marche(5)
    const froide = marche(55)
    expect(tiede).toBeGreaterThan(0) // il marche (pas de statue d'acte I — constat du panel)
    expect(froide).toBeGreaterThan(tiede) // le froid presse le pas
    // Et le froid ne le rend jamais PLUS RAPIDE que sa vitesse nominale (R10) :
    expect(froide).toBeLessThanOrEqual(MONSTER_DEFS.cendreux.speed * (200 / BALANCE.TICK_RATE_HZ) + 0.001)
  })
})

describe('la rampe de saison (seasonRamp)', () => {
  it('linéaire du jour 0 au jour 60, et CLAMPÉE au-delà (la Cendre finale n\'extrapole pas)', () => {
    expect(seasonRamp(0, 10, 0)).toBe(0)
    expect(seasonRamp(0, 10, 30)).toBe(5)
    expect(seasonRamp(0, 10, 60)).toBe(10)
    expect(seasonRamp(0, 10, 75)).toBe(10) // jour 75 = jour 60 : T15 tient après la fin
    expect(seasonRamp(2, 6, 90)).toBe(6)
  })

  it('le plafond des rôdeurs morts MONTE en continu : 1 en début de saison, UNDEAD_MAX_FIN à la fin', () => {
    const plafondDuJour = (jour: number): number =>
      Math.round(seasonRamp(1, NIGHT_HUNT.UNDEAD_MAX_FIN, jour))
    expect(plafondDuJour(1)).toBe(1)
    expect(plafondDuJour(60)).toBe(NIGHT_HUNT.UNDEAD_MAX_FIN)
    let prev = 0
    for (let jour = 1; jour <= 60; jour++) {
      const p = plafondDuJour(jour)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
    // Une table de trois valeurs est plate ; une rampe visite TOUS les crans intermédiaires.
    const crans = new Set<number>()
    for (let jour = 1; jour <= 60; jour++) crans.add(plafondDuJour(jour))
    expect(crans.size).toBe(NIGHT_HUNT.UNDEAD_MAX_FIN)
  })
})

describe('la satiété atténue l\'éveil (fondation de « rassasié, il s\'affaisse »)', () => {
  it('un cendreux repu au cœur du froid retombe amorphe ; l\'affamé y veille à plein', () => {
    const state = nuitDuJour(55) // plaine de nuit acte III : éveil brut = 1
    const id = spawnMonster(state, 'cendreux', 30.5, 32.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const ent = state.entities.find((e) => e.id === id)!
    // Le champ n'existe pas encore à la naissance : l'éveil est le brut.
    expect(monster.satiete).toBeUndefined()
    // Repu (SATIETE_MAX) : il porte l'échelle entière de degrés — éveil 1 − 1 = 0.
    monster.satiete = CENDREUX.BOIRE.SATIETE_MAX
    const x0 = ent.x
    state.structures.push({ type: 'fire', tx: 45, ty: 32, villageId: 0 } as never)
    for (let t = 0; t < 100; t++) advanceMonsters(state)
    // Il a un but (le feu) : il avance au plancher, pas à plein — comparé à l'affamé.
    const repu = ent.x - x0
    const temoin = nuitDuJour(55)
    temoin.structures.push({ type: 'fire', tx: 45, ty: 32, villageId: 0 } as never)
    const id2 = spawnMonster(temoin, 'cendreux', 30.5, 32.5)
    const ent2 = temoin.entities.find((e) => e.id === id2)!
    const x1 = ent2.x
    for (let t = 0; t < 100; t++) advanceMonsters(temoin)
    expect(ent2.x - x1).toBeGreaterThan(repu)
    expect(repu).toBeGreaterThan(0) // même repu : un but = jamais statue
  })
})
