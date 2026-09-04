/**
 * Les outils de dev sont dans la sim, donc ils sont testés comme le reste —
 * et surtout : on teste qu'ils sont INERTES quand `debug` n'est pas armé.
 * C'est ce qui rend sûr de les laisser dans le même canal d'action que le jeu.
 */
import { describe, expect, it } from 'vitest'
import { applyDamage } from './combat'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { ACTS_PER_YEAR, BALANCE, CENDREUX, EAU, MORTS, NIGHT_HUNT, TEMPERATURE, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE } from './balance'
import { isBlockedAt } from './collision'
import { niveauDuCorps, type EtageCreux } from './etages'
import { niveauDEau } from './eau'
import { drainEvents } from './events'
import { coeurDeLaSaisonSuivante, getGameTime, jourDeSaison, phaseForDay, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { foundNpcVillage } from './worldgen'

function makeSim(debug: boolean): { sim: SimState; player: number } {
  const sim = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), debug })
  const player = spawnEntity(sim, 10, 10)
  return { sim, player }
}

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

describe('debug — téléportation', () => {
  it('pose l’avatar sur la tuile visée', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_teleport', x: 40.5, y: 33.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBeCloseTo(40.5)
    expect(e.y).toBeCloseTo(33.5)
  })

  it('borne la cible à la carte (hors-bornes = terrain indéfini)', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_teleport', x: -500, y: 99999 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBe(0.5)
    expect(e.y).toBe(63.5)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_teleport', x: 40.5, y: 33.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.x).toBe(10)
    expect(e.y).toBe(10)
  })

  /**
   * ═══ LE TP VISE UNE TUILE, PAS UN ÉTAGE — et il se pose sur le sol qui S'Y TROUVE ═══
   *
   * Vu (2026-09-04, `smoke --scenario mesa`, vue « dessus ») : téléporté au milieu d'un chapeau,
   * l'avatar atterrissait DANS la roche du sol (étage effacé → palier du sol → roche), figé sans
   * un mot, alors qu'un plancher de scree l'attendait un étage plus haut. Le TP de debug traverse
   * les murs par contrat, mais il n'a aucune raison de préférer la roche à un sol marchable.
   * Règle : le palier du sol s'il est marchable (le cas d'avant, inchangé) ; sinon l'étage
   * marchable le plus HAUT qui couvre la tuile (chapeau avant cave) ; sinon la roche, comme avant.
   */
  const laboDEtages = (): { sim: SimState; player: number } => {
    const map = createEmptyMap(32, 32, TERRAIN_GRASS)
    const chapeau: number[] = []
    const cave: number[] = []
    // Une mesa 4×4 en (10..13, 10..13) : roche au sol, scree à +1 — et une cave à −1 sous ses
    // deux colonnes de l'ouest seulement ; à (20,20) une tuile de roche SANS étage.
    for (let y = 10; y < 14; y++) {
      for (let x = 10; x < 14; x++) {
        map.terrain[y * map.width + x] = TERRAIN_ROCK
        chapeau.push(y * map.width + x)
        if (x < 12) cave.push(y * map.width + x)
      }
    }
    map.terrain[20 * map.width + 20] = TERRAIN_ROCK
    const haut: EtageCreux = { niveau: 1, idx: chapeau, terrain: chapeau.map(() => TERRAIN_SCREE), x0: 10, y0: 10, x1: 14, y1: 14 }
    const bas: EtageCreux = { niveau: -1, idx: cave, terrain: cave.map(() => TERRAIN_SCREE), x0: 10, y0: 10, x1: 12, y1: 14 }
    map.etages = [haut, bas]
    const sim = createSim(1, { map, debug: true })
    return { sim, player: spawnEntity(sim, 5, 5) }
  }

  it('posé sur un chapeau, l’avatar est SUR le chapeau — et il peut marcher', () => {
    const { sim, player } = laboDEtages()
    act(sim, player, { type: 'debug_teleport', x: 12.5, y: 12.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(niveauDuCorps(sim.map, e)).toBe(1)
    expect(isBlockedAt({ map: sim.map, etages: [niveauDuCorps(sim.map, e)] }, 12, 12)).toBe(false)
  })

  it('chapeau ET cave sous la même tuile : le plus haut gagne', () => {
    const { sim, player } = laboDEtages()
    act(sim, player, { type: 'debug_teleport', x: 10.5, y: 11.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(niveauDuCorps(sim.map, e)).toBe(1)
  })

  it('posé sur le sol marchable, rien d’écrit : le palier du sol, comme avant', () => {
    const { sim, player } = laboDEtages()
    // D'abord sur le chapeau (étage écrit), puis sur le pré : l'étage doit s'effacer.
    act(sim, player, { type: 'debug_teleport', x: 12.5, y: 12.5 })
    act(sim, player, { type: 'debug_teleport', x: 5.5, y: 5.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.etage).toBeUndefined()
    expect(niveauDuCorps(sim.map, e)).toBe(0)
  })

  it('roche sans aucun étage : dans la roche, comme avant (le TP traverse les murs par contrat)', () => {
    const { sim, player } = laboDEtages()
    act(sim, player, { type: 'debug_teleport', x: 20.5, y: 20.5 })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.etage).toBeUndefined()
    expect(e.x).toBeCloseTo(20.5)
  })
})

describe('debug — heure forcée', () => {
  it('amène l’horloge à l’heure demandée sans toucher au calendrier', () => {
    const { sim, player } = makeSim(true)
    const dayBefore = getGameTime(sim).seasonDay
    act(sim, player, { type: 'debug_set_hour', hour: 23 })
    const time = getGameTime(sim)
    // Le tick a avancé d'un cran pendant le step : on tolère la minute de jeu.
    expect(time.hourOfCycle).toBeGreaterThan(22.9)
    expect(time.isNight).toBe(true)
    expect(time.seasonDay).toBe(dayBefore)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    const before = sim.cycleOffset
    act(sim, player, { type: 'debug_set_hour', hour: 23 })
    expect(sim.cycleOffset).toBe(before)
  })
})

/**
 * LE SAUT DE CALENDRIER, DE BOUT EN BOUT — la promesse qu'on vend au joueur qui clique.
 *
 * Le bouton du panneau (P) enchaîne `coeurDeLaSaisonSuivante` puis `debug_set_season_day` ;
 * ce banc rejoue exactement cet enchaînement, sur la sim, et exige le RÉSULTAT VISIBLE — pas
 * le tick, pas le jour : la vallée à sec. C'est la garde qui manquait au moment où l'action
 * existait dans /sim sans surface : personne ne pouvait constater qu'elle menait quelque part.
 */
describe('debug — le saut de calendrier mène VRAIMENT à la saison', () => {
  it('cliquer jusqu’à l’Ardeur pose le monde dans une vallée à SEC', () => {
    const sim = createSim(1, {
      map: createEmptyMap(64, 64, TERRAIN_GRASS),
      debug: true,
      calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE,
      jourDeDepart: BALANCE.JOUR_DE_DEPART,
      finDeSaison: null,
    })
    const player = spawnEntity(sim, 10, 10)

    // À L'OUVERTURE, LE MONDE EST HUMIDE — c'est le problème que l'outil règle. L'aridité veut
    // de la chaleur autant que de la sécheresse, et les Pluies n'en ont pas (`saisons.md` S10).
    expect(niveauDEau(sim)).toBeGreaterThan(-EAU.SEUIL_ASSECHEMENT)

    // ON CLIQUE JUSQU'À L'ARDEUR, on ne compte pas les clics : leur nombre est la distance
    // entre la phase d'ouverture et l'été, pas une propriété du saut — et `JOUR_DE_DEPART` a
    // bougé deux fois le 2026-08-24. On passe par la MÊME fonction que le panneau, donc si elle
    // change de loi ce banc suit sans qu'on le retouche.
    let clics = 0
    while (phaseForDay(jourDeSaison(sim)) !== 2 && clics < ACTS_PER_YEAR) {
      act(sim, player, { type: 'debug_set_season_day', day: coeurDeLaSaisonSuivante(jourDeSaison(sim)) })
      clics += 1
    }

    expect(phaseForDay(jourDeSaison(sim)), `${clics} clics`).toBe(2) // l'Ardeur
    // ET LA VALLÉE EST À SEC : le régime que le jeu normal met h 46,5 à montrer.
    expect(niveauDEau(sim)).toBeLessThanOrEqual(-EAU.SEUIL_ASSECHEMENT)
  })

  it('et il reste INERTE sans `debug` armé — comme tous les autres', () => {
    const { sim, player } = makeSim(false)
    const avant = sim.tick
    act(sim, player, { type: 'debug_set_season_day', day: 300 })
    // Un tick a passé (c'est `step`), mais le calendrier n'a pas sauté.
    expect(sim.tick).toBe(avant + 1)
  })
})

describe('debug — invulnérabilité', () => {
  it('encaisse un coup mortel sans perdre de PV ni mourir', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_god', on: true })
    const e = sim.entities.find((x) => x.id === player)!
    applyDamage(sim, e, 9999, 0)
    expect(e.hp).toBe(100)
    expect(sim.entities.some((x) => x.id === player)).toBe(true)
  })

  it('gèle la faim (elle serait sinon drainée à chaque tick)', () => {
    const { sim, player } = makeSim(true)
    const e = sim.entities.find((x) => x.id === player)!
    e.hunger = 3
    act(sim, player, { type: 'debug_god', on: true })
    for (let i = 0; i < 200; i++) step(sim, [{ entityId: player, dx: 0, dy: 0 }])
    expect(e.hunger).toBe(100)
    expect(e.temperature).toBe(TEMPERATURE.CORPS_SAIN)
  })

  it('se coupe : l’avatar redevient mortel', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_god', on: true })
    act(sim, player, { type: 'debug_god', on: false })
    const e = sim.entities.find((x) => x.id === player)!
    applyDamage(sim, e, 30, 0)
    expect(e.hp).toBe(70)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_god', on: true })
    const e = sim.entities.find((x) => x.id === player)!
    expect(e.god).toBeUndefined()
    applyDamage(sim, e, 30, 0)
    expect(e.hp).toBe(70)
  })
})

/**
 * RÉVEILLER LE SOL À LA DEMANDE (spec `cendreux.md` R21bis).
 *
 * Ce qui doit être vrai, et qui n'est pas évident : que ce soit un VRAI réveil et pas un
 * raccourci. Un debug qui planterait autre chose que ce que plante la nuit ferait constater
 * une animation qui n'existe pas dans le jeu — c'est le pire service qu'un outil de debug
 * puisse rendre, et c'est exactement ce que `debug_set_season_day` a déjà appris au projet
 * (se poser PILE sur le jour visé ne franchissait aucune bascule, et le monde mentait).
 */
describe('debug — réveiller le sol', () => {
  it('plante un réveil dans la couronne du MORT, pas dans celle du loup', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_reveil' })
    expect(sim.reveils).toHaveLength(1)
    const r = sim.reveils[0]!
    const dx = r.x - 10
    const dy = r.y - 10
    const d = Math.sqrt(dx * dx + dy * dy)
    expect(d).toBeGreaterThanOrEqual(NIGHT_HUNT.SPAWN_DIST_UNDEAD - NIGHT_HUNT.SPAWN_RING_UNDEAD)
    expect(d).toBeLessThanOrEqual(NIGHT_HUNT.SPAWN_DIST_UNDEAD + NIGHT_HUNT.SPAWN_RING_UNDEAD)
  })

  it('le plante POUR celui qui a appuyé, et il mûrit à la durée normale', () => {
    const { sim, player } = makeSim(true)
    const avant = sim.tick
    act(sim, player, { type: 'debug_reveil' })
    const r = sim.reveils[0]!
    expect(r.preyId).toBe(player)
    expect(r.at).toBe(avant + MORTS.REVEIL_TICKS)
  })

  it('ÇA S’ANNONCE — le raclement part, comme pour la nuit', () => {
    const { sim, player } = makeSim(true)
    drainEvents(sim)
    act(sim, player, { type: 'debug_reveil' })
    const prowl = drainEvents(sim).filter((e) => e.type === 'cendreux_prowl')
    expect(prowl).toHaveLength(1)
    expect(prowl[0]!.targetEntityId).toBe(player)
  })

  it('NE CONSOMME AUCUN TIRAGE : une touche de debug ne décale pas le monde', () => {
    // La garde la plus importante du lot. Le flux seedé doit être insensible à ce qu'on
    // presse en dev, sinon deux parties « même seed, mêmes inputs » divergeraient selon
    // qu'on a regardé un réveil ou non — et l'invariant n°2 avec elles.
    const { sim, player } = makeSim(true)
    const avant = sim.rngState
    act(sim, player, { type: 'debug_reveil' })
    expect(sim.rngState).toBe(avant)
  })

  it('rend un vrai Cendreux, avec les trois marques du rôdeur', () => {
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_reveil' })
    for (let i = 0; i <= MORTS.REVEIL_TICKS; i++) step(sim, [])
    expect(sim.reveils).toHaveLength(0)
    const m = sim.monsters.find((x) => x.type === 'cendreux')
    expect(m).toBeDefined()
    expect(m!.ambient).toBe(true)
    expect(m!.nightHunter).toBe(true)
    expect(m!.huntTargetId).toBe(player)
  })

  it('LE FEU LE REPOUSSE QUAND MÊME (décision ⑦) — la parade se teste par ce chemin aussi', () => {
    // Depuis le 2026-08-21, le feu ne tue plus un réveil : il le DÉPLACE hors de sa bulle,
    // timer neuf. Le chemin debug éprouve la même règle que la nuit réelle.
    const { sim, player } = makeSim(true)
    act(sim, player, { type: 'debug_reveil' })
    const r = sim.reveils[0]!
    sim.structures.push({
      id: 9001, type: 'fire', tx: Math.floor(r.x), ty: Math.floor(r.y), villageId: 0, hp: 100, lit: true,
    } as never)
    drainEvents(sim)
    step(sim, [])
    expect(drainEvents(sim).some((e) => e.type === 'reveil_etouffe')).toBe(true)
    expect(sim.reveils).toHaveLength(1) // déplacé, pas tué
    const d2 = (sim.reveils[0]!.x - (Math.floor(r.x) + 0.5)) * (sim.reveils[0]!.x - (Math.floor(r.x) + 0.5))
      + (sim.reveils[0]!.y - (Math.floor(r.y) + 0.5)) * (sim.reveils[0]!.y - (Math.floor(r.y) + 0.5))
    expect(d2).toBeGreaterThan(CENDREUX.HEARTH_WARD_RADIUS * CENDREUX.HEARTH_WARD_RADIUS)
    expect(sim.monsters.some((m) => m.type === 'cendreux')).toBe(false) // pas encore : il mûrit là-bas
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_reveil' })
    expect(sim.reveils).toHaveLength(0)
  })
})

describe('debug — tamponner le palier de bâti (spec village-pnj-evolution)', () => {
  it('palier 3 : le plan directeur entier est posé, pierre et stations comprises', () => {
    const { sim, player } = makeSim(true)
    const village = foundNpcVillage(sim, 32, 32, 3)
    act(sim, player, { type: 'debug_village_stage', villageId: village.id, stage: 3 })
    const du = sim.structures.filter((s) => s.villageId === village.id)
    const n = (t: string): number => du.filter((s) => s.type === t).length
    expect(n('floor')).toBe(48) //          3 logis × 16 sols (intérieur 4×4)
    expect(n('wall')).toBe(45) //           3 logis × 15 murs — l'enceinte n'est PAS un mur
    expect(n('palissade')).toBe(66) //      l'anneau 9, moins la porte charretière
    expect(n('door')).toBe(5) //            3 logis + la porte charretière (2 vantaux)
    expect(n('workshop') + n('furnace') + n('silo')).toBe(3)
    // LES LOGIS sont en pierre (murs et portes) ; la palissade et la porte charretière
    // restent du bois — c'est leur essence (décision d'Alexis, 2026-08-01).
    const pierres = du.filter((s) => (s.type === 'wall' || s.type === 'door') && s.material === 'stone')
    expect(pierres.length).toBe(48) // 45 murs + 3 portes de logis ; les 2 vantaux : bois
    expect(du.some((s) => s.type === 'house')).toBe(false)
  })

  it('inerte hors debug, et inerte sur un village à chef humain', () => {
    const { sim, player } = makeSim(false)
    const village = foundNpcVillage(sim, 32, 32, 2)
    const avant = sim.structures.length
    act(sim, player, { type: 'debug_village_stage', villageId: village.id, stage: 3 })
    expect(sim.structures.length).toBe(avant)
    expect(village.buildTier).toBe(1)
  })
})

describe('debug — la carcasse posée (spec depecage.md)', () => {
  it('fait naître une vraie bête et la tue : une carcasse marquée, avec os et peau (clean), à deux tuiles', () => {
    const { sim, player } = makeSim(true)
    drainEvents(sim)
    act(sim, player, { type: 'debug_carcass', species: 'deer', clean: true })
    const evs = drainEvents(sim)
    expect(evs.some((e) => e.type === 'monster_slain' && e.monsterType === 'deer' && e.clean)).toBe(true)
    expect(sim.monsters).toHaveLength(0) // la bête n'a pas survécu à sa naissance
    const c = sim.corpses[0]!
    expect(c.carcass?.species).toBe('deer')
    expect(Math.abs(c.x - 12)).toBeLessThan(0.01)
    const compte = (item: string): number => c.inventory.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0)
    expect(compte('quartier')).toBe(2)
    expect(compte('bone')).toBe(2)
    expect(compte('raw_hide')).toBe(1)
  })

  it('ne fait RIEN si la sim n’est pas en debug', () => {
    const { sim, player } = makeSim(false)
    act(sim, player, { type: 'debug_carcass', species: 'boar' })
    expect(sim.corpses).toHaveLength(0)
  })
})
