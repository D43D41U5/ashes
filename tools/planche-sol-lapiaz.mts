/**
 * ═══ LA PLANCHE DU SOL DU LAPIAZ — le sol cuit HORS LIGNE, par le code livré ═══
 *
 * *(Chantier du 2026-08-27 : « le sol du chaos de blocs dessine ses dalles ».)*
 *
 * Elle cuit le sol avec **le vrai `cuireChunk`** de `render/paves.ts` (pur, testé en Node), sur
 * le **vrai terrain** du monde joué, à la **vraie échelle** (16 px par tuile). Aucune maquette :
 * ce qu'elle rend est ce que la couche de pavés pose à l'écran, moins la modulation de zone
 * (constante à l'intérieur d'une zone), moins la lumière, moins les props.
 *
 * Elle sert à CALIBRER vite (`LAPIAZ` dans `paves.ts`) sans payer un aller-retour navigateur.
 * Le verdict, lui, se rend en jeu : `pnpm smoke --dev --scenario lapiaz`, qui photographie le
 * même sol sous la lumière, l'ombre du versant et les blocs.
 *
 *   node --import tsx tools/planche-sol-lapiaz.mts [graine] [sortie.png] [--cadre x,y] [--cote n]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE, MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { hash2, fbm2 } from '../packages/sim/src/noise'
import { cuireChunk, soleilDuPavement, PAVE, PAVE_PX, PAVE_COTE_BAVE } from '../packages/client/src/render/paves'
import { familleDe, grainFacteur, moyenneFamille, profilDe, GRAIN_CELLS, type Famille } from '../packages/client/src/render/grain-sol'
import { TERRAIN_COLORS } from '../packages/client/src/render/terrain-colors'
const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const seed = Number(args[0] ?? 2026)
const out = args[1] ?? '/tmp/rendu.png'
const COTE = Number(opt('cote') ?? 48)
const [tx0, ty0] = (opt('cadre') ?? '1268,100').split(',').map(Number) as [number, number]
// Le SOLEIL du pavement : -1 (couchant) → +1 (aube), 0 = midi plein nord (la lumière figée).
const soleil = soleilDuPavement(Number(opt('soleil') ?? 0))
const c = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const { width: W, height: H, terrain } = c.map
const trames = new Map<Famille, Float32Array>()
const trameDe = (t: number): Float32Array | null => {
  const f = familleDe(t); if (!f) return null
  let tr = trames.get(f)
  if (!tr) { tr = new Float32Array(GRAIN_CELLS * GRAIN_CELLS); for (let y = 0; y < GRAIN_CELLS; y++) for (let x = 0; x < GRAIN_CELLS; x++) tr[y * GRAIN_CELLS + x] = grainFacteur(x, y, f, seed); trames.set(f, tr) }
  return tr
}
const terrainAt = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? 0 : terrain[ty * W + tx]!)
const couleurAt = (tx: number, ty: number) => {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return 0
  const t = terrain[ty * W + tx]!, base = TERRAIN_COLORS[t] ?? 0xff00ff, f = familleDe(t)
  if (!f) return base
  const d = profilDe(f).damier
  let g = (1 - d / 2 + d * hash2(tx, ty)) / moyenneFamille(f, seed)
  g *= 1 + (fbm2(tx, ty, 10, 0x7ac3) - 0.5) * 0.12
  return ((Math.min(255, ((base >> 16) & 0xff) * g) & 0xff) << 16) | ((Math.min(255, ((base >> 8) & 0xff) * g) & 0xff) << 8) | (Math.min(255, (base & 0xff) * g) & 0xff)
}
const N = PAVE.CHUNK, P = PAVE_PX, S = COTE * P
const img = new Uint8ClampedArray(S * S * 4)
const cache = new Map<string, Uint8ClampedArray>()
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const wx = tx0 * P + x, wy = ty0 * P + y
  const cx = Math.floor(wx / (N * P)), cy = Math.floor(wy / (N * P)), cle = cx + ':' + cy
  let buf = cache.get(cle); if (!buf) { buf = cuireChunk({ cx, cy, seed, soleil, terrainAt, couleurAt, trameDe }).sol; cache.set(cle, buf) }
  const s = ((wy - cy * N * P + PAVE.BAVE) * PAVE_COTE_BAVE + (wx - cx * N * P + PAVE.BAVE)) * 4, o = (y * S + x) * 4
  img[o] = buf[s]!; img[o + 1] = buf[s + 1]!; img[o + 2] = buf[s + 2]!; img[o + 3] = 255
}
const TBL = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let cc = n; for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1; t[n] = cc >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let cc = 0xffffffff; for (let i = 0; i < b.length; i++) cc = TBL[(cc ^ b[i]!) & 0xff]! ^ (cc >>> 8); return (cc ^ 0xffffffff) >>> 0 }
const ck = (ty: string, data: Uint8Array) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const bd = Buffer.concat([Buffer.from(ty, 'ascii'), Buffer.from(data)]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(bd)); return Buffer.concat([l, bd, cr]) }
const raw = Buffer.alloc(S * (1 + S * 4))
for (let y = 0; y < S; y++) Buffer.from(img.buffer, y * S * 4, S * 4).copy(raw, y * (1 + S * 4) + 1)
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ck('IHDR', ihdr), ck('IDAT', deflateSync(raw, { level: 9 })), ck('IEND', new Uint8Array())]))
console.log('écrit', out)
