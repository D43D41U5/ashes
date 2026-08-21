/**
 * LA LONGUE MARCHE DU SOLITAIRE (décisions ① et ⑨, 2026-08-21) — le levé marche vers le feu
 * allumé le plus proche par le champ des feux, de plus en plus loin au fil des actes, et il
 * retient le dernier LIEU où il a vu un vivant.
 *
 * Le montage clef : AUCUNE horde dans l'état — le constat bloquant du panel (C21) était
 * précisément qu'un champ gaté sur `hordes.length > 0` aurait rendu la convergence morte-née.
 */
import { describe, it, expect } from 'vitest'
import { CENDREUX, TERRAIN_GRASS } from './balance'
import { createSim, spawnEntity, type SimState } from './sim'
import { createEmptyMap } from './map'
import { advanceMonsters, champDesFeux, spawnMonster } from './monsters'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** Plaine nue de 128 tuiles de large, posée au jour voulu, à MINUIT (patron du banc `nuits`). */
function nuitDuJour(jour: number): SimState {
  const state = createSim(1, {
    map: createEmptyMap(128, 64, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(0),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  return state
}

const feuEn = (state: SimState, tx: number, ty: number): void => {
  state.structures.push({ type: 'fire', tx, ty, villageId: 0 } as never)
}

describe('le champ des feux', () => {
  it('multi-sources : la distance rendue est celle du feu le plus proche EN MARCHE', () => {
    const state = nuitDuJour(55) // acte III : portée vallée entière
    feuEn(state, 10, 32)
    feuEn(state, 100, 32)
    const champ = champDesFeux(state)!
    expect(champ).not.toBeNull()
    expect(champ[32 * 128 + 12]).toBe(2) // à 2 tuiles du feu ouest
    expect(champ[32 * 128 + 97]).toBe(3) // à 3 tuiles du feu est
    // Au milieu (55), le plus proche est l'ouest (45 contre... est à 45 aussi) — les deux
    // bassins se rejoignent : la distance est le MIN des deux marches.
    expect(champ[32 * 128 + 55]).toBe(45)
  })

  it('aucun feu allumé → aucun champ ; un feu né → le champ suit (le cache se re-signe)', () => {
    const state = nuitDuJour(55)
    expect(champDesFeux(state)).toBeNull()
    feuEn(state, 10, 32)
    expect(champDesFeux(state)).not.toBeNull()
  })

  it('borné par la portée de l\'acte : l\'acte I ne connaît que 20 tuiles autour du feu', () => {
    const acteI = nuitDuJour(5)
    feuEn(acteI, 10, 32)
    const champI = champDesFeux(acteI)!
    expect(champI[32 * 128 + 25]).toBe(15) // dans la portée (CONVERGE_TILES[0] = 20)
    expect(champI[32 * 128 + 60]).toBe(-1) // hors de portée : la vallée s'arrête là
    const acteIII = nuitDuJour(55)
    feuEn(acteIII, 10, 32)
    expect(champDesFeux(acteIII)![32 * 128 + 60]).toBe(50) // l'acte III paie la vallée
  })
})

describe('la longue marche (décision ①)', () => {
  it('nuit d\'acte III, feu à 50 tuiles, AUCUNE horde : le solitaire se met en marche', () => {
    const state = nuitDuJour(55)
    feuEn(state, 100, 32)
    const id = spawnMonster(state, 'cendreux', 50.5, 32.5) // à 50 tuiles : loin de l'A* des 20
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x
    for (let t = 0; t < 300; t++) { state.tick += 1; advanceMonsters(state) }
    expect(ent.x).toBeGreaterThan(x0 + 5) // il a couvert du chemin VERS le feu
    expect(state.hordes.length).toBe(0) // et sans aucune horde pour lui prêter un champ
  })

  it('même géométrie en acte I : le feu est HORS de sa portée de convergence — il reste', () => {
    const state = nuitDuJour(5)
    feuEn(state, 100, 32)
    const id = spawnMonster(state, 'cendreux', 50.5, 32.5)
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x
    for (let t = 0; t < 300; t++) { state.tick += 1; advanceMonsters(state) }
    expect(ent.x).toBe(x0) // l'acte I garde son statu quo : 20 tuiles, pas une de plus
  })

  it('arrivé à moins de WARMTH_SEEK_RANGE, l\'A* précis prend la main (le chemin se pose)', () => {
    const state = nuitDuJour(55)
    feuEn(state, 60, 32)
    const id = spawnMonster(state, 'cendreux', 45.5, 32.5) // à 15 tuiles : dans les 20 de l'A*
    const monster = state.monsters.find((m) => m.entityId === id)!
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
    expect(CENDREUX.WARMTH_SEEK_RANGE).toBe(20)
  })
})

describe('la mémoire du dernier lieu (décision ⑨)', () => {
  it('proie vue puis disparue : il va au dernier lieu, y arrive, et OUBLIE', () => {
    const state = nuitDuJour(55)
    const proieId = spawnEntity(state, 47.5, 32.5)
    const proie = state.entities.find((e) => e.id === proieId)!
    const id = spawnMonster(state, 'cendreux', 44.5, 32.5) // proie à 3 tuiles, vue pleine la nuit
    const monster = state.monsters.find((m) => m.entityId === id)!
    const ent = state.entities.find((e) => e.id === id)!
    advanceMonsters(state)
    expect(monster.lastSeenX).toBeCloseTo(47.5, 5) // il a noté le lieu
    // La proie se volatilise loin hors de vue (téléport de banc).
    proie.x = 5.5
    proie.y = 5.5
    for (let t = 0; t < 400; t++) { state.tick += 1; advanceMonsters(state) } // le tick avance : le think se rejoue (mémoire « une phase seule n'est pas un tick »)
    // Il est allé VÉRIFIER le lieu (il s'en est approché à moins d'une tuile), puis a oublié.
    expect(monster.lastSeenX).toBeUndefined()
    expect(Math.abs(ent.x - 47.5)).toBeLessThan(2.5)
  })
})
