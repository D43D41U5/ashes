/**
 * LA PLANCHE DES QUATRE SAISONS — la même vue, quatre fois, une par saison.
 *
 * *(Spec `saisons.md` S17 : « la teinte se tranche sur une planche rendue des quatre saisons
 * sur la même vue, jamais sur une description ». Règle maison : une question de DA se juge à
 * l'œil, en quelques minutes, et la plomberie vient après le « ok pour la reco ».)*
 *
 * Elle n'ouvre pas le jeu : elle applique la MÊME loi que le rendu (`teinteDuTerrain`,
 * `teinter`) à la palette de sol du même crop de carte, et écrit les quatre panneaux côte à
 * côte. Ce qu'elle montre est donc exactement ce que la couche fera — à la lumière et au
 * fouillis près, qui viennent par-dessus.
 *
 *   node --import tsx tools/planche-saisons.mts [seed] [sortie.png] [--crop x,y,w,h] [--zoom n]
 *
 * Elle vit ICI et non dans /sim parce qu'elle écrit un fichier : le lint de pureté l'interdit
 * là-bas, et c'est très bien.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { TERRAIN_COLORS } from '../packages/client/src/render/terrain-colors'
import { teinteDuTerrain, teinter } from '../packages/client/src/render/teinte-saison'
import { BALANCE } from '../packages/sim/src/balance'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE, MONDE_JOUE } from '../packages/sim/src/zonegraph'

const args = process.argv.slice(2)
const positionnels = args.filter((a) => !a.startsWith('--'))
const seed = Number(positionnels[0] ?? 2026)
const sortie = positionnels[1] ?? '/tmp/planche-saisons.png'
const lire = (nom: string): string | undefined => {
  const i = args.indexOf(nom)
  return i >= 0 ? args[i + 1] : undefined
}
const zoom = Math.max(1, Number(lire('--zoom') ?? 1))
const GOUTTIERE = 6 // les panneaux se touchent : une gouttière noire les sépare

/** Les quatre cœurs de saison — c'est là que la teinte est la plus franche. */
const SAISONS: readonly (readonly [number, string])[] = [
  [15, 'l’Éclosion'],
  [45, 'l’Ardeur'],
  [75, 'les Pluies'],
  [105, 'le Grand Froid'],
]

console.log(`génération du monde joué (seed ${seed})…`)
const carte = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const { width, height, terrain } = carte.map

const crop = (lire('--crop') ?? '').split(',').map(Number)
const cx = Number.isFinite(crop[0]) ? crop[0]! : Math.floor(width / 2) - 200
const cy = Number.isFinite(crop[1]) ? crop[1]! : Math.floor(height / 2) - 150
const cw = Number.isFinite(crop[2]) ? crop[2]! : 400
const ch = Number.isFinite(crop[3]) ? crop[3]! : 300

const panneau = cw * zoom
const outW = SAISONS.length * panneau + (SAISONS.length - 1) * GOUTTIERE
const outH = ch * zoom
const rendu = Buffer.alloc(outW * outH * 3) // noir : la gouttière est le fond

for (let s = 0; s < SAISONS.length; s++) {
  const jour = SAISONS[s]![0]
  const ox = s * (panneau + GOUTTIERE)
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const tx = cx + x
      const ty = cy + y
      const t = tx >= 0 && ty >= 0 && tx < width && ty < height ? terrain[ty * width + tx]! : 0
      const c = teinter(TERRAIN_COLORS[t] ?? 0xff00ff, teinteDuTerrain(t, jour))
      for (let zy = 0; zy < zoom; zy++) {
        for (let zx = 0; zx < zoom; zx++) {
          const i = ((y * zoom + zy) * outW + ox + x * zoom + zx) * 3
          rendu[i] = (c >> 16) & 0xff
          rendu[i + 1] = (c >> 8) & 0xff
          rendu[i + 2] = c & 0xff
        }
      }
    }
  }
}

// ── Écriture PNG (le même encodeur maison qu'`apercu-carte`) ────────────────────────────────
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
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(outW, 0)
ihdr.writeUInt32BE(outH, 4)
ihdr[8] = 8
ihdr[9] = 2
const raw = Buffer.alloc(outH * (1 + outW * 3))
for (let y = 0; y < outH; y++) {
  raw[y * (1 + outW * 3)] = 0
  rendu.copy(raw, y * (1 + outW * 3) + 1, y * outW * 3, (y + 1) * outW * 3)
}
writeFileSync(
  sortie,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
)

console.log(`crop ${cw}×${ch} à (${cx}, ${cy}), zoom ${zoom} → ${sortie}`)
console.log(`panneaux, de gauche à droite : ${SAISONS.map(([j, n]) => `${n} (j${j})`).join(' · ')}`)
console.log(`(le monde ouvre au jour ${BALANCE.JOUR_DE_DEPART} : le joueur voit d'abord le deuxième panneau.)`)
