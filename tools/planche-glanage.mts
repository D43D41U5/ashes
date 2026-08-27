/**
 * PLANCHE DU GLANAGE (spec `glanage.md`) — le butin au sol CONTRE le décor qu'il ne doit pas imiter.
 *
 * Aperçu OFFLINE : silhouette et matière seulement. Il ne dit rien de la lumière (le pipeline
 * `_lit` ajoute une normale) — c'est le SMOKE qui juge le rendu réel. Ce qu'il juge ici, et
 * c'est la seule question posée : à 16 px, un joueur distingue-t-il « ça se ramasse » de
 * « c'est peint sur le sol » ?
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { BRANCHE_RECTS, CAILLOU_RECTS, PEBBLES, PEBBLE_TONES, pebbleShadowRects, PEBBLE_SHADOW, CHICOT_RECTS } from '../packages/client/src/render/lit-props'

const Z = 10 // zoom
const CASE = 16
const FOND: [number, number, number] = [0x4a, 0x6b, 0x35] // l'herbe, pour juger le contraste réel

type Rect = readonly [number, number, number, number, string]
const rectsDe = (r: readonly Rect[]): Rect[] => [...r]

/** Les cailloux du DÉCOR, rendus avec leur ombre — le voisin dont il faut se distinguer. */
function pebbleRects(i: number): Rect[] {
  const p = PEBBLES[i]!
  const out: Rect[] = []
  for (const [x, y, w, h] of pebbleShadowRects(p)) {
    out.push([x, y, w, h, `rgba-${PEBBLE_SHADOW.alpha}`] as unknown as Rect)
  }
  p.rects.forEach(([x, y, w, h], k) => out.push([x, y, w, h, PEBBLE_TONES[k % PEBBLE_TONES.length]!]))
  return out
}

const CASES: { titre: string; rects: Rect[] }[] = [
  { titre: 'branche_au_sol (BUTIN)', rects: [...rectsDe(BRANCHE_RECTS), [3, 13, 10, 1, 'rgba-0.22'] as unknown as Rect] },
  { titre: 'pierre_au_sol (BUTIN)', rects: [...rectsDe(CAILLOU_RECTS), [3, 14, 9, 1, 'rgba-0.22'] as unknown as Rect] },
  { titre: 'pebbles 0 (DECOR)', rects: pebbleRects(0) },
  { titre: 'pebbles 1 (DECOR)', rects: pebbleRects(1) },
  { titre: 'pebbles 2 (DECOR)', rects: pebbleRects(2) },
  { titre: 'pebbles 3 (DECOR)', rects: pebbleRects(3) },
  { titre: 'chicot (DECOR)', rects: rectsDe(CHICOT_RECTS) },
]

const COLS = CASES.length
const W = COLS * CASE * Z
const H = CASE * Z
const buf = Buffer.alloc(W * H * 3)
for (let i = 0; i < W * H; i++) {
  buf[i * 3] = FOND[0]; buf[i * 3 + 1] = FOND[1]; buf[i * 3 + 2] = FOND[2]
}
function poser(col: number, x: number, y: number, r: number, g: number, b: number, a = 1): void {
  for (let py = y * Z; py < (y + 1) * Z; py++) {
    for (let px = (col * CASE + x) * Z; px < (col * CASE + x + 1) * Z; px++) {
      if (px < 0 || py < 0 || px >= W || py >= H) continue
      const i = (py * W + px) * 3
      buf[i] = Math.round(buf[i]! * (1 - a) + r * a)
      buf[i + 1] = Math.round(buf[i + 1]! * (1 - a) + g * a)
      buf[i + 2] = Math.round(buf[i + 2]! * (1 - a) + b * a)
    }
  }
}
CASES.forEach((c, col) => {
  for (const [x, y, w, h, col2] of c.rects) {
    const alpha = String(col2).startsWith('rgba-') ? Number(String(col2).slice(5)) : 1
    const hex = String(col2).startsWith('rgba-') ? '#000000' : String(col2)
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) poser(col, x + dx, y + dy, r, g, b, alpha)
  }
})

const TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c }
function crc32(b: Buffer): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
const raw = Buffer.alloc(H * (1 + W * 3))
for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3) }
const out = process.argv[2] ?? '/tmp/planche-glanage.png'
writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
]))
console.log(`${out} — ${CASES.map((c) => c.titre).join(' | ')}`)
