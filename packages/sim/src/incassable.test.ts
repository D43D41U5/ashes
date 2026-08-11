/**
 * L'INCASSABLE EST DU MONDE AU SENS FORT (décision d'Alexis, 2026-08-11 — spec
 * lieux-batis, étage 2 révisé et critère C6).
 *
 * Le massif d'un antre est de la ROCHE portée par une structure : la même loi que la
 * falaise, en quatre lectures — les dégâts sont inertes, le siège ne le désigne jamais
 * (la bête re-route au lieu de mâcher), le flow field le contourne comme le terrain,
 * et la joignabilité des spawns le disqualifie (« la roche disqualifie, le mur non »).
 * Les quatre se dérivent d'UNE table (`INCASSABLE_TYPES`, registre `pieces.ts`) — ces
 * gardes prouvent chaque lecture contre le vrai moteur, jamais contre une copie.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS } from './balance'
import { createEmptyMap } from './map'
import { siteDansLaCouronne } from './morts'
import { deserializeSim, serializeSim } from './persistence'
import { createSim } from './sim'
import { addStructure, applyStructureDamage, structureBlocks, type Structure } from './village'
import { attackBlockingStructure, spawnMonster } from './monsters'
import { computeFlowField, solidesEternels } from './pathfinding'
import { estIncassable, INCASSABLE_TYPES } from './pieces'

const monde = () => createSim(7, { map: createEmptyMap(24, 24, TERRAIN_GRASS) })

describe("l'incassable (C6)", () => {
  it('le registre dérive la table : massif en fait partie, wall jamais', () => {
    expect(estIncassable('massif')).toBe(true)
    expect(estIncassable('wall')).toBe(false)
    expect(INCASSABLE_TYPES.size).toBeGreaterThan(0)
  })

  it('les dégâts sont INERTES : mille coups ne l’entament pas, le mur témoin tombe', () => {
    const sim = monde()
    const massif = addStructure(sim, 'massif', 10, 10, 0, 0, 'public')
    const mur = addStructure(sim, 'wall', 12, 10, 0, 0, 'public')
    const pv = massif.hp
    for (let i = 0; i < 1000; i++) applyStructureDamage(sim, massif.id, 999)
    expect(massif.hp, 'la roche ne s’entame pas').toBe(pv)
    expect(sim.structures.some((s) => s.id === massif.id), 'la roche ne disparaît jamais').toBe(true)
    // Le TÉMOIN : la même porte de dégâts détruit bien un mur — la garde ne s'est pas
    // trompée de fonction, c'est l'incassable qui est protégé, pas tout le monde.
    applyStructureDamage(sim, mur.id, 99999)
    expect(sim.structures.some((s) => s.id === mur.id)).toBe(false)
  })

  it('le siège ne le DÉSIGNE jamais : bloqué par un massif la bête ne lève aucun coup, par un mur si', () => {
    const sim = monde()
    // Le massif à l'EST du monstre, sur la tuile qu'il veut franchir.
    addStructure(sim, 'massif', 11, 10, 0, 0, 'public')
    const id = spawnMonster(sim, 'cendreux', 10.5, 10.5)
    const entity = sim.entities.find((e) => e.id === id)!
    const monster = sim.monsters.find((m) => m.entityId === id)!
    attackBlockingStructure(sim, monster, entity, 13, 10)
    expect(entity.windup, 'aucun wind-up sur la roche — on ne mâche pas l’éternité').toBeUndefined()
    // Le TÉMOIN : un MUR pleine-arête au même endroit se fait bien désigner.
    const sim2 = monde()
    const mur = addStructure(sim2, 'wall', 11, 10, 0, 0, 'public')
    mur.edges = 8 // arête OUEST : elle barre le franchissement (10,10) → (11,10)
    const id2 = spawnMonster(sim2, 'cendreux', 10.5, 10.5)
    const entity2 = sim2.entities.find((e) => e.id === id2)!
    const monster2 = sim2.monsters.find((m) => m.entityId === id2)!
    attackBlockingStructure(sim2, monster2, entity2, 13, 10)
    expect(entity2.windup?.structureId, 'le témoin : le mur, lui, se frappe').toBe(mur.id)
  })

  it('le flow field le CONTOURNE comme la falaise — et traverse le bâti', () => {
    const sim = monde()
    // Une ligne de massif en travers (x=4..19, y=12) : presque tout le travers de la carte,
    // une seule ouverture à l'ouest (x≤3). Un mur du bâti à la même géométrie, lui, est
    // ignoré par le gradient (le siège naturel).
    for (let x = 4; x < 20; x++) addStructure(sim, 'massif', x, 12, 0, 0, 'public')
    const solides = solidesEternels(sim.structures)
    expect(solides.length).toBe(16)
    const avec = computeFlowField(sim.map, sim.nodes, solides, 10, 4)
    const sans = computeFlowField(sim.map, sim.nodes, [], 10, 4)
    const sud = 18 * 24 + 10 // (10, 18), de l'autre côté de la ligne
    // Sans la roche : ligne quasi droite. Avec : le détour par l'ouverture ouest.
    expect(sans[sud]).toBeLessThan(16)
    expect(avec[sud], 'le gradient fait le tour de la roche').toBeGreaterThan(sans[sud]!)
    // Et les tuiles de la ligne elle-même sont hors champ, comme une falaise.
    expect(avec[12 * 24 + 10], 'on ne marche pas dans la roche').toBe(-1)
  })

  it('« la roche disqualifie, le mur non » : aucun spawn ne naît derrière un anneau de massif — derrière un mur, si', () => {
    // La proie au centre, une couronne courte (dist 5 ± 1) : l'anneau de naissance entier
    // est DERRIÈRE la ceinture posée à 3 tuiles. Ceint de MASSIF, aucun site n'est joignable
    // par le terrain ; ceint de MURS, tous le sont (le siège traverse — c'est sa raison
    // d'être). Même géométrie, même tirage : seule la nature de la ceinture change.
    const ceint = (type: 'massif' | 'wall'): { x: number; y: number } | undefined => {
      const sim = createSim(7, { map: createEmptyMap(24, 24, TERRAIN_GRASS) })
      for (let t = -3; t <= 3; t++) {
        for (const [dx, dy] of [[t, -3], [t, 3], [-3, t], [3, t]] as const) {
          const s = addStructure(sim, type, 12 + dx, 12 + dy, 0, 0, 'public')
          if (type === 'wall') s.edges = 15 //  un mur d'arêtes pleines, étanche des 4 côtés
        }
      }
      return siteDansLaCouronne(sim, 12.5, 12.5, 0.4, undefined, { dist: 5, ring: 1 })
    }
    expect(ceint('massif'), 'derrière la roche : un décor, pas une menace').toBeUndefined()
    expect(ceint('wall'), 'derrière un mur : le siège vit').toBeDefined()
  })

  it('MIGRATION : une sauvegarde d’hier pleine de `paroi` charge, devient du massif plein, et la collision tient', () => {
    const sim = createSim(7, { map: createEmptyMap(24, 24, TERRAIN_GRASS) })
    const s = addStructure(sim, 'massif', 10, 10, 0, 0, 'public')
    // On maquille la structure en `paroi` d'hier — le type mort, avec ses arêtes.
    ;(s as { type: string }).type = 'paroi'
    s.edges = 5
    const relu = deserializeSim(serializeSim(sim))
    const migre = relu.structures.find((st) => st.tx === 10 && st.ty === 10) as Structure
    expect(migre.type, 'la paroi d’hier est du massif').toBe('massif')
    expect(migre.edges, 'la roche est une masse, pas un trait').toBeUndefined()
    // Le crash mesuré d'avant la migration : structureBlocks jette sur un type inconnu.
    expect(structureBlocks(migre, null, false)).toBe(true)
  })
})
