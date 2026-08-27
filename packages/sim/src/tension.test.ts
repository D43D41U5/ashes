import { describe, expect, it } from 'vitest'
import { aLAbriDeLaNuit } from './test-abri'
import { BALANCE, CIRCLES, FOOD_VALUES, NIGHT_HUNT, SPOIL, SPOIL_CYCLES, SLOTS, TERRAIN_GRASS } from './balance'
import { generateNodes, type ResourceNode } from './economy'
import { drainEvents } from './events'
import { countOf, inventoryOf, nutritionFactor, spoilTier } from './items'
import { createEmptyMap } from './map'
import { predatorBias } from './faune'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { TICKS_PER_CYCLE, cycleOffsetForStartHour, dayTicksAt, getGameTime } from './time'
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

/**
 * LE CŒUR DE L'ARDEUR — le seul moment de l'année où la plaine ne gèle jamais (spec
 * `saisons.md` S4 : la courbe du socle culmine à +26 °C, la nuit à +20). Dérivé de la cadence
 * des saisons, jamais écrit.
 *
 * Ce banc mesure la FAIM, le POURRISSEMENT, la REPOUSSE et le LOUP. Depuis que le socle est
 * une courbe, le jour 1 par défaut est une Éclosion encore gelée : la cueillette y est
 * refusée (« la plante est gelée ») et la nuit y envoie des morts au lieu de loups
 * (`eveilCendreuxAt`). Les deux sont de vraies règles — mais ce ne sont pas CELLES-CI, et
 * un banc qui les traverse mesure le froid en croyant mesurer la tension.
 */
const MI_ARDEUR = Math.round(BALANCE.ACT_DAYS * 1.5)

// `jourDeDepart` vaut 1 par défaut, comme `createSim` — un banc ouvre à l'Éclosion sauf
// s'il a une raison de dire laquelle.
const monde = (nodes: ResourceNode[] = [], jourDeDepart = 1): SimState =>
  createSim(7, { map: createEmptyMap(64, 64, TERRAIN_GRASS), nodes, jourDeDepart })

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
    // 8 baies × 6 = 48 points. La faim se compte en HEURES DE CYCLE, donc son débit par minute
    // réelle suit la durée du jour : 3,2 pts/min à 30 min de cycle (2,1 à 45).
    const buisson = 8 * (FOOD_VALUES.berries ?? 0)
    const parMinute = BALANCE.HUNGER_PER_CYCLE_HOUR / (BALANCE.CYCLE_REAL_MINUTES / 24)
    const minutes = buisson / parMinute

    // CE QU'ON AFFIRME EST « PLUS UNE JOURNÉE », donc une PART DE JOURNÉE — pas un nombre de
    // minutes. « < 30 min » tenait par accident tant que le cycle en durait 45 ; à 30 min il
    // serait passé avec un facteur deux de marge, en mesurant la durée du jour. Un buisson
    // couvre à peine la moitié d'un cycle : 0,53 à 45 min, 0,50 à 30 — contre 3,8 CYCLES avant.
    expect(minutes / BALANCE.CYCLE_REAL_MINUTES).toBeLessThan(0.6)
    // …alors que le ragoût, lui, tient un homme : c'est la CUISINE qui nourrit, donc
    // le Feu, donc le bois, donc le retour au camp. C'est la boucle qui manquait.
    expect(FOOD_VALUES.stew! / FOOD_VALUES.berries!).toBeGreaterThan(5)
  })
})

describe('2. LA NOURRITURE POURRIT (on ne stocke pas, on fait tourner)', () => {
  it('les baies se gâtent, nourrissent moitié moins, puis DISPARAISSENT', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    aLAbriDeLaNuit(sim, id) // ce banc parle de POURRISSEMENT : la nuit ne doit pas signer sa fin
    grantItems(sim, id, { berries: 10 })
    expect(me(sim).inventory.find((sl) => sl?.item === 'berries')!.fresh).toBe(1) // ce qu'on récolte est frais

    // Un cycle plus tard (les baies tiennent 2 cycles) : RASSIES.
    for (let t = 0; t < TICKS_PER_CYCLE * 1.2; t++) step(sim, [])
    // On DÉSIGNE les baies plutôt que de parier sur un rang : le bois du Feu occupe le premier.
    const slot = me(sim).inventory.find((sl) => sl?.item === 'berries')!
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
    aLAbriDeLaNuit(sim, id) // ce banc parle de FRAÎCHEUR : la nuit ne doit pas signer sa fin
    const baies = (): number => me(sim).inventory.find((sl) => sl?.item === 'berries')!.fresh!
    grantItems(sim, id, { berries: 5 })
    for (let t = 0; t < TICKS_PER_CYCLE; t++) step(sim, []) // elles vieillissent
    const vieilles = baies()

    grantItems(sim, id, { berries: 5 }) // cinq FRAÎCHES par-dessus
    const melange = baies()

    // Ni « toutes fraîches » (le coffre serait une machine à remonter le temps),
    // ni « toutes vieilles » (ça punirait le rangement) : la MOYENNE.
    expect(melange).toBeGreaterThan(vieilles)
    expect(melange).toBeLessThan(1)
  })
})

describe('3. LE MONDE NE SE REMPLIT PLUS TOUT SEUL', () => {
  it('la repousse est passée de 5 minutes à UN CYCLE — une clairière rasée reste vide pour la journée', () => {
    // LA QUANTITÉ CALIBRÉE EST UNE JOURNÉE, PAS UN NOMBRE DE MINUTES (T9, reformulée le
    // 2026-08-24 quand le cycle est passé de 45 à 30 min). La garde d'avant exigeait « ≥ 40
    // minutes réelles » : elle serait passée AU VERT sur une repousse d'un cycle et demi,
    // c'est-à-dire sur la rupture même de la promesse (« vide pour la journée »). Ce qu'on
    // affirme est donc le RAPPORT au cycle, et il n'est pas vacuous : `NODE_REGROW_TICKS`
    // pourrait valoir n'importe quoi d'autre.
    expect(BALANCE.NODE_REGROW_TICKS).toBe(TICKS_PER_CYCLE)
  })

  it('ÉPUISEMENT LOCAL : un coin qu’on rase met de plus en plus de temps à revenir', () => {
    const buisson: ResourceNode = { id: 1, type: 'berry_bush', tx: 11, ty: 10, stock: 1, regrowAt: 0 }
    // AU CŒUR DE L'ARDEUR : le tick 0 est une AUBE, le fond du froid de son cycle, et sous la
    // courbe du socle (S4) l'aube d'Éclosion refuse la cueillette — « la plante est gelée ».
    // Ce qu'on chronomètre ici est la PÉNALITÉ D'ÉPUISEMENT, pas le gel.
    const sim = monde([buisson], MI_ARDEUR)
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
  /**
   * Un monde de nuit, sans feu : la proie est seule dans le noir — AU CŒUR DE L'ARDEUR.
   *
   * QUI vient est décidé par le FROID DU LIEU (`eveilCendreuxAt`, décision 2026-08-21) : sous
   * la courbe de S4, une nuit d'hiver — ou l'Éclosion encore gelée du jour 1 — ne lève que des
   * morts, et « le vivant a quitté la vallée » est une PROMESSE, pas un défaut. Les quatre
   * gardes qui suivent parlent du LOUP : elles se jouent donc dans la seule saison où il
   * chasse encore.
   */
  const nuit = (): SimState =>
    createSim(5, {
      map: createEmptyMap(64, 64, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0, MI_ARDEUR), // minuit
      jourDeDepart: MI_ARDEUR,
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

  /**
   * LE TEST QUI MANQUAIT — et son absence a laissé passer un bug qui tuait la règle entière.
   *
   * Le test ci-dessus vérifie que les loups VIENNENT et qu'ils HURLENT. Nulle part il ne
   * vérifiait qu'ils MORDENT — et pendant tout ce temps, ils ne mordaient pas : le courage exige
   * `PACK_COURAGE` congénères proches, or la nuit n'en lève que `MAX_ALIVE` sans meute. Deux
   * loups tournaient à trois tuiles jusqu'à l'aube, et il ne se passait rien.
   *
   * La promesse centrale de ce système n'a qu'un effet observable : le sang. On teste celui-là.
   */
  it('LOIN D’UN FEU, LA NUIT MORD — la promesse centrale, vérifiée par le sang', () => {
    const sim = nuit()
    const id = spawnEntity(sim, 32.5, 32.5)
    const moi = sim.entities.find((e) => e.id === id)!
    const hp0 = moi.hp

    let mordu = false
    for (let t = 0; t < 20 * 60 * BALANCE.TICK_RATE_HZ && !mordu; t++) {
      step(sim, [])
      // On ISOLE la morsure : ni la faim ni le froid ne doivent pouvoir signer ces dégâts.
      moi.hunger = 100
      moi.temperature = 100
      if (moi.hp < hp0) mordu = true
    }

    // Le VOIR d'abord : sans loup levé, le test ne prouverait rien.
    expect(sim.monsters.filter((m) => m.type === 'wolf').length).toBeGreaterThan(0)
    expect(mordu, 'les rôdeurs de la nuit tournent sans jamais mordre — la nuit ne chasse pas').toBe(true)
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
      cycleOffset: cycleOffsetForStartHour(12, MI_ARDEUR), // plein midi
      jourDeDepart: MI_ARDEUR,
    })
    spawnEntity(sim, 32.5, 32.5)

    // TOUT L'APRÈS-MIDI, JUSQU'AU CRÉPUSCULE — et pas une durée écrite. La longueur du jour
    // est SAISONNIÈRE depuis S6 (13,5 h de jour au Grand Froid, 17,3 h à l'Ardeur) : « 15
    // minutes réelles » débordait dans la nuit une saison sur deux, et le test aurait mesuré
    // la nuit en croyant mesurer le jour — au vert, puisque la nuit d'hiver n'envoie pas de
    // loups. On court donc jusqu'au tick d'avant la tombée, et on prouve qu'on y est resté.
    const crepuscule = dayTicksAt(sim, sim.tick) - ((sim.tick + sim.cycleOffset) % TICKS_PER_CYCLE)
    for (let t = 0; t < crepuscule - 1; t++) step(sim, [])
    expect(getGameTime(sim).isNight, 'la prémisse : on a passé la journée entière DANS le jour').toBe(false)

    expect(sim.monsters.filter((m) => m.type === 'wolf')).toHaveLength(0)
  })
})
