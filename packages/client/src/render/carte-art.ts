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
import { EAU_PAVE } from './manteau'

/** Les deux matières de la carte — même géométrie, deux états de savoir. */
export interface CarteArt {
  /** RGBA, `width × height` de la carte, 1 px/tuile — ce qu'on VOIT. */
  vive: Uint8ClampedArray
  /** RGBA, même taille — ce dont on se SOUVIENT (grisé). */
  grise: Uint8ClampedArray
  /** LE CHAMP DU CADRE (`champDuCadre`), 1 octet/tuile — gardé pour que l'EAU DU JOUR (C1,
   *  `carte-savoir`) repeigne une tuile d'eau EXACTEMENT comme le bake l'aurait peinte, fondu
   *  du bord du monde compris : la carte ne se rebake pas au jour, elle se repeint par tuile. */
  cadre: Uint8Array
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
  /** LA VASE de l'assec (C1, décision d'Alexis 2026-09-12 : « la vase dédiée ») — la référence
   *  du monde (`EAU_PAVE.ASSEC`), assagie comme un sol : le lit garde sa forme sur la carte,
   *  la mare partie ne s'efface pas en pré. Luminance 109 vive, 60 grise — au-dessus de l'eau
   *  (62 / 36), en dessous d'une berge. */
  VASE: EAU_PAVE.ASSEC,
  /** Le trait d'encre d'une falaise, et l'ombre qu'elle porte au sud (relief à une passe).
   *  ⚠ LA MÊME ENCRE SERT AUX PAROIS DE TERRASSE (`champDesParois`, V-R8) — un mur est un mur,
   *  et la carte n'a pas à distinguer ce qui ne se franchit jamais de ce qui se franchit à sa
   *  rampe : la TROUÉE le dit déjà, et elle le dit en creux. */
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
 * ═══ LES TROIS TEINTES QUE L'EAU DU JOUR REPEINT (C1) — partagées avec `carte-savoir` ═══
 *
 * La carte ne se rebake pas quand la vallée sèche ou déborde (~2 s pour 1,35 M tuiles) : la
 * carte-savoir repeint la tuile d'eau avec CES fonctions, celles-là mêmes que le bake appelle —
 * une tuile d'eau du jour et une tuile d'eau du bake sortent octet pour octet pareilles, et
 * `carte-savoir.test.ts` le prouve (peindre « comme le bake » = copier le bake).
 */

/** L'EAU DE LA CARTE : une teinte posée, pas celle du monde — et le liseré de côte (l'eau qui
 *  touche la terre fonce) dessine la rive sans tracer un trait de plus. Flottants, pas encore
 *  arrondis : le fondu du cadre et le grisé se composent dessus avant l'écriture. */
export function couleurEauCarte(profonde: boolean, cote: boolean): [number, number, number] {
  const c = profonde ? ART.EAU_PROFONDE : ART.EAU_PEU
  const f = cote ? ART.LISERE_COTE : 1
  return [((c >> 16) & 0xff) * f, ((c >> 8) & 0xff) * f, (c & 0xff) * f]
}

/** LA VASE de l'assec (C1) : la référence du monde, assagie comme un sol. Un lit, pas une eau :
 *  jamais de liseré — c'est l'eau profonde qui la jouxte qui prend le sien. */
export function couleurVaseCarte(): [number, number, number] {
  return assagir((ART.VASE >> 16) & 0xff, (ART.VASE >> 8) & 0xff, ART.VASE & 0xff)
}

/** LE BORD DU MONDE SE FOND DANS L'ENCRE — `dc` est la valeur du champ du cadre (`CarteArt.cadre`)
 *  pour la tuile : 0 sur le cadre, `n` à n tuiles, 255 la vallée (aucun fondu). */
export function fondreAuCadre(r: number, g: number, b: number, dc: number): [number, number, number] {
  if (dc > ART.CADRE_FONDU_TUILES) return [r, g, b]
  // De `CADRE_RESTE` (sur le cadre) à 1 (la vallée), en S — la terre ne tombe pas dans un
  // trou d'encre : elle S'ENFONCE vers le bord du monde.
  const s = dc / ART.CADRE_FONDU_TUILES
  const f = ART.CADRE_RESTE + (1 - ART.CADRE_RESTE) * s * s * (3 - 2 * s)
  const encreR = (CARTE_ENCRE >> 16) & 0xff
  const encreG = (CARTE_ENCRE >> 8) & 0xff
  const encreB = CARTE_ENCRE & 0xff
  return [r * f + encreR * (1 - f), g * f + encreG * (1 - f), b * f + encreB * (1 - f)]
}

/** Les trois bits du champ des parois. Une tuile peut être crête ET pied (une terrasse d'une
 *  seule tuile de large), d'où des drapeaux et non un état. */
const PAROI_CRETE = 1
const PAROI_TROUEE = 2
const PAROI_OMBRE = 4

/**
 * ═══ LE SECOND SQUELETTE DE LA CARTE : LES PAROIS DE TERRASSE (spec `ascension.md` V-R8) ═══
 *
 * `terrain` NE DIT RIEN des terrasses. `TERRAIN_CLIFF` n'est écrit qu'en trois points de tout
 * `/sim` — l'anneau de bordure et les deux passes de `murerLesAretes` (`zonegen.ts`) — et
 * `terrasses.ts` n'en pose aucun : `map.ts` l'énonce en toutes lettres, « deux voisines de
 * paliers différents sont séparées par une paroi que RIEN NE REPEINT ». La carte du joueur
 * dessinait donc un flanc de montagne parfaitement PLAT.
 *
 * MESURÉ le 2026-09-24 (monde joué, graine 2026, 1581×1700, `tools/__parois.mts`) : **43 621
 * arêtes** séparent deux tuiles de paliers différents — 13 006 au nord, 8 263 au sud, 11 015 à
 * l'est, 11 337 à l'ouest : un versant, pas des bandes —, et **216 seulement (0,5 %)** touchent
 * un `TERRAIN_CLIFF`, par coïncidence avec l'anneau et les murs de zone. Tout le reste était
 * invisible.
 *
 * **LE TRAIT VA SUR LA CRÊTE, L'OMBRE SUR LE PIED.** C'est déjà l'idiome de la falaise ici même
 * (la tuile `TERRAIN_CLIFF` est de l'encre, celle qui la jouxte au sud s'assombrit), et c'est la
 * convention cartographique : la ligne se pose sur la rupture, l'ombre pend vers le bas. Encrer
 * le pied aurait doublé chaque trait — deux terrasses mitoyennes portent chacune une arête.
 *
 * **ET LA RAMPE FAIT UNE TROUÉE.** Une tuile que le connecteur rejoint depuis le palier du
 * dessous n'est PAS encrée : le mur s'ouvre là où l'on monte. Et il ne révèle RIEN — le trait ne
 * se voit que là où le brouillard a été levé (les trois états de `carte-savoir`), donc un passage
 * ne se lit qu'après avoir longé son mur. MESURÉ : **314 trouées, toutes de 3 tuiles exactement**
 * (graine 2026 ; 170 sur la 42, 323 sur la 7) — la largeur que le worldgen garantit à tout passage.
 *
 * ⚠ **CE N'EST PAS ENCORE LE GUIDAGE QUE V-R8 DEMANDE, ET LA MESURE LE DIT.** L'écran carte
 * s'ouvre à `mapFit` — la carte jouée (1581×1700) y tient en 526×566 px, soit **0,333 px par
 * tuile** : une trouée de 3 tuiles y vaut **1,00 px**, et le filtre NEAREST perd deux traits
 * d'une tuile sur trois. Le mur et ses trouées ne se lisent qu'à partir du **zoom ×4** (1,33
 * px/tuile, trouée de 4 px) et franchement à ×8. Ce que cette passe livre est donc le RELIEF de
 * la carte, pas encore la flèche vers le passage : la forme du guidage (marqueur de rampe vue,
 * ou sentes qui y mènent) est une fourche de design ouverte — `ascension.md` V-R8.
 *
 * ⚠ **LA TROUÉE SE DÉRIVE DU CHAMP, JAMAIS DU `vers` DU CONNECTEUR.** `vers` vaut `de + 1` par
 * construction sur 1 105/1 105 rampes, et c'est un index d'ÉTAGE, pas un palier de sol : 163
 * d'entre elles (graine 2026) sont des rampes de dessus de MESA qui n'ont aucune terrasse
 * au-dessus d'elles. On n'ouvre donc le mur que sur une voisine dont le palier du SOL vaut
 * `vers` — les 942 autres. Les rampes de mesa n'ouvrent rien, et c'est juste.
 *
 * Sans `map.palier` — la vallée complète, une carte d'avant — le champ est vide et la carte ne
 * bouge pas d'un octet (F-A6). O(N), une passe, plus une passe sur les connecteurs.
 */
function champDesParois(map: WorldMap): Uint8Array {
  const { width, height } = map
  const champ = new Uint8Array(width * height)
  const pal = map.palier
  if (pal === undefined) return champ
  const p = (tx: number, ty: number): number => pal[ty * width + tx] ?? 0

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const ici = p(tx, ty)
      let bits = 0
      // ⚠ LE HORS-CARTE N'EST PAS « PLUS BAS » : compté comme un palier, le bord du monde se
      // serait encré sur tout son pourtour. On ne regarde que les voisines EN CARTE.
      if (tx > 0 && p(tx - 1, ty) < ici) bits |= PAROI_CRETE
      if (tx < width - 1 && p(tx + 1, ty) < ici) bits |= PAROI_CRETE
      if (ty > 0 && p(tx, ty - 1) < ici) bits |= PAROI_CRETE
      if (ty < height - 1 && p(tx, ty + 1) < ici) bits |= PAROI_CRETE
      // L'OMBRE : un mur se dresse au NORD de cette tuile — elle est au pied.
      if (ty > 0 && p(tx, ty - 1) > ici) bits |= PAROI_OMBRE
      champ[ty * width + tx] = bits
    }
  }

  // LA TROUÉE, en second : elle ÉPARGNE, donc elle passe après ce qu'elle épargne. Le pied de
  // la rampe et la tuile qu'elle rejoint au palier du dessus — les deux, parce que le pied peut
  // être lui-même une crête (une terrasse étroite) et parce que l'ombre du pied fermerait
  // visuellement le passage qu'on vient d'ouvrir.
  for (const c of map.connecteurs ?? []) {
    if (c.type !== 'rampe') continue
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) continue
    champ[c.y * width + c.x] = (champ[c.y * width + c.x] ?? 0) | PAROI_TROUEE
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = c.x + dx
      const ny = c.y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if (p(nx, ny) !== c.vers) continue
      champ[ny * width + nx] = (champ[ny * width + nx] ?? 0) | PAROI_TROUEE
    }
  }
  return champ
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
  const parois = champDesParois(map)
  const terr = (tx: number, ty: number): number =>
    tx < 0 || ty < 0 || tx >= width || ty >= height ? TERRAIN_VOID : (terrain[ty * width + tx] ?? TERRAIN_VOID)

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      const t = terrain[i] ?? TERRAIN_VOID
      const paroi = parois[i] ?? 0
      let r: number, g: number, b: number

      if (t === TERRAIN_VOID) {
        ;[r, g, b] = [encreR, encreG, encreB]
      } else if (estEau(t)) {
        const cote =
          !estEau(terr(tx - 1, ty)) || !estEau(terr(tx + 1, ty)) || !estEau(terr(tx, ty - 1)) || !estEau(terr(tx, ty + 1))
        ;[r, g, b] = couleurEauCarte(t === TERRAIN_DEEP_WATER, cote)
      } else if (t === TERRAIN_CLIFF || (paroi & PAROI_CRETE) !== 0 && (paroi & PAROI_TROUEE) === 0) {
        // LA FALAISE EST LE SQUELETTE DE LA CARTE (spec lieux R2bis : « on suit un mur ») :
        // un trait d'encre froide, le plus franc de la palette carte. Et depuis V-R8, LA CRÊTE
        // D'UNE TERRASSE est la même matière — sauf à la trouée d'une rampe, qui reste du sol.
        r = (ART.FALAISE >> 16) & 0xff
        g = (ART.FALAISE >> 8) & 0xff
        b = ART.FALAISE & 0xff
      } else {
        const c = solCouleurs[i] ?? TERRAIN_COLORS[t] ?? 0xff00ff
        ;[r, g, b] = assagir((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)
        // L'OMBRE PORTÉE d'une falaise au nord : une passe de relief — la paroi domine la
        // tuile qui la jouxte au sud, la carte cesse d'être plate.
        if (terr(tx, ty - 1) === TERRAIN_CLIFF || (paroi & PAROI_OMBRE) !== 0 && (paroi & PAROI_TROUEE) === 0) {
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
      ;[r, g, b] = fondreAuCadre(r, g, b, cadre[i]!)

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
  return { vive, grise, cadre }
}
