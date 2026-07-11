import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_ROCK, TICK_DT_S } from './balance'
import { isBlockedAt, makeIndexedIsBlockedAt, moveAvatar, moveAvatarStepped, overlapsBlocking } from './collision'
import { treeJitter, type ResourceNode } from './economy'
import { createEmptyMap, type WorldMap } from './map'
import { rngRoll } from './rng'
import { createSim, spawnEntity, step, type MoveInput } from './sim'

const SPEED = BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2

function setTile(map: WorldMap, tx: number, ty: number, id: number): void {
  map.terrain[ty * map.width + tx] = id
}

describe('collisions (A3)', () => {
  it('clampe flush contre un mur et ne le traverse pas', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    for (let ty = 0; ty < 12; ty++) setTile(map, 6, ty, TERRAIN_ROCK)
    const sim = createSim(1, { map })
    const id = spawnEntity(sim, 4.5, 4.5)
    for (let t = 0; t < 30; t++) step(sim, [{ entityId: id, dx: 1, dy: 0 }])
    expect(sim.entities[0]!.x).toBe(6 - HALF)
    expect(sim.entities[0]!.y).toBe(4.5)
  })

  it('glisse le long du mur en déplacement diagonal', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    for (let ty = 0; ty < 12; ty++) setTile(map, 6, ty, TERRAIN_ROCK)
    const sim = createSim(1, { map })
    const id = spawnEntity(sim, 6 - HALF, 4.5)
    step(sim, [{ entityId: id, dx: 1, dy: 1 }])
    const e = sim.entities[0]!
    expect(e.x).toBe(6 - HALF)
    expect(e.y).toBeCloseTo(4.5 + SPEED * Math.SQRT1_2)
  })

  it('ne sort jamais de la carte (le hors-carte bloque)', () => {
    const sim = createSim(1, { map: createEmptyMap(8, 8, TERRAIN_GRASS) })
    const id = spawnEntity(sim, 1, 1)
    for (let t = 0; t < 100; t++) step(sim, [{ entityId: id, dx: -1, dy: -1 }])
    expect(sim.entities[0]!.x).toBe(HALF)
    expect(sim.entities[0]!.y).toBe(HALF)
  })

  it('le terrain module la vitesse (route plus rapide que l’herbe)', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    for (let tx = 0; tx < 12; tx++) setTile(map, tx, 2, TERRAIN_ROAD)
    const sim = createSim(1, { map })
    const onRoad = spawnEntity(sim, 2.5, 2.5)
    const onGrass = spawnEntity(sim, 2.5, 6.5)
    step(sim, [
      { entityId: onRoad, dx: 1, dy: 0 },
      { entityId: onGrass, dx: 1, dy: 0 },
    ])
    expect(sim.entities[0]!.x).toBeCloseTo(2.5 + SPEED * 1.25)
    expect(sim.entities[1]!.x).toBeCloseTo(2.5 + SPEED)
  })

  /**
   * Parité prédiction/autorité près d'un mur (le rollback de coin).
   *
   * Le serveur intègre à pas fixe (`TICK_DT_S`), un `moveAvatar` par tick. Le
   * client prédit au pas de la frame — un dt variable, gros lors d'un pic. Or
   * la résolution par axe n'est PAS invariante à la taille du pas : contre la
   * fin d'un mur, un gros pas résout X une fois (avec l'ancien span Y, encore
   * bloqué) et reste collé, là où des petits pas contournent le bout du mur.
   * L'écart se fait clamper en une tuile discrète → rollback visible au snapshot
   * suivant. `moveAvatarStepped` redécoupe la frame en sous-pas de `TICK_DT_S`,
   * rejouant exactement la suite de dt du serveur.
   */
  describe('sous-pas à pas fixe (parité prédiction/autorité)', () => {
    // Mur vertical col 8, rangées 0..8 : il se termine, on le contourne par le bas.
    const wallMap = (): WorldMap => {
      const map = createEmptyMap(16, 16, TERRAIN_GRASS)
      for (let ty = 0; ty <= 8; ty++) setTile(map, 8, ty, TERRAIN_ROCK)
      return map
    }
    const START = { x: 8 - HALF, y: 4.5 }
    const TICKS = 40

    // Vérité autoritative : un moveAvatar par tick, dt fixe (comme `step`).
    const serverPath = (world: { map: WorldMap }): { x: number; y: number } => {
      let p = { x: START.x, y: START.y }
      for (let t = 0; t < TICKS; t++) p = moveAvatar(world, p.x, p.y, 1, 1, TICK_DT_S)
      return p
    }

    it('un gros pas unique diverge du serveur près du bout de mur (le bug)', () => {
      const world = { map: wallMap() }
      const server = serverPath(world)
      // Ce que fait le client actuel sur une grosse frame (pic de lag) : un seul pas.
      const bigStep = moveAvatar(world, START.x, START.y, 1, 1, TICKS * TICK_DT_S)
      expect(bigStep).not.toEqual(server)
    })

    it('une grosse frame redécoupée en sous-pas reproduit le serveur au bit près', () => {
      const world = { map: wallMap() }
      const server = serverPath(world)
      const stepped = moveAvatarStepped(world, START.x, START.y, 1, 1, TICKS * TICK_DT_S, 0)
      expect({ x: stepped.x, y: stepped.y }).toEqual(server)
    })

    it('le découpage en demi-ticks donne le même résultat (invariance au pas de frame)', () => {
      const world = { map: wallMap() }
      const server = serverPath(world)
      let p = { x: START.x, y: START.y, pendingS: 0 }
      // 2 frames par tick → même nombre de sous-pas, mais frontières décalées.
      for (let f = 0; f < TICKS * 2; f++) {
        p = moveAvatarStepped(world, p.x, p.y, 1, 1, TICK_DT_S / 2, p.pendingS)
      }
      expect({ x: p.x, y: p.y }).toEqual(server)
      expect(p.pendingS).toBeCloseTo(0)
    })

    // Rendu par extrapolation : l'ancre (x, y) reste calée sur le tick (parité
    // autorité), mais la position affichée mène de la fraction de tick restante
    // → mouvement fluide chaque frame, sans latence ajoutée (on devance, on ne
    // retarde pas). Résolue par collision, donc jamais dans un mur.
    it('la position de rendu extrapole le reliquat en terrain libre (fluidité, sans latence)', () => {
      const world = { map: createEmptyMap(16, 16, TERRAIN_GRASS) }
      const x0 = 2.5
      // 1,5 tick de frame → 1 sous-pas entier, reliquat d'un demi-tick.
      const s = moveAvatarStepped(world, x0, 4.5, 1, 0, TICK_DT_S * 1.5, 0)
      expect(s.x).toBe(x0 + SPEED) // ancre : un sous-pas entier, calée sur le tick
      expect(s.pendingS).toBeCloseTo(TICK_DT_S / 2)
      expect(s.renderX).toBeCloseTo(x0 + SPEED * 1.5) // rendu : position continue lissée
      expect(s.renderY).toBe(4.5)
    })

    it('à la frontière de tick, le rendu coïncide avec l’ancre (pas de reliquat)', () => {
      const world = { map: createEmptyMap(16, 16, TERRAIN_GRASS) }
      const s = moveAvatarStepped(world, 2.5, 4.5, 1, 0, TICK_DT_S, 0)
      expect(s.renderX).toBe(s.x)
      expect(s.renderY).toBe(s.y)
    })

    it('le rendu extrapolé se clampe sur le mur, jamais dans un obstacle', () => {
      const world = { map: wallMap() }
      // Ancre flush contre le mur, avec un reliquat qui pousserait « dans » le mur.
      const s = moveAvatarStepped(world, 8 - HALF, 4.5, 1, 0, TICK_DT_S / 2, TICK_DT_S / 2)
      expect(overlapsBlocking(world, s.renderX, s.renderY)).toBe(false)
      expect(s.renderX).toBeLessThanOrEqual(8 - HALF)
    })
  })

  it('marche aléatoire de 10 000 ticks dans un labyrinthe : jamais dans un mur', () => {
    const map = createEmptyMap(24, 24, TERRAIN_GRASS)
    for (let ty = 0; ty < 24; ty++) {
      for (let tx = 0; tx < 24; tx++) {
        const clearStart = tx < 4 && ty < 4
        if (!clearStart && (tx * 7 + ty * 13) % 5 === 0) setTile(map, tx, ty, TERRAIN_ROCK)
      }
    }
    const sim = createSim(42, { map })
    const id = spawnEntity(sim, 1.5, 1.5)
    let rng = 42
    const dir = (v: number): -1 | 0 | 1 => (Math.floor(v * 3) - 1) as -1 | 0 | 1
    for (let t = 0; t < 10_000; t++) {
      const a = rngRoll(rng)
      const b = rngRoll(a.next)
      rng = b.next
      const input: MoveInput = { entityId: id, dx: dir(a.value), dy: dir(b.value) }
      step(sim, [input])
      const e = sim.entities[0]!
      if (overlapsBlocking({ map: sim.map }, e.x, e.y)) {
        throw new Error(`entité dans un mur au tick ${t} : (${e.x}, ${e.y})`)
      }
    }
  })
})

describe('cœur sous-tuile (préparation des arbres hauts)', () => {
  it('un clamp contre un nœud pleine tuile est EXACT, pas approché (bit à bit)', () => {
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'rock', tx: 8, ty: 4, stock: 12, regrowAt: 0 }]
    const world = { map, nodes }
    // Marche vers l'est jusqu'au contact, puis un pas de plus : clamp flush.
    let p = { x: 5.5, y: 4.5 }
    for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBe(8 - HALF) // `toBe`, pas `toBeCloseTo` : l'égalité est exacte
    expect(p.y).toBe(4.5)
  })

  it('le clamp par l’ouest est exact lui aussi', () => {
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'rock', tx: 4, ty: 4, stock: 12, regrowAt: 0 }]
    const world = { map, nodes }
    let p = { x: 7.5, y: 4.5 }
    for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, -1, 0, TICK_DT_S)
    expect(p.x).toBe(5 + HALF) // bord droit de la tuile 4, plus le demi-avatar
  })

  it('un nœud épuisé (stock 0) ne bloque pas', () => {
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const nodes: ResourceNode[] = [{ id: 1, type: 'rock', tx: 8, ty: 4, stock: 0, regrowAt: 100 }]
    const world = { map, nodes }
    let p = { x: 7.5, y: 4.5 }
    for (let t = 0; t < 20; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeGreaterThan(8.5) // il l'a traversé
  })
})

describe('arbres hauts : la collision se limite au tronc', () => {
  const forest = (trees: Array<[number, number]>): { map: WorldMap; nodes: ResourceNode[] } => ({
    map: createEmptyMap(16, 16, TERRAIN_GRASS),
    nodes: trees.map(([tx, ty], i) => ({ id: i + 1, type: 'tree' as const, tx, ty, stock: 10, regrowAt: 0 })),
  })

  it('A4 — rock, iron_vein et coal_seam bloquent toujours leur tuile ENTIÈRE', () => {
    for (const type of ['rock', 'iron_vein', 'coal_seam'] as const) {
      const world = {
        map: createEmptyMap(16, 16, TERRAIN_GRASS),
        nodes: [{ id: 1, type, tx: 8, ty: 4, stock: 8, regrowAt: 0 }],
      }
      let p = { x: 5.5, y: 4.5 }
      for (let t = 0; t < 40; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
      expect(p.x).toBe(8 - HALF)
    }
  })

  it('A5 — un arbre à stock 0 ne bloque plus rien', () => {
    const world = {
      map: createEmptyMap(16, 16, TERRAIN_GRASS),
      nodes: [{ id: 1, type: 'tree' as const, tx: 8, ty: 4, stock: 0, regrowAt: 200 }],
    }
    let p = { x: 7.5, y: 4.5 }
    for (let t = 0; t < 20; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeGreaterThan(8.5)
  })

  it('A6 — contrat TUILE : isBlockedAt reste true sur une tuile portant un arbre vivant', () => {
    const world = forest([[8, 4]])
    expect(isBlockedAt(world, 8, 4)).toBe(true) // le pathfinding contourne toujours
    expect(isBlockedAt(world, 7, 4)).toBe(false)
    const indexed = makeIndexedIsBlockedAt(world)
    expect(indexed(8, 4)).toBe(true) // A* et flow fields voient la même chose
  })
})

describe('décalage d’origine des arbres : la collision suit le tronc', () => {
  const SUB = BALANCE.SUBTILES_PER_TILE
  const J = BALANCE.TREE_JITTER_TILES
  const H_TREE = NODE_DEFS.tree.blockHalfSub / SUB // demi-côté du tronc, en tuiles (0,125)
  const treeWorld = (trees: Array<[number, number]>, width = 16): { map: WorldMap; nodes: ResourceNode[] } => ({
    map: createEmptyMap(width, 16, TERRAIN_GRASS),
    nodes: trees.map(([tx, ty], i) => ({ id: i + 1, type: 'tree' as const, tx, ty, stock: 10, regrowAt: 0 })),
  })
  /** Le couloir vertical (tuiles) entre les arbres (tx,ty) et (tx+1,ty). */
  const corridor = (tx: number, ty: number): number =>
    0.75 + treeJitter(tx + 1, ty).dx - treeJitter(tx, ty).dx
  /** Centre X du couloir, face droite du tronc gauche → face gauche du tronc droit. */
  const corridorCenter = (tx: number, ty: number): number => {
    const left = tx + 0.5 + treeJitter(tx, ty).dx + H_TREE
    const right = tx + 1.5 + treeJitter(tx + 1, ty).dx - H_TREE
    return (left + right) / 2
  }

  it('B1 — borne de non-débordement : le carré d’un arbre décalé reste dans sa tuile', () => {
    // Garde-fou contre un futur recalibrage de J OU de blockHalfSub : la borne DOIT tenir.
    expect(J + H_TREE).toBeLessThanOrEqual(0.5)
    // Et concrètement, sur un échantillon : les bords du carré ∈ [tx,tx+1[ × [ty,ty+1[.
    for (let ty = 0; ty < 30; ty++) {
      for (let tx = 0; tx < 30; tx++) {
        const { dx, dy } = treeJitter(tx, ty)
        const cx = tx + 0.5 + dx
        const cy = ty + 0.5 + dy
        expect(cx - H_TREE).toBeGreaterThanOrEqual(tx)
        expect(cx + H_TREE).toBeLessThanOrEqual(tx + 1)
        expect(cy - H_TREE).toBeGreaterThanOrEqual(ty)
        expect(cy + H_TREE).toBeLessThanOrEqual(ty + 1)
      }
    }
  })

  it('B2 — un avatar bute sur le tronc DÉCALÉ, pas sur le centre de la tuile', () => {
    const TX = 8, TY = 4
    const { dx } = treeJitter(TX, TY)
    const world = treeWorld([[TX, TY]])
    const expected = TX + 0.5 + dx - H_TREE - HALF // face gauche du tronc décalé − demi-avatar
    let p = { x: 5.5, y: TY + 0.5 }
    for (let t = 0; t < 60; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    // Le cœur de collision ne repose l'avatar que sur la grille de sous-tuiles
    // (pas = 1/SUB) ; le jitter est continu, donc `expected` (calcul continu)
    // n'est en général pas un point de grille. Le clamp réel est le premier
    // point de grille À L'EST de `expected` (ceil), donc p.x ∈ [expected,
    // expected + 1/SUB) — jamais avant (jamais dans le tronc), au plus 1
    // sous-tuile plus loin. Borne prouvée, pas un artefact de cette seed.
    expect(p.x).toBeGreaterThanOrEqual(expected - 1e-9)
    expect(p.x).toBeLessThan(expected + 1 / SUB)
    expect(p.y).toBe(TY + 0.5)
  })

  it('B3 — le fourré est réel : une paire pincée bloque un avatar de 0,6 qui descend à travers', () => {
    const TY = 4
    let best = { tx: -1, gap: Infinity }
    for (let tx = 0; tx < 400; tx++) {
      const g = corridor(tx, TY)
      if (g < best.gap) best = { tx, gap: g }
    }
    // Au J calibré, des fourrés existent forcément (sinon le choix « franc » serait vide).
    expect(best.gap).toBeLessThan(BALANCE.AVATAR_HITBOX_TILES)
    const world = treeWorld([[best.tx, TY], [best.tx + 1, TY]], best.tx + 3)
    let p = { x: corridorCenter(best.tx, TY), y: TY - 1.5 }
    for (let t = 0; t < 120; t++) p = moveAvatar(world, p.x, p.y, 0, 1, TICK_DT_S)
    // Les troncs sont AUSSI décalés en Y (dy) : la bande bloquante d'un arbre
    // peut se situer n'importe où dans [ty, ty+1), pas forcément au bord nord
    // de la tuile. L'avatar peut donc entamer la rangée avant de buter — mais
    // il ne la franchit jamais (gap < 0,6 sur toute la traversée en X). Le fourré
    // bloque : « ne franchit pas », pas « s'arrête avant le bord nord ».
    expect(p.y).toBeLessThan(TY + 1)
  })

  it('B4 — au couloir large, l’avatar (0,6) se faufile entre deux arbres voisins', () => {
    const TY = 4
    let best = { tx: -1, gap: -Infinity }
    for (let tx = 0; tx < 400; tx++) {
      const g = corridor(tx, TY)
      if (g > best.gap) best = { tx, gap: g }
    }
    expect(best.gap).toBeGreaterThan(BALANCE.AVATAR_HITBOX_TILES) // des passages existent
    const world = treeWorld([[best.tx, TY], [best.tx + 1, TY]], best.tx + 3)
    let p = { x: corridorCenter(best.tx, TY), y: TY - 1.5 }
    for (let t = 0; t < 60; t++) p = moveAvatar(world, p.x, p.y, 0, 1, TICK_DT_S)
    expect(p.y).toBeGreaterThan(TY + 1) // passé au sud de la rangée
  })

  it('B5 — contrat SOUS-TUILE : overlapsBlocking suit le tronc décalé', () => {
    const TX = 8, TY = 4
    const { dx, dy } = treeJitter(TX, TY)
    const world = treeWorld([[TX, TY]])
    expect(overlapsBlocking(world, TX + 0.5 + dx, TY + 0.5 + dy)).toBe(true) // sur le tronc décalé
    expect(overlapsBlocking(world, TX + 0.5, TY - 2)).toBe(false) // deux tuiles au nord : rien
  })
})
