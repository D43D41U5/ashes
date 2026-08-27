/**
 * LA LONGUE MARCHE DU SOLITAIRE (décisions ① et ⑨, 2026-08-21) — le levé marche vers le feu
 * allumé le plus proche par le champ des feux, de plus en plus loin à mesure que l'année se
 * referme sur l'hiver, et il retient le dernier LIEU où il a vu un vivant.
 *
 * Le montage clef : AUCUNE horde dans l'état — le constat bloquant du panel (C21) était
 * précisément qu'un champ gaté sur `hordes.length > 0` aurait rendu la convergence morte-née.
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, CENDREUX, TERRAIN_GRASS } from './balance'
import { createSim, spawnEntity, type SimState } from './sim'
import { createEmptyMap } from './map'
import { advanceMonsters, champDesFeux, spawnMonster } from './monsters'
import { eveilCendreuxAt } from './temperature'
import { cycleOffsetForStartHour, gameTimeAt, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** Le cœur d'une saison, en jour de l'année — DÉRIVÉ d'`ACT_DAYS` (`saisons.md` S1 : quatre
 *  saisons de trente jours), jamais écrit. */
const coeurDeSaison = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
/**
 * LES DEUX SAISONS QUE CE FICHIER OPPOSE — c'est la PORTÉE de convergence qui les sépare
 * (`CENDREUX.CONVERGE_TILES`, quatre paliers depuis `saisons.md` S13) : l'Éclosion garde ses
 * 20 tuiles historiques, le Grand Froid referme la vallée entière sur les feux. Les jours
 * nommés « acte I » et « acte III » d'avant valaient exactement ces deux régimes-là ; sous les
 * quatre saisons qui tournent, le jour 55 est devenu le plein été et n'en vaut plus aucun.
 */
const ECLOSION = coeurDeSaison(1)
const GRAND_FROID = coeurDeSaison(4)

/** Plaine nue de 128 tuiles de large, posée au jour voulu, à MINUIT (patron du banc `nuits`). */
function nuitDuJour(jour: number): SimState {
  const state = createSim(1, {
    map: createEmptyMap(128, 64, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(0, 1),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  // La nuit dure ce que la saison veut (S6) : minuit s'affirme au lieu de se supposer.
  expect(gameTimeAt(state, state.tick).isNight).toBe(true)
  return state
}

const feuEn = (state: SimState, tx: number, ty: number): void => {
  state.structures.push({ type: 'fire', tx, ty, villageId: 0 } as never)
}

describe('le champ des feux', () => {
  it('multi-sources : la distance rendue est celle du feu le plus proche EN MARCHE', () => {
    const state = nuitDuJour(GRAND_FROID) // portée : la vallée entière
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
    const state = nuitDuJour(GRAND_FROID)
    expect(champDesFeux(state)).toBeNull()
    feuEn(state, 10, 32)
    expect(champDesFeux(state)).not.toBeNull()
  })

  it('borné par la portée de la saison : l\'Éclosion ne connaît que 20 tuiles autour du feu', () => {
    const eclosion = nuitDuJour(ECLOSION)
    feuEn(eclosion, 10, 32)
    const champPrintemps = champDesFeux(eclosion)!
    expect(champPrintemps[32 * 128 + 25]).toBe(15) // dans la portée (le palier de l'Éclosion : 20)
    expect(champPrintemps[32 * 128 + 60]).toBe(-1) // hors de portée : la vallée s'arrête là
    const grandFroid = nuitDuJour(GRAND_FROID)
    feuEn(grandFroid, 10, 32)
    expect(champDesFeux(grandFroid)![32 * 128 + 60]).toBe(50) // le Grand Froid paie la vallée
  })
})

describe('la longue marche (décision ①)', () => {
  it('nuit de Grand Froid, feu à 50 tuiles, AUCUNE horde : le solitaire se met en marche', () => {
    const state = nuitDuJour(GRAND_FROID)
    feuEn(state, 100, 32)
    const id = spawnMonster(state, 'cendreux', 50.5, 32.5) // à 50 tuiles : loin de l'A* des 20
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x
    for (let t = 0; t < 300; t++) { state.tick += 1; advanceMonsters(state) }
    expect(ent.x).toBeGreaterThan(x0 + 5) // il a couvert du chemin VERS le feu
    expect(state.hordes.length).toBe(0) // et sans aucune horde pour lui prêter un champ
  })

  it('même géométrie à l\'Éclosion : le feu est HORS de sa portée de convergence — il reste', () => {
    const state = nuitDuJour(ECLOSION)
    feuEn(state, 100, 32)
    const id = spawnMonster(state, 'cendreux', 50.5, 32.5)
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x
    // LA PRÉMISSE D'ABORD : la longue marche est gatée sur `eveil > 0`. Sans cette ligne, une
    // nuit de printemps trop douce rendrait la bête amorphe et le test passerait au vert sans
    // rien mesurer de la PORTÉE — qui est la seule chose qu'il prétend garder.
    expect(eveilCendreuxAt(state, ent.x, ent.y, state.tick)).toBeGreaterThan(0)
    for (let t = 0; t < 300; t++) { state.tick += 1; advanceMonsters(state) }
    expect(ent.x).toBe(x0) // l'Éclosion garde son statu quo : 20 tuiles, pas une de plus
  })

  it('arrivé à moins de WARMTH_SEEK_RANGE, l\'A* précis prend la main (le chemin se pose)', () => {
    const state = nuitDuJour(GRAND_FROID)
    feuEn(state, 60, 32)
    const id = spawnMonster(state, 'cendreux', 45.5, 32.5) // à 15 tuiles : dans les 20 de l'A*
    const monster = state.monsters.find((m) => m.entityId === id)!
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
    expect(CENDREUX.WARMTH_SEEK_RANGE).toBe(20)
  })
})

/**
 * ═══ ILS NE MONTENT PLUS L'ESCALIER (Alexis, 2026-08-25) ═══
 *
 * *« Les Cendreux ne semblent pas avoir la possibilité de naviguer en diagonale. Trouve une
 * solution pour éviter qu'ils ne se déplacent tout le temps qu'en X ou qu'en Y. »*
 *
 * La cause était double et purement mécanique : le champ de flux est 4-CONNEXE, donc la tuile
 * élue est toujours un voisin orthogonal ; et `moveToward` annule tout axe sous sa ZONE MORTE.
 * L'un des deux écarts valait donc zéro à chaque pas. La correction ne touche PAS au champ (ce
 * serait rouvrir chaque chemin du jeu) : elle corrige le CAP — voir `descendreLeChamp`.
 */
describe('la marche oblique (Alexis, 2026-08-25)', () => {
  /** La part des ticks où l'entité a bougé sur LES DEUX axes — l'unique nombre qui décide. */
  function partObliques(state: SimState, ent: { x: number; y: number }, ticks: number): number {
    let obliques = 0
    let pas = 0
    for (let t = 0; t < ticks; t++) {
      const x0 = ent.x
      const y0 = ent.y
      state.tick += 1
      advanceMonsters(state)
      const dx = Math.abs(ent.x - x0)
      const dy = Math.abs(ent.y - y0)
      // Un « pas » est un tick où la bête a bougé du tout — les ticks de pensée ne comptent pas.
      if (dx > 1e-6 || dy > 1e-6) {
        pas += 1
        if (dx > 1e-6 && dy > 1e-6) obliques += 1
      }
    }
    expect(pas, 'la bête n’a pas bougé du tout : le montage ne mesure rien').toBeGreaterThan(50)
    return obliques / pas
  }

  it('un feu EN DIAGONALE se rejoint en oblique, pas en escalier', () => {
    const state = nuitDuJour(GRAND_FROID)
    feuEn(state, 100, 12) // à 45° du départ : 45 tuiles à l'est, 45 au nord
    const id = spawnMonster(state, 'cendreux', 55.5, 57.5)
    const ent = state.entities.find((e) => e.id === id)!
    const part = partObliques(state, ent, 400)
    // Sur une plaine nue et un but à 45°, l'immense majorité des pas doit porter les deux axes.
    // MESURÉ à 0 avant la correction — pas « peu » : ZÉRO, le champ ne pouvait pas l'exprimer.
    expect(part, 'il monte encore l’escalier').toBeGreaterThan(0.5)
  })

  it('un feu PLEIN EST se rejoint tout droit — on n’a pas remplacé un tic par un autre', () => {
    // ⚠ LA CONTREPARTIE, ET ELLE COMPTE AUTANT. Une correction qui obliquerait TOUJOURS ferait
    //   zigzaguer une approche en ligne droite : ce serait le même défaut de lisibilité, dans
    //   l'autre sens. La règle n'oblique que vers une tuile qui RAPPROCHE autant — donc jamais ici.
    const state = nuitDuJour(GRAND_FROID)
    feuEn(state, 100, 32)
    const id = spawnMonster(state, 'cendreux', 50.5, 32.5)
    const ent = state.entities.find((e) => e.id === id)!
    const y0 = ent.y
    const part = partObliques(state, ent, 400)
    expect(part, 'il zigzague sur une approche droite').toBeLessThan(0.05)
    expect(Math.abs(ent.y - y0), 'il a dérivé du droit chemin').toBeLessThan(1)
  })
})

describe('la mémoire du dernier lieu (décision ⑨)', () => {
  it('proie vue puis disparue : il va au dernier lieu, y arrive, et OUBLIE', () => {
    const state = nuitDuJour(GRAND_FROID)
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
