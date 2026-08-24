/**
 * LA PÊCHE (spec `peche.md`) — lancer, attendre, ferrer. Les critères A1-A14.
 *
 * Montage : un LAC d'essai (un bloc de profond ceint d'un anneau de haut-fond) et un coin posé
 * sur le haut-fond contre le profond ; le pêcheur sur l'herbe, à une tuile du coin. Le type du
 * nœud (rivière/lac) est posé à la main — c'est LUI qui choisit les espèces (D5), la carte
 * d'essai n'a pas de fil. Le semis réel (P3-P5) se juge à part, sur le vrai worldgen (A1).
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  FISH_SPECIES,
  FISHING,
  FOOD_VALUES,
  COOK_SLOT,
  NODE_DEFS,
  RECIPES,
  TERRAIN_DEEP_WATER,
  TERRAIN_GRASS,
  TERRAIN_SHALLOW_WATER,
  type NodeType,
} from './balance'
import { coinPris, especesDuCoin, fishingWindowTicks, type ResourceNode } from './economy'
import { drainEvents, type SimEvent } from './events'
import { estGele } from './gel'
import { countOf, type ItemId } from './items'
import { createEmptyMap, setTile, type WorldMap } from './map'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { calendarScaleForSeasonCycles, dayTicksPourJour, TICKS_PER_CYCLE } from './time'
import { createVillage, grantItems } from './village'
import { foundNpcVillage } from './worldgen'
import { desiredOrders } from './village-plan'
import { die } from './combat'
import { placeZoneNodes } from './zone-content'
import { generateZonedTerrain } from './zonegen'
import { MONDE_JOUE } from './zonegraph'

// ── LE LAC D'ESSAI ────────────────────────────────────────────────────────────
const LAC = { x0: 20, y0: 10, x1: 30, y1: 20 } // le profond, [x0, x1) × [y0, y1)
const COIN = { tx: 19, ty: 15 } // haut-fond, touche (20, 15) qui est profond
const PECHEUR = { x: 18.5, y: 15.5 } // herbe, à 1 tuile du centre du coin

function carteDEssai(): WorldMap {
  const map = createEmptyMap(60, 30, TERRAIN_GRASS)
  for (let ty = LAC.y0 - 1; ty <= LAC.y1; ty++) {
    for (let tx = LAC.x0 - 1; tx <= LAC.x1; tx++) {
      const profond = tx >= LAC.x0 && tx < LAC.x1 && ty >= LAC.y0 && ty < LAC.y1
      setTile(map, tx, ty, profond ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER)
    }
  }
  return map
}

const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)
/**
 * Le tick d'un jour de saison, de jour ou en pleine nuit (même montage que gel.test).
 *
 * ⚠ LA LONGUEUR DU JOUR EST SAISONNIÈRE (`saisons.md` S6, `dayTicksPourJour` — c'était la
 * constante `DAY_TICKS_PER_CYCLE`) : la nuit passe de 12,6 min au cœur de l'Ardeur à 23,4 min
 * à celui du Grand Froid. Le milieu de la nuit se RECALCULE donc à chaque jour — une
 * constante aurait visé le plein jour là où la glace se juge.
 */
function tickDe(jour: number, nuit = false): number {
  const base = (jour - 1) * TICKS_PER_CYCLE
  const jourTicks = dayTicksPourJour(jour)
  return base + (nuit ? jourTicks + Math.floor((TICKS_PER_CYCLE - jourTicks) / 2) : Math.floor(jourTicks / 2))
}

/**
 * LE CŒUR D'UNE SAISON, en jour de l'année — DÉRIVÉ d'`ACT_DAYS`, jamais écrit (`saisons.md`
 * S1 : quatre saisons de trente jours, 1 l'Éclosion · 2 l'Ardeur · 3 les Pluies · 4 le Grand
 * Froid).
 */
const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
/** LA SEULE FENÊTRE OÙ LE PROFOND PREND : le cœur du Grand Froid (`saisons.md` A4, « les lacs
 *  seulement en son cœur, ~j93 → j117 »). La nuit y descend à −16 °C. */
const COEUR_DU_GRAND_FROID = coeurDe(4)
/** LE DERNIER TIERS DES PLUIES : le gué a déjà pris la nuit (fenêtre ~j73 → j17) et le profond
 *  pas encore — c'est là, et seulement là, que « le lac ferme en dernier » se voit. */
const NUITS_DES_PLUIES = coeurDe(3) + BALANCE.ACT_DAYS / 5

interface Banc {
  sim: SimState
  id: number
  node: ResourceNode
}

function banc(type: NodeType = 'fishing_spot_lake', opts: { canne?: boolean; vers?: number; seed?: number; gel?: boolean; stock?: number } = {}): Banc {
  const node: ResourceNode = { id: 1, type, tx: COIN.tx, ty: COIN.ty, stock: opts.stock ?? NODE_DEFS[type].stock, regrowAt: 0 }
  const sim = createSim(opts.seed ?? 2026, {
    map: carteDEssai(),
    nodes: [node],
    faunaCap: 0,
    worldEvents: false,
    meteoActive: false,
    ...(opts.gel ? { calendarScale: SCALE } : {}),
  })
  const id = spawnEntity(sim, PECHEUR.x, PECHEUR.y)
  const e = sim.entities.find((x) => x.id === id)!
  if (opts.canne !== false) {
    grantItems(sim, id, { crude_rod: 1 })
    e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === 'crude_rod')
  }
  if (opts.vers) grantItems(sim, id, { worms: opts.vers })
  drainEvents(sim)
  return { sim, id, node: sim.nodes[0]! }
}

const entity = (b: Banc) => b.sim.entities.find((e) => e.id === b.id)!
const idle = (b: Banc): MoveInput => ({ entityId: b.id, dx: 0, dy: 0 })
const lancer = (b: Banc): void => step(b.sim, [{ ...idle(b), action: { type: 'harvest_charge_start', nodeId: b.node.id } }])
const ferrer = (b: Banc): void => step(b.sim, [{ ...idle(b), action: { type: 'harvest_release' } }])
const attendre = (b: Banc, n: number): void => {
  for (let i = 0; i < n; i++) step(b.sim, [idle(b)])
}
/** Avance jusqu'à la touche (fenêtre posée) ; rend les événements drainés en route. */
function jusquALaTouche(b: Banc, max = 400): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < max; i++) {
    out.push(...drainEvents(b.sim))
    if (entity(b).fishing?.windowEnd !== undefined) return out
    step(b.sim, [idle(b)])
  }
  throw new Error('pas de touche')
}
const des = (evs: SimEvent[], type: SimEvent['type']) => evs.filter((e) => e.type === type)

// ── A1/A2 — LE SEMIS, sur le vrai monde ──────────────────────────────────────
describe('A1/A2 — les coins de pêche existent, sont joignables, et viennent en queue', () => {
  it('rivière aux coudes, lacs contre le cœur, tous sur du haut-fond touchant le profond, en Racine, ids en queue', () => {
    const carte = generateZonedTerrain(2026, undefined, MONDE_JOUE)
    const nodes = placeZoneNodes(carte)
    const { width, height, terrain } = carte.map
    const coins = nodes.filter((n) => n.type === 'fishing_spot_river' || n.type === 'fishing_spot_lake')
    const autres = nodes.filter((n) => !(n.type === 'fishing_spot_river' || n.type === 'fishing_spot_lake'))
    expect(coins.filter((n) => n.type === 'fishing_spot_river').length).toBeGreaterThanOrEqual(1)
    expect(coins.filter((n) => n.type === 'fishing_spot_lake').length).toBeGreaterThanOrEqual(1)
    // Un monde joué n'est pas une pêcherie : une poignée sur la rivière, un à trois par lac.
    expect(coins.length).toBeLessThan(40)
    const maxAutre = Math.max(...autres.map((n) => n.id))
    for (const k of coins) {
      expect(k.id, 'en queue : aucun nœud d’avant ne bouge (P5)').toBeGreaterThan(maxAutre)
      const i = k.ty * width + k.tx
      expect(terrain[i], `coin (${k.tx},${k.ty}) sur du haut-fond`).toBe(TERRAIN_SHALLOW_WATER)
      const touche = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const x = k.tx + dx!
        const y = k.ty + dy!
        return x >= 0 && y >= 0 && x < width && y < height && terrain[y * width + x] === TERRAIN_DEEP_WATER
      })
      expect(touche, `coin (${k.tx},${k.ty}) touche le profond (P2)`).toBe(true)
      expect(carte.zone[i], 'Racine seule (D3)').toBe(carte.graphe.racine)
      expect(k.stock).toBe(FISHING.STOCK)
    }
  }, 60_000)
})

// ── A3 — SANS CANNE, PAS DE LIGNE ────────────────────────────────────────────
describe('A3 — sans canne, pas de ligne', () => {
  it('mains nues : refus, rien de tendu', () => {
    const b = banc('fishing_spot_lake', { canne: false })
    lancer(b)
    const rejets = des(drainEvents(b.sim), 'action_rejected')
    expect(rejets).toHaveLength(1)
    expect((rejets[0] as { reason: string }).reason).toBe('il faut une canne en main')
    expect(entity(b).fishing).toBeUndefined()
  })
  it('une hache en main ne lance rien non plus', () => {
    const b = banc('fishing_spot_lake', { canne: false })
    grantItems(b.sim, b.id, { crude_axe: 1 })
    entity(b).activeSlot = entity(b).inventory.findIndex((s) => s !== null && s.item === 'crude_axe')
    lancer(b)
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(1)
    expect(entity(b).fishing).toBeUndefined()
  })
  it('le coup INSTANTANÉ ne pêche pas : un `harvest` sur un coin est refusé', () => {
    const b = banc()
    step(b.sim, [{ ...idle(b), action: { type: 'harvest', nodeId: b.node.id } }])
    const rejets = des(drainEvents(b.sim), 'action_rejected')
    expect(rejets).toHaveLength(1)
    expect((rejets[0] as { reason: string }).reason).toBe('il faut lancer la ligne')
    expect(b.node.stock).toBe(FISHING.STOCK)
  })
})

// ── A4 — LE LANCER : l'appât part, l'attente se tire ─────────────────────────
describe('A4 — le lancer consomme l’appât et tire l’attente', () => {
  it('avec un ver : le sac en perd un, la touche vient vite', () => {
    const b = banc('fishing_spot_lake', { vers: 2 })
    lancer(b)
    const f = entity(b).fishing!
    expect(f).toBeDefined()
    expect(f.bait).toBe(true)
    expect(countOf(entity(b).inventory, 'worms')).toBe(1)
    expect(f.biteAt - f.castTick).toBeGreaterThanOrEqual(FISHING.WAIT_BAIT_MIN_TICKS)
    expect(f.biteAt - f.castTick).toBeLessThanOrEqual(FISHING.WAIT_BAIT_MAX_TICKS)
    expect(f.species, 'la touche ne dit pas encore ce qui mord').toBeUndefined()
  })
  it('sans ver : la ligne part quand même, la touche traîne', () => {
    const b = banc()
    lancer(b)
    const f = entity(b).fishing!
    expect(f.bait).toBe(false)
    expect(f.biteAt - f.castTick).toBeGreaterThanOrEqual(FISHING.WAIT_NOBAIT_MIN_TICKS)
    expect(f.biteAt - f.castTick).toBeLessThanOrEqual(FISHING.WAIT_NOBAIT_MAX_TICKS)
    expect(FISHING.WAIT_NOBAIT_MIN_TICKS, 'l’appât PRESSE : la fourchette lente commence où la rapide finit').toBeGreaterThanOrEqual(FISHING.WAIT_BAIT_MAX_TICKS)
  })
  it('une ligne déjà tendue ne se relance pas (le maintien est muet)', () => {
    const b = banc('fishing_spot_lake', { vers: 3 })
    lancer(b)
    const avant = { ...entity(b).fishing! }
    step(b.sim, [{ ...idle(b), action: { type: 'harvest_charge_start', nodeId: b.node.id, hold: true } }])
    expect(entity(b).fishing).toEqual(avant)
    expect(countOf(entity(b).inventory, 'worms'), 'un seul ver parti').toBe(2)
  })
})

// ── A5 — LA TOUCHE ────────────────────────────────────────────────────────────
describe('A5 — la touche est un événement, et la fenêtre suit', () => {
  it('à biteAt : un fish_bite exactement, espèce posée, fenêtre = celle de l’espèce à niveau 0', () => {
    const b = banc()
    lancer(b)
    const { biteAt } = entity(b).fishing!
    const evs = jusquALaTouche(b)
    const touches = des(evs, 'fish_bite')
    expect(touches).toHaveLength(1)
    expect(touches[0]!.tick).toBe(biteAt)
    const f = entity(b).fishing!
    expect(f.species).toBeDefined()
    const sp = FISH_SPECIES.find((s) => s.id === f.species)!
    expect(f.windowEnd! - biteAt).toBe(fishingWindowTicks(sp, 0))
    expect(touches[0]).not.toHaveProperty('species')
  })
})

// ── A6 — FERRER DANS LA FENÊTRE ──────────────────────────────────────────────
describe('A6 — ferrer dans la fenêtre = un poisson, un seul', () => {
  it('+1 de l’espèce, stock −1, fish_caught ET resource_harvested, XP hunting, canne usée', () => {
    const b = banc('fishing_spot_lake', { vers: 1 })
    lancer(b)
    jusquALaTouche(b)
    const f = entity(b).fishing!
    const sp = FISH_SPECIES.find((s) => s.id === f.species)!
    const wearAvant = entity(b).inventory[entity(b).activeSlot!]!.wear ?? 0
    step(b.sim, [idle(b)]) // un tick dans la fenêtre
    ferrer(b)
    const evs = drainEvents(b.sim)
    expect(countOf(entity(b).inventory, sp.item)).toBe(1)
    expect(b.node.stock).toBe(FISHING.STOCK - 1)
    const prises = des(evs, 'fish_caught') as Extract<SimEvent, { type: 'fish_caught' }>[]
    expect(prises).toHaveLength(1)
    expect(prises[0]!.species).toBe(sp.id)
    expect(prises[0]!.item).toBe(sp.item)
    const recoltes = des(evs, 'resource_harvested') as Extract<SimEvent, { type: 'resource_harvested' }>[]
    expect(recoltes).toHaveLength(1)
    expect(recoltes[0]!.count).toBe(1)
    expect(entity(b).skills.hunting ?? 0).toBeGreaterThan(0)
    expect(entity(b).inventory[entity(b).activeSlot!]!.wear ?? 0).toBeGreaterThan(wearAvant)
    expect(entity(b).fishing).toBeUndefined()
  })
  it('le ferrage au DERNIER tick de la fenêtre compte encore (borne incluse)', () => {
    const b = banc()
    lancer(b)
    jusquALaTouche(b)
    const f = entity(b).fishing!
    attendre(b, f.windowEnd! - b.sim.tick)
    expect(b.sim.tick).toBe(f.windowEnd)
    ferrer(b)
    expect(des(drainEvents(b.sim), 'fish_caught')).toHaveLength(1)
  })
  it('sac plein : le poisson est perdu, rien d’autre ne bouge', () => {
    const b = banc()
    const e = entity(b)
    for (let i = 0; i < e.inventory.length; i++) if (e.inventory[i] === null) e.inventory[i] = { item: 'stone', count: 1 }
    lancer(b)
    jusquALaTouche(b)
    ferrer(b)
    const evs = drainEvents(b.sim)
    expect(des(evs, 'fish_caught')).toHaveLength(0)
    expect((des(evs, 'action_rejected')[0] as { reason: string }).reason).toBe('sac plein')
    expect(b.node.stock).toBe(FISHING.STOCK)
  })
})

// ── A7 — TROP TÔT, TROP TARD ─────────────────────────────────────────────────
describe('A7 — trop tôt = muet, trop tard = le poisson file', () => {
  it('relâcher avant la touche : ligne rentrée, aucun événement, l’appât est parti', () => {
    const b = banc('fishing_spot_lake', { vers: 1 })
    lancer(b)
    attendre(b, 5)
    ferrer(b)
    expect(entity(b).fishing).toBeUndefined()
    expect(drainEvents(b.sim).filter((e) => e.type.startsWith('fish_'))).toHaveLength(0)
    expect(countOf(entity(b).inventory, 'worms')).toBe(0)
    expect(b.node.stock).toBe(FISHING.STOCK)
  })
  it('ne pas ferrer : à windowEnd + 1, fish_escaped, sac inchangé, ligne rentrée', () => {
    const b = banc()
    lancer(b)
    jusquALaTouche(b)
    const { windowEnd } = entity(b).fishing!
    attendre(b, windowEnd! - b.sim.tick + 1)
    const evs = drainEvents(b.sim)
    const fuites = des(evs, 'fish_escaped')
    expect(fuites).toHaveLength(1)
    expect(fuites[0]!.tick).toBe(windowEnd! + 1)
    expect(entity(b).fishing).toBeUndefined()
    for (const sp of FISH_SPECIES) expect(countOf(entity(b).inventory, sp.item)).toBe(0)
    expect(b.node.stock).toBe(FISHING.STOCK)
    // Et ferrer APRÈS la fuite est muet.
    ferrer(b)
    expect(des(drainEvents(b.sim), 'fish_caught')).toHaveLength(0)
  })
})

// ── A8 — L'EAU CHOISIT L'ESPÈCE ──────────────────────────────────────────────
describe('A8 — l’eau choisit l’espèce', () => {
  /** 120 touches sans ferrer (la fuite ne coûte pas de stock) : les espèces qui mordent. */
  function especesMordues(type: NodeType, seed: number): Set<string> {
    const b = banc(type, { seed })
    const vues = new Set<string>()
    for (let i = 0; i < 120; i++) {
      lancer(b)
      jusquALaTouche(b)
      vues.add(entity(b).fishing!.species!)
      const { windowEnd } = entity(b).fishing!
      attendre(b, windowEnd! - b.sim.tick + 1)
      drainEvents(b.sim)
    }
    return vues
  }
  it('la table : le goujon partout, la truite en rivière, le brochet au lac', () => {
    expect(especesDuCoin('fishing_spot_river').map((s) => s.id)).toEqual(['gudgeon', 'trout'])
    expect(especesDuCoin('fishing_spot_lake').map((s) => s.id)).toEqual(['gudgeon', 'pike'])
  })
  it('en rivière, jamais de brochet ; au lac, jamais de truite ; le goujon des deux', () => {
    const riv = especesMordues('fishing_spot_river', 11)
    const lac = especesMordues('fishing_spot_lake', 12)
    expect(riv.has('pike')).toBe(false)
    expect(lac.has('trout')).toBe(false)
    expect(riv.has('gudgeon')).toBe(true)
    expect(lac.has('gudgeon')).toBe(true)
    expect(riv.has('trout'), 'la truite mord bien (3/10)').toBe(true)
    expect(lac.has('pike'), 'le brochet mord (1/8 sur 120 touches)').toBe(true)
  }, 30_000)
})

// ── A9 — LA MAÎTRISE ÉLARGIT ─────────────────────────────────────────────────
describe('A9 — la maîtrise élargit la fenêtre, plafonnée', () => {
  it('fenêtre(brochet, 4) > fenêtre(brochet, 0), et jamais plus que WINDOW_CAP ×', () => {
    const pike = FISH_SPECIES.find((s) => s.id === 'pike')!
    expect(fishingWindowTicks(pike, 4)).toBeGreaterThan(fishingWindowTicks(pike, 0))
    expect(fishingWindowTicks(pike, 0)).toBe(pike.windowTicks)
    expect(fishingWindowTicks(pike, 100)).toBe(Math.floor(pike.windowTicks * FISHING.WINDOW_CAP))
    for (let lv = 0; lv < 30; lv++) expect(fishingWindowTicks(pike, lv + 1)).toBeGreaterThanOrEqual(fishingWindowTicks(pike, lv))
  })
  it('le niveau hunting de l’acteur est bien celui qui compte à la touche', () => {
    const b = banc()
    entity(b).skills.hunting = 100 * 16 // niveau 4
    lancer(b)
    jusquALaTouche(b)
    const f = entity(b).fishing!
    const sp = FISH_SPECIES.find((s) => s.id === f.species)!
    expect(f.windowEnd! - f.biteAt).toBe(fishingWindowTicks(sp, 4))
  })
})

// ── A10 — LA GLACE FERME ─────────────────────────────────────────────────────
describe('A10 — la glace ferme, le lac en dernier, et le stock repousse dessous', () => {
  it('cœur du Grand Froid, de nuit (le profond est pris) : lancer refusé « l’eau est prise »', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(COEUR_DU_GRAND_FROID, true)
    expect(coinPris(b.sim, b.node)).toBe(true)
    lancer(b)
    const rejets = des(drainEvents(b.sim), 'action_rejected')
    expect(rejets).toHaveLength(1)
    expect((rejets[0] as { reason: string }).reason).toBe("l'eau est prise")
    expect(entity(b).fishing).toBeUndefined()
  })
  it('fin des Pluies, de nuit (le gué prend, le profond non) : le coin se pêche encore — c’est le PROFOND qui compte', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(NUITS_DES_PLUIES, true)
    // LA PRÉMISSE D'ABORD : sans un gué RÉELLEMENT pris, ce cas passerait au vert sur une nuit
    // tiède et ne dirait plus rien du « lac en dernier ». Le socle est une courbe (`saisons.md`
    // S4) : la fenêtre où le gué gèle sans le profond n'est plus un numéro d'acte, elle se prouve.
    expect(estGele(b.sim, COIN.tx, COIN.ty), 'le gué du coin, lui, a bien pris').toBe(true)
    expect(coinPris(b.sim, b.node)).toBe(false)
    lancer(b)
    expect(entity(b).fishing).toBeDefined()
  })
  it('un coin vidé repousse SOUS la glace : au dégel, il rouvre plein', () => {
    const b = banc('fishing_spot_lake', { gel: true, stock: 0 })
    b.sim.tick = tickDe(COEUR_DU_GRAND_FROID, true)
    b.node.regrowAt = b.sim.tick + 5
    attendre(b, 6)
    expect(b.node.stock).toBe(FISHING.STOCK)
  })
})

// ── A11 — BOUGER RENTRE LA LIGNE ─────────────────────────────────────────────
describe('A11 — bouger rentre la ligne', () => {
  it('un pas pendant l’attente : fishing effacé, aucun événement de pêche', () => {
    const b = banc()
    lancer(b)
    attendre(b, 3)
    step(b.sim, [{ entityId: b.id, dx: -1, dy: 0 }])
    expect(entity(b).fishing).toBeUndefined()
    expect(drainEvents(b.sim).filter((e) => e.type.startsWith('fish_'))).toHaveLength(0)
  })
  it('le tick du lancer lui-même tolère le pas (on clique en finissant un pas)', () => {
    const b = banc()
    step(b.sim, [{ entityId: b.id, dx: -1, dy: 0, action: { type: 'harvest_charge_start', nodeId: b.node.id } }])
    expect(entity(b).fishing).toBeDefined()
  })
})

// ── A12 — DÉTERMINISME ───────────────────────────────────────────────────────
describe('A12 — même seed + mêmes inputs = mêmes prises, mêmes événements', () => {
  function partie(): { snap: string; evs: string } {
    const b = banc('fishing_spot_lake', { vers: 3, seed: 77 })
    const evs: SimEvent[] = []
    for (let i = 0; i < 3; i++) {
      lancer(b)
      evs.push(...jusquALaTouche(b))
      step(b.sim, [idle(b)])
      ferrer(b)
      evs.push(...drainEvents(b.sim))
    }
    return { snap: snapshot(b.sim), evs: JSON.stringify(evs) }
  }
  it('deux parties identiques', () => {
    const a = partie()
    const c = partie()
    expect(a.snap).toBe(c.snap)
    expect(a.evs).toBe(c.evs)
    expect(JSON.parse(a.evs).filter((e: SimEvent) => e.type === 'fish_caught').length).toBe(3)
  })
})

// ── A13 — LE POISSON SE CUIT ET SE MANGE ─────────────────────────────────────
describe('A13 — le poisson se cuit au Feu et se mange', () => {
  it('chaque espèce a sa cuisson au feu, sa valeur crue et cuite, et la cuite nourrit plus', () => {
    for (const sp of FISH_SPECIES) {
      const cuisson = COOK_SLOT.fire![sp.item]
      expect(cuisson, `${sp.id} se cuit`).toBeDefined()
      expect(FOOD_VALUES[sp.item]).toBeGreaterThan(0)
      expect(FOOD_VALUES[cuisson!.output]!).toBeGreaterThan(FOOD_VALUES[sp.item]!)
    }
  })
  it('manger un brochet cuit rend FOOD_VALUES', () => {
    const b = banc()
    const e = entity(b)
    e.hunger = 10
    grantItems(b.sim, b.id, { cooked_pike: 1 })
    step(b.sim, [{ ...idle(b), action: { type: 'eat', item: 'cooked_pike' } }])
    expect(e.hunger).toBeGreaterThan(10)
    expect(countOf(e.inventory, 'cooked_pike')).toBe(0)
  })
  it('la canne se fabrique à la main, bois + corde', () => {
    const r = RECIPES.crude_rod
    expect(r.requiert).toBeNull()
    expect(r.inputs).toEqual({ wood: 1, rope: 1 })
    const b = banc('fishing_spot_lake', { canne: false })
    grantItems(b.sim, b.id, { wood: 1, rope: 1 })
    step(b.sim, [{ ...idle(b), action: { type: 'craft', recipeId: 'crude_rod' } }])
    attendre(b, r.seconds * BALANCE.TICK_RATE_HZ + 2)
    expect(countOf(entity(b).inventory, 'crude_rod' as ItemId)).toBe(1)
  })
})

// ── A14 — LE COIN DÉRIVE SUR L'EAU ───────────────────────────────────────────
describe('A14 — le coin vidé dérive sur l’eau, jamais sur la terre', () => {
  it('six prises vident le coin ; il se relocalise sur du haut-fond (ou reste), avec une repousse datée', () => {
    const b = banc('fishing_spot_lake', { vers: 10 })
    let prises = 0
    for (let i = 0; i < 12 && b.node.stock > 0; i++) {
      lancer(b)
      jusquALaTouche(b)
      ferrer(b)
      prises += des(drainEvents(b.sim), 'fish_caught').length
      attendre(b, BALANCE.GATHER_COOLDOWN_TICKS)
    }
    expect(prises).toBe(FISHING.STOCK)
    expect(b.node.stock).toBe(0)
    expect(b.node.regrowAt).toBeGreaterThan(b.sim.tick)
    const t = b.sim.map.terrain[b.node.ty * b.sim.map.width + b.node.tx]
    expect(t).toBe(TERRAIN_SHALLOW_WATER)
    // Et le coin vide refuse la ligne, avec ses mots à lui.
    lancer(b)
    expect((des(drainEvents(b.sim), 'action_rejected')[0] as { reason: string }).reason).toBe('rien ne mord ici')
  })
})

// ── LES DEUX DÉFAUTS DE LA RELECTURE DÉTERMINISME (2026-08-22) ───────────────
describe('la cour d’un village PNJ ne défriche pas l’eau', () => {
  it('un coin de pêche à portée du Feu ne produit AUCUN ordre de défriche — le chantier ne se bloque pas', () => {
    // Le PNJ exécute une défriche par `harvest`, refusé sur un coin (il faut lancer la ligne) sans
    // lâcher la corvée : 5 929 refus en 6 000 ticks mesurés, et tout le chantier à l'arrêt.
    const map = createEmptyMap(28, 28, TERRAIN_GRASS)
    setTile(map, 15, 12, TERRAIN_SHALLOW_WATER)
    setTile(map, 16, 12, TERRAIN_DEEP_WATER)
    const sim = createSim(11, {
      map,
      nodes: [
        { id: 1, type: 'tree', tx: 14, ty: 14, stock: 5, regrowAt: 0 },
        { id: 2, type: 'fishing_spot_lake', tx: 15, ty: 12, stock: FISHING.STOCK, regrowAt: 0 },
      ],
      worldEvents: false,
      faunaCap: 0,
    })
    foundNpcVillage(sim, 12, 12, 3)
    const v = sim.villages[0]!
    v.buildTier = 3
    const defriches = desiredOrders(sim, v).filter((o) => o.action === 'defriche') as { tx: number; ty: number }[]
    expect(defriches.some((o) => o.tx === 14 && o.ty === 14), 'la prémisse : l’arbre de la cour, lui, se défriche').toBe(true)
    expect(defriches.some((o) => o.tx === 15 && o.ty === 12), 'le coin de pêche, jamais').toBe(false)
  })
})

describe('la mort lâche la ligne', () => {
  it('un pêcheur qui meurt respawne sans ligne ni jauge : aucune touche ne lui arrive au Feu', () => {
    const b = banc()
    // Un village pour le respawn (sinon `die` respawne au point d'apparition, ce qui revient au même).
    createVillage(b.sim, { chiefId: b.id, tx: 40, ty: 5, npcsArrived: true })
    lancer(b)
    expect(entity(b).fishing).toBeDefined()
    die(b.sim, entity(b), 0, 'cold')
    expect(entity(b).fishing).toBeUndefined()
    expect(entity(b).harvestCharge).toBeUndefined()
    drainEvents(b.sim)
    attendre(b, FISHING.WAIT_NOBAIT_MAX_TICKS + 5)
    expect(drainEvents(b.sim).filter((e) => e.type.startsWith('fish_'))).toHaveLength(0)
  })
})

describe('la touche n’annonce pas un coin vide', () => {
  it('le coin vidé entre le lancer et la touche : la ligne rentre, sans fish_bite', () => {
    const b = banc()
    lancer(b)
    b.node.stock = 0 // un autre pêcheur a pris le dernier (multi)
    attendre(b, FISHING.WAIT_NOBAIT_MAX_TICKS + 5)
    expect(entity(b).fishing).toBeUndefined()
    expect(drainEvents(b.sim).filter((e) => e.type === 'fish_bite')).toHaveLength(0)
  })
})
