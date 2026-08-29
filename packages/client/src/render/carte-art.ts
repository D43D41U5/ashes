/**
 * ═══ L'ART DE LA CARTE — la vallée redessinée pour être LUE, pas foulée ═══
 *
 * Le bake du sol (`bakeMapTexture`) sert trois maîtres : le lit de l'eau, la source des pavés,
 * et la carte de l'onglet M. Pour les deux premiers ses couleurs sont JUSTES — c'est le sol du
 * jeu, la lumière et la matière font le reste. Plein cadre sur l'écran carte, elles sont CRUES :
 * des aplats saturés sans relief, une rivière en marches d'escalier bleu vif, un bord de monde
 * gris béton (constaté sur capture, 2026-08-28 — « c'est moche », Alexis).
 *
 * Ce module rend donc une PAIRE d'images dérivées du bake, à 1 px/tuile, SANS toucher au bake :
 *
 *   `vive`  — la carte posée : teintes du bake assagies (désaturées, rabattues), falaises en
 *             trait d'encre avec leur ombre portée, liseré de côte sur l'eau, lisière des bois
 *             soulignée, et le bord du monde qui se fond dans l'encre du panneau au lieu de
 *             s'arrêter sur un cadre de roche.
 *   `grise` — la même, GRISÉE : c'est la mémoire. Ce qu'on a arpenté mais qu'on ne VOIT pas en
 *             ce moment se montre dans cette matière-là (décision d'Alexis, 2026-08-28) ; seul
 *             le disque de vue autour du personnage se peint dans la `vive`.
 *
 * PUR : des tableaux d'octets, aucun Phaser, aucun canvas — testable en unitaire, et le
 * consommateur (WorldScene) le verse dans une CanvasTexture comme il l'entend.
 */
import {
  TERRAIN_BOULDERS, TERRAIN_CLIFF, TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_ROCK, TERRAIN_SCREE, TERRAIN_SHALLOW_WATER,
  TERRAIN_VOID, TERRAIN_WILLOW,
  type WorldMap,
} from '@ashes/sim'
import { TERRAIN_COLORS } from './terrain-colors'

/** Les deux matières de la carte — même géométrie, deux états de savoir. */
export interface CarteArt {
  /** RGBA, `width × height` de la carte, 1 px/tuile — ce qu'on VOIT. */
  vive: Uint8ClampedArray
  /** RGBA, même taille — ce dont on se SOUVIENT (grisé). */
  grise: Uint8ClampedArray
}

/** L'encre du jeu (#14141a) : le bord du monde et le jamais-vu sont la même matière. */
export const CARTE_ENCRE = 0x14141a

/**
 * LE RÉGLAGE DE LA CARTE. Il vit ici et non dans `balance.ts` : c'est du réglage d'IMAGE,
 * calibré en regardant l'écran carte — même partage que les blocs du worldgen.
 */
const ART = {
  /** Assagissement des teintes du bake : part de gris mêlée, puis rabattement de valeur.
   *  Franc (0,52) : les verts crayon du bake deviennent des verts de carte — on reconnaît
   *  encore chaque biome, mais plus rien ne crie (constat v1 : à 0,30 l'œil ne voyait rien). */
  DESATURATION: 0.52,
  RABAT: 0.86,
  /** Relèvement des SOMBRES (exposant < 1) : la vieille forêt du bake est presque noire, et
   *  sur l'encre du panneau elle se confondait avec le jamais-vu. Une carte se LIT. */
  GAMMA: 0.8,
  /** L'eau de la carte — ardoise sourde, nettement plus sombre que la terre : une carte n'a
   *  pas de reflets, et la rivière en marches d'escalier cesse de crier en bleu vif. */
  EAU_PEU: 0x2c4356,
  EAU_PROFONDE: 0x1e2f3f,
  /** Le trait d'encre d'une falaise, et l'ombre qu'elle porte au sud (relief à une passe). */
  FALAISE: 0x322f3a,
  OMBRE_FALAISE: 0.7,
  /** Liseré de côte : l'eau qui touche la terre fonce — la rive se dessine toute seule. */
  LISERE_COTE: 0.62,
  /** La lisière d'un bois se souligne — le linework qui fait « carte dessinée ». */
  LISERE_BOIS: 0.8,
  /** LE CADRE DU MONDE : la masse minérale CONNEXE au bord de la carte (flood 4-connexe sur
   *  roche/éboulis/blocs/falaise/vide, borné à `CADRE_PORTEE` tuiles du bord — un massif
   *  INTÉRIEUR qui toucherait la chaîne par accident reste un massif). Elle ne garde qu'un
   *  fantôme de sa couleur (`CADRE_RESTE`) : c'est le bord du monde, pas un biome. */
  CADRE_PORTEE: 70,
  CADRE_RESTE: 0.14,
  /** Et la terre qui JOUXTE le cadre fond vers lui en S sur cette profondeur, en tuiles. */
  CADRE_FONDU_TUILES: 10,
  /** La matière GRISE : part de gris, rabattement, et une pointe d'encre froide. Plus claire
   *  que l'encre d'un cran net : la mémoire doit se lire, pas se deviner. */
  GRIS_PART: 0.78,
  GRIS_RABAT: 0.62,
  GRIS_TEINTE: [0x16, 0x17, 0x1d] as const,
  GRIS_TEINTE_PART: 0.18,
} as const

const BOISE: readonly number[] = [TERRAIN_FOREST, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_WILLOW]
/** Ce dont le CADRE du monde est fait — la matière que le flood du bord peut traverser. */
const MATIERE_DU_CADRE: readonly number[] = [TERRAIN_VOID, TERRAIN_ROCK, TERRAIN_SCREE, TERRAIN_BOULDERS, TERRAIN_CLIFF]

const estEau = (t: number): boolean => t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER

/**
 * LE CHAMP DU CADRE : `0` = tuile du cadre, `n ≤ FONDU` = à `n` tuiles du cadre, `255` = la
 * vallée. Un flood 4-connexe depuis les bords sur la matière du cadre (borné à `CADRE_PORTEE`
 * du bord), puis un BFS de distance sur `CADRE_FONDU_TUILES` — O(N), deux passes.
 */
function champDuCadre(map: WorldMap): Uint8Array {
  const { width, height, terrain } = map
  const N = width * height
  const champ = new Uint8Array(N).fill(255)
  const pile: number[] = []
  const cadre = (i: number): boolean => MATIERE_DU_CADRE.includes(terrain[i] ?? TERRAIN_VOID)
  const borne = (i: number): boolean => {
    const tx = i % width
    const ty = (i - tx) / width
    return Math.min(tx, ty, width - 1 - tx, height - 1 - ty) < ART.CADRE_PORTEE
  }
  for (let tx = 0; tx < width; tx++) {
    for (const i of [tx, (height - 1) * width + tx]) if (cadre(i) && champ[i] !== 0) { champ[i] = 0; pile.push(i) }
  }
  for (let ty = 0; ty < height; ty++) {
    for (const i of [ty * width, ty * width + width - 1]) if (cadre(i) && champ[i] !== 0) { champ[i] = 0; pile.push(i) }
  }
  while (pile.length > 0) {
    const i = pile.pop()!
    const tx = i % width
    for (const v of [tx > 0 ? i - 1 : -1, tx < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (v < 0 || v >= N || champ[v] === 0) continue
      if (cadre(v) && borne(v)) { champ[v] = 0; pile.push(v) }
    }
  }
  // La distance au cadre, bornée au fondu — BFS multi-source depuis la frontière.
  let front: number[] = []
  for (let i = 0; i < N; i++) if (champ[i] === 0) front.push(i)
  for (let d = 1; d <= ART.CADRE_FONDU_TUILES && front.length > 0; d++) {
    const suivant: number[] = []
    for (const i of front) {
      const tx = i % width
      for (const v of [tx > 0 ? i - 1 : -1, tx < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (v < 0 || v >= N || champ[v] !== 255) continue
        champ[v] = d
        suivant.push(v)
      }
    }
    front = suivant
  }
  return champ
}

/** Grise un pixel — LA transformation « mémoire » : ce que la carte sait mais ne voit pas. */
export function griserPx(r: number, g: number, b: number): [number, number, number] {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const p = ART.GRIS_PART
  const q = ART.GRIS_TEINTE_PART
  const t = ART.GRIS_TEINTE
  const mix = (c: number, i: number): number =>
    ((c * (1 - p) + luma * p) * ART.GRIS_RABAT) * (1 - q) + t[i]! * q
  return [mix(r, 0), mix(g, 1), mix(b, 2)]
}

/** La couleur CARTE d'un terrain cendré (27/28/29) — la teinte du jeu, assagie comme le reste. */
export function couleurCendreCarte(tCendre: number): [number, number, number] {
  const c = TERRAIN_COLORS[tCendre] ?? 0x6a6a6a
  return assagir((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)
}

/** Table de relèvement des sombres (`GAMMA`) — 256 entrées, calculée une fois : `Math.pow`
 *  est interdit dans /sim, pas ici (le client n'a pas de contrat de replay), mais on ne va
 *  pas l'appeler 400 000 fois par peinture pour autant. */
const LEVE: Uint8ClampedArray = ((): Uint8ClampedArray => {
  const t = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) t[v] = 255 * Math.pow(v / 255, ART.GAMMA)
  return t
})()

/** L'assagissement commun : désaturation franche, rabattement, puis relèvement des sombres —
 *  la teinte de bake devient une teinte de carte, qui se LIT sur l'encre du panneau. */
function assagir(r: number, g: number, b: number): [number, number, number] {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const d = ART.DESATURATION
  return [
    LEVE[Math.min(255, Math.round((r * (1 - d) + luma * d) * ART.RABAT))]!,
    LEVE[Math.min(255, Math.round((g * (1 - d) + luma * d) * ART.RABAT))]!,
    LEVE[Math.min(255, Math.round((b * (1 - d) + luma * d) * ART.RABAT))]!,
  ]
}

/**
 * PEINT LA PAIRE — une passe locale par tuile, deux lectures de voisins orthogonaux, rien
 * d'itératif : O(N) strict, ~130 k tuiles sur une carte de Veillée.
 */
export function peindreCarteArt(map: WorldMap, solCouleurs: ArrayLike<number>): CarteArt {
  const { width, height, terrain } = map
  const N = width * height
  const vive = new Uint8ClampedArray(N * 4)
  const grise = new Uint8ClampedArray(N * 4)
  const encreR = (CARTE_ENCRE >> 16) & 0xff
  const encreG = (CARTE_ENCRE >> 8) & 0xff
  const encreB = CARTE_ENCRE & 0xff
  const cadre = champDuCadre(map)
  const terr = (tx: number, ty: number): number =>
    tx < 0 || ty < 0 || tx >= width || ty >= height ? TERRAIN_VOID : (terrain[ty * width + tx] ?? TERRAIN_VOID)

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      const t = terrain[i] ?? TERRAIN_VOID
      let r: number, g: number, b: number

      if (t === TERRAIN_VOID) {
        ;[r, g, b] = [encreR, encreG, encreB]
      } else if (estEau(t)) {
        // L'EAU DE LA CARTE : une teinte posée, pas celle du monde — et le liseré de côte
        // (l'eau qui touche la terre fonce) dessine la rive sans tracer un trait de plus.
        const c = t === TERRAIN_DEEP_WATER ? ART.EAU_PROFONDE : ART.EAU_PEU
        r = (c >> 16) & 0xff
        g = (c >> 8) & 0xff
        b = c & 0xff
        const cote =
          !estEau(terr(tx - 1, ty)) || !estEau(terr(tx + 1, ty)) || !estEau(terr(tx, ty - 1)) || !estEau(terr(tx, ty + 1))
        if (cote) {
          r *= ART.LISERE_COTE
          g *= ART.LISERE_COTE
          b *= ART.LISERE_COTE
        }
      } else if (t === TERRAIN_CLIFF) {
        // LA FALAISE EST LE SQUELETTE DE LA CARTE (spec lieux R2bis : « on suit un mur ») :
        // un trait d'encre froide, le plus franc de la palette carte.
        r = (ART.FALAISE >> 16) & 0xff
        g = (ART.FALAISE >> 8) & 0xff
        b = ART.FALAISE & 0xff
      } else {
        const c = solCouleurs[i] ?? TERRAIN_COLORS[t] ?? 0xff00ff
        ;[r, g, b] = assagir((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)
        // L'OMBRE PORTÉE d'une falaise au nord : une passe de relief — la paroi domine la
        // tuile qui la jouxte au sud, la carte cesse d'être plate.
        if (terr(tx, ty - 1) === TERRAIN_CLIFF) {
          r *= ART.OMBRE_FALAISE
          g *= ART.OMBRE_FALAISE
          b *= ART.OMBRE_FALAISE
        } else if (BOISE.includes(t)) {
          // LA LISIÈRE D'UN BOIS se souligne côté bois : le linework d'une carte dessinée.
          const v = [terr(tx - 1, ty), terr(tx + 1, ty), terr(tx, ty - 1), terr(tx, ty + 1)]
          if (v.some((n) => !BOISE.includes(n) && !estEau(n) && n !== TERRAIN_CLIFF && n !== TERRAIN_VOID)) {
            r *= ART.LISERE_BOIS
            g *= ART.LISERE_BOIS
            b *= ART.LISERE_BOIS
          }
        }
      }

      // LE BORD DU MONDE SE FOND DANS L'ENCRE — la carte flotte sur le panneau au lieu de
      // s'arrêter sur un cadre de béton. Le CADRE (masse minérale connexe au bord) ne garde
      // qu'un fantôme de sa matière ; la terre qui le jouxte fond vers lui en S.
      const dc = cadre[i]!
      if (dc <= ART.CADRE_FONDU_TUILES) {
        // De `CADRE_RESTE` (sur le cadre) à 1 (la vallée), en S — la terre ne tombe pas
        // dans un trou d'encre : elle S'ENFONCE vers le bord du monde.
        const s = dc / ART.CADRE_FONDU_TUILES
        const f = ART.CADRE_RESTE + (1 - ART.CADRE_RESTE) * s * s * (3 - 2 * s)
        r = r * f + encreR * (1 - f)
        g = g * f + encreG * (1 - f)
        b = b * f + encreB * (1 - f)
      }

      const k = i * 4
      vive[k] = r
      vive[k + 1] = g
      vive[k + 2] = b
      vive[k + 3] = 255
      const [gr, gg, gb] = griserPx(r, g, b)
      grise[k] = gr
      grise[k + 1] = gg
      grise[k + 2] = gb
      grise[k + 3] = 255
    }
  }
  return { vive, grise }
}
