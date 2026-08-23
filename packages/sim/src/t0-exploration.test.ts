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
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_HEATH,
  TERRAIN_LARCH,
  TERRAIN_MARSH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_REED_MARSH,
  TERRAIN_ROAD,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_WILLOW,
  TERRAIN_WET_MEADOW,
  TERRAIN_JUNIPER_HEATH,
  TERRAINS,
} from './balance'
import { createEmptyMap, profondeurAt } from './map'
import { fbm2 } from './noise'
import { capFor, POI_TYPES } from './poi'
import { composantesDeMasque, estCoeur, TERRAINS_BOISES_MASSIF } from './profondeur'
import { CREUX } from './racine-relief'
import { SET_PIECES } from './zonegen-setpieces'
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

/**
 * ═══ §2bis — LE MICRO-RELIEF MUET : une variable d'ORDRE commande les Prés Bas ═══
 *
 * A11 est LE critère du chantier du 2026-07-29, et il est écrit comme un RANG plutôt que comme
 * une distance : ce qui manquait à l'ancienne carte n'était pas « de l'eau plus près des bois »,
 * c'était **une relation**. Mesuré alors, sur trois seeds : bosquet 70/85/96, herbe 83/93/92,
 * fleuraie 76/92/103 — des nombres du même ordre, **et dont l'ordre s'inversait d'une seed à
 * l'autre** (seed 42 : l'herbe plus près de l'eau que le bosquet). Un seuil chiffré aurait pu
 * passer au vert par chance ; un RANG stable sur toutes les seeds, non.
 *
 * Et la garde prouve d'abord sa prémisse (A11a) : si les distances devenaient toutes égales —
 * une carte sans eau, un champ qu'on aurait débranché — les inégalités passeraient au vert
 * pour rien. On affirme donc AUSSI que les terrains sont vraiment séparés.
 */
describe('A11/A12 — la composition des Prés Bas suit UNE variable d’ordre', () => {
  /** Distance de chaque tuile de la Racine à l'eau la plus proche, en tuiles, au pas de 4.
   *  BFS multi-source 4-connexe (R23), à la maille grossière : 80× moins cher, et l'écart
   *  qu'on mesure se compte en dizaines de tuiles. */
  const distancesALEau = (c: CarteZonee): Map<number, number> => {
    const { width, height, terrain } = c.map
    const P = 4
    const W = Math.ceil(width / P)
    const H = Math.ceil(height / P)
    const dist = new Int32Array(W * H).fill(-1)
    let file: number[] = []
    for (let i = 0; i < width * height; i++) {
      if (c.zone[i] !== c.graphe.racine || !eau(terrain[i]!)) continue
      const k = Math.floor((i % width) / P) + Math.floor(Math.floor(i / width) / P) * W
      if (dist[k] === -1) { dist[k] = 0; file.push(k) }
    }
    for (let d = 0; file.length > 0; d++) {
      const suivante: number[] = []
      for (const k of file) {
        const kx = k % W
        const ky = (k - kx) / W
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = kx + dx
          const ny = ky + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const nk = ny * W + nx
          if (dist[nk] !== -1) continue
          dist[nk] = d + 1
          suivante.push(nk)
        }
      }
      file = suivante
    }
    // Moyenne par terrain, sur la terre marchable de la Racine.
    const somme = new Map<number, number>()
    const compte = new Map<number, number>()
    for (let i = 0; i < width * height; i++) {
      if (c.zone[i] !== c.graphe.racine) continue
      const t = terrain[i]!
      if (TERRAINS[t]?.walkable !== true) continue
      const k = Math.floor((i % width) / P) + Math.floor(Math.floor(i / width) / P) * W
      const d = dist[k]!
      if (d < 0) continue
      somme.set(t, (somme.get(t) ?? 0) + d * P)
      compte.set(t, (compte.get(t) ?? 0) + 1)
    }
    const moy = new Map<number, number>()
    for (const [t, n] of compte) if (n > 500) moy.set(t, somme.get(t)! / n)
    return moy
  }

  it('A11+A16 — le RANG à l’eau commande les SEPT mots : marais < roselière < prairie < bosquet < herbe < fleuraie < lande', () => {
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const d = distancesALEau(c)
      const de = (t: number, nom: string): number => {
        const v = d.get(t)
        expect(v, `seed ${seed} : pas assez de ${nom} pour mesurer`).toBeDefined()
        return v!
      }
      const marais = de(TERRAIN_MARSH, 'marais')
      const roseliere = de(TERRAIN_REED_MARSH, 'roselière')
      const prairie = de(TERRAIN_WET_MEADOW, 'prairie humide')
      const bosquet = de(TERRAIN_FOREST, 'bosquet')
      const herbe = de(TERRAIN_GRASS, 'herbe')
      const fleuraie = de(TERRAIN_FLOWER_MEADOW, 'fleuraie')
      const lande = de(TERRAIN_JUNIPER_HEATH, 'lande à genévriers')
      const saulaie = de(TERRAIN_WILLOW, 'saulaie')

      expect(marais, `seed ${seed} : marais < roselière`).toBeLessThan(roseliere)
      expect(roseliere, `seed ${seed} : roselière < prairie humide`).toBeLessThan(prairie)
      expect(prairie, `seed ${seed} : prairie humide < bosquet`).toBeLessThan(bosquet)
      expect(bosquet, `seed ${seed} : bosquet < herbe`).toBeLessThan(herbe)
      expect(herbe, `seed ${seed} : herbe < fleuraie`).toBeLessThan(fleuraie)
      // Le lien du bout sec est SERRÉ (seed 42 : 170,9 contre 171,1) et c'est attendu : loin
      // de l'eau, c'est le CREUX qui domine l'humidité — la distance à l'eau y est un proxy
      // qui sature. Le rang en HUMIDITÉ, lui, tient par construction (quantiles ordonnés).
      // Si un recalibrage retourne ce lien, c'est cette ligne qui doit crier — pas se taire.
      expect(fleuraie, `seed ${seed} : fleuraie < lande à genévriers`).toBeLessThan(lande)
      // La saulaie ne sort pas de l'échelle : elle DÉRIVE du réseau — collée à l'eau (§2ter).
      expect(saulaie, `seed ${seed} : saulaie < bosquet`).toBeLessThan(bosquet)

      // A11a — LA PRÉMISSE : les rangs ne valent que si les terrains sont VRAIMENT séparés.
      // Sur l'ancienne carte, ces cinq nombres tenaient dans une trentaine de tuiles et leur
      // ordre changeait avec la seed ; ici le pré sec est à plus de cent tuiles du bosquet.
      expect(fleuraie - bosquet, `seed ${seed} : la fleuraie doit être NETTEMENT plus sèche que le bosquet`)
        .toBeGreaterThan(60)
    }
  })

  it('A12 — la composition est un CONTRAT, pas un espoir (les seuils sont des quantiles)', () => {
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      let tot = 0
      const cpt = new Map<number, number>()
      for (let i = 0; i < width * height; i++) {
        if (c.zone[i] !== c.graphe.racine) continue
        tot++
        cpt.set(terrain[i]!, (cpt.get(terrain[i]!) ?? 0) + 1)
      }
      const part = (t: number): number => (100 * (cpt.get(t) ?? 0)) / tot
      // Fourchettes RÉ-ÉPINGLÉES le 2026-08-15 (vocabulaire du pré, spec §2ter A17) : les
      // trois mots neufs prennent ~13 points, surtout sur l'herbe. MESURÉ sur les trois
      // seeds de garde : bosquet 14-16, fleuraie 12-14,5, herbe 38-40, saulaie 1,6-2,1,
      // prairie 5,1-6, lande 5,4-7,3 — marges d'une composition qui reste un contrat.
      expect(part(TERRAIN_FOREST), `seed ${seed} : bosquet`).toBeGreaterThanOrEqual(12)
      expect(part(TERRAIN_FOREST), `seed ${seed} : bosquet`).toBeLessThanOrEqual(18)
      expect(part(TERRAIN_FLOWER_MEADOW), `seed ${seed} : fleuraie`).toBeGreaterThanOrEqual(9)
      expect(part(TERRAIN_FLOWER_MEADOW), `seed ${seed} : fleuraie`).toBeLessThanOrEqual(17)
      expect(part(TERRAIN_GRASS), `seed ${seed} : herbe`).toBeGreaterThanOrEqual(33)
      expect(part(TERRAIN_GRASS), `seed ${seed} : herbe`).toBeLessThanOrEqual(47)
      expect(part(TERRAIN_WILLOW), `seed ${seed} : saulaie`).toBeGreaterThanOrEqual(1)
      expect(part(TERRAIN_WILLOW), `seed ${seed} : saulaie`).toBeLessThanOrEqual(4)
      expect(part(TERRAIN_WET_MEADOW), `seed ${seed} : prairie humide`).toBeGreaterThanOrEqual(3)
      expect(part(TERRAIN_WET_MEADOW), `seed ${seed} : prairie humide`).toBeLessThanOrEqual(9)
      expect(part(TERRAIN_JUNIPER_HEATH), `seed ${seed} : lande à genévriers`).toBeGreaterThanOrEqual(3)
      expect(part(TERRAIN_JUNIPER_HEATH), `seed ${seed} : lande à genévriers`).toBeLessThanOrEqual(9)
      // Les Prés Bas restent un PRÉ : on s'y reconnaît à son CIEL (worldgen R7). L'herbe
      // seule ne porte plus ce contrat — c'est l'OUVERT qui le porte : herbe + fleuraie +
      // prairie humide + lande, tout ce qui laisse voir l'horizon.
      const ouvert = part(TERRAIN_GRASS) + part(TERRAIN_FLOWER_MEADOW)
        + part(TERRAIN_WET_MEADOW) + part(TERRAIN_JUNIPER_HEATH)
      expect(ouvert, `seed ${seed} : le pré reste OUVERT (le ciel se voit)`).toBeGreaterThanOrEqual(55)
    }
  })

  it('A13 — la Racine marchable reste d’UN SEUL TENANT : l’eau neuve n’enclave personne', () => {
    for (const { c } of mondes) {
      const { width, height, terrain } = c.map
      const vu = new Uint8Array(width * height)
      let plusGrande = 0
      let total = 0
      for (let i = 0; i < width * height; i++) {
        if (c.zone[i] !== c.graphe.racine || TERRAINS[terrain[i]!]?.walkable !== true) continue
        total++
        if (vu[i]) continue
        const q = [i]
        vu[i] = 1
        let n = 0
        for (let k = 0; k < q.length; k++) {
          const j = q[k]!
          n++
          const jx = j % width
          for (const v of [jx > 0 ? j - 1 : -1, jx + 1 < width ? j + 1 : -1, j - width, j + width]) {
            if (v < 0 || v >= width * height || vu[v] || c.zone[v] !== c.graphe.racine) continue
            if (TERRAINS[terrain[v]!]?.walkable !== true) continue
            vu[v] = 1
            q.push(v)
          }
        }
        if (n > plusGrande) plusGrande = n
      }
      // Une poignée de tuiles isolées derrière un lac serait tolérable ; un pays coupé en deux
      // ne l'est pas. On exige que la composante principale porte tout le pays, à 1 % près.
      expect(plusGrande / total, `seed ${c.graphe.seed} : la Racine est morcelée`).toBeGreaterThan(0.99)
    }
  })

  it('A14 — les BOSQUETS DE CRÊTE : un bois sec, nombreux, et PLUS LOIN de l’eau que le bois humide', () => {
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      const sec = (t: number): boolean => t === TERRAIN_PINE || t === TERRAIN_LARCH

      // ── LE COMPTE : des composantes 4-connexes de conifère, à la taille d’un vrai bois. ──
      const vu = new Uint8Array(width * height)
      const tailles: number[] = []
      for (let i = 0; i < width * height; i++) {
        if (vu[i] || c.zone[i] !== c.graphe.racine || !sec(terrain[i]!)) continue
        const q = [i]
        vu[i] = 1
        let n = 0
        for (let k = 0; k < q.length; k++) {
          const j = q[k]!
          n++
          const jx = j % width
          for (const v of [jx > 0 ? j - 1 : -1, jx + 1 < width ? j + 1 : -1, j - width, j + width]) {
            if (v < 0 || v >= width * height || vu[v] || c.zone[v] !== c.graphe.racine) continue
            if (!sec(terrain[v]!)) continue
            vu[v] = 1
            q.push(v)
          }
        }
        tailles.push(n)
      }
      // 400 tuiles = 20 de côté : en deçà c'est un buisson, pas un repère qu'on voit venir.
      const vrais = tailles.filter((n) => n >= 400)
      expect(vrais.length, `seed ${seed} : bosquets de crête (≥ 400 tuiles)`).toBeGreaterThanOrEqual(5)

      // ── « LOIN DES POINTS D’EAU » — et c'est un RANG, pas une distance écrite. ──
      // La demande d'Alexis était « loin de l'eau » ; l'implémentation la tient en exigeant que
      // le sommet soit dans la bande sèche de l'humidité, laquelle DÉRIVE de la distance à l'eau.
      // On affirme donc la DEMANDE (le bois sec est plus loin de l'eau que le bois humide), pas
      // le moyen — si demain le placement change de mécanisme, ce critère reste le bon.
      const d = distancesALEau(c)
      const humide = d.get(TERRAIN_FOREST)
      const pin = d.get(TERRAIN_PINE)
      const meleze = d.get(TERRAIN_LARCH)
      expect(humide, `seed ${seed} : pas assez de bosquet humide`).toBeDefined()
      expect(pin ?? meleze, `seed ${seed} : pas assez de conifère pour mesurer`).toBeDefined()
      for (const [nom, v] of [['pin', pin], ['mélèze', meleze]] as const) {
        if (v === undefined) continue
        expect(v, `seed ${seed} : le ${nom} doit être PLUS LOIN de l’eau que le bosquet humide`)
          .toBeGreaterThan(humide! * 3)
      }
    }
  })

  it('A16 — aucune eau douce dans l’EMPRISE d’un seuil (worldgen R10.3 : pas même à boire)', () => {
    for (const { c } of mondes) {
      const { width, height, terrain } = c.map
      // L'EMPRISE, c'est le COULOIR — les tuiles que `percerSeuil` a marquées `rampe`. Pas un
      // rayon de confort autour du point de seuil : `masqueDesSeuils` interdit déjà l'eau
      // dormante dans ce rayon, une garde qui le rebalaierait n'affirmerait que l'implémentation.
      // Ici on affirme la RÈGLE, et sur la seule surface qu'elle nomme. Une tuile d'eau suffit à
      // faire échouer : on ne boit pas dans une porte.
      let mouillees = 0
      for (let i = 0; i < width * height; i++) {
        if (c.rampe[i] !== 1) continue
        if (c.zone[i] !== c.graphe.racine) continue
        if (eau(terrain[i]!)) mouillees++
      }
      expect(mouillees, `seed ${c.graphe.seed} : un couloir de seuil a les pieds dans l’eau`).toBe(0)
    }
  })

  it('A15 (§2ter) — chaque mot du vocabulaire EXISTE, et la saulaie DÉRIVE : toute tuile colle à l’eau', () => {
    // La portée maximale de l'estampe ('RIPI') : au-delà, une tuile de saulaie n'a pas pu
    // naître de la dérivation — ce serait un semis déguisé.
    const PORTEE = Math.max(CREUX.RIPI_FIL_FRANGE, CREUX.RIPI_RU_FRANGE)
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      // Présence : un mot qui ne trouve pas ses tuiles est une ligne morte (patron d'A19).
      const cpt = new Map<number, number>()
      const saules: number[] = []
      for (let i = 0; i < width * height; i++) {
        if (c.zone[i] !== c.graphe.racine) continue
        const t = terrain[i]!
        cpt.set(t, (cpt.get(t) ?? 0) + 1)
        if (t === TERRAIN_WILLOW) saules.push(i)
      }
      expect(cpt.get(TERRAIN_WILLOW) ?? 0, `seed ${seed} : saulaie`).toBeGreaterThanOrEqual(2000)
      expect(cpt.get(TERRAIN_WET_MEADOW) ?? 0, `seed ${seed} : prairie humide`).toBeGreaterThanOrEqual(2000)
      expect(cpt.get(TERRAIN_JUNIPER_HEATH) ?? 0, `seed ${seed} : lande à genévriers`).toBeGreaterThanOrEqual(2000)

      // GARDE EXHAUSTIVE (mémoire de projet : balayer tout le domaine, une seule propriété) :
      // TOUTE tuile de saulaie est à ≤ PORTEE (Chebyshev) d'une tuile d'eau. C'est la
      // dérivation elle-même qu'on affirme, pas sa moyenne.
      for (const i of saules) {
        const x = i % width
        const y = (i - x) / width
        let proche = false
        for (let dy = -PORTEE; dy <= PORTEE && !proche; dy++) {
          for (let dx = -PORTEE; dx <= PORTEE; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            if (eau(terrain[ny * width + nx]!)) { proche = true; break }
          }
        }
        if (!proche) expect.fail(`seed ${seed} : saulaie orpheline en (${x}, ${y}) — à plus de ${PORTEE} tuiles de toute eau`)
      }
    }
  })

  it('A18 (§2ter) — les nœuds suivent les mots : futaie de saules, fibre et champignons des prairies, baies de la lande', () => {
    for (const { c, nodes } of mondes) {
      const seed = c.graphe.seed
      const { width, terrain } = c.map
      const sur = (t: number, type: string): number =>
        nodes.filter((n) => terrain[n.ty * width + n.tx] === t && n.type === type).length
      expect(sur(TERRAIN_WILLOW, 'tree'), `seed ${seed} : la saulaie est une FUTAIE — de vrais arbres à couper`).toBeGreaterThanOrEqual(200)
      expect(sur(TERRAIN_WET_MEADOW, 'fiber_plant'), `seed ${seed} : la prairie humide est LA place à fibre`).toBeGreaterThanOrEqual(300)
      expect(sur(TERRAIN_WET_MEADOW, 'champignon'), `seed ${seed} : la prairie humide porte des champignons`).toBeGreaterThanOrEqual(100)
      expect(sur(TERRAIN_JUNIPER_HEATH, 'berry_bush'), `seed ${seed} : la lande porte les baies du genévrier`).toBeGreaterThanOrEqual(50)
    }
  })

  it('A18bis (R34bis) — le commun a un ENDROIT : fibre à l\'humide, baies au bord, pierre au relief et aux pierriers', () => {
    // Seuils épinglés à la MESURE (3 seeds, vallée et monde joué) : fibre 66-69 %, baies
    // 69-74 %, pierre 88-89 % — contre 21/32/13 AVANT R34bis : la garde mord.
    const nom = (t: number): string => TERRAINS[t]?.name ?? ''
    const humide = (t: number): boolean => ['wet_meadow', 'willow', 'marsh', 'reed_marsh', 'peat_bog'].includes(nom(t))
    const lande = (t: number): boolean => ['juniper_heath', 'heath'].includes(nom(t))
    const rocheux = (t: number): boolean => ['rock', 'cliff', 'scree', 'boulders'].includes(nom(t))
    for (const { c, nodes } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      // Rayon ÉCRIT (2 = la portée d'un regard), indépendant de la constante réglable : une
      // garde écrite avec la constante qu'elle teste ne garde rien.
      const voisinage = (tx: number, ty: number, pred: (t: number) => boolean): boolean => {
        for (let y = ty - 2; y <= ty + 2; y++) {
          for (let x = tx - 2; x <= tx + 2; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue
            if (pred(terrain[y * width + x]!)) return true
          }
        }
        return false
      }
      const enNappe = (tx: number, ty: number): boolean =>
        fbm2(tx, ty, CONTENU.PIERRIER_ECHELLE, (seed ^ 0x50494552) | 0) > CONTENU.PIERRIER_SEUIL
      const part = (type: string, ok: (tx: number, ty: number, t: number) => boolean): number => {
        const dans = nodes.filter((n) => n.type === type && c.zone[n.ty * width + n.tx] === c.graphe.racine)
        if (dans.length === 0) return 0
        return dans.filter((n) => ok(n.tx, n.ty, terrain[n.ty * width + n.tx]!)).length / dans.length
      }
      const fibre = part('fiber_plant', (tx, ty, t) => humide(t) || voisinage(tx, ty, (u) => eau(u) || humide(u)))
      const baies = part('berry_bush', (tx, ty, t) => lande(t) || voisinage(tx, ty, (u) => TERRAINS_BOISES_MASSIF.includes(u)))
      const pierre = part('rock', (tx, ty, t) => lande(t) || voisinage(tx, ty, rocheux) || enNappe(tx, ty))
      expect(fibre, `seed ${seed} : ${(fibre * 100).toFixed(0)} % de fibre à l'humide/bord d'eau`).toBeGreaterThanOrEqual(0.55)
      expect(baies, `seed ${seed} : ${(baies * 100).toFixed(0)} % de baies au bord/lande`).toBeGreaterThanOrEqual(0.55)
      expect(pierre, `seed ${seed} : ${(pierre * 100).toFixed(0)} % de pierre au relief/lande/pierrier`).toBeGreaterThanOrEqual(0.75)
      // Et le pierrier reste un ENDROIT : si la nappe couvrait la racine, la part de pierre
      // « logique » serait verte par accident — « tout est pierrier » doit rougir.
      const { r, id } = racineDe(c)
      let nappe = 0
      let sol = 0
      for (let ty = Math.floor(r.y); ty < r.y + r.h; ty += 3) {
        for (let tx = Math.floor(r.x); tx < r.x + r.w; tx += 3) {
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
          const i = ty * width + tx
          if (c.zone[i] !== id || !TERRAINS[terrain[i]!]?.walkable) continue
          sol += 1
          if (enNappe(tx, ty)) nappe += 1
        }
      }
      expect(nappe / sol, `seed ${seed} : la nappe des pierriers couvre ${(100 * nappe / sol).toFixed(0)} % de la racine`).toBeLessThanOrEqual(0.35)
    }
  })

  it('A18ter (R34ter) — un biome n\'est pas un magasin : PLAFONDS de fibre, champignon et pierre là où ils saturaient', () => {
    // A18/A18bis gardent des PLANCHERS et des RAPPORTS : ni l'un ni l'autre ne peut rougir quand
    // un biome se pave. Ces quatre plafonds sont ce qui manquait — et ils sont écrits en DENSITÉ
    // (nœuds pour 100 tuiles du terrain), pas en compte : la garde survit à un monde qui change
    // de taille, ce qui a précisément périmé le « un tous les ~31 pas » de `CONTENU`.
    //
    // Seuils LITTÉRAUX (une garde écrite avec la constante qu'elle teste ne garde rien), posés
    // sur la mesure du 2026-08-23 (3 seeds, vallée) avec la marge d'un tiers. Ce qu'ils auraient
    // rougi la veille est entre parenthèses : la garde MORD.
    for (const { c, nodes } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      const slugDe = (i: number): string => {
        const z = c.zone[i]
        return z === undefined || z < 0 ? '' : (c.graphe.zones[z]?.def.slug ?? '')
      }
      const nomDe = (i: number): string => TERRAINS[terrain[i]!]?.name ?? ''
      const densite = (type: string, quoi: (i: number) => boolean): number => {
        let tuiles = 0
        for (let i = 0; i < width * height; i++) if (quoi(i)) tuiles += 1
        // La prémisse d'abord : sans le terrain, une densité de 0 serait verte pour rien.
        expect(tuiles, `seed ${seed} : le terrain visé n'existe pas — la garde ne prouve rien`).toBeGreaterThan(1000)
        const n = nodes.filter((x) => x.type === type && quoi(x.ty * width + x.tx)).length
        return (100 * n) / tuiles
      }
      const prairie = (i: number): boolean => nomDe(i) === 'wet_meadow'
      const chaos = (i: number): boolean => slugDe(i) === 'cendriere' && nomDe(i) === 'boulders'
      const brulee = (i: number): boolean => slugDe(i) === 'cendriere' && nomDe(i) === 'burnt_forest'

      const fibre = densite('fiber_plant', prairie)
      const champi = densite('champignon', prairie)
      const pierreChaos = densite('rock', chaos)
      const pierreBrulee = densite('rock', brulee)

      // PLAFONDS — ce qui saturait (mesuré la veille : 8,42 · 5,88 · 3,09 · 1,95).
      expect(fibre, `seed ${seed} : ${fibre.toFixed(2)} plants de fibre pour 100 tuiles de prairie humide`).toBeLessThanOrEqual(5.5)
      expect(champi, `seed ${seed} : ${champi.toFixed(2)} champignons pour 100 tuiles de prairie humide`).toBeLessThanOrEqual(2)
      expect(pierreChaos, `seed ${seed} : ${pierreChaos.toFixed(2)} rochers pour 100 tuiles du chaos de blocs`).toBeLessThanOrEqual(2)
      expect(pierreBrulee, `seed ${seed} : ${pierreBrulee.toFixed(2)} rochers pour 100 tuiles de forêt brûlée`).toBeLessThanOrEqual(1.3)

      // PLANCHERS — « j'ai tout supprimé » doit rougir aussi : chaque biome garde ce qui le dit.
      expect(fibre, `seed ${seed} : la prairie humide reste LA place à fibre`).toBeGreaterThan(2)
      expect(champi, `seed ${seed} : la prairie humide porte encore des champignons`).toBeGreaterThan(0.4)
      expect(pierreChaos, `seed ${seed} : un chaos de blocs porte de la pierre`).toBeGreaterThan(0.5)
      expect(pierreBrulee, `seed ${seed} : la forêt brûlée porte de la pierre`).toBeGreaterThan(0.3)
    }
  })

})

describe('A19 (§2quater) — la profondeur intra-massif se dérive et se mérite', () => {
  it('garde EXHAUSTIVE : boisé-Racine ⇒ d ≥ 1 et la récurrence d\'érosion tient ; 0 partout ailleurs ; des cœurs existent', () => {
    // La récurrence (d = 1 + min des 8 voisins, hors-masque = 0, plafonné à PROF_CAP) est
    // affirmée sur TOUTE la grille — pas un échantillon. Elle implique à elle seule que le
    // cœur se mérite : d ≥ PROF_COEUR exige une boule de Chebyshev pleine de rayon
    // PROF_COEUR − 1, soit (2·PROF_COEUR − 1)² tuiles de masse au moins.
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      const prof = c.map.profondeur
      expect(prof, `seed ${seed} : la carte ne porte pas son champ de profondeur`).toBeDefined()
      expect(prof!.length).toBe(width * height)
      const boise = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < width && y < height
        && c.zone[y * width + x] === c.graphe.racine
        && TERRAINS_BOISES_MASSIF.includes(terrain[y * width + x]!)
      let fautes = 0
      let premiere = ''
      let coeurs = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = prof![y * width + x]!
          let attendu = 0
          if (boise(x, y)) {
            let minV = Infinity
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue
                const v = boise(x + dx, y + dy) ? prof![(y + dy) * width + (x + dx)]! : 0
                if (v < minV) minV = v
              }
            }
            attendu = Math.min(minV + 1, CREUX.PROF_CAP)
          }
          if (d !== attendu) {
            fautes += 1
            if (!premiere) premiere = `seed ${seed} (${x},${y}) : ${d} au lieu de ${attendu}`
          }
          if (estCoeur(d)) coeurs += 1
        }
      }
      expect(fautes, premiere).toBe(0)
      expect(coeurs, `seed ${seed} : aucun massif assez grand pour un cœur`).toBeGreaterThan(0)
    }
  })
})

describe('A24-A26 (§2quinquies) — la couronne : élue, budgétée, d\'une seule masse', () => {
  it('A24 — la mort des tampons : la forme du Bois Noir est ORGANIQUE et varie d\'une seed à l\'autre', () => {
    const formes: string[] = []
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const bois = c.map.zones.find((z) => z.kind === 'bois_noir')!
      expect(bois, `seed ${seed} : pas de Bois Noir`).toBeDefined()
      formes.push(`${bois.w}x${bois.h}`)
      // Une bbox de tampon serait pleine à 100 % : l'organique ne l'est jamais.
      let corps = 0
      for (let y = bois.y; y < bois.y + bois.h; y++) {
        for (let x = bois.x; x < bois.x + bois.w; x++) {
          if (c.map.terrain[y * c.map.width + x] === TERRAIN_OLD_GROWTH) corps += 1
        }
      }
      const taux = corps / (bois.w * bois.h)
      expect(taux, `seed ${seed} : bbox pleine à ${(100 * taux).toFixed(0)} % — un tampon ?`).toBeLessThan(0.95)
      expect(taux, `seed ${seed} : bbox presque vide — la couronne s'est éparpillée`).toBeGreaterThan(0.2)
    }
    expect(new Set(formes).size, `les trois seeds rendent la même forme ${formes[0]} — un tampon déguisé`).toBeGreaterThan(1)
  })

  it('A25 — le budget est un CONTRAT : la futaie ancienne de la Racine fait exactement COURONNE_BOIS tuiles', () => {
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      let futaie = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (c.zone[i] === c.graphe.racine && terrain[i] === TERRAIN_OLD_GROWTH) futaie += 1
        }
      }
      expect(futaie, `seed ${seed} : ${futaie} tuiles de futaie ancienne`).toBe(SET_PIECES.COURONNE_BOIS)
    }
  })

  it('A26 — UNE seule masse ; la mare est un haut-fond niché dans la Combe ; le Cercle est sur la fleuraie du nord', () => {
    for (const { c } of mondes) {
      const seed = c.graphe.seed
      const { width, height, terrain } = c.map
      // Le Bois Noir est UNE composante 8-connexe (jamais deux lobes reliés par rien).
      const masque = new Uint8Array(width * height)
      for (let i = 0; i < masque.length; i++) {
        if (c.zone[i] === c.graphe.racine && terrain[i] === TERRAIN_OLD_GROWTH) masque[i] = 1
      }
      const comp = composantesDeMasque(masque, width, height)
      expect(comp.tailles.length, `seed ${seed} : le Bois Noir est en ${comp.tailles.length} morceaux`).toBe(1)
      // La mare : du haut-fond DANS la bbox de la Combe. (Le PROFOND d'un lac voisin a le
      // droit d'y paraître : la couronne humide grandit AUTOUR des eaux — c'est sa nature —
      // et l'anneau de R45 est déjà gardé par A2bis sur toute la Racine.)
      const combe = c.map.zones.find((z) => z.kind === 'combe_brumeuse')!
      let mare = 0
      for (let y = combe.y; y < combe.y + combe.h; y++) {
        for (let x = combe.x; x < combe.x + combe.w; x++) {
          if (terrain[y * width + x] === TERRAIN_SHALLOW_WATER) mare += 1
        }
      }
      expect(mare, `seed ${seed} : ${mare} tuiles de mare`).toBeGreaterThanOrEqual(SET_PIECES.MARE_BUDGET)
      // Le Cercle : centré sur la fleuraie, dans la bande nord.
      const cercle = c.map.zones.find((z) => z.kind === 'cercle_pierres')!
      const cx = Math.floor(cercle.x + cercle.w / 2)
      const cy = Math.floor(cercle.y + cercle.h / 2)
      const r = c.graphe.zones[c.graphe.racine]!.rect!
      expect(terrain[cy * width + cx], `seed ${seed} : le centre du Cercle n'est pas une fleuraie`).toBe(TERRAIN_FLOWER_MEADOW)
      expect(cy, `seed ${seed} : le Cercle hors de la bande nord`).toBeLessThan(r.y + SET_PIECES.CERCLE_NORD_FRAC * r.h + cercle.h)
    }
  })
})

describe('A4 (forêts-vivantes §4) — les coulées : couche → eau, dérivées, stériles', () => {
  it('≥ 1 coulée par seed ; chaque chemin part d\'un CŒUR et finit contre l\'eau ; toute tuile est saine', () => {
    for (const { c, nodes } of mondes) {
      const seed = c.graphe.seed
      const { width, terrain } = c.map
      const coulees = c.map.coulees
      expect(coulees, `seed ${seed} : aucune coulée`).toBeDefined()
      // Découpe en chemins (séparés par -1).
      const chemins: number[][] = [[]]
      for (const i of coulees!) {
        if (i < 0) chemins.push([])
        else chemins[chemins.length - 1]!.push(i)
      }
      expect(chemins[0]!.length, `seed ${seed} : liste vide`).toBeGreaterThan(0)
      const occupes = new Set(nodes.map((n) => n.ty * width + n.tx))
      for (const chemin of chemins) {
        // Le DÉPART touche le cœur : la première tuile est voisine du pic (d élevé).
        const d0 = profondeurAt(c.map, chemin[0]! % width, Math.floor(chemin[0]! / width))
        expect(d0, `seed ${seed} : un chemin part de d=${d0}`).toBeGreaterThanOrEqual(CREUX.PROF_COEUR - 1)
        // L'ARRIVÉE est contre l'eau : la dernière tuile (toujours enregistrée — la liste
        // dit le chemin entier) a une eau voisine orthogonale.
        const fin = chemin[chemin.length - 1]!
        const fx = fin % width
        const fy = Math.floor(fin / width)
        const boitLa = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const t = terrain[(fy + dy!) * width + (fx + dx!)]
          return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
        })
        expect(boitLa, `seed ${seed} : un chemin meurt loin de l'eau en (${fx},${fy})`).toBe(true)
        for (const i of chemin) {
          const t = terrain[i]!
          expect(TERRAINS[t]?.walkable, `seed ${seed} : coulée sur du non-marchable`).toBe(true)
          // (une tuile de SENTE peut être du chemin — le décal s'y interrompt, le fait reste)
          expect(c.zone[i], `seed ${seed} : coulée hors Racine`).toBe(c.graphe.racine)
          expect(occupes.has(i), `seed ${seed} : un nœud pousse sur la coulée (${i})`).toBe(false)
        }
      }
    }
  })
})
