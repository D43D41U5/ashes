/**
 * APERÇU DE CARTE — l'instrument qui permet de REGARDER la carte (« l'œil tranche
 * contre le tableur », leçon consignée dans worldgen.md §6). Promu du script jetable
 * du chantier Stratigraphie (2026-08-09) : c'est l'outil avant/après de chaque couche.
 *
 * Il vit dans `tools/` et NON dans `/sim` : il écrit sur disque et chronomètre.
 * On importe la sim comme un consommateur ordinaire — exactement ce que fait le serveur.
 * PNG une-tuile-un-pixel écrit à la main (zlib de Node pour l'IDAT, CRC32 maison) :
 * zéro dépendance nouvelle.
 *
 *   node --import tsx tools/apercu-carte.mts [seed] [sortie.png]
 *   node --import tsx tools/apercu-carte.mts 2026 crop.png --crop 850,1780,400,300 --zoom 2
 *
 * Marqueurs : seuils = croix jaunes, POI = magenta, charniers = orange,
 * set-pieces = violet, gués = cyan, villages = rouge, spawns = blanc,
 * fil de rivière = bleu nuit.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import {
  generateZonedTerrain, placeZoneNodes, emplacementsDeVillage, pointsDeSpawn, MONDE,
  placeHuntingGrounds, nidsAMonstre,
  TERRAIN_VOID, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_FOREST, TERRAIN_SHALLOW_WATER,
  TERRAIN_ROCK, TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_SCREE, TERRAIN_SNOW,
  TERRAIN_HEATH, TERRAIN_ALPINE_MEADOW, TERRAIN_PINE, TERRAIN_LARCH,
  TERRAIN_BOULDERS, TERRAIN_FLOWER_MEADOW, TERRAIN_PEAT_BOG, TERRAIN_REED_MARSH,
  TERRAIN_ALPINE_FLOWERS, TERRAIN_BURNT_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_CLIFF,
  TERRAIN_WILLOW, TERRAIN_WET_MEADOW, TERRAIN_JUNIPER_HEATH,
} from '../packages/sim/src/index'

const args = process.argv.slice(2)
const positionnels = args.filter((a) => !a.startsWith('--'))
const option = (nom: string): string | undefined => {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 ? args[i + 1] : undefined
}
const seed = Number(positionnels[0] ?? 2026)
const out = positionnels[1] ?? `/tmp/carte-${seed}.png`
const crop = option('crop')?.split(',').map(Number) // x,y,w,h en tuiles
const zoom = Math.max(1, Number(option('zoom') ?? 1))

console.time('generation')
const carte = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE)
console.timeEnd('generation')
const { map } = carte
const { width: W, height: H, terrain } = map

// ── Palette par id de terrain (clés = les constantes de la sim, pas des nombres) ──
const PAL: Record<number, [number, number, number]> = {
  [TERRAIN_VOID]: [0, 0, 0],
  [TERRAIN_GRASS]: [122, 168, 92],
  [TERRAIN_ROAD]: [166, 124, 82],
  [TERRAIN_FOREST]: [58, 110, 58],
  [TERRAIN_SHALLOW_WATER]: [110, 176, 214],
  [TERRAIN_ROCK]: [86, 86, 92],
  [TERRAIN_DEEP_WATER]: [29, 78, 137],
  [TERRAIN_MARSH]: [88, 128, 104],
  [TERRAIN_SCREE]: [142, 138, 128],
  [TERRAIN_SNOW]: [238, 242, 246],
  [TERRAIN_HEATH]: [125, 143, 82],
  [TERRAIN_ALPINE_MEADOW]: [155, 196, 110],
  [TERRAIN_PINE]: [46, 93, 63],
  [TERRAIN_LARCH]: [111, 143, 58],
  [TERRAIN_BOULDERS]: [119, 115, 107],
  [TERRAIN_FLOWER_MEADOW]: [181, 201, 111],
  [TERRAIN_PEAT_BOG]: [93, 74, 54],
  [TERRAIN_REED_MARSH]: [124, 143, 79],
  [TERRAIN_ALPINE_FLOWERS]: [166, 185, 111],
  [TERRAIN_BURNT_FOREST]: [74, 63, 58],
  [TERRAIN_OLD_GROWTH]: [31, 74, 40],
  [TERRAIN_CLIFF]: [22, 22, 26],
  // Le vocabulaire du pré (spec t0-exploration §2ter) : saulaie argentée, prairie bleutée,
  // lande ocre pâle — trois teintes qui ne se confondent ni entre elles ni avec leurs voisines.
  [TERRAIN_WILLOW]: [118, 156, 122],
  [TERRAIN_WET_MEADOW]: [86, 152, 118],
  [TERRAIN_JUNIPER_HEATH]: [172, 162, 106],
}

const img = Buffer.alloc(W * H * 3)
const compte: Record<number, number> = {}
for (let i = 0; i < W * H; i++) {
  const t = terrain[i]!
  compte[t] = (compte[t] ?? 0) + 1
  const c = PAL[t] ?? [255, 0, 255]
  img[i * 3] = c[0]; img[i * 3 + 1] = c[1]; img[i * 3 + 2] = c[2]
}

function px(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 3
  img[i] = r; img[i + 1] = g; img[i + 2] = b
}
function carre(cx: number, cy: number, demi: number, r: number, g: number, b: number) {
  for (let dy = -demi; dy <= demi; dy++) for (let dx = -demi; dx <= demi; dx++) px(cx + dx, cy + dy, r, g, b)
}
function croix(cx: number, cy: number, demi: number, r: number, g: number, b: number) {
  for (let d = -demi; d <= demi; d++) { px(cx + d, cy, r, g, b); px(cx, cy + d, r, g, b) }
}

// ── Le fil de la rivière (amont→aval), en bleu nuit — pour voir le TRACÉ ──
if (map.fil) for (const i of map.fil) px(i % W, Math.floor(i / W), 10, 40, 100)

// ── Marqueurs ─────────────────────────────────────────────────────────────
const parKind: Record<string, number> = {}
for (const s of map.seuils ?? []) croix(s.x, s.y, 5, 255, 224, 0)
for (const z of map.zones) {
  const cx = Math.floor(z.x + z.w / 2), cy = Math.floor(z.y + z.h / 2)
  if (z.kind) {
    parKind[z.kind] = (parKind[z.kind] ?? 0) + 1
    if (z.kind === 'charnier') carre(cx, cy, 1, 255, 127, 0)
    else if (z.kind === 'bois_noir' || z.kind === 'cercle_pierres' || z.kind === 'combe_brumeuse') carre(cx, cy, 3, 200, 120, 255)
    else carre(cx, cy, 1, 255, 0, 255)
  } else if (z.name === 'le Gué') {
    parKind['(gué)'] = (parKind['(gué)'] ?? 0) + 1
    carre(cx, cy, 2, 0, 255, 255)
  }
}
const nodes = placeZoneNodes(carte)
const emplacements = emplacementsDeVillage(carte, nodes, {
  coinsDeChasse: placeHuntingGrounds(carte.map, seed),
  nids: nidsAMonstre(carte.map),
})
for (const e of emplacements) carre(e.tx, e.ty, 3, 255, 0, 0)
const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
for (const s of spawns) carre(s.tx, s.ty, 2, 255, 255, 255)

// ── Fenêtre de sortie : carte entière, ou recadrage --crop upscalé --zoom ──
let outW = W, outH = H, rendu = img
if (crop && crop.length === 4) {
  const [cx, cy, cw, ch] = crop as [number, number, number, number]
  outW = cw * zoom; outH = ch * zoom
  rendu = Buffer.alloc(outW * outH * 3)
  for (let y = 0; y < outH; y++) {
    const sy = cy + Math.floor(y / zoom)
    for (let x = 0; x < outW; x++) {
      const sx = cx + Math.floor(x / zoom)
      const si = (sy * W + sx) * 3, di = (y * outW + x) * 3
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
        rendu[di] = img[si]!; rendu[di + 1] = img[si + 1]!; rendu[di + 2] = img[si + 2]!
      }
    }
  }
}

// ── Écriture PNG ──────────────────────────────────────────────────────────
const TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  TABLE[n] = c
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(outW, 0); ihdr.writeUInt32BE(outH, 4)
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8 bits, RGB
const raw = Buffer.alloc(outH * (1 + outW * 3))
for (let y = 0; y < outH; y++) {
  raw[y * (1 + outW * 3)] = 0
  rendu.copy(raw, y * (1 + outW * 3) + 1, y * outW * 3, (y + 1) * outW * 3)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(out, png)

// ── Statistiques ──────────────────────────────────────────────────────────
const NOMS: Record<number, string> = {
  [TERRAIN_VOID]: 'void', [TERRAIN_GRASS]: 'grass', [TERRAIN_ROAD]: 'road',
  [TERRAIN_FOREST]: 'forest', [TERRAIN_SHALLOW_WATER]: 'shallow', [TERRAIN_ROCK]: 'rock',
  [TERRAIN_DEEP_WATER]: 'deep', [TERRAIN_MARSH]: 'marsh', [TERRAIN_SCREE]: 'scree',
  [TERRAIN_SNOW]: 'snow', [TERRAIN_HEATH]: 'heath', [TERRAIN_ALPINE_MEADOW]: 'alp_meadow',
  [TERRAIN_PINE]: 'pine', [TERRAIN_LARCH]: 'larch', [TERRAIN_BOULDERS]: 'boulders',
  [TERRAIN_FLOWER_MEADOW]: 'flower', [TERRAIN_PEAT_BOG]: 'peat', [TERRAIN_REED_MARSH]: 'reed',
  [TERRAIN_ALPINE_FLOWERS]: 'alp_flowers', [TERRAIN_BURNT_FOREST]: 'burnt',
  [TERRAIN_OLD_GROWTH]: 'old_growth', [TERRAIN_CLIFF]: 'cliff',
  [TERRAIN_WILLOW]: 'willow', [TERRAIN_WET_MEADOW]: 'wet_meadow', [TERRAIN_JUNIPER_HEATH]: 'juniper',
}
console.log(`seed ${seed} — ${W}×${H} (${(W * H / 1e6).toFixed(2)} M tuiles) → ${out}${crop ? ` (crop ${crop.join(',')} ×${zoom})` : ''}`)
console.log('terrains %:', Object.entries(compte).sort((a, b) => b[1] - a[1])
  .map(([id, n]) => `${NOMS[Number(id)] ?? id}=${(100 * n / (W * H)).toFixed(1)}`).join(' '))
console.log('zones du graphe:', carte.graphe.zones.map((z) => `${z.def.slug}(T${z.def.tier})@${Math.round(z.x)},${Math.round(z.y)}`).join(' '))
console.log('seuils:', (map.seuils ?? []).length, '— vers:', (map.seuils ?? []).map((s) => `${s.vers}${s.secours ? '(secours)' : ''}`).join(', '))
console.log('POI par kind:', Object.entries(parKind).sort().map(([k, n]) => `${k}=${n}`).join(' '))
console.log('villages:', emplacements.length, 'spawns:', spawns.length, 'fil rivière:', map.fil?.length ?? 0, 'tuiles')
