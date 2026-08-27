/**
 * LA PLANCHE DES HOUPPIERS PAR SAISON — quatre lois de teinte, quatre saisons, la même haie.
 *
 * *(Règle maison : une question de DA se tranche à l'œil sur une planche rendue, jamais sur une
 * description. Spec `saisons.md` S17 : « la teinte commande la COULEUR — elle roussit tout le
 * feuillage en pente », et S17 n'a jamais été branchée sur les CIMES : `snapshot-view` appelle
 * `crown.clearTint()`, le feuillage est vert toute l'année.)*
 *
 * Elle n'ouvre pas le jeu : elle appelle `cimeEnGrappes` et `champDeHauteur` — le VRAI art des
 * cimes et des fûts, pixel pour pixel — et pose le tout sur la couleur de sol que `teinteDuTerrain`
 * rend ce jour-là. Ce qu'elle montre est donc l'ALBÉDO exact que le pipeline `_lit` cuirait ; la
 * lumière calculée vient par-dessus, en jeu.
 *
 *   node --import tsx tools/planche-houppier-saisons.mts [sortie.png] [--zoom n]
 *
 * QUATRE LOIS, DE HAUT EN BAS :
 *   ⓪ AUJOURD'HUI      — aucune teinte : le vert de l'art, les quatre panneaux identiques.
 *   ① FONDU UNIFORME   — `teinter` sur CHACUN des cinq tons de la famille. Mesuré : l'écart
 *                        masse→éclat d'un hêtre tombe de 68 à 30 aux Pluies, et la lisière entre
 *                        deux essences voisines de 50 à 23. C'est la NAPPE que la séparation des
 *                        trois pins avait corrigée le 2026-07-29.
 *   ② FONDU DE LA BASE — on fond le ton `corps` et on TRANSLATE les quatre autres du même delta :
 *                        la famille change de couleur, ses écarts internes survivent (68 → 68).
 *   ③ ② + PANACHAGE    — la force du fondu gigue d'une GRAPPE à l'autre : une cime qui tourne ne
 *                        tourne pas d'un bloc. La gigue est proportionnelle à la force, donc
 *                        l'Ardeur reste unie et les Pluies se panachent.
 *
 * LES ARBRES SE TOUCHENT, ET C'EST LE POINT : une cime isolée sur fond noir ne peut pas montrer
 * qu'une loi de teinte soude un bosquet. Le pin ferme la haie — il ne doit JAMAIS rousser
 * (`VARIANTES_CADUQUES`, promesse G6 : « la silhouette du conifère dit qu'il tient »).
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { hash2 } from '../packages/sim/src/noise'
import {
  ancrageHouppierPx, colonneX, hauteurPx, houppierLargeur, prendLaSaison, VARIANTES,
  VARIANTES_CADUQUES, type TonsHouppier, type VarianteArbre,
} from '../packages/client/src/render/arbre-art'
import { cimeEnGrappes, cimeNue, FORME_PAR_VARIANTE, PORT_PAR_VARIANTE } from '../packages/client/src/render/houppier-grappes'
import { NEIGE_PAVE } from '../packages/client/src/render/manteau'
import { champDeHauteur, ecorceDe } from '../packages/client/src/render/ecorce'
import { TERRAIN_COLORS } from '../packages/client/src/render/terrain-colors'
import {
  panachageDeFamille, teinteDuTerrain, teinteSaisonniere, teinter, teinterFamille,
} from '../packages/client/src/render/teinte-saison'

const args = process.argv.slice(2)
const sortie = args.find((a) => !a.startsWith('--')) ?? '/tmp/planche-houppier-saisons.png'
const iz = args.indexOf('--zoom')
const zoom = Math.max(1, iz >= 0 ? Number(args[iz + 1]) : 3)

/* ═══ LES LOIS DE TEINTE ═══════════════════════════════════════════════════════════════════ */

const hex = (s: string): number => parseInt(s.slice(1), 16)
const str = (n: number): string => '#' + (n >>> 0).toString(16).padStart(6, '0')
const map5 = (t: TonsHouppier, f: (c: string) => string): TonsHouppier =>
  ({ masse: f(t.masse), corps: f(t.corps), lumiere: f(t.lumiere), eclat: f(t.eclat), ombre: f(t.ombre) })

/** ① le fondu appliqué à chaque ton — les écarts de la famille rétrécissent d'autant. */
function fonduUniforme(t: TonsHouppier, jour: number): TonsHouppier {
  const s = teinteSaisonniere(jour)
  return map5(t, (c) => str(teinter(hex(c), s)))
}

/** ② et ③ NE SONT PLUS ÉCRITES ICI : ce sont les fonctions du RENDU (`teinte-saison.ts`), et
 *  c'est tout l'objet d'une planche — montrer ce que la couche fera, pas ce qu'on espère. Seule
 *  la loi ① reste locale : elle n'existe nulle part ailleurs, puisqu'elle a été écartée. */
const fonduBase = (t: TonsHouppier, jour: number): TonsHouppier =>
  teinterFamille(t, teinteSaisonniere(jour))

const panachageDe = (t: TonsHouppier, jour: number, graine: number): ((i: number) => TonsHouppier) =>
  panachageDeFamille(t, jour, (i) => hash2(i, 0, (graine ^ 0x5ea5) | 0))

/** MODE `--neige` : les quatre persistants sous quatre charges. La saison est figée au Grand
 *  Froid (c'est là qu'on les verra), le sol porte son manteau. */
const NEIGE = args.includes('--neige')
const CHARGES: readonly (readonly [number, string])[] = [
  [0, 'NU  CHARGE 0'], [0.35, 'POUDRE  0 35'], [0.7, 'CHARGE  0 70'], [1, 'PLEINE  1 00'],
]
const PERSISTANTS: readonly (readonly [string, number])[] = [
  ['pin', 34], ['sapin', 78], ['meleze', 120], ['vieux_pin', 168],
]

const LOIS = [
  { nom: '0 AUJOURD HUI  RIEN', tons: (t: TonsHouppier) => t, panache: undefined as ((i: number) => TonsHouppier) | undefined },
  { nom: '1 FONDU UNIFORME', tons: fonduUniforme, panache: undefined },
  { nom: '2 FONDU DE LA BASE', tons: fonduBase, panache: undefined },
  { nom: '3 BASE + PANACHAGE', tons: fonduBase, panache: panachageDe },
] as const

/**
 * Les quatre cardinaux — les mêmes que `planche-saisons`, et le drapeau qui dit si les feuillus
 * y sont NUS. Au Grand Froid ils le sont (spec `gel.md` G6 / `saisons.md` S14, `feuillageDenude`) :
 * une colonne de cimes feuillues teintées y montrerait un état que le jeu ne rend jamais — et
 * elle cacherait la vraie question, à savoir que la cime NUE est peinte aux tons du FÛT et ne
 * tourne donc pas du tout. Un tronc ne rousse pas ; la planche doit le dire, pas le supposer.
 */
const SAISONS: readonly (readonly [number, string, boolean])[] = [
  [15, 'ECLOSION J15', false], [45, 'ARDEUR J45', false],
  [75, 'LES PLUIES J75  ENCORE FEUILLU', false], [105, 'GRAND FROID J105  NU  G6', true],
]

/** LA HAIE — quatre essences qui SE TOUCHENT, et le conifère au bout. `[slug, centre x]`. */
const HAIE: readonly (readonly [string, number])[] = [
  ['hetre', 26], ['tree', 58], ['bouleau', 92], ['chene_pre', 130], ['meleze', 176], ['pin', 218],
]
const PANNEAU_W = 254
const SOL_Y = 96 // la ligne de sol dans le panneau
const PANNEAU_H = SOL_Y + 8
const GRAINE = 11 + 2 * 7919 // la cime nº 2 des cinq — celle du milieu

/* ═══ LA TOILE ═════════════════════════════════════════════════════════════════════════════ */

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
const LIB_H = 5 * 2 + 6 // la bande de libellé, police ×2
const COLONNES = NEIGE ? CHARGES.length : SAISONS.length
const LIGNES = NEIGE ? 1 : LOIS.length
const outW = MARGE * 2 + COLONNES * PANNEAU_W * zoom + (COLONNES - 1) * MARGE
const outH = MARGE + LIB_H + LIGNES * (LIB_H + PANNEAU_H * zoom + MARGE)
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

/** Le panneau d'UNE loi × UNE saison : la haie, à plat, sur le sol de la saison. */
function panneau(ox: number, oy: number, jour: number, nu: boolean, loi: (typeof LOIS)[number], charge?: number): void {
  // ── le sol : la couleur de la forêt telle que `teinteDuTerrain` la rend ce jour-là ; sous la
  //    neige, le manteau (le pied de l'arbre doit dire la même chose que sa cime).
  const enneige = charge !== undefined && charge > 0
  const sol = enneige ? NEIGE_PAVE.NEIGE : teinter(TERRAIN_COLORS[3]!, teinteDuTerrain(3, jour))
  const ciel = enneige ? 0xc9d2e0 : teinter(TERRAIN_COLORS[1]!, teinteDuTerrain(1, jour))
  for (let y = 0; y < PANNEAU_H; y++) for (let x = 0; x < PANNEAU_W; x++) {
    const c = y >= SOL_Y - 2 ? sol : ciel
    for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) pixel(ox + x * zoom + zx, oy + y * zoom + zy, c)
  }
  // ── la haie, de gauche à droite : le voisin de droite recouvre celui de gauche
  for (const [slug, cx] of (charge === undefined ? HAIE : PERSISTANTS)) {
    const v: VarianteArbre = VARIANTES[slug]!
    const m = v.mesures
    const pied = SOL_Y
    // LE FÛT — son vrai grain d'écorce (`champDeHauteur`), jamais teinté : un tronc ne rousse pas.
    const gf = champDeHauteur(ecorceDe(v.slug), m.futW, m.futH, colonneX(m), colonneX(m) + m.colonneW, v.fut)
    poser(gf.ton, m.futW, m.futH, ox, oy, cx - m.futW / 2, pied - m.futH)
    // LE HOUPPIER — la loi de teinte s'y applique, et SEULEMENT sur un feuillu.
    const W = houppierLargeur(m)
    const forme = FORME_PAR_VARIANTE[v.slug] ?? 'rond'
    const caduc = VARIANTES_CADUQUES.includes(slug) // se DÉNUDE
    const saisonnier = prendLaSaison(slug)  // TOURNE (le mélèze en est, le pin non)
    const gh = caduc && nu
      // LA CIME NUE — dérivée de la feuillue (une branche par grappe), aux tons du FÛT. Aucune
      // loi de teinte ne s'y applique : les quatre lignes de la planche y sont donc IDENTIQUES,
      // et c'est le résultat, pas un oubli.
      ? cimeNue(W, m.houppierS, forme, v.fut, PORT_PAR_VARIANTE[v.slug] ?? { axe: 'sympodial', tortueux: 0.18 }, m.recouvrementPx, m.colonneW, GRAINE)
      : cimeEnGrappes(
        W, m.houppierS, forme,
        saisonnier ? loi.tons(v.tons, jour) : v.tons, GRAINE,
        saisonnier && loi.panache !== undefined ? loi.panache(v.tons, jour, GRAINE) : undefined,
        // LA NEIGE ne se pose que sur les PERSISTANTS (demande d'Alexis) : un feuillu est nu.
        !caduc ? (charge ?? 0) : 0,
      )
    poser(gh.ton, W, m.houppierS, ox, oy, cx - W / 2, pied - ancrageHouppierPx(m) - m.houppierS)
  }
}

/** Pose un grain (tableau de `rgb(r,g,b)`) à (dx, dy) dans le panneau d'origine (ox, oy). */
function poser(ton: readonly (string | null)[], W: number, H: number, ox: number, oy: number, dx: number, dy: number): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = ton[y * W + x]
    if (t === null || t === undefined) continue
    const mm = /rgb\((\d+),(\d+),(\d+)\)/.exec(t)
    if (!mm) continue
    const c = (Number(mm[1]) << 16) | (Number(mm[2]) << 8) | Number(mm[3])
    const px = Math.round(dx) + x, py = Math.round(dy) + y
    for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) pixel(ox + px * zoom + zx, oy + py * zoom + zy, c)
  }
}

if (NEIGE) {
  for (let c = 0; c < CHARGES.length; c++) texte(CHARGES[c]![1], MARGE + c * (PANNEAU_W * zoom + MARGE), MARGE, 2, 0xd8d4c8)
  const oy = MARGE + LIB_H
  texte('PERSISTANTS  GRAND FROID J105', MARGE, oy, 2, 0xf0c46a)
  for (let c = 0; c < CHARGES.length; c++) {
    panneau(MARGE + c * (PANNEAU_W * zoom + MARGE), oy + LIB_H, 105, false, LOIS[0]!, CHARGES[c]![0])
  }
} else {
  // ── l'en-tête : les quatre saisons
  for (let s = 0; s < SAISONS.length; s++) {
    texte(SAISONS[s]![1], MARGE + s * (PANNEAU_W * zoom + MARGE), MARGE, 2, 0xd8d4c8)
  }
  // ── les quatre lois
  for (let l = 0; l < LOIS.length; l++) {
    const oy = MARGE + LIB_H + l * (LIB_H + PANNEAU_H * zoom + MARGE)
    texte(LOIS[l]!.nom, MARGE, oy, 2, 0xf0c46a)
    for (let s = 0; s < SAISONS.length; s++) {
      panneau(MARGE + s * (PANNEAU_W * zoom + MARGE), oy + LIB_H, SAISONS[s]![0], SAISONS[s]![2], LOIS[l]!)
    }
  }
}

/* ═══ ÉCRITURE PNG (le même encodeur maison qu'`apercu-carte` et `planche-saisons`) ═════════ */
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
console.log(`haie : ${HAIE.map(([s]) => s).join(' · ')} (le pin ne tourne jamais — G6)`)
console.log(`hauteurs : ${HAIE.map(([s]) => `${s} ${hauteurPx(VARIANTES[s]!.mesures)}px`).join(' · ')}`)
