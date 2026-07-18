/**
 * Décor cosmétique des biomes — couche PUREMENT visuelle, jamais dans /sim ni
 * dans les snapshots (INV-1 : aucune collision). Sélection déterministe par
 * tuile (INV-5) via bruit spatial (amas + trouées, INV-6) et affinité au
 * voisinage (roseaux près de l'eau, sous-bois de lisière). Le rendu/pooling
 * vit dans scenes/world/clutter-layer.ts ; ce module ne dépend PAS de Phaser.
 */
import {
  fbm2,
  hash2,
  TERRAIN_FOREST,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_LARCH,
  TERRAIN_BURNT_FOREST,
  TERRAIN_GRASS,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_HEATH,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_MARSH,
  TERRAIN_REED_MARSH,
  TERRAIN_PEAT_BOG,
  TERRAIN_SCREE,
  TERRAIN_BOULDERS,
  TERRAIN_SNOW,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
} from '@braises/sim'

export type PropKind =
  | 'conifer' | 'big_trunk' | 'stump' | 'fern' | 'pine' | 'larch' | 'burnt_trunk'
  | 'grass_tuft' | 'flower' | 'pebbles' | 'boulder' | 'low_bush' | 'bush'
  | 'reed' | 'sphagnum' | 'lichen' | 'snowdrift'

export interface PropInstance {
  kind: PropKind
  ox: number // décalage en fraction de tuile, ∈ (-0.5, 0.5)
  oy: number
  scale: number // multiplicateur d'échelle (~0.7..1.0)
  mirror: boolean
}

export type SampleTerrain = (tx: number, ty: number) => number

export interface BiomeClutter {
  density: number // fraction de tuiles portant un prop AU PIC d'amas
  scale: number // taille des massifs (tuiles) — signature du biome (INV-6)
  understory: boolean // 2e strate en couvert dense
  props: PropKind[]
  /**
   * LES BOSQUETS — une seconde couche, INDÉPENDANTE du semis principal : un prop précis (des
   * buissons dans le pré…) qui se GROUPE en taillis distincts au lieu de se mêler à l'herbe. Un
   * bruit basse fréquence dessine les taillis (`scale`), `seuil` décide leur emprise (haut = rares),
   * `density` leur épaisseur dedans. Absent = pas de bosquet.
   */
  groves?: { kind: PropKind; scale: number; seuil: number; density: number }
}

// Table de calibration — l'équivalent de balance.ts pour le feeling. Densités =
// ordres de grandeur, à affiner en playtest.
export const BIOME_CLUTTER: Record<number, BiomeClutter> = {
  // La forêt de la RACINE (le seul biome `forest` rendu tel quel : ailleurs les taches boisées
  // deviennent pins/mélèzes, tier > 0). PLUS DE CONIFÈRES NI DE SOUCHES DÉCORATIFS (demande
  // d'Alexis, 2026-07-18) : les arbres de cette forêt sont de VRAIS nœuds RÉCOLTABLES, denses,
  // posés côté sim (`arbresDeLaRacine`). Le clutter ne garde ici que les fougères du sous-bois,
  // qui habillent le sol entre les troncs qu'on coupe — fougères et buissons DODUS (2026-07-18).
  [TERRAIN_FOREST]: { density: 0.42, scale: 26, understory: false, props: ['fern', 'bush'] },
  [TERRAIN_OLD_GROWTH]: { density: 0.45, scale: 28, understory: true, props: ['big_trunk', 'fern'] },
  [TERRAIN_PINE]: { density: 0.4, scale: 22, understory: false, props: ['pine', 'grass_tuft', 'pebbles'] },
  [TERRAIN_LARCH]: { density: 0.35, scale: 20, understory: false, props: ['larch', 'grass_tuft'] },
  [TERRAIN_BURNT_FOREST]: { density: 0.4, scale: 22, understory: false, props: ['burnt_trunk', 'grass_tuft'] },
  // Le PRÉ (l'herbe) : touffes + fleurs, ET des BOSQUETS DE BUISSONS DODUS en taillis épars
  //  (demande d'Alexis, 2026-07-18 — comme dans la forêt, mais groupés en taillis sur la plaine).
  [TERRAIN_GRASS]: {
    density: 0.28, scale: 16, understory: false, props: ['grass_tuft', 'flower', 'pebbles'],
    groves: { kind: 'bush', scale: 38, seuil: 0.66, density: 0.5 },
  },
  [TERRAIN_FLOWER_MEADOW]: { density: 0.5, scale: 16, understory: false, props: ['flower', 'grass_tuft'] },
  [TERRAIN_HEATH]: { density: 0.42, scale: 14, understory: false, props: ['low_bush', 'pebbles'] },
  [TERRAIN_ALPINE_MEADOW]: { density: 0.3, scale: 15, understory: false, props: ['grass_tuft', 'flower', 'pebbles'] },
  [TERRAIN_ALPINE_FLOWERS]: { density: 0.5, scale: 15, understory: false, props: ['flower', 'grass_tuft'] },
  [TERRAIN_MARSH]: { density: 0.45, scale: 14, understory: false, props: ['reed', 'grass_tuft'] },
  [TERRAIN_REED_MARSH]: { density: 0.6, scale: 13, understory: false, props: ['reed'] },
  [TERRAIN_PEAT_BOG]: { density: 0.45, scale: 14, understory: false, props: ['sphagnum', 'reed'] },
  [TERRAIN_SCREE]: { density: 0.4, scale: 16, understory: false, props: ['pebbles', 'lichen'] },
  [TERRAIN_BOULDERS]: { density: 0.5, scale: 16, understory: false, props: ['boulder', 'lichen'] },
  [TERRAIN_SNOW]: { density: 0.2, scale: 18, understory: false, props: ['snowdrift', 'pebbles'] },
}

const CLUTTER_MEAN_SQ = 0.30 // ≈ E[fbm2²] — normalise le champ d'amas (moyenne ≈ 1)
const WATER = new Set<number>([TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER])
const REEDY = new Set<number>([TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_PEAT_BOG])
const WOODED = new Set<number>([TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH])

/** Distance de Chebyshev à la tuile d'eau la plus proche, plafonnée à `cap`. */
export function distToWater(tx: number, ty: number, sample: SampleTerrain, cap: number): number {
  for (let r = 0; r <= cap; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue // seulement l'anneau
        if (WATER.has(sample(tx + dx, ty + dy))) return r
      }
    }
  }
  return cap
}

/** Un des 4 voisins est-il un biome ouvert différent ? (lisière de forêt) */
function isForestEdge(tx: number, ty: number, sample: SampleTerrain): boolean {
  return !WOODED.has(sample(tx + 1, ty)) || !WOODED.has(sample(tx - 1, ty))
    || !WOODED.has(sample(tx, ty + 1)) || !WOODED.has(sample(tx, ty - 1))
}

/** Multiplicateur d'affinité réaliste selon le voisinage (INV-6). */
function affinity(terrain: number, tx: number, ty: number, sample: SampleTerrain): number {
  if (REEDY.has(terrain)) {
    const d = distToWater(tx, ty, sample, 3)
    return d === 0 ? 1.6 : d === 1 ? 1.3 : d === 2 ? 1.0 : 0.7 // roseaux collés à l'eau
  }
  if (WOODED.has(terrain)) return isForestEdge(tx, ty, sample) ? 1.35 : 1.0 // sous-bois de lisière
  return 1
}

function pick<T>(arr: T[], h: number): T {
  return arr[Math.floor(h * arr.length) % arr.length]!
}

function makePropKind(kind: PropKind, tx: number, ty: number, seed: number, slot: number): PropInstance {
  const h2 = hash2(tx, ty, (seed ^ (0x2000 + slot)) | 0)
  const h3 = hash2(tx, ty, (seed ^ (0x3000 + slot)) | 0)
  const h4 = hash2(tx, ty, (seed ^ (0x4000 + slot)) | 0)
  return {
    kind,
    ox: (h2 - 0.5) * 0.8, // ∈ (-0.4, 0.4)
    oy: (h3 - 0.5) * 0.8,
    scale: 0.7 + h4 * 0.3, // 0.7..1.0
    mirror: hash2(tx, ty, (seed ^ (0x5000 + slot)) | 0) < 0.5,
  }
}

function makeProp(cfg: BiomeClutter, tx: number, ty: number, seed: number, slot: number): PropInstance {
  const h1 = hash2(tx, ty, (seed ^ (0x1000 + slot)) | 0)
  return makePropKind(pick(cfg.props, h1), tx, ty, seed, slot)
}

export function clutterAt(
  tx: number,
  ty: number,
  terrain: number,
  seed: number,
  sample: SampleTerrain,
): PropInstance[] {
  const cfg = BIOME_CLUTTER[terrain]
  if (!cfg) return []
  const props: PropInstance[] = []

  // LES BOSQUETS — un taillis d'un prop précis (buissons du pré), groupé par un bruit basse
  // fréquence, INDÉPENDANT du semis principal : là où le champ dépasse le seuil, on est dans un
  // taillis, et une tuile sur `density` y porte le prop. D'où des touffes distinctes, pas un
  // saupoudrage. (Le tri de rendu s'occupe de les superposer proprement.)
  if (cfg.groves) {
    const gf = fbm2(tx, ty, cfg.groves.scale, (seed ^ 0x6ab3d5e1) | 0)
    if (gf > cfg.groves.seuil && hash2(tx, ty, (seed ^ 0x51df2c07) | 0) < cfg.groves.density) {
      props.push(makePropKind(cfg.groves.kind, tx, ty, seed, 2))
    }
  }

  // Champ d'amas (moyenne ≈ 1) → massifs pleins troués de clairières (INV-6).
  const field = fbm2(tx, ty, cfg.scale, (seed ^ 0x2b1c9f0d) | 0)
  const local = Math.min(
    1,
    cfg.density * ((field * field) / CLUTTER_MEAN_SQ) * affinity(terrain, tx, ty, sample),
  )
  const u = hash2(tx, ty, (seed ^ 0x77aa1133) | 0)
  if (u < local) {
    props.push(makeProp(cfg, tx, ty, seed, 0))
    if (cfg.understory && u < local * 0.45) props.push(makeProp(cfg, tx, ty, seed, 1))
  }
  return props
}
