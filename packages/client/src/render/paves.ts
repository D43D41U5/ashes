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
 * ═══ LA BERGE EST UN PAVÉ DE TERRE SUR L'EAU (décision d'Alexis, 2026-08-22, « très bien la reco ») ═══
 *
 * L'eau CÈDE à toute terre : elle est dans l'ordre de recouvrement, tout en bas (priorité 0). La
 * terre déborde donc sur elle avec sa frange, son liseré et son ombre portée — exactement comme
 * la prairie sur la litière — plus UNE marque neuve : le RESSAC, 1 px clair sur l'eau sous la
 * pénombre, l'eau qui mouille le pied de la berge. Le haut-fond reste une SURFACE : aucun
 * pavé entre haut-fond et profond (refusé sur planche).
 *
 * Mais le shader d'eau dessine PAR-DESSUS le sol. Tout ce qui tombe sur une tuile d'eau sort
 * donc dans une SECONDE image, le SURPLOMB, que la couche pose au-dessus du shader : la frange
 * de terre (opaque), l'ombre et la pénombre (noir à l'alpha du facteur), le ressac (blanc à
 * l'alpha). Le reste de l'eau y est transparent — le shader garde sa surface.
 *
 * ═══ LE MARAIS EST UNE SURFACE (décision d'Alexis, 2026-08-22, « ok pour la reco ») ═══
 *
 * Marais, tourbière et prairie humide étaient tous au rang 4 : à égalité, aucun ne cède à l'autre
 * et l'ombrage ne trace rien — une COUTURE NUE (MESURÉ : 1 048 bords marais / prairie humide sur
 * la seed 2026, 12 % de tous les bords terre-terre de la carte). La règle de R13 s'étend : le
 * marais est de l'eau qui a de la boue, donc une SURFACE, sans épaisseur. Il prend rang 1 — au-
 * dessus de l'eau (0), sous tout ce qui pousse — et le reste se DÉRIVE : la prairie humide est une
 * berge sur le marais (frange, liseré, ombre portée, ressac), et le marais glisse dans l'eau d'une
 * frange seule. Une surface n'a ni liseré, ni arête, ni tranche, ni brin, et NE PORTE PAS D'OMBRE
 * (pas d'épaisseur, pas d'ombre) — elle ne fait que déborder.
 *
 * ═══ LES STRUCTURELS GARDENT LEURS COUCHES (R10) ═══
 *
 * La falaise, le mur, le vide ne sont jamais propriétaires par débordement et ne reçoivent
 * aucune frange : leurs pixels restent TRANSPARENTS, le bake y reste seul maître. Le pavé voisin
 * garde son liseré contre eux.
 *
 * PUR : aucun import Phaser. La cuisson rend deux tampons RGBA (sol, surplomb) que
 * `scenes/world/pave-layer.ts` verse dans des `CanvasTexture`. Testé en Node (`paves.test.ts`).
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
  /** Le ressac : 1 px clair sur l'eau, sous la pénombre d'une berge (4 px sous son bord bas). */
  RESSAC: 1.22,
  /**
   * LE MOUILLÉ DE LA FRANGE — la terre qui déborde sur l'eau est MOUILLÉE.
   *
   * Le voile de sol humide (`water-layer.ts`, spec eau-vivante R10') ne peint que les tuiles de
   * TERRE : la frange de la berge, elle, vit sur une tuile d'EAU, et restait donc sèche et claire.
   * Le mouillé se lisait alors comme un TRAIT décollé du bord (MESURÉ sur berge de rivière,
   * midi : herbe sèche 95, mouillé 88, frange sèche 108, ressac 123, eau 111 — un creux entre
   * deux clairs). Même voile, même teinte, au cran PLEIN : la frange est dans l'eau, c'est la
   * partie la plus mouillée de la berge.
   */
  MOUILLE: 0.26,
  /**
   * LE DÉBORD DU CHUNK, en px d'art (2026-08-23, Alexis : « je vois toujours des traits en
   * forme de carré d'un pixel »).
   *
   * MESURÉ : le trait tombait sur un bord de chunk, à un DEMI-pixel d'écran (chunk 44, bord
   * monde 11264, `worldView.x` 11078,79, zoom 3,3125 → écran 613,5). Le pixel de la couture
   * est alors couvert à 50 % par chaque image : écrit deux fois en alpha partiel, il laisse
   * passer un quart de fond — un trait sombre d'un pixel, Δ 23 de luminance. L'image cuite,
   * elle, est PROPRE (relevée texel par texel : Δ ≤ 1,3, le pas de couleur normal d'une
   * tuile à l'autre) : la couture naît à la composition, pas à la cuisson.
   *
   * ET `roundPixels` NE PEUT PAS LA RATTRAPER : Phaser 4 le désactive dès que le zoom n'est
   * pas entier (`Camera.js` : `renderRoundPixels = roundPixels && Number.isInteger(zoomX)`),
   * or le nôtre se dérive de la hauteur de fenêtre (`zoomForFraming` — 2,25 au banc, 3,3125
   * sur l'écran d'Alexis). Le drapeau de `main.ts` est inerte en jeu.
   *
   * D'où le débord : chaque chunk se cuit UN PIXEL PLUS GRAND de chaque côté et se pose
   * décalé d'autant. Les images se RECOUVRENT, le pixel du bord est toujours couvert par de
   * l'art opaque, et le fond ne passe plus. Le recouvrement ne double rien : tout le calcul
   * est positionnel (`hash2` sur les coordonnées MONDE), donc le voisin recuit ce pixel à
   * l'identique — c'est déjà ce que promettait la marge d'une tuile de `cuireChunk`.
   */
  BAVE: 1,
} as const

/** La teinte du voile humide — la MÊME que celle du shader (`water-layer.ts`), en 0-255. */
const MOUILLE_TEINTE = [0.16 * 255, 0.14 * 255, 0.09 * 255] as const

/**
 * LES TERRAINS VIRTUELS DU MANTEAU (`render/manteau.ts`) — la neige au sol et la glace se
 * cuisent avec CETTE grammaire, dans une seconde couche posée au-dessus du sol. Ils n'existent
 * pas sur la carte : la couche les fabrique tuile par tuile depuis `neigeAuSol` / `estGele`.
 *
 *   • `DESSOUS` — « le sol qu'on ne repeint pas » : une SURFACE de rang 0, transparente. La
 *     neige déborde dessus (frange opaque) et y porte son ombre (voile noir) — exactement le
 *     chemin de l'eau sous la berge, SANS ressac (un pré sous une congère ne clapote pas).
 *   • `GLACE_GUE`, `GLACE_LAC` — la glace : une surface opaque (pas d'épaisseur, donc ni liseré
 *     ni arête ni brin), dessinée dans le SOL de la couche, et qui reçoit la frange et l'ombre
 *     de la neige dans son SURPLOMB. Même rang que `DESSOUS` : entre la terre nue et la glace,
 *     c'est la BERGE du sol (R13) qui trace le bord, pas le manteau.
 *   • `MANTEAU` — la neige : un pavé à épaisseur, au-dessus de tout ; `MANTEAU_PROFOND`, la
 *     neige jusqu'aux genoux, un pavé de plus sur la poudreuse (gel.md G9).
 */
export const DESSOUS = 100
export const GLACE_GUE = 101
export const GLACE_LAC = 102
export const MANTEAU = 103
/** La neige JUSQU'AUX GENOUX (gel.md G9) : un pavé sur la poudreuse — même frontière. */
export const MANTEAU_PROFOND = 104

/**
 * L'ORDRE DE RECOUVREMENT — qui déborde sur qui. Plus haut = dessus. Un terrain absent vaut 0
 * (il ne recouvre rien). Les STRUCTURELS ne sont pas dans la table : `prioriteDe` leur rend −1.
 *
 * La logique : les surfaces tout en bas (`SURFACES` : l'eau, puis le marais), la sente, le minéral
 * (la roche affleure, tout pousse par-dessus), puis la litière (le sous-bois, le plus « sol »),
 * la roselière, l'humide et la lande sèche, l'herbe, l'alpage, et la fleuraie tout en haut (ce
 * qui fleurit est ce qui se voit). Regardé sur la planche du
 * 2026-08-22 ; se recalibre en regardant, pas en raisonnant.
 */
export const PRIORITE_PAVE: Record<number, number> = {
  // Les rangs 0 et 1 sont aux SURFACES (eau, marais) : toute terre commence à 2.
  2: 2, // road — la sente, battue, sous toute terre (et sur le marais : une chaussée)
  5: 3, // rock
  9: 3, // scree
  16: 3, // boulders
  3: 4, // forest — la litière
  22: 4, // old_growth
  13: 4, // pine
  14: 4, // larch
  21: 4, // burnt_forest
  24: 4, // willow
  19: 5, // reed_marsh — les roseaux sortent du marais (A11 : marais < roselière < prairie)
  26: 6, // juniper_heath — la lande sèche
  25: 6, // wet_meadow
  1: 7, // grass
  11: 7, // heath
  10: 7, // snow
  15: 7, // glacier
  12: 8, // alpine_meadow
  17: 9, // flower_meadow
  20: 9, // alpine_flowers
  [MANTEAU]: 20, // la neige au sol (`render/manteau.ts`) : par-dessus tout ce qui pousse
  [MANTEAU_PROFOND]: 21, // la neige profonde, sur la poudreuse
}

/**
 * LES SURFACES — ce qui n'a pas d'épaisseur : l'eau, et le marais qui est de l'eau avec de la
 * boue. Leur rang dit qui déborde sur qui ENTRE surfaces (la boue glisse sur l'eau) ; toute terre
 * de `PRIORITE_PAVE` est au-dessus. Une surface déborde d'une frange seule : ni liseré, ni arête,
 * ni tranche, ni brin, et elle ne porte aucune ombre.
 */
export const SURFACES: Record<number, number> = {
  4: 0, // shallow_water
  6: 0, // deep_water
  8: 1, // marsh
  18: 1, // peat_bog
  [DESSOUS]: 0,
  [GLACE_GUE]: 0,
  [GLACE_LAC]: 0,
}

/** Les terrains STRUCTURELS : jamais propriétaires par débordement, transparents dans le chunk. */
const STRUCTURELS = new Set<number>([0, 7, 23]) // void, wall, cliff

export function estStructurel(t: number): boolean {
  return STRUCTURELS.has(t)
}

/** L'eau — elle cède à toute terre, et ce qui tombe sur elle va au SURPLOMB. */
export function estEau(t: number): boolean {
  return t === 4 || t === 6 // shallow_water, deep_water
}

/** La glace du manteau — une surface opaque, dans le sol de la couche. */
export function estGlace(t: number): boolean {
  return t === GLACE_GUE || t === GLACE_LAC
}

/** Un VOILE : ce qui, propriétaire d'un pixel, n'y dessine rien d'opaque — l'eau (le shader
 *  est dessous) et le dessous transparent du manteau. Son ombre et son ressac vont au surplomb. */
export function estVoile(t: number): boolean {
  return estEau(t) || t === DESSOUS
}

/** Une tuile SURPLOMBÉE : ce qu'un pavé à épaisseur y pose (sa frange) sort dans la seconde
 *  image, au-dessus de ce qui se dessine sur la tuile — le shader d'eau, ou la glace. */
export function estSurplombee(t: number): boolean {
  return estVoile(t) || estGlace(t)
}

/** Une surface : l'eau ou le marais — sans épaisseur (voir `SURFACES`). */
export function estSurface(t: number): boolean {
  return SURFACES[t] !== undefined
}

/** La priorité d'un terrain : −1 pour un structurel, le rang de surface pour l'eau et le marais,
 *  0 pour un terrain sans rang (il ne recouvre rien), sinon la table. */
export function prioriteDe(t: number): number {
  if (STRUCTURELS.has(t)) return -1
  const surface = SURFACES[t]
  if (surface !== undefined) return surface
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

/** Le côté d'un chunk en px d'art, SANS le débord — la maille du monde (16 tuiles × 16 px). */
export const PAVE_COTE = PAVE.CHUNK * PAVE_PX
/** Le côté de l'IMAGE cuite, débord compris : ce que mesurent les textures posées. */
export const PAVE_COTE_BAVE = PAVE_COTE + 2 * PAVE.BAVE

export interface ChunkCuit {
  /** Le sol, SOUS le shader d'eau : opaque sur la terre, transparent sur l'eau et les structurels. */
  sol: Uint8ClampedArray
  /** Le surplomb, AU-DESSUS du shader d'eau : ce qui tombe sur une tuile d'eau — frange de terre,
   *  ombre, ressac. `null` si le chunk n'a pas d'eau (aucune texture à poser). */
  surplomb: Uint8ClampedArray | null
}

/**
 * CUIT UN CHUNK : rend les tampons RGBA de `PAVE_COTE_BAVE²` pixels (le chunk PLUS son débord
 * d'un pixel tout autour, voir `PAVE.BAVE`), ligne par ligne, haut en bas. Le pixel (0, 0) du
 * tampon est donc le pixel monde `(cx × CHUNK × 16) − 1` : qui pose l'image la décale d'autant.
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
export function cuireChunk(p: CuissonChunk): ChunkCuit {
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
  // Le tampon rendu porte le DÉBORD (`PAVE.BAVE`) tout autour : il commence un pixel AVANT le
  // chunk et finit un pixel après, pour que deux images voisines se recouvrent au lieu de se
  // toucher. La marge locale fait une TUILE — lire un pixel de plus reste largement dedans.
  const SB = PAVE_COTE_BAVE
  const out = new Uint8ClampedArray(SB * SB * 4)
  // Le surplomb n'est alloué que si le chunk (marge comprise) touche une tuile surplombée.
  let eauVue = false
  for (let k = 0; k < L * L && !eauVue; k++) eauVue = estSurplombee(terr[k]!)
  const sur = eauVue ? new Uint8ClampedArray(SB * SB * 4) : null
  const B = PAVE.BRINS_PAR_TUILE
  for (let y = 0; y < SB; y++) {
    const py = y + P - PAVE.BAVE
    // La ligne de cellules de grain (GRAIN_CELLS est une puissance de deux : le masque tuile).
    const cyG = (((ty0 * P + py) / GRAIN_CELL_PX) | 0) & (GRAIN_CELLS - 1)
    const ly = (py / P) | 0
    for (let x = 0; x < SB; x++) {
      const px = x + P - PAVE.BAVE
      const i = py * LP + px
      const pk = ownP[i]!
      if (pk < 0) continue // structurel : transparent, le bake reste maître
      const k = owner[i]!
      const t = ownT[i]!
      const o = (y * SB + x) * 4
      // Le pixel est-il SUR une tuile surplombée (eau, dessous, glace) ? (sa propre tuile, pas
      // son propriétaire)
      const tSol = terr[ly * L + ((px / P) | 0)]!
      const surEau = estSurplombee(tSol)
      // Le propriétaire est-il une SURFACE (eau, marais) ? Pas d'épaisseur : ni liseré, ni arête,
      // ni tranche, ni brin — et l'ombre et le ressac ne viennent que d'un pavé à épaisseur.
      const tSurf = estSurface(t)
      // Le pavé du DESSOUS se lit au terrain (deux tuiles de même terrain ne font pas de bord),
      // celui du DESSUS aussi.
      const iU = i - LP, iD = i + LP, iL = i - 1, iR = i + 1
      const basU = ownT[iU] !== t && ownP[iU]! < pk
      const basD = ownT[iD] !== t && ownP[iD]! < pk
      const basL = ownT[iL] !== t && ownP[iL]! < pk
      const basR = ownT[iR] !== t && ownP[iR]! < pk
      let f: number
      // Un pavé à épaisseur au-dessus de ce pixel (à `n` lignes) : celui qui porte une ombre.
      const domine = (j: number): boolean => ownT[j] !== t && ownP[j]! > pk && !estSurface(ownT[j]!)
      // Une surface n'a ni liseré ni arête ni tranche ; elle reçoit l'ombre de la berge, puis le
      // ressac — d'un pavé à épaisseur seulement : la boue qui glisse sur l'eau n'ombre rien.
      if (!tSurf && (basD || basL || basR)) f = PAVE.LISERE
      else if (!tSurf && basU) f = PAVE.ARETE_HAUTE
      else if (!tSurf && ownT[iD + LP] !== t && ownP[iD + LP]! < pk) f = PAVE.TRANCHE
      else if (domine(iU) || domine(iU - LP)) f = PAVE.OMBRE
      else if (domine(iU - 2 * LP)) f = PAVE.PENOMBRE
      // Le ressac : sur l'eau et la boue — jamais sur le dessous ni sur la glace (ça ne clapote pas).
      else if (tSurf && t !== DESSOUS && !estGlace(t) && domine(iU - 3 * LP)) f = PAVE.RESSAC
      else if (domine(iL) || domine(iR)) f = PAVE.OMBRE_LATERALE
      else if (estVoile(t)) continue // l'eau nue, le dessous nu : rien à peindre ici
      else if (tSurf) f = 1 // le marais nu, la glace nue : plat, sans brin
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
      if (estVoile(t)) {
        // L'EAU OMBRÉE OU MOUILLÉE (et le dessous ombré par la neige) va au surplomb, en voile :
        // noir à l'alpha (1 − f) pour assombrir, blanc à l'alpha (f − 1) pour éclaircir — ce qui
        // est dessous (le shader, le sol) garde sa matière.
        if (!sur) continue
        const voile = f < 1 ? 0 : 255
        sur[o] = voile
        sur[o + 1] = voile
        sur[o + 2] = voile
        sur[o + 3] = Math.round(255 * Math.min(1, Math.abs(1 - f)))
        continue
      }
      const c = coul[k]!
      // Le grain est POSITIONNEL (cellule de 4 px monde), pas relatif au propriétaire : deux
      // tuiles voisines de même famille partagent leur trame sans couture.
      const trame = trames[k]
      const g = trame ? f * trame[cyG * GRAIN_CELLS + ((((tx0 * P + px) / GRAIN_CELL_PX) | 0) & (GRAIN_CELLS - 1))]! : f
      // La terre SUR une tuile d'eau (la frange de la berge), la neige sur la glace ou le dessous :
      // au-dessus de ce que la tuile dessine. La GLACE, elle, est opaque : elle reste dans le sol
      // de sa couche (elle est la matière de sa tuile, pas un débordement).
      const cible = surEau && sur && !estGlace(t) ? sur : out
      // Sur l'EAU (pas sur le dessous ni la glace), la frange prend le voile humide : la berge
      // mouillée ne s'arrête plus au trait de rive, elle y entre. Voir PAVE.MOUILLE.
      const m = estEau(tSol) ? PAVE.MOUILLE : 0
      const sec = 1 - m
      cible[o] = ((c >> 16) & 0xff) * g * sec + MOUILLE_TEINTE[0] * m
      cible[o + 1] = ((c >> 8) & 0xff) * g * sec + MOUILLE_TEINTE[1] * m
      cible[o + 2] = (c & 0xff) * g * sec + MOUILLE_TEINTE[2] * m
      cible[o + 3] = 255
    }
  }
  return { sol: out, surplomb: sur }
}
