/**
 * LES CRITÈRES DE `docs/specs/t0-exploration.md` — la Racine donne envie de marcher.
 *
 * A1-A7 se mesurent sur les VRAIES cartes de production (seeds 2026/7/42, les seeds de garde
 * maison) ; A8 se joue en headless sur des cartes synthétiques, au patron de
 * `poi-discovery.test.ts`. A9 (déterminisme) est déjà tenu par zonegen A12, qui régénère et
 * compare au bit près — les nouvelles passes sont dedans.
 */
import { describe, expect, it } from 'vitest'
import {
  POI,
  TERRAIN_BURNT_FOREST,
  TERRAIN_DEEP_WATER,
  TERRAIN_GRASS,
  TERRAIN_HEATH,
  TERRAIN_ROAD,
  TERRAIN_SHALLOW_WATER,
  TERRAINS,
} from './balance'
import { createEmptyMap } from './map'
import { capFor, POI_TYPES } from './poi'
import { CONTENU, placeZoneNodes } from './zone-content'
import { generateZonedTerrain, type CarteZonee } from './zonegen'
import { EAU, estUnCoude } from './zonegen-water'
import { createSim, spawnEntity, step, type SimState } from './sim'
import type { ResourceNode } from './economy'

const SEEDS = [2026, 7, 42]

interface Monde {
  c: CarteZonee
  nodes: ResourceNode[]
}

const mondes: Monde[] = SEEDS.map((seed) => {
  const c = generateZonedTerrain(seed)
  return { c, nodes: placeZoneNodes(c) }
})

const eau = (t: number): boolean => t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER

/** Les tuiles de la Racine (index), et son rectangle. */
function racineDe(c: CarteZonee) {
  const r = c.graphe.zones[c.graphe.racine]!.rect!
  return { r, id: c.graphe.racine }
}

describe('A1 — les repères et les endroits de la Racine existent, espacés', () => {
  it('les comptes : chêne, tour, pierres, cercle, bois, combe, ruines', () => {
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const compte = (kind: string) => c.map.zones.filter((z) => z.kind === kind).length
      expect(compte('chene'), `seed ${seed} : chêne`).toBe(1)
      expect(compte('tour_guet'), `seed ${seed} : tour de guet`).toBe(1)
      // Le plafond des pierres SUIT LA SURFACE (capFor : la rareté est une densité) — sur la
      // carte de production (1,7× la surface de référence), la chaîne a droit à plus de maillons.
      const pierre = POI_TYPES.find((t) => t.slug === 'pierre_levee')!
      expect(compte('pierre_levee'), `seed ${seed} : pierres levées`).toBeGreaterThanOrEqual(2)
      expect(compte('pierre_levee'), `seed ${seed} : pierres levées`).toBeLessThanOrEqual(capFor(c.map, pierre))
      expect(compte('cercle_pierres'), `seed ${seed} : cercle`).toBe(1)
      expect(compte('bois_noir'), `seed ${seed} : bois noir`).toBe(1)
      expect(compte('combe_brumeuse'), `seed ${seed} : combe`).toBe(1)
      expect(compte('ferme_ruinee'), `seed ${seed} : ferme ruinée`).toBeGreaterThanOrEqual(1)
      expect(compte('charrette'), `seed ${seed} : charrette`).toBeGreaterThanOrEqual(1)
    }
  })

  it('les repères hauts sont deux à deux écartés d’au moins 90 tuiles', () => {
    for (const { c } of mondes) {
      const hauts = c.map.zones.filter((z) =>
        z.kind === 'chene' || z.kind === 'tour_guet' || z.kind === 'pierre_levee' || z.kind === 'cercle_pierres',
      )
      for (let i = 0; i < hauts.length; i++) {
        for (let j = i + 1; j < hauts.length; j++) {
          const a = hauts[i]!
          const b = hauts[j]!
          const ddx = a.x + a.w / 2 - b.x - b.w / 2
          const ddy = a.y + a.h / 2 - b.y - b.h / 2
          const d = Math.sqrt(ddx * ddx + ddy * ddy)
          expect(d, `seed ${c.graphe.seed} : ${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(90)
        }
      }
    }
  })
})

describe('A2/A3 — la rivière traverse, son profond ne touche jamais la terre, les gués existent', () => {
  it('A2 — une composante d’eau court du nord au sud de la Racine', () => {
    for (const { c } of mondes) {
      const { r } = racineDe(c)
      const { width, terrain } = c.map
      // Toutes les composantes 4-connexes d'eau ; la plus étendue en HAUTEUR doit couvrir
      // au moins 55 % du rectangle — un archipel ne fait pas ça, seule la rivière le peut.
      const vu = new Uint8Array(c.map.width * c.map.height)
      let meilleure = 0
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i0 = y * width + x
          if (vu[i0] || !eau(terrain[i0]!)) continue
          let minY = y
          let maxY = y
          const file = [i0]
          vu[i0] = 1
          while (file.length) {
            const i = file.pop()!
            const ix = i % width
            const iy = (i - ix) / width
            if (iy < minY) minY = iy
            if (iy > maxY) maxY = iy
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const j = (iy + dy) * width + ix + dx
              if (vu[j] || !eau(terrain[j] ?? -1)) continue
              vu[j] = 1
              file.push(j)
            }
          }
          meilleure = Math.max(meilleure, maxY - minY)
        }
      }
      expect(meilleure, `seed ${c.graphe.seed} : la rivière ne traverse pas`).toBeGreaterThanOrEqual(0.55 * r.h)
    }
  })

  it('A2bis — dans la RACINE, aucune tuile profonde ne touche la terre marchable (R45)', () => {
    // L'invariant de l'anneau est celui de l'eau des Prés Bas (worldgen R45). Le Lac Mort, lui,
    // pose SON profond ceint de marais À DESSEIN (« on n'y entre pas, on en fait le tour ») —
    // il est hors du champ de cette garde.
    for (const { c } of mondes) {
      const { width, height, terrain } = c.map
      let fautes = 0
      for (let i = 0; i < width * height; i++) {
        if (terrain[i] !== TERRAIN_DEEP_WATER || c.zone[i] !== c.graphe.racine) continue
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const t = terrain[ny * width + nx]!
          if (TERRAINS[t]?.walkable === true && !eau(t)) fautes++
        }
      }
      expect(fautes, `seed ${c.graphe.seed} : du profond au contact de la terre sèche`).toBe(0)
    }
  })

  it('A2ter — le COUDE est ÉQUERRÉ : plus de langue de terre au coin extérieur', () => {
    // Le lit se peint en bandes perpendiculaires au fil : au virage, chaque bras s'arrêtait au
    // pivot et le quart extérieur n'appartenait à aucun des deux — un bloc de 3×4 tuiles sèches
    // planté dans le coin de CHAQUE coude (MESURÉ le 2026-07-26 : 275/336 tuiles sèches sur la
    // seed 2026, portée de l'eau sur la diagonale extérieure médiane 0,00 t contre 4,24 dedans).
    //
    // Le prédicat n'est PAS « les 12 tuiles sont mouillées » : `poser` refuse de noyer un mur,
    // de sortir de la Racine, et un couloir de seuil (`rampe`) rouvre l'eau en terre à dessein.
    // Ce qui ne doit PLUS jamais s'y trouver, c'est de la TERRE MARCHABLE de la Racine.
    for (const { c } of mondes) {
      const { width, height, terrain } = c.map
      const fil = c.map.fil
      expect(fil, `seed ${c.graphe.seed} : la carte n'a pas de fil de rivière`).toBeDefined()
      const DEMI = EAU.RIVIERE_DEMI_LIT
      const fautifs: string[] = []
      let coudes = 0
      for (let k = EAU.RIVIERE_BOUCHE; k + 1 < fil!.length - EAU.RIVIERE_BOUCHE; k++) {
        if (!estUnCoude(fil!, k, width)) continue
        coudes++
        const bx = fil![k]! % width
        const by = (fil![k]! - bx) / width
        const ax = fil![k - 1]! % width
        const ay = (fil![k - 1]! - ax) / width
        const cx = fil![k + 1]! % width
        const cy = (fil![k + 1]! - cx) / width
        const din = [bx - ax, by - ay]
        const dout = [cx - bx, cy - by]
        // Le coin EXTÉRIEUR : { pivot + a·din − b·dout }, a ∈ [1,DEMI], b ∈ [0,DEMI].
        for (let a = 1; a <= DEMI; a++) {
          for (let b = 0; b <= DEMI; b++) {
            const x = bx + a * din[0]! - b * dout[0]!
            const y = by + a * din[1]! - b * dout[1]!
            if (x < 0 || y < 0 || x >= width || y >= height) continue
            const i = y * width + x
            if (c.zone[i] !== c.graphe.racine) continue // hors Racine : la rivière n'y va pas
            if (c.rampe[i]) continue // couloir de seuil : la porte gagne (ordre des passes)
            const t = terrain[i]!
            if (eau(t)) continue
            if (TERRAINS[t]?.walkable !== true) continue // un mur ne se noie pas
            fautifs.push(`(${x},${y})=${TERRAINS[t]?.name}`)
          }
        }
      }
      expect(coudes, `seed ${c.graphe.seed} : aucun coude à vérifier`).toBeGreaterThan(0)
      expect(
        fautifs.slice(0, 12),
        `seed ${c.graphe.seed} : ${fautifs.length} tuiles de terre au coin extérieur d'un coude`,
      ).toEqual([])
    }
  })

  it('A3 — au moins deux Gués nommés, et FRANCHISSABLES (pas de gué fantôme)', () => {
    // La revue a trouvé un « le Gué » posé sur du profond (le forçage tombait dans un
    // lac-perle et enregistrait sans avoir percé) : le toponyme ne suffit pas, on vérifie
    // que le CENTRE du gué est de l'eau qui se traverse — ou du sol.
    for (const { c } of mondes) {
      const gues = c.map.zones.filter((z) => z.name === 'le Gué')
      expect(gues.length, `seed ${c.graphe.seed}`).toBeGreaterThanOrEqual(2)
      for (const q of gues) {
        const t = c.map.terrain[(q.y + 3) * c.map.width + (q.x + 3)]!
        expect(TERRAINS[t]?.walkable, `seed ${c.graphe.seed} : gué infranchissable en (${q.x + 3}, ${q.y + 3})`).toBe(true)
      }
    }
  })

  it('A7bis — aucune sente ne traverse un set-piece (R18 : la route les contourne)', () => {
    for (const { c } of mondes) {
      const { width } = c.map
      for (const kind of ['bois_noir', 'cercle_pierres', 'combe_brumeuse']) {
        const z = c.map.zones.find((q) => q.kind === kind)!
        let routes = 0
        for (let y = z.y; y < z.y + z.h; y++) {
          for (let x = z.x; x < z.x + z.w; x++) {
            if (c.map.terrain[y * width + x] === TERRAIN_ROAD) routes++
          }
        }
        expect(routes, `seed ${c.graphe.seed} : ${routes} tuiles de route dans ${z.name}`).toBe(0)
      }
    }
  })

  it('A3bis — la Racine est d’un seul tenant : la rivière ne coupe personne', () => {
    for (const { c } of mondes) {
      const { r, id } = racineDe(c)
      const { width, terrain } = c.map
      // Flood-fill marchable depuis le premier point sec de la Racine ; on doit atteindre
      // ≥ 95 % de ses tuiles marchables (les poches < POCHE_MIN sont du décor, pas un défaut).
      let total = 0
      let depart = -1
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = y * width + x
          if (c.zone[i] !== id || TERRAINS[terrain[i]!]?.walkable !== true) continue
          total++
          if (depart < 0 && !eau(terrain[i]!)) depart = i
        }
      }
      const vu = new Uint8Array(c.map.width * c.map.height)
      vu[depart] = 1
      const file = [depart]
      let atteints = 0
      while (file.length) {
        const i = file.pop()!
        atteints++
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = (y + dy) * width + x + dx
          if (vu[j] || c.zone[j] !== id || TERRAINS[terrain[j] ?? 0]?.walkable !== true) continue
          vu[j] = 1
          file.push(j)
        }
      }
      expect(atteints / total, `seed ${c.graphe.seed}`).toBeGreaterThanOrEqual(0.95)
    }
  })
})

describe('A5 — la lisière sud brûle à vue, et SEULEMENT elle', () => {
  it('la bande [0,40] est majoritairement lande+calciné ; au-delà de 70, le pré reprend', () => {
    for (const { c } of mondes) {
      const { r, id } = racineDe(c)
      const { width, terrain } = c.map
      const sud = r.y + r.h
      let bandeTotal = 0
      let bandeBrule = 0
      let loinTotal = 0
      let loinBrule = 0
      for (let y = r.y; y < sud; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = y * width + x
          if (c.zone[i] !== id) continue
          const t = terrain[i]!
          if (!TERRAINS[t]?.walkable || eau(t) || t === TERRAIN_ROAD) continue
          const d = sud - y
          const brule = t === TERRAIN_HEATH || t === TERRAIN_BURNT_FOREST
          if (d <= 40) {
            bandeTotal++
            if (brule) bandeBrule++
          } else if (d > 70) {
            loinTotal++
            if (brule) loinBrule++
          }
        }
      }
      expect(bandeBrule / Math.max(1, bandeTotal), `seed ${c.graphe.seed} : la bande ne brûle pas`).toBeGreaterThanOrEqual(0.5)
      expect(loinBrule / Math.max(1, loinTotal), `seed ${c.graphe.seed} : la lisière déborde`).toBeLessThanOrEqual(0.05)
    }
  })
})

describe('A6 — les sentes relient les seuils de la Racine', () => {
  it('depuis chaque seuil, la route (et ses gués) mène à un autre seuil', () => {
    for (const { c } of mondes) {
      const { id } = racineDe(c)
      const { width, height, terrain } = c.map
      const seuils = c.graphe.seuils.filter((s) => s.a === id || s.b === id)
      expect(seuils.length, `seed ${c.graphe.seed}`).toBeGreaterThanOrEqual(2)

      // La tuile de route la plus proche de chaque seuil (dans un rayon de 45).
      const routeProche = (sx: number, sy: number): number => {
        let best = -1
        let bestD = 45 * 45
        const y0 = Math.max(0, sy - 45)
        const y1 = Math.min(height - 1, sy + 45)
        const x0 = Math.max(0, sx - 45)
        const x1 = Math.min(width - 1, sx + 45)
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (terrain[y * width + x] !== TERRAIN_ROAD) continue
            const d = (x - sx) * (x - sx) + (y - sy) * (y - sy)
            if (d < bestD) { bestD = d; best = y * width + x }
          }
        }
        return best
      }
      const departs = seuils.map((s) => routeProche(s.x, s.y))
      for (let k = 0; k < departs.length; k++) {
        expect(departs[k], `seed ${c.graphe.seed} : le seuil ${k} n'a pas de sente à sa bouche`).toBeGreaterThanOrEqual(0)
      }

      // BFS sur route ∪ eau peu profonde depuis la sente du premier seuil : tous les départs
      // doivent être dans la même composante — le réseau est UN réseau.
      const franchit = (t: number): boolean => t === TERRAIN_ROAD || t === TERRAIN_SHALLOW_WATER
      const vu = new Uint8Array(width * height)
      const file = [departs[0]!]
      vu[departs[0]!] = 1
      while (file.length) {
        const i = file.pop()!
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (vu[j] || !franchit(terrain[j]!)) continue
          vu[j] = 1
          file.push(j)
        }
      }
      for (let k = 1; k < departs.length; k++) {
        expect(vu[departs[k]!], `seed ${c.graphe.seed} : le seuil ${k} est coupé du réseau`).toBe(1)
      }
    }
  })
})

describe('A7 — rien ne pousse là où ça roule ; les set-pieces sont pleins', () => {
  it('aucun nœud sur une sente ni une rampe', () => {
    for (const { c, nodes } of mondes) {
      const { width } = c.map
      const fautifs = nodes.filter((n) => {
        const i = n.ty * width + n.tx
        return c.rampe[i] === 1 || c.map.terrain[i] === TERRAIN_ROAD
      })
      expect(fautifs, `seed ${c.graphe.seed}`).toHaveLength(0)
    }
  })

  it('le Bois Noir est une futaie, et il porte UN vieil arbre dérisoire', () => {
    for (const { c, nodes } of mondes) {
      const bois = c.map.zones.find((z) => z.kind === 'bois_noir')!
      const dedans = (n: ResourceNode) =>
        n.tx >= bois.x && n.tx < bois.x + bois.w && n.ty >= bois.y && n.ty < bois.y + bois.h
      const arbres = nodes.filter((n) => n.type === 'tree' && dedans(n))
      const vieux = nodes.filter((n) => n.type === 'old_tree' && dedans(n))
      expect(arbres.length, `seed ${c.graphe.seed} : le Bois Noir est clairsemé`).toBeGreaterThanOrEqual(60)
      expect(vieux, `seed ${c.graphe.seed}`).toHaveLength(1)
      expect(vieux[0]!.stock).toBe(CONTENU.TEASER_STOCK)
    }
  })

  it('la Combe brumeuse porte ses champignons', () => {
    for (const { c, nodes } of mondes) {
      const combe = c.map.zones.find((z) => z.kind === 'combe_brumeuse')!
      const dedans = nodes.filter(
        (n) => n.type === 'champignon'
          && n.tx >= combe.x && n.tx < combe.x + combe.w && n.ty >= combe.y && n.ty < combe.y + combe.h,
      )
      expect(dedans.length, `seed ${c.graphe.seed}`).toBeGreaterThanOrEqual(10)
    }
  })
})

// ── A8 : les charges payent — en headless, au patron de poi-discovery.test.ts ──

function simWith(zones: { name: string; x: number; y: number; w: number; h: number; kind?: string }[]) {
  const map = createEmptyMap(1200, 1200, TERRAIN_GRASS)
  map.zones.push(...zones)
  const state = createSim(1, { map })
  const playerId = spawnEntity(state, 0.5, 0.5)
  return { state, playerId }
}

function walkTo(state: SimState, playerId: number, x: number, y: number) {
  const p = state.entities.find((e) => e.id === playerId)!
  p.x = x
  p.y = y
  state.events.length = 0
  step(state, [])
}

const OUT = POI.SIGHT_TILES * 3

describe('A8 — les charges des nouveaux repères', () => {
  it('la Tour de guet révèle les lieux du rayon, et aucun au-delà', () => {
    const { state, playerId } = simWith([
      { name: 'la Tour de guet effondrée', x: 500, y: 500, w: 3, h: 3, kind: 'tour_guet' }, // poiId 0
      { name: 'le Gisement I', x: 500 + POI.REVEAL_TOUR_TILES - 20, y: 500, w: 2, h: 2, kind: 'gisement' }, // 1 : dedans
      { name: 'le Gisement II', x: 500, y: 500 + POI.REVEAL_TOUR_TILES + 40, w: 2, h: 2, kind: 'gisement' }, // 2 : dehors
    ])
    walkTo(state, playerId, 501, 501)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toContain(0)
    expect(known).toContain(1)
    expect(known).not.toContain(2)
  })

  it('une Pierre levée révèle la pierre inconnue la plus proche — et RIEN d’autre', () => {
    const { state, playerId } = simWith([
      { name: 'la Pierre levée I', x: 300, y: 300, w: 2, h: 2, kind: 'pierre_levee' }, //  0
      { name: 'la Pierre levée II', x: 300 + OUT * 2, y: 300, w: 2, h: 2, kind: 'pierre_levee' }, // 1 : la plus proche
      { name: 'le Cercle de pierres', x: 300 + OUT * 4, y: 300, w: 24, h: 24, kind: 'cercle_pierres' }, // 2 : plus loin
      { name: 'le Gisement I', x: 300, y: 300 + OUT * 2, w: 2, h: 2, kind: 'gisement' }, // 3 : pas une pierre
    ])
    walkTo(state, playerId, 301, 301)
    const known = state.entities.find((e) => e.id === playerId)!.knownPois
    expect(known).toContain(0)
    expect(known).toContain(1) // la chaîne : le prochain maillon
    expect(known).not.toContain(2) // jamais toute la carte d'un coup
    expect(known).not.toContain(3) // un menhir ne parle pas des mines
  })

  it('la chaîne mène AU CERCLE : la dernière pierre le révèle, et il se raconte', () => {
    const { state, playerId } = simWith([
      { name: 'la Pierre levée I', x: 300, y: 300, w: 2, h: 2, kind: 'pierre_levee' }, //  0
      { name: 'le Cercle de pierres', x: 300 + OUT * 2, y: 300, w: 24, h: 24, kind: 'cercle_pierres' }, // 1
    ])
    walkTo(state, playerId, 301, 301)
    expect(state.entities.find((e) => e.id === playerId)!.knownPois).toContain(1)
    // L'atteindre écrit une ligne : `poi_first_visit`, que la chronique formatera (devise récit).
    walkTo(state, playerId, 300 + OUT * 2 + 5, 305) // au cœur du Cercle
    expect(state.events.filter((e) => e.type === 'poi_first_visit' && e.poiId === 1)).toHaveLength(1)
  })

  it('aucun des nouveaux lieux n’ajoute d’item (lieux.md A9 étendu)', () => {
    const { state, playerId } = simWith([
      { name: 'la Tour de guet effondrée', x: 300, y: 300, w: 3, h: 3, kind: 'tour_guet' },
      { name: 'la Pierre levée I', x: 400, y: 400, w: 2, h: 2, kind: 'pierre_levee' },
      { name: 'le Cercle de pierres', x: 500, y: 500, w: 24, h: 24, kind: 'cercle_pierres' },
      { name: 'le Bois Noir', x: 600, y: 600, w: 48, h: 40, kind: 'bois_noir' },
      { name: 'la Combe brumeuse', x: 700, y: 700, w: 40, h: 32, kind: 'combe_brumeuse' },
      { name: 'la Ferme ruinée', x: 800, y: 800, w: 4, h: 4, kind: 'ferme_ruinee' },
      { name: 'la Charrette abandonnée', x: 900, y: 900, w: 2, h: 2, kind: 'charrette' },
    ])
    const avant = JSON.stringify(state.entities.find((e) => e.id === playerId)!.inventory)
    for (const z of state.map.zones) walkTo(state, playerId, z.x + 1, z.y + 1)
    expect(JSON.stringify(state.entities.find((e) => e.id === playerId)!.inventory)).toBe(avant)
  })
})
