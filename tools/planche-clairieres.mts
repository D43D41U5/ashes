/**
 * ═══ LA PLANCHE DES TROUÉES — ce que le joueur VOIT, pas ce que le champ décide ═══
 *
 * Alexis, 2026-08-25 : « certaines clairières de forêts sont trop grandes, on dirait que
 * certaines parties de la forêt est rasée ». L'aperçu de carte ordinaire ne peut pas montrer
 * ça : il peint le TERRAIN, et une clairière d'aujourd'hui est du terrain de forêt. Ce qui
 * manque à l'écran, ce sont les ARBRES.
 *
 * Cette planche rend donc le sol EN GRIS et les NŒUDS en couleur — un point par arbre. Les
 * trouées se lisent comme à l'écran : des taches nues dans un semis dense. Elle ne connaît
 * NI le champ des clairières NI le terrain de clairière : la même planche vaut avant et après
 * le chantier, c'est ce qui en fait un instrument d'avant/après.
 *
 *   node --import tsx tools/planche-clairieres.mts [seed] [sortie.png] [--crop x,y,w,h] [--zoom n]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { BANC_JOUEURS } from '../packages/sim/src/scenario'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { placeZoneNodes } from '../packages/sim/src/zone-content'
import { TERRAINS } from '../packages/sim/src/balance'

const args = process.argv.slice(2)
const pos = args.filter((a) => !a.startsWith('--'))
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const seed = Number(pos[0] ?? 2026)
const out = pos[1] ?? `/tmp/planche-${seed}.png`
const crop = opt('crop')?.split(',').map(Number)
const zoom = Number(opt('zoom') ?? 4)

const c = generateZonedTerrain(seed, BANC_JOUEURS, MONDE_JOUE)
const { width: W, height: H, terrain } = c.map
const nodes = placeZoneNodes(c)

// ── Le SOL en gris, par nature : le bois plus sombre que l'ouvert, l'eau plus sombre encore.
const gris = (t: number): [number, number, number] => {
  const n = TERRAINS[t]?.name ?? 'void'
  if (n === 'forest' || n === 'old_growth' || n === 'pine' || n === 'larch' || n === 'willow') return [58, 62, 52]
  if (n === 'clairiere') return [96, 104, 74] // le terrain neuf, s'il existe : il doit se VOIR
  if (n === 'deep_water' || n === 'shallow_water') return [34, 42, 58]
  if (!TERRAINS[t]?.walkable) return [26, 26, 26]
  return [86, 88, 80]
}
// ── Les NŒUDS, par type. L'arbre domine : c'est lui qu'on cherche des yeux.
const COULEUR_NOEUD: Record<string, [number, number, number]> = {
  tree: [96, 196, 92], old_tree: [40, 230, 120],
  berry_bush: [220, 80, 160], fiber_plant: [230, 214, 90],
  rock: [170, 170, 175], bloc: [200, 200, 205], quarry: [160, 200, 220],
  champignon: [235, 160, 60], leaf_pile: [150, 120, 70],
}

const x0 = crop ? crop[0]! : 0, y0 = crop ? crop[1]! : 0
const cw = crop ? crop[2]! : W, ch = crop ? crop[3]! : H
const outW = cw * zoom, outH = ch * zoom
const px = Buffer.alloc(outW * outH * 3)
const poser = (X: number, Y: number, rgb: [number, number, number]): void => {
  if (X < 0 || Y < 0 || X >= outW || Y >= outH) return
  const o = (Y * outW + X) * 3
  px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]
}
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const i = (y + y0) * W + (x + x0)
    const g = (y + y0) >= 0 && (y + y0) < H && (x + x0) >= 0 && (x + x0) < W ? gris(terrain[i]!) : [0, 0, 0] as [number, number, number]
    for (let dy = 0; dy < zoom; dy++) for (let dx = 0; dx < zoom; dx++) poser(x * zoom + dx, y * zoom + dy, g)
  }
}
// Un nœud : un disque de (zoom-1) px, centré sur sa tuile.
const r = Math.max(1, zoom - 1)
for (const n of nodes) {
  const col = COULEUR_NOEUD[n.type]
  if (!col) continue
  const X = (n.tx - x0) * zoom, Y = (n.ty - y0) * zoom
  if (X < -zoom || Y < -zoom || X > outW || Y > outH) continue
  for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) poser(X + dx, Y + dy, col)
}

const TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c2 = n; for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 0xedb88320 ^ (c2 >>> 1) : c2 >>> 1; t[n] = c2 } return t })()
const crc32 = (b: Buffer): number => { let x = 0xffffffff; for (let i = 0; i < b.length; i++) x = TABLE[(x ^ b[i]!) & 0xff]! ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(outW, 0); ihdr.writeUInt32BE(outH, 4); ihdr[8] = 8; ihdr[9] = 2
const raw = Buffer.alloc(outH * (1 + outW * 3))
for (let y = 0; y < outH; y++) { raw[y * (1 + outW * 3)] = 0; px.copy(raw, y * (1 + outW * 3) + 1, y * outW * 3, (y + 1) * outW * 3) }
writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
]))
const arbres = nodes.filter((n) => n.type === 'tree' || n.type === 'old_tree').length
console.log(`seed ${seed} → ${out} (${outW}×${outH}) · ${nodes.length} nœuds dont ${arbres} arbres`)
