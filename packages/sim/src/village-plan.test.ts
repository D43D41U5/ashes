/**
 * L'ÉVOLUTION DES VILLAGES PNJ (spec `village-pnj-evolution.md`) — les critères R1-R10.
 *
 * Le monde de test est celui de `npc.test.ts` : herbe nue, ressources à distance de
 * corvée, `worldEvents: false` (on mesure une économie, pas une guerre). L'aube et le
 * crépuscule se REJOIGNENT en sautant `sim.tick` au bord du cycle — le calendrier est
 * une fonction du tick, le saut est légal et ne tire rien.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, VILLAGE_GROWTH } from './balance'
import { drainEvents, type SimEvent } from './events'
import { addItems, countOf } from './items'
import { createEmptyMap } from './map'
import type { ResourceNode } from './economy'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { dayTicksAt, TICKS_PER_CYCLE } from './time'
import { addStructure, createVillage, type BuildOrder } from './village'
import { bedAnchor, desiredOrders, granaries, granaryStocks, HUT_SPOTS, HUT_W } from './village-plan'
import { refreshBoard } from './village-board'
import { STRUCTURE_TYPES, piece } from './pieces'
import { foundNpcVillage } from './worldgen'

function npcVillageSim(count = 3): SimState {
  const map = createEmptyMap(28, 28, TERRAIN_GRASS)
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 24, ty: 12, stock: 12, regrowAt: 0 },
    { id: 2, type: 'tree', tx: 3, ty: 12, stock: 12, regrowAt: 0 },
    { id: 3, type: 'fiber_plant', tx: 12, ty: 24, stock: 8, regrowAt: 0 },
    { id: 4, type: 'rock', tx: 24, ty: 24, stock: 12, regrowAt: 0 },
  ]
  const sim = createSim(11, { map, nodes, worldEvents: false })
  foundNpcVillage(sim, 12, 12, count)
  drainEvents(sim)
  return sim
}

const granary = (sim: SimState) => sim.structures.find((s) => s.type === 'chest')!
const village = (sim: SimState) => sim.villages[0]!
const alive = (sim: SimState) =>
  sim.entities.filter((e) => village(sim).memberIds.includes(e.id) && e.hp > 0).length

function run(sim: SimState, ticks: number, collect?: SimEvent[]): void {
  for (let t = 0; t < ticks; t++) {
    step(sim, [])
    const evs = drainEvents(sim)
    if (collect) collect.push(...evs)
  }
}

/** Saute juste AVANT une phase du cycle (0 = aube), puis la franchit. */
function crossPhase(sim: SimState, phase: number, collect?: SimEvent[]): void {
  const cur = (sim.tick + sim.cycleOffset) % TICKS_PER_CYCLE
  let delta = (phase - cur + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  if (delta <= 3) delta += TICKS_PER_CYCLE
  sim.tick += delta - 3
  run(sim, 6, collect)
}

/**
 * Saute juste AVANT le CRÉPUSCULE et le franchit.
 *
 * Il ne se dit plus par une constante : la longueur du jour est saisonnière (spec
 * `saisons.md` S6) et `estCrepuscule` la teste par ÉGALITÉ EXACTE — viser l'heure de tombée
 * d'un AUTRE cycle que celui où l'on atterrit, c'est enjamber le tick de l'événement et
 * perdre la fermeture des portes sans une erreur. On résout donc le cycle visé d'abord, et
 * on lui demande SON crépuscule.
 */
function crossCrepuscule(sim: SimState, collect?: SimEvent[]): void {
  const aube = sim.tick - ((sim.tick + sim.cycleOffset) % TICKS_PER_CYCLE)
  let cible = aube + dayTicksAt(sim, aube)
  if (cible - sim.tick <= 3) {
    const suivante = aube + TICKS_PER_CYCLE
    cible = suivante + dayTicksAt(sim, suivante)
  }
  sim.tick = cible - 3
  run(sim, 6, collect)
}

describe('la fondation au campement (R1-R2)', () => {
  it('plus aucune house : des paillasses, le mobilier, palier 1', () => {
    const sim = npcVillageSim(3)
    const types = sim.structures.map((s) => s.type)
    expect(types.filter((t) => t === 'house')).toHaveLength(0)
    expect(types.filter((t) => t === 'paillasse')).toHaveLength(3)
    // Et RIEN d'autre que le Feu et le grenier : pas de mobilier — il ferait
    // couverture dans la mêlée (mesuré, voir village-plan.ts).
    expect(sim.structures).toHaveLength(5)
    expect(village(sim).buildTier).toBe(1)
  })

  it('la paillasse est un domicile : chaque PNJ en reçoit une', () => {
    const sim = npcVillageSim(2)
    run(sim, 3)
    const homes = sim.npcs.map((n) => n.homeId)
    expect(homes.every((h) => h !== null)).toBe(true)
    expect(new Set(homes).size).toBe(2) // jamais deux dormeurs sur le même lit
  })
})

describe('le plan directeur (R3)', () => {
  it('au palier 2, il veut la PALISSADE puis les logis — et rien deux fois (R15)', () => {
    const sim = npcVillageSim(3)
    village(sim).buildTier = 2
    const orders = desiredOrders(sim, village(sim))
    // 3 logis 4×4 : 16 sols + 15 murs + 1 porte chacun ; l'enceinte est une PALISSADE
    // (66 rondins sur l'anneau 9) percée d'une porte charretière de 2 vantaux.
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'floor')).toHaveLength(48)
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'wall')).toHaveLength(45)
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'palissade')).toHaveLength(66)
    expect(orders.filter((o) => o.action === 'pose' && o.structure === 'door')).toHaveLength(3 + 2)
    // L'ENCEINTE D'ABORD (R15, décision d'Alexis 2026-08-17) : la sonde de siège a montré
    // qu'aucun village ne fermait jamais son anneau de son vivant — les cendreux passaient
    // entre les maisons. On s'abrite avant de se loger.
    expect(orders[0]).toMatchObject({ action: 'pose', structure: 'palissade' })
    const premierSol = orders.findIndex((o) => o.action === 'pose' && o.structure === 'floor')
    const dernierePalissade = orders.map((o) => o.action === 'pose' && o.structure === 'palissade').lastIndexOf(true)
    expect(dernierePalissade).toBeLessThan(premierSol) // tout l'anneau avant la première chambre
    // Et TOUT l'anneau — vantaux de la porte charretière COMPRIS — porte le drapeau de
    // cadence : sans lui sur les vantaux, la porte traînait 14 min derrière son anneau
    // fermé, une brèche fixe de 2 tuiles (revue déterminisme, 2026-08-17).
    for (const [i, o] of orders.entries()) {
      if (o.action !== 'pose') continue
      if (i <= dernierePalissade + 2) expect(o.enceinte, `ordre ${i} (${o.structure})`).toBe(true)
      else expect(o.enceinte).toBeUndefined()
    }
  })

  it('le tableau porte UNE tâche build, seulement si le grenier paie', () => {
    const sim = npcVillageSim(2)
    village(sim).buildTier = 2
    addItems(granary(sim).inventory!, { wood: 100, berries: 20 }) // au-dessus des planchers (bois du Feu, ventre plein)
    refreshBoard(sim, village(sim))
    expect(village(sim).tasks.filter((t) => t.kind === 'build')).toHaveLength(1)
    // Grenier à sec : le premier ordre (un sol, 1 bois) devient impayable → aucune tâche.
    const sec = npcVillageSim(2)
    village(sec).buildTier = 2
    granary(sec).inventory = granary(sec).inventory!.map(() => null)
    refreshBoard(sec, village(sec))
    expect(village(sec).tasks.filter((t) => t.kind === 'build')).toHaveLength(0)
  })

  it('au palier 2, le village veut de la pierre (vers la barre du palier 3)', () => {
    const sim = npcVillageSim(2)
    village(sim).buildTier = 2
    refreshBoard(sim, village(sim))
    expect(village(sim).tasks.some((t) => t.kind === 'gather_stone')).toBe(true)
  })
})

describe('les PNJ bâtissent (R4-R5)', () => {
  it('sans marteau au village, ils le forgent et posent l\'enceinte — par le pipeline', () => {
    const sim = npcVillageSim(2)
    village(sim).buildTier = 2
    addItems(granary(sim).inventory!, { wood: 200, berries: 40, fiber: 10, stone: 10 })
    // Le chemin dur (pose d'arête, matériau) est désormais l'ANNEAU (R15 : l'enceinte
    // d'abord) — la palissade est une arête comme le mur l'était. La cadence fait qu'on
    // ne vérifie pas un volume ici : le volume et la survie se mesurent au banc (R11).
    const events: SimEvent[] = []
    run(sim, 11000, events)
    const forged = events.filter((e) => e.type === 'item_crafted' && e.recipeId === 'hammer')
    expect(forged.length).toBeGreaterThanOrEqual(1)
    const npcIds = new Set(sim.npcs.map((n) => n.entityId))
    const built = events.filter(
      (e): e is Extract<SimEvent, { type: 'structure_built' }> =>
        e.type === 'structure_built' && npcIds.has(e.ownerId),
    )
    expect(built.length).toBeGreaterThanOrEqual(2)
    expect(built.every((e) => e.structure === 'palissade')).toBe(true) // l'anneau avant tout (R15)
    // …et la pièce est bien une ARÊTE de bois du plan (pas une pose pleine tuile).
    const palissade = sim.structures.find((s) => s.id === built[0]!.structureId)!
    expect(palissade.edges).toBeDefined()
  })
})

describe('la montée de palier au surplus (R6)', () => {
  it('grenier garni → palier 2 à l’aube ; grenier de naissance → rien', () => {
    const sim = npcVillageSim(2)
    addItems(granary(sim).inventory!, { wood: 40, berries: 20 })
    const events: SimEvent[] = []
    crossPhase(sim, 0, events)
    expect(village(sim).buildTier).toBe(2)
    expect(events.some((e) => e.type === 'village_stage_up' && e.stage === 2)).toBe(true)

    const pauvre = npcVillageSim(2) // le grenier de naissance : food 10 < 15
    crossPhase(pauvre, 0)
    expect(village(pauvre).buildTier).toBe(1)
  })
})

describe('la porte rituelle (R7)', () => {
  it('ouvre à l’aube, ferme au crépuscule — et jamais chez un village à chef humain', () => {
    const sim = npcVillageSim(2)
    const gate = addStructure(sim, 'door', 12, 19, village(sim).id, 0, 'village', 'wood', 1)
    // Un village à chef HUMAIN, avec sa porte close : le rituel ne le touche pas.
    const chief = spawnEntity(sim, 24.5, 4.5)
    const humain = createVillage(sim, { chiefId: chief, tx: 24, ty: 4, npcsArrived: true })
    const porteHumaine = addStructure(sim, 'door', 24, 6, humain.id, chief, 'village', 'wood', 1)
    drainEvents(sim)

    crossPhase(sim, 0)
    expect(gate.open).toBe(true)
    expect(porteHumaine.open).toBeUndefined()
    crossCrepuscule(sim)
    expect(gate.open).toBeUndefined() // `undefined` EST « close » : le snapshot reste léger
    expect(porteHumaine.open).toBeUndefined()
  })
})

describe('la prospérité attire (R9)', () => {
  it('au plafond du palier 1 rien n’arrive ; au palier 2 le colon vient, avec sa paillasse', () => {
    const sim = npcVillageSim(3) // 3 = le plafond du campement
    addItems(granary(sim).inventory!, { berries: 60 })
    village(sim).buildTier = 1
    // food 70 ≥ 18 mais effectif = plafond → personne. (La barre du palier 2 exige
    // du bois : le grenier n'en a pas, le palier ne monte pas pendant ce test.)
    crossPhase(sim, 0)
    expect(alive(sim)).toBe(3)

    village(sim).buildTier = 2 // plafond 6 : la porte s'ouvre
    const events: SimEvent[] = []
    crossPhase(sim, 0, events)
    expect(alive(sim)).toBe(4)
    expect(events.some((e) => e.type === 'settler_arrived')).toBe(true)
    expect(sim.structures.filter((s) => s.type === 'paillasse')).toHaveLength(4)
  })
})

describe('la palissade au marteau du joueur (décision 2026-08-01)', () => {
  it('se pose sur une arête ; la pose pleine-tuile est refusée avec son motif', () => {
    const sim = createSim(3, { map: createEmptyMap(32, 32, TERRAIN_GRASS) })
    const player = spawnEntity(sim, 15.5, 15.5)
    const e = sim.entities.find((x) => x.id === player)!
    addItems(e.inventory, { wood: 20, hammer: 1 })
    e.activeSlot = e.inventory.findIndex((s) => s?.item === 'hammer')
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    drainEvents(sim)

    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'build', structure: 'palissade', tx: 17, ty: 15, edges: 1 } }])
    const posee = sim.structures.find((s) => s.type === 'palissade')
    expect(posee).toBeDefined()
    expect(posee!.edges).toBe(1)
    expect(posee!.ownerId).toBe(player)

    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'build', structure: 'palissade', tx: 18, ty: 15 } }])
    const evs = drainEvents(sim)
    expect(evs.some((ev) => ev.type === 'action_rejected' && ev.reason === 'la palissade se pose sur une arête')).toBe(true)
    expect(sim.structures.filter((s) => s.type === 'palissade')).toHaveLength(1)
  })
})

describe('le déterminisme (R10)', () => {
  it('deux runs identiques, chantier compris, rendent le même état', () => {
    const world = (): SimState => {
      const sim = npcVillageSim(2)
      village(sim).buildTier = 2
      addItems(granary(sim).inventory!, { wood: 120, berries: 30, fiber: 8 })
      return sim
    }
    const a = world()
    const b = world()
    run(a, 3000)
    run(b, 3000)
    expect(JSON.stringify(a.structures)).toBe(JSON.stringify(b.structures))
    expect(JSON.stringify(a.villages)).toBe(JSON.stringify(b.villages))
    expect(countOf(granary(a).inventory!, 'wood')).toBe(countOf(granary(b).inventory!, 'wood'))
  })
})

describe('le grenier est une FONCTION, pas un type (P0.3)', () => {
  /**
   * Le registre déclare `silo`, `cave` et `reserve` avec `fonction: 'grenier'` et
   * `capacite: 36` ; `granaries()` ne reconnaissait que `chest`. Le bourg montait donc sa
   * réserve — 8 bois et 4 fibres — et n'en tirait rien : elle ne comptait pas dans les stocks,
   * les cibles du tableau ne la voyaient pas, et le village mourait quand même en perdant son
   * coffre à 4 bois, alors qu'il avait une réserve pleine sous les yeux.
   *
   * La garde balaie TOUTES les pièces que le registre déclare grenier, pas le seul silo :
   * ajouter un quatrième palier ne doit pas rouvrir ce trou.
   */
  const PIECES_GRENIER = STRUCTURE_TYPES.filter((t) => piece(t).fonction === 'grenier')

  it('P0.3a — la garde voit ce qu’elle garde : le registre porte bien des greniers non-coffres', () => {
    expect(PIECES_GRENIER.length).toBeGreaterThanOrEqual(3)
    expect(PIECES_GRENIER).not.toContain('chest') // le coffre en est un par son ACCÈS, pas par sa fonction
  })

  it('P0.3b — chaque pièce à `fonction: grenier` compte dans les stocks du village', () => {
    for (const type of PIECES_GRENIER) {
      const sim = npcVillageSim()
      const v = village(sim)
      // On retire le coffre de fondation : il ne reste QUE la réserve bâtie.
      sim.structures = sim.structures.filter((s) => s.type !== 'chest')
      const s = addStructure(sim, type, 14, 12, v.id, 0)
      s.access = 'village'
      addItems(s.inventory ??= [], { berries: 9 })
      expect(granaries(sim, v.id).map((g) => g.type)).toEqual([type])
      expect(granaryStocks(sim, v.id).berries).toBe(9)
    }
  })

  it('P0.3c — et le tableau ne se tait plus : un village à silo travaille encore', () => {
    const sim = npcVillageSim()
    const v = village(sim)
    sim.structures = sim.structures.filter((s) => s.type !== 'chest') // le raid a cassé le coffre
    const silo = addStructure(sim, 'silo', 14, 12, v.id, 0)
    silo.access = 'village'
    v.tasks = []
    refreshBoard(sim, v)
    // Avant le correctif : ZÉRO tâche postée, y compris `feed_fire` — « la tâche
    // communautaire zéro, sans elle le village tombe ».
    expect(v.tasks.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// LE LOGIS EST UNE MAISON, PAS UN ENCLOS (décision d'Alexis, 2026-08-20)
//
// « Les PNJ mettent un toit et un sol à leurs maisons et coupent tout arbre, buisson, fleur
// etc. à l'intérieur de l'enceinte des maisons. Ça semble cohérent et ça doit le rester. »
//
// Les deux moitiés de la règle manquaient, et pour deux raisons DIFFÉRENTES — c'est pourquoi
// il y a deux gardes et non une :
//   · LE TOIT n'était simplement pas commandé. Le plan voulait le sol, les murs d'arête et la
//     porte, jamais la couverture : les villages PNJ bâtissaient à ciel ouvert.
//   · L'ARBRE, lui, était commandé AUTOUR. Les murs d'un logis sont des ARÊTES, et une arête
//     est dispensée de `poseLibre` par une règle juste (« elle court sur le trait, elle ne
//     prend pas le buisson ») : un logis pouvait donc se refermer sur un arbre vivant.
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('le logis est couvert et défriché (décision 2026-08-20)', () => {
  /** Les tuiles d'un logis, dérivées de la MÊME géométrie que le plan — jamais recopiées. */
  const tuilesDuLogis = (fx: number, fy: number, spot: readonly [number, number]): [number, number][] => {
    const out: [number, number][] = []
    for (let dy = 0; dy < HUT_W; dy++) for (let dx = 0; dx < HUT_W; dx++) out.push([fx + spot[0] + dx, fy + spot[1] + dy])
    return out
  }

  it('chaque tuile de chaque logis veut un TOIT, autant que de sols', () => {
    const sim = npcVillageSim(3)
    village(sim).buildTier = 2
    const orders = desiredOrders(sim, village(sim))
    const toits = orders.filter((o) => o.action === 'pose' && o.structure === 'roof') as Extract<BuildOrder, { action: 'pose' }>[]
    const sols = orders.filter((o) => o.action === 'pose' && o.structure === 'floor')
    // AUTANT QUE DE SOLS, et pas un compte écrit en dur : le jour où un logis change de
    // taille, la garde suit au lieu de rougir. Et > 0, sinon deux zéros seraient « égaux ».
    expect(sols.length).toBeGreaterThan(0)
    expect(toits).toHaveLength(sols.length)
    // EXHAUSTIF : on balaie la géométrie réelle des logis, on ne pioche pas une tuile.
    const v = village(sim)
    const couvert = new Set(toits.map((o) => `${o.tx},${o.ty}`))
    for (const spot of HUT_SPOTS) {
      const [ax, ay] = bedAnchor(v.fireTx, v.fireTy, spot)
      if (!sim.structures.some((s) => s.type === 'paillasse' && s.tx === ax && s.ty === ay)) continue
      for (const [tx, ty] of tuilesDuLogis(v.fireTx, v.fireTy, spot)) {
        expect(couvert.has(`${tx},${ty}`), `la tuile (${tx}, ${ty}) du logis reste à ciel ouvert`).toBe(true)
      }
    }
  })

  it('LE TOIT VIENT APRÈS LES MURS — on ne couvre pas trois murs debout', () => {
    const sim = npcVillageSim(1)
    village(sim).buildTier = 2
    const orders = desiredOrders(sim, village(sim))
    const dernierMur = orders.map((o) => o.action === 'pose' && (o.structure === 'wall' || o.structure === 'door')).lastIndexOf(true)
    const premierToit = orders.findIndex((o) => o.action === 'pose' && o.structure === 'roof')
    expect(dernierMur).toBeGreaterThanOrEqual(0)
    expect(premierToit).toBeGreaterThan(dernierMur)
  })

  it('TOUTE LA COUR se défriche — et l\'ordre passe AVANT le sol et les murs', () => {
    const sim = npcVillageSim(1)
    const v = village(sim)
    v.buildTier = 2
    // LE LOGIS RÉELLEMENT PLANIFIÉ : celui dont la paillasse est posée. Sans ce filtre, on
    // planterait l'arbre dans un logis que le plan ne réclame pas encore, et la garde
    // passerait au vert sans rien prouver.
    const spot = HUT_SPOTS.find((sp) => {
      const [ax, ay] = bedAnchor(v.fireTx, v.fireTy, sp)
      return sim.structures.some((s) => s.type === 'paillasse' && s.tx === ax && s.ty === ay)
    })!
    const tuiles = tuilesDuLogis(v.fireTx, v.fireTy, spot)
    // ON PROUVE LA PRÉMISSE : sans arbre planté dans l'enceinte, le plan ne demande AUCUN
    // défrichement. (La carte du banc porte quatre nœuds, tous hors du carré de l'enceinte.)
    expect(desiredOrders(sim, v).filter((o) => o.action === 'defriche')).toHaveLength(0)
    // EXHAUSTIF : un arbre vivant sur CHAQUE tuile du logis, pas sur une tuile choisie.
    let id = 1000
    for (const [tx, ty] of tuiles) {
      sim.nodes.push({ id: (id += 1), type: 'tree', tx, ty, stock: 5, regrowAt: 0 })
    }
    const orders = desiredOrders(sim, v)
    const defriches = orders.filter((o) => o.action === 'defriche') as Extract<BuildOrder, { action: 'defriche' }>[]
    expect(defriches).toHaveLength(tuiles.length)
    for (const [tx, ty] of tuiles) {
      expect(defriches.some((o) => o.tx === tx && o.ty === ty), `(${tx}, ${ty}) n'est pas défrichée`).toBe(true)
    }
    // L'ORDRE DE LA LISTE EST L'ORDRE DU CHANTIER : le tableau sert le premier ordre encore
    // ouvert, donc défricher DOIT précéder le sol et les murs de ce logis — sinon on referme
    // la pièce sur l'arbre et il n'y a plus qu'à rouvrir.
    const dernierDefriche = orders.map((o) => o.action === 'defriche').lastIndexOf(true)
    const premierSolDuLogis = orders.findIndex((o) => o.action === 'pose' && o.structure === 'floor')
    expect(premierSolDuLogis).toBeGreaterThan(dernierDefriche)
  })

  it('une SOUCHE ne se défriche pas deux fois (stock 0 = libre)', () => {
    const sim = npcVillageSim(1)
    const v = village(sim)
    v.buildTier = 2
    const spot = HUT_SPOTS.find((sp) => {
      const [ax, ay] = bedAnchor(v.fireTx, v.fireTy, sp)
      return sim.structures.some((s) => s.type === 'paillasse' && s.tx === ax && s.ty === ay)
    })!
    const [tx, ty] = tuilesDuLogis(v.fireTx, v.fireTy, spot)[0]!
    sim.nodes.push({ id: 999, type: 'tree', tx, ty, stock: 5, regrowAt: 0 })
    expect(desiredOrders(sim, v).filter((o) => o.action === 'defriche')).toHaveLength(1)
    // Récolté jusqu'au bout : le nœud RESTE (le client ne reçoit les nœuds qu'une fois, un
    // retrait lui laisserait un arbre fantôme) mais il ne compte plus — `poseLibre` le dit.
    sim.nodes.find((n) => n.id === 999)!.stock = 0
    expect(desiredOrders(sim, v).filter((o) => o.action === 'defriche')).toHaveLength(0)
  })
})

describe('la cour entière se défriche (décision 2026-08-20)', () => {
  it('un arbre n\'importe où DANS l\'enceinte se fait abattre — et pas un pas dehors', () => {
    const sim = npcVillageSim(1)
    const v = village(sim)
    v.buildTier = 2
    const r = VILLAGE_GROWTH.ENCEINTE_RADIUS
    // EXHAUSTIF SUR LA FRONTIÈRE : un arbre sur chaque tuile du carré de l'enceinte, et un
    // anneau d'arbres JUSTE DEHORS. La garde ne se contente pas de vérifier qu'on coupe :
    // elle vérifie aussi qu'on s'arrête — un défrichement qui déborde raserait la forêt.
    let id = 5000
    const dedans: string[] = []
    const dehors: string[] = []
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const tx = v.fireTx + dx
        const ty = v.fireTy + dy
        if (tx < 0 || ty < 0 || tx >= sim.map.width || ty >= sim.map.height) continue
        sim.nodes.push({ id: (id += 1), type: 'tree', tx, ty, stock: 5, regrowAt: 0 })
        ;(Math.max(Math.abs(dx), Math.abs(dy)) <= r ? dedans : dehors).push(`${tx},${ty}`)
      }
    }
    expect(dedans.length).toBeGreaterThan(100) // la garde a bien de quoi mesurer
    expect(dehors.length).toBeGreaterThan(0)
    const coupes = new Set(
      (desiredOrders(sim, v).filter((o) => o.action === 'defriche') as Extract<BuildOrder, { action: 'defriche' }>[])
        .map((o) => `${o.tx},${o.ty}`),
    )
    for (const cle of dedans) expect(coupes.has(cle), `(${cle}) est dans l'enceinte et reste debout`).toBe(true)
    for (const cle of dehors) expect(coupes.has(cle), `(${cle}) est DEHORS et se fait couper`).toBe(false)
  })

  it('la cour se dégage AVANT qu\'on bâtisse, et APRÈS l\'anneau (on s\'abrite d\'abord)', () => {
    const sim = npcVillageSim(1)
    const v = village(sim)
    v.buildTier = 2
    sim.nodes.push({ id: 6001, type: 'tree', tx: v.fireTx + 2, ty: v.fireTy + 2, stock: 5, regrowAt: 0 })
    const orders = desiredOrders(sim, v)
    const premierDefriche = orders.findIndex((o) => o.action === 'defriche')
    const dernierePalissade = orders.map((o) => o.action === 'pose' && o.structure === 'palissade').lastIndexOf(true)
    const premierSol = orders.findIndex((o) => o.action === 'pose' && o.structure === 'floor')
    expect(premierDefriche).toBeGreaterThan(dernierePalissade) // l'abri d'abord (R15)
    expect(premierDefriche).toBeLessThan(premierSol) // le sol net avant de le couvrir
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// LE DÉBIT DU CHANTIER — la garde qui manquait, et qui aurait dû rougir
//
// Les gardes ci-dessus vérifient la COMPOSITION des ordres : lesquels, dans quel ordre. Aucune
// ne regarde le DÉBIT — et c'est par là qu'est passé un défaut qui rendait les villages
// intestables. Le défrichement lâchait sa corvée après UN coup de hache ; un arbre porte 10 de
// stock et une fenêtre de chantier dure 8 400 ticks. MESURÉ sur le vrai worldgen
// (`construireMondeDuBanc`, graine 11), le pire des trois villages a 51 arbres (550 de stock)
// dans sa cour : **80 cycles de défrichement pour une saison qui en compte 6.** Il n'aurait
// jamais posé un sol. Un bûcheron ne part pas après un coup — il reste jusqu'à ce que l'arbre
// tombe, comme `executeGather` reste sur son nœud.
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('le défrichement TIENT SON DÉBIT (2026-08-20)', () => {
  it('un arbre de la cour tombe en UNE corvée, pas en dix', () => {
    const sim = npcVillageSim(3)
    const v = village(sim)
    v.buildTier = 2
    addItems(granary(sim).inventory!, { wood: 200, berries: 60 }) // le chantier ne doit pas caler faute de stock
    // UN SEUL arbre, planté dans la cour, loin des paillasses : ce qu'on chronomètre est le
    // défrichement, pas un logis qui se bâtit autour.
    const tx = v.fireTx + 5
    const ty = v.fireTy + 5
    sim.nodes.push({ id: 7777, type: 'tree', tx, ty, stock: 10, regrowAt: 0 })
    const arbre = () => sim.nodes.find((n) => n.id === 7777)!
    expect(arbre().stock, 'la prémisse : il est debout, plein').toBe(10)

    // L'ANNEAU D'ABORD — POSÉ, PAS ATTENDU. La cour ne se défriche qu'après la palissade
    // (R15 : on s'abrite avant tout), et l'anneau fait 66 rondins à la cadence de défense :
    // le chronométrer aussi mesurerait le chantier entier, pas le défrichement. On le pose
    // donc par le PLAN LUI-MÊME — jamais une géométrie recopiée, qui divergerait le jour où
    // l'enceinte change de forme.
    for (const o of desiredOrders(sim, v)) {
      if (o.action === 'pose' && o.enceinte === true) {
        addStructure(sim, o.structure, o.tx, o.ty, v.id, 0, undefined, o.material, o.edges)
      }
    }
    expect(desiredOrders(sim, v).some((o) => o.action === 'pose' && o.enceinte === true)).toBe(false)
    expect(desiredOrders(sim, v)[0], "le défrichement est en tête de chantier").toMatchObject({ action: 'defriche' })

    // ON POSE LA CORVÉE À LA MAIN, comme le fait déjà « le tableau porte UNE tâche build » :
    // la fenêtre de cadence n'ouvre qu'un tick sur 8 400, et l'attendre ferait mesurer
    // l'ALIGNEMENT de la cadence au lieu du geste. Ce qu'on chronomètre ici est le
    // défrichement lui-même, une fois la corvée servie.
    refreshBoard(sim, village(sim))
    const corvee = village(sim).tasks.find((t) => t.kind === 'build')
    expect(corvee?.build, 'le tableau n’a pas servi le défrichement').toMatchObject({ action: 'defriche', tx, ty })

    // UNE SEULE FENÊTRE de marge. Avec l'ancien modèle (un coup de hache puis on lâche la
    // corvée, et le tableau reposte à la fenêtre SUIVANTE), il en aurait fallu DIX — une par
    // point de stock. Ce plafond sépare donc exactement les deux comportements.
    const plafond = VILLAGE_GROWTH.BUILD_PACE_TICKS
    let tombe = -1
    for (let t = 0; t < plafond && tombe < 0; t++) {
      step(sim, [])
      if (arbre().stock === 0) tombe = t
    }
    expect(tombe, `l'arbre tient encore debout après ${plafond} ticks (une fenêtre entière)`).toBeGreaterThan(0)
  })
})
