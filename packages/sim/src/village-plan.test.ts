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
import { addStructure, type BuildOrder } from './village'
import { bedAnchor, desiredOrders, granaries, granaryStocks, HUT_SPOTS, HUT_W } from './village-plan'
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
function run(sim: SimState, ticks: number, collect?: SimEvent[]): void {
  for (let t = 0; t < ticks; t++) {
    step(sim, [])
    const evs = drainEvents(sim)
    if (collect) collect.push(...evs)
  }
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

  // ⚠ « LA PAILLASSE EST UN DOMICILE : chaque PNJ en reçoit une » part le 2026-09-29 : plus
  // aucun dormeur à loger. Ce qui reste au-dessus — le campement POSÉ, des paillasses et pas
  // de `house` — se voit toujours sur la carte, et c'est ce que `foundNpcVillage` bâtit encore.
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

  // ⚠ DEUX GARDES DU TABLEAU PARTENT LE 2026-09-29 avec `refreshBoard` : « le tableau porte
  // UNE tâche build, seulement si le grenier paie » et « au palier 2, le village veut de la
  // pierre ». Elles éprouvaient le TABLEAU DES CORVÉES, pas le plan : `desiredOrders`, qui est
  // le plan lui-même, garde ses gardes juste au-dessus et plus bas dans ce fichier.
})

/**
 * ⚠ **« LES PNJ BÂTISSENT (R4-R5) » EST RETIRÉ LE 2026-09-29.** Cette garde était la preuve que
 * le plan se RÉALISE — que des villageois forgent le marteau qui manque et posent l'anneau par
 * le pipeline joueur. Personne ne bâtit plus : elle n'a pas de sujet. **Ce qu'il reste à savoir,
 * le plan le dit toujours** — `desiredOrders` est éprouvé directement (l'ordre des ordres, le
 * toit après les murs, la cour défrichée avant le sol), et la POSE par le pipeline est éprouvée
 * par le joueur juste en dessous (« la palissade au marteau du joueur »). C'est l'EXÉCUTANT qui
 * s'en va, pas le plan ni le geste.
 */

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

  // ⚠ « P0.3c — et le tableau ne se tait plus » part le 2026-09-29 avec le tableau. Sa loi
  // utile survit en P0.3b juste au-dessus : **un silo compte dans les stocks du village**, ce
  // qui est la prémisse dont le tableau se servait. C'est le consommateur qui disparaît.
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

/**
 * ⚠ **« LE DÉFRICHEMENT TIENT SON DÉBIT » EST RETIRÉ LE 2026-09-29.** Ce chronomètre mesurait
 * qu'UNE corvée `build`/`defriche` servie par le tableau abat l'arbre d'un coup au lieu d'un
 * point de stock par fenêtre de cadence — une propriété de l'EXÉCUTEUR de corvée
 * (`executeBuild`), qui part avec l'IA. Il ne reste rien à chronométrer : plus de corvée, plus
 * de cadence, plus d'exécutant. Le PLAN, lui, affirme toujours que le défrichement vient en
 * tête de chantier (« TOUTE LA COUR se défriche — et l'ordre passe AVANT le sol et les murs »).
 */
