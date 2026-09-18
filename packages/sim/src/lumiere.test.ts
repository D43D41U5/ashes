import { describe, expect, it } from 'vitest'
import { FIRE, LUMIERE, NUIT, SLOTS, TEMPERATURE, TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { EDGE_E, EDGE_N, EDGE_O, EDGE_S } from './geometry'
import { addItems, makeInventory } from './items'
import { MOTIF_SOURCE, OCCLUDEUR, lumiereDesTorches, occlusionAuGrain, partVisible, sorteAuTexel } from './lumiere'
import { createEmptyMap } from './map'
import type { Npc } from './npc'
import { clarteSurSoi, lumiereDuFeu, LUNAISON_JOURS, LUNE_PLEINE_JOUR } from './nuit'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import { fireBubble } from './temperature'
import { torcheVive } from './torche'
import { cycleOffsetForStartHour, jourDeSaison } from './time'
import { addStructure, type Structure } from './village'

/**
 * LA SIM APPREND L'OMBRE (spec `lumiere-globale.md`, « La sim apprend l'ombre » : LG-R11, LG-R12,
 * LG-R17, LG-R18 ; critères LG-A18, LG-A19).
 *
 * Ce que ce fichier garde vraiment : que la lumière d'un feu S'ARRÊTE à un mur, à un fût, à une
 * roche — et que la CHALEUR, elle, n'y change pas au bit près ; que la table du motif est bien la
 * spirale qu'elle remplace (`cos`/`sin` interdits ici, jusque dans les tests) ; que le centre de
 * la bulle est celui de la tuile ; et que la torche d'un autre avatar compte, celle d'un PNJ non.
 * Aucune de ces choses ne casserait un autre test du dépôt.
 */
const NOUVELLE_LUNE_JOUR = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2

function makeSim(jourDeDepart = LUNE_PLEINE_JOUR): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart })
}
/** Minuit, au fond de la nouvelle lune : le ciel ne donne rien, seules les flammes comptent. */
function nuitNoire(): SimState {
  const sim = makeSim(Math.floor(NOUVELLE_LUNE_JOUR))
  sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim))
  return sim
}
const ent = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!

/** Un feu LIBRE et allumé sur la tuile (tx, ty) — son centre est en (tx + ½, ty + ½). */
function feu(sim: SimState, tx: number, ty: number): Structure {
  const s = addStructure(sim, 'fire', tx, ty, 0, 0)
  s.fuel = makeInventory(FIRE.FUEL_SLOTS)
  addItems(s.fuel, { wood: 3 })
  s.burnAt = sim.tick
  s.burnSlot = 0
  return s
}
/** Un mur MINCE sur une arête de la tuile (tx, ty) : une bande à cheval sur la ligne. */
function mur(sim: SimState, tx: number, ty: number, edges: number, etage?: number): Structure {
  return addStructure(sim, 'wall', tx, ty, 0, 0, undefined, undefined, edges, etage)
}
function avatar(sim: SimState, x: number, y: number): Entity {
  const e = ent(sim, spawnEntity(sim, x, y))
  e.inventory = makeInventory(SLOTS.PLAYER)
  return e
}
function torcheEnMain(e: Entity): void {
  e.inventory[0] = { item: 'torche_vive', count: 1, wear: 0 }
  e.activeSlot = 0
}

// Le feu de tous les montages : la tuile (50, 48), centre (50,5 ; 48,5). Le corps témoin en
// (48,5 ; 48,5) — à DEUX tuiles pile, dans l'axe.
const FX = 50
const FY = 48
const CX = FX + 0.5
const CY = FY + 0.5
const RX = 48.5
const RY = 48.5
const N = 0 // le niveau du sol, sur une carte sans terrasses

describe('le motif de la source étendue (LG-R4, LG-R12)', () => {
  it('M1 — seize points, une spirale de Vogel : rayons √((i + ½)/16), et l’angle d’or entre voisins', () => {
    expect(MOTIF_SOURCE).toHaveLength(16)
    // cos et sin de l'angle d'or π(3 − √5), recopiés en littéraux : `Math.cos` est interdit ici.
    const COS_OR = -0.737368878
    const SIN_OR = 0.675490294
    for (let i = 0; i < MOTIF_SOURCE.length; i++) {
      const [x, y] = MOTIF_SOURCE[i]!
      const r = Math.sqrt(x * x + y * y)
      expect(Math.abs(r - Math.sqrt((i + 0.5) / 16))).toBeLessThan(2e-7)
      expect(r).toBeLessThanOrEqual(1)
      if (i === 0) continue
      const [px, py] = MOTIF_SOURCE[i - 1]!
      const rp = Math.sqrt(px * px + py * py)
      // p_{i-1} · p_i = r r' cos(or) ; p_{i-1} × p_i = r r' sin(or) : la rotation d'un point au suivant.
      expect(Math.abs((px * x + py * y) / (r * rp) - COS_OR)).toBeLessThan(2e-6)
      expect(Math.abs((px * y - py * x) / (r * rp) - SIN_OR)).toBeLessThan(2e-6)
    }
  })
})

describe('la part visible — la traversée au texel (LG-R10, LG-R11, LG-R12)', () => {
  it('V1 — en champ libre, la source est vue en entier, de près comme de loin', () => {
    const sim = makeSim()
    expect(partVisible(sim, N, RX, RY, CX, CY)).toBe(1)
    expect(partVisible(sim, N, 45.2, 51.7, CX, CY)).toBe(1)
    expect(partVisible(sim, N, CX, CY, CX, CY)).toBe(1) // le récepteur SUR la source
  })

  it('V2 — une bande de mur entre le feu et le corps éteint tout ; à côté de l’axe, rien', () => {
    const sim = makeSim()
    mur(sim, FX, FY, EDGE_O) // la ligne x = 50, entre 48,5 et 50,5
    expect(partVisible(sim, N, RX, RY, CX, CY)).toBe(0)
    const ailleurs = makeSim()
    mur(ailleurs, FX, FY - 2, EDGE_O) // la même ligne, deux tuiles au nord : hors des seize rayons
    expect(partVisible(ailleurs, N, RX, RY, CX, CY)).toBe(1)
  })

  it('V3 — la bande est OUVERTE : posé sur sa face, on n’est pas dedans ; de l’autre côté, on est derrière', () => {
    const sim = makeSim()
    mur(sim, FX, FY, EDGE_O)
    const face = 0.5 / LUMIERE.TEXELS_PAR_TUILE // un demi-texel : le centre du texel qui borde le mur
    expect(partVisible(sim, N, FX + face, RY, CX, CY)).toBe(1) // la face côté feu
    expect(partVisible(sim, N, FX - face, RY, CX, CY)).toBe(0) // la face de l'autre côté
  })

  it('V4 — la bande bloque ENTRE ses deux bouts, et la pénombre est une PART : ni 0 ni 1 en lisière', () => {
    const sim = makeSim()
    mur(sim, FX, FY, EDGE_O) // de y = 47,875 à 49,125 (un demi-texel de débord à chaque bout)
    // Un corps au sud-ouest, dont les rayons vers le disque passent des deux côtés du bout sud :
    // depuis (48,5 ; 51) le rayon vers le centre coupe x = 50 PILE au bout de la bande (y = 49,125),
    // et le disque se partage. À (48,5 ; 50), tous les rayons coupent encore la bande : part nulle.
    expect(partVisible(sim, N, RX, 50.0, CX, CY)).toBe(0)
    const part = partVisible(sim, N, RX, 51.0, CX, CY)
    expect(part).toBeGreaterThan(0)
    expect(part).toBeLessThan(1)
    // Plus au sud encore, plus de rayons passent : la pénombre est monotone.
    expect(partVisible(sim, N, RX, 52.5, CX, CY)).toBeGreaterThan(part)
  })

  it('V5 — les quatre arêtes bloquent chacune de leur côté, jamais de l’autre', () => {
    for (const [edges, x, y] of [
      [EDGE_N, CX, FY - 1.5], // le corps au nord de la ligne y = 48
      [EDGE_S, CX, FY + 2.5], // au sud de y = 49
      [EDGE_O, FX - 1.5, CY], // à l'ouest de x = 50
      [EDGE_E, FX + 2.5, CY], // à l'est de x = 51
    ] as const) {
      const sim = makeSim()
      mur(sim, FX, FY, edges)
      expect(partVisible(sim, N, x, y, CX, CY), `arête ${edges}, derrière`).toBe(0)
      // Le même corps, vu par un feu posé de SON côté de la bande : rien entre eux.
      expect(partVisible(sim, N, x, y, x + 0.5, y + 0.5), `arête ${edges}, devant`).toBe(1)
    }
  })

  it('V6 — un fût dans l’axe éteint ; le même arbre une tuile à côté, non (la cime est en l’air)', () => {
    const sim = makeSim()
    sim.nodes.push({ id: 9001, type: 'tree', tx: 49, ty: 48, stock: 5, regrowAt: 0 })
    expect(partVisible(sim, N, RX, RY, CX, CY)).toBe(0)
    const decale = makeSim()
    decale.nodes.push({ id: 9001, type: 'tree', tx: 49, ty: 46, stock: 5, regrowAt: 0 })
    expect(partVisible(decale, N, RX, RY, CX, CY)).toBe(1)
    // Le tronc n'est que le centre de la tuile : un corps sur le BORD de la tuile de l'arbre voit encore.
    expect(partVisible(sim, N, 49.5, 47.1, CX, CY)).toBeGreaterThan(0)
  })

  it('V7 — une roche (nœud plein) et le terrain plein arrêtent la lumière ; l’eau, non', () => {
    const roche = makeSim()
    roche.nodes.push({ id: 9002, type: 'rock', tx: 49, ty: 48, stock: 5, regrowAt: 0 })
    expect(partVisible(roche, N, RX, RY, CX, CY)).toBe(0)
    const terrain = makeSim()
    terrain.map.terrain[48 * terrain.map.width + 49] = TERRAIN_ROCK
    expect(partVisible(terrain, N, RX, RY, CX, CY)).toBe(0)
    const eau = makeSim()
    eau.map.terrain[48 * eau.map.width + 49] = 6 // TERRAIN_DEEP_WATER : la lumière passe sur l'eau
    expect(partVisible(eau, N, RX, RY, CX, CY)).toBe(1)
  })

  it('V8 — les occludeurs se lisent À L’ÉTAGE du récepteur : un mur sous la roche ne fait pas d’ombre au sol', () => {
    const sim = makeSim()
    mur(sim, FX, FY, EDGE_O, -1)
    expect(partVisible(sim, N, RX, RY, CX, CY)).toBe(1)
  })

  it('V9 — la règle du coin : un corps et une source PILE sur des coins de texels — la traversée termine, et rend toujours pareil', () => {
    const sim = makeSim()
    mur(sim, FX, FY, EDGE_O)
    // Le centre d'une tuile EST un coin de texel ; 48,25 en est un autre. Rien n'erre, rien ne jette.
    const a = partVisible(sim, N, 48.25, 48.25, CX, CY)
    const b = partVisible(sim, N, 48.25, 48.25, CX, CY)
    expect(a).toBe(b)
    expect(a).toBe(0)
    // Le rayon LONGE la ligne y = 48 (192 texels) : la bande y est (elle déborde d'un demi-texel
    // au nord, jusqu'à 191,5), il la coupe. Un seul point du disque — le plus bas du motif, à
    // 192 − 0,976 × 1,5 — passe SOUS ce débord : un seizième, pas zéro, et toujours le même.
    const c = partVisible(sim, N, 48.0, 48.0, 52.0, 48.0)
    expect(c).toBe(1 / MOTIF_SOURCE.length)
    expect(partVisible(sim, N, 48.0, 48.0, 52.0, 48.0)).toBe(c)
    expect(partVisible(sim, N, 47.0, 44.0, 47.0, 44.0)).toBe(1)
  })

  it('V10 — pas un tirage consommé, rien d’écrit : le monde est le même avant et après', () => {
    const sim = nuitNoire()
    mur(sim, FX, FY, EDGE_O)
    feu(sim, FX, FY)
    const e = avatar(sim, RX, RY)
    const avant = JSON.stringify(sim)
    partVisible(sim, N, RX, RY, CX, CY)
    clarteSurSoi(sim, e)
    expect(JSON.stringify(sim)).toBe(avant)
  })
})

describe('la lumière du feu — la bulle × la part (LG-R11, LG-R12, LG-R17)', () => {
  it('F1 — LG-R11 : en nuit aveugle, derrière un mur, on ne pare plus ; sans le mur, on pare', () => {
    const libre = nuitNoire()
    feu(libre, FX, FY)
    const e = avatar(libre, RX, RY)
    expect(clarteSurSoi(libre, e)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    const mure = nuitNoire()
    feu(mure, FX, FY)
    mur(mure, FX, FY, EDGE_O)
    const m = avatar(mure, RX, RY)
    expect(clarteSurSoi(mure, m)).toBeLessThan(NUIT.SEUIL_NOIR)
  })

  it('F6 — LG-A11 : joué sur `step()`, pas sur la fonction — la parade tombe derrière le mur, tient sans lui', () => {
    // Le patron de P5 (`nuit.test.ts`) : la posture se lit sur le corps APRÈS le tick.
    const libre = nuitNoire()
    feu(libre, FX, FY)
    const a = avatar(libre, RX, RY)
    step(libre, [{ entityId: a.id, dx: 0, dy: 0, block: true }])
    expect(ent(libre, a.id).blocking).toBe(true)
    const mure = nuitNoire()
    feu(mure, FX, FY)
    mur(mure, FX, FY, EDGE_O)
    const m = avatar(mure, RX, RY)
    step(mure, [{ entityId: m.id, dx: 0, dy: 0, block: true }])
    expect(ent(mure, m.id).blocking).toBe(false)
    // Et la chaleur du même feu, derrière le même mur, n'a pas bougé (N1bis) — sur le monde JOUÉ.
    expect(fireBubble(mure, RX, RY)).toBe(fireBubble(libre, RX, RY))
    expect(fireBubble(mure, RX, RY)).toBeGreaterThan(0)
  })

  it('F7 — LG-A13 : même graine, mêmes inputs — un feu, un mur d’arête, une torche portée : deux mondes rejouent au bit près', () => {
    // `sim.test.ts`, `replay.test.ts` et `events.test.ts` ne posent ni feu ni torche : le chemin de
    // `partVisible` n'y passe jamais (revue `determinisme-sim`, 2026-09-16). Ici il passe à chaque tick.
    const jouer = () => {
      const sim = nuitNoire()
      feu(sim, FX, FY)
      mur(sim, FX, FY, EDGE_O)
      const a = avatar(sim, RX, RY)
      const b = avatar(sim, RX - 3, RY + 2)
      torcheEnMain(b)
      for (let t = 0; t < 40; t++) {
        step(sim, [
          { entityId: a.id, dx: 0, dy: 0, block: true },
          { entityId: b.id, dx: t < 20 ? 1 : 0, dy: t < 20 ? -1 : 0 },
        ])
      }
      return { sim, a: a.id, b: b.id }
    }
    const un = jouer()
    const deux = jouer()
    expect(JSON.stringify(un.sim)).toBe(JSON.stringify(deux.sim))
    // La prémisse : la torche brûle encore, et elle éclaire bien `a` (la lumière a été jouée, pas contournée).
    expect(torcheVive(ent(un.sim, un.b))).not.toBeNull()
    expect(clarteSurSoi(un.sim, ent(un.sim, un.a))).toBeGreaterThan(0)
  })

  it('F2 — la lumière vaut la bulle entière en champ libre, et zéro derrière la bande', () => {
    const sim = nuitNoire()
    feu(sim, FX, FY)
    const bulle = 1 - 2 / TEMPERATURE.FIRE_RANGE // à deux tuiles du centre
    expect(lumiereDuFeu(sim, RX, RY)).toBeCloseTo(bulle, 12)
    mur(sim, FX, FY, EDGE_O)
    expect(lumiereDuFeu(sim, RX, RY)).toBe(0)
  })

  it('F3 — LA CHALEUR NE CHANGE PAS : au bit près, avec et sans le mur (mondes jumeaux)', () => {
    const sans = nuitNoire()
    feu(sans, FX, FY)
    const avec = nuitNoire()
    feu(avec, FX, FY)
    mur(avec, FX, FY, EDGE_O)
    for (const [x, y] of [
      [RX, RY],
      [49.9, 48.5],
      [50.5, 52.0],
      [46.3, 47.1],
    ] as const) {
      expect(fireBubble(avec, x, y)).toBe(fireBubble(sans, x, y))
      expect(fireBubble(sans, x, y)).toBeGreaterThan(0)
    }
  })

  it('F4 — LG-A18 : la bulle part du CENTRE de la tuile — la même chaleur à la même distance, de tous les côtés', () => {
    const sim = makeSim()
    feu(sim, FX, FY)
    expect(fireBubble(sim, CX, CY)).toBe(TEMPERATURE.FIRE_WARMTH)
    for (const d of [0.5, 1, 2.5, 5.9]) {
      const est = fireBubble(sim, CX + d, CY)
      expect(fireBubble(sim, CX - d, CY)).toBe(est)
      expect(fireBubble(sim, CX, CY + d)).toBe(est)
      expect(fireBubble(sim, CX, CY - d)).toBe(est)
      expect(est).toBeCloseTo(TEMPERATURE.FIRE_WARMTH * (1 - d / TEMPERATURE.FIRE_RANGE), 12)
    }
    expect(fireBubble(sim, CX + TEMPERATURE.FIRE_RANGE, CY)).toBe(0)
    // La lumière et la chaleur s'annulent aux mêmes points : même centre, même portée.
    expect(lumiereDuFeu(sim, CX + TEMPERATURE.FIRE_RANGE - 0.01, CY)).toBeGreaterThan(0)
    expect(lumiereDuFeu(sim, CX + TEMPERATURE.FIRE_RANGE, CY)).toBe(0)
  })

  it('F5 — deux feux : le plus clair VU l’emporte, pas le plus proche caché', () => {
    const sim = nuitNoire()
    feu(sim, FX, FY) // à deux tuiles, mais derrière le mur
    mur(sim, FX, FY, EDGE_O)
    feu(sim, 44, 48) // à quatre tuiles, à découvert : bulle ⅓
    expect(lumiereDuFeu(sim, RX, RY)).toBeCloseTo(1 - 4 / TEMPERATURE.FIRE_RANGE, 12)
  })
})

describe('l’occlusion au grain — le raster dont l’écran dérive (LG-R11)', () => {
  const T = LUMIERE.TEXELS_PAR_TUILE

  it('O1 — chaque sorte d’occludeur marque ses texels, et rien d’autre', () => {
    const sim = makeSim()
    sim.map.terrain[44 * sim.map.width + 44] = TERRAIN_ROCK // le terrain plein : toute la tuile
    sim.nodes.push({ id: 9101, type: 'tree', tx: 46, ty: 46, stock: 5, regrowAt: 0 }) // un fût : les 2×2 du centre
    sim.nodes.push({ id: 9102, type: 'rock', tx: 48, ty: 44, stock: 5, regrowAt: 0 }) // un nœud plein : toute la tuile
    addStructure(sim, 'house', 50, 46, 0, 0) // du bâti plein : toute la tuile
    mur(sim, FX, FY, EDGE_O) // une bande : aucun texel
    const o = occlusionAuGrain(sim, N, 42, 42, 53, 51)
    expect([o.ox, o.oy, o.gw, o.gh]).toEqual([42 * T, 42 * T, 12 * T, 10 * T])
    const sorte = (tx: number, ty: number, sx: number, sy: number) => o.sortes[((ty - 42) * T + sy) * o.gw + (tx - 42) * T + sx]
    for (let sy = 0; sy < T; sy++)
      for (let sx = 0; sx < T; sx++) {
        expect(sorte(44, 44, sx, sy)).toBe(OCCLUDEUR.TERRAIN)
        expect(sorte(48, 44, sx, sy)).toBe(OCCLUDEUR.NOEUD)
        expect(sorte(50, 46, sx, sy)).toBe(OCCLUDEUR.BATI)
        expect(sorte(FX, FY, sx, sy)).toBe(OCCLUDEUR.LIBRE) // la tuile du mur d'arête reste du sol
        expect(sorte(43, 43, sx, sy)).toBe(OCCLUDEUR.LIBRE)
        const centre = sx >= T / 2 - 1 && sx <= T / 2 && sy >= T / 2 - 1 && sy <= T / 2
        expect(sorte(46, 46, sx, sy)).toBe(centre ? OCCLUDEUR.TRONC : OCCLUDEUR.LIBRE)
      }
    // La bande, en texels absolus : à cheval sur x = 50 × T, du haut au bas de la tuile plus un demi-texel.
    expect(o.bandes).toHaveLength(1)
    expect(o.bandes[0]).toEqual({ x0: FX * T - 0.5, x1: FX * T + 0.5, y0: FY * T - 0.5, y1: FY * T + T + 0.5, type: 'wall' })
  })

  it('O2 — le raster et `partVisible` lisent le MÊME monde : tout texel plein du raster bloque un rayon qui le vise', () => {
    const sim = makeSim()
    sim.nodes.push({ id: 9103, type: 'rock', tx: 49, ty: 48, stock: 5, regrowAt: 0 })
    const o = occlusionAuGrain(sim, N, 46, 46, 52, 50)
    let pleins = 0
    for (let j = 0; j < o.gh; j++)
      for (let i = 0; i < o.gw; i++) {
        if (o.sortes[j * o.gw + i] === OCCLUDEUR.LIBRE) continue
        pleins++
        // Un récepteur juste à l'ouest de ce texel plein, la source juste à l'est : tout le disque est derrière lui.
        const rx = (o.ox + i - 1.5) / T
        const ry = (o.oy + j + 0.5) / T
        const sx = (o.ox + i + 1 + 1.5 + 2) / T
        const sy = ry
        expect(partVisible(sim, N, rx, ry, sx, sy), `texel plein (${i}, ${j})`).toBeLessThan(1)
      }
    expect(pleins).toBe(T * T)
  })

  it('O3 — à l’étage du récepteur : un mur sous la roche n’est pas dans le raster du sol, et l’inverse', () => {
    const sim = makeSim()
    mur(sim, FX, FY, EDGE_O, -1)
    const sol = occlusionAuGrain(sim, N, 46, 46, 52, 50)
    expect(sol.bandes).toHaveLength(0)
    expect(sol.sortes.every((s) => s === OCCLUDEUR.LIBRE)).toBe(true)
    // Sous une carte sans souterrain, l'étage −1 est de la roche pleine partout (le vide) : tout texel est
    // du terrain plein — et la bande du mur, elle, y est.
    const cave = occlusionAuGrain(sim, -1, 46, 46, 52, 50)
    expect(cave.bandes).toHaveLength(1)
    expect(cave.sortes.every((s) => s === OCCLUDEUR.TERRAIN)).toBe(true)
  })

  it('O4 — le raster par tuile dit, à chaque texel, ce que la règle au texel dit (C6 : deux lectures par tuile, pas seize)', () => {
    // Un bloc dense de 16 × 12 tuiles où chaque sorte se présente, et la tuile MIXTE (un fût ET une
    // pièce pleine) où le centre est du tronc et le tour du bâti ; du bâti à l'étage d'en dessous, qui
    // n'a rien à faire dans le raster du sol.
    const sim = makeSim()
    const X0 = 40
    const Y0 = 40
    const X1 = 55
    const Y1 = 51
    let id = 9200
    let mixtes = 0
    for (let ty = Y0; ty <= Y1; ty++)
      for (let tx = X0; tx <= X1; tx++) {
        const r = (tx * 7 + ty * 13) % 9
        if (r === 0) sim.map.terrain[ty * sim.map.width + tx] = TERRAIN_ROCK
        else if (r === 1) sim.nodes.push({ id: id++, type: 'tree', tx, ty, stock: 5, regrowAt: 0 })
        else if (r === 2) sim.nodes.push({ id: id++, type: 'rock', tx, ty, stock: 5, regrowAt: 0 })
        else if (r === 3) addStructure(sim, 'house', tx, ty, 0, 0)
        else if (r === 4) {
          sim.nodes.push({ id: id++, type: 'tree', tx, ty, stock: 5, regrowAt: 0 })
          addStructure(sim, 'house', tx, ty, 0, 0)
          mixtes++
        } else if (r === 5) mur(sim, tx, ty, EDGE_O | EDGE_N)
        else if (r === 6) addStructure(sim, 'house', tx, ty, 0, 0, undefined, undefined, 0, -1)
      }
    const o = occlusionAuGrain(sim, N, X0, Y0, X1, Y1)
    const comptes = new Map<number, number>()
    for (let j = 0; j < o.gh; j++)
      for (let i = 0; i < o.gw; i++) {
        const lu = o.sortes[j * o.gw + i]!
        expect(lu, `texel (${o.ox + i}, ${o.oy + j})`).toBe(sorteAuTexel(sim, N, o.ox + i, o.oy + j))
        comptes.set(lu, (comptes.get(lu) ?? 0) + 1)
      }
    // La prémisse : les cinq sortes sont dans le bloc, et la tuile mixte y est bien mixte.
    for (const sorte of [OCCLUDEUR.LIBRE, OCCLUDEUR.TERRAIN, OCCLUDEUR.TRONC, OCCLUDEUR.NOEUD, OCCLUDEUR.BATI]) expect(comptes.get(sorte) ?? 0, `sorte ${sorte}`).toBeGreaterThan(0)
    expect(mixtes).toBeGreaterThan(0)
    const sorte = (tx: number, ty: number, sx: number, sy: number) => o.sortes[((ty - Y0) * T + sy) * o.gw + (tx - X0) * T + sx]
    for (let ty = Y0; ty <= Y1; ty++)
      for (let tx = X0; tx <= X1; tx++) {
        if ((tx * 7 + ty * 13) % 9 !== 4) continue
        expect(sorte(tx, ty, T / 2 - 1, T / 2 - 1)).toBe(OCCLUDEUR.TRONC)
        expect(sorte(tx, ty, 0, 0)).toBe(OCCLUDEUR.BATI)
      }
    // Et à l'étage d'en dessous, le même accord (tout terrain sous une carte sans souterrain).
    const cave = occlusionAuGrain(sim, -1, X0, Y0, X1, Y1)
    for (let j = 0; j < cave.gh; j++)
      for (let i = 0; i < cave.gw; i++) expect(cave.sortes[j * cave.gw + i]).toBe(sorteAuTexel(sim, -1, cave.ox + i, cave.oy + j))
  })
})

describe('les torches des autres (LG-R18, LG-A19)', () => {
  it('T1 — la torche vive d’un autre avatar éclaire à sa bulle, à portée ; au-delà, rien', () => {
    const sim = nuitNoire()
    const moi = avatar(sim, RX, RY)
    const autre = avatar(sim, RX + 2, RY)
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
    torcheEnMain(autre)
    expect(clarteSurSoi(sim, autre)).toBe(1) // le porteur, à plein
    expect(clarteSurSoi(sim, moi)).toBeCloseTo(1 - 2 / LUMIERE.TORCHE_PORTEE_TUILES, 6)
    expect(clarteSurSoi(sim, moi)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    autre.x = RX + LUMIERE.TORCHE_PORTEE_TUILES + 0.5
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
  })

  it('T2 — la torche d’un autre s’arrête aux murs comme un feu, et sa chaleur est nulle (I3)', () => {
    const sim = nuitNoire()
    const moi = avatar(sim, RX, RY)
    const autre = avatar(sim, RX + 2, RY)
    torcheEnMain(autre)
    const chaleurAvant = fireBubble(sim, RX, RY)
    mur(sim, FX, FY, EDGE_O)
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
    expect(fireBubble(sim, RX, RY)).toBe(chaleurAvant)
    expect(chaleurAvant).toBe(0)
  })

  it('T3 — la torche d’un PNJ n’éclaire personne (N6 : le périmètre est l’avatar)', () => {
    const sim = nuitNoire()
    const moi = avatar(sim, RX, RY)
    const pnj = avatar(sim, RX + 2, RY)
    torcheEnMain(pnj)
    sim.npcs.push({ entityId: pnj.id } as unknown as Npc)
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
    // Et un porteur MORT n'éclaire plus.
    sim.npcs.length = 0
    expect(clarteSurSoi(sim, moi)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    pnj.hp = 0
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
  })

  it('T4 — à un autre étage, la torche ne compte pas ; et la façade sans entités rend zéro sans se plaindre', () => {
    const sim = nuitNoire()
    const moi = avatar(sim, RX, RY)
    const autre = avatar(sim, RX + 2, RY)
    torcheEnMain(autre)
    autre.etage = -1
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
    expect(lumiereDesTorches({ map: sim.map, structures: sim.structures }, RX, RY)).toBe(0)
  })
})
