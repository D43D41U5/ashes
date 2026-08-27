/**
 * ═══ LA PLANCHE DE LA VASE — le fond de rivière mis à nu, DANS son voisinage ═══
 *
 * Alexis, 2026-08-25 : « améliore le rendu de la vase lorsque la rivière s'assèche. Ça n'a rien
 * à voir avec le reste du sol et ça rend très mal. »
 *
 * Le smoke `--scenario vase` photographie la FRONTIÈRE au zoom 8 : il prouve la frange, il ne
 * peut pas montrer un ruban uniforme. Ce qu'Alexis voit, c'est le CORPS de la vase sur toute la
 * longueur d'une rivière, à côté d'un sol qui, lui, respire (damier de famille, taches macro à
 * ~10 tuiles, grain fbm à trois crans). Cette planche cuit les DEUX par les vraies fonctions —
 * `cuireChunk` pour le sol, `cuireManteau` pour l'assec — et les compose comme la couche.
 *
 * Le bake par tuile est celui de `WorldScene.bakeMapTexture`, sa lisière en moins (elle module
 * la teinte, pas la matière — et la matière est le sujet).
 *
 *   node --import tsx tools/planche-vase.mts [seed] [sortie.png] [--zoom n] [--crop x,y,w,h]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { BANC_JOUEURS } from '../packages/sim/src/scenario'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { hash2, fbm2 } from '../packages/sim/src/noise'
import { TERRAIN_COLORS } from '../packages/client/src/render/terrain-colors'
import { ambianceDe, moduler } from '../packages/client/src/render/zone-ambiance'
import { zoneSlugAt } from '../packages/sim/src/map'
import { familleDe, grainFacteur, moyenneFamille, profilDe, GRAIN_CELLS } from '../packages/client/src/render/grain-sol'
import { cuireChunk, PAVE, PAVE_PX, PAVE_COTE, PAVE_COTE_BAVE } from '../packages/client/src/render/paves'
import { cuireManteau, trameDeVase, trameDeCrue, TUILE_ASSEC, TUILE_EAU_LIBRE, TUILE_NUE, type EtatTuile } from '../packages/client/src/render/manteau'


const args = process.argv.slice(2)
const pos = args.filter((a) => !a.startsWith('--'))
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const seed = Number(pos[0] ?? 2026)
const out = pos[1] ?? '/tmp/planche-vase.png'
const zoom = Number(opt('zoom') ?? 2)
/** L'AVANT — le module tel qu'il est à HEAD, sorti à côté (jamais un stash : les deux lois
 *  doivent vivre dans LA MÊME exécution, sinon on compare deux mondes). `--avant <chemin>`. */
const AVANT = opt('avant')



const avant = AVANT ? ((await import(AVANT)) as { cuireManteau: typeof cuireManteau; trameDeVase: () => Float32Array }) : null
if (avant) console.log('  (loi de HEAD : le module d’AVANT est chargé à côté)')

const c = generateZonedTerrain(seed, BANC_JOUEURS, MONDE_JOUE)
const map = c.map
const { width: W, height: H, terrain } = map

// ── LE BAKE PAR TUILE (WorldScene passes 1-2, lisière exclue) ──
const solParZone = new Map<string | undefined, readonly [number, number, number]>()
const couleurs = new Uint32Array(W * H)
const NON_BIOME = new Set([0, 4, 6, 7, 23])
for (let i = 0; i < W * H; i++) {
  const terr = terrain[i] ?? 0
  const tx = i % W, ty = (i - (i % W)) / W
  const base = TERRAIN_COLORS[terr] ?? 0xff00ff
  const slug = zoneSlugAt(map, tx, ty)
  let sol = solParZone.get(slug)
  if (!sol) { sol = ambianceDe(slug).sol; solParZone.set(slug, sol) }
  const famille = NON_BIOME.has(terr) ? null : familleDe(terr)
  let grain: number
  if (famille) {
    const d = profilDe(famille).damier
    grain = (1 - d / 2 + d * hash2(tx, ty)) / moyenneFamille(famille, seed)
    grain *= 1 + (fbm2(tx, ty, 10, 0x7ac3) - 0.5) * 0.12
  } else {
    grain = 0.96 + 0.07 * hash2(tx, ty)
  }
  const couleur = moduler(base, sol)
  let r = (couleur >> 16) & 0xff, g = (couleur >> 8) & 0xff, b = couleur & 0xff
  if (famille) {
    const maxCanal = Math.max(r, g, b)
    if (maxCanal > 0) grain = Math.min(grain, 255 / maxCanal)
  }
  r = Math.min(255, Math.round(r * grain)); g = Math.min(255, Math.round(g * grain)); b = Math.min(255, Math.round(b * grain))
  couleurs[i] = (r << 16) | (g << 8) | b
}

// ── LA CIBLE : le carré de 3×3 chunks qui porte le plus de haut-fond (une rivière) ──
let best = { cx: 0, cy: 0, n: -1 }
const CH = PAVE.CHUNK
for (let cy = 1; cy < Math.floor(H / CH) - 2; cy++) {
  for (let cx = 1; cx < Math.floor(W / CH) - 2; cx++) {
    let n = 0, prof = 0
    for (let ty = cy * CH; ty < (cy + 3) * CH; ty++) for (let tx = cx * CH; tx < (cx + 3) * CH; tx++) {
      const t = terrain[ty * W + tx]
      if (t === 4) n++
      if (t === 6) prof++
    }
    // On veut du haut-fond ET un peu de profond (le lit qui reste en eau) : le bord se juge.
    const score = n + Math.min(prof, n)
    if (score > best.n) best = { cx, cy, n: score }
  }
}
const crop = opt('crop')?.split(',').map(Number)
const CX0 = crop ? Math.floor(crop[0]! / CH) : best.cx
const CY0 = crop ? Math.floor(crop[1]! / CH) : best.cy
const NCX = 3, NCY = 3
console.log(`  cible : chunks (${CX0}..${CX0 + NCX - 1}, ${CY0}..${CY0 + NCY - 1}) — tuiles (${CX0 * CH}, ${CY0 * CH}), score ${best.n}`)

// ── L'ÉTAT DU MANTEAU : la sécheresse. Tout haut-fond devient VASE, le profond reste en eau. ──
const etatAt = (tx: number, ty: number): EtatTuile => {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return -1
  const t = terrain[ty * W + tx] ?? 0
  if (t === 4) return TUILE_ASSEC
  if (t === 6) return TUILE_EAU_LIBRE
  return TUILE_NUE
}

// ── LA CUISSON, chunk par chunk, composée ──
const outW = NCX * PAVE_COTE, outH = NCY * PAVE_COTE
let img = Buffer.alloc(outW * outH * 3)
// L'eau, faute de shader : la teinte du haut-fond et du profond, à plat. Elle n'est là que pour
// que le bord de la vase ait un CONTRE-CHAMP — ce n'est pas ce qu'on juge.
const EAU_PROFONDE: [number, number, number] = [0x1e, 0x2f, 0x42]
const EAU_HAUTFOND: [number, number, number] = [0x2f, 0x4d, 0x5e]

const trames = new Map<string, Float32Array>()
const trameDe = (t: number): Float32Array | null => {
  const f = familleDe(t)
  if (!f) return null
  let tr = trames.get(f)
  if (!tr) {
    tr = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
    for (let cy = 0; cy < GRAIN_CELLS; cy++) for (let cx = 0; cx < GRAIN_CELLS; cx++) tr[cy * GRAIN_CELLS + cx] = grainFacteur(cx, cy, f, seed)
    trames.set(f, tr)
  }
  return tr
}
const trameNeige = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
for (let cy = 0; cy < GRAIN_CELLS; cy++) for (let cx = 0; cx < GRAIN_CELLS; cx++) trameNeige[cy * GRAIN_CELLS + cx] = grainFacteur(cx, cy, 'neige', seed)

const melanger = (X: number, Y: number, src: Uint8ClampedArray, i: number): void => {
  const a = src[i + 3]! / 255
  if (a === 0) return
  if (X < 0 || Y < 0 || X >= outW || Y >= outH) return
  const o = (Y * outW + X) * 3
  img[o] = Math.round(img[o]! * (1 - a) + src[i]! * a)
  img[o + 1] = Math.round(img[o + 1]! * (1 - a) + src[i + 1]! * a)
  img[o + 2] = Math.round(img[o + 2]! * (1 - a) + src[i + 2]! * a)
}

type Loi = { cuireManteau: typeof cuireManteau; trameDeVase: () => Float32Array }
const LOI_COURANTE: Loi = { cuireManteau, trameDeVase }

function rendre(loi: Loi): Buffer {
  img = Buffer.alloc(outW * outH * 3)
  for (let j = 0; j < NCY; j++) {
  for (let i = 0; i < NCX; i++) {
    const cx = CX0 + i, cy = CY0 + j
    const solChunk = cuireChunk({ cx, cy, terrainAt: (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? 0 : terrain[ty * W + tx] ?? 0), couleurAt: (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? 0 : couleurs[ty * W + tx] ?? 0), trameDe })
    const man = loi.cuireManteau({
      cx, cy, etatAt, trameNeige, trameGlace: trameNeige,
      trameVase: loi.trameDeVase(), trameCrue: trameDeCrue(),
      solDeZone: (tx, ty) => {
        const slug = zoneSlugAt(map, tx, ty)
        let sol = solParZone.get(slug)
        if (!sol) { sol = ambianceDe(slug).sol; solParZone.set(slug, sol) }
        return sol
      },
    })
    const ox = i * PAVE_COTE - PAVE.BAVE, oy = j * PAVE_COTE - PAVE.BAVE
    const S = PAVE_COTE_BAVE
    // ① le sol du terrain
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) melanger(ox + x, oy + y, solChunk.sol, (y * S + x) * 4)
    // ② l'eau, là où le sol est resté nu (le shader, en aplat)
    for (let ty = cy * CH; ty < (cy + 1) * CH; ty++) for (let tx = cx * CH; tx < (cx + 1) * CH; tx++) {
      const t = terrain[ty * W + tx] ?? 0
      if (t !== 4 && t !== 6) continue
      const col = t === 6 ? EAU_PROFONDE : EAU_HAUTFOND
      for (let py = 0; py < PAVE_PX; py++) for (let px = 0; px < PAVE_PX; px++) {
        const X = (tx - CX0 * CH) * PAVE_PX + px, Y = (ty - CY0 * CH) * PAVE_PX + py
        const o = (Y * outW + X) * 3
        if (X < 0 || Y < 0 || X >= outW || Y >= outH) continue
        // seulement là où le sol n'a rien peint (alpha 0) : la berge garde sa frange
        const sx = X - ox, sy = Y - oy
        if (sx >= 0 && sy >= 0 && sx < S && sy < S && solChunk.sol[(sy * S + sx) * 4 + 3]! > 0) continue
        img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]
      }
    }
    // ③ le surplomb du sol (frange de berge, ombre, ressac) au-dessus de l'eau
    if (solChunk.surplomb) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) melanger(ox + x, oy + y, solChunk.surplomb, (y * S + x) * 4)
    // ④ le manteau : son sol (la vase), puis son surplomb (la frange dans l'eau)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) melanger(ox + x, oy + y, man.sol, (y * S + x) * 4)
    if (man.surplomb) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) melanger(ox + x, oy + y, man.surplomb, (y * S + x) * 4)
  }
  }
  return img
}

// ── LES DEUX LOIS, DANS LA MÊME EXÉCUTION (mémoire `mesurer-avant-apres-sans-stash`) ──
const imgApres = Buffer.from(rendre(LOI_COURANTE))
const imgAvant = avant ? Buffer.from(rendre(avant)) : null

// ── LA MESURE : l'écart-type de luminance sur le CORPS de la vase, contre celui du sol de terre ──
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const stats = (garde: (tx: number, ty: number) => boolean): { n: number; moy: number; ecart: number; parTuile: number } => {
  let n = 0, s = 0, s2 = 0
  const moyTuiles: number[] = []
  for (let ty = CY0 * CH; ty < (CY0 + NCY) * CH; ty++) for (let tx = CX0 * CH; tx < (CX0 + NCX) * CH; tx++) {
    if (!garde(tx, ty)) continue
    let ts = 0, tn = 0
    for (let py = 2; py < PAVE_PX - 2; py++) for (let px = 2; px < PAVE_PX - 2; px++) {
      const X = (tx - CX0 * CH) * PAVE_PX + px, Y = (ty - CY0 * CH) * PAVE_PX + py
      const o = (Y * outW + X) * 3
      const l = lum(img[o]!, img[o + 1]!, img[o + 2]!)
      s += l; s2 += l * l; n++; ts += l; tn++
    }
    if (tn) moyTuiles.push(ts / tn)
  }
  const moy = s / n
  const mt = moyTuiles.reduce((a, b) => a + b, 0) / (moyTuiles.length || 1)
  const vt = moyTuiles.reduce((a, b) => a + (b - mt) ** 2, 0) / (moyTuiles.length || 1)
  return { n, moy, ecart: Math.sqrt(s2 / n - moy * moy), parTuile: Math.sqrt(vt) }
}
const estVase = (tx: number, ty: number) => (terrain[ty * W + tx] ?? 0) === 4
const estHerbe = (tx: number, ty: number) => { const t = terrain[ty * W + tx] ?? 0; return t === 1 || t === 3 || t === 11 || t === 17 }
const dire = (nom: string, buf: Buffer): void => {
  img = buf
  const v = stats(estVase), h = stats(estHerbe)
  console.log(`  ${nom} · VASE  : luminance ${v.moy.toFixed(1)} · écart-type ${v.ecart.toFixed(2)} · écart ENTRE TUILES ${v.parTuile.toFixed(2)}`)
  console.log(`  ${nom} · TERRE : luminance ${h.moy.toFixed(1)} · écart-type ${h.ecart.toFixed(2)} · écart ENTRE TUILES ${h.parTuile.toFixed(2)}`)
}
if (imgAvant) dire('AVANT', imgAvant)
dire('APRÈS', imgApres)

// ── PNG — les deux lois CÔTE À CÔTE quand `--avant` est donné, séparées d'un trait ──
const cotes = imgAvant ? [imgAvant, imgApres] : [imgApres]
const SEP = imgAvant ? 6 : 0
const zW = cotes.length * outW * zoom + (cotes.length - 1) * SEP, zH = outH * zoom
const px = Buffer.alloc(zW * zH * 3)
cotes.forEach((buf, k) => {
  const bx = k * (outW * zoom + SEP)
  for (let y = 0; y < zH; y++) for (let x = 0; x < outW * zoom; x++) {
    const o = (y * zW + bx + x) * 3, s = (((y / zoom) | 0) * outW + ((x / zoom) | 0)) * 3
    px[o] = buf[s]!; px[o + 1] = buf[s + 1]!; px[o + 2] = buf[s + 2]!
  }
})
const TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c2 = n; for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 0xedb88320 ^ (c2 >>> 1) : c2 >>> 1; t[n] = c2 } return t })()
const crc32 = (b: Buffer): number => { let x = 0xffffffff; for (let i = 0; i < b.length; i++) x = TABLE[(x ^ b[i]!) & 0xff]! ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(zW, 0); ihdr.writeUInt32BE(zH, 4); ihdr[8] = 8; ihdr[9] = 2
const raw = Buffer.alloc(zH * (1 + zW * 3))
for (let y = 0; y < zH; y++) { raw[y * (1 + zW * 3)] = 0; px.copy(raw, y * (1 + zW * 3) + 1, y * zW * 3, (y + 1) * zW * 3) }
writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]))
console.log(`  → ${out} (${zW}×${zH})`)
