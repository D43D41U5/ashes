import { describe, expect, it } from 'vitest'
import { BALANCE, CIRCLES, FOOD_VALUES, NIGHT_HUNT, SPOIL, SPOIL_CYCLES, SLOTS, TERRAIN_GRASS } from './balance'
import { generateNodes, type ResourceNode } from './economy'
import { drainEvents } from './events'
import { countOf, inventoryOf, nutritionFactor, spoilTier } from './items'
import { createEmptyMap } from './map'
import { predatorBias } from './faune'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { TICKS_PER_CYCLE, cycleOffsetForStartHour } from './time'
import { grantItems } from './village'

/**
 * LA TENSION (spec `tension.md`). Le jeu était un jardin : un buisson valait 171
 * minutes de survie et repoussait en 5 ; la faim s'ignorait 2h23 et ne tuait même
 * pas ; le meilleur bois était à dix pas ; et la nuit n'était qu'une couleur.
 *
 * Ces tests tiennent les quatre règles qui font qu'on peut PERDRE :
 *   1. la faim TUE, et le cru ne nourrit pas un homme ;
 *   2. la nourriture POURRIT — on ne stocke pas, on fait tourner ;
 *   3. le monde ne se remplit plus tout seul (repousse lente, épuisement local) ;
 *   4. la nuit CHASSE, loin d'un feu — mais elle s'annonce, et elle a une parade.
 */
const me = (sim: SimState) => sim.entities[0]!
const monde = (nodes: ResourceNode[] = []): SimState =>
  createSim(7, { map: createEmptyMap(64, 64, TERRAIN_GRASS), nodes })

describe('1. LA FAIM TUE (et le cru ne nourrit pas un homme)', () => {
  it('à 0, les PV fondent — et on en meurt', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    me(sim).hunger = 0
    drainEvents(sim)

    // Un quart d'heure de jeu, le ventre vide.
    for (let t = 0; t < 15 * 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])

    // AVANT : la faim ne faisait que ralentir — ce n'est pas une punition, c'est
    // une remarque. Un joueur qui ignore sa jauge doit MOURIR, sinon la nourriture
    // n'est pas une ressource : c'est un décor.
    expect(me(sim).hp).toBeLessThan(20)
    expect(id).toBeGreaterThan(0)
  })

  it('la mort de faim DIT SON NOM (la chronique doit pouvoir raconter)', () => {
    const sim = monde()
    spawnEntity(sim, 10.5, 10.5)
    me(sim).hunger = 0
    me(sim).hp = 1
    drainEvents(sim)

    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])

    const mort = drainEvents(sim).find((e) => e.type === 'entity_died')
    expect(mort).toBeDefined()
    expect(mort!.type === 'entity_died' && mort!.cause).toBe('hunger')
  })

  it('un buisson entier ne fait plus une journée : la cueillette ne suffit PLUS', () => {
    // 8 baies × 6 = 48 points. La faim descend de 2 pts/minute réelle en acte I.
    const buisson = 8 * (FOOD_VALUES.berries ?? 0)
    const parMinute = BALANCE.HUNGER_PER_CYCLE_HOUR / (BALANCE.CYCLE_REAL_MINUTES / 24)
    const minutes = buisson / parMinute

    expect(minutes).toBeLessThan(30) // ~24 min — contre 171 avant
    // …alors que le ragoût, lui, tient un homme : c'est la CUISINE qui nourrit, donc
    // le Feu, donc le bois, donc le retour au camp. C'est la boucle qui manquait.
    expect(FOOD_VALUES.stew! / FOOD_VALUES.berries!).toBeGreaterThan(5)
  })
})

describe('2. LA NOURRITURE POURRIT (on ne stocke pas, on fait tourner)', () => {
  it('les baies se gâtent, nourrissent moitié moins, puis DISPARAISSENT', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { berries: 10 })
    expect(me(sim).inventory[0]!.fresh).toBe(1) // ce qu'on récolte est frais

    // Un cycle plus tard (les baies tiennent 2 cycles) : RASSIES.
    for (let t = 0; t < TICKS_PER_CYCLE * 1.2; t++) step(sim, [])
    const slot = me(sim).inventory[0]!
    expect(spoilTier(slot.fresh!)).toBe('stale')
    expect(nutritionFactor(slot.fresh)).toBe(SPOIL.NUTRITION_STALE) // moitié moins

    // Encore un cycle : POURRIES. La pile n'existe plus. C'est brutal, et c'est le
    // but : une réserve qu'on laisse traîner n'est pas une réserve, c'est un souvenir.
    for (let t = 0; t < TICKS_PER_CYCLE * 1.2; t++) step(sim, [])
    expect(countOf(me(sim).inventory, 'berries')).toBe(0)
  })

  it('LE COFFRE N’EST PAS UN CONGÉLATEUR : ce qu’on range pourrit aussi', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { wood: 20 })
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    // On triche pour aller vite : un coffre garni, posé dans l'état.
    sim.structures.push({
      id: 999,
      type: 'chest',
      tx: 11,
      ty: 10,
      hp: 100,
      villageId: sim.villages[0]!.id,
      ownerId: id,
      access: 'private',
      inventory: inventoryOf(SLOTS.CHEST, { berries: 10 }),
    } as never)

    for (let t = 0; t < TICKS_PER_CYCLE * 1.2; t++) step(sim, [])

    const coffre = sim.structures.find((s) => s.id === 999)!
    const slot = coffre.inventory!.find((x) => x !== null)!
    expect(spoilTier(slot.fresh!)).not.toBe('fresh') // il pourrit AUSSI dans le coffre
  })

  it('la viande crue est une bombe à retardement — on la cuit, ou on la perd', () => {
    expect(SPOIL_CYCLES.raw_meat!).toBeLessThan(SPOIL_CYCLES.cooked_meat!)
    expect(SPOIL_CYCLES.cooked_meat!).toBeLessThan(SPOIL_CYCLES.stew!)
  })

  it('deux piles qui fusionnent MOYENNENT leur fraîcheur (ranger ne rajeunit rien)', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { berries: 5 })
    for (let t = 0; t < TICKS_PER_CYCLE; t++) step(sim, []) // elles vieillissent
    const vieilles = me(sim).inventory[0]!.fresh!

    grantItems(sim, id, { berries: 5 }) // cinq FRAÎCHES par-dessus
    const melange = me(sim).inventory[0]!.fresh!

    // Ni « toutes fraîches » (le coffre serait une machine à remonter le temps),
    // ni « toutes vieilles » (ça punirait le rangement) : la MOYENNE.
    expect(melange).toBeGreaterThan(vieilles)
    expect(melange).toBeLessThan(1)
  })
})

describe('3. LE MONDE NE SE REMPLIT PLUS TOUT SEUL', () => {
  it('la repousse est passée de 5 minutes à trois quarts d’heure', () => {
    const minutes = BALANCE.NODE_REGROW_TICKS / BALANCE.TICK_RATE_HZ / 60
    expect(minutes).toBeGreaterThanOrEqual(40)
  })

  it('ÉPUISEMENT LOCAL : un coin qu’on rase met de plus en plus de temps à revenir', () => {
    const buisson: ResourceNode = { id: 1, type: 'berry_bush', tx: 11, ty: 10, stock: 1, regrowAt: 0 }
    const sim = monde([buisson])
    const id = spawnEntity(sim, 10.3, 10.5)

    // On se plante SUR le nœud : à l'épuisement il DÉRIVE ailleurs (spec recolte-vivante),
    // donc pour le raser une seconde fois il faut le suivre — c'est le sens même de « on
    // tourne ». Ici on isole ce qu'on teste : la PÉNALITÉ d'épuisement, qui s'accumule sur
    // le nœud (même id) où qu'il aille.
    const surLeNoeud = (): void => {
      me(sim).x = sim.nodes[0]!.tx + 0.5
      me(sim).y = sim.nodes[0]!.ty + 0.5
    }
    surLeNoeud()
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 1 } }])
    const premier = sim.nodes[0]!.regrowAt - sim.tick

    // On le rase une deuxième fois : la repousse s'allonge. On ne CAMPE pas une
    // clairière — on la use, elle se ferme, on tourne. (GDD §8bis : les points de
    // friction se DÉPLACENT.)
    sim.nodes[0]!.stock = 1
    sim.nodes[0]!.regrowAt = 0
    me(sim).cooldownUntil = 0
    surLeNoeud()
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 1 } }])
    const second = sim.nodes[0]!.regrowAt - sim.tick

    expect(second).toBeGreaterThan(premier)
  })

  it('LES TROIS CERCLES : médiocre au camp, riche au loin (GDD §8bis)', () => {
    const map = createEmptyMap(200, 200, TERRAIN_GRASS)
    const home = { x: 100, y: 100 }
    const nodes = generateNodes(map, 3, 1, home)

    // `Math.hypot` est INTERDIT dans /sim (même en test) : il n'est pas déterministe
    // d'un moteur JS à l'autre, et un replay enregistré au navigateur doit rejouer
    // sur Node au bit près. `sqrt` l'est, lui.
    const dist = (n: ResourceNode) =>
      Math.sqrt((n.tx - home.x) * (n.tx - home.x) + (n.ty - home.y) * (n.ty - home.y))
    const stockMoyen = (filtre: (n: ResourceNode) => boolean) => {
      const sel = nodes.filter((n) => n.type === 'berry_bush' && filtre(n))
      return sel.reduce((s, n) => s + n.stock, 0) / Math.max(1, sel.length)
    }
    const domestique = stockMoyen((n) => dist(n) < CIRCLES.DOMESTIC_RADIUS)
    const sauvage = stockMoyen((n) => dist(n) > CIRCLES.WILD_RADIUS)

    // « Un village y survit, n'y prospère jamais. » La richesse se mérite — et
    // maintenant que le POIDS rend la distance coûteuse, c'est un vrai arbitrage.
    expect(domestique).toBeLessThan(sauvage)
  })

  it('LE LOIN EST RICHE… ET DANGEREUX : les prédateurs appartiennent aux marges', () => {
    const sim = createSim(9, {
      map: createEmptyMap(200, 200, TERRAIN_GRASS),
      home: { x: 100, y: 100 },
    })

    // Sans ce gradient, le cercle sauvage était riche SANS être dangereux :
    // s'éloigner rapportait sans faire peur, et le POIDS (qui rend la distance
    // coûteuse) n'achetait aucune tension. Les deux règles se tiennent la main.
    expect(predatorBias(sim, 100, 100)).toBeLessThan(1) // au camp : les loups sont rares
    expect(predatorBias(sim, 180, 100)).toBeGreaterThan(1) // aux marges : c'est chez eux

    // Un banc de test qui n'a pas déclaré de foyer garde un monde UNIFORME : on
    // n'impose pas une géographie à qui ne l'a pas demandée.
    const neutre = createSim(9, { map: createEmptyMap(50, 50, TERRAIN_GRASS) })
    expect(predatorBias(neutre, 10, 10)).toBe(1)
  })
})

describe('4. LA NUIT CHASSE (mais elle s’annonce, et elle a une parade)', () => {
  /** Un monde de nuit, sans feu : la proie est seule dans le noir. */
  const nuit = (): SimState =>
    createSim(5, {
      map: createEmptyMap(64, 64, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0), // minuit
    })

  it('loin d’un feu, les loups viennent — et ILS HURLENT AVANT', () => {
    const sim = nuit()
    spawnEntity(sim, 32.5, 32.5)
    drainEvents(sim)

    for (let t = 0; t < 20 * 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, []) // 20 minutes de nuit
    const events = drainEvents(sim)

    const loups = sim.monsters.filter((m) => m.type === 'wolf')
    expect(loups.length).toBeGreaterThan(0) // le monde est venu le chercher
    // ANNONCÉS, PAS SURPRISES (GDD §9bis) : chaque rôdeur a hurlé.
    expect(events.filter((e) => e.type === 'wolf_howl').length).toBeGreaterThan(0)
    // BORNÉ : on peut perdre, on ne doit pas être submergé.
    expect(loups.length).toBeLessThanOrEqual(NIGHT_HUNT.MAX_ALIVE)
  })

  it('AU FEU, ON EST TRANQUILLE : la parade existe, et le joueur l’a dès la minute 0', () => {
    const sim = nuit()
    const id = spawnEntity(sim, 32.5, 32.5)
    grantItems(sim, id, { wood: 20 })
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'light_fire' } }])

    for (let t = 0; t < 20 * 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])

    // Une punition sans parade n'est pas une punition, c'est un impôt.
    expect(sim.monsters.filter((m) => m.type === 'wolf')).toHaveLength(0)
  })

  it('LE JOUR, on ne se fait pas chasser (la nuit est un MOMENT, pas un état)', () => {
    const sim = createSim(5, {
      map: createEmptyMap(64, 64, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(12), // plein midi
    })
    spawnEntity(sim, 32.5, 32.5)

    // 15 minutes réelles : on reste DANS le jour (une heure de jeu = 2 min réelles,
    // et la nuit tombe à 21h — soit 18 min après midi). Au-delà, on testerait la
    // nuit en croyant tester le jour.
    for (let t = 0; t < 15 * 60 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])

    expect(sim.monsters.filter((m) => m.type === 'wolf')).toHaveLength(0)
  })
})
