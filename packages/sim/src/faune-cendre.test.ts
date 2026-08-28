import { describe, it, expect } from 'vitest'
import { FAUNA, TERRAIN_GRASS, TICK_DT_S } from './balance'
import { CENDRE, calculeChampDeCendre, profondeurNueDeCendre } from './cendre'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap, type WorldMap } from './map'
import { spawnMonster } from './monsters'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'

/**
 * ═══ LA CENDRE ET LA FAUNE (spec faune R25, critères A39-A40) ═══
 *
 * Un monde synthétique : de la prairie partout, UN foyer de cendre à l'est. Le
 * front est réel (le vrai champ de coût, la vraie avancée par âge) — seuls la
 * carte et l'âge sont posés à la main. Les positions de test (sain, frange,
 * cendre nue) se CHERCHENT contre le champ au lieu d'être écrites en dur : les
 * constantes de bande peuvent bouger sans mentir ici.
 */

const W = 160
const H = 80
const FOYER = { tx: 130, ty: 40 }
const AGE = 6 // jours effectifs : un disque net, loin de couvrir la carte

function makeMap(): WorldMap {
  const map = createEmptyMap(W, H, TERRAIN_GRASS)
  map.cendreCout = calculeChampDeCendre(W, H, map.terrain, [FOYER])
  return map
}

function makeSim(hour = 12): SimState {
  const sim = createSim(1234, {
    map: makeMap(),
    faunaCap: 0, // le banc pose ses bêtes à la main — pas de peuplement ambiant
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(hour, 1),
  })
  sim.cendreAge = [AGE]
  sim.wind = { x: 0, y: 0 } // calme plat : l'odorat ne dépend pas de la direction d'approche
  return sim
}

/** La profondeur nue à la tuile, sur l'état du banc. */
function prof(state: SimState, tx: number, ty: number): number {
  return profondeurNueDeCendre(state, tx, ty)
}

/** Sur la rangée du foyer, la première tuile cendrée en venant de l'ouest. */
function bordOuest(state: SimState): number {
  for (let tx = 0; tx < W; tx++) if (prof(state, tx, FOYER.ty) >= 0) return tx
  throw new Error('aucune tuile cendrée : le montage est faux')
}

/** Une tuile de la bande demandée sur la rangée du foyer (cherchée, jamais écrite). */
function tuileDeBande(state: SimState, veut: (p: number) => boolean): { tx: number; ty: number } {
  for (let tx = 0; tx < W; tx++) {
    if (veut(prof(state, tx, FOYER.ty))) return { tx, ty: FOYER.ty }
  }
  throw new Error('bande introuvable : le montage est faux')
}

describe('le montage a les trois bandes', () => {
  it('sain, frange et cendre nue existent sur la rangée du foyer', () => {
    const state = makeSim()
    expect(() => tuileDeBande(state, (p) => p < 0)).not.toThrow()
    expect(() => tuileDeBande(state, (p) => p >= 0 && p <= CENDRE.FRANGE_TUILES)).not.toThrow()
    expect(() => tuileDeBande(state, (p) => p > CENDRE.FRANGE_TUILES + 3)).not.toThrow()
  })
})

describe('A40 — la loi du monde : la cendre nue brûle la faune, la frange non', () => {
  it("un cerf posé au cœur meurt en ~hp/CENDRE_DOT_HP_S secondes, sans mise à mort ni silence R16", () => {
    const state = makeSim()
    // Un guetteur humain à portée de monde (sinon la bête se dissiperait), loin
    // de toute perception (> SAFE_RANGE) pour ne pas troubler la mesure.
    const coeur = tuileDeBande(state, (p) => p > CENDRE.FRANGE_TUILES + 3)
    spawnEntity(state, coeur.tx - 30, coeur.ty)
    const id = spawnMonster(state, 'deer', coeur.tx + 0.5, coeur.ty + 0.5)
    const hp0 = state.entities.find((e) => e.id === id)!.hp
    drainEvents(state)

    const attendu = Math.ceil(hp0 / (FAUNA.CENDRE_DOT_HP_S * TICK_DT_S))
    let mortAu = -1
    for (let t = 0; t < attendu + 40; t++) {
      step(state, [])
      if (mortAu < 0 && !state.monsters.some((m) => m.entityId === id)) {
        mortAu = t + 1
        break
      }
    }
    expect(mortAu, 'le cerf doit mourir de la cendre').toBeGreaterThan(0)
    // La cadence est la LOI, pas un à-peu-près : la mort tombe au tick dérivé
    // (± une pensée — la bête peut gagner quelques centièmes en bougeant, elle
    // est murée de toute part au cœur).
    expect(Math.abs(mortAu - attendu)).toBeLessThanOrEqual(5)

    // Une carcasse — le monde se raconte — mais RIEN d'une mise à mort :
    const events = drainEvents(state)
    const died = events.find((e) => e.type === 'entity_died' && e.entityId === id)
    expect(died && 'cause' in died ? died.cause : undefined).toBe('cendre')
    const slain = events.find((e) => e.type === 'monster_slain')
    expect(slain && 'clean' in slain ? slain.clean : undefined).toBe(false)
    expect(state.corpses.length).toBe(1)
    expect(countOf(state.corpses[0]!.inventory, 'raw_hide')).toBe(0)
    expect(state.faunaQuiet.length, 'la cendre ne pose pas le silence de chasse').toBe(0)
  })

  it('sur la frange, pas un PV — et la bête RESSORT (la cendre n’est pas un habitat)', () => {
    const state = makeSim()
    const frange = tuileDeBande(state, (p) => p >= 0 && p <= CENDRE.FRANGE_TUILES)
    spawnEntity(state, frange.tx - 35, frange.ty)
    const id = spawnMonster(state, 'deer', frange.tx + 0.5, frange.ty + 0.5)
    const hp0 = state.entities.find((e) => e.id === id)!.hp

    for (let t = 0; t < 200; t++) step(state, [])
    const e = state.entities.find((en) => en.id === id)
    expect(e, 'la bête vit').toBeDefined()
    expect(e!.hp).toBe(hp0)
    expect(prof(state, Math.floor(e!.x), Math.floor(e!.y)), 'goHome l’a ressortie').toBeLessThan(0)
  })

  it('le cendreux est chez lui : au cœur, il ne perd rien', () => {
    const state = makeSim()
    const coeur = tuileDeBande(state, (p) => p > CENDRE.FRANGE_TUILES + 3)
    spawnEntity(state, coeur.tx - 30, coeur.ty)
    const id = spawnMonster(state, 'cendreux', coeur.tx + 0.5, coeur.ty + 0.5)
    const hp0 = state.entities.find((e) => e.id === id)!.hp
    for (let t = 0; t < 100; t++) step(state, [])
    expect(state.entities.find((e) => e.id === id)!.hp).toBe(hp0)
  })
})

describe('A39 — le mur : la fuite LONGE le front, jamais un sabot dessus', () => {
  it('un cerf rabattu droit sur la cendre glisse le long du bord', () => {
    const state = makeSim()
    const bord = bordOuest(state)
    // Le rabatteur plein ouest, la peur pousse plein est — droit sur le front à
    // 4 tuiles. Sans le mur, la fuite engagée (30 tuiles de but) traverserait.
    const cerfX = bord - 4
    const chasseur = spawnEntity(state, cerfX - 5, FOYER.ty)
    const id = spawnMonster(state, 'deer', cerfX + 0.5, FOYER.ty + 0.5)

    let plusPres = Infinity
    for (let t = 0; t < 300; t++) {
      step(state, [])
      const e = state.entities.find((en) => en.id === id)
      if (!e) break // dissipée : le balayage a couvert sa vie entière
      const p = prof(state, Math.floor(e.x), Math.floor(e.y))
      expect(p, `tick ${t} : un sabot sur la cendre en (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`).toBeLessThan(0)
      for (let tx = Math.floor(e.x) - 2; tx <= Math.floor(e.x) + 2; tx++) {
        if (prof(state, tx, Math.floor(e.y)) >= 0) plusPres = Math.min(plusPres, Math.abs(tx - e.x))
      }
    }
    // La garde qui pourrait rougir : la course a bien RENCONTRÉ le front (sinon
    // ce vert ne prouverait rien), et la bête a bougé (elle longe, elle ne se fige pas).
    expect(plusPres, 'la fuite doit avoir rencontré le front').toBeLessThanOrEqual(2.5)
    const e = state.entities.find((en) => en.id === id)
    if (e) {
      const parcours = Math.abs(e.x - (cerfX + 0.5)) + Math.abs(e.y - (FOYER.ty + 0.5))
      expect(parcours, 'elle a glissé le long du mur, pas gelé dessous').toBeGreaterThan(3)
    }
    void chasseur
  })
})
