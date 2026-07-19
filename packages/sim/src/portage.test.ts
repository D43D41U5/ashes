import { describe, expect, it } from 'vitest'
import { BALANCE, CARRY, COMBAT, ITEM_WEIGHT, SLOTS, TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { carryRatio, carryTier, carryWeight, countOf, inventoryOf, makeInventory } from './items'
import { createEmptyMap } from './map'
import { carrySpeedFactor, createSim, spawnEntity, speedScaleFor, step, type SimState } from './sim'
import type { ResourceNode } from './economy'
import { grantItems } from './village'

/**
 * LE PORTAGE (spec `portage.md`) — « collecter est facile, rapporter est le jeu ».
 *
 * Ce que ces tests tiennent : la charge se PAIE (vitesse, sprint, endurance) mais
 * ne BLOQUE JAMAIS. On peut toujours ramasser, et se surcharger : c'est un choix
 * cornélien, pas un mur (décision utilisateur). Un blocage dur ne ferait que
 * refuser un clic — le drame est dans le retour, pas dans le refus.
 */
const me = (sim: SimState) => sim.entities[0]!
const vide = { sprint: false, block: false, moving: true }

function simAvec(nodes: ResourceNode[] = []): SimState {
  return createSim(1, { map: createEmptyMap(32, 32, TERRAIN_GRASS), nodes })
}

describe('le poids porté (A1)', () => {
  it('un sac vide ne pèse rien ; une pile pèse son compte', () => {
    expect(carryWeight(makeInventory(SLOTS.PLAYER))).toBe(0)

    // 20 bois (1 chacun) + 10 pierres (2 chacune) = 20 + 20 = 40.
    const inv = inventoryOf(SLOTS.PLAYER, { wood: 20, stone: 10 })
    expect(carryWeight(inv)).toBe(20 * ITEM_WEIGHT.wood + 10 * ITEM_WEIGHT.stone)
    expect(carryRatio(inv)).toBe(carryWeight(inv) / CARRY.CAPACITY)
  })

  it('la cueillette est LÉGÈRE, la mine est LOURDE — c’est là que doit être la peine', () => {
    // Une pile pleine de fibres (20 × 0,2 = 4) ne se sent pas : palier LÉGER.
    expect(carryTier(carryRatio(inventoryOf(SLOTS.PLAYER, { fiber: 20 })))).toBe('light')
    // …vingt minerais (60), si : c'est déjà la charge PLEINE. Ce sont les « hottes de
    // minerai » du GDD — la mine fait transpirer, la promenade en forêt non.
    expect(carryWeight(inventoryOf(SLOTS.PLAYER, { iron_ore: 20 }))).toBe(CARRY.CAPACITY)
  })
})

describe('le prix de la charge (A2, A3, A4)', () => {
  it('A2 : QUATRE PALIERS — trois marches PLATES, puis une pente en surcharge', () => {
    // Les paliers sont des MARCHES : dans un palier, l'effet est UNIFORME. Entre
    // deux crans, une baie de plus ne coûte RIEN — c'est ce qui rend la décision de
    // charger lisible, là où une pente continue se subit sans qu'on sache où l'on est.
    expect(carryTier(0)).toBe('light')
    expect(carryTier(CARRY.LIGHT_MAX)).toBe('light')
    expect(carryTier(CARRY.LIGHT_MAX + 0.01)).toBe('medium')
    expect(carryTier(CARRY.MEDIUM_MAX)).toBe('medium')
    expect(carryTier(CARRY.MEDIUM_MAX + 0.01)).toBe('heavy')
    expect(carryTier(1)).toBe('heavy')
    expect(carryTier(1.01)).toBe('overloaded')

    // PLAT dans le palier : deux charges du même cran vont EXACTEMENT à la même vitesse.
    expect(carrySpeedFactor(0.01)).toBe(carrySpeedFactor(CARRY.LIGHT_MAX))
    expect(carrySpeedFactor(0.4)).toBe(carrySpeedFactor(CARRY.MEDIUM_MAX))
    expect(carrySpeedFactor(0.7)).toBe(carrySpeedFactor(1))
    // …et chaque cran coûte quelque chose.
    expect(carrySpeedFactor(CARRY.LIGHT_MAX)).toBe(CARRY.SPEED_LIGHT)
    expect(carrySpeedFactor(CARRY.MEDIUM_MAX)).toBe(CARRY.SPEED_MEDIUM)
    expect(carrySpeedFactor(1)).toBe(CARRY.SPEED_HEAVY)

    // EN SURCHARGE, et là SEULEMENT : la peine grandit à chaque objet de plus.
    expect(carrySpeedFactor(1.2)).toBeLessThan(CARRY.SPEED_HEAVY)
    expect(carrySpeedFactor(1.5)).toBeLessThan(carrySpeedFactor(1.2))
    // …jusqu'au plancher : on rampe, mais on avance. Un joueur figé n'a plus de
    // choix du tout, ce qui est l'inverse du but.
    expect(carrySpeedFactor(3)).toBe(CARRY.SPEED_FLOOR)
    expect(carrySpeedFactor(50)).toBe(CARRY.SPEED_FLOOR)
  })

  it('A3 : ON NE SPRINTE PAS CHARGÉ — le sprint est REFUSÉ, pas ralenti', () => {
    const corps = { hunger: 100, wounds: {}, stamina: 100, temperature: 100 }
    const sprint = { sprint: true, block: false, moving: true }

    // Sac léger : le sprint part.
    const leger = speedScaleFor({ ...corps, inventory: inventoryOf(SLOTS.PLAYER, { fiber: 5 }) }, sprint)
    expect(leger.sprinting).toBe(true)

    // Palier MOYEN : on sprinte encore (le cran coûte de la vitesse, pas le souffle).
    const moyen = inventoryOf(SLOTS.PLAYER, { wood: 30 }) // 30 / 60 = 0,5 → moyen
    expect(carryTier(carryRatio(moyen))).toBe('medium')
    expect(speedScaleFor({ ...corps, inventory: moyen }, sprint).sprinting).toBe(true)

    // Palier LOURD : le sprint est REFUSÉ, malgré 100 d'endurance. C'est le cran
    // qu'on sent en premier, avant même de regarder une jauge.
    const lourdInv = inventoryOf(SLOTS.PLAYER, { stone: 26 }) // 52 / 60 = 0,87 → lourd
    expect(carryTier(carryRatio(lourdInv))).toBe('heavy')
    const lourd = speedScaleFor({ ...corps, inventory: lourdInv }, sprint)
    expect(lourd.sprinting).toBe(false)
    expect(lourd.scale).toBeLessThan(COMBAT.SPRINT_FACTOR)
  })

  it('A4 : SURCHARGÉ, l’endurance ne revient plus — on ne fuit pas, on rentre', () => {
    const sim = simAvec()
    const id = spawnEntity(sim, 10.5, 10.5)
    me(sim).stamina = 10
    grantItems(sim, id, { stone: 40, wood: 40 }) // 80 + 40 = 120 = 200 % de la capacité
    expect(carryRatio(me(sim).inventory)).toBeGreaterThan(1)

    for (let t = 0; t < 100; t++) step(sim, [])
    const charge = me(sim).stamina - 10

    // Le MÊME temps, le MÊME corps, sac vide : l'endurance remonte bien plus vite.
    const temoin = simAvec()
    spawnEntity(temoin, 10.5, 10.5)
    me(temoin).stamina = 10
    for (let t = 0; t < 100; t++) step(temoin, [])
    const libre = me(temoin).stamina - 10

    expect(charge).toBeGreaterThan(0) // elle revient, mais…
    expect(charge).toBeLessThan(libre * 0.5) // …bien moins vite (×0,25 par la règle)
  })
})

describe('on n’est JAMAIS bloqué (A5)', () => {
  it('à 300 % de la capacité, on ramasse ENCORE : c’est un choix, pas un mur', () => {
    const arbre: ResourceNode = { id: 1, type: 'tree', tx: 11, ty: 10, stock: 100, regrowAt: 0 }
    const sim = simAvec([arbre])
    const id = spawnEntity(sim, 10.3, 10.5)
    grantItems(sim, id, { stone: 100 }) // 200 de charge = 333 %
    expect(carryRatio(me(sim).inventory)).toBeGreaterThan(3)
    const avant = countOf(me(sim).inventory, 'wood')
    drainEvents(sim)

    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'harvest', nodeId: arbre.id } }])

    // Le coup PORTE : la sim n'a aucun refus « trop lourd », et n'en aura jamais.
    expect(countOf(me(sim).inventory, 'wood')).toBe(avant + 1)
    const refus = drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
    expect(refus).toEqual([])
  })

  it('…mais il rampe : la charge le paie en VITESSE, pas en refus', () => {
    const corps = { hunger: 100, wounds: {}, stamina: 100, temperature: 100 }
    const croulant = speedScaleFor({ ...corps, inventory: inventoryOf(SLOTS.PLAYER, { stone: 70 }) }, vide)
    expect(croulant.scale).toBe(CARRY.SPEED_FLOOR)
  })
})

describe('le déterminisme (A8)', () => {
  it('la vitesse chargée n’utilise que des opérations exactes — même seed, même état', () => {
    const jouer = (): string => {
      const sim = simAvec()
      const id = spawnEntity(sim, 10.5, 10.5)
      grantItems(sim, id, { stone: 12, wood: 7, iron_ore: 3 })
      for (let t = 0; t < 200; t++) step(sim, [{ entityId: id, dx: 1, dy: t % 3 === 0 ? 1 : 0, sprint: true }])
      const e = me(sim)
      return `${e.x.toFixed(12)}|${e.y.toFixed(12)}|${e.stamina.toFixed(12)}`
    }
    expect(jouer()).toBe(jouer())
  })
})

describe('la calibration, en clair (elle doit se LIRE, pas se deviner)', () => {
  it('une charge pleine = 60 bois — contre 360 avant le portage', () => {
    expect(CARRY.CAPACITY / ITEM_WEIGHT.wood).toBe(60)
    // Le sac tient toujours 360 unités en VOLUME (18 cases × 20) : les cases
    // bornent le volume, le poids borne la peine (spec P3). Porter 360 bois reste
    // possible — à 20 % de vitesse, sans sprint et sans endurance.
    expect(SLOTS.PLAYER * 20).toBe(360)
    expect(carrySpeedFactor(360 / CARRY.CAPACITY)).toBe(CARRY.SPEED_FLOOR)
  })

  it('fonder un village tient en UN voyage (portage doublé, décision 2026-07-19)', () => {
    // Feu (10 bois) + marteau (4 bois, 2 pierre, 2 fibre) + atelier (6 bois, 4 pierre)
    // + hache (5 bois, 3 pierre, 2 fibre) = 25 bois, 9 pierre, 4 fibre = 43,8.
    // À CAPACITY 30, ce kit demandait DEUX voyages ; à 60 (Alexis, 2026-07-19), UN
    // seul suffit — la route reste payante en vitesse/sprint, mais le gate « deux
    // allers pour fonder » a sauté. C'est assumé, pas un oubli.
    const note = carryWeight(inventoryOf(SLOTS.PLAYER, { wood: 25, stone: 9, fiber: 4 }))
    expect(note).toBeLessThan(CARRY.CAPACITY) // une seule charge y suffit désormais…
    expect(note).toBeGreaterThan(CARRY.MEDIUM_MAX * CARRY.CAPACITY) // …mais on rentre LOURD (palier haut).
    expect(BALANCE.TICK_RATE_HZ).toBe(20) // (témoin : on n'a pas bougé le tick)
  })
})
