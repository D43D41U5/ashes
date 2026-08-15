/**
 * LA PROFONDEUR INTRA-MASSIF — les gardes unitaires (spec t0-exploration §2quater).
 *
 * Le patron : GARDE EXHAUSTIVE sur tout l'espace (jamais des cas choisis) — la récurrence
 * d'érosion est affirmée sur CHAQUE tuile d'une carte synthétique, puis les propriétés de
 * jeu (couvert, vieux fût, repousse) sur de vrais états de sim. Les gardes sur la carte de
 * production vivent dans `t0-exploration.test.ts` (A19) et `zone-content.test.ts` (A20).
 */
import { describe, expect, it } from 'vitest'
import {
  NODE_DEFS,
  TERRAIN_BURNT_FOREST,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_OLD_GROWTH,
  TERRAINS,
} from './balance'
import { advanceEconomy } from './economy'
import { couvertEffectif } from './faune'
import { createEmptyMap, profondeurAt, type WorldMap } from './map'
import { deriverProfondeur, estCoeur, estLisiere, TERRAINS_BOISES_MASSIF } from './profondeur'
import { CREUX } from './racine-relief'
import { createSim, type SimState } from './sim'
import { CONTENU, stockDArbre } from './zone-content'

/** Dérive la profondeur d'une carte synthétique : une seule « zone » (id 0) partout. */
function deriver(map: WorldMap): number[] {
  const zone = new Int32Array(map.width * map.height)
  return deriverProfondeur(map.terrain, zone, 0, map.width, map.height)
}

/** Peint un bloc de forêt. */
function bloc(map: WorldMap, x0: number, y0: number, cote: number, t = TERRAIN_FOREST): void {
  for (let y = y0; y < y0 + cote; y++) {
    for (let x = x0; x < x0 + cote; x++) map.terrain[y * map.width + x] = t
  }
}

describe('R38 — la dérivation (érosion 8-connexe, exhaustive)', () => {
  it('la récurrence tient sur CHAQUE tuile : d = 1 + min(voisins), plafonné ; 0 hors masque', () => {
    const map = createEmptyMap(48, 48, TERRAIN_GRASS)
    bloc(map, 5, 5, 11) //   assez grand pour un cœur (11 ≥ 2·PROF_COEUR − 1)
    bloc(map, 25, 25, 7) //  trop petit pour un cœur
    const prof = deriver(map)
    const boise = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < map.width && y < map.height
      && TERRAINS_BOISES_MASSIF.includes(map.terrain[y * map.width + x]!)
    let fautes = 0
    let premiere = ''
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const d = prof[y * map.width + x]!
        let attendu = 0
        if (boise(x, y)) {
          let minV = Infinity
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const v = boise(x + dx, y + dy) ? prof[(y + dy) * map.width + (x + dx)]! : 0
              if (v < minV) minV = v
            }
          }
          attendu = Math.min(minV + 1, CREUX.PROF_CAP)
        }
        if (d !== attendu) {
          fautes += 1
          if (!premiere) premiere = `(${x},${y}) : ${d} au lieu de ${attendu}`
        }
      }
    }
    expect(fautes, premiere).toBe(0)
  })

  it('le cœur se MÉRITE : le bloc de 11 en a un, le bloc de 7 n\'en a aucun', () => {
    const map = createEmptyMap(48, 48, TERRAIN_GRASS)
    bloc(map, 5, 5, 11)
    bloc(map, 25, 25, 7)
    const prof = deriver(map)
    // Le centre du 11×11 atteint d = 6 ≥ PROF_COEUR.
    expect(prof[10 * 48 + 10]).toBe(6)
    expect(estCoeur(prof[10 * 48 + 10]!)).toBe(true)
    // Le 7×7 plafonne à d = 4 : tout corps et lisière, jamais un cœur.
    let coeurs = 0
    for (let y = 25; y < 32; y++) {
      for (let x = 25; x < 32; x++) if (estCoeur(prof[y * 48 + x]!)) coeurs += 1
    }
    expect(coeurs).toBe(0)
    // Et la lisière est bien la bande du bord.
    expect(estLisiere(prof[5 * 48 + 5]!)).toBe(true)
    expect(estLisiere(prof[10 * 48 + 10]!)).toBe(false)
  })

  it('le champ PLAFONNE à PROF_CAP — jamais 0 au plus profond d\'une grande masse', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    bloc(map, 10, 10, 30)
    const prof = deriver(map)
    let max = 0
    for (const d of prof) if (d > max) max = d
    expect(max).toBe(CREUX.PROF_CAP)
    // Le centre exact porte le plafond, pas un zéro (le trou du BFS borné est le piège).
    expect(prof[25 * 64 + 25]).toBe(CREUX.PROF_CAP)
  })
})

describe('R40/R41 — le jeu par bande (couvert, vieux fût, repousse)', () => {
  /** Une sim sur carte synthétique : un massif 12×12 dont le cœur est en (15,15)-ish. */
  function simAvecMassif(): SimState {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    bloc(map, 10, 10, 12)
    map.profondeur = deriver(map)
    return createSim(1234, { map, faunaCap: 0, worldEvents: false })
  }

  it('A21 — le couvert du cœur est STRICTEMENT meilleur, la lisière garde le nominal', () => {
    const sim = simAvecMassif()
    const nominal = TERRAINS[TERRAIN_FOREST]!.cover
    expect(couvertEffectif(sim, 10, 10)).toBe(nominal) //  lisière : d = 1
    expect(couvertEffectif(sim, 15, 15)).toBeLessThan(nominal) // cœur (d ≥ 5)
    expect(couvertEffectif(sim, 30, 30)).toBe(TERRAINS[TERRAIN_GRASS]!.cover) // le pré : inerte
  })

  it('A21 — le bonus MEURT AVEC L\'ARBRE : brûlée, la tuile de cœur rend le couvert du brûlé', () => {
    const sim = simAvecMassif()
    sim.map.terrain[15 * 64 + 15] = TERRAIN_BURNT_FOREST // le feu a mangé le cœur
    expect(couvertEffectif(sim, 15, 15)).toBe(TERRAINS[TERRAIN_BURNT_FOREST]!.cover)
  })

  it('sans champ de profondeur (banc, carte d\'avant), tout est INERTE — le nominal partout', () => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    bloc(map, 10, 10, 12) //           pas de map.profondeur
    const sim = createSim(1234, { map, faunaCap: 0, worldEvents: false })
    expect(profondeurAt(sim.map, 15, 15)).toBe(0)
    expect(couvertEffectif(sim, 15, 15)).toBe(TERRAINS[TERRAIN_FOREST]!.cover)
    expect(stockDArbre(sim.map, 15, 15)).toBe(NODE_DEFS.tree.stock)
  })

  it('R40 — le vieux fût : majoré au cœur, nominal en lisière, JAMAIS en futaie ancienne', () => {
    const sim = simAvecMassif()
    const base = NODE_DEFS.tree.stock
    expect(stockDArbre(sim.map, 15, 15)).toBe(Math.round(base * CONTENU.VIEUX_FUT_FACTEUR))
    expect(stockDArbre(sim.map, 10, 10)).toBe(base) // lisière
    sim.map.terrain[15 * 64 + 15] = TERRAIN_OLD_GROWTH
    expect(stockDArbre(sim.map, 15, 15)).toBe(base) // la doctrine du teaser tient
  })

  it('A21 — le vieux fût SURVIT À LA REPOUSSE (fonction pure de la position, réappliquée)', () => {
    const sim = simAvecMassif()
    sim.nodes.push({ id: 9001, type: 'tree', tx: 15, ty: 15, stock: 0, regrowAt: 5 })
    sim.tick = 10
    advanceEconomy(sim)
    const arbre = sim.nodes.find((n) => n.id === 9001)!
    expect(arbre.stock).toBe(Math.round(NODE_DEFS.tree.stock * CONTENU.VIEUX_FUT_FACTEUR))
    expect(arbre.regrowAt).toBe(0)
  })
})
