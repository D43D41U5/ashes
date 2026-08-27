import { describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, NODE_DEFS, TERRAIN_GRASS } from './balance'
import { spawnMonster } from './monsters'
import { compteEncyclo, connuEncyclo, extremeEncyclo, VERBES_DE_RELEVE } from './encyclopedie'
import type { ResourceNode } from './economy'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, phaseForDay, jourDeSaison } from './time'
import { baselineTemperature } from './temperature'
import { grantItems } from './village'

/**
 * LE CARNET DE L'ENCYCLOPÉDIE (décision d'Alexis, 2026-08-24) — *une entrée jamais
 * rencontrée ne dit rien*.
 *
 * Ce que ces tests gardent, c'est la PROMESSE : le carnet part vide, il se remplit par le
 * GESTE (récolter, fabriquer, manger, abattre, traverser une saison) et jamais par le
 * spectacle. Aucun n'émet d'événement à la main : chacun joue le vrai coup, par `step`, et
 * lit ce que le carnet en a retenu — sans quoi on testerait le consommateur sur une prémisse
 * qu'on lui aurait fabriquée.
 */

let nextNodeId = 500
function makeNode(type: ResourceNode['type'], tx: number, ty: number): ResourceNode {
  nextNodeId += 1
  return { id: nextNodeId, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 }
}

function monde(nodes: ResourceNode[] = []): SimState {
  return createSim(11, {
    map: createEmptyMap(48, 48, TERRAIN_GRASS),
    nodes,
    jourDeDepart: BALANCE.JOUR_DE_DEPART,
  })
}

function act(sim: SimState, entityId: number, action: PlayerAction): void {
  step(sim, [{ entityId, dx: 0, dy: 0, action }])
}

const moi = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

describe('le carnet de l’encyclopédie', () => {
  it('part VIDE de tout geste — seule la saison qu’on traverse s’y écrit toute seule', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    const carnet = moi(sim, id).carnet ?? []
    // Rien de ramassé, rien de fabriqué, rien de mangé, rien d'abattu. (Les RELEVÉS de saison
    // — le plus froid, le plus chaud endurés — ne sont pas des gestes : ils s'écrivent du seul
    // fait d'être là, comme `vecu`.)
    const gestes = carnet.filter((l) => !['vecu', ...VERBES_DE_RELEVE].some((v) => l.k.startsWith(`${v}:`)))
    expect(gestes).toEqual([])
    // …mais on est bien quelque part dans l'année, et on la vit.
    expect(compteEncyclo(carnet, 'vecu', String(phaseForDay(jourDeSaison(sim))))).toBe(1)
  })

  it('RÉCOLTER écrit la ressource, et le compte est celui du sac (pas des coups)', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = monde([tree])
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    // La hache EN MAIN : le bois exige un outil (spec `glanage.md` G1).
    grantItems(sim, id, { crude_axe: 1 })
    moi(sim, id).activeSlot = moi(sim, id).inventory.findIndex((sl) => sl !== null && sl.item === 'crude_axe')
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    const carnet = moi(sim, id).carnet!
    const bois = compteEncyclo(carnet, 'recolte', 'wood')
    expect(bois).toBeGreaterThan(0)
    // Le carnet compte ce qui est ENTRÉ, donc exactement ce que le sac porte.
    const enMain = moi(sim, id).inventory.reduce((t, s) => t + (s?.item === 'wood' ? s.count : 0), 0)
    expect(bois).toBe(enMain)
    // Et rien d'autre n'a bougé : une hache n'est pas connue parce qu'on a coupé un arbre.
    expect(connuEncyclo(carnet, 'axe')).toBe(false)
  })

  it('FABRIQUER écrit l’objet — et la recette qui en rend cinq en compte cinq', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    grantItems(sim, id, { wood: 4, stone: 4, fiber: 4 })
    act(sim, id, { type: 'craft', recipeId: 'arrow' })
    for (let t = 0; t < BALANCE.TICK_RATE_HZ * 10; t++) step(sim, [])
    const carnet = moi(sim, id).carnet!
    expect(compteEncyclo(carnet, 'fabrique', 'arrow')).toBe(5)
    expect(connuEncyclo(carnet, 'arrow')).toBe(true)
  })

  it('MANGER écrit le repas — et c’est un verbe DISTINCT de fabriquer', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    grantItems(sim, id, { berries: 4 })
    moi(sim, id).hunger = 10 // affamé : le repas passe
    act(sim, id, { type: 'eat', item: 'berries' })
    const carnet = moi(sim, id).carnet!
    expect(compteEncyclo(carnet, 'mange', 'berries')).toBe(1)
    expect(compteEncyclo(carnet, 'fabrique', 'berries')).toBe(0)
    // Le MUET ne se tranche pas sur le verbe de la section : avoir mangé suffit à connaître.
    expect(connuEncyclo(carnet, 'berries')).toBe(true)
  })

  it('LA SAISON qu’on traverse se compte une fois par tour, pas une fois par tick', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    const saison = String(phaseForDay(jourDeSaison(sim)))
    for (let t = 0; t < 200; t++) step(sim, [])
    expect(compteEncyclo(moi(sim, id).carnet, 'vecu', saison)).toBe(1)
  })

  it('CHANGER DE SAISON en ouvre une seconde — et la précédente garde son compte', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    const depart = String(phaseForDay(jourDeSaison(sim)))
    // On saute jusqu'à la saison suivante en avançant le calendrier, pas en trichant sur le
    // carnet : c'est la bascule elle-même qu'on teste.
    const jour0 = jourDeSaison(sim)
    let gardefou = 0
    while (phaseForDay(jourDeSaison(sim)) === Number(depart) && gardefou < 40) {
      sim.tick += TICKS_PER_SEASON_DAY
      step(sim, [])
      gardefou += 1
    }
    // ⚠ ON JOUE UNE SECONDE DE PLUS, ET C'EST LE TEST QUI DOIT LE FAIRE : sauter le calendrier
    // à coups de `sim.tick +=` fait franchir la saison SANS que le tick de la bascule soit joué
    // — `entre` ne peut donc pas la voir (le tick d'avant est déjà dans la saison neuve). Un
    // vrai joueur, lui, traverse la bascule tick par tick. La passe de rattrapage (une fois par
    // seconde) est exactement ce qui couvre ce cas, et on lui laisse sa seconde.
    for (let t = 0; t < BALANCE.TICK_RATE_HZ + 1; t++) step(sim, [])
    const suivante = String(phaseForDay(jourDeSaison(sim)))
    expect(suivante).not.toBe(depart)
    expect(jourDeSaison(sim)).toBeGreaterThan(jour0)
    const carnet = moi(sim, id).carnet!
    expect(compteEncyclo(carnet, 'vecu', depart)).toBe(1)
    expect(compteEncyclo(carnet, 'vecu', suivante)).toBe(1)
  })

  it('LA BASCULE JOUÉE TICK PAR TICK ouvre la saison — et un SECOND tour la compte ×2', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    const depart = phaseForDay(jourDeSaison(sim))

    /** LE PREMIER TICK DE LA SAISON SUIVANTE, par dichotomie — `jourDeSaison` est monotone.
     *  On ne peut pas y arriver en avançant par jours : le pas dérive, et deux bascules sur
     *  trois se retrouvent ENJAMBÉES (constaté — seule la première était comptée). */
    const tickDeBascule = (): number => {
      const saison = phaseForDay(jourDeSaison(sim))
      let lo = sim.tick + 1
      let hi = sim.tick + 31 * TICKS_PER_SEASON_DAY
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (phaseForDay(jourDeSaison(sim, mid)) === saison) lo = mid + 1
        else hi = mid
      }
      return lo
    }

    /** Se poser trois ticks avant la bascule et la TRAVERSER, tick par tick. C'est le seul
     *  montage où `entre` peut faire son travail : sauter par-dessus (comme
     *  `debug_set_season_day`) la rend invisible, et seule la passe de rattrapage sauverait le
     *  compte — on testerait alors le filet, jamais la règle. */
    const franchir = (): number => {
      sim.tick = tickDeBascule() - 3
      for (let t = 0; t < 6; t++) step(sim, [])
      return phaseForDay(jourDeSaison(sim))
    }

    const suivante = franchir()
    expect(suivante).not.toBe(depart)
    expect(compteEncyclo(moi(sim, id).carnet, 'vecu', String(suivante))).toBe(1)

    // ── LE TOUR DE L'AN : on refranchit jusqu'à revenir sur la saison de départ ──
    let ici = suivante
    let tours = 0
    while (ici !== depart && tours < 6) {
      ici = franchir()
      tours += 1
    }
    expect(ici).toBe(depart)
    // La revoici : on l'a vécue DEUX fois, et c'est `entre` qui l'a compté (la passe de
    // rattrapage, elle, s'arrête au premier — elle ne note que si le compte est à zéro).
    expect(compteEncyclo(moi(sim, id).carnet, 'vecu', String(depart))).toBe(2)
  })

  it('LE FROID ET LE CHAUD ENDURÉS se relèvent tout seuls — et ce sont des EXTRÊMES, pas une moyenne', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    const phase = String(phaseForDay(jourDeSaison(sim)))
    const carnet = () => moi(sim, id).carnet ?? []
    const froid0 = extremeEncyclo(carnet(), 'froid', phase)
    const chaud0 = extremeEncyclo(carnet(), 'chaud', phase)
    expect(froid0).toBeDefined()
    expect(chaud0).toBe(froid0) // un seul relevé : les deux bornes se touchent

    // ON TRAVERSE UN CYCLE ENTIER. La nuit passe forcément sous le jour : les bornes s'écartent,
    // et elles ENCADRENT tout ce qui a été relevé (c'est ça, un extrême).
    for (let i = 0; i < TICKS_PER_CYCLE; i++) step(sim, [])
    const froid = extremeEncyclo(carnet(), 'froid', phase)!
    const chaud = extremeEncyclo(carnet(), 'chaud', phase)!
    expect(froid).toBeLessThan(chaud)
    expect(froid).toBeLessThanOrEqual(froid0!)
    expect(chaud).toBeGreaterThanOrEqual(chaud0!)
    // Le relevé encadre bien la température du lieu, à tout instant du cycle.
    for (let i = 0; i < 40; i++) {
      step(sim, [])
      const t = baselineTemperature(sim, moi(sim, id).x, moi(sim, id).y)
      expect(t).toBeGreaterThanOrEqual(froid - 0.05)
      expect(t).toBeLessThanOrEqual(chaud + 0.05)
    }
    // ⚠ ET UN RELEVÉ N'EST PAS UNE RENCONTRE. `chaud:3` porte des DEGRÉS : seul, il ne doit
    // rien rendre « connu ». (Sans la garde de `connuEncyclo`, une saison relevée ferait parler
    // toute entrée dont l'id est « 3 » — le jour où un objet s'appellera ainsi.)
    expect(connuEncyclo([{ k: 'chaud:3', n: 11 }], '3')).toBe(false)
    expect(connuEncyclo([{ k: 'vecu:3', n: 1 }], '3')).toBe(true)
  })

  it('ABATTRE écrit la BÊTE — et pour le tueur seul : voir mourir n’apprend rien', () => {
    const sim = monde()
    const cible = spawnMonster(sim, 'rabbit', 20.5, 20.5)
    const chasseur = spawnEntity(sim, 19.7, 20.5)
    const temoin = spawnEntity(sim, 25.5, 20.5) // il regarde, à cinq tuiles
    step(sim, [])
    // Mains nues, 6 dégâts contre 8 PV : deux coups, et le lapin crochète entre les deux.
    let gardefou = 0
    while (sim.monsters.some((m) => m.entityId === cible) && gardefou < 40) {
      const bete = sim.entities.find((e) => e.id === cible)!
      const moiChasseur = moi(sim, chasseur)
      moiChasseur.x = bete.x - 0.8
      moiChasseur.y = bete.y
      step(sim, [{ entityId: chasseur, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
      for (let t = 0; t < COMBAT.WINDUP_TICKS + 1; t++) step(sim, [])
      gardefou += 1
    }
    expect(sim.monsters.some((m) => m.entityId === cible)).toBe(false)
    expect(compteEncyclo(moi(sim, chasseur).carnet, 'abat', 'rabbit')).toBe(1)
    expect(compteEncyclo(moi(sim, temoin).carnet, 'abat', 'rabbit')).toBe(0)
    expect(connuEncyclo(moi(sim, temoin).carnet, 'rabbit')).toBe(false)
  })

  it('UN PNJ n’a pas de carnet — il ne voyagerait dans le snapshot pour personne', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = monde([tree])
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    // On enrôle l'entité comme PNJ — la MÊME forme que `spawnNpcsAround` : le même geste ne
    // doit plus rien écrire. (Un objet approximatif traverserait vitest et tomberait à `tsc`.)
    sim.npcs.push({
      entityId: id,
      villageId: -1,
      homeId: null,
      energy: 100,
      sleeping: false,
      seekingWarmth: false,
      task: null,
      path: [],
      stuck: 0,
      defendStuck: 0,
      defendBest: -1,
      defendIgnoreUntil: 0,
      errand: null,
    })
    const avant = JSON.stringify(moi(sim, id).carnet ?? [])
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    expect(JSON.stringify(moi(sim, id).carnet ?? [])).toBe(avant)
  })

  it('LE CARNET SURVIT À LA MORT — c’est une mémoire, pas un bien', () => {
    const tree = makeNode('tree', 11, 10)
    const sim = monde([tree])
    const id = spawnEntity(sim, 10.5, 10.5)
    step(sim, [])
    // La hache EN MAIN : le bois exige un outil (spec `glanage.md` G1).
    grantItems(sim, id, { crude_axe: 1 })
    moi(sim, id).activeSlot = moi(sim, id).inventory.findIndex((sl) => sl !== null && sl.item === 'crude_axe')
    act(sim, id, { type: 'harvest', nodeId: tree.id })
    const avant = compteEncyclo(moi(sim, id).carnet, 'recolte', 'wood')
    expect(avant).toBeGreaterThan(0)
    moi(sim, id).hp = 0
    for (let t = 0; t < BALANCE.TICK_RATE_HZ * 2; t++) step(sim, [])
    expect(compteEncyclo(moi(sim, id).carnet, 'recolte', 'wood')).toBe(avant)
  })

  it('DÉTERMINISME : même graine, mêmes gestes ⇒ même carnet, au caractère près', () => {
    const joue = (): string => {
      const tree = makeNode('tree', 11, 10)
      const sim = monde([tree])
      const id = spawnEntity(sim, 10.5, 10.5)
      step(sim, [])
      grantItems(sim, id, { wood: 4, stone: 4, fiber: 4 })
      act(sim, id, { type: 'harvest', nodeId: tree.id })
      act(sim, id, { type: 'craft', recipeId: 'arrow' })
      for (let t = 0; t < BALANCE.TICK_RATE_HZ * 10; t++) step(sim, [])
      return JSON.stringify(moi(sim, id).carnet)
    }
    expect(joue()).toBe(joue())
  })
})
