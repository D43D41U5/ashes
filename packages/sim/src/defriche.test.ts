/**
 * LE DÉFRICHEMENT (`defriche.ts`) — critères d'acceptation.
 *
 * La règle, en un mot : **rien ne repousse dans l'emprise d'un village, sauf le vivant**
 * (décision d'Alexis, 2026-08-06). Ce qui s'extrait — bois, pierre, minerai, tourbe, cendre,
 * gravats — est consommé pour de bon ; les baies, la fibre et les champignons repoussent
 * jusque dans le village.
 *
 * Elle se tient sur QUATRE appuis, et il faut les quatre : la repousse ne se rouvre pas
 * (D1), la dérive n'entre pas dans l'emprise (D2 — c'est le vecteur principal, la dérive
 * porte à 12 tuiles quand l'emprise en fait 16), la tuile défrichée se LIBÈRE pour la pose
 * (D3 — sans quoi la règle se retourne contre elle-même), et l'emprise est le carré RÉSERVÉ,
 * pas celui du palier courant (D4).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAIN_GRASS } from './balance'
import { advanceEconomy, nodeAt, type ResourceNode } from './economy'
import { dansEmprise, noeudDefriche, poseLibre, rayonEmprise } from './defriche'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { createVillage, evaluateBuild, grantItems } from './village'

let idc = 900
function gabarit(type: ResourceNode['type'], tx: number, ty: number): ResourceNode {
  return { id: ++idc, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 }
}
function makeSim(nodes: ResourceNode[]): SimState {
  return createSim(11, { map: createEmptyMap(120, 120, TERRAIN_GRASS), nodes })
}
/** `createSim` COPIE les nœuds (l'état est JSON-sérialisable) : le littéral du test n'est
 *  qu'un GABARIT. Tout ce qu'on inspecte doit être le nœud VIVANT de l'état — sans ça on
 *  affirmerait sur une maquette que la sim n'a jamais touchée. */
function vif(s: SimState, n: ResourceNode): ResourceNode {
  return s.nodes.find((x) => x.id === n.id)!
}
function act(s: SimState, id: number, action: PlayerAction): void {
  step(s, [{ entityId: id, dx: 0, dy: 0, action }])
}
/** Vide un nœud à mains nues, coup par coup, et rend le nombre de coups portés. */
function vider(s: SimState, id: number, n: ResourceNode): number {
  const e = s.entities.find((x) => x.id === id)!
  let coups = 0
  while (n.stock > 0 && coups < 80) {
    // Juste au sud du nœud : à portée, hors de son emprise bloquante (se planter SUR un
    // rocher plein-tuile ferait éjecter l'acteur hors de portée par la collision).
    e.x = n.tx + 0.5
    e.y = n.ty + 1.4
    act(s, id, { type: 'harvest', nodeId: n.id })
    coups += 1
    e.cooldownUntil = 0 // on ne teste pas la cadence ici
    // Sac plein = coup refusé : on vide CE QU'ON RÉCOLTE, et rien d'autre — un `fill(null)`
    // emporterait le marteau, et le test suivant se refuserait pour la mauvaise raison.
    if (countOf(e.inventory, NODE_DEFS[n.type].item) > 40) {
      for (let i = 0; i < e.inventory.length; i++) {
        if (e.inventory[i]?.item === NODE_DEFS[n.type].item) e.inventory[i] = null
      }
    }
  }
  return coups
}
/** Avance l'économie bien au-delà de la plus longue repousse possible. */
function laisserLeTempsDeRepousser(s: SimState): void {
  const max = Math.ceil(BALANCE.NODE_REGROW_TICKS * 3 * (1 + BALANCE.DEPLETION_REGROW_PENALTY * BALANCE.DEPLETION_MAX))
  for (let i = 0; i <= max; i++) {
    s.tick += 1
    advanceEconomy(s)
  }
}
/** Un village dont le Feu brûle en (tx, ty), sans passer par le marteau ni le bois. */
function fonder(s: SimState, tx: number, ty: number, chiefId = 0): void {
  createVillage(s, { chiefId, tx, ty, npcsArrived: true })
}

const FEU_X = 60
const FEU_Y = 60

describe('D1 — la repousse ne se rouvre pas dans l’emprise', () => {
  it('un arbre vidé chez soi ne revient JAMAIS, le même arbre dehors revient', () => {
    // Deux arbres JUMEAUX : seul le village les sépare. Sans le témoin du dehors, un test
    // vert ne dirait pas si c'est le défrichement qui agit ou la repousse qui est cassée.
    const sim = makeSim([
      gabarit('tree', FEU_X + 4, FEU_Y),
      gabarit('tree', FEU_X + 4 + rayonEmprise() * 3, FEU_Y),
    ])
    const [dedans, dehors] = [sim.nodes[0]!, sim.nodes[1]!]
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)

    expect(vider(sim, id, dedans)).toBeGreaterThan(0) // la prémisse : on a bien frappé
    expect(dedans.stock).toBe(0)
    vider(sim, id, dehors)
    expect(dehors.stock).toBe(0)

    laisserLeTempsDeRepousser(sim)

    expect(dedans.stock).toBe(0) // défriché — pour de bon
    expect(dehors.stock).toBeGreaterThan(0) // le témoin : dehors, rien n'a changé
  })

  it('les baies et la fibre repoussent JUSQUE dans le village', () => {
    const sim = makeSim([gabarit('berry_bush', FEU_X + 2, FEU_Y), gabarit('fiber_plant', FEU_X + 4, FEU_Y)])
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)
    for (const n of [...sim.nodes]) {
      vider(sim, id, n)
      expect(n.stock).toBe(0)
    }
    laisserLeTempsDeRepousser(sim)
    for (const n of sim.nodes) expect(n.stock).toBeGreaterThan(0)
  })

  it('et le vivant repousse SUR PLACE, jusqu’au dernier rang de l’emprise', () => {
    // LE CAS QUI NE SE VOIT QU'AU BORD. La fibre est `renewable`, donc elle prend la branche
    // ordinaire — celle qui DÉRIVE. Au cœur du carré ça ne se voyait pas : les huit sondes de
    // `relocateNode` tombent toutes dans l'emprise, sont toutes refusées, et la dérive dégrade
    // vers « reste sur place ». Au DERNIER RANG, une sonde sur huit tombe dehors et le plant
    // s'en va — le potager spontané migrerait hors du village au fil de la saison.
    const r = rayonEmprise()
    const sim = makeSim([gabarit('fiber_plant', FEU_X + r, FEU_Y), gabarit('fiber_plant', FEU_X, FEU_Y + r)])
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)
    for (const n of [...sim.nodes]) {
      const [tx0, ty0] = [n.tx, n.ty]
      vider(sim, id, n)
      expect([n.tx, n.ty]).toEqual([tx0, ty0]) // elle n'a pas bougé d'une tuile
    }
    laisserLeTempsDeRepousser(sim)
    for (const n of sim.nodes) {
      expect(n.stock).toBeGreaterThan(0)
      expect(dansEmprise(sim.villages, n.tx, n.ty)).toBe(true) // …et elle a repoussé CHEZ NOUS
    }
  })

  it('un nœud vidé AVANT la fondation ne repousse pas non plus : l’emprise l’attrape', () => {
    const sim = makeSim([gabarit('tree', FEU_X + 4, FEU_Y)])
    const arbre = sim.nodes[0]!
    const id = spawnEntity(sim, 0, 0)
    vider(sim, id, arbre) // pas encore de village : repousse programmée, dérive faite
    expect(arbre.regrowAt).toBeGreaterThan(0)
    fonder(sim, arbre.tx - 4, arbre.ty) // …et le Feu s'allume par-dessus (le nœud a pu dériver)
    laisserLeTempsDeRepousser(sim)
    expect(arbre.stock).toBe(0)
  })

  it('la TABLE dit qui repousse : le vivant, et lui seul', () => {
    // Exhaustive PAR CONSTRUCTION : la liste vient du registre, pas d'un choix de test.
    const vivants = Object.entries(NODE_DEFS)
      .filter(([, d]) => d.renewable)
      .map(([t]) => t)
      .sort()
    expect(vivants).toEqual(['berry_bush', 'champignon', 'fiber_plant'])
  })
})

describe('D2 — la dérive n’entre pas dans l’emprise', () => {
  it('aucun arbre du pourtour ne ressort DEDANS, si près du bord soit-il', () => {
    // La dérive porte `RELOCATE_RADIUS` (12) et l'emprise en fait `rayonEmprise()` (16) :
    // une couronne d'arbres collée au bord peut donc TOUTE viser l'intérieur. On les vide
    // tous, et on affirme UNE propriété sur l'espace entier — pas sur trois cas choisis.
    const r = rayonEmprise()
    const gabarits: ResourceNode[] = []
    for (let d = 1; d <= BALANCE.RELOCATE_RADIUS; d++) {
      gabarits.push(gabarit('tree', FEU_X + r + d, FEU_Y))
      gabarits.push(gabarit('tree', FEU_X - r - d, FEU_Y))
      gabarits.push(gabarit('tree', FEU_X, FEU_Y + r + d))
      gabarits.push(gabarit('tree', FEU_X, FEU_Y - r - d))
    }
    const sim = makeSim(gabarits)
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)

    let derives = 0
    for (const g of gabarits) {
      const n = vif(sim, g)
      const [tx0, ty0] = [n.tx, n.ty]
      vider(sim, id, n)
      if (n.tx !== tx0 || n.ty !== ty0) derives += 1
    }
    expect(derives).toBeGreaterThan(0) // la prémisse : la dérive a bien joué

    for (const n of sim.nodes) expect(dansEmprise(sim.villages, n.tx, n.ty)).toBe(false)
  })

  it('un arbre défriché ne dérive pas : il reste sur sa tuile, souche', () => {
    const sim = makeSim([gabarit('tree', FEU_X + 4, FEU_Y)])
    const arbre = sim.nodes[0]!
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)
    vider(sim, id, arbre)
    expect([arbre.tx, arbre.ty]).toEqual([FEU_X + 4, FEU_Y])
    expect(arbre.regrowAt).toBe(0) // la MARQUE que le client lit
    expect(noeudDefriche(sim.villages, arbre)).toBe(true)
  })
})

describe('D3 — la tuile défrichée se libère pour la pose', () => {
  it('l’arbre plein refuse le mur, la souche l’accepte', () => {
    const sim = makeSim([gabarit('tree', FEU_X + 4, FEU_Y)])
    const arbre = sim.nodes[0]!
    const id = spawnEntity(sim, FEU_X + 4.5, FEU_Y + 1.4)
    fonder(sim, FEU_X, FEU_Y, id)
    grantItems(sim, id, { hammer: 1, wood: 20 })
    const moi = sim.entities.find((e) => e.id === id)!
    const enMain = (): void => {
      moi.activeSlot = moi.inventory.findIndex((s) => s !== null && s.item === 'hammer')
    }
    enMain()

    expect(poseLibre(sim.villages, sim.nodes, arbre.tx, arbre.ty)).toBe(false)
    expect(evaluateBuild(sim, id, 'wall', arbre.tx, arbre.ty, 'wood').reason).toBe('node')

    vider(sim, id, arbre)
    enMain() // la récolte a pu changer de main
    moi.x = FEU_X + 4.5
    moi.y = FEU_Y + 1.4

    expect(poseLibre(sim.villages, sim.nodes, arbre.tx, arbre.ty)).toBe(true)
    expect(evaluateBuild(sim, id, 'wall', arbre.tx, arbre.ty, 'wood').reason ?? 'ok').toBe('ok')
  })

  it('un buisson VIVANT, lui, occupe toujours sa tuile — même vidé (il repoussera)', () => {
    const sim = makeSim([gabarit('berry_bush', FEU_X + 4, FEU_Y)])
    const buisson = sim.nodes[0]!
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)
    vider(sim, id, buisson)
    expect(buisson.stock).toBe(0)
    expect(poseLibre(sim.villages, sim.nodes, buisson.tx, buisson.ty)).toBe(false)
  })
})

describe('D4 — l’emprise est le carré RÉSERVÉ, pas celui du palier', () => {
  it('un village de palier 1 défriche déjà jusqu’au rayon du palier 3', () => {
    const r1 = BALANCE.FIRE_RADIUS_BY_TIER[0]!
    const rMax = rayonEmprise()
    expect(rMax).toBeGreaterThan(r1) // la prémisse : les deux rayons diffèrent vraiment

    // Un arbre dans la COURONNE — hors du carré constructible au palier 1, dans le réservé.
    const sim = makeSim([gabarit('tree', FEU_X + rMax, FEU_Y)])
    const arbre = sim.nodes[0]!
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)
    expect(sim.villages[0]!.tier).toBe(1)

    vider(sim, id, arbre)
    laisserLeTempsDeRepousser(sim)
    expect(arbre.stock).toBe(0)

    // Et juste UNE tuile plus loin, le monde reprend ses droits.
    expect(dansEmprise(sim.villages, FEU_X + rMax, FEU_Y)).toBe(true)
    expect(dansEmprise(sim.villages, FEU_X + rMax + 1, FEU_Y)).toBe(false)
  })
})

describe('l’index des nœuds reste juste', () => {
  it('la souche reste indexée sur sa tuile (elle n’a pas dérivé)', () => {
    const sim = makeSim([gabarit('tree', FEU_X + 4, FEU_Y)])
    const arbre = sim.nodes[0]!
    const id = spawnEntity(sim, 0, 0)
    fonder(sim, FEU_X, FEU_Y)
    expect(nodeAt(sim.nodes, arbre.tx, arbre.ty)).toBe(arbre)
    vider(sim, id, arbre)
    expect(nodeAt(sim.nodes, FEU_X + 4, FEU_Y)).toBe(arbre)
  })
})
