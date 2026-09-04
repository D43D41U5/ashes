import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_ROCK, TICK_DT_S } from './balance'
import { isBlockedAt, makeIndexedIsBlockedAt, moveAvatar, moveAvatarStepped, overlapsBlocking } from './collision'
import { type ResourceNode } from './economy'
import { EDGE_E, EDGE_N, EDGE_O, EDGE_S } from './geometry'
import { createEmptyMap, type WorldMap } from './map'
import { rngRoll } from './rng'
import { createSim, spawnEntity, step, type MoveInput } from './sim'

const SPEED = BALANCE.WALK_SPEED_TILES_PER_S * TICK_DT_S
const HALF = BALANCE.AVATAR_HITBOX_TILES / 2
/** L'autre demi-mesure : le corps est un RECTANGLE (0,75 large × 0,375 profond). */
const HALF_Y = BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2

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
    // Le corps est un RECTANGLE : il bute à sa demi-LARGEUR en x, à sa demi-PROFONDEUR en y.
    expect(sim.entities[0]!.x).toBe(BALANCE.AVATAR_HITBOX_TILES / 2)
    expect(sim.entities[0]!.y).toBe(BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2)
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

  it('A4 — rock, iron_vein, coal_seam et bloc bloquent toujours leur tuile ENTIÈRE', () => {
    // `bloc` ajouté le 2026-08-27 (`roche-mere.md` R6ter — Alexis : « on leur donne un hitbox
    // pour éviter qu'on passe au travers, tu les mets sur une tuile complète »). Il n'était
    // gardé que par son `blockHalfSub: 4` en table ; ce que la table promet, le PAS le prouve.
    for (const type of ['rock', 'iron_vein', 'coal_seam', 'bloc'] as const) {
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

  it('COUCHES : un mur caché sous un sol posé AVANT lui reste bloquant pour l’A*', () => {
    // Régression (décision d'Alexis : sol/toit se superposent au solide). Le sol est
    // poussé AVANT le mur dans `structures` ; l'index ne doit pas retenir le sol (mou)
    // et masquer le mur — sinon PNJ et hordes traverseraient la paroi.
    const map = createEmptyMap(16, 16, TERRAIN_GRASS)
    const S = (id: number, type: 'floor' | 'wall', tx: number, ty: number) =>
      ({ id, type, tx, ty, villageId: 1, ownerId: 0, access: 'village' as const, hp: 100 })
    const world = {
      map,
      structures: [S(1, 'floor', 5, 5), S(2, 'wall', 5, 5)], // le sol EN PREMIER
      moverVillageId: null,
    }
    expect(isBlockedAt(world, 5, 5)).toBe(true) // via solidAt : le mur bloque
    expect(makeIndexedIsBlockedAt(world)(5, 5)).toBe(true) // l'index voit la MÊME chose
    // …et une tuile qui ne porte QU'un sol reste franchissable (le sol est mou).
    const soft = { map, structures: [S(3, 'floor', 6, 6)], moverVillageId: null }
    expect(isBlockedAt(soft, 6, 6)).toBe(false)
    expect(makeIndexedIsBlockedAt(soft)(6, 6)).toBe(false)
  })
})

describe('l’arbre est un mur : le verdict est binaire, jamais un tirage', () => {
  const SUB = BALANCE.SUBTILES_PER_TILE
  const H_TREE = NODE_DEFS.tree.blockHalfSub / SUB // demi-côté du tronc, en tuiles (0,375)
  const treeWorld = (trees: Array<[number, number]>, width = 16, height = 16): { map: WorldMap; nodes: ResourceNode[] } => ({
    map: createEmptyMap(width, height, TERRAIN_GRASS),
    nodes: trees.map(([tx, ty], i) => ({ id: i + 1, type: 'tree' as const, tx, ty, stock: 10, regrowAt: 0 })),
  })

  it('B1 — le carré bloquant est CENTRÉ dans sa tuile : les quatre arrêts sont symétriques', () => {
    // C'EST LA PRÉMISSE DE TOUT LE RESTE. Un carré décentré d'une seule sous-tuile rendrait le
    // verdict dépendant du côté par lequel on arrive — c'est-à-dire de nouveau illisible — et
    // rien d'autre ne l'attraperait : un `blockHalfSub` demi-entier le faisait sur un centre
    // entier (cf. sa doc), et c'est la raison pour laquelle 3 est le réglage et non 3,5.
    // On mesure sur la SORTIE du vrai déplaceur, aux QUATRE approches — pas sur la table.
    const TX = 8, TY = 4
    const world = treeWorld([[TX, TY]])
    const cx = TX + 0.5, cy = TY + 0.5
    const glisse = (x0: number, y0: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1): { x: number; y: number } => {
      let p = { x: x0, y: y0 }
      for (let t = 0; t < 120; t++) p = moveAvatar(world, p.x, p.y, dx, dy, TICK_DT_S)
      return p
    }
    const ouest = glisse(cx - 3, cy, 1, 0).x
    const est = glisse(cx + 3, cy, -1, 0).x
    const nord = glisse(cx, cy - 3, 0, 1).y
    const sud = glisse(cx, cy + 3, 0, -1).y
    // Chaque approche s'arrête à la face du carré, moins la demi-emprise DE CET AXE (le corps
    // est un rectangle : 0,75 de large, 0,375 de profond).
    expect(cx - ouest).toBeCloseTo(H_TREE + HALF, 9)
    expect(est - cx).toBeCloseTo(H_TREE + HALF, 9)
    expect(cy - nord).toBeCloseTo(H_TREE + HALF_Y, 9)
    expect(sud - cy).toBeCloseTo(H_TREE + HALF_Y, 9)
  })

  it('B2 — l’avatar bute sur le CENTRE de la tuile, plus sur un tronc décalé', () => {
    const TX = 8, TY = 4
    const world = treeWorld([[TX, TY]])
    // Face ouest du tronc centré, moins le demi-avatar. Tout est sur la grille des sous-tuiles
    // depuis que le décalage a quitté la collision : l'arrêt est EXACT, plus une borne.
    const expected = TX + 0.5 - H_TREE - HALF
    let p = { x: 5.5, y: TY + 0.5 }
    for (let t = 0; t < 60; t++) p = moveAvatar(world, p.x, p.y, 1, 0, TICK_DT_S)
    expect(p.x).toBeCloseTo(expected, 9)
    expect(p.y).toBe(TY + 0.5)
  })

  it('B3 — DEUX ARBRES VOISINS NE PASSENT JAMAIS, sur les deux axes, partout', () => {
    // La promesse du 2026-08-31, et elle ne souffre aucune exception : c'est de son caractère
    // ABSOLU que vient la lisibilité. Un seul couple franchissable et le joueur redevient
    // obligé de juger au cas par cas. On balaie donc des paires à des coordonnées variées —
    // le décalage a beau avoir quitté la collision, un futur retour se verrait ici.
    for (let ty = 3; ty < 9; ty++) {
      for (let tx = 3; tx < 9; tx++) {
        // EST-OUEST : on descend dans le couloir vertical entre les deux troncs.
        const eo = treeWorld([[tx, ty], [tx + 1, ty]], tx + 4, ty + 4)
        let p = { x: tx + 1, y: ty - 1.5 }
        for (let t = 0; t < 120; t++) p = moveAvatar(eo, p.x, p.y, 0, 1, TICK_DT_S)
        expect(p.y, `paire E-O en (${tx},${ty}) franchie`).toBeLessThan(ty + 1)
        // NORD-SUD : on traverse d'ouest en est le couloir horizontal. C'est l'axe qui passait
        // encore 82,7 % du temps avant le 2026-08-31 — sa mort est la contrepartie assumée.
        const ns = treeWorld([[tx, ty], [tx, ty + 1]], tx + 4, ty + 4)
        let q = { x: tx - 1.5, y: ty + 1 }
        for (let t = 0; t < 120; t++) q = moveAvatar(ns, q.x, q.y, 1, 0, TICK_DT_S)
        expect(q.x, `paire N-S en (${tx},${ty}) franchie`).toBeLessThan(tx + 1)
      }
    }
  })

  it('B4 — une TUILE LIBRE entre deux arbres passe TOUJOURS, sur les deux axes', () => {
    // L'autre moitié du verdict binaire, et sans elle B3 serait tenu par une forêt murée : le
    // couloir vaut `2 − 2h = 1,25` tuile, donc il passe pour un corps de 0,75 comme de 0,375.
    for (let ty = 3; ty < 9; ty++) {
      for (let tx = 3; tx < 9; tx++) {
        const eo = treeWorld([[tx, ty], [tx + 2, ty]], tx + 5, ty + 4)
        let p = { x: tx + 1.5, y: ty - 1.5 }
        for (let t = 0; t < 120; t++) p = moveAvatar(eo, p.x, p.y, 0, 1, TICK_DT_S)
        expect(p.y, `couloir E-O en (${tx},${ty}) fermé`).toBeGreaterThan(ty + 1)
        const ns = treeWorld([[tx, ty], [tx, ty + 2]], tx + 4, ty + 5)
        let q = { x: tx - 1.5, y: ty + 1.5 }
        for (let t = 0; t < 120; t++) q = moveAvatar(ns, q.x, q.y, 1, 0, TICK_DT_S)
        expect(q.x, `couloir N-S en (${tx},${ty}) fermé`).toBeGreaterThan(tx + 1)
      }
    }
  })

  it('B5 — contrat SOUS-TUILE : overlapsBlocking répond sur le tronc centré', () => {
    const TX = 8, TY = 4
    const world = treeWorld([[TX, TY]])
    expect(overlapsBlocking(world, TX + 0.5, TY + 0.5)).toBe(true) // le centre bloque
    expect(overlapsBlocking(world, TX + 0.5, TY - 2)).toBe(false) // deux tuiles au nord : rien
  })

  it('B6 — LE VERDICT EST BINAIRE : 0 % de paires voisines franchissables, 100 % à une tuile', () => {
    // Ce qui remplace les 31,5 % / 82,7 % que `SUBTILES_PER_TILE` citait : le nombre à tenir
    // n'est plus une part, c'est son ABSENCE de dispersion. Géométrie pure sur 600 × 600
    // couples — si un jour un décalage revenait dans la collision, ces deux constantes
    // cesseraient d'être des constantes, et c'est exactement ce qu'on veut apprendre ici.
    const LARGEUR = BALANCE.AVATAR_HITBOX_TILES // est-ouest
    const PROFONDEUR = BALANCE.AVATAR_HITBOX_DEPTH_TILES // nord-sud (le corps est un rectangle)
    const ecartVoisin = 1 - 2 * H_TREE // 0,25
    const ecartUneTuile = 2 - 2 * H_TREE // 1,25
    expect(ecartVoisin).toBeLessThan(PROFONDEUR) // donc a fortiori sous LARGEUR
    expect(ecartUneTuile).toBeGreaterThanOrEqual(LARGEUR) // donc a fortiori au-dessus de PROFONDEUR
    // Et la propriété qui compte vraiment : la forêt reste TRAVERSABLE. Mesuré sur le monde
    // joué au moment du changement — 22 % des tuiles boisées portent un arbre, donc 77,4 %
    // restent libres et la composante connexe géante de la carte ne bouge pas (99,38 → 99,37 %).
    // Ici on ne peut affirmer que la géométrie ; la densité, elle, vit dans `zone-content`.
    expect(NODE_DEFS.tree.blockHalfSub).toBeLessThan(SUB / 2) // l'arbre ne mure PAS sa tuile
    expect(Number.isInteger(NODE_DEFS.tree.blockHalfSub)).toBe(true) // centre entier ⇒ h entier
    expect(NODE_DEFS.old_tree.blockHalfSub).toBe(NODE_DEFS.tree.blockHalfSub) // même règle pour tous
  })
})

describe('deux structures sur une tuile : ce qui bloque seul bloque aussi accompagné', () => {
  // ═══ POURQUOI UNE GARDE EXHAUSTIVE, ET PAS TROIS CAS CHOISIS ═══
  //
  // `bloquantAt` rendait LA PREMIÈRE structure bloquante de la tuile, et le pas ne testait
  // que celle-là. Une arête posée d'abord (le cas NOMINAL : on adosse son four à son propre
  // mur, `village.ts` l'encourage) masquait donc entièrement la pièce pleine derrière elle —
  // on traversait la tuile de part en part, on pouvait se tenir DANS le coffre.
  //
  // C'est le bug du 2026-07-27 (« le premier solide masque le mur ») revenu d'un cran plus
  // bas : `bloquantAt` avait appris à ne plus dire « le solide », pas encore à chercher ce
  // qui bloque CETTE SOUS-TUILE.
  //
  // Un cas choisi n'aurait rien prouvé : le défaut dépend de l'ORDRE de pose et de la
  // géométrie de chaque pièce. On balaie donc tout l'espace — toutes les paires ordonnées de
  // formes bloquantes sur la même tuile, toutes les positions au pas de la sous-tuile — et on
  // affirme UNE SEULE propriété : poser une seconde structure n'en efface jamais une première.
  const FORMES = [
    { nom: 'wall plein', type: 'wall' as const, edges: undefined },
    { nom: 'chest', type: 'chest' as const, edges: undefined },
    { nom: 'furnace', type: 'furnace' as const, edges: undefined },
    { nom: 'wall N', type: 'wall' as const, edges: EDGE_N },
    { nom: 'wall E', type: 'wall' as const, edges: EDGE_E },
    { nom: 'wall S', type: 'wall' as const, edges: EDGE_S },
    { nom: 'wall O', type: 'wall' as const, edges: EDGE_O },
    { nom: 'palissade N', type: 'palissade' as const, edges: EDGE_N },
    { nom: 'palissade E', type: 'palissade' as const, edges: EDGE_E },
  ]
  const TX = 5
  const TY = 5
  const bati = (id: number, f: (typeof FORMES)[number]) => ({
    id, type: f.type, tx: TX, ty: TY, villageId: 1, ownerId: 0, access: 'village' as const, hp: 100,
    ...(f.edges === undefined ? {} : { edges: f.edges }),
  })

  it('A7 — aucune paire ordonnée ne perd un bloqueur, sur aucune sous-tuile', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    const PAS = 1 / BALANCE.SUBTILES_PER_TILE
    const perdus: string[] = []
    for (const a of FORMES) {
      for (const b of FORMES) {
        const seulA = { map, structures: [bati(1, a)], moverVillageId: null }
        const seulB = { map, structures: [bati(2, b)], moverVillageId: null }
        const paire = { map, structures: [bati(1, a), bati(2, b)], moverVillageId: null }
        for (let x = TX - 1; x < TX + 2; x += PAS) {
          for (let y = TY - 1; y < TY + 2; y += PAS) {
            const attendu = overlapsBlocking(seulA, x, y) || overlapsBlocking(seulB, x, y)
            if (overlapsBlocking(paire, x, y) !== attendu) {
              perdus.push(`${a.nom} puis ${b.nom} @ ${x.toFixed(3)},${y.toFixed(3)}`)
            }
          }
        }
      }
    }
    expect(perdus.slice(0, 5)).toEqual([])
    expect(perdus).toHaveLength(0)
  })

  it('A7bis — la garde VOIT le défaut : sans les deux structures, elle ne prouve rien', () => {
    // Une garde qui passerait sur un monde vide ne garderait rien. On affirme donc d'abord
    // que le monde de la garde bloque VRAIMENT quelque chose (règle : une garde prouve sa prémisse).
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    const arete = { map, structures: [bati(1, FORMES[3]!)], moverVillageId: null } // wall N
    const plein = { map, structures: [bati(2, FORMES[1]!)], moverVillageId: null } // chest
    expect(overlapsBlocking(arete, TX + 0.5, TY + 0.05)).toBe(true) // la bande nord mord
    expect(overlapsBlocking(arete, TX + 0.5, TY + 0.5)).toBe(false) // le centre reste libre
    expect(overlapsBlocking(plein, TX + 0.5, TY + 0.5)).toBe(true) // le coffre prend sa tuile
  })
})

describe('les deux autorités de la tuile s’accordent', () => {
  // `isBlockedAt` (direct) et `makeIndexedIsBlockedAt` (l'index du pathfinding et des champs
  // de flux) répondent à LA MÊME question. Elles divergeaient sur deux points, et chacun
  // faisait fuir la faune d'une salle praticable ou traverser une paroi :
  //   ① l'index n'excluait pas les murs d'ARÊTE, que la version directe écarte délibérément ;
  //   ② l'index ne gardait qu'UNE structure par tuile, donc une porte que le marcheur ouvre
  //      masquait la pièce pleine posée derrière elle.
  // On n'affirme donc pas des cas : on affirme l'ACCORD, sur tout l'espace des formes.
  const FORMES = [
    { nom: 'wall plein', type: 'wall' as const, edges: undefined },
    { nom: 'chest', type: 'chest' as const, edges: undefined },
    { nom: 'door', type: 'door' as const, edges: undefined },
    { nom: 'wall N', type: 'wall' as const, edges: EDGE_N },
    { nom: 'palissade E', type: 'palissade' as const, edges: EDGE_E },
    { nom: 'floor (mou)', type: 'floor' as const, edges: undefined },
  ]
  const bati = (id: number, f: (typeof FORMES)[number], vid: number) => ({
    id, type: f.type, tx: 5, ty: 5, villageId: vid, ownerId: 0, access: 'village' as const, hp: 100,
    ...(f.edges === undefined ? {} : { edges: f.edges }),
  })

  it('A8 — sur toute paire de formes et tout marcheur, l’index dit la MÊME chose que le direct', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    const MARCHEURS = [
      { nom: 'étranger', moverVillageId: null, opensDoors: false },
      { nom: 'villageois', moverVillageId: 1, opensDoors: true },
      { nom: 'rival', moverVillageId: 2, opensDoors: true },
    ]
    const desaccords: string[] = []
    for (const a of FORMES) {
      for (const b of FORMES) {
        for (const m of MARCHEURS) {
          const world = { map, structures: [bati(1, a, 1), bati(2, b, 1)], ...m }
          const direct = isBlockedAt(world, 5, 5)
          const indexe = makeIndexedIsBlockedAt(world)(5, 5)
          if (direct !== indexe) desaccords.push(`${a.nom} + ${b.nom} / ${m.nom} : direct=${direct} index=${indexe}`)
        }
      }
    }
    expect(desaccords.slice(0, 5)).toEqual([])
    expect(desaccords).toHaveLength(0)
  })

  it('A8bis — la garde voit ce qu’elle garde : les deux formes changent bien la réponse', () => {
    const map = createEmptyMap(12, 12, TERRAIN_GRASS)
    const nu = { map, structures: [], moverVillageId: null }
    const plein = { map, structures: [bati(1, FORMES[0]!, 1)], moverVillageId: null }
    const arete = { map, structures: [bati(2, FORMES[3]!, 1)], moverVillageId: null }
    expect(isBlockedAt(nu, 5, 5)).toBe(false)
    expect(isBlockedAt(plein, 5, 5)).toBe(true) // une pleine tuile bloque SA tuile
    expect(isBlockedAt(arete, 5, 5)).toBe(false) // un mur mince, NON — c'est le contrat
  })
})
