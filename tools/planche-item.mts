/**
 * PLANCHE D'ITEMS — l'art procédural d'un item, RENDU SANS NAVIGATEUR.
 *
 * `item-art.ts` peint chaque icône avec l'API `Graphics` de Phaser ; ces fonctions sont PURES
 * (une suite de `fillStyle`/`fillRect`/`fillTriangle`/`fillCircle`), donc il suffit de stubber
 * l'objet pour les rasteriser dans un buffer 16×16. Ça remplace, pour juger une icône, un aller
 * au harnais smoke qui coûte plusieurs minutes sous swiftshader — et ça permet de VOIR une icône
 * neuve À CÔTÉ de celles dont elle doit se distinguer, ce qu'une case de sac ne montre jamais.
 *
 * ⚠ Ce n'est pas le rendu du jeu : pas d'anti-aliasing, pas d'alpha, fond posé à la main. Il
 * répond à « est-ce qu'on distingue A de B et est-ce que ça se lit sur un fond sombre ? »,
 * pas à « est-ce exactement ce que Phaser affiche ».
 *
 *   node --import tsx tools/planche-item.mts sortie.png charcoal,coal,wood,ash
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { ITEM_PAINTS } from '../packages/client/src/render/item-art'

const ITEMS = (process.argv[3] ?? 'charcoal,coal,wood,ash').split(',')
const S = 16, Z = 10, PAD = 2
const W = ITEMS.length * (S + PAD) * Z, H = (S + PAD) * Z
const buf = Buffer.alloc(W * H * 3, 0x1a)

function fabrique(ox: number) {
  let col = 0
  const px = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255
    for (let zy = 0; zy < Z; zy++) for (let zx = 0; zx < Z; zx++) {
      const X = ox + (x + 1) * Z + zx, Y = (y + 1) * Z + zy
      const i = (Y * W + X) * 3
      buf[i] = r; buf[i+1] = g; buf[i+2] = b
    }
  }
  const g = {
    fillStyle(c: number) { col = c; return g },
    fillRect(x: number, y: number, w: number, h: number) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(Math.round(x+i), Math.round(y+j)); return g },
    fillCircle(cx: number, cy: number, r: number) { for (let y = Math.floor(cy-r); y <= cy+r; y++) for (let x = Math.floor(cx-r); x <= cx+r; x++) { const dx = x+0.5-cx, dy = y+0.5-cy; if (dx*dx+dy*dy <= r*r) px(x,y) } return g },
    fillTriangle(x1: number,y1: number,x2: number,y2: number,x3: number,y3: number) {
      const a = (p: number[], q: number[], r: number[]) => (q[0]!-p[0]!)*(r[1]!-p[1]!)-(q[1]!-p[1]!)*(r[0]!-p[0]!)
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const p = [x+0.5, y+0.5]
        const d1 = a([x1,y1],[x2,y2],p), d2 = a([x2,y2],[x3,y3],p), d3 = a([x3,y3],[x1,y1],p)
        if (!((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0))) px(x,y)
      }
      return g
    },
    lineStyle() { return g }, strokeRect() { return g }, beginPath() { return g }, closePath() { return g },
    moveTo() { return g }, lineTo() { return g }, strokePath() { return g }, fillPath() { return g },
  }
  return g
}
ITEMS.forEach((it, k) => { const paint = (ITEM_PAINTS as Record<string, (g: unknown) => void>)[it]; if (!paint) throw new Error('inconnu: '+it); paint(fabrique(k * (S+PAD) * Z)) })

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
const out = process.argv[2] ?? '/tmp/planche-item.png'
writeFileSync(out, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]))
console.log(`${out} — ${ITEMS.join(' | ')}`)
