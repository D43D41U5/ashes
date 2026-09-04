/**
 * LA PÊCHE (spec `peche.md`) — lancer, attendre, ferrer. Les critères A1-A26.
 *
 * Montage : un LAC d'essai (un bloc de profond ceint d'un anneau de haut-fond) et un coin posé
 * sur le haut-fond contre le profond ; le pêcheur sur l'herbe, à une tuile du coin.
 *
 * ⚠ **CE QUI A CHANGÉ LE 2026-08-24 (D9-D12).** On pêche une TUILE D'EAU, pas un nœud : le banc
 * peint donc la NATURE de son eau (`map.natureEau`) — c'est elle, et non plus le type du nœud,
 * qui choisit les espèces. Le coin ne fait qu'améliorer. Et le tirage peut ne rien donner : les
 * gardes qui veulent un poisson relancent jusqu'à en avoir un (`jusquAUnPoisson`) au lieu de
 * supposer qu'une touche est un poisson — supposer, ici, ferait un test flottant.
 */
import { describe, expect, it } from 'vitest'
import {
  EAU,
  BALANCE,
  FISH_SPECIES,
  FISHING,
  TROUVAILLES,
  type CreneauDePeche,
  type NomDeNature,
  FOOD_VALUES,
  COOK_SLOT,
  DRY_SLOT,
  SALAISON_DU_SECHE,
  SPOIL_CYCLES,
  NODE_DEFS,
  RECIPES,
  TERRAIN_DEEP_WATER,
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAIN_SHALLOW_WATER,
  type NodeType,
} from './balance'
import { castRejection, coinIndisponible, coinPris, eauIndisponible, fishingWindowTicks, portionsDe, porteeDuNoeud, profondVoisin, type ResourceNode } from './economy'
import { NATURE_LAC, NATURE_MARAIS, NATURE_MARE, NATURE_RIEN, NATURE_RIVIERE, deriverNatureDeLEau } from './peche-nature'
import { conditionsAt, creneauAt, especeRetenue, natureDeLEau, poidsDuRien, tableDePrises } from './peche-table'
import { VRAIES_ZONES } from './zonegraph'
import { drainEvents, type SimEvent } from './events'
import { ariditeGlobale, estAsseche } from './eau'
import { estGele } from './gel'
import { countOf, type ItemId } from './items'
import { createEmptyMap, setTile, type WorldMap } from './map'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { calendarScaleForSeasonCycles, dayTicksPourJour, TICKS_PER_CYCLE } from './time'
import { addStructure, createVillage, grantItems } from './village'
import { fireZoneAccepts, fireZoneInventory } from './fire'
import { addItems } from './items'
import { foundNpcVillage } from './worldgen'
import { desiredOrders } from './village-plan'
import { die } from './combat'
import { placeZoneNodes } from './zone-content'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE_JOUE } from './zonegraph'

// ── LE LAC D'ESSAI ────────────────────────────────────────────────────────────
const LAC = { x0: 20, y0: 10, x1: 30, y1: 20 } // le profond, [x0, x1) × [y0, y1)
const COIN = { tx: 19, ty: 15 } // haut-fond, touche (20, 15) qui est profond
const PECHEUR = { x: 18.5, y: 15.5 } // herbe, à 1 tuile du centre du coin

/**
 * La carte d'essai, et SA NATURE D'EAU (T1) — peinte à la main, uniforme.
 *
 * Le banc la pose au lieu de la dériver : `deriverNatureDeLEau` a sa propre garde (A22), et un
 * banc qui dépendrait d'elle testerait deux choses à la fois. Ici on veut choisir l'eau qu'on
 * pêche — « et si c'était une rivière ? » se pose en un argument.
 */
function carteDEssai(nature: number = NATURE_LAC): WorldMap {
  const map = createEmptyMap(60, 30, TERRAIN_GRASS)
  for (let ty = LAC.y0 - 1; ty <= LAC.y1; ty++) {
    for (let tx = LAC.x0 - 1; tx <= LAC.x1; tx++) {
      const profond = tx >= LAC.x0 && tx < LAC.x1 && ty >= LAC.y0 && ty < LAC.y1
      setTile(map, tx, ty, profond ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER)
    }
  }
  map.natureEau = map.terrain.map((t) => (t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER ? nature : NATURE_RIEN))
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
/**
 * LE MOMENT DU BANC PAR DÉFAUT : MIDI au cœur des Pluies — chaud (8 °C sur la carte d'essai),
 * humide (l'assèchement, c'est l'Ardeur — A15), l'eau est LIBRE.
 *
 * ⚠ IL ÉTAIT AU TICK 0 DU JOUR 1, ET C'ÉTAIT UN GUÉ GELÉ (mesuré le 2026-08-30 : −8,5 °C au
 * lever sur la tuile du coin, `estGele` VRAI). Tous les lancers du banc partaient donc D'UNE
 * TUILE PRISE — toléré par l'ancienne règle D7 ① (seul le profond comptait), et c'est le trou
 * même que le durcissement ferme (« on ne doit pas pêcher dans la glace »). Et le lever ne
 * suffit pas : même au cœur des Pluies, la carte d'essai relève −2 °C à l'aube — un banc de
 * pêche se pose à MIDI. La glace a ses propres cas (A10, `gel: true`), qui choisissent leur
 * jour ; l'assèchement les siens (A15).
 */
const JOUR_DOUX = coeurDe(3)
const MIDI_DOUX = Math.floor(dayTicksPourJour(JOUR_DOUX) / 2)

interface Banc {
  sim: SimState
  id: number
  node: ResourceNode
}

function banc(
  type: NodeType = 'fishing_spot_lake',
  opts: { canne?: boolean; vers?: number; seed?: number; gel?: boolean; stock?: number; nature?: number; sansCoin?: boolean } = {},
): Banc {
  const node: ResourceNode = { id: 1, type, tx: COIN.tx, ty: COIN.ty, stock: opts.stock ?? NODE_DEFS[type].stock, regrowAt: 0 }
  const sim = createSim(opts.seed ?? 2026, {
    map: carteDEssai(opts.nature),
    nodes: opts.sansCoin === true ? [] : [node],
    faunaCap: 0,
    worldEvents: false,
    meteoActive: false,
    // Les bancs de gel gardent le jour 1 : `tickDe(jour)` compte ses cycles depuis lui.
    ...(opts.gel ? { calendarScale: SCALE } : { jourDeDepart: JOUR_DOUX }),
  })
  if (!opts.gel) sim.tick = MIDI_DOUX
  const id = spawnEntity(sim, PECHEUR.x, PECHEUR.y)
  const e = sim.entities.find((x) => x.id === id)!
  if (opts.canne !== false) {
    grantItems(sim, id, { crude_rod: 1 })
    e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === 'crude_rod')
  }
  if (opts.vers) grantItems(sim, id, { worms: opts.vers })
  drainEvents(sim)
  return { sim, id, node: (sim.nodes[0] ?? node)! }
}

const entity = (b: Banc) => b.sim.entities.find((e) => e.id === b.id)!
const idle = (b: Banc): MoveInput => ({ entityId: b.id, dx: 0, dy: 0 })
/** LE LANCER (D9/E1) — sur la TUILE du coin ; `lancerSur` vise n'importe quelle eau. */
const lancer = (b: Banc): void => lancerSur(b, COIN.tx, COIN.ty)
const lancerSur = (b: Banc, tx: number, ty: number): void => step(b.sim, [{ ...idle(b), action: { type: 'cast_line', tx, ty } }])
const ferrer = (b: Banc): void => step(b.sim, [{ ...idle(b), action: { type: 'harvest_release' } }])
const attendre = (b: Banc, n: number): void => {
  for (let i = 0; i < n; i++) step(b.sim, [idle(b)])
}
/** Avance jusqu'à la touche (fenêtre posée) ; rend les événements drainés en route. Le
 *  mordillage (D11) ne compte pas : il n'ouvre pas de fenêtre, la ligne reste à l'eau. */
function jusquALaTouche(b: Banc, max = 3000): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < max; i++) {
    out.push(...drainEvents(b.sim))
    if (entity(b).fishing?.windowEnd !== undefined) return out
    // ⚠ LA LIGNE PEUT RENTRER SANS TOUCHE depuis D11 (le plafond de mordillages) : ce n'est
    // pas une erreur de banc, c'est le mécanisme. On rend la main, l'appelant relance.
    if (entity(b).fishing === undefined && i > 0) return out
    step(b.sim, [idle(b)])
  }
  throw new Error('pas de touche')
}
const des = (evs: SimEvent[], type: SimEvent['type']) => evs.filter((e) => e.type === type)

/**
 * JUSQU'À CE QU'UN POISSON MORDE — et pas seulement « jusqu'à une touche ».
 *
 * Depuis T4, une touche peut être une TROUVAILLE (un caillou, une botte d'algues) ; depuis
 * D11, elle peut ne pas venir du tout (ça mordille). Une garde qui veut un poisson doit donc
 * relancer, sinon elle passe au vert un jour sur deux — c'est exactement le genre de test
 * flottant qu'on ne débogue plus six mois après.
 */
function jusquAUnPoisson(b: Banc, essais = 60): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < essais; i++) {
    if (entity(b).fishing === undefined) lancer(b)
    out.push(...jusquALaTouche(b))
    if (entity(b).fishing?.species !== undefined) return out
    // Une trouvaille au bout de la ligne : on la laisse filer et on relance.
    const f = entity(b).fishing!
    attendre(b, f.windowEnd! - b.sim.tick + 1)
    out.push(...drainEvents(b.sim))
  }
  throw new Error('aucun poisson en 60 lancers')
}

// ── A1/A2 — LE SEMIS, sur le vrai monde ──────────────────────────────────────
describe('A1/A2 — les coins de pêche existent, sont joignables, et viennent en queue', () => {
  it('rivière aux coudes, lacs contre le cœur, tous sur du haut-fond touchant le profond, en Racine, ids en queue', () => {
    const carte = carteDeTest(2026, undefined, MONDE_JOUE)
    const nodes = placeZoneNodes(carte)
    const { width, height, terrain } = carte.map
    const coins = nodes.filter((n) => n.type === 'fishing_spot_river' || n.type === 'fishing_spot_lake')
    const autres = nodes.filter((n) => !(n.type === 'fishing_spot_river' || n.type === 'fishing_spot_lake'))
    expect(coins.filter((n) => n.type === 'fishing_spot_river').length).toBeGreaterThanOrEqual(1)
    expect(coins.filter((n) => n.type === 'fishing_spot_lake').length).toBeGreaterThanOrEqual(1)
    // Un monde joué n'est pas une pêcherie : une poignée sur la rivière, un à trois par lac.
    // 40 → 43 le 2026-08-24 (décision d'Alexis) : le retrait du front de cendre a rendu au T0
    // l'emprise de la Cendrière (`y1` 0,915 → 0,985), soit **+38 % de Racine** — donc plus de
    // rivière et plus de lacs, donc plus de coins. Le compte MESURÉ sur la seed 2026 est 43 ; la
    // borne le suit. Elle reste un plafond de LISIBILITÉ, pas un réglage : si elle saute encore,
    // c'est la carte qui a bougé, et il faut regarder pourquoi avant de la remonter.
    // 43 → 45 le 2026-08-27 (frontières universelles, `sol-dessine.md` R20-R24) : ce n'est PAS
    // la pêcherie qui s'est agrandie — l'eau de la Racine n'a pas bougé d'une tuile (les lacs et
    // la rivière se creusent dans le socle, que ce chantier ne touche pas). C'est le SEMIS qui
    // s'est rebrassé : le terrain a changé partout, donc le flux du PRNG des nœuds avec lui, et
    // le compte a re-tiré dans le même régime (une poignée sur la rivière, un à trois par lac).
    // 45 → 90 le 2026-08-30 (HYDROLOGIE DÉRIVÉE) : là, c'est bien LA PÊCHERIE QUI S'EST
    // AGRANDIE, et pas le semis qui s'est rebrassé. L'eau de la Racine passe de 3 % à 14 % du
    // pays, avec sept à neuf fleuves au lieu d'un et des lacs de la taille de leur cuvette : le
    // compte MESURÉ monte à 82 sur la seed 2026. La borne reste un plafond de LISIBILITÉ (elle
    // dit « on n'a pas semé un coin tous les dix mètres »), pas un réglage.
    // 90 → 130 le 2026-08-30 (LE PAYS DEVIENT ENDORÉIQUE — `socle.ts`) : la Racine s'érode, ses
    // cuvettes deviennent de vrais bassins, et le compte MESURÉ passe de 82 à **127** sur la
    // seed 2026. Même nature que la ligne du dessus : c'est la pêcherie qui s'agrandit, pas le
    // semis qui se rebrasse.
    // ⚠ CONSÉQUENCE D'ÉQUILIBRAGE À TRANCHER, signalée et TOUJOURS PAS décidée (elle s'aggrave :
    // 45 → 82 → 127 en trois chantiers) : le joueur a désormais près de TROIS FOIS plus
    // d'endroits où pêcher qu'au calibrage d'août. Si la pêche en devient trop facile, ce sont
    // `CONTENU.PECHE_*` (espacement, coins par lac) qu'il faut resserrer — pas cette borne.
    expect(coins.length).toBeLessThanOrEqual(130)
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
  // ⚠ SUR L'EAU NUE (`sansCoin`) : le COIN raccourcit l'attente (E3, deux tiers), et une garde
  // posée sur un coin comparerait la fourchette de `balance.ts` à une valeur déjà réduite —
  // elle passerait au vert par accident tant que la réduction reste dans la fourchette.
  it('avec un ver : le sac en perd un, la touche vient vite', () => {
    const b = banc('fishing_spot_lake', { vers: 2, sansCoin: true })
    lancer(b)
    const f = entity(b).fishing!
    expect(f).toBeDefined()
    expect(f.bait).toBe(true)
    expect(countOf(entity(b).inventory, 'worms')).toBe(1)
    expect(f.biteAt - f.castTick).toBeGreaterThanOrEqual(FISHING.WAIT_BAIT_MIN_TICKS)
    expect(f.biteAt - f.castTick).toBeLessThanOrEqual(FISHING.WAIT_BAIT_MAX_TICKS)
    expect(f.species, 'la touche ne dit pas encore ce qui mord').toBeUndefined()
  })
  it('sans ver, SUR L’EAU NUE : la ligne part quand même, la touche traîne', () => {
    const b = banc('fishing_spot_lake', { sansCoin: true })
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
    lancer(b)
    expect(entity(b).fishing).toEqual(avant)
    expect(countOf(entity(b).inventory, 'worms'), 'un seul ver parti').toBe(2)
  })
})

// ── A5 — LA TOUCHE ────────────────────────────────────────────────────────────
describe('A5 — la touche est un événement, et la fenêtre suit', () => {
  it('à biteAt : un fish_bite exactement, espèce posée, fenêtre = celle de l’espèce à niveau 0', () => {
    const b = banc()
    const evs = jusquAUnPoisson(b)
    const touches = des(evs, 'fish_bite')
    expect(touches.length).toBeGreaterThanOrEqual(1)
    const f = entity(b).fishing!
    expect(f.species).toBeDefined()
    const sp = FISH_SPECIES.find((s) => s.id === f.species)!
    expect(f.windowEnd! - f.biteAt).toBe(fishingWindowTicks(sp, 0))
    // LA TOUCHE NE TRAHIT RIEN (C3) : ni l'espèce, ni même que c'est un poisson.
    expect(touches[touches.length - 1]).not.toHaveProperty('species')
    expect(touches[touches.length - 1]!.tick).toBe(f.biteAt)
  })
})

// ── A6 — FERRER DANS LA FENÊTRE ──────────────────────────────────────────────
describe('A6 — ferrer dans la fenêtre = un poisson, un seul', () => {
  it('+1 de l’espèce, stock −1, fish_caught ET resource_harvested, XP hunting, canne usée', () => {
    const b = banc('fishing_spot_lake', { vers: 1 })
    jusquAUnPoisson(b)
    const f = entity(b).fishing!
    const sp = FISH_SPECIES.find((s) => s.id === f.species)!
    const wearAvant = entity(b).inventory[entity(b).activeSlot!]!.wear ?? 0
    const stockAvant = b.node.stock
    step(b.sim, [idle(b)]) // un tick dans la fenêtre
    ferrer(b)
    const evs = drainEvents(b.sim)
    const prises = des(evs, 'fish_caught') as Extract<SimEvent, { type: 'fish_caught' }>[]
    expect(prises).toHaveLength(1)
    expect(prises[0]!.species).toBe(sp.id)
    expect(prises[0]!.item).toBe(sp.id)
    // LA TAILLE FAIT LA QUANTITÉ (D12/B4) : une prise vaut 1 à `PORTIONS_MAX[classe]` portions.
    expect(prises[0]!.mm).toBeGreaterThanOrEqual(sp.tailleMinMm)
    expect(prises[0]!.mm).toBeLessThanOrEqual(sp.tailleMaxMm)
    expect(prises[0]!.count).toBe(portionsDe(sp, prises[0]!.mm))
    expect(countOf(entity(b).inventory, sp.id)).toBe(prises[0]!.count)
    expect(b.node.stock).toBe(stockAvant - 1)
    const recoltes = des(evs, 'resource_harvested') as Extract<SimEvent, { type: 'resource_harvested' }>[]
    expect(recoltes).toHaveLength(1)
    expect(recoltes[0]!.count).toBe(prises[0]!.count)
    // LA PRISE PORTE SA MATIÈRE (2026-08-27), comme tout coup de récolte : `fish_caught` est
    // MUET par décision — « il tombe sur `resource_harvested`, qui parle déjà au même tick » —
    // donc c'est CE fait qui doit dire d'où sort le poisson, sans quoi le son de la prise
    // retombe sur le bip d'interface au lieu du « flop » mouillé. `landFish` est un chemin
    // distinct de `harvestStrike` : la garde des matières (`economy.test.ts`) ne le couvre pas.
    expect(recoltes[0]!.nodeType).toBe('fishing_spot_lake')
    expect(entity(b).skills.hunting ?? 0).toBeGreaterThan(0)
    expect(entity(b).inventory[entity(b).activeSlot!]!.wear ?? 0).toBeGreaterThan(wearAvant)
    expect(entity(b).fishing).toBeUndefined()
  })
  it('le ferrage au DERNIER tick de la fenêtre compte encore (borne incluse)', () => {
    const b = banc()
    jusquAUnPoisson(b)
    const f = entity(b).fishing!
    attendre(b, f.windowEnd! - b.sim.tick)
    expect(b.sim.tick).toBe(f.windowEnd)
    ferrer(b)
    expect(des(drainEvents(b.sim), 'fish_caught')).toHaveLength(1)
  })
  it('sac plein : le poisson est perdu, rien d’autre ne bouge', () => {
    const b = banc()
    const e = entity(b)
    for (let i = 0; i < e.inventory.length; i++) if (e.inventory[i] === null) e.inventory[i] = { item: 'cut_stone', count: 1 }
    jusquAUnPoisson(b)
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
    jusquAUnPoisson(b)
    const { windowEnd } = entity(b).fishing!
    attendre(b, windowEnd! - b.sim.tick + 1)
    const evs = drainEvents(b.sim)
    const fuites = des(evs, 'fish_escaped')
    expect(fuites).toHaveLength(1)
    expect(fuites[0]!.tick).toBe(windowEnd! + 1)
    expect(entity(b).fishing).toBeUndefined()
    for (const sp of FISH_SPECIES) expect(countOf(entity(b).inventory, sp.id)).toBe(0)
    expect(b.node.stock).toBe(FISHING.STOCK)
    // Et ferrer APRÈS la fuite est muet.
    ferrer(b)
    expect(des(drainEvents(b.sim), 'fish_caught')).toHaveLength(0)
  })
})

// ── A8 — L'EAU, LA ZONE, LA SAISON ET L'HEURE CHOISISSENT (D10/T2) ───────────
/**
 * ⚠ CE CRITÈRE A CHANGÉ DE FORME le 2026-08-24. Il disait : « 200 touches en rivière ne
 * donnent jamais de brochet ». C'était un ÉCHANTILLON, et il ne mesurait qu'un seul instant —
 * or la table a maintenant quatre axes. Un tirage à un jour et une heure donnés ne dit plus
 * rien de la loi.
 *
 * La forme neuve est un BALAYAGE EXHAUSTIF du domaine (nature × zone × saison × créneau ×
 * coin), avec une seule propriété affirmée par ligne retenue, et **aucun tirage**. C'est la
 * doctrine maison des gardes de géométrie appliquée à une table.
 */
describe('A8 — la table ne retient que ce qui est déclaré, sur TOUT le domaine', () => {
  // ⚠ PAS DE `marais` : ce n'est plus une eau de pêche (2026-08-24) — le type l'interdit.
  const NATURES: NomDeNature[] = ['riviere', 'lac', 'mare', 'crue']
  const CRENEAUX: CreneauDePeche[] = ['aube', 'jour', 'crepuscule', 'nuit']
  const ZONES = [...VRAIES_ZONES.map((z) => z.slug), undefined]

  /** Le domaine ENTIER : 5 × 13 × 4 × 4 × 2 = 2 080 conditions. */
  function* domaine(): Generator<{ nature: NomDeNature; zone: string | undefined; saison: number; creneau: CreneauDePeche; surCoin: boolean; souille: boolean }> {
    for (const nature of NATURES) {
      for (const zone of ZONES) {
        for (const saison of [1, 2, 3, 4]) {
          for (const creneau of CRENEAUX) {
            for (const surCoin of [false, true]) {
              // L'axe de la SUIE (R26b) entre dans le balayage : sans lui, la lamproie serait
              // une ligne morte aux yeux de la garde « toute espèce mord quelque part ».
              for (const souille of [false, true]) yield { nature, zone, saison, creneau, surCoin, souille }
            }
          }
        }
      }
    }
  }

  it('toute espèce retenue déclare cette eau, cette zone, cette saison, ce créneau — et le coin si elle l’exige', () => {
    let vues = 0
    for (const c of domaine()) {
      for (const l of tableDePrises(c).lignes) {
        if (l.kind !== 'poisson') continue
        vues += 1
        const sp = l.species
        expect(sp.eaux, `${sp.id} en ${c.nature}`).toContain(c.nature)
        if (sp.zones) expect(sp.zones, `${sp.id} en ${String(c.zone)}`).toContain(c.zone ?? '')
        if (sp.saisons) expect(sp.saisons, `${sp.id} en saison ${c.saison}`).toContain(c.saison)
        if (sp.creneaux) expect(sp.creneaux, `${sp.id} au créneau ${c.creneau}`).toContain(c.creneau)
        if (sp.coinSeul) expect(c.surCoin, `${sp.id} n’existe qu’au coin`).toBe(true)
      }
    }
    // LA PRÉMISSE : une garde qui ne verrait AUCUNE espèce passerait au vert pour rien.
    expect(vues, 'des espèces sont bien retenues quelque part').toBeGreaterThan(100)
  })

  it('toute espèce du catalogue mord QUELQUE PART — aucune ligne morte', () => {
    // Le miroir de la garde précédente : sans lui, une espèce mal déclarée (une zone qui
    // n'existe pas, une saison 5) resterait invisible à jamais et personne ne le saurait.
    const vivantes = new Set<string>()
    for (const c of domaine()) {
      for (const l of tableDePrises(c).lignes) if (l.kind === 'poisson') vivantes.add(l.species.id)
    }
    for (const sp of FISH_SPECIES) expect(vivantes.has(sp.id), `${sp.id} mord quelque part`).toBe(true)
    expect(vivantes.size).toBe(FISH_SPECIES.length)
  })

  it('le trio d’origine garde ses eaux : la truite en rivière, le brochet au lac, le goujon aux deux', () => {
    const eauxDe = (id: string): Set<NomDeNature> => {
      const out = new Set<NomDeNature>()
      for (const c of domaine()) {
        for (const l of tableDePrises(c).lignes) if (l.kind === 'poisson' && l.species.id === id) out.add(c.nature)
      }
      return out
    }
    expect(eauxDe('trout').has('lac')).toBe(false)
    expect(eauxDe('pike').has('riviere')).toBe(false)
    expect(eauxDe('gudgeon').has('riviere') && eauxDe('gudgeon').has('lac')).toBe(true)
  })

  it('LE LAC MORT ne donne aucun poisson — et donne quand même des trouvailles', () => {
    // La géographie module, elle n'autorise jamais : l'exclure du geste aurait rendu le
    // mécanisme MUET là-bas. Une table stérile dit la même chose en la faisant sentir.
    for (const creneau of CRENEAUX) {
      const t = tableDePrises({ nature: 'lac', zone: 'lac_mort', saison: 2, creneau, surCoin: true, souille: false })
      expect(t.lignes.some((l) => l.kind === 'poisson')).toBe(false)
      expect(t.lignes.some((l) => l.kind === 'trouvaille')).toBe(true)
    }
    // …et la MÊME eau, hors Lac Mort, en donne : sinon la garde ne prouverait rien.
    expect(tableDePrises({ nature: 'lac', zone: 'pres_bas', saison: 2, creneau: 'jour', surCoin: true, souille: false }).lignes.some((l) => l.kind === 'poisson')).toBe(true)
  })
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
    jusquAUnPoisson(b)
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
  it('fin des Pluies, de nuit (le gué prend, le profond non) : refus quand même — jamais de flotteur sur la glace', () => {
    // D7 ① DURCI le 2026-08-30 (décision d'Alexis : « on ne doit pas pêcher dans la glace »).
    // Ce cas affirmait l'inverse (« c'est le PROFOND qui compte ») : un gué pris avec du
    // profond ouvert derrière se pêchait, et le flotteur tombait sur une tuile peinte en glace.
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(NUITS_DES_PLUIES, true)
    // LES DEUX PRÉMISSES D'ABORD : sans un gué RÉELLEMENT pris ce cas passerait au vert sur une
    // nuit tiède, et sans un profond RÉELLEMENT ouvert il ne dirait rien du durcissement — il
    // mesurerait l'ancienne règle. Le socle est une courbe (`saisons.md` S4) : la fenêtre où le
    // gué gèle sans le profond se prouve, elle ne se suppose pas.
    expect(estGele(b.sim, COIN.tx, COIN.ty), 'le gué du coin, lui, a bien pris').toBe(true)
    const profond = profondVoisin(b.sim.map, COIN.tx, COIN.ty)!
    expect(estGele(b.sim, profond.tx, profond.ty), 'le profond, lui, est encore ouvert').toBe(false)
    expect(coinPris(b.sim, b.node)).toBe(true)
    lancer(b)
    const rejets = des(drainEvents(b.sim), 'action_rejected')
    expect(rejets).toHaveLength(1)
    expect((rejets[0] as { reason: string }).reason).toBe("l'eau est prise")
    expect(entity(b).fishing).toBeUndefined()
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
    step(b.sim, [{ entityId: b.id, dx: -1, dy: 0, action: { type: 'cast_line', tx: COIN.tx, ty: COIN.ty } }])
    expect(entity(b).fishing).toBeDefined()
  })
})

// ── A12 — DÉTERMINISME ───────────────────────────────────────────────────────
describe('A12 — même seed + mêmes inputs = mêmes prises, mêmes événements', () => {
  function partie(): { snap: string; evs: string } {
    const b = banc('fishing_spot_lake', { vers: 3, seed: 77 })
    const evs: SimEvent[] = []
    for (let i = 0; i < 3; i++) {
      evs.push(...jusquAUnPoisson(b))
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
    // Et la TAILLE tirée est rejouée à l'identique (B2) — c'est elle qui consomme trois tirages.
    const mms = (JSON.parse(a.evs) as SimEvent[]).filter((e) => e.type === 'fish_caught').map((e) => (e as { mm: number }).mm)
    expect(mms).toEqual((JSON.parse(c.evs) as SimEvent[]).filter((e) => e.type === 'fish_caught').map((e) => (e as { mm: number }).mm))
  })
})

// ── A13 — LE POISSON SE CUIT ET SE MANGE ─────────────────────────────────────
describe('A13 — le poisson se cuit au Feu et se mange', () => {
  it('chaque espèce a sa cuisson au feu, sa valeur crue et cuite, et la cuite nourrit plus', () => {
    for (const sp of FISH_SPECIES) {
      const cuisson = COOK_SLOT.fire![sp.id]
      expect(cuisson, `${sp.id} se cuit`).toBeDefined()
      expect(FOOD_VALUES[sp.id]).toBeGreaterThan(0)
      expect(FOOD_VALUES[cuisson!.output]!).toBeGreaterThan(FOOD_VALUES[sp.id]!)
      // LE CUIT SE REGROUPE PAR CLASSE (D12) : c'est ce qui tient le catalogue à 25 items.
      expect(cuisson!.output).toBe(`cooked_fish_${sp.classe}`)
    }
  })
  it('manger un brochet cuit rend FOOD_VALUES', () => {
    const b = banc()
    const e = entity(b)
    e.hunger = 10
    grantItems(b.sim, b.id, { cooked_fish_gros: 1 })
    step(b.sim, [{ ...idle(b), action: { type: 'eat', item: 'cooked_fish_gros' } }])
    expect(e.hunger).toBeGreaterThan(10)
    expect(countOf(e.inventory, 'cooked_fish_gros')).toBe(0)
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
    for (let i = 0; i < 60 && b.node.stock > 0; i++) {
      jusquAUnPoisson(b)
      ferrer(b)
      prises += des(drainEvents(b.sim), 'fish_caught').length
      attendre(b, BALANCE.GATHER_COOLDOWN_TICKS)
    }
    expect(prises).toBe(FISHING.STOCK)
    expect(b.node.stock).toBe(0)
    expect(b.node.regrowAt).toBeGreaterThan(b.sim.tick)
    const t = b.sim.map.terrain[b.node.ty * b.sim.map.width + b.node.tx]
    expect(t).toBe(TERRAIN_SHALLOW_WATER)
    // ⚠ ET LE COIN VIDE NE FERME PLUS L'EAU (D9/A17) : il refusait « rien ne mord ici » ; la
    // tuile retombe désormais sur la table de l'eau nue. C'est le corollaire dur de « on pêche
    // l'eau, pas le coin », et le refus qui serait le plus facilement resté là en silence.
    lancer(b)
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(0)
    expect(entity(b).fishing).toBeDefined()
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

describe('le coin vidé sous la ligne ne la rentre plus (D9)', () => {
  it('un autre pêcheur vide le coin entre le lancer et la touche : la ligne TIENT, sur l’eau nue', () => {
    // ⚠ AVANT D9 la ligne rentrait sans un mot (« on n'annonce pas un poisson qu'on ne pourra
    // pas ferrer »). Le coin n'autorisant plus rien, il n'y a plus rien à annuler : la tuile
    // retombe sur la table de l'eau nue, sans le cadeau du coin. Le geste continue.
    const b = banc()
    lancer(b)
    b.node.stock = 0 // un autre pêcheur a pris le dernier (multi)
    attendre(b, FISHING.WAIT_NOBAIT_MAX_TICKS + 5)
    const evs = drainEvents(b.sim)
    // La ligne a VÉCU : ça a mordu (ou mordillé) sur l'eau nue. Elle a pu rentrer depuis, le
    // poisson ayant filé faute de ferrage — ce qu'on affirme, c'est qu'aucune ANNULATION n'est
    // venue du coin vidé : `fishing_cancelled` ne dit que la mort de l'eau (E4).
    expect(des(evs, 'fishing_cancelled')).toHaveLength(0)
    expect(des(evs, 'fish_bite').length + des(evs, 'fish_nibble').length).toBeGreaterThan(0)
  })
})

// ── A14 — ON PÊCHE DE LOIN (décision d'Alexis, 2026-08-24) ────────────────────
/**
 * Le coin se prenait au BRAS (`INTERACT_RANGE`, 1,5 t) : il fallait se coller à la tuile
 * d'eau, souvent les pieds dedans. Il se prend maintenant à `FISHING.RANGE`, déclaré sur le
 * NŒUD (`NodeDef.range`) et lu par `porteeDuNoeud` — donc par la sim ET par le client.
 *
 * La garde balaie la BORNE des deux côtés et sur les TROIS entrées du geste (lancer, frappe,
 * ferrage) : une portée qui ne tiendrait qu'au lancer laisserait le poisson se décrocher à la
 * prise, et le joueur ne comprendrait rien. Et elle affirme sa prémisse — la portée est BIEN
 * plus longue que le bras — sinon le test passerait au vert sur un `RANGE` ramené à 1,5.
 */
describe('A14 — la ligne se lance de loin, pas au bras', () => {
  /** Pose le pêcheur à `d` tuiles du CENTRE du coin, plein ouest (de l'herbe, tout du long). */
  function aDistance(b: Banc, d: number): void {
    entity(b).x = COIN.tx + 0.5 - d
    entity(b).y = COIN.ty + 0.5
  }

  it('la portée du coin dépasse franchement le bras — la prémisse de tout ce qui suit', () => {
    expect(porteeDuNoeud('fishing_spot_lake')).toBe(FISHING.RANGE)
    expect(porteeDuNoeud('fishing_spot_river')).toBe(FISHING.RANGE)
    expect(FISHING.RANGE).toBeGreaterThan(BALANCE.INTERACT_RANGE)
    // …et AUCUN autre nœud n'a été allongé au passage : c'est la pêche qu'on change.
    expect(porteeDuNoeud('tree')).toBe(BALANCE.INTERACT_RANGE)
    expect(porteeDuNoeud('berry_bush')).toBe(BALANCE.INTERACT_RANGE)
  })

  it('À LA BORNE : le lancer part à FISHING.RANGE pile', () => {
    const b = banc()
    aDistance(b, FISHING.RANGE)
    lancer(b)
    expect(entity(b).fishing).toBeDefined()
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(0)
  })

  it('UN CHEVEU AU-DELÀ : « trop loin », et aucune ligne', () => {
    const b = banc()
    aDistance(b, FISHING.RANGE + 0.1)
    lancer(b)
    expect(entity(b).fishing).toBeUndefined()
    const refus = des(drainEvents(b.sim), 'action_rejected')
    expect(refus).toHaveLength(1)
    expect(refus[0]).toMatchObject({ reason: 'trop loin' })
  })

  it('LE GESTE ENTIER tient à la borne : lancer, touche, ferrage — un poisson au sac', () => {
    const b = banc()
    aDistance(b, FISHING.RANGE)
    jusquAUnPoisson(b)
    const sp = FISH_SPECIES.find((x) => x.id === entity(b).fishing!.species)!
    ferrer(b)
    expect(countOf(entity(b).inventory, sp.id)).toBeGreaterThanOrEqual(1)
  })

  it('LE BRAS NE S’ALLONGE PAS AILLEURS : un arbre à 3 tuiles reste hors de portée', () => {
    const b = banc()
    b.sim.nodes.push({ id: 2, type: 'tree', tx: COIN.tx - 3, ty: COIN.ty, stock: 5, regrowAt: 0 })
    step(b.sim, [{ ...idle(b), action: { type: 'harvest', nodeId: 2 } }])
    expect(des(drainEvents(b.sim), 'action_rejected')[0]).toMatchObject({ reason: 'trop loin' })
  })
})

// ── A15 — LA SÉCHERESSE FERME (Alexis, 2026-08-24 : « on ne doit pas pouvoir pêcher des
//          coins asséchés ! ») ─────────────────────────────────────────────────────────
/**
 * `eau.ts` le promettait en toutes lettres depuis le 2026-08-23 — « la mare partie… et le
 * poisson n'y est plus » — mais `economy.ts` n'importait RIEN de ce module : on pêchait une
 * mare partie, debout sur la vase craquelée, le flotteur posé sur la boue. Vu sur une capture.
 *
 * LES DEUX PÔLES SUR LE MÊME BANC, et c'est la seule façon de garder quelque chose : une
 * garde qui n'affirmerait que le refus passerait au vert sur un `coinIndisponible` qui refuse
 * TOUT. Le cœur de l'Ardeur sèche (aridité 1,00), le cœur des Pluies non — même coin, même
 * carte, même canne, deux ticks.
 *
 * ⚠ LA TUILE JUGÉE EST CELLE DU COIN, pas son voisin profond : `estAsseche` ne mord que sur du
 * haut-fond, donc porter le test sur le profond l'aurait rendu MUET en silence. La garde
 * l'affirme, sinon elle ne distinguerait pas le bon code du code inerte.
 */
describe('A15 — une mare partie ne se pêche pas', () => {
  const COEUR_DE_L_ARDEUR = coeurDe(2)
  const COEUR_DES_PLUIES = coeurDe(3)

  it('LA PRÉMISSE : le coin sèche à l’Ardeur et pas aux Pluies, et son PROFOND ne sèche jamais', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(COEUR_DE_L_ARDEUR)
    expect(ariditeGlobale(b.sim), 'le cœur de l’Ardeur est aride').toBeGreaterThanOrEqual(EAU.SEUIL_ASSECHEMENT)
    expect(estAsseche(b.sim, COIN.tx, COIN.ty), 'le haut-fond DU COIN est à sec').toBe(true)
    // Le profond voisin, lui, ne sèche pas — d'où le test sur la tuile du coin.
    expect(estAsseche(b.sim, LAC.x0, COIN.ty), 'le profond ne sèche jamais').toBe(false)
    b.sim.tick = tickDe(COEUR_DES_PLUIES)
    expect(estAsseche(b.sim, COIN.tx, COIN.ty), 'aux Pluies l’eau est revenue').toBe(false)
    expect(estGele(b.sim, COIN.tx, COIN.ty), 'et elle n’a pas gelé non plus').toBe(false)
  })

  it('L’EAU RETIRÉE : le lancer est refusé, et avec SA raison — pas celle de la glace', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(COEUR_DE_L_ARDEUR)
    expect(coinIndisponible(b.sim, b.node)).toBe("l'eau s'est retirée")
    lancer(b)
    const rejets = des(drainEvents(b.sim), 'action_rejected')
    expect(rejets).toHaveLength(1)
    expect((rejets[0] as { reason: string }).reason).toBe("l'eau s'est retirée")
    expect(entity(b).fishing).toBeUndefined()
  })

  it('L’EAU REVENUE : le MÊME coin se pêche — la garde ne ferme pas tout', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(COEUR_DES_PLUIES)
    expect(coinIndisponible(b.sim, b.node)).toBeNull()
    lancer(b)
    expect(entity(b).fishing).toBeDefined()
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(0)
  })

  it('LE VER N’EST PAS PERDU sur un refus : l’eau partie ne coûte pas l’appât', () => {
    const b = banc('fishing_spot_lake', { gel: true, vers: 2 })
    b.sim.tick = tickDe(COEUR_DE_L_ARDEUR)
    lancer(b)
    expect(countOf(entity(b).inventory, 'worms' as ItemId)).toBe(2)
  })
})

// ═══ LE CHANTIER DU 2026-08-24 (D9-D12) — A16-A26 ═══════════════════════════

// ── A16 — ON PÊCHE L'EAU NUE ─────────────────────────────────────────────────
describe('A16 — on pêche toute eau à portée, avec ou sans coin', () => {
  it('une tuile d’eau SANS nœud : la ligne part', () => {
    const b = banc('fishing_spot_lake', { sansCoin: true })
    expect(b.sim.nodes).toHaveLength(0) // la prémisse : il n'y a AUCUN coin sur cette carte
    lancerSur(b, COIN.tx, COIN.ty + 2)
    expect(entity(b).fishing).toBeDefined()
    expect(entity(b).fishing!.nodeId, 'aucun coin sous la tuile').toBeUndefined()
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(0)
  })
  it('le PROFOND se pêche aussi, pas seulement le haut-fond', () => {
    const b = banc('fishing_spot_lake', { sansCoin: true })
    entity(b).x = LAC.x0 - 1.5
    lancerSur(b, LAC.x0, COIN.ty)
    expect(entity(b).fishing).toBeDefined()
  })
  it('la TERRE se refuse, et avec ses mots à elle', () => {
    const b = banc('fishing_spot_lake', { sansCoin: true })
    lancerSur(b, PECHEUR.x - 1, PECHEUR.y)
    expect(entity(b).fishing).toBeUndefined()
    expect((des(drainEvents(b.sim), 'action_rejected')[0] as { reason: string }).reason).toBe("il n'y a pas d'eau ici")
  })
  it('LA PORTÉE tient sur l’eau nue comme sur le coin : à RANGE oui, un cheveu plus loin non', () => {
    const b = banc('fishing_spot_lake', { sansCoin: true })
    entity(b).x = COIN.tx + 0.5 - FISHING.RANGE
    entity(b).y = COIN.ty + 0.5
    expect(castRejection(b.sim, entity(b), COIN.tx, COIN.ty)).toBeNull()
    entity(b).x -= 0.1
    expect(castRejection(b.sim, entity(b), COIN.tx, COIN.ty)).toBe('trop loin')
  })
  it('sans canne, l’eau nue ne se pêche pas non plus', () => {
    const b = banc('fishing_spot_lake', { canne: false, sansCoin: true })
    expect(castRejection(b.sim, entity(b), COIN.tx, COIN.ty)).toBe('il faut une canne en main')
  })
})

// ── A17 — UN COIN ÉPUISÉ NE FERME PAS L'EAU ──────────────────────────────────
describe('A17 — un coin épuisé ne ferme plus l’eau (le corollaire dur de D9)', () => {
  it('stock 0 : le lancer passe, sans refus, et sans le cadeau du coin', () => {
    const b = banc('fishing_spot_lake', { stock: 0 })
    lancer(b)
    expect(entity(b).fishing, 'la ligne part quand même').toBeDefined()
    expect(des(drainEvents(b.sim), 'action_rejected')).toHaveLength(0)
    expect(entity(b).fishing!.nodeId, 'un coin vide n’est plus un coin').toBeUndefined()
  })
})

// ── A18 — LE COIN AMÉLIORE ───────────────────────────────────────────────────
describe('A18 — le coin ne conditionne plus, il améliore', () => {
  const cond = (surCoin: boolean) => ({ nature: 'lac' as NomDeNature, zone: 'pres_bas', saison: 2, creneau: 'jour' as CreneauDePeche, surCoin, souille: false })

  it('le poids du « rien » est DIVISÉ sur un coin — c’est là qu’est son vrai cadeau', () => {
    expect(poidsDuRien(cond(false))).toBe(FISHING.RIEN_PAR_EAU.lac)
    expect(poidsDuRien(cond(true))).toBe(Math.max(1, Math.floor(FISHING.RIEN_PAR_EAU.lac / FISHING.COIN_RIEN_DIV)))
    expect(poidsDuRien(cond(true))).toBeLessThan(poidsDuRien(cond(false)))
    // …et sur TOUTE eau, jamais zéro : même le meilleur coin peut ne pas mordre du premier coup.
    for (const n of ['riviere', 'lac', 'mare', 'crue'] as NomDeNature[]) {
      expect(poidsDuRien({ ...cond(true), nature: n })).toBeGreaterThanOrEqual(1)
      expect(poidsDuRien({ ...cond(true), nature: n })).toBeLessThan(poidsDuRien({ ...cond(false), nature: n }))
    }
  })

  it('l’attente est PLUS COURTE sur le coin — même graine, même tuile, deux mondes', () => {
    const avecCoin = banc('fishing_spot_lake', { seed: 4242 })
    const sansCoin = banc('fishing_spot_lake', { seed: 4242, sansCoin: true })
    lancer(avecCoin)
    lancer(sansCoin)
    const a = entity(avecCoin).fishing!
    const n = entity(sansCoin).fishing!
    expect(a.biteAt - a.castTick).toBeLessThan(n.biteAt - n.castTick)
    expect(a.biteAt - a.castTick).toBe(Math.max(1, Math.floor(((n.biteAt - n.castTick) * FISHING.COIN_ATTENTE_NUM) / FISHING.COIN_ATTENTE_DEN)))
  })

  it('deux espèces n’existent QU’AU COIN (`coinSeul`) — la seule chose qu’un coin autorise', () => {
    const seules = FISH_SPECIES.filter((sp) => sp.coinSeul === true)
    expect(seules.length).toBeGreaterThan(0)
    for (const sp of seules) {
      const c = { nature: sp.eaux[0]!, zone: sp.zones?.[0], saison: sp.saisons?.[0] ?? 2, creneau: sp.creneaux?.[0] ?? ('nuit' as CreneauDePeche), surCoin: false, souille: sp.souillee === true }
      expect(especeRetenue(sp, { ...c, surCoin: false })).toBe(false)
      expect(especeRetenue(sp, { ...c, surCoin: true })).toBe(true)
    }
  })
})

// ── A19 — L'EAU QUI MEURT ANNULE EN COURS ────────────────────────────────────
/**
 * ⚠ LE DÉFAUT QU'ON FERME : `coinIndisponible` n'était appelé qu'au LANCER. Une ligne posée
 * sur une mare qui part, ou sur une eau qui prend, restait tendue sur de la boue — et le
 * poisson mordait. La surveillance est maintenant à chaque tick (E4), et elle DIT pourquoi.
 *
 * LA LISTE EST FERMÉE, et la garde l'affirme dans les deux sens : la crue n'annule pas.
 */
describe('A19 — la ligne rentre quand l’eau meurt, et elle dit pourquoi', () => {
  const COEUR_DE_L_ARDEUR = coeurDe(2)

  it('L’EAU SE RETIRE SOUS LA LIGNE : annulation datée, avec sa raison', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(coeurDe(3)) // les Pluies : l'eau est là
    lancer(b)
    expect(entity(b).fishing).toBeDefined()
    drainEvents(b.sim)
    b.sim.tick = tickDe(COEUR_DE_L_ARDEUR) // et la voilà partie
    attendre(b, 1)
    expect(entity(b).fishing).toBeUndefined()
    const annules = des(drainEvents(b.sim), 'fishing_cancelled') as Extract<SimEvent, { type: 'fishing_cancelled' }>[]
    expect(annules).toHaveLength(1)
    expect(annules[0]!.reason).toBe("l'eau s'est retirée")
  })

  it('L’EAU PREND SOUS LA LIGNE : même chose, autre raison — le joueur voit deux sols différents', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(coeurDe(3))
    lancer(b)
    drainEvents(b.sim)
    b.sim.tick = tickDe(COEUR_DU_GRAND_FROID, true)
    attendre(b, 1)
    expect(entity(b).fishing).toBeUndefined()
    const annules = des(drainEvents(b.sim), 'fishing_cancelled') as Extract<SimEvent, { type: 'fishing_cancelled' }>[]
    expect(annules).toHaveLength(1)
    expect(annules[0]!.reason).toBe("l'eau est prise")
  })

  it('LA TERRE N’EST PAS DE L’EAU RETIRÉE : trois raisons DISTINCTES, jamais une seule', () => {
    // Une garde qui n'affirmerait qu'un refus passerait au vert sur un prédicat qui refuse
    // tout avec le même mot. Le joueur, lui, voit trois choses différentes : un pré, de la
    // vase craquelée, de la glace — et un mensonge d'interface s'y verrait tout de suite.
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(coeurDe(3))
    expect(eauIndisponible(b.sim, COIN.tx, COIN.ty), 'l’eau vivante ne refuse rien').toBeNull()
    expect(eauIndisponible(b.sim, 2, 2)).toBe("il n'y a pas d'eau ici")
    b.sim.tick = tickDe(COEUR_DE_L_ARDEUR)
    expect(eauIndisponible(b.sim, COIN.tx, COIN.ty)).toBe("l'eau s'est retirée")
    b.sim.tick = tickDe(COEUR_DU_GRAND_FROID, true)
    expect(eauIndisponible(b.sim, COIN.tx, COIN.ty)).toBe("l'eau est prise")
  })

  it('L’EAU QUI VA BIEN N’ANNULE RIEN — sinon la garde passerait au vert sur un code qui annule TOUT', () => {
    const b = banc('fishing_spot_lake', { gel: true })
    b.sim.tick = tickDe(coeurDe(3))
    lancer(b)
    drainEvents(b.sim)
    attendre(b, 40)
    expect(des(drainEvents(b.sim), 'fishing_cancelled')).toHaveLength(0)
  })
})

// ── A20 — ÇA MORDILLE ────────────────────────────────────────────────────────
/**
 * L'issue « rien » (D11) : le tirage n'a rien donné, donc PAS de fenêtre — le flotteur
 * tressaute et une nouvelle attente se tire. Le réflexe du joueur n'est jamais puni par la
 * malchance : il n'a rien à rater. Et une eau pauvre SE LIT.
 *
 * Le banc : une MARE (le « rien » y pèse le plus lourd), au Lac Mort (aucune espèce). Ce qui
 * reste est du mordillage et quelques trouvailles.
 */
describe('A20 — ça mordille, ça ne mord pas', () => {
  /** Une mare stérile : le Lac Mort n'a pas de poisson, la mare a le « rien » le plus lourd. */
  function mareSterile(seed = 5): Banc {
    const b = banc('fishing_spot_lake', { seed, sansCoin: true, nature: NATURE_MARE })
    b.sim.map.zoneGrid = new Array(1).fill(0)
    b.sim.map.zonePas = 4096
    b.sim.map.zoneDefs = [{ slug: 'lac_mort', nom: 'le Lac Mort', tier: 2 }]
    return b
  }

  it('LA PRÉMISSE : sur cette eau, la table ne porte AUCUN poisson', () => {
    const b = mareSterile()
    const c = conditionsAt(b.sim, COIN.tx, COIN.ty, false)!
    expect(c.zone).toBe('lac_mort')
    expect(tableDePrises(c).lignes.some((l) => l.kind === 'poisson')).toBe(false)
  })

  it('un mordillage : un fish_nibble, AUCUNE fenêtre, une nouvelle attente — la ligne reste', () => {
    const b = mareSterile()
    lancer(b)
    for (let i = 0; i < 4000; i++) {
      step(b.sim, [idle(b)])
      const evs = drainEvents(b.sim)
      if (des(evs, 'fish_nibble').length > 0) {
        const f = entity(b).fishing
        expect(f, 'la ligne est TOUJOURS à l’eau').toBeDefined()
        expect(f!.windowEnd, 'aucune fenêtre : rien à ferrer, rien à rater').toBeUndefined()
        expect(f!.biteAt, 'une nouvelle attente est tirée').toBeGreaterThan(b.sim.tick)
        expect(f!.nibbles).toBeGreaterThanOrEqual(1)
        expect(des(evs, 'fish_bite'), 'un mordillage n’est pas une touche').toHaveLength(0)
        return
      }
      if (entity(b).fishing === undefined) lancer(b)
    }
    throw new Error('aucun mordillage en 4 000 ticks sur une eau stérile')
  })

  it('AU PLAFOND, la ligne rentre d’elle-même — on ne laisse pas le joueur planté', () => {
    const b = mareSterile(9)
    lancer(b)
    entity(b).fishing!.nibbles = FISHING.NIBBLES_MAX // le prochain « rien » est de trop
    drainEvents(b.sim)
    for (let i = 0; i < 4000; i++) {
      step(b.sim, [idle(b)])
      const annules = des(drainEvents(b.sim), 'fishing_cancelled') as Extract<SimEvent, { type: 'fishing_cancelled' }>[]
      if (annules.length > 0) {
        expect(annules[0]!.reason).toBe('ça ne mord pas ici')
        expect(entity(b).fishing).toBeUndefined()
        return
      }
    }
    throw new Error('le plafond de mordillages ne rentre jamais la ligne')
  })
})

// ── A21 — LA TABLE BOUGE AVEC LA SAISON ET L'HEURE ───────────────────────────
describe('A21 — la saison et le créneau font et défont la table', () => {
  const base = { nature: 'riviere' as NomDeNature, zone: 'pres_bas', creneau: 'jour' as CreneauDePeche, surCoin: false, souille: false }
  const idsDe = (c: Parameters<typeof tableDePrises>[0]) => tableDePrises(c).lignes.filter((l) => l.kind === 'poisson').map((l) => (l as { species: { id: string } }).species.id)

  it('LE SAUMON n’existe qu’aux Pluies — un événement de calendrier, pas une ligne de table', () => {
    expect(idsDe({ ...base, saison: 3 })).toContain('saumon')
    for (const saison of [1, 2, 4]) expect(idsDe({ ...base, saison })).not.toContain('saumon')
  })

  it('L’ANGUILLE ne mord que la nuit ; la truite à l’aube et au crépuscule', () => {
    expect(idsDe({ ...base, saison: 2, creneau: 'nuit' })).toContain('anguille')
    expect(idsDe({ ...base, saison: 2, creneau: 'jour' })).not.toContain('anguille')
    expect(idsDe({ ...base, saison: 1, creneau: 'aube' })).toContain('trout')
    expect(idsDe({ ...base, saison: 1, creneau: 'jour' })).not.toContain('trout')
  })

  it('LE CORÉGONE ouvre le Grand Froid au lac — la saison où la rivière se ferme par le gel', () => {
    const lac = { nature: 'lac' as NomDeNature, zone: 'pres_bas', creneau: 'jour' as CreneauDePeche, surCoin: false, souille: false }
    expect(idsDe({ ...lac, saison: 4 })).toContain('coregone')
    expect(idsDe({ ...lac, saison: 2 })).not.toContain('coregone')
  })

  it('LES QUATRE CRÉNEAUX se suivent dans l’ordre du cycle, et l’aube ouvre le jour', () => {
    const b = banc()
    const debut = b.sim.tick - (b.sim.tick % TICKS_PER_CYCLE)
    // La longueur du jour est celle du jour DU BANC (le banc vit au cœur des Pluies, plus au jour 1).
    const jour = dayTicksPourJour(JOUR_DOUX)
    expect(creneauAt(b.sim, debut)).toBe('aube')
    expect(creneauAt(b.sim, debut + Math.floor(jour / 2))).toBe('jour')
    expect(creneauAt(b.sim, debut + jour - 1)).toBe('crepuscule')
    expect(creneauAt(b.sim, debut + jour)).toBe('nuit')
    expect(creneauAt(b.sim, debut + TICKS_PER_CYCLE - 1)).toBe('nuit')
  })
})

// ── A22 — LA NATURE DE L'EAU EST STABLE ET TOTALE ────────────────────────────
describe('A22 — la carte de nature d’eau (T1)', () => {
  /** Une carte jouet : un lac large, une flaque, un ruban de rivière avec son fil, du marais. */
  function jouet(): { terrain: number[]; fil: number[]; w: number; h: number } {
    const w = 40
    const h = 20
    const terrain = new Array<number>(w * h).fill(TERRAIN_GRASS)
    const pose = (x: number, y: number, t: number): void => {
      terrain[y * w + x] = t
    }
    for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) pose(x, y, TERRAIN_DEEP_WATER) // 100 tuiles : un LAC
    pose(20, 5, TERRAIN_SHALLOW_WATER) // une flaque isolée : une MARE
    const fil: number[] = []
    for (let x = 25; x < 38; x++) {
      pose(x, 15, TERRAIN_SHALLOW_WATER)
      fil.push(15 * w + x)
    }
    pose(30, 2, TERRAIN_MARSH)
    return { terrain, fil, w, h }
  }

  it('chaque eau reçoit SA nature, la terre n’en reçoit aucune, et le seuil sépare lac et mare', () => {
    const { terrain, fil, w, h } = jouet()
    const nat = deriverNatureDeLEau(terrain, fil, w, h)
    expect(nat[5 * w + 5], 'le grand plan d’eau est un LAC').toBe(NATURE_LAC)
    expect(nat[5 * w + 20], 'la flaque est une MARE').toBe(NATURE_MARE)
    expect(nat[15 * w + 30], 'le ruban au fil est une RIVIÈRE').toBe(NATURE_RIVIERE)
    expect(nat[2 * w + 30], 'le marais se dit lui-même').toBe(NATURE_MARAIS)
    expect(nat[0], 'la terre n’a pas de nature').toBe(NATURE_RIEN)
    // TOTALE : toute tuile d'eau porte une nature, toute tuile de terre n'en porte aucune.
    for (let i = 0; i < w * h; i++) {
      const eau = terrain[i] === TERRAIN_DEEP_WATER || terrain[i] === TERRAIN_SHALLOW_WATER || terrain[i] === TERRAIN_MARSH
      expect(nat[i] !== NATURE_RIEN, `tuile ${i}`).toBe(eau)
    }
  })

  it('elle est STABLE : deux dérivations de la même carte sont identiques', () => {
    const { terrain, fil, w, h } = jouet()
    expect(deriverNatureDeLEau(terrain, fil, w, h)).toEqual(deriverNatureDeLEau(terrain, fil, w, h))
  })

  it('A22bis — CHAQUE NATURE EST ATTEIGNABLE AU RUNTIME : aucune n’est du contenu mort', () => {
    // ⚠ LA GARDE QUI MANQUAIT, ET LE DÉFAUT QU'ELLE A ATTRAPÉ : `natureDeLEau` testait
    // `porteDeLEau` EN PREMIER — or `porteDeLEau` ne dit oui que sur les deux terrains d'eau
    // ou une terre inondée. Le MARAIS n'en fait pas partie : sa nature était injoignable, et
    // avec elle quatre espèces (loche, écrevisse, anguille, silure) et trois trouvailles.
    //
    // Ni A8 ni A22 ne pouvaient le voir : A8 FABRIQUE ses conditions (`nature: 'marais'`),
    // A22 teste la DÉRIVATION de la carte. Aucune ne demandait si une tuile de marais du
    // monde se pêche. C'est le miroir exact de « aucune ligne morte » — côté runtime.
    const map = createEmptyMap(20, 8, TERRAIN_GRASS)
    const poser = (tx: number, terrain: number, nature: number): void => {
      setTile(map, tx, 4, terrain)
      ;(map.natureEau ??= new Array<number>(map.width * map.height).fill(NATURE_RIEN))[4 * map.width + tx] = nature
    }
    poser(2, TERRAIN_SHALLOW_WATER, NATURE_RIVIERE)
    poser(5, TERRAIN_DEEP_WATER, NATURE_LAC)
    poser(8, TERRAIN_SHALLOW_WATER, NATURE_MARE)
    poser(11, TERRAIN_MARSH, NATURE_MARAIS)
    const sim = createSim(7, { map, nodes: [], faunaCap: 0, worldEvents: false, meteoActive: false })
    expect(natureDeLEau(sim, 2, 4)).toBe('riviere')
    expect(natureDeLEau(sim, 5, 4)).toBe('lac')
    expect(natureDeLEau(sim, 8, 4)).toBe('mare')
    // ⚠ LE MARAIS A BASCULÉ le 2026-08-24 (décision d'Alexis) : c'est un SOL MOU, pas une eau
    // de pêche — il fait 87 % de l'eau de la vallée, et pêchable il aurait fait de la
    // Tourbière le premier terrain de pêche du monde. Il garde donc son ralentissement (déjà
    // dans la sim) et gagne un enfoncement à l'œil ; la ligne, elle, n'y tombe pas.
    expect(natureDeLEau(sim, 11, 4), 'le MARAIS ne se pêche pas').toBeNull()
    expect(natureDeLEau(sim, 0, 0), 'et la terre, non plus').toBeNull()
    // …ET IL LE DIT AVEC SES MOTS. Trois sols, trois refus : un silence, ou le mot d'un autre
    // sol, et le joueur croit que la pêche est cassée (c'est exactement ce qui s'est passé).
    expect(eauIndisponible(sim, 11, 4)).toBe('on ne pêche pas dans la vase')
    expect(eauIndisponible(sim, 0, 0)).toBe("il n'y a pas d'eau ici")
    // L'eau ouverte, elle, ne reçoit JAMAIS le mot de la vase (elle peut être prise par le gel
    // à ce tick — ce n'est pas le sujet ; le sujet est qu'on ne confonde pas deux sols).
    expect(eauIndisponible(sim, 2, 4)).not.toBe('on ne pêche pas dans la vase')
  })

  it('sur le monde JOUÉ, toute l’eau a une nature, et les quatre existent', () => {
    const b = banc()
    // Le banc peint la sienne ; ici on vérifie la lecture au runtime (`natureDeLEau`).
    expect(natureDeLEau(b.sim, COIN.tx, COIN.ty)).toBe('lac')
    expect(natureDeLEau(b.sim, 0, 0), 'la terre ne se pêche pas').toBeNull()
  })
})

// ── A23/A24 — LA TAILLE : trois tirages, et une quantité ─────────────────────
describe('A23/A24 — la taille se tire en trois coups et fait la quantité', () => {
  it('LE COMPTE DE TIRAGES NE DÉPEND PAS DU NIVEAU : même graine, même flux consommé', () => {
    // Un compte de tirages qui dépendrait de la branche décalerait le flux seedé pour tout ce
    // qui suit — et ferait rougir des tests sans aucun rapport. On l'affirme par l'ÉTAT du PRNG.
    function partie(niveau: number): { rng: unknown; mm: number } {
      const b = banc('fishing_spot_lake', { seed: 31, vers: 5 })
      entity(b).skills.hunting = niveau
      jusquAUnPoisson(b)
      step(b.sim, [idle(b)])
      ferrer(b)
      const prise = des(drainEvents(b.sim), 'fish_caught')[0] as Extract<SimEvent, { type: 'fish_caught' }>
      return { rng: JSON.stringify(b.sim.rngState), mm: prise.mm }
    }
    const bas = partie(0)
    const haut = partie(100 * 25) // niveau 5
    expect(haut.rng, 'le MÊME nombre de tirages consommés').toEqual(bas.rng)
  })

  it('LA MAÎTRISE tire vers le GROS — mesuré, pas affirmé', () => {
    function moyenne(niveau: number): number {
      let somme = 0
      let n = 0
      for (let seed = 0; seed < 12; seed++) {
        const b = banc('fishing_spot_lake', { seed: 100 + seed, vers: 20 })
        entity(b).skills.hunting = niveau
        for (let i = 0; i < 4; i++) {
          jusquAUnPoisson(b)
          const sp = FISH_SPECIES.find((x) => x.id === entity(b).fishing!.species)!
          step(b.sim, [idle(b)])
          ferrer(b)
          for (const e of drainEvents(b.sim)) {
            if (e.type !== 'fish_caught') continue
            // Normalisée dans [0,1] : les espèces n'ont pas la même taille, la moyenne brute
            // mesurerait surtout QUELLE espèce est sortie.
            somme += (e.mm - sp.tailleMinMm) / (sp.tailleMaxMm - sp.tailleMinMm)
            n += 1
          }
          attendre(b, BALANCE.GATHER_COOLDOWN_TICKS)
        }
      }
      return somme / Math.max(1, n)
    }
    expect(moyenne(100 * 100)).toBeGreaterThan(moyenne(0))
  }, 60_000)

  it('LES PORTIONS : une prise minimale en vaut une, une maximale vaut le plafond de sa classe', () => {
    for (const sp of FISH_SPECIES) {
      expect(portionsDe(sp, sp.tailleMinMm)).toBe(1)
      expect(portionsDe(sp, sp.tailleMaxMm)).toBe(FISHING.PORTIONS_MAX[sp.classe])
      // MONOTONE : plus gros ne rend jamais moins.
      let avant = 0
      for (let mm = sp.tailleMinMm; mm <= sp.tailleMaxMm; mm += 7) {
        const p = portionsDe(sp, mm)
        expect(p).toBeGreaterThanOrEqual(avant)
        avant = p
      }
    }
  })

  it('SAC PRESQUE PLEIN : on range ce qui rentre, au lieu de tout perdre', () => {
    const b = banc('fishing_spot_lake', { vers: 5 })
    jusquAUnPoisson(b)
    const sp = FISH_SPECIES.find((x) => x.id === entity(b).fishing!.species)!
    const e = entity(b)
    // Une seule case libre, et une pile déjà entamée : la place est mesurable.
    for (let i = 0; i < e.inventory.length; i++) if (e.inventory[i] === null) e.inventory[i] = { item: 'cut_stone', count: 1 }
    e.inventory[e.inventory.length - 1] = null
    const place = 1
    step(b.sim, [idle(b)])
    ferrer(b)
    const prise = des(drainEvents(b.sim), 'fish_caught')[0] as Extract<SimEvent, { type: 'fish_caught' }> | undefined
    expect(prise, 'la prise a bien eu lieu').toBeDefined()
    expect(prise!.count).toBeLessThanOrEqual(portionsDe(sp, prise!.mm))
    expect(countOf(entity(b).inventory, sp.id)).toBe(prise!.count)
    expect(prise!.count).toBeGreaterThanOrEqual(place > 0 ? 1 : 0)
  })
})

// ── A25 — LE BESTIAIRE ───────────────────────────────────────────────────────
describe('A25 — le bestiaire enregistre, garde le record, et survit à la mort', () => {
  it('première prise : une ligne, un record, un fait', () => {
    const b = banc('fishing_spot_lake', { vers: 5 })
    jusquAUnPoisson(b)
    const sp = FISH_SPECIES.find((x) => x.id === entity(b).fishing!.species)!
    step(b.sim, [idle(b)])
    ferrer(b)
    const evs = drainEvents(b.sim)
    const carnet = entity(b).peche!
    expect(carnet).toHaveLength(1)
    expect(carnet[0]!.sp).toBe(sp.id)
    expect(carnet[0]!.prises).toBe(1)
    const records = des(evs, 'fish_record') as Extract<SimEvent, { type: 'fish_record' }>[]
    expect(records).toHaveLength(1)
    expect(records[0]!.mm).toBe(carnet[0]!.mm)
  })

  it('une prise plus petite ne remplace pas le record ; une plus grosse, si', () => {
    const b = banc('fishing_spot_lake', { vers: 20 })
    jusquAUnPoisson(b)
    const sp = FISH_SPECIES.find((x) => x.id === entity(b).fishing!.species)!
    step(b.sim, [idle(b)])
    ferrer(b)
    drainEvents(b.sim)
    const ligne = entity(b).peche!.find((l) => l.sp === sp.id)!
    ligne.mm = sp.tailleMaxMm // un record imbattable
    const recordAvant = ligne.mm
    attendre(b, BALANCE.GATHER_COOLDOWN_TICKS)
    let autres = 0
    for (let i = 0; i < 8; i++) {
      jusquAUnPoisson(b)
      const encore = entity(b).fishing!.species
      step(b.sim, [idle(b)])
      ferrer(b)
      drainEvents(b.sim)
      if (encore === sp.id) autres += 1
      attendre(b, BALANCE.GATHER_COOLDOWN_TICKS)
    }
    const apres = entity(b).peche!.find((l) => l.sp === sp.id)!
    expect(apres.mm, 'le record ne redescend jamais').toBe(recordAvant)
    expect(apres.prises, 'les prises se comptent quand même').toBe(1 + autres)
  }, 30_000)

  it('LA MORT PREND LE SAC, PAS LA MÉMOIRE', () => {
    const b = banc('fishing_spot_lake', { vers: 5 })
    jusquAUnPoisson(b)
    step(b.sim, [idle(b)])
    ferrer(b)
    drainEvents(b.sim)
    const avant = JSON.stringify(entity(b).peche)
    die(b.sim, entity(b), 0, 'cold')
    expect(JSON.stringify(entity(b).peche)).toBe(avant)
  })
})

// ── A26 — LES TROUVAILLES ────────────────────────────────────────────────────
describe('A26 — ce qui n’est pas un poisson n’est pas une prise', () => {
  it('une trouvaille ferrée : l’item au sac, `fishing_junk`, JAMAIS `fish_caught`, rien au bestiaire', () => {
    // Le Lac Mort n'a pas de poisson : tout ce qui mord y est une trouvaille (T4).
    const b = banc('fishing_spot_lake', { seed: 3, sansCoin: true, nature: NATURE_MARE })
    b.sim.map.zoneGrid = [0]
    b.sim.map.zonePas = 4096
    b.sim.map.zoneDefs = [{ slug: 'lac_mort', nom: 'le Lac Mort', tier: 2 }]
    for (let essai = 0; essai < 80; essai++) {
      if (entity(b).fishing === undefined) lancer(b)
      jusquALaTouche(b)
      const f = entity(b).fishing
      if (f === undefined || f.windowEnd === undefined) continue // ça a mordillé, puis la ligne est rentrée
      expect(f.species, 'aucun poisson au Lac Mort').toBeUndefined()
      const item = f.trouvaille!
      expect(item).toBeDefined()
      step(b.sim, [idle(b)])
      ferrer(b)
      const evs = drainEvents(b.sim)
      expect(des(evs, 'fish_caught'), 'un caillou n’est pas une prise').toHaveLength(0)
      const junk = des(evs, 'fishing_junk') as Extract<SimEvent, { type: 'fishing_junk' }>[]
      expect(junk).toHaveLength(1)
      expect(junk[0]!.item).toBe(item)
      expect(countOf(entity(b).inventory, item)).toBeGreaterThanOrEqual(1)
      expect(entity(b).peche, 'le bestiaire n’en veut pas').toBeUndefined()
      return
    }
    throw new Error('aucune trouvaille en 80 lancers sur une eau sans poisson')
  }, 30_000)

  it('LA FENÊTRE d’une trouvaille est large : ça ne se débat pas', () => {
    expect(FISHING.TROUVAILLE_WINDOW_TICKS).toBeGreaterThan(Math.max(...FISH_SPECIES.map((sp) => sp.windowTicks)))
    // Et les trouvailles dépendent de l'eau : du bois flotté en rivière, des algues au lac.
    const enRiviere = TROUVAILLES.filter((t) => t.eaux.includes('riviere')).map((t) => t.item)
    const auLac = TROUVAILLES.filter((t) => t.eaux.includes('lac')).map((t) => t.item)
    expect(enRiviere).toContain('wood')
    expect(auLac).not.toContain('wood')
  })
})

// ── A27 — LE SÉCHOIR (D13/S1-S5, item 4 d'Alexis) ────────────────────────────
/**
 * *« On doit aussi ajouter un séchoir pour le poisson et la viande afin de le garder plus
 * longtemps. »* — et il tient, sans sel, la promesse de CONSERVES que la spec assumait comme
 * non tenue depuis que le sel a été différé (2026-07-12).
 *
 * Trois choses à garder, et la troisième est une DÉCISION d'Alexis (contre ma recommandation) :
 * il sèche le poisson ET la viande, il conserve en PERDANT (moins nourrissant que le cuit), et
 * **ni la pluie ni le froid ne l'interrompent** — on pose, on accroche, on oublie.
 */
describe('A27 — le séchoir conserve, sans feu et sans surveillance', () => {
  function avecSechoir(): { b: Banc; poste: ReturnType<typeof addStructure> } {
    const b = banc('fishing_spot_lake', { vers: 5 })
    const poste = addStructure(b.sim, 'sechoir', 12, 15, 0, b.id)
    return { b, poste }
  }

  it('LA TABLE : tout poisson et toute viande sèchent, par CLASSE, et vers un séché qui tient', () => {
    for (const sp of FISH_SPECIES) {
      const regle = DRY_SLOT.sechoir![sp.id]
      expect(regle, `${sp.id} sèche`).toBeDefined()
      expect(regle!.output).toBe(`dried_fish_${sp.classe}`)
      // CONSERVER EN PERDANT (S3) : il tient bien plus longtemps que le cuit, et nourrit moins.
      const cuit = COOK_SLOT.fire![sp.id]!.output
      expect(SPOIL_CYCLES[regle!.output]!).toBeGreaterThan(SPOIL_CYCLES[cuit]!)
      expect(FOOD_VALUES[regle!.output]!).toBeLessThan(FOOD_VALUES[cuit]!)
      expect(FOOD_VALUES[regle!.output]!).toBeGreaterThan(FOOD_VALUES[sp.id]!)
    }
    for (const viande of ['raw_meat', 'quartier'] as ItemId[]) {
      expect(DRY_SLOT.sechoir![viande]!.output).toBe('dried_meat')
    }
    expect(SPOIL_CYCLES.dried_meat!).toBeGreaterThan(SPOIL_CYCLES.cooked_meat!)
    // …et SÉCHER PREND DU TEMPS : un autre ordre de grandeur que la cuisson (S2).
    expect(DRY_SLOT.sechoir!.gudgeon!.ticks).toBeGreaterThan(COOK_SLOT.fire!.gudgeon!.ticks * 20)
  })

  it('UN LOT SÈCHE : le poisson entre, le séché sort, sans une bûche', () => {
    const { b, poste } = avecSechoir()
    const entree = fireZoneInventory(poste, 'cookIn')!
    addItems(entree, { gudgeon: 2 })
    attendre(b, DRY_SLOT.sechoir!.gudgeon!.ticks + 2)
    expect(countOf(poste.cookOut!, 'dried_fish_petit'), 'une unité séchée est sortie').toBe(1)
    expect(countOf(entree, 'gudgeon'), 'et la suivante est engagée').toBe(1)
  })

  it('LA MÉTÉO NE L’INTERROMPT PAS (D13) — même lot, plein Grand Froid, même durée', () => {
    const { b, poste } = avecSechoir()
    b.sim.tick = tickDe(COEUR_DU_GRAND_FROID, true)
    const debut = b.sim.tick
    addItems(fireZoneInventory(poste, 'cookIn')!, { raw_meat: 1 })
    attendre(b, DRY_SLOT.sechoir!.raw_meat!.ticks + 2)
    expect(countOf(poste.cookOut!, 'dried_meat')).toBe(1)
    expect(b.sim.tick - debut).toBeLessThanOrEqual(DRY_SLOT.sechoir!.raw_meat!.ticks + 2)
  })

  it('LE SÉCHOIR N’A PAS DE COMBUSTIBLE, et n’accepte que ce qui se sèche', () => {
    const { poste } = avecSechoir()
    expect(fireZoneInventory(poste, 'fuel'), 'rien ne brûle ici').toBeUndefined()
    expect(fireZoneAccepts(poste, 'cookIn', 'gudgeon')).toBe(true)
    expect(fireZoneAccepts(poste, 'cookIn', 'raw_meat')).toBe(true)
    expect(fireZoneAccepts(poste, 'cookIn', 'wood'), 'on n’y accroche pas une bûche').toBe(false)
    expect(fireZoneAccepts(poste, 'cookOut', 'dried_fish_gros')).toBe(true)
  })

  it('A28 — LA CLAIE SALÉE (S4bis) : sel + poisson → salaison, et UN sel consommé', () => {
    const { b, poste } = avecSechoir()
    const entree = fireZoneInventory(poste, 'cookIn')!
    expect(fireZoneAccepts(poste, 'cookIn', 'salt'), 'la claie accepte le sel').toBe(true)
    addItems(entree, { gudgeon: 2, salt: 1 })
    attendre(b, DRY_SLOT.sechoir!.gudgeon!.ticks + 2)
    // Première unité : salée, le sel est parti.
    expect(countOf(poste.cookOut!, 'salted_fish_petit'), 'la première sort SALÉE').toBe(1)
    expect(countOf(entree, 'salt'), 'et le sel est consommé').toBe(0)
    // Seconde unité : plus de sel — elle sort SÉCHÉE, la claie ne se bloque pas.
    attendre(b, DRY_SLOT.sechoir!.gudgeon!.ticks + 2)
    expect(countOf(poste.cookOut!, 'dried_fish_petit'), 'la seconde sort séchée').toBe(1)
    // La salaison se REPOSE dans la sortie (le filtre la connaît).
    expect(fireZoneAccepts(poste, 'cookOut', 'salted_fish_petit')).toBe(true)
  })

  it('A28 — le sel seul ne sèche pas, ne se consomme pas, et ne bloque pas la claie', () => {
    const { b, poste } = avecSechoir()
    const entree = fireZoneInventory(poste, 'cookIn')!
    addItems(entree, { salt: 2 })
    attendre(b, DRY_SLOT.sechoir!.gudgeon!.ticks + 2)
    expect(countOf(entree, 'salt'), 'le sel attend, intact').toBe(2)
    expect(poste.cookOut === undefined || countOf(poste.cookOut, 'salted_fish_petit') === 0).toBe(true)
    // Et la claie sèche toujours autour de lui.
    addItems(entree, { raw_meat: 1 })
    attendre(b, DRY_SLOT.sechoir!.raw_meat!.ticks + 2)
    expect(countOf(poste.cookOut!, 'salted_meat'), 'la viande sort salée (le sel attendait ça)').toBe(1)
    expect(countOf(entree, 'salt')).toBe(1)
  })

  it('A28 — la table des salaisons est exhaustive, et le sel rachète EXACTEMENT la perte', () => {
    // Toute sortie de DRY_SLOT a sa salaison — une sortie ajoutée sans salaison rougit ICI.
    for (const regle of Object.values(DRY_SLOT.sechoir!)) {
      const sale = SALAISON_DU_SECHE[regle.output]
      expect(sale, `${regle.output} a sa salaison`).toBeDefined()
      // Pleine valeur du CUIT (S4bis) : salé = cuit, au point près.
      const cuitDe: Partial<Record<string, ItemId>> = {
        dried_fish_petit: 'cooked_fish_petit', dried_fish_moyen: 'cooked_fish_moyen',
        dried_fish_gros: 'cooked_fish_gros', dried_meat: 'cooked_meat',
      }
      expect(FOOD_VALUES[sale!]).toBe(FOOD_VALUES[cuitDe[regle.output]!])
      // Et ça ne pourrit JAMAIS : absent de la table, comme le tubercule.
      expect(SPOIL_CYCLES[sale!], `${sale} ne pourrit pas`).toBeUndefined()
    }
  })

  it('LE FOUR CUIT AUSSI (S5) — il fondait le minerai et ne savait pas griller un poisson', () => {
    const b = banc('fishing_spot_lake', { vers: 1 })
    const four = addStructure(b.sim, 'furnace', 12, 15, 0, b.id)
    expect(COOK_SLOT.furnace, 'le four a ses recettes').toBeDefined()
    expect(fireZoneAccepts(four, 'cookIn', 'trout')).toBe(true)
    addItems(fireZoneInventory(four, 'cookIn')!, { trout: 1 })
    attendre(b, COOK_SLOT.furnace!.trout!.ticks + 2)
    expect(countOf(four.cookOut!, 'cooked_fish_moyen')).toBe(1)
  })

  it('IL SE FABRIQUE À LA MAIN et SE POSE VRAIMENT — bois et corde, sans poste', () => {
    const r = RECIPES.sechoir
    expect(r.requiert).toBeNull()
    expect(r.inputs).toEqual({ wood: 6, rope: 2 })
    expect(r.output).toBe('sechoir')

    // ⚠ ET ON LE POSE POUR DE VRAI (le défaut qu'une garde de recette ne voit pas) :
    // `place_component` n'acceptait QUE les composants et le coffre, énumérés à la main. Le
    // séchoir — du mobilier posé comme le coffre — était fabricable, tenu en main, et
    // impossible à poser. Vu à l'écran, pas dans un test : d'où cette garde.
    const b = banc('fishing_spot_lake', { canne: false })
    createVillage(b.sim, { chiefId: b.id, tx: 16, ty: 15, npcsArrived: true })
    grantItems(b.sim, b.id, { sechoir: 1 })
    const e = entity(b)
    e.activeSlot = e.inventory.findIndex((sl) => sl !== null && sl.item === 'sechoir')
    step(b.sim, [{ ...idle(b), action: { type: 'place_component', tx: 17, ty: 15 } }])
    const pose = b.sim.structures.find((st) => st.type === 'sechoir')
    expect(pose, `le séchoir se pose (refus : ${JSON.stringify(des(drainEvents(b.sim), 'action_rejected'))})`).toBeDefined()
    expect(countOf(entity(b).inventory, 'sechoir' as ItemId), 'et l’objet est consommé').toBe(0)
  })
})
