import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  FLORE,
  NODE_DEFS,
  TEMPERATURE,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  SLOTS,
  TERRAIN_SNOW,
  TERRAINS,
  type NodeType,
} from './balance'
import { drainEvents } from './events'
import { makeInventory } from './items'
import { foundNpcVillage } from './worldgen'
import { floreGelee, gelMortel } from './gel'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { baselineTemperatureAt, climatFlore } from './temperature'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { addStructure, getVillageOf, grantItems, type Structure } from './village'
import { DAY_TICKS_PER_CYCLE, getGameTime, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import type { ResourceNode } from './economy'

/** 1 cycle jour/nuit = 1 jour de saison : la saison entière tient en 60 cycles. */
const FAST = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE

function makeSim(terrain = TERRAIN_GRASS, nodes: ResourceNode[] = []): SimState {
  return createSim(7, { map: createEmptyMap(40, 40, terrain), calendarScale: FAST, nodes })
}
/** Le tick du jour de saison `jour`, de jour ou de nuit. Vérifié par `getGameTime` sur place. */
function auJour(sim: SimState, jour: number, nuit = false): number {
  return jour * TICKS_PER_CYCLE + (nuit ? DAY_TICKS_PER_CYCLE + 10 : 10)
}
function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}
function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

describe('A1 — le climat de la flore EST le froid du monde, l’abri en moins', () => {
  it('rend `baselineTemperatureAt` au bit près sur toute tuile non abritée, à tout tick', () => {
    // GARDE EXHAUSTIVE (pas des points choisis) : chaque terrain du registre × un balayage
    // de la saison ET du cycle. Une seule propriété affirmée — l'égalité bit à bit.
    const sim = makeSim()
    const terrains = Object.keys(TERRAINS).map(Number)
    for (const t of terrains) {
      sim.map.terrain[12 * 40 + 12] = t
      for (let jour = 0; jour < 60; jour += 7) {
        for (const nuit of [false, true]) {
          const tick = auJour(sim, jour, nuit)
          expect(climatFlore(sim, 12, 12, tick)).toBe(baselineTemperatureAt(sim, 12, 12, tick))
        }
      }
    }
  })
})

describe('A2/A3/A6 — la repousse SUSPEND, elle ne meurt pas, et le minéral s’en moque', () => {
  /** Un nœud VIDÉ dont la date de repousse est déjà échue : le seul état que le gel retient. */
  function noeudAEcheance(type: NodeType, tick: number): ResourceNode {
    return { id: 1, type, tx: 12, ty: 12, stock: 0, regrowAt: Math.max(1, tick - 1) }
  }

  it('A2 — en acte III, un buisson à échéance reste vide, et AUCUN nœud ne disparaît', () => {
    const depart = 50 * TICKS_PER_CYCLE
    const sim = makeSim(TERRAIN_GRASS, [noeudAEcheance('berry_bush', depart)])
    sim.tick = depart
    expect(getGameTime(sim).act).toBe(3)
    expect(floreGelee(sim, 12, 12)).toBe(true)
    for (let i = 0; i < 100; i++) step(sim, [])
    expect(sim.nodes).toHaveLength(1) // F6 — rien ne sort de la carte
    expect(sim.nodes[0]!.stock).toBe(0)
    expect(sim.nodes[0]!.regrowAt).toBe(depart - 1) // la date NE GLISSE PAS
  })

  it('A3 — et il se remplit au tick où le climat repasse au-dessus du seuil', () => {
    // On part gelé (nuit d'acte II), on laisse venir l'aube : le climat remonte de 35 à 65.
    const nuit = auJour(makeSim(), 30, true)
    const sim = makeSim(TERRAIN_GRASS, [noeudAEcheance('berry_bush', nuit)])
    sim.tick = nuit
    expect(getGameTime(sim).isNight).toBe(true)
    expect(floreGelee(sim, 12, 12)).toBe(true)
    while (sim.nodes[0]!.stock === 0 && sim.tick < nuit + 3 * TICKS_PER_CYCLE) step(sim, [])
    expect(sim.nodes[0]!.stock).toBeGreaterThan(0)
    // Le dégel, et rien d'autre, l'a rempli : au tick d'avant il gelait ENCORE.
    expect(floreGelee(sim, 12, 12)).toBe(false)
    expect(climatFlore(sim, 12, 12, sim.tick - 1)).toBeLessThan(FLORE.SEUIL_GEL)
  })

  it('A6 — un filon de fer repousse à sa date en acte III, de nuit : le minéral n’a pas de saison', () => {
    const nuit = 50 * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE + 10
    const sim = makeSim(TERRAIN_GRASS, [noeudAEcheance('iron_vein', nuit)])
    sim.tick = nuit
    expect(NODE_DEFS.iron_vein.vivant).toBeUndefined()
    expect(floreGelee(sim, 12, 12)).toBe(true) // la tuile gèle…
    step(sim, [])
    expect(sim.nodes[0]!.stock).toBe(NODE_DEFS.iron_vein.stock) // …et le filon s'en moque
  })

  it('le gel ne DESSINE aucun tirage : le flux RNG est le même avec et sans nœud gelé', () => {
    const depart = 50 * TICKS_PER_CYCLE
    const avec = makeSim(TERRAIN_GRASS, [noeudAEcheance('berry_bush', depart)])
    const sans = makeSim(TERRAIN_GRASS, [])
    avec.tick = depart
    sans.tick = depart
    for (let i = 0; i < 200; i++) {
      step(avec, [])
      step(sans, [])
    }
    expect(avec.rngState).toBe(sans.rngState)
  })
})

describe('A4 — l’acte I reste entièrement libre, nuit comprise (non-régression)', () => {
  it('sur herbe, forêt et marais, à toute heure de l’acte I, rien ne gèle', () => {
    for (const terrain of [TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH]) {
      const sim = makeSim(terrain)
      for (let jour = 0; jour <= 20; jour++) {
        for (let h = 0; h < TICKS_PER_CYCLE; h += TICKS_PER_CYCLE / 24) {
          const tick = jour * TICKS_PER_CYCLE + h
          expect(climatFlore(sim, 12, 12, tick)).toBeGreaterThanOrEqual(FLORE.SEUIL_GEL)
        }
      }
    }
  })
})

describe('A5/A7/A8 — la cueillette gèle, le bois non ; la géographie et le blizzard mordent', () => {
  function simAvecJoueur(terrain: number, nodes: ResourceNode[], tick: number): { sim: SimState; id: number } {
    const sim = makeSim(terrain, nodes)
    sim.tick = tick
    const id = spawnEntity(sim, 12.5, 12.5)
    grantItems(sim, id, { axe: 1 })
    drainEvents(sim)
    return { sim, id }
  }

  it('A5 — sous le gel, le buisson est refusé ; l’arbre donne son bois et la fibre se ramasse', () => {
    const tick = 50 * TICKS_PER_CYCLE
    const nodes: ResourceNode[] = [
      { id: 1, type: 'berry_bush', tx: 12, ty: 12, stock: 8, regrowAt: 0 },
      { id: 2, type: 'tree', tx: 13, ty: 12, stock: 10, regrowAt: 0 },
      { id: 3, type: 'fiber_plant', tx: 12, ty: 13, stock: 6, regrowAt: 0 },
    ]
    const { sim, id } = simAvecJoueur(TERRAIN_GRASS, nodes, tick)
    expect(floreGelee(sim, 12, 12)).toBe(true)

    act(sim, id, { type: 'harvest', nodeId: 1 })
    expect(rejections(sim)).toContain('la plante est gelée')
    expect(countOf(sim.entities[0]!.inventory, 'berries')).toBe(0)

    sim.entities[0]!.cooldownUntil = 0
    act(sim, id, { type: 'harvest', nodeId: 2 })
    expect(rejections(sim)).not.toContain('la plante est gelée')
    expect(countOf(sim.entities[0]!.inventory, 'wood')).toBeGreaterThan(0) // le Feu vit

    // LA FIBRE SÈCHE SE RAMASSE ENCORE (décision d'Alexis 2026-08-20) : `tenue_hiver` en
    // coûte 2, et c'est la parade au froid — le geler fermerait sa propre contre-mesure.
    sim.entities[0]!.cooldownUntil = 0
    act(sim, id, { type: 'harvest', nodeId: 3 })
    expect(rejections(sim)).not.toContain('la plante est gelée')
    expect(countOf(sim.entities[0]!.inventory, 'fiber')).toBeGreaterThan(0)
  })

  it('A7 — au MÊME tick d’acte I, la neige gèle et l’herbe non', () => {
    const sim = makeSim(TERRAIN_GRASS)
    sim.map.terrain[12 * 40 + 12] = TERRAIN_SNOW
    sim.tick = 5 * TICKS_PER_CYCLE + 10
    expect(getGameTime(sim).act).toBe(1)
    expect(floreGelee(sim, 12, 12)).toBe(true) // le Névé est stérile dès le premier jour
    expect(floreGelee(sim, 20, 20)).toBe(false) // l'herbe d'à côté, non
  })

  it('A8 — le blizzard fige son sillage, et le relâche une fois passé', () => {
    const sim = createSim(7, {
      map: createEmptyMap(40, 40, TERRAIN_GRASS),
      calendarScale: FAST,
      meteoActive: true,
    })
    sim.tick = 30 * TICKS_PER_CYCLE + 10 // acte II, de JOUR : sans front, rien ne gèle
    expect(floreGelee(sim, 12, 12)).toBe(false)
    // La bande TRAVERSE : elle n'est pas encore sur (12,12) au tick où elle est élue. On
    // cherche le moment où elle y passe, sans jamais sortir du JOUR — sinon c'est la nuit
    // qui gèlerait, et le test ne prouverait rien du blizzard.
    const debut = sim.tick
    const finDuJour = 30 * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE - 5
    sim.meteo = {
      type: 'blizzard',
      cycle: Math.floor(debut / TICKS_PER_CYCLE),
      day: getGameTime(sim).seasonDay,
      edge: 0,
      startTick: debut,
      endTick: debut + TICKS_PER_CYCLE,
    }
    let passage = -1
    for (let t = debut; t < finDuJour; t++) {
      if (climatFlore(sim, 12, 12, t) < FLORE.SEUIL_GEL) {
        passage = t
        break
      }
    }
    expect(passage).toBeGreaterThan(-1) // la bande a bien couvert le point
    sim.tick = passage
    expect(getGameTime(sim).isNight).toBe(false) // c'est le blizzard, pas la nuit
    expect(floreGelee(sim, 12, 12)).toBe(true)
    delete sim.meteo // la bande est passée
    expect(floreGelee(sim, 12, 12)).toBe(false)
  })
})

describe('A9/A10 — le potager : on ne sème pas une terre gelée, et le gel tue le plein air', () => {
  /** Un Chef, son Feu, et une pièce de ferme de chaque palier à portée. */
  function withFerme(sim: SimState): { id: number; parcelle: number; serre: number; terroir: number } {
    const id = spawnEntity(sim, 12.5, 12.5)
    grantItems(sim, id, { wood: 10 })
    act(sim, id, { type: 'light_fire' })
    const v = getVillageOf(sim, id)!.id
    const parcelle = addStructure(sim, 'parcelle', 13, 12, v, id).id
    const serre = addStructure(sim, 'serre', 13, 13, v, id).id
    const terroir = addStructure(sim, 'terroir', 12, 13, v, id).id
    drainEvents(sim)
    return { id, parcelle, serre, terroir }
  }
  const st = (sim: SimState, sid: number): Structure => sim.structures.find((s) => s.id === sid)!

  it('A9 — gelé : la parcelle refuse, la serre et le terroir sèment ; au chaud, les trois sèment', () => {
    const sim = makeSim()
    sim.tick = 50 * TICKS_PER_CYCLE // acte III : la vallée est gelée
    const { id, parcelle, serre, terroir } = withFerme(sim)
    expect(floreGelee(sim, 13, 12)).toBe(true)

    grantItems(sim, id, { graine: 3 })
    act(sim, id, { type: 'plant', structureId: parcelle })
    expect(rejections(sim)).toContain('la terre est gelée — il faut une serre')
    expect(st(sim, parcelle).plantedAt).toBeUndefined()
    act(sim, id, { type: 'plant', structureId: serre })
    act(sim, id, { type: 'plant', structureId: terroir })
    expect(typeof st(sim, serre).plantedAt).toBe('number')
    expect(typeof st(sim, terroir).plantedAt).toBe('number')

    // Au chaud (acte I de jour), la parcelle sème comme les autres.
    const doux = makeSim()
    doux.tick = 5 * TICKS_PER_CYCLE
    const ferme = withFerme(doux)
    expect(floreGelee(doux, 13, 12)).toBe(false)
    grantItems(doux, ferme.id, { graine: 1 })
    act(doux, ferme.id, { type: 'plant', structureId: ferme.parcelle })
    expect(typeof st(doux, ferme.parcelle).plantedAt).toBe('number')
  })

  it('A10 — sous le gel MORTEL, la parcelle perd sa culture et émet `crop_frozen` ; serre et terroir tiennent', () => {
    const sim = makeSim()
    sim.tick = 50 * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE + 10 // acte III, de NUIT : 10 < 22
    const { parcelle, serre, terroir } = withFerme(sim)
    expect(gelMortel(sim, 13, 12)).toBe(true)
    // On sème « à la main » : le semis lui-même est refusé sur la parcelle (A9), or ce qu'on
    // teste ici est le SORT d'une culture DÉJÀ en terre — celle qu'on a mise avant l'hiver.
    for (const sid of [parcelle, serre, terroir]) st(sim, sid).plantedAt = sim.tick - 10
    drainEvents(sim)

    step(sim, [])
    expect(st(sim, parcelle).plantedAt).toBeUndefined() // la graine est perdue
    expect(typeof st(sim, serre).plantedAt).toBe('number') // hivernale par son TYPE
    expect(typeof st(sim, terroir).plantedAt).toBe('number')
    const gelees = drainEvents(sim).filter((e) => e.type === 'crop_frozen')
    expect(gelees).toHaveLength(1)
    expect(gelees[0]).toMatchObject({ type: 'crop_frozen', structureId: parcelle })
  })

  it('A10ter — LE CHEMIN RÉEL : semé légalement en acte II, un blizzard tue la récolte', () => {
    // Les deux tests précédents posent `plantedAt` à la main — ils mesurent la RÈGLE, pas sa
    // joignabilité. Celui-ci ne touche à rien : on sème par l'action `plant` là où la sim
    // l'autorise (acte II, de jour, 65), puis on laisse venir le seul événement qui tue à
    // cette heure-là — le blizzard (65 − 55 = 10, sous les 22 du gel mortel). C'est le
    // scénario que la spec promet au joueur : « bâtir des serres AVANT l'hiver ».
    const sim = createSim(7, {
      map: createEmptyMap(40, 40, TERRAIN_GRASS),
      calendarScale: FAST,
      meteoActive: true,
    })
    const debut = 30 * TICKS_PER_CYCLE + 10 // acte II, de JOUR
    sim.tick = debut
    const { id, parcelle } = withFerme(sim)
    grantItems(sim, id, { graine: 1 })
    act(sim, id, { type: 'plant', structureId: parcelle })
    expect(rejections(sim)).not.toContain('la terre est gelée — il faut une serre')
    expect(typeof st(sim, parcelle).plantedAt).toBe('number') // semée pour de vrai

    // Le blizzard traverse. On cherche (sans stepper : c'est pur) le tick où sa bande couvre
    // la parcelle, pour ne pas jouer une demi-journée de sim dans un test unitaire.
    sim.meteo = {
      type: 'blizzard',
      cycle: Math.floor(debut / TICKS_PER_CYCLE),
      day: getGameTime(sim).seasonDay,
      edge: 0,
      startTick: debut,
      endTick: debut + TICKS_PER_CYCLE,
    }
    let passage = -1
    for (let t = sim.tick; t < 30 * TICKS_PER_CYCLE + DAY_TICKS_PER_CYCLE - 5; t++) {
      if (climatFlore(sim, 13, 12, t) < FLORE.SEUIL_MORTEL) {
        passage = t
        break
      }
    }
    expect(passage).toBeGreaterThan(-1)
    sim.tick = passage - 1
    expect(getGameTime(sim).isNight).toBe(false) // c'est le blizzard qui tue, pas la nuit
    expect(typeof st(sim, parcelle).plantedAt).toBe('number') // encore vivante au tick d'avant
    drainEvents(sim)

    step(sim, [])
    expect(st(sim, parcelle).plantedAt).toBeUndefined()
    expect(drainEvents(sim).filter((e) => e.type === 'crop_frozen')).toHaveLength(1)
  })

  it('A10bis — le gel simple ne tue PAS : une parcelle gelée de jour en acte III garde sa culture', () => {
    const sim = makeSim()
    sim.tick = 50 * TICKS_PER_CYCLE + 10 // acte III, de JOUR : 40 — gelé (< 52), pas mortel (> 22)
    const { parcelle } = withFerme(sim)
    expect(floreGelee(sim, 13, 12)).toBe(true)
    expect(gelMortel(sim, 13, 12)).toBe(false)
    st(sim, parcelle).plantedAt = sim.tick - 10
    for (let i = 0; i < 50; i++) step(sim, [])
    expect(typeof st(sim, parcelle).plantedAt).toBe('number')
  })
})

describe('les seuils tiennent leurs promesses', () => {
  it('aucun seuil ne tombe sur une valeur atteinte hors front (elles sont toutes multiples de 5)', () => {
    for (const seuil of [FLORE.SEUIL_GEL, FLORE.SEUIL_MORTEL]) expect(seuil % 5).not.toBe(0)
  })

  it('le seuil mortel est juste au-dessus de l’hypothermie humaine : la culture meurt où l’homme meurt', () => {
    expect(FLORE.SEUIL_MORTEL).toBeGreaterThan(TEMPERATURE.HYPOTHERMIA)
    expect(FLORE.SEUIL_MORTEL - TEMPERATURE.HYPOTHERMIA).toBeLessThan(5)
    expect(FLORE.SEUIL_MORTEL).toBeLessThan(FLORE.SEUIL_GEL) // suspendre AVANT de tuer
  })

  it('F7 — le froid ne mord que sur ce qui vit : six nœuds vivants, aucun minéral', () => {
    const vivants = (Object.keys(NODE_DEFS) as NodeType[]).filter((t) => NODE_DEFS[t].vivant)
    expect(vivants.sort()).toEqual(['berry_bush', 'champignon', 'fiber_plant', 'leaf_pile', 'old_tree', 'tree'])
    // Et le gel du RENDEMENT ne vise que les GÉLIFS — ce que la plante produit frais.
    // L'arbre garde son bois, et la fibre (tiges sèches) se ramasse encore : les deux
    // exclusions sont la même règle — le froid ne ferme pas ce qui permet d'y survivre.
    const gelifs = (Object.keys(NODE_DEFS) as NodeType[]).filter((t) => NODE_DEFS[t].gelif)
    expect(gelifs.sort()).toEqual(['berry_bush', 'champignon', 'leaf_pile'])
    for (const t of gelifs) expect(NODE_DEFS[t].vivant).toBe(true) // sous-ensemble strict de `vivant`
    expect(NODE_DEFS.fiber_plant.vivant).toBe(true) // elle VIT (sa repousse gèle)…
    expect(NODE_DEFS.fiber_plant.gelif).toBeUndefined() // …mais son rendement, non
  })
})

describe('LE PNJ NE RESTE PAS COLLÉ À UN BUISSON GELÉ (régression)', () => {
  /**
   * LE DÉFAUT QUE CE TEST GARDE, et il a failli passer.
   *
   * `applyEconomyAction` refuse (« la plante est gelée »), mais le PNJ ne le SAIT pas : le
   * nœud a encore du stock, donc il ne cherche pas ailleurs, et sa corvée n'est pas relâchée.
   * Il repart pour un tour, indéfiniment — **planté devant le buisson**. Une nuit d'acte II
   * c'est une nuit perdue ; en acte III, où plus rien ne dégèle, c'est pour toujours : il ne
   * mange plus et ne DESCEND JAMAIS jusqu'au bois qu'il pourrait couper. C'est la famine que
   * `npc.ts` avait déjà épinglée pour « aucun nœud de ce type », par une autre porte.
   *
   * On l'isole en gelant LE LIEU plutôt que la saison : les buissons sont posés sur la NEIGE
   * (biome −40 → climat 50 en acte I de jour, sous les 52 du gel), le reste de la carte est
   * de l'herbe à 90. Aucune pression de froid sur le PNJ, aucune famine de saison — le seul
   * fait mesuré est le gel du buisson.
   */
  function villageDevantDesBuissonsGeles(): SimState {
    const map = createEmptyMap(28, 28, TERRAIN_GRASS)
    for (const [tx, ty] of [[18, 12], [19, 14]]) map.terrain[ty! * 28 + tx!] = TERRAIN_SNOW
    const nodes: ResourceNode[] = [
      { id: 1, type: 'berry_bush', tx: 18, ty: 12, stock: 8, regrowAt: 0 },
      { id: 2, type: 'berry_bush', tx: 19, ty: 14, stock: 8, regrowAt: 0 },
      { id: 3, type: 'tree', tx: 10, ty: 12, stock: 10, regrowAt: 0 },
    ]
    const sim = createSim(11, { map, nodes, worldEvents: false })
    foundNpcVillage(sim, 12, 12, 1)
    sim.structures.find((st) => st.type === 'chest')!.inventory = makeInventory(SLOTS.CHEST)
    return sim
  }

  it('les buissons gelés, il DESCEND jusqu’au bois — au lieu d’attendre devant', () => {
    const sim = villageDevantDesBuissonsGeles()
    expect(floreGelee(sim, 18, 12)).toBe(true) // le buisson gèle…
    expect(floreGelee(sim, 10, 12)).toBe(false) // …l'arbre, non : la carte est tiède

    for (let t = 0; t < BALANCE.BOARD_REFRESH_TICKS * 3; t++) step(sim, [])

    const grenier = sim.structures.find((st) => st.type === 'chest')!.inventory ?? []
    const porte = sim.entities.find((e) => e.id === sim.npcs[0]!.entityId)!
    // Il a fait la corvée qu'il POUVAIT faire. Collé au buisson, ce compte resterait à zéro.
    expect(countOf(grenier, 'wood') + countOf(porte.inventory, 'wood')).toBeGreaterThan(0)
    expect(countOf(porte.inventory, 'berries')).toBe(0) // et il n'a rien tiré du gel
    expect(sim.nodes[0]!.stock).toBe(8) // le buisson est intact : personne ne l'a entamé
  })

  it('et il cueille normalement dès que le buisson dégèle (le gel seul le retenait)', () => {
    const sim = villageDevantDesBuissonsGeles()
    for (const [tx, ty] of [[18, 12], [19, 14]]) sim.map.terrain[ty! * 28 + tx!] = TERRAIN_GRASS
    expect(floreGelee(sim, 18, 12)).toBe(false)
    for (let t = 0; t < BALANCE.BOARD_REFRESH_TICKS * 3; t++) step(sim, [])
    expect(sim.nodes[0]!.stock + sim.nodes[1]!.stock).toBeLessThan(16) // entamés
  })
})
