// Écrit des vignettes PNG de la carte alpine — outil de dev (hors périmètre /sim,
// Node autorisé ici). Node ≥22.6 strip-type les imports .ts nativement, donc ce
// script tourne en `node` simple (pas besoin de tsx).
// Usage (depuis packages/sim) : node scripts/vignette.mjs [seed] [W] [H] [outDir]
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { generateAlpineTerrain } from '../src/alpinegen.ts'
import { renderVignette } from '../src/vignette.ts'

const [seed = '7', W = '480', H = '720', outDir = '.'] = process.argv.slice(2)
const map = generateAlpineTerrain(Number(W), Number(H), Number(seed))
const { w, h, rgb } = renderVignette(map, 640)

// Encodeur PNG minimal (RGB, 8-bit, non entrelacé).
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
const raw = Buffer.alloc(h * (1 + w * 3))
for (let y = 0; y < h; y++) {
  raw[y * (1 + w * 3)] = 0 // filtre None
  for (let x = 0; x < w * 3; x++) raw[y * (1 + w * 3) + 1 + x] = rgb[y * w * 3 + x]
}
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
const out = `${outDir}/alpine-seed${seed}-${W}x${H}.png`
writeFileSync(out, png)
console.log('wrote', out, `${w}x${h}`)
