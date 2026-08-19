/**
 * LA FAÇADE DIT-ELLE LA MÊME CHOSE QUE LE VRAI ÉTAT ? — la seule question qui compte.
 *
 * Le rendu du gel appelle les fonctions de `/sim` sur un `SimState` RECONSTITUÉ du snapshot
 * (voir `etat-gel.ts`). Si la reconstitution est fausse d'un champ, le client peint une
 * glace qui n'est pas praticable — ou pire, n'en peint pas une qui l'est (G5 : « on ne
 * s'engage jamais sur la glace par surprise »).
 *
 * On construit donc un VRAI état par `createSim`, on n'en garde QUE ce que le protocole
 * transporte (`getGameTime`, `calendarScale`, `map`, `structures`, `meteo`), on refabrique la
 * façade avec ça, et on compare les trois fonctions **tuile par tuile, tick par tick**. Une
 * garde exhaustive plutôt que trois cas choisis : c'est la géométrie d'un écran entier qu'on
 * affirme, pas un point.
 *
 * ⚠ CE QUE CE TEST NE PEUT PAS COUVRIR, et c'est écrit dans l'en-tête du module : la BRUME.
 * Le snapshot ne la porte pas, donc la façade ne peut pas la reconstituer, donc le test la
 * laisse absente des deux côtés — il prouve la fidélité de la reconstitution, pas la
 * complétude du protocole. Le cas d'une nappe posée est vérifié ci-dessous **dans l'autre
 * sens** : on affirme que l'écart va toujours vers le FAUX NÉGATIF (le client manque une
 * glace, il n'en invente jamais), ce qui est la propriété dont dépend la sûreté du rendu.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  BRUME,
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_PINE,
  TERRAIN_SHALLOW_WATER,
  TICKS_PER_CYCLE,
  calendarScaleForSeasonCycles,
  createEmptyMap,
  createSim,
  estGele,
  feuillageDenude,
  getGameTime,
  neigeAuSol,
  type SimState,
  type WorldMap,
} from '@ashes/sim'
import { creerEtatGel, cycleOffsetDepuis, majEtatGel, type SourceDuGel } from './etat-gel'

/** 1 jour de saison = 1 cycle : le tick porte l'acte ET l'heure (patron `gel.test.ts`). */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/** Herbe, une rivière profonde, un gué, un bois de feuillus et un bois de conifères.
 *  (`setTile` n'est pas réexporté par l'index de `/sim` — on peint le terrain directement,
 *  ce que `setTile` fait lui-même à une garde de bornes près.) */
function carte(w = 40, h = 20): WorldMap {
  const map = createEmptyMap(w, h, TERRAIN_GRASS)
  const poser = (tx: number, ty: number, id: number): void => { map.terrain[ty * w + tx] = id }
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 10; tx < 13; tx++) poser(tx, ty, TERRAIN_DEEP_WATER)
    poser(16, ty, TERRAIN_SHALLOW_WATER)
    for (let tx = 22; tx < 28; tx++) poser(tx, ty, TERRAIN_FOREST)
    for (let tx = 30; tx < 36; tx++) poser(tx, ty, TERRAIN_PINE)
  }
  return map
}

function sim(meteoActive = true): SimState {
  return createSim(2026, { map: carte(), calendarScale: SCALE, meteoActive })
}

/** CE QUE LE FIL PORTE, et rien de plus — c'est tout l'objet du test. */
function sourceDepuis(state: SimState): SourceDuGel {
  return {
    map: state.map,
    temps: getGameTime(state),
    calendarScale: state.calendarScale,
    structures: state.structures,
    meteo: state.meteo ?? null,
  }
}

/** Balaie toute la carte et rend les trois verdicts, aplatis. */
function verdicts(etat: SimState, map: WorldMap): { gel: string; neige: number[]; nu: string } {
  let gel = ''
  let nu = ''
  const neige: number[] = []
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      gel += estGele(etat, tx, ty) ? '1' : '0'
      nu += feuillageDenude(etat, tx, ty) ? '1' : '0'
      neige.push(neigeAuSol(etat, tx, ty))
    }
  }
  return { gel, neige, nu }
}

describe('le décalage de cycle se retrouve de l’heure publiée', () => {
  it('rend EXACTEMENT le cycleOffset de la sim, sur tout le tour du cycle', () => {
    // Balayage : cent phases du cycle, à des ticks très différents. Une inversion fausse
    // d'un tour de modulo se verrait sur l'une d'elles, jamais sur trois cas choisis.
    for (const tick of [0, 1, 997, TICKS_PER_CYCLE - 1, TICKS_PER_CYCLE, 123_456, 1_000_003]) {
      for (let k = 0; k < 100; k++) {
        const offset = Math.round((k / 100) * TICKS_PER_CYCLE)
        const state = { tick, cycleOffset: offset, calendarScale: SCALE } as unknown as SimState
        const temps = getGameTime(state)
        expect(cycleOffsetDepuis(tick, temps.hourOfCycle), `tick=${tick} offset=${offset}`).toBe(offset)
      }
    }
  })

  it('rend la MÊME heure et la MÊME nuit que l’état d’origine', () => {
    // La garde qui compte vraiment : l'aller-retour doit préserver ce que la température LIT
    // (l'acte et la nuit), pas seulement un nombre.
    for (let k = 0; k < 240; k++) {
      const tick = 400_000 + k * 719
      const state = { tick, cycleOffset: (k * 1237) % TICKS_PER_CYCLE, calendarScale: SCALE } as unknown as SimState
      const vrai = getGameTime(state)
      const refait = getGameTime({ ...state, cycleOffset: cycleOffsetDepuis(tick, vrai.hourOfCycle) } as SimState)
      expect(refait.isNight, `k=${k}`).toBe(vrai.isNight)
      expect(refait.act, `k=${k}`).toBe(vrai.act)
    }
  })
})

describe('la façade rend les mêmes verdicts que le vrai SimState', () => {
  it('glace, neige et feuillage : identiques tuile par tuile, sur tous les actes, jour et nuit', () => {
    const state = sim()
    const facade = creerEtatGel(sourceDepuis(state))
    // Les trois actes, de jour et en pleine nuit — l'acte porte le froid, la nuit le double.
    for (const jour of [10, 30, 50, 55, 58]) {
      for (const nuit of [false, true]) {
        state.tick = (jour - 1) * TICKS_PER_CYCLE + (nuit ? Math.floor(TICKS_PER_CYCLE * 0.75) : Math.floor(TICKS_PER_CYCLE * 0.25))
        majEtatGel(facade, sourceDepuis(state))
        const vrai = verdicts(state, state.map)
        const vu = verdicts(facade, state.map)
        expect(vu.gel, `jour ${jour}${nuit ? ' nuit' : ''} : la glace`).toBe(vrai.gel)
        expect(vu.nu, `jour ${jour}${nuit ? ' nuit' : ''} : le feuillage`).toBe(vrai.nu)
        expect(vu.neige, `jour ${jour}${nuit ? ' nuit' : ''} : la neige`).toEqual(vrai.neige)
      }
    }
  })

  it('un front météo dans l’état : le froid qu’il apporte passe bien par la façade', () => {
    const state = sim()
    // Un front de blizzard couvre la carte : c'est le plus froid des cinq, et il doit geler
    // ce qu'il traverse (A8). S'il ne passait PAS par la façade, la glace manquerait.
    //
    // LA FENÊTRE EST CENTRÉE (`tick` à mi-chemin de `start`→`end`), et ce n'est pas un
    // détail : la bande AVANCE, et un front qui vient d'entrer ne couvre qu'un liseré à
    // l'ouest où l'intensité vaut 0,005. Un premier jet l'a posé ainsi et n'a rien gelé du
    // tout — c'est le témoin qui l'a dit. Centrée, la bande (240 tuiles de large) noie une
    // carte de 40 et l'intensité y sature : le froid mord partout.
    state.tick = 29 * TICKS_PER_CYCLE + Math.floor(TICKS_PER_CYCLE * 0.25)
    state.meteo = {
      type: 'blizzard', cycle: 29, day: 30, edge: 0,
      startTick: state.tick - 10_000, endTick: state.tick + 10_000,
    }
    const facade = creerEtatGel(sourceDepuis(state))
    const vrai = verdicts(state, state.map)
    expect(verdicts(facade, state.map).gel).toBe(vrai.gel)
    // Et le front mord VRAIMENT : sans lui, à ce jour et à cette heure, rien ne gèle.
    const sansFront = { ...state, meteo: null } as SimState
    expect(vrai.gel.includes('1'), 'le blizzard ne gèle rien — le témoin ne vaut rien').toBe(true)
    expect(verdicts(sansFront, state.map).gel).not.toBe(vrai.gel)
  })

  it('meteoActive : la façade le suppose ARMÉ, comme la Veillée et le serveur l’arment', () => {
    // `worker/veillee.ts` et `server/scenario.ts` le posent tous deux à `true` : la façade
    // dit donc la vérité partout où le jeu s'expédie. Un banc qui l'éteindrait verrait la
    // façade neiger là où la sim ne neige pas — c'est le seul écart possible, et il n'existe
    // que là où il n'y a pas d'écran.
    const arme = sim(true)
    const eteint = sim(false)
    eteint.tick = arme.tick = 54 * TICKS_PER_CYCLE
    const facade = creerEtatGel(sourceDepuis(eteint))
    expect(verdicts(facade, arme.map).neige).toEqual(verdicts(arme, arme.map).neige)
    expect(verdicts(eteint, eteint.map).neige.every((v) => v === 0)).toBe(true)
  })
})

describe('la Brume : le seul écart, et il va toujours dans le sens sûr', () => {
  it('sous une nappe, la façade MANQUE de la glace — elle n’en INVENTE jamais', () => {
    // Le snapshot ne porte pas `state.brume`. On pose donc une nappe dans le vrai état, on
    // laisse la façade l'ignorer (elle n'a pas le choix), et on affirme la seule propriété
    // dont la sûreté du rendu dépend : `façade ⇒ sim`. Autrement dit, toute glace peinte est
    // une glace praticable ; l'inverse peut manquer.
    const state = sim()
    // Un jour et une heure choisis DANS la bande morte du gué : sans la nappe il ne gèle
    // pas, avec elle il gèle. C'est là que l'écart existe — ailleurs il n'y a rien à rater.
    state.tick = 29 * TICKS_PER_CYCLE + Math.floor(TICKS_PER_CYCLE * 0.25)
    state.brume = {
      day: 30, x0: 0, y0: 0, x1: state.map.width, y1: state.map.height,
      levee: true, annonceTick: 0, leveeTick: state.tick - 1000, finTick: state.tick + 20_000,
    } as unknown as NonNullable<SimState['brume']>
    const facade = creerEtatGel(sourceDepuis(state))
    const vrai = verdicts(state, state.map).gel
    const vu = verdicts(facade, state.map).gel
    for (let i = 0; i < vrai.length; i++) {
      if (vu[i] === '1') expect(vrai[i], `tuile ${i} : peinte gelée sans l'être`).toBe('1')
    }
    // Et le malus existe bien : sans lui, ce test ne prouverait rien.
    expect(BRUME.COLD_MALUS).toBeGreaterThan(0)
  })
})

describe('les terrains que le gel touche', () => {
  it('seule l’EAU gèle, et seuls les FEUILLUS se dénudent', () => {
    const state = sim()
    state.tick = 58 * TICKS_PER_CYCLE + Math.floor(TICKS_PER_CYCLE * 0.75) // acte III, nuit
    const facade = creerEtatGel(sourceDepuis(state))
    let eauGelee = 0
    let solGele = 0
    let feuillusNus = 0
    let coniferesNus = 0
    for (let ty = 0; ty < state.map.height; ty++) {
      for (let tx = 0; tx < state.map.width; tx++) {
        const t = state.map.terrain[ty * state.map.width + tx]
        const eau = t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
        if (estGele(facade, tx, ty)) { if (eau) eauGelee++; else solGele++ }
        if (feuillageDenude(facade, tx, ty)) { if (t === TERRAIN_FOREST) feuillusNus++; else if (t === TERRAIN_PINE) coniferesNus++ }
      }
    }
    expect(solGele, 'une tuile de sol peinte gelée').toBe(0)
    expect(eauGelee, 'aucune eau gelée en acte III de nuit').toBeGreaterThan(0)
    expect(feuillusNus, 'aucun feuillu dénudé au jour 58').toBeGreaterThan(0)
    expect(coniferesNus, 'un conifère dénudé — G6 promet qu’il tient').toBe(0)
  })
})
