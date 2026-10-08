import { describe, expect, it } from 'vitest'
import { FIRE, LUMIERE, NUIT, SLOTS, TEMPERATURE, TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { EDGE_E, EDGE_N, EDGE_O, EDGE_S } from './geometry'
import { addItems, makeInventory } from './items'
import { MOTIF_SOURCE, OCCLUDEUR, estUnePorte, lumiereDesBraises, lumiereDesTorches, occlusionAuGrain, partVisible, seTientAuSol, sorteAuTexel } from './lumiere'
import { createEmptyMap } from './map'
import type { Monster } from './monsters'
import { clarteDeCeQuOnPorte, clarteSurSoi, clarteSurSoiAt, lumiereDuFeu, LUNAISON_JOURS, LUNE_PLEINE_JOUR } from './nuit'
import { BRAISE } from './balance'
import { braiseNeuve, bulleDeBraise, chargePleine, rayonDeBraise } from './braise'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import { bulleDuFeu, cransExiges, fireBubble } from './temperature'
import { torcheVive } from './torche'
import { cycleOffsetForStartHour, jourDeSaison } from './time'
import { addStructure, type Structure } from './village'
/**
 * ⚠ UN FOYER LIBRE NAÎT ÉTEINT DEPUIS `braise.md` B-R17 (2026-10-04) : un `addStructure` nu ne
 * brûle plus rien. Les gardes de ce fichier éprouvent un feu QUI BRÛLE, donc le montage lui donne
 * la flamme — c'est la prémisse perdue qu'on refabrique, pas un contournement de la loi : la loi
 * elle-même est éprouvée par le vrai chemin joueur dans `braise.test.ts` (B-A17).
 */
const allume = <S extends Structure>(sim: SimState, s: S): S => {
  s.allumee = true
  // …ET L'ANCRE DE COMBUSTION AVEC. `addStructure` ne la pose plus (un foyer naît éteint, donc rien
  // ne brûle à sa naissance) ; la production l'ancre au premier tick de flamme, clause « Sécurité »
  // d'`advanceFire`. Ici on la pose AVEC la flamme, pour rendre exactement l'état de naissance
  // d'avant la loi — c'est ce que ces montages supposent quand ils règlent `burnAt` à la main.
  if (s.fuel && s.burnAt === undefined) { s.burnAt = sim.tick; s.burnSlot = 0 }
  return s
}

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
  const s = allume(sim, addStructure(sim, 'fire', tx, ty, 0, 0))
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
/**
 * ⚠ **IL NAÎT BRAISE VIDE, ET C'EST LA PRÉMISSE DE TOUT CE FICHIER** (B-R13c, étape 7,
 * 2026-10-05). Depuis que la braise portée éclaire, un avatar neuf est **sa propre source** :
 * `braiseNeuve` le fait naître à charge pleine, donc à clarté 1, et toute garde qui dit « ici on
 * ne voit rien » serait verte pour la mauvaise raison — ou rouge, comme ces treize-ci l'ont été.
 *
 * On vide donc la braise, parce que **c'est l'état de jeu où la nuit noire existe encore** sous
 * l'issue ⓐ (`braise.md` § 5.21) : le noir est devenu un fait d'altitude et d'expédition, pas de
 * camp. `charge: 0` et non `braise: undefined` — ce dernier est une sauvegarde d'avant l'étape 4,
 * un état bien plus rare que celui qu'on veut éprouver.
 *
 * Ce que la braise fait quand elle est PLEINE a ses propres gardes, en bas de ce fichier (B-A18).
 */
function avatar(sim: SimState, x: number, y: number): Entity {
  const e = ent(sim, spawnEntity(sim, x, y))
  e.inventory = makeInventory(SLOTS.PLAYER)
  if (e.braise !== undefined) e.braise.charge = 0
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

  // ⚠ RÉÉCRITE LE 2026-09-29 : elle prenait son figurant dans `sim.npcs`, champ supprimé avec
  // les villages PNJ (tranche 3). N6 pesait DEUX populations — les PNJ et les monstres —, et
  // c'est le monstre qui la porte désormais : une vraie population, qui existe dans le jeu
  // joué. La loi et les trois assertions sont identiques, seul le figurant a changé d'espèce.
  it('T3 — la torche d’un FIGURANT n’éclaire personne (N6 : le périmètre est l’avatar)', () => {
    const sim = nuitNoire()
    const moi = avatar(sim, RX, RY)
    const figurant = avatar(sim, RX + 2, RY)
    torcheEnMain(figurant)
    sim.monsters.push({ entityId: figurant.id } as unknown as Monster)
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
    // Et le MÊME corps, redevenu avatar, éclaire — c'est ce qui prouve que c'est bien le
    // statut de figurant qui l'éteint, et non la géométrie de la scène.
    sim.monsters.length = 0
    expect(clarteSurSoi(sim, moi)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    // Et un porteur MORT n'éclaire plus.
    figurant.hp = 0
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

describe('les paliers — la marche se juge en hauteur (LG-R14, LG-A15)', () => {
  const T = LUMIERE.TEXELS_PAR_TUILE
  const H = LUMIERE.PALIER_TEXELS
  const F = LUMIERE.FLAMME_TEXELS
  /** La marche : les rangées ty < BORD au palier 1 (au nord, comme les terrasses du jeu), le reste au palier 0. */
  const BORD = 48
  const LIGNE = BORD * T
  function terrasse(sim: SimState, rampe?: { x: number; y: number }): void {
    const w = sim.map.width
    sim.map.palier = Array.from({ length: w * sim.map.height }, (_, i) => (Math.floor(i / w) < BORD ? 1 : 0))
    if (rampe !== undefined) {
      // La tuile de la rampe appartient aux DEUX étages (E-R7) : au palier 0 par la carte, au 1 par l'étage.
      const i = rampe.y * w + rampe.x
      sim.map.etages = [{ niveau: 1, idx: [i], terrain: [TERRAIN_GRASS], x0: rampe.x, y0: rampe.y, x1: rampe.x + 1, y1: rampe.y + 1 }]
      sim.map.connecteurs = [{ x: rampe.x, y: rampe.y, de: 0, vers: 1, type: 'rampe' }]
    }
  }
  /**
   * LA LOI, écrite à part de la traversée : pour une marche DROITE sur la ligne y = LIGNE, le rayon du
   * récepteur (au sol de son palier) vers un échantillon (à la flamme, au-dessus du sol de la source)
   * franchit la ligne au paramètre t = (LIGNE − y0) / (y1 − y0), à la hauteur z0 + t (z1 − z0) ; il est
   * bloqué si elle est strictement sous H. Sans marche franchie, il passe (rien d'autre sur la carte).
   */
  function partParLaLoi(rx: number, ry: number, pr: number, sx: number, sy: number, ps: number): number {
    const R = LUMIERE.SOURCE_RAYON_TEXELS
    const y0 = ry * T
    const z0 = pr * H
    const z1 = ps * H + F
    let vus = 0
    for (const p of MOTIF_SOURCE) {
      const y1 = sy * T + p[1] * R
      if (y0 < LIGNE === y1 < LIGNE) {
        vus++
        continue
      }
      const t = (LIGNE - y0) / (y1 - y0)
      if (z0 + t * (z1 - z0) >= H) vus++
    }
    return vus / MOTIF_SOURCE.length
  }

  it('P1 — d’en bas, rien ne monte : un feu au pied de la paroi n’éclaire aucun texel du plateau, et la plaine autour de lui reste entière', () => {
    const sim = makeSim()
    terrasse(sim)
    const plat = makeSim()
    const cx = 50.5
    const cy = BORD + 0.5 // le feu sur la première rangée basse, contre la marche
    let plateau = 0
    for (let ty = BORD - 6; ty < BORD; ty++)
      for (let tx = 44; tx <= 56; tx++) {
        expect(partVisible(sim, 1, tx + 0.5, ty + 0.5, cx, cy, 0), `plateau (${tx}, ${ty})`).toBe(0)
        expect(partVisible(plat, 0, tx + 0.5, ty + 0.5, cx, cy, 0)).toBe(1) // le contrôle : à plat, tout se voit
        plateau++
      }
    expect(plateau).toBe(6 * 13)
    for (let ty = BORD; ty <= BORD + 5; ty++) for (let tx = 44; tx <= 56; tx++) expect(partVisible(sim, 0, tx + 0.5, ty + 0.5, cx, cy, 0)).toBe(1)
    // Et les hauteurs mêmes de la règle : le sol d'un palier à H, la flamme à F au-dessus, F < H.
    expect(H).toBe(8)
    expect(F).toBeLessThan(H)
  })

  it('P2 — d’en haut, la lumière descend au-delà de s = (H ÷ F) × d : la traversée rend, texel pour texel, la loi écrite à part — et le plateau garde sa lumière', () => {
    const sim = makeSim()
    terrasse(sim)
    let dansLOmbre = 0
    let auClair = 0
    let penombre = 0
    for (let recul = 0; recul <= 3; recul++) {
      const cx = 50.5
      const cy = BORD - 0.5 - recul // le feu au palier 1, `recul` rangées derrière la dernière rangée haute
      for (let ty = BORD - 6; ty <= BORD + 15; ty++)
        for (let tx = 44; tx <= 56; tx++) {
          const rx = tx + 0.5
          const ry = ty + 0.5
          const pr = ty < BORD ? 1 : 0
          const part = partVisible(sim, pr, rx, ry, cx, cy, 1)
          expect(part, `recul ${recul}, récepteur (${tx}, ${ty})`).toBe(partParLaLoi(rx, ry, pr, cx, cy, 1))
          if (ty < BORD) expect(part).toBe(1) // le plateau : la même lumière que sans marche
          else if (part === 0) dansLOmbre++
          else if (part === 1) auClair++
          else penombre++
        }
    }
    // La prémisse : les trois régimes existent dans le balayage.
    expect(dansLOmbre).toBeGreaterThan(0)
    expect(penombre).toBeGreaterThan(0)
    expect(auClair).toBeGreaterThan(0)
    // Planche 16 (LG-A15) : le feu reculé de deux tuiles, la plaine à 1–2 tuiles derrière la marche ne reçoit rien ;
    // et loin derrière (s ≥ 3,33 × d pour tout le disque), tout.
    const cy2 = BORD - 1.5
    expect(partVisible(sim, 0, 50.5, BORD + 0.5, 50.5, cy2, 1)).toBe(0)
    expect(partVisible(sim, 0, 50.5, BORD + 1.5, 50.5, cy2, 1)).toBe(0)
    expect(partVisible(sim, 0, 50.5, BORD + 7.5, 50.5, cy2, 1)).toBe(1)
    // Le seuil du rayon central, à d = 6 texels : l'ombre s'arrête à s = 20 — la rangée BORD + 4 (s = 18) en
    // garde une part, la rangée BORD + 5 (s = 22) voit le centre du disque.
    expect(partVisible(sim, 0, 50.5, BORD + 4.5, 50.5, cy2, 1)).toBeGreaterThan(0)
    expect(partVisible(sim, 0, 50.5, BORD + 4.5, 50.5, cy2, 1)).toBeLessThan(1)
  })

  it('P3 — un texel du haut n’est jamais bloqué par sa propre marche : la dernière rangée haute, jusqu’à son dernier texel, voit le feu du plateau en entier', () => {
    const sim = makeSim()
    terrasse(sim)
    const cx = 50.5
    const cy = BORD - 3.5
    for (let tx = 44; tx <= 56; tx++)
      for (let sy = 0; sy < T; sy++)
        for (let sx = 0; sx < T; sx++) expect(partVisible(sim, 1, tx + (sx + 0.5) / T, BORD - 1 + (sy + 0.5) / T, cx, cy, 1), `texel (${tx}, ${sx}, ${sy})`).toBe(1)
    // Et le premier texel bas, contre la même arête, n'en voit rien : c'est bien la marche, pas la distance.
    expect(partVisible(sim, 0, 50.5, BORD + 0.5 / T, cx, cy, 1)).toBe(0)
  })

  it('P4 — la rampe est une porte ouverte : par elle, la lumière du plateau descend sur la plaine devant elle, et pas à côté', () => {
    const rampe = { x: 50, y: BORD }
    const sans = makeSim()
    terrasse(sans)
    const avec = makeSim()
    terrasse(avec, rampe)
    const cx = 50.5
    const cy = BORD - 1.5 // reculé de deux tuiles : la plaine dans l'ombre pleine jusqu'à la rangée BORD + 3 (P2)
    for (let ty = BORD + 1; ty <= BORD + 4; ty++) {
      expect(partVisible(avec, 0, 50.5, ty + 0.5, cx, cy, 1), `par la rampe, rangée ${ty}`).toBe(1)
      if (ty > BORD + 3) continue
      expect(partVisible(sans, 0, 50.5, ty + 0.5, cx, cy, 1), `sans rampe, rangée ${ty}`).toBe(0)
      expect(partVisible(avec, 0, 53.5, ty + 0.5, cx, cy, 1), `à côté de la rampe, rangée ${ty}`).toBe(0)
    }
    // Sur la rampe même, à l'étage 1 comme au 0, on se tient au sol (E-R7 : la tuile appartient aux deux).
    expect(seTientAuSol(avec.map, 1, 50.5, BORD + 0.5)).toBe(true)
    expect(seTientAuSol(avec.map, 0, 50.5, BORD + 0.5)).toBe(true)
    expect(seTientAuSol(avec.map, 1, 50.5, BORD + 1.5)).toBe(false)
    expect(estUnePorte(avec.map, 50, BORD)).toBe(true)
    expect(estUnePorte(avec.map, 51, BORD)).toBe(false)
  })

  it('P5 — le raster dit les paliers : au sol, une terrasse n’est plus du terrain plein et chaque texel porte son palier et sa porte ; dans un creux, rien n’a changé', () => {
    const sim = makeSim()
    terrasse(sim, { x: 50, y: BORD })
    const X0 = 44
    const Y0 = BORD - 4
    const X1 = 56
    const Y1 = BORD + 3
    const sol = occlusionAuGrain(sim, 0, X0, Y0, X1, Y1)
    expect(sol.sortes.every((s) => s === OCCLUDEUR.LIBRE)).toBe(true)
    const k = (tx: number, ty: number, sx: number, sy: number) => ((ty - Y0) * T + sy) * sol.gw + (tx - X0) * T + sx
    for (let ty = Y0; ty <= Y1; ty++)
      for (let tx = X0; tx <= X1; tx++)
        for (let sy = 0; sy < T; sy++)
          for (let sx = 0; sx < T; sx++) {
            expect(sol.paliers[k(tx, ty, sx, sy)], `palier (${tx}, ${ty})`).toBe(ty < BORD ? 1 : 0)
            expect(sol.portes[k(tx, ty, sx, sy)], `porte (${tx}, ${ty})`).toBe(tx === 50 && ty === BORD ? 1 : 0)
          }
    // Le même raster, texel par texel, que la règle au texel (O4) — au sol comme dans un creux.
    for (let j = 0; j < sol.gh; j++) for (let i = 0; i < sol.gw; i++) expect(sol.sortes[j * sol.gw + i]).toBe(sorteAuTexel(sim, 0, sol.ox + i, sol.oy + j))
    const creux = occlusionAuGrain(sim, 0, X0, Y0, X1, Y1, false)
    expect(creux.paliers.every((p) => p === 0)).toBe(true)
    expect(creux.portes.every((p) => p === 0)).toBe(true)
    for (let j = 0; j < creux.gh; j++)
      for (let i = 0; i < creux.gw; i++) {
        const ty = Math.floor((creux.oy + j) / T)
        // Vu du creux à niveau 0, le sol du palier 1 est plein (le vide de `terrainAEtage`), le palier 0 libre.
        expect(creux.sortes[j * creux.gw + i], `creux, texel (${i}, ${j})`).toBe(ty < BORD ? OCCLUDEUR.TERRAIN : OCCLUDEUR.LIBRE)
        expect(creux.sortes[j * creux.gw + i]).toBe(sorteAuTexel(sim, 0, creux.ox + i, creux.oy + j, false))
      }
  })

  it('P6 — joué : un feu au pied de la paroi laisse le plateau dans le noir, un feu du plateau laisse la plaine dans son ombre, et passe par la rampe', () => {
    const sim = nuitNoire()
    terrasse(sim, { x: 50, y: BORD })
    // Le feu au pied : le corps du plateau ne pare plus, celui de la plaine, oui.
    const bas = feu(sim, 47, BORD)
    const surLePlateau = avatar(sim, 47.5, BORD - 1.5)
    const surLaPlaine = avatar(sim, 47.5, BORD + 2.5)
    expect(clarteSurSoi(sim, surLePlateau)).toBeLessThan(0.15)
    expect(clarteSurSoi(sim, surLaPlaine)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    expect(lumiereDuFeu(sim, surLePlateau.x, surLePlateau.y)).toBe(0)
    expect(lumiereDuFeu(sim, surLaPlaine.x, surLaPlaine.y)).toBe(bulleDuFeu(sim, bas, surLaPlaine.x, surLaPlaine.y))
    // Le feu du plateau, reculé de deux tuiles : la plaine derrière la marche est dans son ombre ; devant la rampe, non.
    sim.structures.length = 0
    const haut = feu(sim, 50, BORD - 2)
    expect(lumiereDuFeu(sim, 53.5, BORD + 1.5)).toBe(0)
    expect(lumiereDuFeu(sim, 50.5, BORD + 1.5)).toBe(bulleDuFeu(sim, haut, 50.5, BORD + 1.5))
    expect(bulleDuFeu(sim, haut, 50.5, BORD + 1.5)).toBeGreaterThan(0)
  })

  it('P7 — la torche d’un autre descend de la terrasse, à la part que la marche lui laisse ; d’en bas, elle ne monte pas', () => {
    const sim = nuitNoire()
    terrasse(sim)
    const moi = avatar(sim, 50.5, BORD + 2.5)
    const autre = avatar(sim, 50.5, BORD - 0.5) // sur la dernière rangée haute : d = 2 texels devant l'arête
    torcheEnMain(autre)
    // La loi, à part : s = 10 texels ; un échantillon à d > s × F / H = 3 est caché — deux des seize (les y de
    // −0,73 et −0,98 du motif, × 1,5) — et la bulle vaut 1 − 3/10.
    expect(clarteSurSoi(sim, moi)).toBeCloseTo((1 - 3 / LUMIERE.TORCHE_PORTEE_TUILES) * (14 / 16), 6)
    expect(clarteSurSoi(sim, moi)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    // Les deux échangent leurs places : d'en bas, rien ne monte.
    autre.y = BORD + 0.5
    moi.y = BORD - 2.5
    expect(clarteSurSoi(sim, moi)).toBeLessThan(0.15)
    expect(lumiereDesTorches(sim, moi.x, moi.y)).toBe(0)
    // Le même couple à plat : la torche porte, dans les deux sens.
    const plat = nuitNoire()
    const moiPlat = avatar(plat, 50.5, BORD - 2.5)
    const autrePlat = avatar(plat, 50.5, BORD + 0.5)
    torcheEnMain(autrePlat)
    expect(clarteSurSoi(plat, moiPlat)).toBeCloseTo(1 - 3 / LUMIERE.TORCHE_PORTEE_TUILES, 6)
  })
})


// ═══════════════════════════════════════════════════════════════════════════════════════════
// B-A18 — LA CLARTÉ DE LA BRAISE EST UN PROFIL, ET LA NUIT NOIRE CHANGE DE NATURE
//
// Écrit AVANT le code (2026-10-04), branché le 2026-10-05 sur l'issue ⓐ de `braise.md` § 5.21.
//
// ⚠ **LA CLAUSE ④ (N2bis : `clarté_sim ≥ lueur_écran`) N'EST PAS ICI** : elle compare la règle à
// la PEINTURE, donc elle vit du côté client, avec le câblage du halo. L'écrire dans `/sim`
// obligerait à y recopier la courbe de l'écran — la seconde formule que N2bis interdit.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('B-A18 — la braise portée éclaire, au profil de sa source (B-R13c)', () => {
  /** Un avatar à braise PLEINE — l'inverse de `avatar()`, qui la vide (voir sa note). */
  const avatarBraisePleine = (sim: SimState, x: number, y: number): Entity => {
    const e = avatar(sim, x, y)
    e.braise = braiseNeuve(0)
    return e
  }

  it('① AU `max`, ET LA DÉCROISSANCE EST VRAIE — le contact rend le profil, jamais une somme (N1)', () => {
    // ⚠ **CE QUE CETTE GARDE NE PEUT PAS DIRE, ET SON TITRE LE PROMETTAIT À TORT** : avec
    // `CLARTE_PLEINE` = 1, une braise PLEINE rend 1 sur le profil comme sur un privilège — ① est
    // donc VERTE si l'on remplace `bulleDeBraise(braise, 0)` par `braise ? 1 : 0` (falsification
    // jouée à l'audit de fusion du 2026-10-05 : ① verte, ② ③ ⑤ ⑥ rouges — ⚠ et **19 rouges en tout, pas 4** : un privilège à 1 éclaire même une braise VIDE, donc S1→S3, P3, P5, P6, P7, F1, F6 et T1→T4 rougissent aussi ; mon compte était incomplet, pas faux). C'est **②** qui
    // sépare le profil du privilège, parce que lui seul descend la charge. Ce que ① garde
    // vraiment : le `max` (jamais une somme — N1) et la décroissance du balayage avec la distance.
    const sim = nuitNoire()
    const e = avatarBraisePleine(sim, 48.5, 48.5)
    // CONTRÔLE POSITIF du « au contact » : c'est bien `bulleDeBraise(·, 0)` qu'on lit.
    expect(clarteSurSoi(sim, e)).toBeCloseTo(bulleDeBraise(e.braise!, 0), 12)
    // ET STRICTEMENT < 1 DÈS QU'ON S'ÉCARTE DU PORTEUR.
    // ⚠ MON PREMIER MONTAGE ÉTAIT FAUX ICI, et le défaut est instructif : il lisait le point
    // voisin EN PASSANT `e.braise`, c'est-à-dire en affirmant qu'un corps porteur se tient LÀ —
    // le terme sur soi vaut alors son sommet, et la garde rendait 1 sans rien prouver. Pour lire
    // la décroissance, il faut interroger le point SANS braise au contact : ce qui y arrive
    // passe alors par `lumiereDesBraises`, donc par la distance.
    const unPeuPlusLoin = clarteSurSoiAt(sim, sim.tick, 48.5 + 1, 48.5, false)
    expect(unPeuPlusLoin).toBeLessThan(clarteSurSoi(sim, e))
    expect(unPeuPlusLoin).toBeCloseTo(bulleDeBraise(e.braise!, 1), 6)
    expect(unPeuPlusLoin).toBeGreaterThan(0) // CONTRÔLE POSITIF : elle porte jusque-là
    // JAMAIS UNE SOMME (N1) : deux braises pleines côte à côte ne font pas deux fois la lumière.
    const deux = nuitNoire()
    const a = avatarBraisePleine(deux, 48.5, 48.5)
    avatarBraisePleine(deux, 48.5, 48.5)
    expect(clarteSurSoi(deux, a)).toBeCloseTo(bulleDeBraise(a.braise!, 0), 12)
  })

  it('② LA CLAUSE PORTEUSE — la clarté DÉCROÎT avec la charge et FRANCHIT le seuil ; balayée, pas échantillonnée', () => {
    const sim = nuitNoire()
    const e = avatarBraisePleine(sim, 48.5, 48.5)
    const plein = chargePleine(0)
    // ⚠ Si cette garde ne peut pas rougir, l'issue ⓐ n'est pas implémentée : elle serait verte
    // sur la branche écartée ⓐ-d'origine (toujours ≥ seuil) comme sur ⓑ (toujours <).
    e.braise!.charge = plein
    expect(clarteSurSoi(sim, e)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    e.braise!.charge = 0
    expect(clarteSurSoi(sim, e)).toBeLessThan(NUIT.SEUIL_NOIR)
    // LE BALAYAGE : monotone sur toute la vidange, et UN SEUL franchissement du seuil.
    let precedent = Infinity
    let franchissements = 0
    let dessus = true
    for (let i = 200; i >= 0; i--) {
      e.braise!.charge = Math.round((i / 200) * plein)
      const c = clarteSurSoi(sim, e)
      expect(c).toBeLessThanOrEqual(precedent + 1e-12)
      precedent = c
      const auDessus = c >= NUIT.SEUIL_NOIR
      if (auDessus !== dessus) { franchissements++; dessus = auDessus }
    }
    expect(franchissements).toBe(1)
    // ET LE POINT DE BASCULE EST CELUI QUE L'ARITHMÉTIQUE ANNONCE : `CLARTE_PLEINE × f = seuil`.
    const fBascule = NUIT.SEUIL_NOIR / BRAISE.CLARTE_PLEINE
    e.braise!.charge = Math.ceil(fBascule * plein)
    expect(clarteSurSoi(sim, e)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    e.braise!.charge = Math.floor(fBascule * plein) - 1
    expect(clarteSurSoi(sim, e)).toBeLessThan(NUIT.SEUIL_NOIR)
  })

  it('③ LA PARADE SUIT, SUR `step()` ET PAS SEULEMENT SUR LA FONCTION (le patron de LG-A11)', () => {
    const pleine = nuitNoire()
    const a = avatarBraisePleine(pleine, 48.5, 48.5)
    step(pleine, [{ entityId: a.id, dx: 0, dy: 0, block: true }])
    expect(ent(pleine, a.id).blocking).toBe(true) // braise pleine : on pare
    const vide = nuitNoire()
    const b = avatar(vide, 48.5, 48.5) // `avatar()` la vide
    expect(b.braise!.charge).toBe(0) // la PRÉMISSE, dite
    step(vide, [{ entityId: b.id, dx: 0, dy: 0, block: true }])
    expect(ent(vide, b.id).blocking).toBe(false) // braise vide : on ne pare pas ce qu'on ne voit pas
  })

  it('⑤ LA TORCHE GARDE UN EFFET PROPRE — son rayon porte plus loin que la braise pleine', () => {
    // C'est ce qui empêche l'« objet mort en main » : à profil égal au CONTACT (les deux valent
    // leur sommet), la torche se distingue par sa PORTÉE, et le chiffre que B-R13 ne donnait pas
    // est tranché ici — c'est le rayon de la SIM (`TORCHE_PORTEE_TUILES` = 10) qui porte le
    // profil, jamais celui de l'écran (4), parce que N2bis interdit une sim plus sombre que la
    // peinture. Le rayon de l'écran reste un fait de rendu (`render/torche.ts`).
    expect(rayonDeBraise(braiseNeuve(0))).toBeLessThan(LUMIERE.TORCHE_PORTEE_TUILES)
    // JOUÉ, et pas seulement comparé sur les constantes : un camarade à 6 tuiles est éclairé par
    // une torche tenue, et ne l'est PAS par la même braise pleine.
    const D = 6
    const sim = nuitNoire()
    const porteur = avatarBraisePleine(sim, 48.5, 48.5)
    const temoin = avatar(sim, 48.5 + D, 48.5) // braise vide : il ne s'éclaire pas lui-même
    expect(clarteSurSoi(sim, temoin)).toBeLessThan(NUIT.SEUIL_NOIR) // la braise du porteur ne va pas jusqu'à lui
    torcheEnMain(porteur)
    expect(clarteSurSoi(sim, temoin)).toBeCloseTo(1 - D / LUMIERE.TORCHE_PORTEE_TUILES, 6)
    expect(clarteSurSoi(sim, temoin)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
  })

  it('⑥ LA BRAISE DES AUTRES compte, comme leur torche (le miroir de LG-R18) — et pas celle d’un figurant', () => {
    const sim = nuitNoire()
    const moi = avatar(sim, 48.5, 48.5) // braise vide
    expect(clarteSurSoi(sim, moi)).toBeLessThan(NUIT.SEUIL_NOIR)
    const camarade = avatarBraisePleine(sim, 48.5 + 1, 48.5)
    expect(clarteSurSoi(sim, moi)).toBeCloseTo(bulleDeBraise(camarade.braise!, 1), 6)
    expect(clarteSurSoi(sim, moi)).toBeGreaterThan(0) // CONTRÔLE POSITIF : elle porte vraiment
    // AU-DELÀ DE SON RAYON, rien — et le rayon est celui que la charge commande.
    camarade.x = 48.5 + rayonDeBraise(camarade.braise!) + 0.5
    expect(clarteSurSoi(sim, moi)).toBeLessThan(NUIT.SEUIL_NOIR)
    // ⚠ N6 : AUCUN MONSTRE NE PORTE DE BRAISE (gardé dans `braise.test.ts`), donc la clause
    // « pas un figurant » de `lumiereDesBraises` ne peut pas s'éprouver par un vrai monstre
    // porteur : on la prouve par le prédicat, en inscrivant le camarade comme figurant.
    camarade.x = 48.5 + 1
    expect(clarteSurSoi(sim, moi)).toBeGreaterThan(0) // avant
    sim.monsters.push({ entityId: camarade.id } as unknown as Monster)
    expect(clarteSurSoi(sim, moi)).toBeLessThan(NUIT.SEUIL_NOIR) // après : il ne compte plus
  })

  it('⑧ EN PLAINE NUE, le terme sur soi et le balayage coïncident AU BIT — et c’est tout ce que ça prouve', () => {
    // ⚠ **FALSIFICATION JOUÉE, ET ELLE N'A PAS ROUGI** : retirer le terme sur soi du `max` — ou
    // oublier l'argument `braise` de `clarteSurSoi` — laisse les 125 gardes de `lumiere`, `nuit`
    // et `braise` VERTES. **Mais ce n'est PAS parce que le terme serait redondant : c'est un trou
    // de couverture, et il est bouché par ⑨ ci-dessous** (corrigé le 2026-10-05 à l'audit de
    // fusion ; mon énoncé d'origine en faisait un « fait structurel », ce qui était FAUX).
    //
    // Ce que cette garde-ci dit, et seulement ça : **en plaine nue**, le porteur étant dans
    // `state.entities`, `lumiereDesBraises` le sert à distance nulle avec `partVisible` = 1, donc
    // les deux chemins rendent exactement la même valeur. Dès que la vue du porteur sur SA PROPRE
    // source est entamée — un corps contre un mur, un corps emmuré, un corps à terre, un corps
    // inscrit comme figurant —, le balayage rend MOINS, et c'est le terme sur soi qui tranche.
    const sim = nuitNoire()
    const e = avatarBraisePleine(sim, 48.5, 48.5)
    const parLeBalayage = lumiereDesBraises(sim, e.x, e.y, e.etage)
    expect(partVisible(sim, 0, e.x, e.y, e.x, e.y, 0)).toBe(1) // LA PRÉMISSE de la coïncidence
    expect(clarteSurSoi(sim, e)).toBe(parLeBalayage) // AU BIT, pas à l'epsilon
    expect(parLeBalayage).toBeCloseTo(bulleDeBraise(e.braise!, 0), 12)
    // ⚠ **ET LE TERME SERT AUSSI AU CLIENT, pour une autre raison** : il appelle `clarteSurSoiAt`
    // avec sa position PRÉDITE, alors que les entités de sa façade sont restées à celle du
    // SNAPSHOT. En marche l'écart est non nul, et comme le rayon de la braise rétrécit avec la
    // charge, le client prédirait **plus sombre que l'autorité** juste au seuil — un refus de
    // parade que l'autorité n'a pas prononcé (`etat-gel-lumiere.test.ts` L4).
  })

  it('⑨ LE TERME SUR SOI EST PORTANT DANS `/sim` AUSSI — contre un mur, le balayage voit MOINS que le porteur, et la PARADE bascule', () => {
    // ⚠ **CE QUE CETTE GARDE FERME, ET POURQUOI ⑧ NE LE POUVAIT PAS.** ⑧ compare les deux
    // chemins en PLAINE NUE, où `partVisible(soi → soi)` vaut 1 : ils y coïncident par
    // construction, et c'est tout ce que le fichier éprouvait. Dès que le corps s'approche d'un
    // occludeur, le balayage — qui paie un `partVisible` — rend MOINS que le terme sur soi, qui
    // n'en paie pas (« il n'y a rien entre un corps et ce qu'il porte »).
    //
    // **MESURÉ** (audit de fusion du 2026-10-05) : un corps qui marche vers un mur d'arête NORD
    // s'arrête à **y = 48,3125** et sa part visible sur sa PROPRE source tombe à **0,8125** ; sous
    // une pièce PLEINE posée sur sa tuile, à **0,5**. À l'EST-OUEST, en revanche, le même corps ne
    // quitte pas **x = 48,5** (la collision ne le laisse pas approcher) et la part visible reste
    // **1** — d'où le choix d'un mur nord ici. À 32 % de charge, le seuil du noir passe ENTRE les
    // deux lectures : retirer `halo` du `max`, ou oublier `entity.braise` dans `clarteSurSoi`,
    // fait rougir cette garde (les deux falsifications ont été jouées). ⚠ **« ET ELLE SEULE »
    // est PÉRIMÉ** depuis que ⑩ existe (relevé par `determinisme-sim`, D3, MESURÉ) : *oublier
    // `entity.braise`* rougit bien ⑨ **seule**, mais *retirer le halo du `max`* rougit **⑨ ET ⑩**.
    const F = 0.32 // halo 0,32 ≥ seuil ; 0,32 × 0,8125 = 0,26 < seuil — la fenêtre est choisie
    const sim = nuitNoire()
    const moi = avatarBraisePleine(sim, 48.5, 48.5)
    moi.braise!.charge = Math.round(F * chargePleine(0))
    mur(sim, 48, 48, EDGE_N)
    // ON NE POSE PAS LE CORPS, ON LE FAIT MARCHER : la position doit être celle que la collision
    // produit, pas une que j'aurais choisie. ⚠ Et on marche AVANT de parer — `block` met la
    // démarche à l'arrêt, donc un pas demandé la garde haute ne bouge pas d'un pouce.
    for (let t = 0; t < 120; t++) step(sim, [{ entityId: moi.id, dx: 0, dy: -1 }])
    const e = ent(sim, moi.id)
    // LES TROIS PRÉMISSES, AFFIRMÉES ET NON SUPPOSÉES :
    expect(e.y).toBeLessThan(48.5) // il a vraiment avancé vers le mur
    expect(partVisible(sim, 0, e.x, e.y, e.x, e.y, 0)).toBeLessThan(1) // sa source colle la bande
    expect(lumiereDesBraises(sim, e.x, e.y, e.etage)).toBeLessThan(NUIT.SEUIL_NOIR) // balayage seul : NOIR
    // LA LOI : le porteur voit son propre halo EN ENTIER, et il pare.
    expect(clarteSurSoi(sim, e)).toBe(bulleDeBraise(e.braise!, 0))
    expect(clarteSurSoi(sim, e)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)
    step(sim, [{ entityId: e.id, dx: 0, dy: 0, block: true }])
    expect(ent(sim, moi.id).blocking).toBe(true)
  })

  it('⑦ LE HALO NE CHAUFFE RIEN, ET NE COÛTE RIEN (B-A14 ③ : porter sa lumière est gratuit)', () => {
    // ⚠ DEUX BRAS, ET SANS LE SECOND LA CLAUSE EST VERTE SUR UN CORPS QUI NE CONSOMME RIEN.
    // ⚠ Et mon premier montage prenait `nuitNoire()` pour « un air doux » : le froid y mord, donc
    // la charge descendait — la garde accusait le halo d'une vidange qui était celle de B-R8.
    // La PRÉMISSE de chaque bras est donc affirmée sur `cransExiges`, pas supposée.
    const doux = makeSim()
    doux.cycleOffset = cycleOffsetForStartHour(12, jourDeSaison(doux))
    const a = avatarBraisePleine(doux, 48.5, 48.5)
    expect(cransExiges(doux, a.x, a.y, a.etage)).toBe(0) // PRÉMISSE : il ne fait pas froid ici
    const avant = a.braise!.charge
    for (let t = 0; t < 200; t++) step(doux, [{ entityId: a.id, dx: 0, dy: 0 }])
    expect(ent(doux, a.id).braise!.charge).toBe(avant) // le halo brûle, la charge ne bouge pas
    // LE CONTRÔLE POSITIF : le même run dans un air FROID descend bien — donc la boucle ci-dessus
    // n'était pas inerte, elle était gratuite.
    const froid = nuitNoire()
    const b = avatarBraisePleine(froid, 48.5, 48.5)
    expect(cransExiges(froid, b.x, b.y, b.etage)).toBeGreaterThan(0) // PRÉMISSE : il fait froid
    for (let t = 0; t < 200; t++) step(froid, [{ entityId: b.id, dx: 0, dy: 0 }])
    expect(ent(froid, b.id).braise!.charge).toBeLessThan(avant)
    // ET LA CHALEUR N'A PAS BOUGÉ D'UN BIT : la braise couvre une DEMANDE, elle ne chauffe pas le
    // monde — `fireBubble` ne connaît que les foyers posés.
    // ⚠ Les deux lignes qui suivent sont VRAIES PAR CONSTRUCTION (aucun foyer dans ce montage) :
    // elles écrivent la loi, elles ne la prouvent pas. Ce qui la prouve est le `fireBubble` des
    // gardes de la balise (`braise.test.ts`, « le plateau ne sort PAS dans le monde de base »).
    expect(fireBubble(doux, 48.5, 48.5)).toBe(0)
    expect(fireBubble(froid, 48.5, 48.5)).toBe(0)
  })

  it('⑩ `clarteDeCeQuOnPorte` EST le terme sur soi — au bit, et le rendu s’en sert de plancher (B-R13d)', () => {
    // ⚠ **POURQUOI CETTE GARDE EXISTE, ET CE QU'ELLE A DÉJÀ ATTRAPÉ.** La loi *« il doit être
    // éclairé par sa torche ou une braise qu'il porte lui-même »* (Alexis, 2026-10-05) a
    // désormais DEUX lecteurs : `clarteSurSoiAt` ici, et le CORPS à l'écran, qui en fait un
    // PLANCHER sur ce qu'il lit dans le champ de la GI. Deux lecteurs, donc une seule fonction —
    // et le `max` en gardait pourtant une **copie inline** jusqu'au 2026-10-05. Une copie dérive
    // en silence, et c'est N2bis (« l'écran n'est jamais plus clair que la sim ») qui en paierait
    // le prix : le plancher du rendu est un MINORANT pris sur l'autorité, il ne vaut que tant
    // qu'il EST l'autorité.
    //
    // ⚠ **DEUX PRÉCISIONS QUE L'AUDIT A DÛ M'IMPOSER.** ⓐ La forme d'avant n'était pas le
    // ternaire que j'avais écrit, c'étaient **deux `max` séquentiels** contre `lumiere`
    // (`if (surSoi > lumiere) … ; if (halo > lumiere) …`) : le refacto n'a donc pas *extrait* le
    // `max(surSoi, halo)`, il l'a **créé**. ⓑ Les deux formes **divergent sur NaN** — halo NaN +
    // torche vive : le séquentiel rend 1, le ternaire rend 0. L'équivalence au bit tient donc
    // **parce que `bulleDeBraise` ne rend jamais NaN** (MESURÉ : 0 NaN sur 1 040 appels d'un
    // balayage incluant NaN, ±Inf et des charges négatives ; c'est le garde `!(d < r)` qui le
    // fait). Le jour où elle en rendrait un, ce refacto cesserait d'être inerte **en silence**,
    // et dans le sens « le porteur perd sa torche ».
    //
    // ⚠ **ON INTERROGE UN POINT, PAS UN CORPS, ET C'EST LA PRÉMISSE** : sans entité dans la sim,
    // `lumiereDesBraises` rend 0, donc le terme sur soi est seul à porter la valeur. Avec un
    // corps posé, les deux chemins coïncident en plaine nue (⑧) et la garde ne verrait plus
    // lequel des deux a parlé.
    // ⚠⚠ **MA PREMIÈRE VERSION DE CETTE GARDE NE POUVAIT PAS ROUGIR SUR CE QU'ELLE DISAIT
    // GARDER** (relevé par `determinisme-sim`, D2, MESURÉ par mutation). Elle comparait
    // `clarteSurSoiAt(…)` à `clarteDeCeQuOnPorte(…)` — or la première **APPELLE** la seconde :
    // on comparait X à `max(0, X)`, vert sous **toute** réécriture du corps. Mutation jouée
    // (`return t + b`) : un seul rouge, et c'était la ligne littérale `toBe(1)`. Mutation
    // « remettre une copie inline identique » : **142/142 VERT**.
    //
    // La loi se compare donc à une **formule GELÉE ÉCRITE ICI**, qui ne partage pas une ligne
    // avec la production. Si l'une des deux bouge, la garde rougit — c'est tout son but.
    const attendu = (torche: boolean, br: typeof b): number => {
      const halo = (BRAISE.CLARTE_PLEINE * br.charge) / chargePleine(br.niveau)
      return torche ? (1 > halo ? 1 : halo) : halo
    }
    const sim = nuitNoire()
    expect(sim.entities.length).toBe(0) // PRÉMISSE : personne, donc aucun balayage ne sert ce point
    const b = braiseNeuve(0)
    const plein = chargePleine(0)
    let vus = 0
    for (const f of [1, 0.75, 0.5, 0.25, 0.1]) {
      for (const torche of [false, true]) {
        b.charge = Math.round(f * plein)
        const porte = clarteDeCeQuOnPorte(torche, b)
        expect(porte).toBeGreaterThan(0) // CONTRÔLE : le balayage ci-dessous n'est pas vide
        expect(porte).toBe(attendu(torche, b)) // LA LOI, contre une formule gelée hors production
        expect(clarteSurSoiAt(sim, sim.tick, RX, RY, torche, undefined, b)).toBe(porte) // le `max` la prend
        vus++
      }
    }
    expect(vus).toBe(10) // le balayage a vraiment eu lieu
    // LES DEUX MOITIÉS, ET LEUR `max` : une torche vive vaut 1 (tout profil linéaire vaut son
    // sommet au contact), une braise vaut SA CHARGE — jamais 1 par privilège.
    b.charge = plein
    expect(clarteDeCeQuOnPorte(false, b)).toBe(bulleDeBraise(b, 0))
    expect(clarteDeCeQuOnPorte(true, undefined)).toBe(1)
    expect(clarteDeCeQuOnPorte(true, b)).toBe(1) // la torche domine, pas la somme
    b.charge = 0
    expect(clarteDeCeQuOnPorte(true, b)).toBe(1) // une braise vide ne retire rien à la torche
    // ⚠ **ET À MAIN VIDE, BRAISE VIDE, LA LOI NE DONNE RIEN** — c'est ce qui fait que la nuit
    // noire survit à l'étape 7 : elle ne meurt pas d'une exception, elle recule là où la braise
    // tient. Un corps sans braise du tout (sauvegarde d'avant l'étape 4) est traité pareil.
    expect(clarteDeCeQuOnPorte(false, b)).toBe(0)
    expect(clarteDeCeQuOnPorte(false, undefined)).toBe(0)
    // LA MONOTONIE EN CHARGE — c'est elle que le rendu dépense en « le halo se vide tout seul ».
    let precedent = -1
    for (let c = 0; c <= plein; c += Math.floor(plein / 16)) {
      b.charge = c
      const v = clarteDeCeQuOnPorte(false, b)
      expect(v).toBeGreaterThan(precedent)
      precedent = v
    }
    expect(precedent).toBe(clarteDeCeQuOnPorte(false, { ...b, charge: plein }))
  })

})
