/**
 * Le substrat alpin (SP1a) — champ d'élévation, d'humidité, et bandes de terrain
 * façon Whittaker. Pur et déterministe (noise.ts, arithmétique autorisée). Pas
 * d'hydrologie ni de features ici (SP1b). Toutes les échelles/amplitudes sont des
 * fractions de min(width,height) → scalable à toute taille.
 */
import { fbm2, fbmWarp2, hash2, ridgedFbm2 } from './noise'
import { createEmptyMap, type WorldMap } from './map'
import { sealBorderRing } from './valleygen'
import { carveHydrology } from './alpine-hydro'
import { placePois } from './poi'
import {
  TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_SCREE, TERRAIN_ROCK, TERRAIN_SNOW,
  TERRAIN_HEATH, TERRAIN_ALPINE_MEADOW, TERRAIN_PINE, TERRAIN_LARCH,
  TERRAIN_GLACIER, TERRAIN_BOULDERS, TERRAIN_FLOWER_MEADOW, TERRAIN_PEAT_BOG,
  TERRAIN_REED_MARSH, TERRAIN_ALPINE_FLOWERS, TERRAIN_BURNT_FOREST, TERRAIN_OLD_GROWTH,
  TERRAIN_SHALLOW_WATER, TERRAINS,
} from './balance'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Constantes de forme du relief — contenu de carte, réglées à la vignette.
 *  Le principe : une FORME DE VALLÉE macro (fond bas → murs hauts, dérivée de la
 *  distance au bord) donne la composition ; le bruit/les crêtes n'ajoutent que du
 *  détail organique par-dessus. Sans ça, l'intérieur est un bruit isotrope sans
 *  vallée (leçon vignette #1). */
export const ALPINE = {
  RIM_FRAC: 0.05,      // épaisseur de l'anneau de pics (fraction de min(W,H))
  RISE_FRAC: 0.62,     // à quelle fraction du demi-min les murs atteignent le sommet
                       //  (petit = fond large ; ~0.6 = « entre les deux »)
  ORGANIC_FRAC: 0.42,  // échelle du bruit macro qui brise le bol en vallée organique
  ORGANIC_AMP: 0.42,   // amplitude de cette déformation (spurs, combes, cols)
  DETAIL_FRAC: 0.14,   // échelle du détail de pente
  DETAIL_AMP: 0.16,    // amplitude du détail
  RIDGE_FRAC: 0.24,    // échelle des arêtes ridged
  RIDGE_AMP: 0.30,     // amplitude des crêtes (sur les pentes)
  WARP_FRAC: 0.06,     // amplitude de domain warping
  HILL_FRAC: 0.02,     // vallons À L'ÉCHELLE DU JEU (~24 tuiles) : le relief qu'on
                       //  voit en marchant (le reste est trop basse fréquence)
  HILL_AMP: 0.1,       // amplitude des vallons (dosée : trop = biomes mouchetés + repli)
}

export function computeElevation(width: number, height: number, seed: number): number[] {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const rise = D * 0.5 * ALPINE.RISE_FRAC
  const organic = D * ALPINE.ORGANIC_FRAC
  const detailScale = D * ALPINE.DETAIL_FRAC
  const ridge = D * ALPINE.RIDGE_FRAC
  const hill = D * ALPINE.HILL_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const el = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sud EXCLU (grand y = bord bas = vers la caméra) : la vallée s'ouvre de ce
      // côté, ni forme de vallée ni enceinte n'y montent → zéro repli du warp
      // (spec relief-continu §3). Fermeture sud = bord de carte (déjà bornant).
      const edge = Math.min(x, y, width - 1 - x)
      // Forme de vallée macro : 1 au bord (murs/pics) → 0 au fond (edge ≥ rise).
      const valley = 1 - Math.min(1, edge / rise)
      // Brise le bol concentrique → vallée organique (éperons, combes, cols).
      const org = ALPINE.ORGANIC_AMP * (fbmWarp2(x, y, organic, (seed ^ 0x1a2b3c) | 0, warp) - 0.5)
      // Détail de pente + arêtes ridged (petite amplitude, texture sur les murs).
      const detail = ALPINE.DETAIL_AMP * (fbmWarp2(x, y, detailScale, (seed ^ 0x4d5e6f) | 0, warp) - 0.5)
      const crest = ALPINE.RIDGE_AMP * (ridgedFbm2(x, y, ridge, (seed ^ 0x7a8b9c) | 0) - 0.4)
      // Vallons à l'échelle du jeu : le relief que le warp/l'ombre rendent visible
      // en se baladant (les autres octaves varient sur des centaines de tuiles).
      const bumps = ALPINE.HILL_AMP * (fbmWarp2(x, y, hill, (seed ^ 0x2c3d4e) | 0, warp) - 0.5)
      let h = valley + org + detail + crest + bumps
      const rim = clamp01((rimDepth - edge) / rimDepth) // enceinte : bord toujours haut
      h = Math.max(rim, h)
      el[y * width + x] = clamp01(h)
    }
  }
  return el
}

/**
 * Champ d'ÉCOULEMENT — la forme de vallée macro (enceinte + fond + organique)
 * SANS le détail ni les crêtes. L'eau le suit sans se piéger dans les micro-pits
 * du relief fin ; l'hydrologie (SP1b) trace dessus, puis creuse dans le terrain
 * réel. Même valley/org/rim que computeElevation → cohérent avec le relief.
 */
export function computeFlowField(width: number, height: number, seed: number): number[] {
  const D = Math.min(width, height)
  const rimDepth = Math.max(2, Math.round(D * ALPINE.RIM_FRAC))
  const rise = D * 0.5 * ALPINE.RISE_FRAC
  const organic = D * ALPINE.ORGANIC_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const f = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sud EXCLU (mêmes raisons que computeElevation) : hydrologie cohérente
      // avec un relief qui s'ouvre vers la caméra.
      const edge = Math.min(x, y, width - 1 - x)
      const valley = 1 - Math.min(1, edge / rise)
      const org = ALPINE.ORGANIC_AMP * (fbmWarp2(x, y, organic, (seed ^ 0x1a2b3c) | 0, warp) - 0.5)
      const rim = clamp01((rimDepth - edge) / rimDepth)
      // PAS de clamp/max ici : ce champ ne sert qu'à LOCALISER (lac = min, tête de
      // vallée = max). Clamper le fond à 0 créait une vaste zone plate d'où le min
      // sortait toujours au même endroit (nord). `valley+org+rim` a un vrai minimum
      // unique (org le plus négatif dans le fond) qui varie avec la seed ; le rim
      // ne fait que rehausser le bord.
      f[y * width + x] = valley + org + rim
    }
  }
  return f
}

export function computeMoisture(width: number, height: number, elevation: number[], seed: number): number[] {
  const D = Math.min(width, height)
  const scale = D * 0.3
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  const m = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const noise = fbmWarp2(x, y, scale, (seed ^ 0x2fed01) | 0, warp)
      // Surtout piloté par le bruit (poches humides localisées) + un léger biais
      // basse altitude — sinon TOUT le fond devient marais. Le fond reste de
      // l'alpage, le marais ne prend que les vraies cuvettes détrempées.
      m[i] = clamp01(0.8 * noise + 0.2 * (1 - elevation[i]!))
    }
  }
  return m
}

/** Seuils de bande (altitude) et d'humidité — contenu de carte, réglés à la
 *  vignette. Les terrains MINÉRAUX (scree/rock/snow) restent en bandes hautes
 *  disjointes → l'ordre altitude↔terrain reste structurel (testé). La variété
 *  vient du 2e axe (humidité × quartiers macro) DANS les bandes basses. */
export const BANDS = {
  FLOOR: 0.32,    // < FLOOR : fond de vallée (prairie / marais / lande)
  LARCH: 0.48,    // LARCH..FOREST : haut de la forêt = mélèzes épars (limite des arbres)
  FOREST: 0.55,   // FLOOR..FOREST : pentes boisées (dense ↔ éparse selon humidité)
  ALPINE: 0.64,   // FOREST..ALPINE : alpage d'altitude (pelouse au-dessus des arbres)
  SCREE: 0.73,    // ALPINE..SCREE : éboulis
  SNOW: 0.83,     // SCREE..SNOW : roche
  GLACIER: 0.95,  // SNOW..GLACIER : neige ; ≥ GLACIER : glace (glacier rare, plus hauts sommets)
  MARSH_WET: 0.70,   // fond très humide → marais
  HEATH_WET: 0.30,   // fond sec → lande (bruyère)
  FOREST_WET: 0.34,  // pente humide → forêt dense ; sinon adret sec (arbres épars sur lande)
}

/**
 * Terrain d'une tuile selon ALTITUDE × HUMIDITÉ (`wet` = humidité locale + biais
 * macro des quartiers). Le fond se décline en marais/prairie/lande ; les pentes
 * en forêt dense (ubac humide) ou clairsemée sur lande (adret sec) ; puis un
 * alpage d'altitude, puis le minéral. `tx,ty,seed` servent au grain fin
 * (trouées de forêt / arbres épars). Encourage l'exploration : chaque quartier
 * a un caractère.
 */
function bandFor(elevation: number, wet: number, tx: number, ty: number, seed: number): number {
  if (elevation < BANDS.FLOOR) {
    if (wet > BANDS.MARSH_WET) {
      // Zone humide : tourbière (le plus détrempé) ou roselière.
      return fbm2(tx, ty, 10, (seed ^ 0x0b06) | 0) < 0.5 ? TERRAIN_PEAT_BOG : TERRAIN_REED_MARSH
    }
    if (wet < BANDS.HEATH_WET) return TERRAIN_HEATH // fond sec = lande
    return TERRAIN_GRASS // prairie (les prés fleuris/blocs sont semés ensuite)
  }
  if (elevation < BANDS.FOREST) {
    if (elevation > BANDS.LARCH) {
      // Limite des arbres : MÉLÈZES épars (clairs, dorés) mêlés de pelouse d'altitude.
      return fbm2(tx, ty, 7, (seed ^ 0x9a3d) | 0) < 0.55 ? TERRAIN_LARCH : TERRAIN_ALPINE_MEADOW
    }
    if (wet > BANDS.FOREST_WET) {
      // Ubac humide : forêt DENSE de conifères (épicéas/sapins), rares trouées.
      return fbm2(tx, ty, 6, seed) < 0.92 ? TERRAIN_FOREST : TERRAIN_GRASS
    }
    // Adret sec : forêt CLAIRE de pins, ouverte, sur fond de lande.
    return fbm2(tx, ty, 6, (seed ^ 0x515f) | 0) < 0.5 ? TERRAIN_PINE : TERRAIN_HEATH
  }
  if (elevation < BANDS.ALPINE) {
    // Alpage d'altitude, parsemé de pelouses fleuries (edelweiss/gentiane).
    return fbm2(tx, ty, 12, (seed ^ 0x0f10) | 0) > 0.72 ? TERRAIN_ALPINE_FLOWERS : TERRAIN_ALPINE_MEADOW
  }
  if (elevation < BANDS.SCREE) return TERRAIN_SCREE
  if (elevation < BANDS.SNOW) return TERRAIN_ROCK
  if (elevation < BANDS.GLACIER) return TERRAIN_SNOW
  return TERRAIN_GLACIER // les plus hauts sommets = glace
}

/** Constantes des QUARTIERS macro — grands secteurs au tempérament distinct. */
const MACRO = {
  WET_FRAC: 0.7,   // échelle du champ « humide/sec » (grand → quartiers larges)
  ROCK_FRAC: 0.6,  // échelle du champ « barren/rocheux »
  M_WEIGHT: 0.55,  // part de l'humidité LOCALE
  W_WEIGHT: 0.45,  // part du biais macro humide
  R_WEIGHT: 0.22,  // le biais macro rocheux ASSÈCHE (→ landes, forêt éparse)
}

export function paintAlpineBands(map: WorldMap, moisture: number[], seed: number): void {
  const { width, height } = map
  const el = map.elevation!
  const D = Math.min(width, height)
  const wetScale = D * MACRO.WET_FRAC
  const rockScale = D * MACRO.ROCK_FRAC
  const warp = Math.max(1, Math.round(D * ALPINE.WARP_FRAC))
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      // Quartiers macro : humidité régionale + un biais « rocheux/barren » qui assèche.
      const macroWet = fbmWarp2(tx, ty, wetScale, (seed ^ 0x00a1c3) | 0, warp)
      const macroRock = fbmWarp2(tx, ty, rockScale, (seed ^ 0x00b2d4) | 0, warp)
      const wet = clamp01(MACRO.M_WEIGHT * moisture[i]! + MACRO.W_WEIGHT * macroWet - MACRO.R_WEIGHT * macroRock)
      map.terrain[i] = bandFor(el[i]!, wet, tx, ty, seed)
    }
  }
}

/**
 * Sème des PATCHES organiques (contour warpé, clairières internes) qui
 * convertissent un terrain source en un autre — bosquets, prés fleuris, chaos de
 * blocs, vieille forêt, brûlis. Générique : densité, taille, remplissage, source,
 * cible. Densités → scalables ; tout est déterministe.
 */
interface Scatter {
  density: number
  rMinFrac: number
  rMaxFrac: number
  warp: number
  fill: number
  isSource: (t: number) => boolean
  to: number
  salt: number
}

function scatterPatches(map: WorldMap, seed: number, cfg: Scatter): void {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(4, Math.round(D * 0.06))
  const interior = (W - 2 * margin) * (H - 2 * margin)
  const count = Math.round(cfg.density * interior)
  const rMin = Math.max(2, Math.round(D * cfg.rMinFrac))
  const rMax = Math.max(rMin + 1, Math.round(D * cfg.rMaxFrac))
  for (let k = 0; k < count; k++) {
    const x = margin + Math.floor(hash2(k * 613 + cfg.salt, seed, 0x1d1) * (W - 2 * margin))
    const y = margin + Math.floor(hash2(seed, k * 613 + cfg.salt, 0x2e3) * (H - 2 * margin))
    if (!cfg.isSource(map.terrain[y * W + x]!)) continue
    const r = rMin + Math.floor(hash2(k, (seed ^ cfg.salt) | 0, 0x4f7) * (rMax - rMin + 1))
    const s = (seed ^ (k * cfg.salt)) | 0
    const rr = Math.ceil(r * (1 + cfg.warp)) + 1
    const scale = Math.max(3, r)
    const fine = Math.max(3, Math.round(r * 0.5))
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        const tx = x + dx
        const ty = y + dy
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
        const i = ty * W + tx
        if (!cfg.isSource(map.terrain[i]!)) continue
        const wx = dx + cfg.warp * r * (fbm2(tx, ty, scale, s) * 2 - 1)
        const wy = dy + cfg.warp * r * (fbm2(tx, ty, scale, (s ^ 0x9e3779b9) | 0) * 2 - 1)
        if (wx * wx + wy * wy > r * r) continue
        if (fbm2(tx, ty, fine, (s ^ 0x2b7f) | 0) > cfg.fill) continue // clairière interne
        map.terrain[i] = cfg.to
      }
    }
  }
}

const isGrass = (t: number): boolean => t === TERRAIN_GRASS
const isMeadowish = (t: number): boolean =>
  t === TERRAIN_GRASS || t === TERRAIN_ALPINE_MEADOW || t === TERRAIN_ALPINE_FLOWERS
const isDenseForest = (t: number): boolean => t === TERRAIN_FOREST
const isAnyForest = (t: number): boolean =>
  t === TERRAIN_FOREST || t === TERRAIN_PINE || t === TERRAIN_LARCH

/** Tous les biomes-patches, dans l'ordre (les bosquets créent la forêt réutilisée
 *  par la vieille forêt / le brûlis). */
function paintScatterBiomes(map: WorldMap, seed: number): void {
  // Bosquets — bois distribué dans le fond.
  scatterPatches(map, seed, { density: 0.00018, rMinFrac: 0.012, rMaxFrac: 0.06, warp: 0.5, fill: 0.82, isSource: isGrass, to: TERRAIN_FOREST, salt: 0x2777 })
  // Vieille forêt (rare, gros bois) et forêt brûlée (rare, set-piece narratif).
  scatterPatches(map, seed, { density: 0.000014, rMinFrac: 0.02, rMaxFrac: 0.05, warp: 0.45, fill: 0.95, isSource: isDenseForest, to: TERRAIN_OLD_GROWTH, salt: 0x51a3 })
  scatterPatches(map, seed, { density: 0.00002, rMinFrac: 0.015, rMaxFrac: 0.045, warp: 0.55, fill: 0.9, isSource: isAnyForest, to: TERRAIN_BURNT_FOREST, salt: 0x71c9 })
  // Prés fleuris dans la prairie.
  scatterPatches(map, seed, { density: 0.00006, rMinFrac: 0.015, rMaxFrac: 0.04, warp: 0.5, fill: 0.72, isSource: isGrass, to: TERRAIN_FLOWER_MEADOW, salt: 0x3b1d })
  // Chaos de blocs / moraine, épars dans prairie + alpage (fill bas → blocs isolés).
  scatterPatches(map, seed, { density: 0.00009, rMinFrac: 0.01, rMaxFrac: 0.03, warp: 0.55, fill: 0.4, isSource: isMeadowish, to: TERRAIN_BOULDERS, salt: 0x6e2f })
}

/**
 * Couloirs d'avalanche : depuis un point haut, une traînée de BLOCS/débris dévale
 * la pente (steepest-descent sur l'altitude), rasant la forêt jusqu'au fond. 1 à 3
 * par carte. Un vrai « couloir » lisible qui raconte quelque chose.
 */
function paintAvalanches(map: WorldMap, seed: number): void {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const el = map.elevation!
  const margin = Math.max(3, Math.round(D * 0.08))
  const count = 1 + Math.floor(hash2(seed, 0x7a3c, 0x3) * 2.99) // 1..3
  const aw = Math.max(2, Math.round(D * 0.012))
  const isBlockable = (t: number): boolean => {
    const d = TERRAINS[t]
    return d !== undefined && d.walkable && t !== TERRAIN_SHALLOW_WATER
  }
  for (let k = 0; k < count; k++) {
    // Source haute (pente, pas le pic scellé).
    let sx = margin, sy = margin, se = -1
    for (let s = 0; s < 40; s++) {
      const x = margin + Math.floor(hash2(k * 71 + s, seed, 0x2a1) * (W - 2 * margin))
      const y = margin + Math.floor(hash2(seed, k * 71 + s, 0x3b2) * (H - 2 * margin))
      const e = el[y * W + x]!
      if (e > se && e > 0.6 && e < 0.85) { se = e; sx = x; sy = y }
    }
    if (se < 0) continue
    let x = sx, y = sy
    for (let step = 0; step < W + H; step++) {
      if (el[y * W + x]! < BANDS.FLOOR) break // arrivé au fond
      // rase une bande de blocs
      for (let dy = -aw; dy <= aw; dy++) {
        for (let dx = -aw; dx <= aw; dx++) {
          if (dx * dx + dy * dy > aw * aw) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (isBlockable(map.terrain[ny * W + nx]!)) map.terrain[ny * W + nx] = TERRAIN_BOULDERS
        }
      }
      // descend au voisin le plus bas
      let bx = -1, by = -1, be = el[y * W + x]!
      for (let d = 0; d < 8; d++) {
        const nx = x + NX8[d]!, ny = y + NY8[d]!
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const e = el[ny * W + nx]!
        if (e < be) { be = e; bx = nx; by = ny }
      }
      if (bx < 0) break
      x = bx; y = by
    }
  }
}

const NX8 = [-1, 0, 1, -1, 1, -1, 0, 1]
const NY8 = [-1, -1, -1, 0, 0, 1, 1, 1]

export function generateAlpineTerrain(width: number, height: number, seed: number): WorldMap {
  const map = createEmptyMap(width, height, TERRAIN_GRASS)
  map.elevation = computeElevation(width, height, seed)
  const moisture = computeMoisture(width, height, map.elevation, seed)
  paintAlpineBands(map, moisture, seed)
  const flow = computeFlowField(width, height, seed)
  carveHydrology(map, flow, seed) // lac, rivière (thalweg), ruisseaux, tarns — l'eau suit l'écoulement
  paintScatterBiomes(map, seed) // bosquets, prés fleuris, blocs, vieille forêt, brûlis (après l'eau)
  paintAvalanches(map, seed) // couloirs d'avalanche (blocs qui dévalent)
  sealBorderRing(map) // l'anneau externe reste bloquant quoi qu'ait creusé l'eau
  placePois(map, seed) // POIs APRÈS le scellage : le biome sous le centre d'un POI est le terrain FINAL
  //                      (sinon un POI validé sur du bord verrait son terrain réécrit en roche par le scellage → incohérence)
  return map
}
