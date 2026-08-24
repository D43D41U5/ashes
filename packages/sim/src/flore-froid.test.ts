import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  FLORE,
  METEO,
  NODE_DEFS,
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
import { fenetreDe, frontDuCycle, meteoIntensityAt } from './meteo'
import { modificateurDuJour } from './modificateur'
import { AMBIANT_HYPOTHERMIE, baselineTemperatureAt, climatFlore, dehorsSansMeteo } from './temperature'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { addStructure, getVillageOf, grantItems, type Structure } from './village'
import { cycleOffsetForStartHour, dayTicksPourJour, getGameTime, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, YEAR_DAYS } from './time'
import type { ResourceNode } from './economy'

/** 1 cycle jour/nuit = 1 jour de saison : une saison de 30 jours tient en 30 cycles. */
const FAST = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE

function makeSim(terrain = TERRAIN_GRASS, nodes: ResourceNode[] = []): SimState {
  return createSim(7, { map: createEmptyMap(40, 40, terrain), calendarScale: FAST, nodes })
}

/**
 * LE CŒUR D'UNE SAISON, en jour de l'année — les quatre CARDINAUX de la courbe du socle
 * (spec `saisons.md` S4) : mi-Éclosion 15, mi-Ardeur 45, mi-Pluies 75, mi-Grand Froid 105.
 * Dérivé d'`ACT_DAYS`, jamais écrit : la cadence a déjà changé une fois (21 → 30).
 */
function coeurDe(phase: number): number {
  return (phase - 1) * BALANCE.ACT_DAYS + Math.round(BALANCE.ACT_DAYS / 2)
}
/** 45 — le plus doux de l'année : +26 °C le jour, +20 la nuit. Rien n'y gèle, nulle part. */
const MI_ARDEUR = coeurDe(2)
/** 75 — la saison qui BASCULE dans la journée : +8 °C à midi, −2 la nuit. */
const MI_PLUIES = coeurDe(3)
/** 105 — la vallée est prise : −2 °C à midi (gelé), −16 la nuit (mortel). */
const MI_GRAND_FROID = coeurDe(4)
/**
 * LE JOUR OÙ LA GÉOGRAPHIE SEULE DÉCIDE — le cinquième jour des Pluies. La vallée y est
 * encore tiède à toute heure (+14 °C à midi, +5,3 la nuit : rien n'y gèle) et le Névé, seize
 * degrés plus bas, est déjà pris (−2 / −10,7). C'est le seul régime qui isole le LIEU de la
 * SAISON — et les Pluies de l'an 1 ne tirent aucun caractère (S18), donc rien ne le décale.
 */
const JOUR_TIEDE = 2 * BALANCE.ACT_DAYS + 5

/**
 * Le tick de MIDI (ou d'une heure de nuit) du jour de saison `jour` — `FAST` couple 1 cycle
 * = 1 jour et les montages ouvrent au jour 1, donc le cycle `jour − 1` EST ce jour-là.
 *
 * LE JOUR, C'EST MIDI et non l'aube : depuis la rampe de nuit (`partDeNuit`), le tick 0 d'un
 * cycle porte encore le plein écart nocturne — un « de jour » posé là mesurerait la nuit.
 * Et la longueur du jour est SAISONNIÈRE (S6) : midi se dérive du jour, sans quoi un « midi »
 * constant tomberait après le crépuscule au cœur du Grand Froid.
 */
function auJour(jour: number, nuit = false): number {
  const dayTicks = dayTicksPourJour(jour)
  return (jour - 1) * TICKS_PER_CYCLE + (nuit ? dayTicks + 10 : Math.round(dayTicks / 2))
}
function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}
function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

/**
 * LE TICK OÙ LE MONDE EST JUSTE AU-DESSUS D'UN SEUIL — celui où un front FAIT BASCULER la
 * flore, et le seul qui prouve quelque chose. Depuis R11-R12, le froid d'un front dépend du
 * froid qu'il trouve : on ne choisit donc plus « un blizzard », on cherche le RÉGIME où la
 * marge existe (`marge` = ce que le front peut retrancher). Cherché à ciel CLAIR, sans
 * front : c'est `T₀`, l'entrée de la loi.
 */
function tickJusteAuDessus(sim: SimState, seuil: number, marge: number): number {
  for (let t = 0; t < 80 * TICKS_PER_CYCLE; t += 200) {
    const c = climatFlore(sim, 12, 12, t)
    if (c >= seuil && c < seuil + marge) return t
  }
  throw new Error(`aucun tick où le climat tient dans [${seuil}, ${seuil + marge}) — recalibrer`)
}


describe('les ancres de saison de ce fichier', () => {
  it('LA PRÉMISSE — aucun caractère ne décale les jours sur lesquels tout ce fichier est calé', () => {
    // UNE GARDE PROUVE SA PRÉMISSE. Tous les régimes mesurés ici (les +14 °C du jour tiède,
    // les −2 °C de la nuit des Pluies) supposent une saison ORDINAIRE. Or S18 tire un
    // caractère par saison, et celui des Pluies — l'Été indien — décale la lecture du socle
    // de quinze jours : sous lui, `JOUR_TIEDE` lirait le jour 50 (+23 °C, le Névé ne gèle
    // plus) et `MI_PLUIES` le jour 60 (+9 la nuit, plus rien ne fige). Les tests tomberaient
    // alors sur « la neige ne gèle pas », sans dire pourquoi. Ici, ils disent pourquoi.
    for (const jour of [MI_ARDEUR, MI_PLUIES, MI_GRAND_FROID, JOUR_TIEDE]) {
      expect(modificateurDuJour(jour)).toBeNull()
    }
  })
})

describe('A1 — le climat de la flore EST le froid du monde, l’abri en moins', () => {
  it('rend `baselineTemperatureAt` au bit près sur toute tuile non abritée, à tout tick', () => {
    // GARDE EXHAUSTIVE (pas des points choisis) : chaque terrain du registre × un balayage
    // de la saison ET du cycle. Une seule propriété affirmée — l'égalité bit à bit.
    const sim = makeSim()
    const terrains = Object.keys(TERRAINS).map(Number)
    for (const t of terrains) {
      sim.map.terrain[12 * 40 + 12] = t
      // L'ANNÉE ENTIÈRE, depuis qu'elle boucle (S1) : les 120 jours, pas les 60 d'une saison.
      for (let jour = 1; jour <= YEAR_DAYS; jour += 7) {
        for (const nuit of [false, true]) {
          const tick = auJour(jour, nuit)
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

  it('A2 — au cœur du Grand Froid, un buisson à échéance reste vide, et AUCUN nœud ne disparaît', () => {
    const depart = auJour(MI_GRAND_FROID)
    const sim = makeSim(TERRAIN_GRASS, [noeudAEcheance('berry_bush', depart)])
    sim.tick = depart
    // Le Grand Froid de l'AN 1 : le tour autant que la phase — `act` seul vaut 4 dans les
    // deux cas et ne dirait pas lequel des deux a bougé si la cadence changeait encore.
    expect(getGameTime(sim).tour).toBe(1)
    expect(getGameTime(sim).phase).toBe(4)
    expect(floreGelee(sim, 12, 12)).toBe(true)
    for (let i = 0; i < 100; i++) step(sim, [])
    expect(sim.nodes).toHaveLength(1) // F6 — rien ne sort de la carte
    expect(sim.nodes[0]!.stock).toBe(0)
    expect(sim.nodes[0]!.regrowAt).toBe(depart - 1) // la date NE GLISSE PAS
  })

  it('A3 — et il se remplit au tick où le climat repasse au-dessus du seuil', () => {
    // LES PLUIES SONT LA SAISON QUI BASCULE DANS LA JOURNÉE : on part gelé (la nuit y tombe à
    // −2 °C), on laisse venir l'aube, et le climat remonte à +8 — au-dessus du seuil. C'est
    // le seul endroit de l'année où « cueille de jour » est une règle et non une fatalité.
    const nuit = auJour(MI_PLUIES, true)
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

  it('A6 — un filon de fer repousse à sa date au cœur du Grand Froid, de nuit : le minéral n’a pas de saison', () => {
    const nuit = auJour(MI_GRAND_FROID, true)
    const sim = makeSim(TERRAIN_GRASS, [noeudAEcheance('iron_vein', nuit)])
    sim.tick = nuit
    expect(NODE_DEFS.iron_vein.vivant).toBeUndefined()
    expect(floreGelee(sim, 12, 12)).toBe(true) // la tuile gèle…
    step(sim, [])
    expect(sim.nodes[0]!.stock).toBe(NODE_DEFS.iron_vein.stock) // …et le filon s'en moque
  })

  it('le gel ne DESSINE aucun tirage : le flux RNG est le même avec et sans nœud gelé', () => {
    const depart = auJour(MI_GRAND_FROID)
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

describe('A4 — l’ARDEUR reste entièrement libre, nuit comprise', () => {
  it('sur herbe, forêt et marais, à toute heure des trente jours de l’Ardeur, rien ne gèle', () => {
    // LA SAISON LIBRE A CHANGÉ DE NOM ET DE PLACE (spec `saisons.md` S4) : ce n'est plus
    // l'ouverture du monde mais l'ÉTÉ. « L'Éclosion s'ouvre encore gelée » est le contenu
    // même du printemps — le dégel — et ses nuits tombent à −8,5 °C. La promesse « rien ne
    // gèle, nuit comprise » se tient donc à l'Ardeur, et sur ses trente jours entiers : le
    // point le plus froid mesuré est le marais à l'aube du dernier jour (+7 °C).
    for (const terrain of [TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_MARSH]) {
      const sim = makeSim(terrain)
      for (let jour = BALANCE.ACT_DAYS + 1; jour <= 2 * BALANCE.ACT_DAYS; jour++) {
        for (let h = 0; h < TICKS_PER_CYCLE; h += TICKS_PER_CYCLE / 24) {
          const tick = (jour - 1) * TICKS_PER_CYCLE + h
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
    const tick = auJour(MI_GRAND_FROID)
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

  it('A7 — au MÊME tick d’un jour tiède, la neige gèle et l’herbe non', () => {
    const sim = makeSim(TERRAIN_GRASS)
    sim.map.terrain[12 * 40 + 12] = TERRAIN_SNOW
    sim.tick = auJour(JOUR_TIEDE)
    expect(getGameTime(sim).phase).toBe(3) // le début des Pluies : la vallée n'a pas encore pris
    expect(floreGelee(sim, 12, 12)).toBe(true) // le Névé, seize degrés plus bas, est déjà stérile
    expect(floreGelee(sim, 20, 20)).toBe(false) // l'herbe d'à côté, non
  })

  it('A8 — le front fige son sillage, et le relâche une fois passé', () => {
    const sim = createSim(7, {
      map: createEmptyMap(40, 40, TERRAIN_GRASS),
      calendarScale: FAST,
      meteoActive: true,
    })
    // On CHERCHE le régime où une pluie bascule la flore : le monde au-dessus du seuil (rien
    // ne gèle) et à moins de `COLD.pluie` au-dessus (la pluie l'y fait passer). Depuis que
    // « l'Éclosion s'ouvre encore gelée » (S4), c'est le MATIN DU PREMIER JOUR : la plaine
    // repasse tout juste le seuil au sortir de la nuit — +3,3 °C à ciel clair, −0,7 sous
    // l'averse. Le dégel du printemps se paie front par front.
    const debut = tickJusteAuDessus(sim, FLORE.SEUIL_GEL, METEO.COLD.pluie)
    sim.tick = debut
    expect(floreGelee(sim, 12, 12)).toBe(false) // à ciel clair, rien ne gèle À CE TICK MÊME

    // La bande TRAVERSE : elle n'est pas encore sur (12,12) au tick où elle est élue. On
    // cherche le moment où elle y passe, SANS bouger l'horloge du régime trouvé — la fenêtre
    // est donc CENTRÉE sur `debut`, et c'est bien le front qu'on mesure, pas l'heure.
    // ⚠ LA FENÊTRE SE LIT PAR `fenetreDe`, JAMAIS DANS LA TABLE (S7) : elle est SAISONNIÈRE
    // depuis la refonte (un demi-cycle ici, le cycle entier aux Pluies), et un front fabriqué
    // sur l'ancienne constante ne serait plus la géométrie d'aucun front réel.
    const day = getGameTime(sim).seasonDay
    const fenetre = fenetreDe({ type: 'pluie', day })
    sim.meteo = {
      type: 'pluie',
      cycle: Math.floor(debut / TICKS_PER_CYCLE),
      day,
      edge: 0,
      startTick: debut - Math.floor(fenetre / 2),
      endTick: debut - Math.floor(fenetre / 2) + fenetre,
    }
    expect(meteoIntensityAt(sim.meteo, debut, sim.map.width, sim.map.height, 12, 12)).toBeGreaterThan(0)
    expect(climatFlore(sim, 12, 12, debut)).toBeLessThan(FLORE.SEUIL_GEL) // le front a mordu
    expect(floreGelee(sim, 12, 12)).toBe(true)
    delete sim.meteo // la bande est passée
    expect(floreGelee(sim, 12, 12)).toBe(false) // …et le point est RENDU, au même tick
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
    sim.tick = auJour(MI_GRAND_FROID) // le cœur de l'hiver : la vallée est gelée, même à midi
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

    // Au chaud (midi de l'Ardeur, +26 °C), la parcelle sème comme les autres — avec LA GRAINE
    // DE LA SAISON : depuis S16 chaque culture a sa fenêtre, et le plein air ne l'ouvre qu'à
    // sa phase. Le fruit est celle de l'Ardeur ; la `graine` d'hier est devenue la culture
    // d'hiver, celle qu'on ne sème que sous verre.
    const doux = makeSim()
    doux.tick = auJour(MI_ARDEUR)
    const ferme = withFerme(doux)
    expect(floreGelee(doux, 13, 12)).toBe(false)
    grantItems(doux, ferme.id, { graine_fruit: 1 })
    act(doux, ferme.id, { type: 'plant', structureId: ferme.parcelle })
    expect(typeof st(doux, ferme.parcelle).plantedAt).toBe('number')
  })

  it('A10 — sous le gel MORTEL, la parcelle perd sa culture et émet `crop_frozen` ; serre et terroir tiennent', () => {
    const sim = makeSim()
    sim.tick = auJour(MI_GRAND_FROID, true) // nuit du cœur de l'hiver : −16 °C, sous SEUIL_MORTEL
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

  it('A10ter — LE CHEMIN RÉEL : semé légalement à l’Ardeur, un orage de saison froide tue la récolte', () => {
    // Les deux tests précédents posent `plantedAt` à la main — ils mesurent la RÈGLE, pas sa
    // joignabilité. Celui-ci ne touche à rien : on sème par l'action `plant` là où la sim
    // l'autorise (midi de l'Ardeur, +26 °C), puis on laisse venir ce qui tue.
    //
    // CE QUI A CHANGÉ AVEC R12 : un front ne mord de `ORAGE_FROID.COLD` que là où le monde est
    // DÉJÀ sous la limite de neige (0 °C) — or on ne sème qu'au-dessus de `SEUIL_GEL` (+2,8 °C).
    // **Aucun front ne peut donc tuer une culture par un temps semable** : la marge n'existe
    // pas. Ce qui tue, c'est la saison qui tourne (S1) — l'année avance jusqu'à un ciel où le
    // monde à découvert épargne encore la culture et où l'orage, lui, l'emporte. C'est très
    // exactement le scénario que la spec promet — « bâtir des serres AVANT l'hiver ».
    const sim = createSim(7, {
      map: createEmptyMap(40, 40, TERRAIN_GRASS),
      calendarScale: FAST,
      meteoActive: true,
      finDeSaison: null, // l'année tourne : la recherche du ciel qui tue traverse les saisons
    })
    const jour = auJour(MI_ARDEUR) // le plein été : la fenêtre du fruit est ouverte (S16)
    sim.tick = jour
    const { id, parcelle } = withFerme(sim)
    grantItems(sim, id, { graine_fruit: 1 })
    act(sim, id, { type: 'plant', structureId: parcelle })
    expect(rejections(sim)).not.toContain('la terre est gelée — il faut une serre')
    expect(typeof st(sim, parcelle).plantedAt).toBe('number') // semée pour de vrai

    // L'ORAGE QU'ON CHERCHE EST UN VRAI — celui que le CYCLE élit, pas un front fabriqué.
    // Un front posé à la main est ÉCRASÉ par `advanceMeteo` au tick suivant (il réélit le front
    // du cycle) : le montage d'avant ne tenait que parce que le tick tiré tombait, par chance,
    // dans un cycle d'orage. On cherche donc le premier orage du calendrier dont le milieu de
    // fenêtre laisse encore vivre la culture À CIEL CLAIR — le ciel seul ne doit pas tuer,
    // sinon ce n'est pas l'orage qu'on mesure. (Mesuré : c'est un orage de MIDI, en plein
    // Grand Froid. Les nuits d'hiver, elles, tuent toutes seules — elles sont donc écartées,
    // et le tick retenu n'est plus « la nuit venue » comme sous l'ancienne table d'actes.)
    let letal = -1
    for (let c = 0; c < 400 && letal < 0; c++) {
      const f = frontDuCycle(c, FAST, sim.jourDeDepart)
      if (!f || f.type !== 'orage') continue
      const t = Math.floor((f.startTick + f.endTick) / 2)
      if (t <= jour) continue
      if (dehorsSansMeteo(sim, 13, 12, t) < FLORE.SEUIL_MORTEL) continue // le ciel clair tue déjà
      sim.tick = t
      sim.meteo = f
      if (climatFlore(sim, 13, 12, t) < FLORE.SEUIL_MORTEL) letal = t
    }
    expect(letal, 'aucun orage du calendrier ne bascule une culture que le ciel clair épargne').toBeGreaterThan(jour)
    expect(dehorsSansMeteo(sim, 13, 12, letal)).toBeGreaterThanOrEqual(FLORE.SEUIL_MORTEL) // le ciel clair ne tue pas
    expect(climatFlore(sim, 13, 12, letal)).toBeLessThan(FLORE.SEUIL_MORTEL) // c'est l'orage qui tue
    expect(typeof st(sim, parcelle).plantedAt).toBe('number') // encore vivante avant le tick joué
    drainEvents(sim)

    step(sim, [])
    expect(st(sim, parcelle).plantedAt).toBeUndefined()
    expect(drainEvents(sim).filter((e) => e.type === 'crop_frozen')).toHaveLength(1)
  })

  it('A10bis — le gel simple ne tue PAS : une parcelle gelée de jour au Grand Froid garde sa culture', () => {
    const sim = makeSim()
    sim.tick = auJour(MI_GRAND_FROID) // midi du cœur de l'hiver : −2 °C — gelé (< 2,8), pas mortel (> −9,2)
    const { parcelle } = withFerme(sim)
    expect(floreGelee(sim, 13, 12)).toBe(true)
    expect(gelMortel(sim, 13, 12)).toBe(false)
    st(sim, parcelle).plantedAt = sim.tick - 10
    for (let i = 0; i < 50; i++) step(sim, [])
    expect(typeof st(sim, parcelle).plantedAt).toBe('number')
  })
})

describe('les seuils tiennent leurs promesses', () => {
  /** La marge, en degrés, qu'un verdict de saison doit garder au seuil. Quatre : de quoi
   *  encaisser un biome de vallée entier, donc bien plus qu'un bit de flottant. */
  const MARGE = 4

  it('A4 — le seuil se garde en MOMENT de l’année, jamais en valeur : l’Ardeur est libre, le Grand Froid est pris', () => {
    // LA VIEILLE GARDE EST MORTE AVEC SA PRÉMISSE. Elle disait « aucun seuil ne tombe sur une
    // valeur atteinte hors front (elles sont toutes multiples de 5) » : c'était vrai d'une
    // TABLE par acte (`ACT_COLD`, quatre valeurs). Depuis S4 le socle est une COURBE, et une
    // courbe continue atteint TOUTES les valeurs de son domaine — la spec le dit à la lettre
    // (A4) : « la garde doit se réénoncer en “à quel MOMENT de l'année”, jamais en “à quelle
    // valeur” ». Ce qui se garde, c'est donc que les deux verdicts de saison tombent LOIN du
    // seuil, de jour comme de nuit : ils ne se jouent pas au bit près.
    const sim = makeSim()
    for (const nuit of [false, true]) {
      expect(climatFlore(sim, 12, 12, auJour(MI_ARDEUR, nuit))).toBeGreaterThan(FLORE.SEUIL_GEL + MARGE)
      expect(climatFlore(sim, 12, 12, auJour(MI_GRAND_FROID, nuit))).toBeLessThan(FLORE.SEUIL_GEL - MARGE)
    }
  })

  it('le seuil mortel est juste au-dessus de l’hypothermie humaine : la culture meurt où l’homme meurt', () => {
    // Les DEUX sont des seuils d'AIR (la culture et l'homme subissent le même froid) : le
    // repère est `AMBIANT_HYPOTHERMIE`, l'air où un corps nu se stabilise à l'hypothermie.
    expect(FLORE.SEUIL_MORTEL).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
    expect(FLORE.SEUIL_MORTEL - AMBIANT_HYPOTHERMIE).toBeLessThan(2)
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
   * On l'isole en gelant LE LIEU plutôt que la saison : le monde ouvre à `JOUR_TIEDE`, à midi
   * — la vallée y est à +14 °C (rien n'y gèle) et les buissons, posés sur la NEIGE (seize
   * degrés de moins), sont à −2 °C, sous le seuil. Aucune pression de froid sur le PNJ,
   * aucune famine de saison — le seul fait mesuré est le gel du buisson.
   */
  function villageDevantDesBuissonsGeles(): SimState {
    const map = createEmptyMap(28, 28, TERRAIN_GRASS)
    for (const [tx, ty] of [[18, 12], [19, 14]]) map.terrain[ty! * 28 + tx!] = TERRAIN_SNOW
    const nodes: ResourceNode[] = [
      { id: 1, type: 'berry_bush', tx: 18, ty: 12, stock: 8, regrowAt: 0 },
      { id: 2, type: 'berry_bush', tx: 19, ty: 14, stock: 8, regrowAt: 0 },
      { id: 3, type: 'tree', tx: 10, ty: 12, stock: 10, regrowAt: 0 },
    ]
    // Le calendrier n'est PAS accéléré ici (échelle 1) : le jour ne bouge pas de la mesure,
    // et `cycleOffset` pose le tick 0 à midi — le tick 0 nu porte encore le plein froid de la
    // nuit (`partDeNuit`), et le montage mesurerait alors une aube, pas un jour tiède.
    const sim = createSim(11, {
      map,
      nodes,
      worldEvents: false,
      jourDeDepart: JOUR_TIEDE,
      cycleOffset: cycleOffsetForStartHour(12),
    })
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
