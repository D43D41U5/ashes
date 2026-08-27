/**
 * ═══ LA PLANCHE DU CHICOT — ce que la cendre fait d'un arbre avant de le faire tomber ═══
 *
 * *(Chantier du 2026-08-27, décision d'Alexis : « ok pour les conifères transforme les en chicot
 * gris ». Règle maison : une question de DA se tranche à l'œil sur une planche rendue, jamais
 * sur une description.)*
 *
 * LE DÉFAUT QU'ELLE INSTRUIT — la cendre prend une tuile, l'arbre qui s'y trouve agonise cinq
 * jours (`CENDRE.AGONIE_JOURS`, spec `cendre.md` R13) puis disparaît. La spec promet qu'il est
 * « visible, DÉNUDÉ et récoltable » pendant ces cinq jours ; le rendu, lui, n'a jamais posé la
 * question — `agonise()` n'avait aucun appelant, et `etatDeCime` ne consulte que la saison.
 * Un pin, en plus, n'a même pas de cime nue à porter (G6 : « la silhouette du conifère dit
 * qu'il tient »). D'où l'état `mort` : un CHICOT, la ramure sans la masse, en bois d'argent.
 *
 * Elle n'ouvre pas le jeu : elle appelle `cimeNue`, `tonsMorts` et `champDeHauteur` — le VRAI
 * art, pixel pour pixel. Ce qu'elle montre est l'ALBÉDO exact que `lit-trees` cuirait ; la
 * lumière calculée vient par-dessus, en jeu.
 *
 * ⚠ **LE FOND EST DE LA CENDRE, ET C'EST TOUT LE SUJET.** Un chicot ne se voit jamais sur de
 * l'herbe : il naît sur `cendre_bois` (`#3b3630`) ou `cendre_pre` (`#71695a`). Le juger sur du
 * vert répondrait à une question que le jeu ne pose pas. Les deux sols sont donc côte à côte.
 *
 *   node --import tsx tools/planche-chicot.mts [sortie.png] [--zoom n]
 *
 * TROIS LIGNES, ET LA TROISIÈME EST UNE QUESTION OUVERTE :
 *   ① VIVANT SUR LA CENDRE — l'état d'aujourd'hui : l'arbre meurt sans rien en dire.
 *   ② CHICOT, FÛT VIVANT   — la cime seule passe en bois mort.
 *   ③ CHICOT ENTIER        — le fût aussi (`tonsMorts` sur son écorce). C'est 11 textures de
 *                            plus, une par variante, et le fût n'a aujourd'hui aucun état.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import {
  ancrageHouppierPx, colonneX, houppierLargeur, tonsMorts, VARIANTES, VARIANTES_CADUQUES,
  type TonsFut, type VarianteArbre,
} from '../packages/client/src/render/arbre-art'
import { cimeEnGrappes, cimeNue, FORME_PAR_VARIANTE, PORT_PAR_VARIANTE } from '../packages/client/src/render/houppier-grappes'
import { champDeHauteur, ecorceDe } from '../packages/client/src/render/ecorce'
import { TERRAIN_COLORS } from '../packages/client/src/render/terrain-colors'
import { TERRAIN_CENDRE_BOIS, TERRAIN_CENDRE_PRE } from '../packages/sim/src/balance'

const args = process.argv.slice(2)
const sortie = args.find((a) => !a.startsWith('--')) ?? '/tmp/planche-chicot.png'
const iz = args.indexOf('--zoom')
const zoom = Math.max(1, iz >= 0 ? Number(args[iz + 1]) : 3)

/** LA RANGÉE — les quatre persistants d'abord (ce sont EUX que la décision vise), puis deux
 *  caducs témoins : ils ont déjà `nu`, et la planche doit montrer que les deux se tiennent
 *  ensemble sur le même sol. `[slug, centre x]`. */
const RANGEE: readonly (readonly [string, number])[] = [
  ['pin', 30], ['vieux_pin', 82], ['sapin', 134], ['meleze', 182], ['tree', 232], ['bouleau', 274],
]
const PANNEAU_W = 300
const SOL_Y = 104
const PANNEAU_H = SOL_Y + 8
const GRAINE = 11 + 2 * 7919 // la cime nº 2 des cinq — celle du milieu

/** LES DEUX SOLS DE LA CENDRE : le bois cendré (sombre) et le pré cendré (clair). Un chicot doit
 *  se lire sur les DEUX, et c'est le second qui est le cas difficile. */
const SOLS: readonly (readonly [number, string])[] = [
  [TERRAIN_CENDRE_BOIS, 'CENDRE BOIS  3B3630'],
  [TERRAIN_CENDRE_PRE, 'CENDRE PRE  71695A'],
]

/** LES TROIS ÉTATS COMPARÉS. `cime` : ce que porte le houppier. `fut` : les tons de l'écorce. */
const LIGNES = [
  { nom: '1 AUJOURD HUI  VIVANT SUR LA CENDRE', mort: false, futMort: false },
  { nom: '2 CHICOT  FUT VIVANT', mort: true, futMort: false },
  { nom: '3 CHICOT ENTIER  FUT MORT AUSSI', mort: true, futMort: true },
] as const

/* ═══ LA TOILE (encodeur et fonte communs aux planches) ════════════════════════════════════ */

const FONTE: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['#.#', '###', '###', '###', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '###', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '.#.'], V: ['#.#', '#.#', '#.#', '.#.', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '#..', '#..'],
  '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
  '+': ['...', '.#.', '###', '.#.', '...'], '-': ['...', '...', '###', '...', '...'],
  ' ': ['...', '...', '...', '...', '...'],
}

const MARGE = 10
const LIB_H = 5 * 2 + 6
const outW = MARGE * 2 + SOLS.length * PANNEAU_W * zoom + (SOLS.length - 1) * MARGE
const outH = MARGE + LIB_H + LIGNES.length * (LIB_H + PANNEAU_H * zoom + MARGE)
const img = Buffer.alloc(outW * outH * 3, 0x14)

function pixel(x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= outW || y >= outH) return
  const i = (y * outW + x) * 3
  img[i] = (c >> 16) & 0xff; img[i + 1] = (c >> 8) & 0xff; img[i + 2] = c & 0xff
}
function texte(s: string, x0: number, y0: number, z: number, c: number): void {
  let x = x0
  for (const ch of s.toUpperCase()) {
    const g = FONTE[ch] ?? FONTE[' ']!
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) {
      if (g[r]![k] !== '#') continue
      for (let zy = 0; zy < z; zy++) for (let zx = 0; zx < z; zx++) pixel(x + k * z + zx, y0 + r * z + zy, c)
    }
    x += 4 * z
  }
}

/**
 * Pose un grain à (dx, dy) dans le panneau d'origine (ox, oy).
 *
 * ⚠ **LES DEUX FORMATS DE TON**, et ce n'est pas une politesse : `cimeNue`/`cimeEnGrappes`
 * rendent `rgb(r,g,b)` (elles passent par une `Toile`), `champDeHauteur` rend `#rrggbb`. Une
 * première version ne lisait que le premier — et le fût n'était pas dessiné DU TOUT, en
 * silence : les arbres flottaient à 14 px au-dessus du sol et les deux lignes de la planche
 * sortaient identiques au bit près. C'est le seul endroit du fichier où un `continue` peut
 * effacer la moitié du sujet.
 */
function poser(ton: readonly (string | null)[], W: number, H: number, ox: number, oy: number, dx: number, dy: number): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = ton[y * W + x]
    if (t === null || t === undefined) continue
    const mm = /rgb\((\d+),(\d+),(\d+)\)/.exec(t)
    const c = mm
      ? (Number(mm[1]) << 16) | (Number(mm[2]) << 8) | Number(mm[3])
      : (t.startsWith('#') ? parseInt(t.slice(1), 16) : -1)
    if (c < 0) continue
    const px = Math.round(dx) + x, py = Math.round(dy) + y
    for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) pixel(ox + px * zoom + zx, oy + py * zoom + zy, c)
  }
}

/** Un panneau : la rangée d'arbres sur UN sol de cendre, dans UN état. */
function panneau(ox: number, oy: number, sol: number, ligne: (typeof LIGNES)[number]): void {
  const fond = TERRAIN_COLORS[sol]!
  // Le ciel : la même cendre assombrie — un fond neutre, qui ne raconte rien de son côté.
  const ciel = (((fond >> 16) & 0xff) >> 1 << 16) | ((((fond >> 8) & 0xff) >> 1) << 8) | ((fond & 0xff) >> 1)
  for (let y = 0; y < PANNEAU_H; y++) for (let x = 0; x < PANNEAU_W; x++) {
    const c = y >= SOL_Y - 2 ? fond : ciel
    for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) pixel(ox + x * zoom + zx, oy + y * zoom + zy, c)
  }
  for (const [slug, cx] of RANGEE) {
    const v: VarianteArbre = VARIANTES[slug]!
    const m = v.mesures
    const pied = SOL_Y
    const caduc = VARIANTES_CADUQUES.includes(slug)
    // LE FÛT — son vrai grain d'écorce. Mort, ses tons passent par `tonsMorts` (loi ②).
    const fut: TonsFut = ligne.futMort ? tonsMorts(v.fut) : v.fut
    const gf = champDeHauteur(ecorceDe(v.slug), m.futW, m.futH, colonneX(m), colonneX(m) + m.colonneW, fut)
    poser(gf.ton, m.futW, m.futH, ox, oy, cx - m.futW / 2, pied - m.futH)
    // LA CIME — vivante (grappes), ou la RAMURE : `nu` pour un caduc, `mort` pour un persistant.
    // Les deux sortent de `cimeNue`, aux tons du bois qu'on lui passe : c'est la même recette,
    // et c'est ce qui garantit qu'un chicot de pin et un hiver de chêne se ressemblent.
    const W = houppierLargeur(m)
    const forme = FORME_PAR_VARIANTE[v.slug] ?? 'rond'
    const port = PORT_PAR_VARIANTE[v.slug] ?? { axe: 'sympodial' as const, tortueux: 0.18 }
    const gh = ligne.mort
      ? cimeNue(W, m.houppierS, forme, caduc ? v.fut : tonsMorts(v.fut), port, m.recouvrementPx, m.colonneW, GRAINE)
      : cimeEnGrappes(W, m.houppierS, forme, v.tons, GRAINE, undefined, 0)
    poser(gh.ton, W, m.houppierS, ox, oy, cx - W / 2, pied - ancrageHouppierPx(m) - m.houppierS)
  }
}

for (let s = 0; s < SOLS.length; s++) texte(SOLS[s]![1], MARGE + s * (PANNEAU_W * zoom + MARGE), MARGE, 2, 0xd8d4c8)
for (let l = 0; l < LIGNES.length; l++) {
  const oy = MARGE + LIB_H + l * (LIB_H + PANNEAU_H * zoom + MARGE)
  texte(LIGNES[l]!.nom, MARGE, oy, 2, 0xf0c46a)
  for (let s = 0; s < SOLS.length; s++) {
    panneau(MARGE + s * (PANNEAU_W * zoom + MARGE), oy + LIB_H, SOLS[s]![0], LIGNES[l]!)
  }
}

/* ═══ ÉCRITURE PNG (le même encodeur maison que les autres planches) ═══════════════════════ */
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
ihdr.writeUInt32BE(outW, 0); ihdr.writeUInt32BE(outH, 4); ihdr[8] = 8; ihdr[9] = 2
const raw = Buffer.alloc(outH * (1 + outW * 3))
for (let y = 0; y < outH; y++) {
  raw[y * (1 + outW * 3)] = 0
  img.copy(raw, y * (1 + outW * 3) + 1, y * outW * 3, (y + 1) * outW * 3)
}
writeFileSync(sortie, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
]))

console.log(`${outW}×${outH} → ${sortie}`)
for (const [slug] of RANGEE) {
  const v = VARIANTES[slug]!
  console.log(`${slug.padEnd(10)} fut ${v.fut.corps} → mort ${tonsMorts(v.fut).corps}`)
}
