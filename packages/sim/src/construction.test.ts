/**
 * LA CONSTRUCTION — critères d'acceptation de `docs/specs/construction.md`.
 *
 * TRANCHE 1 (le marteau & la pose) : A1 (fondation R1), A2 (carré ×palier R2),
 * A6 (navigabilité R7), A8 (pose instantanée R15), et les paliers de matériau (R8).
 * Les tranches suivantes (Forge, Atelier, Grenier, Ferme) ajouteront A3-A5 ici même.
 *
 * Sim-first, headless : seed + inputs → état attendu.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, STRUCTURE_HP, WALL_TIERS } from './balance'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { TERRAIN_GRASS, TERRAIN_DEEP_WATER } from './balance'
import { createSim, snapshot, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { recognizeFunctions, type ComponentType } from './index'
import { advanceSpoilage } from './economy'
import { addStructure, applyStructureDamage, fireRadius, getVillageOf, structureAt } from './village'
import { grantItems } from './village'

const R_MAX = BALANCE.FIRE_RADIUS_BY_TIER[BALANCE.FIRE_RADIUS_BY_TIER.length - 1]!

function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(160, 160, TERRAIN_GRASS) })
}

function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}

function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

function slotOf(sim: SimState, id: number, item: string): number {
  return sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s?.item === item)
}

/**
 * Un colon prêt à fonder : posé à (x+0.5, y+0.5), doté d'un feu de camp, d'un
 * marteau et de matériaux (bois/pierre/pierre de taille/lingot pour tous les paliers).
 * Ne fonde PAS — les tests décident du geste (place_campfire / found_village).
 */
function settler(sim: SimState, x: number, y: number): number {
  const id = spawnEntity(sim, x + 0.5, y + 0.5)
  // Dosé pour tenir dans les 18 cases du sac (wood ×20/case, iron ×5/case) tout en
  // couvrant fondation + montées de palier + murs de tous matériaux.
  grantItems(sim, id, { campfire: 1, hammer: 1, wood: 80, stone: 40, cut_stone: 40, iron_ingot: 20 })
  return id
}

/** Pose le feu de camp tenu sur la tuile (tx,ty), puis le promeut en foyer. */
function foundVillage(sim: SimState, id: number, fireTx: number, fireTy: number): number {
  act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
  act(sim, id, { type: 'place_campfire', tx: fireTx, ty: fireTy })
  const fire = structureAt(sim.structures, fireTx, fireTy)!
  act(sim, id, { type: 'found_village', structureId: fire.id })
  return fire.id
}

/** Met le marteau en main (préalable à toute pose de barrière, R19-R20). */
function equipHammer(sim: SimState, id: number): void {
  act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'hammer') })
}

/**
 * Pose un COMPOSANT via l'action réelle `place_component` : on le met en case 0 de
 * la ceinture (le sac du colon déborde de la ceinture après tous ses matériaux), on
 * poste le colon à côté de la tuile, on pose.
 */
function placeComp(sim: SimState, id: number, comp: ComponentType, tx: number, ty: number): void {
  const e = sim.entities.find((x) => x.id === id)!
  e.inventory[0] = { item: comp, count: 1 }
  e.activeSlot = 0
  e.x = tx + 0.5
  e.y = ty + 1.5 // une tuile au sud : à portée, jamais sous ses pieds
  act(sim, id, { type: 'place_component', tx, ty })
}

/** La forge reconnue dans l'état, ou undefined. */
function forgeOf(sim: SimState) {
  return recognizeFunctions(sim.structures).find((f) => f.functionId === 'forge')
}

function functionEvents(sim: SimState): { tier: number; enclosed: boolean }[] {
  return drainEvents(sim).flatMap((e) =>
    e.type === 'function_changed' && e.functionId === 'forge' ? [{ tier: e.tier, enclosed: e.enclosed }] : [],
  )
}

// ─────────────────────────────────────────────────────────────────────────────
describe('A1 — la fondation (R1)', () => {
  it('fonde sur sol ouvert, loin de tout : village créé, événement émis', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    drainEvents(sim)
    foundVillage(sim, id, 41, 40)
    expect(getVillageOf(sim, id)?.chiefId).toBe(id)
    expect(structureAt(sim.structures, 41, 40)?.type).toBe('fire')
    const events = drainEvents(sim)
    expect(events.some((e) => e.type === 'village_founded' && e.chiefId === id)).toBe(true)
  })

  it('refuse de poser le feu sur un nœud ou dans l’eau', () => {
    const sim = makeSim()
    // Un nœud sous la tuile visée, et une mare.
    sim.nodes.push({ id: 1, type: 'tree', tx: 41, ty: 40, stock: 5, regrowAt: 0 })
    sim.map.terrain[40 * sim.map.width + 42] = TERRAIN_DEEP_WATER
    const id = settler(sim, 40, 40)
    act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
    drainEvents(sim)
    act(sim, id, { type: 'place_campfire', tx: 41, ty: 40 }) // sur le nœud
    act(sim, id, { type: 'place_campfire', tx: 42, ty: 40 }) // dans l’eau
    expect(rejections(sim)).toEqual(['tuile occupée', 'terrain inconstructible'])
    expect(sim.structures.filter((s) => s.type === 'fire')).toHaveLength(0)
  })

  it('refuse la fondation si un POI-spécifique tombe dans le carré à taille max', () => {
    const sim = makeSim()
    // Un gisement (POI-spécifique) à R_MAX−2 du feu visé : il tombe dans le carré.
    sim.map.zones.push({ name: 'le Filon', x: 40 + R_MAX - 2, y: 40, w: 3, h: 3, kind: 'gisement' })
    const id = settler(sim, 40, 40)
    drainEvents(sim)
    foundVillage(sim, id, 41, 40)
    expect(rejections(sim)).toContain('un landmark tombe dans le carré')
    expect(sim.villages).toHaveLength(0)
  })

  it('un TOPONYME (zone sans kind) ne bloque PAS la fondation (communs contestés)', () => {
    const sim = makeSim()
    sim.map.zones.push({ name: 'les Prés Bas', x: 40, y: 40, w: 6, h: 6 }) // pas de kind
    const id = settler(sim, 50, 50) // hors du toponyme, mais le carré R_MAX le couvre
    drainEvents(sim)
    foundVillage(sim, id, 51, 50)
    expect(sim.villages).toHaveLength(1)
  })

  it('refuse un second foyer à moins de 2·R_max (Chebyshev), accepte au-delà', () => {
    const sim = makeSim()
    const a = settler(sim, 40, 40)
    foundVillage(sim, a, 41, 40)
    // 2·R_max = FIRE_MIN_DISTANCE. Un feu à FIRE_MIN_DISTANCE−1 (Chebyshev) du Feu A est trop près.
    const fireBx = 41 + BALANCE.FIRE_MIN_DISTANCE - 1
    const b = settler(sim, fireBx - 1, 40)
    drainEvents(sim)
    foundVillage(sim, b, fireBx, 40)
    expect(rejections(sim)).toContain('trop proche d’un autre Feu')
    // …et à 2·R_max ou au-delà : accepté.
    const fireCx = 41 + BALANCE.FIRE_MIN_DISTANCE + 3
    const c = settler(sim, fireCx - 1, 40)
    foundVillage(sim, c, fireCx, 40)
    expect(sim.villages).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A2 — le carré ×palier (R2)', () => {
  it('le carré vaut R(palier) ; poser hors du carré est refusé', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const village = getVillageOf(sim, id)!
    expect(village.tier).toBe(1)
    const r1 = fireRadius(1)
    // Au bord DU carré (Chebyshev = r1) : accepté. Il faut être à portée de bras :
    // on téléporte le colon près de la tuile visée (le test parle du carré, pas du pas).
    const edge = { tx: 41 + r1, ty: 40 }
    sim.entities.find((e) => e.id === id)!.x = edge.tx + 0.5
    sim.entities.find((e) => e.id === id)!.y = edge.ty + 0.5
    drainEvents(sim)
    act(sim, id, { type: 'build', structure: 'wall', tx: edge.tx, ty: edge.ty })
    expect(structureAt(sim.structures, edge.tx, edge.ty)?.type).toBe('wall')
    // Juste au-delà (Chebyshev = r1+1) : refusé « hors du carré ».
    const out = { tx: 41 + r1 + 1, ty: 40 }
    sim.entities.find((e) => e.id === id)!.x = out.tx + 0.5
    act(sim, id, { type: 'build', structure: 'wall', tx: out.tx, ty: out.ty })
    expect(rejections(sim)).toContain('hors du carré du Feu')
  })

  it('monter le Feu d’un palier agrandit le carré (ce qui était hors le devient dans)', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const r1 = fireRadius(1)
    const target = { tx: 41 + r1 + 1, ty: 40 } // hors du carré au palier 1
    const e = sim.entities.find((x) => x.id === id)!
    e.x = target.tx + 0.5
    e.y = target.ty + 0.5
    drainEvents(sim)
    act(sim, id, { type: 'build', structure: 'wall', tx: target.tx, ty: target.ty })
    expect(rejections(sim)).toContain('hors du carré du Feu')
    // Le Chef s’approche du Feu et le monte d’un palier.
    e.x = 41.5
    e.y = 40.5
    act(sim, id, { type: 'upgrade_fire' })
    expect(getVillageOf(sim, id)!.tier).toBe(2)
    expect(fireRadius(2)).toBeGreaterThan(r1)
    // La même tuile est désormais DANS le carré : la pose passe.
    e.x = target.tx + 0.5
    act(sim, id, { type: 'build', structure: 'wall', tx: target.tx, ty: target.ty })
    expect(structureAt(sim.structures, target.tx, target.ty)?.type).toBe('wall')
  })

  it('upgrade_fire : seul le Chef, coût débité, plafonné à 3', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    const e = sim.entities.find((x) => x.id === id)!
    e.x = 41.5
    e.y = 40.5
    const woodBefore = countOf(e.inventory, 'wood')
    act(sim, id, { type: 'upgrade_fire' }) // → palier 2
    expect(getVillageOf(sim, id)!.tier).toBe(2)
    expect(countOf(e.inventory, 'wood')).toBeLessThan(woodBefore) // coût débité
    act(sim, id, { type: 'upgrade_fire' }) // → palier 3
    expect(getVillageOf(sim, id)!.tier).toBe(3)
    drainEvents(sim)
    act(sim, id, { type: 'upgrade_fire' }) // déjà au max
    expect(rejections(sim)).toContain('palier maximal atteint')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A6 — l’invariant de navigabilité (R7)', () => {
  it('un mur qui muraille le Feu est refusé ; les précédents passent', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const e = sim.entities.find((x) => x.id === id)!
    // Le Chef se poste à portée des quatre voisins orthogonaux du Feu (41,40).
    e.x = 43.5
    e.y = 40.5
    drainEvents(sim)
    // Trois côtés : le Feu atteint encore le dehors par le dernier — acceptés.
    act(sim, id, { type: 'build', structure: 'wall', tx: 40, ty: 40 })
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 39 })
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41 })
    expect(structureAt(sim.structures, 40, 40)?.type).toBe('wall')
    expect(structureAt(sim.structures, 41, 39)?.type).toBe('wall')
    expect(structureAt(sim.structures, 41, 41)?.type).toBe('wall')
    // Le quatrième SCELLE le Feu : refusé.
    act(sim, id, { type: 'build', structure: 'wall', tx: 42, ty: 40 })
    expect(rejections(sim)).toContain('cela couperait le passage')
    expect(structureAt(sim.structures, 42, 40)).toBeUndefined()
  })

  it('une PORTE (pièce passante) referme la boucle sans casser la navigabilité', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const e = sim.entities.find((x) => x.id === id)!
    e.x = 43.5
    e.y = 40.5
    act(sim, id, { type: 'build', structure: 'wall', tx: 40, ty: 40 })
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 39 })
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41 })
    drainEvents(sim)
    // La porte, elle, passe : le Feu reste accostable par elle.
    act(sim, id, { type: 'build', structure: 'door', tx: 42, ty: 40 })
    expect(structureAt(sim.structures, 42, 40)?.type).toBe('door')
    expect(rejections(sim)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A8 — la pose instantanée (R15)', () => {
  it('build débite les matériaux et pose la structure au tick même — aucun chantier', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const e = sim.entities.find((x) => x.id === id)!
    const woodBefore = countOf(e.inventory, 'wood')
    act(sim, id, { type: 'build', structure: 'wall', tx: 42, ty: 40 })
    const wall = structureAt(sim.structures, 42, 40)!
    // Posée, pleine vie, débitée — pas d’état intermédiaire.
    expect(wall.type).toBe('wall')
    expect(wall.hp).toBe(STRUCTURE_HP.wall)
    expect(countOf(e.inventory, 'wood')).toBe(woodBefore - 2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('les paliers de matériau des murs/portes (R8)', () => {
  it('build bois par défaut ; upgrade_structure passe à la pierre (+PV, coût débité)', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const e = sim.entities.find((x) => x.id === id)!
    act(sim, id, { type: 'build', structure: 'wall', tx: 42, ty: 40 })
    const wall = structureAt(sim.structures, 42, 40)!
    expect(wall.material).toBeUndefined() // bois = défaut, non stocké
    expect(wall.hp).toBe(WALL_TIERS.wood.wall.hp)
    const cutBefore = countOf(e.inventory, 'cut_stone')
    act(sim, id, { type: 'upgrade_structure', structureId: wall.id })
    expect(wall.material).toBe('stone')
    expect(wall.hp).toBe(WALL_TIERS.stone.wall.hp) // intact → monte au plafond pierre
    expect(countOf(e.inventory, 'cut_stone')).toBe(cutBefore - (WALL_TIERS.stone.upgrade.cut_stone ?? 0))
  })

  it('build directement en pierre : coût pierre, PV pierre', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    equipHammer(sim, id)
    const e = sim.entities.find((x) => x.id === id)!
    const cutBefore = countOf(e.inventory, 'cut_stone')
    act(sim, id, { type: 'build', structure: 'wall', tx: 42, ty: 40, material: 'stone' })
    const wall = structureAt(sim.structures, 42, 40)!
    expect(wall.material).toBe('stone')
    expect(wall.hp).toBe(WALL_TIERS.stone.wall.hp)
    expect(countOf(e.inventory, 'cut_stone')).toBe(cutBefore - (WALL_TIERS.stone.wall.cost.cut_stone ?? 0))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A3 — l’émergence & le palier de la Forge (R9-R10)', () => {
  it('poser {enclume} fait Forge N1 ; +four → N2 ; démolir le four → N1', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    drainEvents(sim)
    // {enclume} seule = Forge N1.
    placeComp(sim, id, 'enclume', 44, 44)
    expect(forgeOf(sim)?.tier).toBe(1)
    expect(functionEvents(sim)).toContainEqual({ tier: 1, enclosed: false }) // formée

    // + four à ≤ AMAS_RADIUS → N2.
    placeComp(sim, id, 'furnace', 45, 44)
    expect(forgeOf(sim)?.tier).toBe(2)
    expect(functionEvents(sim)).toContainEqual({ tier: 2, enclosed: false })

    // Démolir le four → retombe N1 (le four est un composant du même amas).
    const four = structureAt(sim.structures, 45, 44)!
    const e = sim.entities.find((x) => x.id === id)!
    e.x = 45.5
    e.y = 45.5
    act(sim, id, { type: 'demolish', structureId: four.id })
    expect(forgeOf(sim)?.tier).toBe(1)
    expect(functionEvents(sim)).toContainEqual({ tier: 1, enclosed: false })
  })

  it('un four_acier hors palier du Feu est refusé (P3, R6)', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40) // palier 1
    const e = sim.entities.find((x) => x.id === id)!
    e.inventory[0] = { item: 'four_acier', count: 1 }
    e.activeSlot = 0
    e.x = 44.5
    e.y = 45.5
    drainEvents(sim)
    act(sim, id, { type: 'place_component', tx: 44, ty: 44 })
    expect(rejections(sim)).toContain('composant verrouillé (palier du Feu)')
    expect(structureAt(sim.structures, 44, 44)).toBeUndefined()
  })
})

describe('A4 — pas d’unicité (R11)', () => {
  it('deux amas forge distincts = deux forges', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    // Deux enclumes séparées de plus qu'AMAS_RADIUS → deux amas → deux forges.
    placeComp(sim, id, 'enclume', 44, 44)
    placeComp(sim, id, 'enclume', 44, 44 + BALANCE.AMAS_RADIUS + 2)
    const forges = recognizeFunctions(sim.structures).filter((f) => f.functionId === 'forge')
    expect(forges).toHaveLength(2)
    expect(forges.every((f) => f.tier === 1)).toBe(true)
  })
})

describe('A5 — l’enceinte (R13-R14)', () => {
  // Layout monté via `addStructure` (on teste la RECONNAISSANCE d'enceinte, pas la
  // navigabilité) : enclume au centre d'un 3×3 toité, ceint de murs.
  function enclosedForge(sim: SimState, v: number, owner: number, cx: number, cy: number): void {
    addStructure(sim, 'enclume', cx, cy, v, owner)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue // l'enclume tient sa propre couverture
        addStructure(sim, 'roof', cx + dx, cy + dy, v, owner)
      }
    }
    // Les 12 murs : les 4-voisins de l'intérieur 3×3 (les coins ne fuient pas en 4-connexité).
    for (let d = -1; d <= 1; d++) {
      addStructure(sim, 'wall', cx + d, cy - 2, v, owner)
      addStructure(sim, 'wall', cx + d, cy + 2, v, owner)
      addStructure(sim, 'wall', cx - 2, cy + d, v, owner)
      addStructure(sim, 'wall', cx + 2, cy + d, v, owner)
    }
  }

  it('clos + entièrement toité → bonus ; un trou de toit le retire SANS casser la fonction', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    const v = getVillageOf(sim, id)!.id
    enclosedForge(sim, v, id, 45, 45)
    expect(forgeOf(sim)).toMatchObject({ tier: 1, enclosed: true })

    // Un trou dans la couverture (on détruit un toit) : bonus perdu, fonction intacte.
    const roof = sim.structures.find((s) => s.type === 'roof')!
    applyStructureDamage(sim, roof.id, 99999)
    const forge = forgeOf(sim)
    expect(forge?.tier).toBe(1) // la fonction SURVIT
    expect(forge?.enclosed).toBe(false) // le bonus tombe
  })

  it('un amas ouvert (sans murs) n’est jamais clos', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    placeComp(sim, id, 'enclume', 44, 44)
    expect(forgeOf(sim)?.enclosed).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('L’Atelier (tranche 3 — réutilise la reconnaissance)', () => {
  function atelierTier(sim: SimState): number | undefined {
    return recognizeFunctions(sim.structures).find((f) => f.functionId === 'atelier')?.tier
  }

  it('établi (= workshop) = Atelier N1 ; +tour méca (débloquée P2) → N2', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    placeComp(sim, id, 'workshop', 44, 44)
    expect(atelierTier(sim)).toBe(1)

    // La tour méca exige le palier 2 du Feu (R6) : on monte, puis on pose.
    const e = sim.entities.find((x) => x.id === id)!
    e.x = 41.5
    e.y = 40.5
    act(sim, id, { type: 'upgrade_fire' })
    expect(getVillageOf(sim, id)!.tier).toBe(2)
    placeComp(sim, id, 'tour_meca', 45, 44)
    expect(atelierTier(sim)).toBe(2)
  })

  it('l’Atelier porte SON bonus d’enceinte (vitesse) — même moteur clos+toité', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    const v = getVillageOf(sim, id)!.id
    // Un établi seul, muré + toité (layout monté via addStructure).
    addStructure(sim, 'workshop', 45, 45, v, id)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) addStructure(sim, 'roof', 45 + dx, 45 + dy, v, id)
    for (let d = -1; d <= 1; d++) {
      addStructure(sim, 'wall', 45 + d, 43, v, id)
      addStructure(sim, 'wall', 45 + d, 47, v, id)
      addStructure(sim, 'wall', 43, 45 + d, v, id)
      addStructure(sim, 'wall', 47, 45 + d, v, id)
    }
    expect(recognizeFunctions(sim.structures).find((f) => f.functionId === 'atelier')).toMatchObject({
      tier: 1,
      enclosed: true,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Le Grenier (tranche 4 — conteneur anti-pourriture)', () => {
  /** Des baies fraîches dans le conteneur d'une structure. */
  function stockBerries(sim: SimState, structureId: number): void {
    const s = sim.structures.find((x) => x.id === structureId)!
    s.inventory![0] = { item: 'berries', count: 5, fresh: 1 }
  }
  function freshOf(sim: SimState, structureId: number): number {
    return sim.structures.find((x) => x.id === structureId)!.inventory![0]!.fresh!
  }

  it('un aliment dans un silo (Grenier N1) pourrit PLUS LENTEMENT qu’au coffre', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    const v = getVillageOf(sim, id)!.id
    const silo = addStructure(sim, 'silo', 44, 44, v, id) // Grenier N1
    const chest = addStructure(sim, 'chest', 44, 48, v, id) // témoin, hors Grenier
    stockBerries(sim, silo.id)
    stockBerries(sim, chest.id)
    for (let t = 0; t < 10000; t++) advanceSpoilage(sim)
    expect(freshOf(sim, silo.id)).toBeGreaterThan(freshOf(sim, chest.id))
  })

  it('l’enceinte (conservation renforcée) préserve ENCORE mieux ; un plus haut palier aussi', () => {
    const openSim = makeSim()
    const oid = settler(openSim, 40, 40)
    foundVillage(openSim, oid, 41, 40)
    const ov = getVillageOf(openSim, oid)!.id
    const openSilo = addStructure(openSim, 'silo', 44, 44, ov, oid)
    stockBerries(openSim, openSilo.id)

    // Un Grenier clos+toité (même palier, layout monté via addStructure).
    const closSim = makeSim()
    const cid = settler(closSim, 40, 40)
    foundVillage(closSim, cid, 41, 40)
    const cv = getVillageOf(closSim, cid)!.id
    const closSilo = addStructure(closSim, 'silo', 45, 45, cv, cid)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) addStructure(closSim, 'roof', 45 + dx, 45 + dy, cv, cid)
    for (let d = -1; d <= 1; d++) {
      addStructure(closSim, 'wall', 45 + d, 43, cv, cid)
      addStructure(closSim, 'wall', 45 + d, 47, cv, cid)
      addStructure(closSim, 'wall', 43, 45 + d, cv, cid)
      addStructure(closSim, 'wall', 47, 45 + d, cv, cid)
    }
    expect(recognizeFunctions(closSim.structures).find((f) => f.functionId === 'grenier')?.enclosed).toBe(true)
    stockBerries(closSim, closSilo.id)

    for (let t = 0; t < 10000; t++) {
      advanceSpoilage(openSim)
      advanceSpoilage(closSim)
    }
    expect(freshOf(closSim, closSilo.id)).toBeGreaterThan(freshOf(openSim, openSilo.id))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('La Ferme (tranche 5 — plein air, sans enceinte)', () => {
  function fermeTier(sim: SimState): number | undefined {
    return recognizeFunctions(sim.structures).find((f) => f.functionId === 'ferme')?.tier
  }

  it('parcelle = Ferme N1 ; +serre (débloquée P2) → N2', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    placeComp(sim, id, 'parcelle', 44, 44)
    expect(fermeTier(sim)).toBe(1)
    const e = sim.entities.find((x) => x.id === id)!
    e.x = 41.5
    e.y = 40.5
    act(sim, id, { type: 'upgrade_fire' }) // P2 pour la serre
    placeComp(sim, id, 'serre', 45, 44)
    expect(fermeTier(sim)).toBe(2)
  })

  it('même MURÉE + TOITÉE, la Ferme reste PLEIN AIR — jamais de bonus d’enceinte', () => {
    const sim = makeSim()
    const id = settler(sim, 40, 40)
    foundVillage(sim, id, 41, 40)
    const v = getVillageOf(sim, id)!.id
    // Un layout parfaitement clos+toité — qui donnerait le bonus à toute AUTRE fonction.
    addStructure(sim, 'parcelle', 45, 45, v, id)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) addStructure(sim, 'roof', 45 + dx, 45 + dy, v, id)
    for (let d = -1; d <= 1; d++) {
      addStructure(sim, 'wall', 45 + d, 43, v, id)
      addStructure(sim, 'wall', 45 + d, 47, v, id)
      addStructure(sim, 'wall', 43, 45 + d, v, id)
      addStructure(sim, 'wall', 47, 45 + d, v, id)
    }
    // La Ferme est bien là, mais `enclosed` reste FAUX (enclosureBonus: null).
    expect(recognizeFunctions(sim.structures).find((f) => f.functionId === 'ferme')).toMatchObject({
      tier: 1,
      enclosed: false,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A9 — déterminisme du rejeu (poses/démolitions/paliers)', () => {
  it('fonder, bâtir, monter le Feu, améliorer, démolir : rejoue au bit près', () => {
    const options = { map: createEmptyMap(96, 96, TERRAIN_GRASS) }
    // Le setup EST rejoué par runReplay : spawn + dotation y vivent (grantItems est
    // une fonction d'hôte, hors de la boucle de tick).
    const setup = (state: SimState) => {
      const pid = spawnEntity(state, 40.5, 40.5)
      grantItems(state, pid, { campfire: 1, hammer: 1, wood: 80, stone: 40, cut_stone: 40, iron_ingot: 20 })
    }
    const sim = createSim(3, options)
    const log = createReplayLog(3, options)
    setup(sim)
    const id = 1
    const play = (action: PlayerAction): void => {
      recordAndStep(sim, log, [{ entityId: id, dx: 0, dy: 0, action }])
    }
    play({ type: 'set_active_slot', slot: 0 }) // le feu de camp (posé en case 0)
    play({ type: 'place_campfire', tx: 41, ty: 40 })
    const fire = structureAt(sim.structures, 41, 40)!
    play({ type: 'found_village', structureId: fire.id }) // à portée sans bouger
    play({ type: 'set_active_slot', slot: 1 }) // le marteau
    play({ type: 'build', structure: 'wall', tx: 42, ty: 40 })
    const wall = structureAt(sim.structures, 42, 40)!
    play({ type: 'upgrade_structure', structureId: wall.id }) // bois → pierre
    play({ type: 'upgrade_fire' }) // palier 2 (le Chef est à portée du Feu)
    play({ type: 'build', structure: 'door', tx: 40, ty: 41 })
    play({ type: 'demolish', structureId: wall.id })

    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(sim))
  })

  it('poser des composants et reconnaître une Forge N2 rejoue au bit près', () => {
    const options = { map: createEmptyMap(96, 96, TERRAIN_GRASS) }
    const setup = (state: SimState) => {
      const pid = spawnEntity(state, 40.5, 40.5)
      grantItems(state, pid, { enclume: 1, furnace: 1, campfire: 1 }) // en ceinture 0,1,2
    }
    const sim = createSim(5, options)
    const log = createReplayLog(5, options)
    setup(sim)
    const id = 1
    const play = (a: PlayerAction): void => {
      recordAndStep(sim, log, [{ entityId: id, dx: 0, dy: 0, action: a }])
    }
    play({ type: 'set_active_slot', slot: 2 }) // le feu de camp
    play({ type: 'place_campfire', tx: 41, ty: 40 })
    play({ type: 'found_village', structureId: structureAt(sim.structures, 41, 40)!.id })
    play({ type: 'set_active_slot', slot: 0 }) // l'enclume
    play({ type: 'place_component', tx: 44, ty: 40 })
    play({ type: 'set_active_slot', slot: 1 }) // le four
    play({ type: 'place_component', tx: 45, ty: 40 })
    // La Forge N2 est bien reconnue et dans l'état.
    expect(sim.functions.find((f) => f.functionId === 'forge')?.tier).toBe(2)

    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(sim))
  })
})
