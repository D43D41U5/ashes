/**
 * LES PAVÉS DESSINÉS — le sol à la même échelle que les props (spec `sol-dessine.md` R8-R10).
 *
 * *Décision d'Alexis, 2026-08-22 : « 2 et 4 c'est le type de DA que je kiffe » — ce qui pousse est
 * mou, ce qui est taillé est droit. Le sol n'est plus une CARTE en aplats de 16 px sous des props
 * cubiques à grain 4 px : c'est un TERRAIN dessiné, cuit à 16 px par tuile, par chunks.*
 *
 * ═══ CE QUE DESSINE UN PAVÉ ═══
 *
 * Chaque tache de terrain est un pavé posé SUR le terrain du dessous (un ordre de recouvrement :
 * l'herbe recouvre la litière, la fleuraie recouvre l'herbe…). Le pavé du dessus reçoit :
 *   - une FRANGE irrégulière (2 à 5 px, par colonne de 4 px) qui déborde sur le terrain du dessous
 *     — c'est elle qui fait l'organique à l'écran, sur des formes qui sont déjà à la tuile (R1) ;
 *   - un LISERÉ sombre sur ses bords bas et latéraux (l'épaisseur du pavé), une ARÊTE HAUTE
 *     éclairée, une seconde rangée en TRANCHE ;
 *   - une OMBRE PORTÉE sur le terrain du dessous, sous le pavé qui le domine ;
 *   - des BRINS : deux marques par tuile, dans la gamme du terrain.
 * Le grain de famille (`grain-sol.ts`) entre DIRECTEMENT dans la cuisson — plus de passe MULTIPLY
 * séparée : une seule image, une seule échelle.
 *
 * ═══ POURQUOI UN ALGORITHME DE PROPRIÉTAIRE, PAS UN TILESET ═══
 *
 * Un autotile à 47 cas suppose des bords DESSINÉS à la main pour chaque couple de terrains. Ici
 * les bords se DÉRIVENT : chaque pixel appartient au pavé de PLUS HAUTE priorité dont le
 * rectangle élargi (la frange) le contient. Les 47 cas, les coins convexes (chanfrein) et
 * rentrants (union) sortent tout seuls, pour n'importe quel couple de terrains — et l'ordre de
 * recouvrement est UNE table, pas quinze planches.
 *
 * ═══ LES STRUCTURELS GARDENT LEURS COUCHES (R10) ═══
 *
 * L'eau, la falaise, le mur, le vide ne sont jamais propriétaires par débordement et ne reçoivent
 * aucune frange : leurs pixels restent TRANSPARENTS dans le chunk, le bake (et le shader d'eau
 * au-dessus) y restent seuls maîtres. Le pavé voisin garde son liseré contre eux : une berge se
 * lit comme un bord.
 *
 * PUR : aucun import Phaser. La cuisson rend un tampon RGBA que `scenes/world/pave-layer.ts`
 * verse dans une `CanvasTexture`. Testé en Node (`paves.test.ts`).
 */
import { hash2 } from '@ashes/sim'
import { TILE_PX } from './framing'
import { GRAIN_CELLS, GRAIN_CELL_PX } from './grain-sol'

/** Le côté d'une tuile en pixels de cuisson : la maille des props. */
export const PAVE_PX = TILE_PX

/** Réglages des pavés — ce qui se règle en REGARDANT une capture (da-feeling). */
export const PAVE = {
  /** Tuiles par côté d'un chunk. 16 → une texture de 256 px ; la vue (36×20 tuiles) en tient
   *  3×2 à 4×3. MESURÉ (R12, Node/tsx, 2026-08-22) : 25 ms par chunk de 32 à chaud, donc ~6 ms
   *  par chunk de 16 — la cuisson d'un chunk neuf au fil du déplacement tient dans une frame. */
  CHUNK: 16,
  /** Profondeur de la frange, en px : `MIN + floor(hash × (MAX − MIN + 1))`, par colonne de 4 px. */
  FRANGE_MIN: 2,
  FRANGE_MAX: 5,
  /** Le liseré : bords bas et latéraux du pavé — l'épaisseur qu'on voit. */
  LISERE: 0.55,
  /** L'arête haute, éclairée. */
  ARETE_HAUTE: 1.16,
  /** La seconde rangée au-dessus d'un bord bas : la tranche. */
  TRANCHE: 0.8,
  /** L'ombre portée d'un pavé sur le terrain du dessous : 2 px francs, puis 1 px de pénombre. */
  OMBRE: 0.72,
  PENOMBRE: 0.86,
  /** L'ombre latérale, plus courte (1 px). */
  OMBRE_LATERALE: 0.8,
  /** Les brins : deux marques de 1×2 px par tuile, claires, avec un pixel sombre en pied. */
  BRIN_CLAIR: 1.2,
  BRIN_SOMBRE: 0.8,
  BRINS_PAR_TUILE: 2,
} as const

/**
 * L'ORDRE DE RECOUVREMENT — qui déborde sur qui. Plus haut = dessus. Un terrain absent vaut 0
 * (il ne recouvre rien). Les STRUCTURELS ne sont pas dans la table : `prioriteDe` leur rend −1.
 *
 * La logique : le minéral dessous (la roche affleure, tout pousse par-dessus), puis la litière
 * (le sous-bois, le plus « sol »), puis l'humide, la lande sèche, l'herbe, l'alpage, et la
 * fleuraie tout en haut (ce qui fleurit est ce qui se voit). Regardé sur la planche du
 * 2026-08-22 ; se recalibre en regardant, pas en raisonnant.
 */
export const PRIORITE_PAVE: Record<number, number> = {
  2: 1, // road — la sente, battue, sous tout
  5: 2, // rock
  9: 2, // scree
  16: 2, // boulders
  3: 3, // forest — la litière
  22: 3, // old_growth
  13: 3, // pine
  14: 3, // larch
  21: 3, // burnt_forest
  24: 3, // willow
  26: 4, // juniper_heath — la lande sèche
  8: 4, // marsh
  18: 4, // peat_bog
  19: 4, // reed_marsh
  25: 4, // wet_meadow
  1: 5, // grass
  11: 5, // heath
  10: 5, // snow
  15: 5, // glacier
  12: 6, // alpine_meadow
  17: 7, // flower_meadow
  20: 7, // alpine_flowers
}

/** Les terrains STRUCTURELS : jamais propriétaires par débordement, transparents dans le chunk. */
const STRUCTURELS = new Set<number>([0, 4, 6, 7, 23]) // void, shallow_water, deep_water, wall, cliff

export function estStructurel(t: number): boolean {
  return STRUCTURELS.has(t)
}

/** La priorité d'un terrain : −1 pour un structurel, 0 pour un terrain sans rang, sinon la table. */
export function prioriteDe(t: number): number {
  if (STRUCTURELS.has(t)) return -1
  return PRIORITE_PAVE[t] ?? 0
}

/** Côtés d'une tuile, pour `frange`. */
export const COTE_N = 0
export const COTE_E = 1
export const COTE_S = 2
export const COTE_O = 3

/** La profondeur de frange d'un côté d'une tuile, par colonne (ou ligne) de 4 px : 2..5,
 *  irrégulière, DÉTERMINISTE par position (deux cuissons du même chunk sont identiques). */
export function frange(tx: number, ty: number, cote: number, along: number): number {
  const n = PAVE.FRANGE_MAX - PAVE.FRANGE_MIN + 1
  return PAVE.FRANGE_MIN + Math.floor(hash2(tx * 4 + cote, ty * 4 + along, 0xf1) * n)
}

export interface CuissonChunk {
  /** Coordonnées du chunk, en chunks. */
  cx: number
  cy: number
  /** Le terrain d'une tuile (coordonnées carte) — hors carte : un structurel (void). */
  terrainAt: (tx: number, ty: number) => number
  /** La couleur de sol d'une tuile, 0xRRGGBB — le bake, modulation de zone et damier compris. */
  couleurAt: (tx: number, ty: number) => number
  /** La TRAME de grain d'un terrain : `GRAIN_CELLS²` facteurs, une cellule de `GRAIN_CELL_PX`
   *  px monde, tuilée (`grain-sol.ts`) — ou `null` pour un terrain sans matière. */
  trameDe: (t: number) => Float32Array | null
}

/**
 * CUIT UN CHUNK : rend le tampon RGBA de `(CHUNK × 16)²` pixels, ligne par ligne, haut en bas.
 *
 * Deux passes. ① Les PROPRIÉTAIRES : chaque pixel appartient d'abord à sa tuile ; puis chaque
 * tuile étend sa frange sur ses voisines de priorité inférieure (côtés, puis chanfreins de
 * coin) — un pixel ne change de main que pour un pavé STRICTEMENT plus haut. ② L'OMBRAGE :
 * liseré, arête, tranche, ombre portée, brins, lus sur la carte des propriétaires.
 *
 * La grille locale porte UNE tuile de marge tout autour du chunk (les franges et les ombres
 * lisent jusqu'à 5 px hors du chunk) : aucun accès hors tableau, aucune couture entre chunks —
 * la marge est recuite à l'identique par le chunk voisin, par construction (tout est
 * positionnel).
 */
export function cuireChunk(p: CuissonChunk): Uint8ClampedArray {
  const N = PAVE.CHUNK
  const P = PAVE_PX
  const L = N + 2 // tuiles locales, marge comprise
  const LP = L * P // pixels locaux
  const tx0 = p.cx * N - 1 // tuile carte de la colonne locale 0
  const ty0 = p.cy * N - 1

  // ── Les tuiles locales : terrain, priorité, couleur, trame, brins ──
  const terr = new Int16Array(L * L)
  const prio = new Int8Array(L * L)
  const coul = new Uint32Array(L * L)
  const trames: (Float32Array | null)[] = new Array(L * L)
  const brins = new Int8Array(L * L * PAVE.BRINS_PAR_TUILE * 2)
  for (let ly = 0; ly < L; ly++) {
    for (let lx = 0; lx < L; lx++) {
      const k = ly * L + lx
      const t = p.terrainAt(tx0 + lx, ty0 + ly)
      terr[k] = t
      prio[k] = prioriteDe(t)
      coul[k] = p.couleurAt(tx0 + lx, ty0 + ly)
      trames[k] = p.trameDe(t)
      for (let j = 0; j < PAVE.BRINS_PAR_TUILE; j++) {
        brins[(k * PAVE.BRINS_PAR_TUILE + j) * 2] = 1 + Math.floor(hash2(tx0 + lx, ty0 + ly, 3 + j) * (P - 3))
        brins[(k * PAVE.BRINS_PAR_TUILE + j) * 2 + 1] = 1 + Math.floor(hash2(tx0 + lx, ty0 + ly, 5 + j) * (P - 4))
      }
    }
  }

  // ── ① Les propriétaires, à la tuile locale ──
  const owner = new Int32Array(LP * LP)
  for (let py = 0; py < LP; py++) {
    const ly = (py / P) | 0
    for (let px = 0; px < LP; px++) owner[py * LP + px] = ly * L + ((px / P) | 0)
  }
  /** Donne le pixel (px, py) au pavé `k` s'il domine strictement le propriétaire courant. */
  const prendre = (px: number, py: number, k: number, pk: number): void => {
    if (px < 0 || py < 0 || px >= LP || py >= LP) return
    const i = py * LP + px
    if (prio[owner[i]!]! < pk) owner[i] = k
  }
  for (let ly = 0; ly < L; ly++) {
    for (let lx = 0; lx < L; lx++) {
      const k = ly * L + lx
      const pk = prio[k]!
      if (pk <= 0) continue // structurel ou sans rang : ne déborde jamais
      const gx = tx0 + lx
      const gy = ty0 + ly
      const x0 = lx * P
      const y0 = ly * P
      const x1 = x0 + P
      const y1 = y0 + P
      // Un voisin de côté cède-t-il ? (dans la grille locale, non structurel, priorité plus basse)
      const cede = (nx: number, ny: number): boolean => {
        if (nx < 0 || ny < 0 || nx >= L || ny >= L) return false
        const q = prio[ny * L + nx]!
        return q >= 0 && q < pk
      }
      const nordCede = cede(lx, ly - 1)
      const sudCede = cede(lx, ly + 1)
      const ouestCede = cede(lx - 1, ly)
      const estCede = cede(lx + 1, ly)
      for (let c = 0; c < P / 4; c++) {
        if (nordCede) {
          const d = frange(gx, gy, COTE_N, c)
          for (let dy = 1; dy <= d; dy++) for (let u = 0; u < 4; u++) prendre(x0 + 4 * c + u, y0 - dy, k, pk)
        }
        if (sudCede) {
          const d = frange(gx, gy, COTE_S, c)
          for (let dy = 0; dy < d; dy++) for (let u = 0; u < 4; u++) prendre(x0 + 4 * c + u, y1 + dy, k, pk)
        }
        if (ouestCede) {
          const d = frange(gx, gy, COTE_O, c)
          for (let dx = 1; dx <= d; dx++) for (let u = 0; u < 4; u++) prendre(x0 - dx, y0 + 4 * c + u, k, pk)
        }
        if (estCede) {
          const d = frange(gx, gy, COTE_E, c)
          for (let dx = 0; dx < d; dx++) for (let u = 0; u < 4; u++) prendre(x1 + dx, y0 + 4 * c + u, k, pk)
        }
      }
      // Les CHANFREINS de coin : dans la diagonale qui cède, un triangle `ox + oy ≤ f − 1`, avec
      // f la plus petite des deux franges qui se rencontrent. Un coin convexe s'arrondit, un
      // coin rentrant se remplit par l'union des deux côtés.
      const derniere = P / 4 - 1
      const coin = (sx: number, sy: number): void => {
        if (!cede(lx + sx, ly + sy)) return
        const fH = frange(gx, gy, sy < 0 ? COTE_N : COTE_S, sx < 0 ? 0 : derniere)
        const fV = frange(gx, gy, sx < 0 ? COTE_O : COTE_E, sy < 0 ? 0 : derniere)
        const f = Math.min(fH, fV)
        for (let oy = 1; oy <= f - 2; oy++) {
          for (let ox = 1; ox + oy <= f - 1; ox++) {
            const px = sx < 0 ? x0 - ox : x1 - 1 + ox
            const py = sy < 0 ? y0 - oy : y1 - 1 + oy
            prendre(px, py, k, pk)
          }
        }
      }
      coin(-1, -1)
      coin(1, -1)
      coin(-1, 1)
      coin(1, 1)
    }
  }

  // ── ② L'ombrage, sur les pixels du chunk (la marge n'est pas rendue) ──
  //
  // Le terrain et la priorité du PROPRIÉTAIRE de chaque pixel, aplatis une fois : la passe
  // d'ombrage lit huit voisins par pixel, et c'est elle qui fait le coût d'un chunk (MESURÉ :
  // 600 ms par chunk avec des fermetures et des recherches par pixel ; des tableaux typés
  // ramènent ça à quelques ms).
  const ownT = new Int16Array(LP * LP)
  const ownP = new Int8Array(LP * LP)
  for (let i = 0; i < LP * LP; i++) {
    const k = owner[i]!
    ownT[i] = terr[k]!
    ownP[i] = prio[k]!
  }
  const S = N * P
  const out = new Uint8ClampedArray(S * S * 4)
  const B = PAVE.BRINS_PAR_TUILE
  for (let y = 0; y < S; y++) {
    const py = y + P
    // La ligne de cellules de grain (GRAIN_CELLS est une puissance de deux : le masque tuile).
    const cyG = (((ty0 * P + py) / GRAIN_CELL_PX) | 0) & (GRAIN_CELLS - 1)
    for (let x = 0; x < S; x++) {
      const px = x + P
      const i = py * LP + px
      const pk = ownP[i]!
      if (pk < 0) continue // structurel : transparent, le bake et l'eau restent maîtres
      const k = owner[i]!
      const t = ownT[i]!
      const o = (y * S + x) * 4
      // Le pavé du DESSOUS se lit au terrain (deux tuiles de même terrain ne font pas de bord),
      // celui du DESSUS aussi.
      const iU = i - LP, iD = i + LP, iL = i - 1, iR = i + 1
      const basU = ownT[iU] !== t && ownP[iU]! < pk
      const basD = ownT[iD] !== t && ownP[iD]! < pk
      const basL = ownT[iL] !== t && ownP[iL]! < pk
      const basR = ownT[iR] !== t && ownP[iR]! < pk
      let f: number
      if (basD || basL || basR) f = PAVE.LISERE
      else if (basU) f = PAVE.ARETE_HAUTE
      else if (ownT[iD + LP] !== t && ownP[iD + LP]! < pk) f = PAVE.TRANCHE
      else if ((ownT[iU] !== t && ownP[iU]! > pk) || (ownT[iU - LP] !== t && ownP[iU - LP]! > pk)) f = PAVE.OMBRE
      else if (ownT[iU - 2 * LP] !== t && ownP[iU - 2 * LP]! > pk) f = PAVE.PENOMBRE
      else if ((ownT[iL] !== t && ownP[iL]! > pk) || (ownT[iR] !== t && ownP[iR]! > pk)) f = PAVE.OMBRE_LATERALE
      else {
        f = 1
        // Les brins, dans le repère de la tuile PROPRIÉTAIRE (un brin peut vivre dans la frange).
        const lxk = k % L
        const lyk = (k - lxk) / L
        const ox = px - lxk * P
        const oy = py - lyk * P
        for (let j = 0; j < B; j++) {
          const bx = brins[(k * B + j) * 2]!
          const by = brins[(k * B + j) * 2 + 1]!
          if (ox === bx && (oy === by || oy === by + 1)) f = PAVE.BRIN_CLAIR
          else if (ox === bx + 1 && oy === by + 2) f = PAVE.BRIN_SOMBRE
        }
      }
      const c = coul[k]!
      // Le grain est POSITIONNEL (cellule de 4 px monde), pas relatif au propriétaire : deux
      // tuiles voisines de même famille partagent leur trame sans couture.
      const trame = trames[k]
      const g = trame ? f * trame[cyG * GRAIN_CELLS + ((((tx0 * P + px) / GRAIN_CELL_PX) | 0) & (GRAIN_CELLS - 1))]! : f
      out[o] = ((c >> 16) & 0xff) * g
      out[o + 1] = ((c >> 8) & 0xff) * g
      out[o + 2] = (c & 0xff) * g
      out[o + 3] = 255
    }
  }
  return out
}
