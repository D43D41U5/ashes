/**
 * L'ENVOL DU TÉTRAS (spec faune R21) — le banc du bond.
 *
 * Ce qu'on éprouve ici n'est PAS « le tétras existe » : c'est que le vol tienne
 * ses trois promesses de jeu, et chacune peut casser sans que rien d'autre ne
 * rougisse —
 *   · IL SE TERRE : il ne part pas à la distance des autres, il part très tard ;
 *   · IL DÉCOLLE VRAIMENT : il franchit ce qui bloque, et ne se pose jamais dedans ;
 *   · EN L'AIR, SEUL LE TRAIT L'ATTEINT — et il redevient frappable en se posant.
 *
 * Le montage prend la SIM ENTIÈRE (`step`), jamais une phase seule : le défaut
 * d'un état de vol vit dans l'espace ENTRE deux phases (une bête en l'air que le
 * broutage, le couché ou l'appât reprendraient à leur compte au tick suivant).
 * Appeler `faunaStep` à la main n'aurait éprouvé aucune de ces frontières.
 */
import { describe, it, expect } from 'vitest'
import {
  BALANCE,
  COMBAT,
  FAUNA,
  MONSTER_DEFS,
  TERRAIN_GRASS,
  TERRAIN_OLD_GROWTH,
  TERRAIN_ROCK,
  WEAPON_PROFILES,
  type MonsterType,
} from './balance'
import { createEmptyMap, type WorldMap } from './map'
import { createSim, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { spawnMonster, type Monster } from './monsters'
import { enVol, hauteurDeBond, hauteurDeVol } from './vol'
import { drainEvents } from './events'
import { isPrey } from './faune'
import { grantItems } from './village'
import { placeHuntingGrounds } from './faune'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { terrainAt } from './map'
// LE CACHE DE CARTES : cette garde n'éprouve PAS la génération (elle éprouve
// l'atteignabilité d'une espèce), elle a donc droit au monde mis en cache —
// bit pour bit ce que `generateZonedTerrain` rendrait, mais une seule fois.
import { carteDeTest } from '../../../tools/carte-cache'

/** Une futaie pleine carte : l'habitat du tétras, pour qu'il ait où se poser. */
function makeMap(): WorldMap {
  return createEmptyMap(120, 120, TERRAIN_OLD_GROWTH)
}

function makeSim(map: WorldMap = makeMap(), hour = 8): SimState {
  // `faunaCap: 0` : AUCUNE bête ambiante. Ce banc pose SES bêtes, une par une, et
  // un peuplement qui tourne à côté rendrait chaque compte dépendant du tirage.
  // `worldEvents: false` pour la même raison (pas de nuit qui chasse).
  const sim = createSim(4321, {
    map,
    faunaCap: 0,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(hour, 1),
  })
  sim.wind = { x: 0, y: 0 } // calme plat : l'odorat ne doit pas décider de la distance de levée
  return sim
}

const entity = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!
const vivant = (sim: SimState, id: number): Entity | undefined => sim.entities.find((e) => e.id === id)
const bete = (sim: SimState, entityId: number): Monster | undefined => sim.monsters.find((m) => m.entityId === entityId)
const tick = (sim: SimState, inputs: MoveInput[] = []): void => step(sim, inputs)

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))
}

/**
 * Pose un tétras au centre et un homme À L'EST, DANS sa distance de fuite, puis
 * laisse la peur monter jusqu'à l'envol. Rend l'oiseau EN L'AIR.
 *
 * ⚠ L'homme est POSÉ, pas marché : on éprouve le bond, pas l'approche. Et il
 * reçoit un input à chaque tick (immobile) — une entité sans input ne compte pas
 * comme menace vivante dans certaines passes.
 */
function leve(sim: SimState, ecart = 2): { m: Monster; homme: Entity } {
  const birdId = spawnMonster(sim, 'tetras', 60.5, 60.5)
  const homme = entity(sim, spawnEntity(sim, 60.5 + ecart, 60.5))
  for (let t = 0; t < 120; t++) {
    tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
    const m = bete(sim, birdId)
    if (m !== undefined && enVol(m, sim.tick)) return { m, homme }
  }
  throw new Error("le tétras n'a pas décollé — le montage ne mesure plus ce qu'il croit")
}

describe('R21 — la définition du tétras', () => {
  it('c’est du GIBIER, il vole, et il est le SEUL à voler pour l’instant', () => {
    expect(isPrey('tetras')).toBe(true)
    expect(MONSTER_DEFS.tetras.vol).toBe(true)
    const volants = (Object.keys(MONSTER_DEFS) as MonsterType[]).filter((t) => MONSTER_DEFS[t].vol === true)
    expect(volants).toEqual(['tetras'])
  })

  it('IL SE TERRE : il voit bien plus loin qu’il ne part — c’est l’inverse du lapin', () => {
    const t = MONSTER_DEFS.tetras
    const l = MONSTER_DEFS.rabbit
    // La distance de fuite du tétras est très inférieure à celle du lapin…
    expect(t.flightRange!).toBeLessThan(l.flightRange!)
    // …alors qu'il voit PLUS loin. C'est cet écart-là qui EST le comportement :
    // douze tuiles de « il m'a vu et il ne bouge pas ». Sans lui, il ne se terre
    // pas — il est juste sourd, ce qui n'est pas la même promesse de jeu.
    expect(t.alertRange!).toBeGreaterThan(l.alertRange!)
    expect(t.alertRange! / t.flightRange!).toBeGreaterThan(3)
  })

  it('l’ARITHMÉTIQUE DES ARCS tient : il retombe hors du fortune, dans le long', () => {
    // C'est le nombre qui donne tout son sens au vol (voir la note de VOL_TUILES) :
    // levé à `flightRange`, il se pose à `flightRange + VOL_TUILES`. Cette garde est
    // le garde-fou de ce calibrage — elle rougit si quelqu'un touche l'un des trois
    // nombres sans regarder les deux autres. Les portées sont RELUES du profil
    // d'arme, jamais recopiées : une garde écrite avec la constante qu'elle teste
    // ne garde rien.
    const chute = MONSTER_DEFS.tetras.flightRange! + FAUNA.VOL_TUILES
    expect(chute).toBeGreaterThan(WEAPON_PROFILES.crude_bow.charged.range)
    expect(chute).toBeLessThan(WEAPON_PROFILES.bow.charged.range)
  })

  it('il tombe d’un tir long BANDÉ, jamais d’un fortune bandé — c’est ce que 14 PV veut dire', () => {
    const hp = MONSTER_DEFS.tetras.hp
    // En vol il est ALERTÉ : plus aucun coup n'est « propre », donc pas de bonus.
    expect(WEAPON_PROFILES.bow.charged.damage).toBeGreaterThanOrEqual(hp)
    expect(WEAPON_PROFILES.crude_bow.charged.damage).toBeLessThan(hp)
  })
})

/**
 * ═══ LA GARDE D'ATTEIGNABILITÉ (et elle a sauvé le chantier) ═══
 *
 * Le premier jet donnait au tétras l'habitat du vrai oiseau — vieux bois et
 * résineux (`old_growth`, `pine`, `larch`). Table cohérente, règle testée,
 * vingt-et-une gardes au vert… et **zéro tétras dans le jeu** : sur cinq graines
 * du MONDE JOUÉ, les coins de chasse (R17) tombent sur `grass`, `forest`,
 * `wet_meadow` et `willow`, et sur AUCUN des trois. L'espèce était licite et
 * injoignable — le défaut exact du marais qui avait tué quatre espèces.
 *
 * Une valeur du domaine doit donc être prouvée ATTEIGNABLE, pas seulement
 * licite. Cette garde le fait sur le vrai semis, dans le monde qu'on JOUE.
 */
describe('R21 — le tétras EXISTE dans le monde qu’on joue', () => {
  it('sur chaque graine, au moins un coin de chasse l’admet', () => {
    for (const graine of [909, 1234, 4321]) {
      const c = carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
      const coins = placeHuntingGrounds(c.map, graine)
      const admis = coins.filter((g) => {
        const t = terrainAt(c.map, Math.floor(g.x), Math.floor(g.y))
        return MONSTER_DEFS.tetras.habitat!.includes(t)
      })
      expect(admis.length, `graine ${graine} : aucun coin de chasse n’admet le tétras`).toBeGreaterThan(0)
    }
  })
})

describe('R21 — le décollage', () => {
  it('serré de près, il DÉCOLLE : le bond est posé, et il dure ce que la balance dit', () => {
    const sim = makeSim()
    const { m } = leve(sim)
    expect(m.volDepuis).toBeDefined()
    expect(m.volUntil! - m.volDepuis!).toBe(FAUNA.VOL_TICKS)
  })

  it('l’envol ANNONCE : il émet le même fait que la nuée de lisière', () => {
    const sim = makeSim()
    const birdId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    const homme = entity(sim, spawnEntity(sim, 62.5, 60.5))
    drainEvents(sim)
    let flushs = 0
    for (let t = 0; t < 120; t++) {
      tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
      flushs += drainEvents(sim).filter((e) => e.type === 'bird_flush').length
      const m = bete(sim, birdId)
      if (m !== undefined && enVol(m, sim.tick)) break
    }
    expect(flushs).toBeGreaterThanOrEqual(1)
  })

  it('il part LOIN, et à l’OPPOSÉ de l’homme', () => {
    const sim = makeSim()
    const { m } = leve(sim) // l'homme est à l'EST du tétras
    // Il fuit vers l'OUEST : son point de chute est à gauche de son départ.
    expect(m.volX!).toBeLessThan(m.volFromX!)
    // Et le bond PORTE : il ne recule pas d'un pas, il traverse.
    expect(dist({ x: m.volX!, y: m.volY! }, { x: m.volFromX!, y: m.volFromY! })).toBeGreaterThan(FAUNA.VOL_TUILES / 2)
  })

  it('il ne se pose JAMAIS hors de son habitat — plutôt court que mal atterrir', () => {
    // Une futaie ÉTROITE, cernée de prairie : le point de chute idéal tombe au
    // pré. Il doit alors se poser plus court, DANS le bois — ou ne pas décoller
    // du tout (et détaler au sol comme les autres). Ce qu'il ne peut pas faire,
    // c'est atterrir chez le voisin : il repartirait aussitôt en `homing`, et le
    // vol n'aurait servi à rien.
    const map = createEmptyMap(120, 120, TERRAIN_GRASS)
    for (let ty = 50; ty < 70; ty++) for (let tx = 52; tx < 62; tx++) map.terrain[ty * map.width + tx] = TERRAIN_OLD_GROWTH
    const sim = makeSim(map)
    const birdId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    const homme = entity(sim, spawnEntity(sim, 61.5, 60.5))
    for (let t = 0; t < 120; t++) {
      tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
      const m = bete(sim, birdId)
      if (m !== undefined && enVol(m, sim.tick)) {
        expect(map.terrain[Math.floor(m.volY!) * map.width + Math.floor(m.volX!)]).toBe(TERRAIN_OLD_GROWTH)
        return
      }
    }
  })

  it('il FRANCHIT ce qui bloque : une barre de roche ne raccourcit pas le bond', () => {
    // Une barre de ROCHE en travers de sa route, à trois tuiles. Au sol elle
    // l'arrêterait ; en l'air elle n'est rien — et il se pose DERRIÈRE, jamais
    // DEDANS (un oiseau emmuré dans un rocher serait un bug, pas un coût).
    const map = makeMap()
    for (let ty = 40; ty < 80; ty++) map.terrain[ty * map.width + 57] = TERRAIN_ROCK
    const sim = makeSim(map)
    const birdId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    const homme = entity(sim, spawnEntity(sim, 61.5, 60.5))
    for (let t = 0; t < 120; t++) {
      tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
      const m = bete(sim, birdId)
      if (m !== undefined && enVol(m, sim.tick)) {
        expect(m.volX!).toBeLessThan(57) // DERRIÈRE la barre
        expect(Math.floor(m.volX!)).not.toBe(57) // et jamais DEDANS
        return
      }
    }
    throw new Error("le tétras n'a pas décollé")
  })
})

describe('R21 — le bond, et la pose', () => {
  it('il arrive EXACTEMENT où il avait été dit, et il y arrive EN FUITE', () => {
    const sim = makeSim()
    const { m, homme } = leve(sim)
    const chute = { x: m.volX!, y: m.volY! }
    const id = m.entityId

    for (let t = 0; t < FAUNA.VOL_TICKS + 1; t++) tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
    const apres = bete(sim, id)!
    expect(enVol(apres, sim.tick)).toBe(false)
    expect(apres.volUntil).toBeUndefined() // le champ est PURGÉ, pas laissé traîner
    expect(apres.volX).toBeUndefined()
    // Il s'est posé au point dit — à moins de deux tuiles près (il court depuis).
    expect(dist(entity(sim, id), chute)).toBeLessThan(2)
    // ET IL COURT : un oiseau ne se pose pas serein.
    expect(apres.fleeSince).toBeGreaterThanOrEqual(0)
  })

  it('il ne s’envole qu’UNE fois par peur : posé, il détale au sol', () => {
    const sim = makeSim()
    const birdId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    const homme = entity(sim, spawnEntity(sim, 62.5, 60.5))
    let envols = 0
    let etait = false
    for (let t = 0; t < FAUNA.VOL_TICKS * 5; t++) {
      tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
      const m = bete(sim, birdId)
      if (m === undefined) break
      const est = enVol(m, sim.tick)
      if (est && !etait) envols++
      etait = est
    }
    expect(envols).toBe(1)
  })

  it('EN L’AIR, il avance vraiment — la position n’est pas figée pendant le bond', () => {
    const sim = makeSim()
    const { m, homme } = leve(sim)
    const id = m.entityId
    const depart = { x: entity(sim, id).x, y: entity(sim, id).y }
    // Trois ticks de vol : il doit avoir couvert du terrain à l'allure du bond.
    for (let t = 0; t < 3; t++) tick(sim, [{ entityId: homme.id, dx: 0, dy: 0 }])
    expect(dist(entity(sim, id), depart)).toBeGreaterThan(0.5)
  })
})

describe('R21 — en vol, seul le trait atteint', () => {
  /**
   * ═══ UNE EXPÉRIENCE CONTRÔLÉE : MÊME MONTAGE, UN SEUL DRAPEAU QUI CHANGE ═══
   *
   * Les deux premiers jets de ce banc étaient des sondes qui NE POUVAIENT PAS
   * rougir, et pour deux raisons différentes — les deux valaient d'être écrites.
   *
   *   ① Un coup se résout à la FIN du wind-up (~9 ticks) ; une bête levée en
   *      couvre quatre tuiles dans le même temps. Le coup partait dans le vide
   *      QUELLE QUE SOIT la règle testée : on mesurait sa vitesse, pas son
   *      immunité. Débrancher la garde de `combat.ts` laissait le banc VERT.
   *   ② Le « contrôle au sol » ne contrôlait rien : collé à 0,6 tuile, l'oiseau
   *      décollait au premier tick (`bird_flush` émis, mesuré) — le témoin était
   *      donc en l'air lui aussi, et les deux cas testaient la même chose.
   *
   * D'où ce montage. À chaque tick on ÉPINGLE trois choses : la position de la
   * cible, celle de l'attaquant, et L'ÉTAT DE VOL — soit un bond dégénéré
   * (départ = arrivée, donc `enVol` vrai et zéro déplacement), soit les champs
   * purgés (au sol, pour de bon). Entre le témoin et l'essai, une seule
   * différence subsiste, et c'est très exactement celle qu'on veut mesurer.
   */
  function frappeEpinglee(
    sim: SimState,
    attaquantId: number,
    cibleId: number,
    enLAir: boolean,
    attendreAvant = 0,
  ): number | undefined {
    const c = entity(sim, cibleId)
    const px = c.x
    const py = c.y
    const epingle = (): void => {
      const t = vivant(sim, cibleId)
      const m = bete(sim, cibleId)
      if (t !== undefined) {
        t.x = px
        t.y = py
      }
      if (m !== undefined) {
        if (enLAir) {
          m.volDepuis = sim.tick
          m.volUntil = sim.tick + 400
          m.volFromX = px
          m.volFromY = py
          m.volX = px
          m.volY = py
        } else {
          delete m.volUntil
          delete m.volDepuis
          delete m.volFromX
          delete m.volFromY
          delete m.volX
          delete m.volY
        }
      }
      const a = vivant(sim, attaquantId)
      if (a !== undefined) {
        a.x = px + 0.6
        a.y = py
      }
    }
    // LA RÉCUPÉRATION EST UN PLANCHER DE TEMPS MORT : un second coup demandé
    // pendant qu'on est encore planté, arme en avant, est REFUSÉ — et le banc
    // aurait lu ce refus comme « il est immunisé ». On laisse donc passer la
    // récupération avant de frapper, quand l'appelant le demande.
    for (let t = 0; t < attendreAvant; t++) {
      epingle()
      tick(sim, [{ entityId: attaquantId, dx: 0, dy: 0 }])
    }
    epingle()
    tick(sim, [{ entityId: attaquantId, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) {
      epingle()
      tick(sim, [{ entityId: attaquantId, dx: 0, dy: 0 }])
    }
    return vivant(sim, cibleId)?.hp
  }

  /** Le couple (tétras, homme) au contact, à l'identique pour les deux cas. */
  function duel(sim: SimState): { cibleId: number; hommeId: number; avant: number } {
    const cibleId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    const hommeId = spawnEntity(sim, 61.1, 60.5)
    return { cibleId, hommeId, avant: entity(sim, cibleId).hp }
  }

  it('CONTRÔLE — AU SOL, le même geste TOUCHE (le montage sait frapper)', () => {
    const sim = makeSim()
    const { cibleId, hommeId, avant } = duel(sim)
    const hp = frappeEpinglee(sim, hommeId, cibleId, false)
    expect(hp === undefined || hp < avant).toBe(true)
  })

  it('EN L’AIR, la MÊLÉE passe dessous — pas un PV perdu', () => {
    const sim = makeSim()
    const { cibleId, hommeId, avant } = duel(sim)
    const hp = frappeEpinglee(sim, hommeId, cibleId, true)
    expect(hp).toBe(avant)
    // …et il était TOUJOURS en l'air à l'arrivée : ce n'est pas qu'il s'est posé.
    expect(enVol(bete(sim, cibleId)!, sim.tick)).toBe(true)
  })

  it('le TRAIT, lui, l’atteint en plein vol', () => {
    const sim = makeSim()
    const cibleId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    const hommeId = spawnEntity(sim, 63.5, 60.5)
    grantItems(sim, hommeId, { bow: 1, arrow: 10 })
    const homme = entity(sim, hommeId)
    homme.activeSlot = homme.inventory.findIndex((s) => s !== null && s.item === 'bow')
    const avant = entity(sim, cibleId).hp

    // Le même épinglage, mais l'archer reste à SA distance : trois tuiles, dans
    // la portée du tir SEC (6). Pas besoin de bander pour prouver l'ÉLIGIBILITÉ —
    // c'est elle le sujet, pas la puissance.
    const px = 60.5
    const py = 60.5
    const epingle = (): void => {
      const t = vivant(sim, cibleId)
      const m = bete(sim, cibleId)
      if (t !== undefined) { t.x = px; t.y = py }
      if (m !== undefined) {
        m.volDepuis = sim.tick
        m.volUntil = sim.tick + 400
        m.volFromX = px; m.volFromY = py; m.volX = px; m.volY = py
      }
      homme.x = px + 3
      homme.y = py
    }
    epingle()
    tick(sim, [{ entityId: hommeId, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) {
      epingle()
      tick(sim, [{ entityId: hommeId, dx: 0, dy: 0 }])
    }
    const apres = vivant(sim, cibleId)?.hp
    // Touché (PV entamés) ou mort (l'entité a disparu) : les deux disent oui.
    expect(apres === undefined || apres < avant).toBe(true)
  })

  it('POSÉ, il redevient frappable — l’immunité meurt AVEC le bond', () => {
    // Le même essai que « EN L'AIR », le drapeau retourné à mi-chemin : c'est la
    // preuve que l'immunité est bien attachée au VOL et non au tétras.
    const sim = makeSim()
    const { cibleId, hommeId, avant } = duel(sim)
    expect(frappeEpinglee(sim, hommeId, cibleId, true)).toBe(avant) // en l'air : rien
    const hp = frappeEpinglee(sim, hommeId, cibleId, false, COMBAT.WINDUP_TICKS * 4) // posé : touché
    expect(hp === undefined || hp < avant).toBe(true)
  })
})

describe('R21 — la hauteur du bond (ce que l’écran montre, lisible sans écran)', () => {
  it('elle vaut ZÉRO aux deux bouts et culmine au milieu', () => {
    expect(hauteurDeBond(0)).toBe(0)
    expect(hauteurDeBond(1)).toBe(0)
    expect(hauteurDeBond(0.5)).toBeCloseTo(FAUNA.VOL_HAUTEUR, 6)
  })

  it('elle est CONTINUE : aucun saut sur tout le domaine', () => {
    // Une garde exhaustive plutôt que trois points choisis : on balaie le bond
    // entier et on affirme UNE propriété — deux échantillons voisins ne peuvent
    // pas s'écarter de plus que la pente maximale de la parabole.
    const PAS = 1 / 512
    const PENTE_MAX = 4 * FAUNA.VOL_HAUTEUR * PAS * 1.001
    let precedent = hauteurDeBond(0)
    for (let f = PAS; f <= 1; f += PAS) {
      const h = hauteurDeBond(f)
      expect(Math.abs(h - precedent)).toBeLessThanOrEqual(PENTE_MAX)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(FAUNA.VOL_HAUTEUR + 1e-9)
      precedent = h
    }
  })

  it('hors vol, elle est nulle — un tétras au sol ne flotte pas', () => {
    const sim = makeSim()
    const birdId = spawnMonster(sim, 'tetras', 60.5, 60.5)
    expect(hauteurDeVol(bete(sim, birdId)!, sim.tick)).toBe(0)
  })

  it('en vol, elle décolle du sol et y revient', () => {
    const sim = makeSim()
    const { m } = leve(sim)
    expect(hauteurDeVol(m, m.volDepuis!)).toBe(0)
    expect(hauteurDeVol(m, m.volDepuis! + Math.floor(FAUNA.VOL_TICKS / 2))).toBeGreaterThan(0)
    expect(hauteurDeVol(m, m.volUntil!)).toBe(0)
  })

  it('le bond dure ce que la balance dit, en SECONDES réelles', () => {
    // Le nombre qu'on RÈGLE est une durée ressentie (la fenêtre de tir) : on
    // l'affirme en secondes, pas en ticks — sinon changer TICK_RATE_HZ changerait
    // la fenêtre sans que rien ne le dise.
    const secondes = FAUNA.VOL_TICKS / BALANCE.TICK_RATE_HZ
    expect(secondes).toBeGreaterThan(0.8)
    expect(secondes).toBeLessThan(2)
  })
})
