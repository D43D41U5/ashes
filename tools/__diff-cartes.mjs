/** SONDE JETABLE — deux PNG de capture se comparent-ils ? (décodeur PNG de smoke.mjs, réduit) */
import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

function decode(chemin) {
  const png = readFileSync(chemin)
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  const canaux = png[25] === 6 ? 4 : 3
  let i = 8
  const morceaux = []
  while (i + 8 <= png.length) {
    const len = png.readUInt32BE(i)
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') morceaux.push(png.subarray(i + 8, i + 8 + len))
    if (png.toString('ascii', i + 4, i + 8) === 'IEND') break
    i += 12 + len
  }
  const brut = inflateSync(Buffer.concat(morceaux))
  const pas = w * canaux
  const out = Buffer.alloc(h * pas)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filtre = brut[p++]
    for (let k = 0; k < pas; k++) {
      const x = brut[p + k]
      const a = k >= canaux ? out[y * pas + k - canaux] : 0
      const b = y > 0 ? out[(y - 1) * pas + k] : 0
      const c = k >= canaux && y > 0 ? out[(y - 1) * pas + k - canaux] : 0
      let v
      if (filtre === 0) v = x
      else if (filtre === 1) v = x + a
      else if (filtre === 2) v = x + b
      else if (filtre === 3) v = x + ((a + b) >> 1)
      else {
        const q = a + b - c
        const da = Math.abs(q - a)
        const db = Math.abs(q - b)
        const dc = Math.abs(q - c)
        v = x + (da <= db && da <= dc ? a : db <= dc ? b : c)
      }
      out[y * pas + k] = v & 255
    }
    p += pas
  }
  return { w, h, canaux, out, pas }
}

const [fa, fb] = process.argv.slice(2)
const A = decode(fa)
const B = decode(fb)
let diff = 0
let tot = 0
let dSomme = 0
for (let y = 145; y < 630; y += 3) {
  for (let x = 160; x < 1100; x += 3) {
    const ka = y * A.pas + x * A.canaux
    const kb = y * B.pas + x * B.canaux
    tot++
    const d = Math.abs(A.out[ka] - B.out[kb]) + Math.abs(A.out[ka + 1] - B.out[kb + 1]) + Math.abs(A.out[ka + 2] - B.out[kb + 2])
    dSomme += d
    if (d > 12) diff++
  }
}
console.log(`échantillons ${tot} · différents ${diff} (${((100 * diff) / tot).toFixed(1)} %) · écart moyen ${(dSomme / tot).toFixed(1)}`)
// trois pixels témoins (rive, herbe, bord du monde)
for (const [x, y, nom] of [[560, 300, 'rivière'], [400, 480, 'terrain'], [170, 155, 'bord du monde']]) {
  const ka = y * A.pas + x * A.canaux
  const kb = y * B.pas + x * B.canaux
  console.log(`${nom} (${x},${y}) avant rgb(${A.out[ka]},${A.out[ka + 1]},${A.out[ka + 2]}) → après rgb(${B.out[kb]},${B.out[kb + 1]},${B.out[kb + 2]})`)
}
