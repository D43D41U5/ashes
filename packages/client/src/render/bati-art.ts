/**
 * L'ART DU MONDE BÂTI — les pièces que le worldgen pose (`sim/poi-batis.ts`), en relief.
 *
 * ═══ POURQUOI CE MODULE EXISTE, ET CE QU'IL CORRIGE ═══
 *
 * Les chips de structure du jeu (`lit-structures.ts`) sont des CARRÉS PLEINS : un cadre 16×16,
 * une bordure d'un pixel, un signe au milieu. Or `normalFromCanvas` dérive sa hauteur du masque
 * ALPHA — un carré plein est donc une surface d'altitude constante, et sa normale est plate à
 * l'intérieur. **Mesuré : le coffre s'incline en moyenne de 0,0° sur sa matière.** Les chips ont
 * une `_lit`, mais elle ne fait rien : tout leur relief vient de leur contour.
 *
 * C'est pourquoi une table posée dans une ruine ressemblait à une vignette de couleur, et
 * pourquoi une clôture ressemblait à des barres. Ce module reprend les deux, avec la recette
 * qui a marché sur le mur :
 *
 *   1. **UNE VRAIE SILHOUETTE** — la pièce n'occupe pas sa tuile entière. Une table est un
 *      plateau sur des pieds, pas un carré ; un tonneau est rond ; une meule est un dôme. Le
 *      contour EST le premier relief, et il est gratuit.
 *   2. **DU RELIEF GRAVÉ** — les `cracks` de `normalFromCanvas` (écrites pour les fissures des
 *      rochers) servent ici de joints, de douves, de planches : chaque partie devient une
 *      facette qui s'éclaire pour elle-même.
 *
 * ═══ UNE SEULE SOURCE PAR PIÈCE ═══
 *
 * Le reste du jeu dessine chaque structure DEUX FOIS — une passe Phaser Graphics dans
 * `BootScene` pour l'albédo simple, une passe canvas2d dans `lit-structures` pour la `_lit`.
 * Deux dessins d'un même objet dérivent : on l'a vu (le commentaire de la porte annonce un
 * autotuile qui n'existe pas). Ici chaque pièce est dessinée UNE fois, en canvas2d, et les deux
 * textures en sortent — `st-<type>` et `st-<type>_lit`, du même trait.
 */
import type Phaser from 'phaser'
import { BALANCE } from '@braises/sim'
import { type Crack, newCanvas, normalFromCanvas, registerLit } from './normal-map'

const T = 16 // le côté d'une tuile

// Les masques d'autotuile, partagés avec `snapshot-view` : N=1, E=2, S=4, O=8.
const N = 1, E = 2, S = 4, O = 8

/** Hachage entier déterministe → [0,1[. Aucun `Math.random` : le monde est le même à chaque boot. */
function h(a: number, b: number, c: number): number {
  let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

type Ctx = CanvasRenderingContext2D
const rect = (g: Ctx, c: string, x: number, y: number, w: number, hh: number): void => {
  g.fillStyle = c
  g.fillRect(x, y, w, hh)
}
const disque = (g: Ctx, c: string, cx: number, cy: number, r: number): void => {
  g.fillStyle = c
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()
}

// ─── LA PALETTE ──────────────────────────────────────────────────────────────
// Le BOIS sert aux barrières (clôture, encadrement, poutre), qui ne sont pas des boîtes ; le
// mobilier, lui, a ses tons de boîte (`BOIS_T`, `PIERRE_T`, `PAILLE_T`) plus bas.
const BOIS = { clair: '#a07c48', mid: '#8a6438', sombre: '#5a3f24', nuit: '#3a2818' }
const MOUSSE = '#4a5a36'

// ═══════════════════════════════════════════════════════════════════════════
//  LES PIÈCES — chacune rend l'albédo et les sillons à graver dans sa normale
// ═══════════════════════════════════════════════════════════════════════════

interface Piece {
  type: string
  /** Hauteur du dessin, en px. Défaut : la tuile. L'encadrement monte à la crête du MUR. */
  hauteur?: number
  /** Largeur du dessin, en px. Défaut : la tuile. Seul le seuil déborde (il est À CHEVAL). */
  largeur?: number
  /** Réglages de `normalFromCanvas`. Défauts calés sur le cadran « petit prop blocky ». */
  passes?: number
  k?: number
  cell?: number
  plant?: boolean
  dessiner: (g: Ctx) => Crack[]
}

/** Hauteur du mur PLEINE TUILE en px (16 de face + 6 de coiffe) — l'ancien modèle, en ruine. */
const W_H = 22

/**
 * L'ÉPAISSEUR DE LA BANDE, EN PIXELS — **dérivée de la collision, jamais recopiée**.
 *
 * `WALL_EDGE_SUB` sous-tuiles sur `SUBTILES_PER_TILE` : ce que le rendu dessine est très
 * exactement ce que le moteur bloque. Les faire diverger donnerait le pire des défauts — un mur
 * qu'on voit ici et qui arrête là — et personne ne saurait lequel des deux a tort.
 */
const EP = Math.round((BALANCE.WALL_EDGE_SUB / BALANCE.SUBTILES_PER_TILE) * T)

/**
 * LA DEMI-ÉPAISSEUR, ET LA MARGE DU SPRITE — le mur est À CHEVAL sur l'arête (décision
 * d'Alexis, 2026-07-27) : il prend autant sur une tuile que sur l'autre.
 *
 * Conséquence directe sur le format : une bande ne tient plus dans sa tuile. Le sprite gagne
 * donc une MARGE de `M` de chaque côté, et sa tuile n'est plus son cadre mais un carré CENTRÉ
 * dedans, décalé de `M` — d'où `EDGE_ORIGIN_Y`, sans quoi tout le bâti flotterait d'une
 * demi-épaisseur vers le haut.
 */
const M = EP / 2
/** Le coin haut-gauche de la TUILE dans le sprite d'une barrière de hauteur `ht`. */
const tuileDans = (ht: number): { x: number; y: number } => ({ x: M, y: ht + M })
/** Le format du sprite d'une barrière de hauteur `ht` : la tuile, sa marge, et la hauteur. */
const formatBarriere = (ht: number): { w: number; h: number } => ({ w: T + 2 * M, h: ht + T + 2 * M })
/**
 * L'ORIGINE VERTICALE d'une barrière : le BAS DE SA TUILE, qui n'est plus le bas du sprite —
 * il reste `M` de débord dessous (la moitié de l'arête sud, chez le voisin). `snapshot-view`
 * ancre là ; l'oublier décalerait murs et clôtures d'une demi-épaisseur.
 */
const originY = (ht: number): number => (ht + T + M) / (ht + T + 2 * M)

/**
 * LA HAUTEUR APPARENTE D'UN MUR SUR ARÊTE, en pixels (décision d'Alexis, relevée le 2026-07-27).
 *
 * **32 px pour une tuile de 16** — DEUX tuiles, soit près de TROIS FOIS l'avatar (12 px). On y
 * est allé en deux temps (17 → 24 → 32, « encore trop petits ») et il n'y a pas de rapport
 * théorique qui tranche, parce que les deux sujets ne sont pas vus du même œil. L'avatar est vu de DESSUS — sa hauteur est écrasée, ses 12 px sont sa largeur
 * d'épaules autant que sa taille. Le mur, lui, est vu de CÔTÉ : ses pixels sont de la hauteur
 * pure. Les mesurer au même mètre (17 px pour 2,5 m contre 12 px pour 1,75 m) donnait un rapport
 * juste sur le papier et un mur qui arrive à l'épaule à l'écran. On se règle sur ce que l'œil
 * compare — la silhouette debout — et non sur la règle.
 *
 * Une hauteur pareille CACHE : la face du mur sud remonte de DEUX tuiles sur la salle. Ce
 * n'est tenable que parce que la façade s'escamote quand on entre (`snapshot-view`) —
 * l'escamotage achète la hauteur, et c'est lui qui borne ce nombre.
 *
 * Déclarée ICI, avant `PIECES` : l'encadrement de porte s'aligne dessus, et une `const` lue à la
 * construction du tableau ne pardonne pas d'être déclarée plus bas.
 */
const MUR_HT = 32

/**
 * LA LARGEUR D'UN JAMBAGE — DÉRIVÉE, jamais choisie.
 *
 * Le passage libre d'un encadrement vaut `T − 2·POST`. Il doit laisser entrer l'avatar, dont la
 * hitbox fait `AVATAR_HITBOX_TILES` de large — **0,75 tuile depuis le 2026-07-27**. D'où
 * `POST ≤ (1 − 0,75)/2 = 0,125 tuile`, soit **2 px** sur 16 (c'était 3, du temps d'un corps de
 * 0,6). Un test le vérifie contre la constante d'équilibrage : si la hitbox change, la porte
 * suit ou le test rougit — c'est exactement ce qui vient d'arriver.
 *
 * ET LE SPRITE NE MENT PLUS : il fait 12 px de large, comme la hitbox. L'œil et le moteur
 * jugent enfin la même ouverture ; on passe en frôlant les montants, et on le VOIT.
 */
export const ENCADREMENT_POST = 2

/**
 * ═══ UNE SEULE CAMÉRA, POUR TOUT LE MOBILIER (décision d'Alexis) ═══
 *
 * Chaque meuble est une BOÎTE vue à 45° : un DESSUS foreshortené de `CAP_M` pixels, posé sur
 * une FACE avant de `h` pixels. C'est exactement la recette du mur (coiffe + face) — donc un
 * banc, une table et une maçonnerie sont vus du même œil. Avant, chaque pièce inventait sa
 * projection : le tonneau était un disque à plat, la meule un dôme, l'étagère un rectangle de
 * face. Trois perspectives dans une même pièce, et rien ne se posait sur rien.
 *
 * LE SPRITE FAIT EXACTEMENT 16×16 — UNE TUILE — ET SEULEMENT POUR LES STATIONS (décision
 * d'Alexis). La hauteur ne change donc pas la taille du sprite, elle change la POSITION du
 * dessus dedans : un objet haut a son dessus près du bord supérieur, un objet bas l'a près du
 * sol. Une paillasse et une étagère occupent le même carré et ne se ressemblent pas — ce qui
 * est le but, et ce qu'un sprite plus petit que sa tuile ne donnait pas (il flottait, sans
 * échelle commune).
 *
 * LA RÈGLE NE S'ÉTEND PAS AU RESTE, et c'est délibéré : un MUR fait 22 px (16 de face + 6 de
 * coiffe) parce qu'il se DRESSE, et l'ENCADREMENT le suit pour s'aligner sur sa crête. Les
 * contraindre à une tuile les raboterait. Une station se POSE sur le sol ; une barrière le
 * QUITTE. Deux natures, deux formats.
 */
const CAP_M = 6 //  la profondeur du dessus à 45° — LA MÊME que la coiffe du mur

interface Tons { haut: string; hautH: string; face: string; faceO: string; pied: string }
const BOIS_T: Tons = { haut: '#9c7442', hautH: '#b58a52', face: '#6a4c2c', faceO: '#573d22', pied: '#3a2818' }
const PIERRE_T: Tons = { haut: '#7c7c86', hautH: '#93939d', face: '#5a5a64', faceO: '#484852', pied: '#2e2e36' }
const PAILLE_T: Tons = { haut: '#c0b070', hautH: '#d4c489', face: '#96884c', faceO: '#7d7040', pied: '#4e4526' }

/**
 * La boîte : dessus + face, sur toute la largeur de la tuile. Rend l'ordonnée du dessus et
 * celle de la face, pour que la pièce y grave ses détails sans recalculer la géométrie.
 */
function boite(g: Ctx, h: number, t: Tons): { yh: number; yf: number } {
  const yf = T - h //        le haut de la face avant
  const yh = yf - CAP_M //   le haut du dessus
  rect(g, t.pied, 0, yh, T, h + CAP_M) //   la silhouette pleine, en ombre
  rect(g, t.face, 0, yf, T, h) //           la face avant
  rect(g, t.faceO, 0, T - 2, T, 2) //       le pied, plus sombre : l'objet touche le sol
  rect(g, t.haut, 0, yh, T, CAP_M) //       le dessus
  rect(g, t.hautH, 0, yh, T, 1) //          son arête, qui prend la lumière
  return { yh, yf }
}
/** L'arête entre dessus et face, gravée : c'est elle qui fait tourner la boîte. */
const ARETE = (yf: number): Crack => ({ path: [[0, yf], [T, yf]], crevasse: true })

const PIECES: readonly Piece[] = [
  // ── LA TABLE : un plateau de planches, deux tréteaux ─────────────────────
  {
    type: 'table',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 6, BOIS_T)
      rect(g, '#8a6438', 0, yh + 2, T, 1) //     les joints du plateau, vus de dessus
      rect(g, '#8a6438', 0, yh + 4, T, 1)
      rect(g, BOIS_T.faceO, 2, yf + 2, 3, 4) //  les tréteaux, dans l'ombre de l'apron
      rect(g, BOIS_T.faceO, 11, yf + 2, 3, 4)
      return [ARETE(yf), { path: [[0, yh + 3], [T, yh + 3]] }, { path: [[5, T], [5, yf]] }, { path: [[11, T], [11, yf]] }]
    },
  },
  // ── LE BANC : bas, on l'enjambe ──────────────────────────────────────────
  {
    type: 'banc',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 4, BOIS_T)
      rect(g, '#8a6438', 0, yh + 3, T, 1)
      rect(g, BOIS_T.pied, 3, yf + 2, 2, 2)
      rect(g, BOIS_T.pied, 11, yf + 2, 2, 2)
      return [ARETE(yf), { path: [[4, T], [4, yf]] }, { path: [[12, T], [12, yf]] }]
    },
  },
  // ── LA PAILLASSE : à même le sol, la plus basse du lot ───────────────────
  {
    type: 'paillasse',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 3, PAILLE_T)
      for (let k = 0; k < 10; k++) { // les brins qui dépassent — c'est ce qui dit PAILLE
        rect(g, PAILLE_T.faceO, Math.floor(h(2, k, 5) * T), yh + Math.floor(h(2, k, 9) * CAP_M), 1, 1)
      }
      rect(g, PAILLE_T.faceO, 0, yh + 2, T, 1) // les liens qui sanglent le matelas
      rect(g, PAILLE_T.faceO, 0, yh + 4, T, 1)
      return [ARETE(yf), { path: [[0, yh + 2.5], [T, yh + 2.5]] }]
    },
  },
  // ── L'ÉTAGÈRE : la plus haute — sa face porte trois rayons ───────────────
  {
    type: 'etagere',
    dessiner: (g) => {
      const { yf } = boite(g, 10, BOIS_T)
      for (const dy of [1, 4, 7]) {
        rect(g, BOIS_T.pied, 1, yf + dy, T - 2, 1) //  le vide sous chaque rayon
        rect(g, '#a67f4a', 1, yf + dy + 1, T - 2, 1) // l'arête du rayon, éclairée
      }
      return [ARETE(yf), ...[1, 4, 7].map((dy) => ({ path: [[1, yf + dy], [T - 1, yf + dy]], crevasse: true } as Crack))]
    },
  },
  // ── LE TONNEAU : ses DOUVES sur la face, ses cercles de fer ─────────────
  {
    type: 'tonneau',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 8, BOIS_T)
      disque(g, '#5a3f24', 8, yh + 3, 6.5) //   le fond, vu de dessus : le seul disque du lot
      disque(g, '#8a6438', 7.4, yh + 2.6, 5.4)
      rect(g, '#5a5a62', 0, yf + 2, T, 1) //    les cercles de fer, sur la face
      rect(g, '#5a5a62', 0, yf + 6, T, 1)
      return [ARETE(yf), { path: [[4, T], [4, yf]] }, { path: [[8, T], [8, yf]] }, { path: [[12, T], [12, yf]] },
        { path: [[0, yf + 2.5], [T, yf + 2.5]], crevasse: true }]
    },
  },
  // ── LE COFFRE : couvercle bombé, ferrure et serrure ─────────────────────
  // Repris ici depuis `lit-structures` : c'était un carré plat, il est maintenant vu du même
  // œil que le reste, avec une vraie normale.
  {
    type: 'chest',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 6, { haut: '#8a6438', hautH: '#a67f4a', face: '#6a4c2c', faceO: '#4a3520', pied: '#2e2016' })
      rect(g, '#5a3f24', 0, yh + CAP_M - 1, T, 1) // l'arête du couvercle
      rect(g, '#c9a227', 6, yh, 4, CAP_M) //        la ferrure, sur le couvercle
      rect(g, '#c9a227', 6, yf, 4, 3) //            et sa retombée sur la face
      rect(g, '#2e2016', 7, yf + 1, 2, 2) //        la serrure
      return [ARETE(yf), { path: [[6, T], [6, yh]] }, { path: [[10, T], [10, yh]] }]
    },
  },
  // ── L'ÂTRE : la gueule noire, dans un manteau de pierre ─────────────────
  {
    type: 'atre',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 10, PIERRE_T)
      rect(g, PIERRE_T.faceO, 0, yh + 2, T, 1) //  les joints du manteau, vus de dessus
      rect(g, '#141418', 4, yf + 1, 8, 9) //       la gueule, éteinte
      rect(g, '#2e2620', 5, yf + 6, 6, 3) //       les bûches charbonneuses, au fond
      rect(g, MOUSSE, 1, T - 3, 3, 1)
      return [ARETE(yf), { path: [[4, T], [4, yf + 1]], crevasse: true }, { path: [[12, T], [12, yf + 1]], crevasse: true },
        { path: [[4, yf + 1], [12, yf + 1]], crevasse: true }]
    },
  },
  // ── L'ABREUVOIR : une auge — son creux se voit DE DESSUS ────────────────
  {
    type: 'abreuvoir',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 5, PIERRE_T)
      rect(g, PIERRE_T.pied, 2, yh + 1, 12, CAP_M - 1) // le creux
      rect(g, '#3f5e6e', 3, yh + 2, 10, CAP_M - 3) //     l'eau de pluie, croupie
      rect(g, '#4d7183', 3, yh + 2, 10, 1)
      rect(g, MOUSSE, 12, T - 3, 3, 1)
      return [ARETE(yf), { path: [[2, yh + 1], [14, yh + 1]], crevasse: true },
        { path: [[2, yh + CAP_M], [14, yh + CAP_M]], crevasse: true }]
    },
  },
  // ── LA MEULE : le foin, et la perche qui la tient ───────────────────────
  {
    type: 'meule',
    dessiner: (g) => {
      const { yh, yf } = boite(g, 9, PAILLE_T)
      disque(g, '#a89a5e', 8, yh + 3, 6.5) //   le dôme, vu de dessus
      disque(g, '#d4c489', 6.8, yh + 2.4, 3.6)
      rect(g, '#6a4c2c', 7, yh - 3, 2, 4) //    la perche, qui dépasse au sommet
      for (let k = 0; k < 7; k++) { //          le foin qui pend sur la face
        rect(g, PAILLE_T.faceO, Math.floor(h(3, k, 11) * T), yf, 1, 2 + Math.floor(h(3, k, 13) * 4))
      }
      return [ARETE(yf), { path: [[8, yh + 3], [3, yf + 8]] }, { path: [[8, yh + 3], [13, yf + 8]] },
        { path: [[8, yh + 3], [8, T]] }]
    },
  },
  // ── LA POUTRE : une pièce de charpente, tombée en travers ───────────────
  // Elle est COUCHÉE : pas de dessus ni de face, une diagonale et son fil. C'est la seule
  // pièce du lot qui n'est pas une boîte, et c'est ce qui la fait lire comme « tombée ».
  {
    type: 'poutre',
    dessiner: (g) => {
      g.fillStyle = BOIS.nuit
      g.beginPath(); g.moveTo(0, 13); g.lineTo(13, 0); g.lineTo(16, 3); g.lineTo(3, 16); g.closePath(); g.fill()
      g.fillStyle = BOIS.sombre
      g.beginPath(); g.moveTo(0.5, 12.5); g.lineTo(12.8, 0.3); g.lineTo(15, 2.5); g.lineTo(2.7, 14.7); g.closePath(); g.fill()
      g.fillStyle = BOIS.mid
      g.beginPath(); g.moveTo(1, 12); g.lineTo(12.6, 0.6); g.lineTo(13.8, 1.8); g.lineTo(2.2, 13.2); g.closePath(); g.fill()
      return [{ path: [[1.6, 12.6], [13.2, 1.2]] }]
    },
  },
  // ── LE MUR BAS : un pan arasé — le dessus des pierres, et plus rien ──────
  // BAS pour de vrai : son dessus occupe la tuile, sa face ne fait que trois pixels. La
  // silhouette doit dire « ça ne se dresse plus ».
  {
    type: 'mur_bas',
    dessiner: (g) => {
      const joints: Crack[] = []
      const { yh, yf } = boite(g, 3, PIERRE_T)
      let x = -2
      for (let assise = 0; assise < 2; assise++) {
        const y0 = yh + assise * 3
        x = -Math.floor(h(assise, 3, 9) * 4)
        while (x < T) {
          const w = 3 + Math.floor(h(assise, x, 17) * 3)
          const x0 = Math.max(0, x)
          const x1 = Math.min(T, x + w)
          if (x1 > x0) rect(g, h(assise, x, 5) > 0.5 ? PIERRE_T.face : PIERRE_T.haut, x0, y0, x1 - x0, 3)
          if (x > 0 && x < T) joints.push({ path: [[x, y0 + 3], [x, y0]] })
          x += w
        }
      }
      rect(g, MOUSSE, 2, T - 2, 4, 1)
      rect(g, MOUSSE, 10, T - 1, 3, 1)
      return [...joints, ARETE(yf)]
    },
  },
]

// ═══════════════════════════════════════════════════════════════════════════
//  LES BARRIÈRES SUR ARÊTE — le mur mince, sa clôture, son seuil
// ═══════════════════════════════════════════════════════════════════════════

const CLOT_HT = 8 //  la clôture est BASSE : on voit par-dessus, c'est ce qui la distingue

const N_B = 1, E_B = 2, S_B = 4, O_B = 8

/**
 * La bande au sol d'une arête, dans le repère du sprite — **centrée sur la limite**.
 *
 * La tuile occupe `[M, M+T]` dans les deux axes (à `ht` près en hauteur) ; une bande déborde
 * donc de `M` au-dehors et mord de `M` au-dedans. C'est le même partage que la collision
 * (`WALL_HALF` dans `collision.ts`) — les deux se lisent sur la même limite.
 */
function bande(bit: number, ht: number): { x: number; y: number; w: number; h: number } {
  const t = tuileDans(ht)
  // ET ELLE DÉBORDE DE `M` À CHAQUE BOUT, DANS SA LONGUEUR — pas par coquetterie : une bande
  // qui s'arrête au bord de sa tuile finit sur du VIDE, et `normalFromCanvas` lit tout bord de
  // matière comme une arête à biseauter. Chaque tuile se retrouvait donc cerclée d'ombre, et un
  // mur qui file devenait une file de blocs (« les murs ne sont plus continus », Alexis). En
  // mordant sur la tuile voisine, deux bandes voisines se RECOUVRENT : plus aucun bord à
  // biseauter au milieu d'un mur, et les seuls biseaux restants sont ceux des vrais bouts.
  if (bit === N_B) return { x: 0, y: t.y - M, w: T + 2 * M, h: EP }
  if (bit === S_B) return { x: 0, y: t.y + T - M, w: T + 2 * M, h: EP }
  if (bit === O_B) return { x: t.x - M, y: t.y - M, w: EP, h: T + 2 * M }
  return { x: t.x + T - M, y: t.y - M, w: EP, h: T + 2 * M }
}

/**
 * UNE BARRIÈRE SUR ARÊTES — dessinée en DEUX PASSES, et il en faut deux.
 *
 * Au coin d'un bâtiment, la FACE d'une arête et le DESSUS d'une autre se disputent la même
 * zone : en une seule passe, l'arête de l'une traverse le dessus de l'autre et il apparaît une
 * COUTURE à chaque angle. En dessinant tous les dessus APRÈS toutes les faces, le réseau des
 * sommets devient continu — ce qui est aussi la vérité physique : le haut d'un mur est une
 * surface d'un seul tenant, quelle que soit la direction qu'il prend.
 *
 * Et la règle des Zelda vus de dessus : **le DESSUS se dessine toujours** (on est au-dessus, on
 * voit le haut du mur), **la FACE SOMBRE seulement sous un mur qui court d'EST EN OUEST**.
 *
 * ═══ POURQUOI LA FACE SOMBRE NE VAUT QUE POUR LES BANDES N/S (décision d'Alexis : « le haut
 * des murs uni, sans couture sur toute l'enceinte ») ═══
 *
 * Le fichier disait déjà cette règle ; le code, lui, dessinait une face sous CHAQUE bande, et
 * c'est ce qui zébrait les murs nord-sud. La cause est purement géométrique : sur un mur qui
 * file vers le sud, chaque tuile peint sa coiffe (16 px) puis sa face (24 px) — et la tuile
 * SUIVANTE, dessinée par-dessus, recouvre cette face de sa propre coiffe. On voyait donc, tous
 * les 16 px, un reste de face sombre : une couture par tuile, sur toute la longueur. Aucune
 * astuce de tons ne la rattrape, parce que le recouvrement se joue ENTRE SPRITES — la double
 * passe ci-dessous ne coud que l'intérieur d'un seul.
 *
 * On donne donc à la bande verticale le ton du DESSUS sur toute sa hauteur : un mur nord-sud
 * devient un ruban clair d'un seul tenant (c'est aussi ce qu'on verrait d'en haut — sa tranche
 * est éclairée comme son sommet), pendant qu'un mur est-ouest garde coiffe claire sur face
 * sombre. Et plus de liseré : « uni » veut dire un aplat par surface, sans même un fil.
 */
function dessinerBarriere(
  mask: number, ht: number, tons: { top: string; face: string; pied: string; arete: string },
  grain?: (g: Ctx, b: { x: number; y: number; w: number; h: number }, bit: number) => void,
): { albedo: HTMLCanvasElement; joints: Crack[] } {
  const f = formatBarriere(ht)
  const { c, ctx: g } = newCanvas(f.w, f.h)
  const joints: Crack[] = []
  const bits = [N_B, E_B, S_B, O_B].filter((b) => (mask & b) !== 0)
  for (const passe of [0, 1]) {
    for (const bit of bits) {
      const b = bande(bit, ht)
      const estOuest = bit === N_B || bit === S_B
      if (passe === 0) {
        rect(g, estOuest ? tons.face : tons.top, b.x, b.y + b.h - ht, b.w, ht)
        // Le PIED (l'ombre au sol) ne vaut que sous une face : sur un ruban vertical, il ferait
        // un tiret sombre par tuile — la couture qu'on vient de retirer, revenue par la bande.
        if (estOuest) rect(g, tons.pied, b.x, b.y + b.h - 3, b.w, 3)
      } else {
        rect(g, tons.top, b.x, b.y - ht, b.w, b.h)
        grain?.(g, { ...b, y: b.y - ht }, bit)
        // Le sillon de la crête, gravé dans la normale : lui aussi seulement sous une face,
        // pour la même raison — un trait par tuile en travers d'un ruban se voit.
        if (estOuest) joints.push({ path: [[b.x, b.y - ht + b.h], [b.x + b.w, b.y - ht + b.h]] })
      }
    }
  }
  return { albedo: c, joints }
}

/**
 * LE MUR COUPÉ — la découpe de Project Zomboid (décision d'Alexis, 2026-07-27).
 *
 * Quand on entre, le mur qui se dresse ENTRE la caméra et la pièce ne s'efface pas : il est
 * TRANCHÉ au ras du sol. Il ne reste que son EMPREINTE, sombre — exactement la bande que le
 * moteur bloque, et rien au-dessus. On garde donc l'information « il y a un mur ici » (on ne
 * traverse pas un trait noir des yeux) en rendant toute la pièce visible.
 *
 * Pourquoi une découpe et non une transparence : un mur à 22 % laisse voir le sol À TRAVERS le
 * mur, ce qui donne un fantôme gris sur toute la hauteur de la face — la pièce reste voilée. Le
 * trait au sol, lui, ne voile rien du tout.
 *
 * La bande est la MÊME `bande()` que le mur plein : le trait noir tombe exactement là où la
 * barrière se tient, pas une sous-tuile à côté.
 */
const COUPE_SOL = '#191920' //  l'empreinte, presque noire — une ombre portée, pas une pierre
const COUPE_LISERE = '#2e2e38' // le fil du dessus : ce qui dit « tranché », et non « effacé »
function dessinerBarriereCoupee(mask: number, ht: number, sol = COUPE_SOL, fil = COUPE_LISERE): HTMLCanvasElement {
  const f = formatBarriere(ht)
  const { c, ctx: g } = newCanvas(f.w, f.h)
  for (const bit of [N_B, E_B, S_B, O_B].filter((b) => (mask & b) !== 0)) {
    const b = bande(bit, ht)
    rect(g, sol, b.x, b.y, b.w, b.h)
    // Le fil de coupe court LE LONG de la bande — en travers, il ferait un tiret.
    if (bit === N_B || bit === S_B) rect(g, fil, b.x, b.y, b.w, 1)
    else rect(g, fil, b.x, b.y, 1, b.h)
  }
  return c
}

/**
 * L'ENCADREMENT DE PORTE, SANS PORTE : une huisserie de CHARPENTE — et elle s'AUTOTUILE.
 *
 * ═══ IL EST DANS LE MUR, ET IL LE PROUVE EN REPRENANT SA GÉOMÉTRIE ═══
 *
 * Il était dessiné comme une pièce de MOBILIER : pleine tuile, jambages plantés DEVANT une
 * bande de mur bien plus mince. Il ne perçait rien — il se tenait là, comme un portique posé
 * contre la façade (« clairement pas dans le mur », Alexis, 2026-07-27). Il reprend donc la
 * géométrie de la barrière qu'il remplace : même bande NORD (celle que porte un mur qui borde
 * une salle par le sud — la dessiner au sud le posait une tuile trop bas), même crête, même
 * épaisseur, un linteau dessous, et entre les jambages le VIDE.
 *
 * ═══ ET IL SE LIE À SON VOISIN (décision d'Alexis : une porte de DEUX CASES) ═══
 *
 * `masque` : 1 = un autre encadrement à l'OUEST, 2 = à l'EST. Le jambage tombe du côté où il y
 * a un voisin — sinon deux seuils mitoyens dressent deux montants dos à dos au MILIEU de leur
 * ouverture, et une porte de deux cases lit comme deux portes d'une case. Les montants
 * subsistent aux deux BOUTS, là où le bois rencontre la pierre : c'est tout ce qu'il faut.
 *
 * La largeur du jambage ne se choisit pas à l'œil : le passage libre doit laisser entrer
 * l'avatar (hitbox 0,6 tuile → `POST` ≤ 0,2 tuile). Et le BOIS reste, contre la maçonnerie
 * grise : en pierre, on ne voyait plus où l'on entrait.
 */
const O_VOISIN = 1, E_VOISIN = 2
function dessinerEncadrement(masque: number): { albedo: HTMLCanvasElement; joints: Crack[] } {
  const f = formatBarriere(MUR_HT)
  const { c, ctx: g } = newCanvas(f.w, f.h)
  const b = bande(N, MUR_HT)
  const t = tuileDans(MUR_HT) //     les jambages sont DANS la tuile, pas dans la marge
  const CRETE = b.y - MUR_HT //      le plan du dessus, celui du mur
  const PIED = b.y + b.h //          le bas de la face, au ras de la bande
  const POST = ENCADREMENT_POST
  const LINT = 6 //                  l'épaisseur du linteau, juste sous la crête
  const joints: Crack[] = []
  // LES JAMBAGES — dans le plan du mur, de la crête au sol, et SEULEMENT aux bouts libres.
  for (const [x, bit] of [[t.x, O_VOISIN], [t.x + T - POST, E_VOISIN]] as const) {
    if (masque & bit) continue
    rect(g, BOIS.sombre, x, CRETE + EP, POST, PIED - CRETE - EP)
    rect(g, BOIS.nuit, x, PIED - 3, POST, 3) //  le pied, dans son ombre
    joints.push({ path: [[x + POST / 2, PIED], [x + POST / 2, CRETE + EP]], crevasse: true })
  }
  // LE LINTEAU — d'un bout à l'autre, sous la crête. Le reste est un TROU. Il déborde vers un
  // voisin (comme les bandes de mur) pour que deux seuils mitoyens n'aient pas de raccord.
  const lx = masque & O_VOISIN ? b.x : t.x
  const lw = (masque & O_VOISIN ? t.x - b.x : 0) + T + (masque & E_VOISIN ? b.x + b.w - t.x - T : 0)
  rect(g, BOIS.sombre, lx, CRETE + EP, lw, LINT)
  rect(g, BOIS.nuit, lx, CRETE + EP + LINT - 1, lw, 1)
  // LE DESSUS — la crête, en bois, et elle s'arrête AU BORD DE SA TUILE du côté d'un mur.
  //
  // Elle débordait comme une bande de mur, des deux côtés. Or le mur voisin déborde LUI AUSSI
  // (c'est ce qui recoud les murs entre eux), il se dessine après, et sa pierre passait donc
  // par-dessus le bois : le seuil était « mordu par le mur à droite » (Alexis). On ne déborde
  // plus que vers un autre SEUIL — là où le voisin est du même bois et où le raccord doit
  // disparaître. Vers la pierre, chacun chez soi, et le seuil se dessine après (`TIE_SEUIL`).
  rect(g, BOIS.mid, lx, CRETE, lw, EP)
  rect(g, BOIS.clair, lx, CRETE, lw, 1)
  joints.push({ path: [[lx, CRETE + EP], [lx + lw, CRETE + EP]], crevasse: true })
  return { albedo: c, joints }
}

/**
 * LE SEUIL COUPÉ — l'encadrement suit son mur. Sans lui, la découpe laissait un LINTEAU
 * flottant à un mètre du sol au-dessus d'une salle ouverte : la seule pièce restée debout.
 *
 * Il ne reste que le pied des deux jambages, sur l'arête SUD (celle où les plans percent leurs
 * seuils, cf. `DEC` plus haut) — et le passage entre eux reste NU : c'est ce qui continue de
 * dire « on entre par ici », même tranché.
 */
function dessinerEncadrementCoupe(masque: number): HTMLCanvasElement {
  const f = formatBarriere(MUR_HT)
  const { c, ctx: g } = newCanvas(f.w, f.h)
  const y = bande(N, MUR_HT).y //  la MÊME arête que le seuil debout : le nord de sa tuile
  for (const [x, bit] of [[M, O_VOISIN], [M + T - ENCADREMENT_POST, E_VOISIN]] as const) {
    if (masque & bit) continue //  le même autotuilage que debout : pas de montant au milieu
    // Les tons du bois de la maison, pas une nouvelle encre : un pied de jambage tranché est
    // le MÊME bois vu au ras du sol.
    rect(g, BOIS.nuit, x, y, ENCADREMENT_POST, EP)
    rect(g, BOIS.sombre, x, y, ENCADREMENT_POST, 1)
  }
  return c
}

/**
 * LA CLÔTURE — un POTEAU au centre, des LISSES vers chaque voisin.
 *
 * C'était le défaut le plus criant : la clôture dessinait deux lisses HORIZONTALES quoi qu'il
 * arrive. Une barrière qui court du nord au sud montrait donc des barreaux en travers d'elle —
 * elle ne ressemblait à rien, et pour cause : elle ne savait pas dans quel sens elle allait.
 *
 * Le patron « poteau + branches » règle les seize cas d'un coup et sans table : on pose le
 * poteau, puis une paire de lisses vers chaque direction du masque. Un bout de barrière n'a
 * qu'une branche, un angle en a deux, un croisement quatre — et un poteau ISOLÉ reste un
 * poteau, ce qui est exactement ce qu'on veut voir au bout d'un enclos.
 *
 * En vue de dessus, une lisse est une PAIRE de lignes parallèles (les deux barres, vues d'en
 * haut). C'est ce qui la distingue d'un mur d'un seul coup d'œil : le mur est plein, la
 * clôture est ajourée — on voit le sol entre ses barres.
 */
function dessinerCloture(mask: number): { albedo: HTMLCanvasElement; joints: Crack[] } {
  const { c, ctx: g } = newCanvas(T, T)
  const joints: Crack[] = []
  const A = 6, B = 10 // les deux lisses, de part et d'autre du poteau

  // Les LISSES, vers chaque voisin. Elles partent du poteau et vont jusqu'au bord : deux
  // tuiles voisines se rejoignent donc exactement, sans couture ni recouvrement.
  if (mask & O) {
    rect(g, BOIS.sombre, 0, A, 7, 2)
    rect(g, BOIS.sombre, 0, B, 7, 2)
    rect(g, BOIS.mid, 0, A, 7, 1)
    rect(g, BOIS.mid, 0, B, 7, 1)
    joints.push({ path: [[0, A + 2], [7, A + 2]] }, { path: [[0, B + 2], [7, B + 2]] })
  }
  if (mask & E) {
    rect(g, BOIS.sombre, 9, A, 7, 2)
    rect(g, BOIS.sombre, 9, B, 7, 2)
    rect(g, BOIS.mid, 9, A, 7, 1)
    rect(g, BOIS.mid, 9, B, 7, 1)
    joints.push({ path: [[9, A + 2], [16, A + 2]] }, { path: [[9, B + 2], [16, B + 2]] })
  }
  if (mask & N) {
    rect(g, BOIS.sombre, A, 0, 2, 7)
    rect(g, BOIS.sombre, B, 0, 2, 7)
    rect(g, BOIS.mid, A, 0, 1, 7)
    rect(g, BOIS.mid, B, 0, 1, 7)
    joints.push({ path: [[A + 2, 0], [A + 2, 7]] }, { path: [[B + 2, 0], [B + 2, 7]] })
  }
  if (mask & S) {
    rect(g, BOIS.sombre, A, 9, 2, 7)
    rect(g, BOIS.sombre, B, 9, 2, 7)
    rect(g, BOIS.mid, A, 9, 1, 7)
    rect(g, BOIS.mid, B, 9, 1, 7)
    joints.push({ path: [[A + 2, 9], [A + 2, 16]] }, { path: [[B + 2, 9], [B + 2, 16]] })
  }

  // LE POTEAU, posé EN DERNIER : il doit couvrir la jonction des lisses, sinon un angle
  // montre quatre bouts de bois qui se croisent sans rien pour les tenir.
  rect(g, BOIS.nuit, 5, 4, 6, 9)
  rect(g, BOIS.sombre, 5, 4, 6, 8)
  rect(g, BOIS.mid, 6, 4, 4, 6)
  rect(g, BOIS.clair, 6, 4, 4, 2) // le dessus du poteau, éclairé
  joints.push({ path: [[5, 13], [5, 4]], crevasse: true }, { path: [[11, 13], [11, 4]], crevasse: true })

  return { albedo: c, joints }
}

// ── LE MUR EN RUINE ─────────────────────────────────────────────────────────
const W_CAP = 6 //  hauteur de la coiffe (le dessus du mur) — celle de `BootScene`

const MUR_PIERRE = ['#565660', '#5e5e68', '#4e4e58', '#63636d', '#585862']
const MUR_JOINT = '#3a3a43'
const MUR_OMBRE = '#33333b'
const MUR_CRETE = ['#6d6d77', '#74747e', '#666670']
const MUR_MOUSSE = ['#4a5a36', '#54663e']

/**
 * LA CRÊTE, ÉBRÉCHÉE — de combien de pixels le sommet est-il rongé, colonne par colonne ?
 *
 * C'est le signe de ruine le plus fort, parce qu'il change la SILHOUETTE : il se lit à toutes
 * les distances, avant même qu'on distingue une pierre. (Un mur droit lit « entretenu », quoi
 * qu'on peigne dessus.) Bornée à 4 px : au-delà, ce n'est plus un mur, c'est un tas.
 */
export function profilDeCrete(mask: number, graine: number): number[] {
  const profil: number[] = []
  for (let x = 0; x < T; x++) {
    // Deux octaves : une ondulation lente (le mur s'affaisse par pans) + un grain par pixel.
    const lent = h(graine, Math.floor(x / 5), 11)
    const fin = h(graine, x, 23)
    let d = Math.round(lent * 3 + fin * 1.6)
    // UN BORD QUI A UN VOISIN NE S'ÉBRÈCHE PAS SUR SES DEUX DERNIERS PIXELS : c'est ce qui
    // interdit la couture. On rentre l'entaille progressivement au lieu de la couper net.
    if (mask & O && x < 2) d = Math.min(d, x)
    if (mask & E && x > T - 3) d = Math.min(d, T - 1 - x)
    profil.push(Math.min(4, d))
  }
  return profil
}

function dessinerMurRuine(mask: number, graine: number): { albedo: HTMLCanvasElement; joints: Crack[] } {
  const { c, ctx: g } = newCanvas(T, W_H)
  const joints: Crack[] = []
  const coiffe = !(mask & N) // pas de voisin au nord → on voit le DESSUS du mur
  const crete = coiffe ? profilDeCrete(mask, graine) : new Array<number>(T).fill(0)

  // ── LA FACE : des assises de pierres, en appareil décalé ──────────────────
  const faceTop = coiffe ? W_CAP : 0
  const assises: number[] = []
  for (let y = faceTop; y < W_H; y += 5) assises.push(y)

  for (const [ia, y0] of assises.entries()) {
    const y1 = Math.min(W_H, y0 + 5)
    // L'appareil ne doit pas aligner ses joints verticalement, sinon le mur lit « carrelage ».
    let x = -Math.floor(h(mask, ia, 3) * 5)
    while (x < T) {
      const larg = 3 + Math.floor(h(mask, ia, x + 40) * 4) // 3..6 px : des pierres INÉGALES
      const px0 = Math.max(0, x)
      const px1 = Math.min(T, x + larg)
      if (px1 > px0) {
        rect(g, MUR_PIERRE[Math.floor(h(mask, ia, x + 91) * MUR_PIERRE.length)]!, px0, y0, px1 - px0, y1 - y0)
        // Le joint horizontal, PEINT sous la pierre : la normale seule ne se lit que sous une
        // lumière rasante. On dit la maçonnerie deux fois — en couleur, et en relief.
        rect(g, MUR_OMBRE, px0, y1 - 1, px1 - px0, 1)
      }
      // Le joint VERTICAL, gravé ET peint. Sans lui dans l'albédo, le mur lisait comme des
      // BANDES horizontales : rien ne séparait deux pierres voisines d'une même assise.
      if (x > 0 && x < T) {
        joints.push({ path: [[x, y1], [x, y0]] })
        rect(g, MUR_JOINT, x, y0, 1, y1 - y0 - 1)
      }
      x += larg
    }
    if (ia > 0) joints.push({ path: [[0, y0], [T, y0]] })
  }

  // ── LA COIFFE : le dessus du mur, ÉBRÉCHÉ ────────────────────────────────
  if (coiffe) {
    for (let x = 0; x < T; x++) {
      const y0 = crete[x]!
      if (y0 >= W_CAP) continue
      rect(g, MUR_CRETE[Math.floor(h(mask, x, 7) * MUR_CRETE.length)]!, x, y0, 1, W_CAP - y0)
    }
    rect(g, MUR_OMBRE, 0, W_CAP - 1, T, 1) // l'arête d'ombre sous la coiffe
    // ON EFFACE CE QUE LA CRÊTE A MANGÉ : c'est la TRANSPARENCE qui fabrique la silhouette
    // dentelée dont la normale se sert.
    for (let x = 0; x < T; x++) if (crete[x]! > 0) g.clearRect(x, 0, 1, crete[x]!)
  }

  // ── LES PIERRES DESCELLÉES : des trous TRAVERSANTS ───────────────────────
  // Jamais contre un bord accosté (couture), jamais plus d'un par tuile, une tuile sur trois.
  if (h(mask, graine, 77) < 0.34) {
    const xMin = mask & O ? 2 : 1
    const xMax = mask & E ? T - 2 : T - 1
    const yMin = (coiffe ? W_CAP : 0) + 2
    const yMax = W_H - 3
    const tw = 2 + Math.floor(h(mask, graine, 5) * 2)
    const th = 2 + Math.floor(h(mask, graine, 6) * 2)
    const tx = xMin + Math.floor(h(mask, graine, 8) * Math.max(1, xMax - xMin - tw))
    const ty = yMin + Math.floor(h(mask, graine, 9) * Math.max(1, yMax - yMin - th))
    g.clearRect(tx, ty, tw, th)
    rect(g, MUR_OMBRE, tx - 1, ty, 1, th) // le pourtour de la brèche s'écaille
    rect(g, MUR_OMBRE, tx + tw, ty, 1, th)
  }

  // ── LA MOUSSE, AU PIED ───────────────────────────────────────────────────
  // Peinte APRÈS coup : ce qui se peint après la dérivation n'entre pas dans la normale —
  // la mousse est une COULEUR, pas un relief.
  for (let k = 0; k < 6; k++) {
    rect(g, MUR_MOUSSE[k % MUR_MOUSSE.length]!,
      Math.floor(h(mask, k, 31) * T), W_H - 1 - Math.floor(h(mask, k, 37) * 6),
      1 + Math.floor(h(mask, k, 41) * 3), 1)
  }

  return { albedo: c, joints }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LE SOL ET LE TOIT TOMBÉS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assombrir le neuf ne suffit pas à dire « ruine » : un plancher net et un chaume doré, juste
 * plus sombres, lisent « maison à l'ombre ». Ce qui dit la ruine, ce sont les TROUS — et un
 * trou ne se teinte pas, il se dessine. Ces deux-là restent PLATS (aucune `_lit`) : la règle
 * de `lit-structures` vaut toujours — une normale en butte sur une pièce au ras du sol ferait
 * un coussin par tuile.
 */
/**
 * LA TERRE BATTUE d'une cour — piétinée, sèche, avec ce qui repousse aux bords.
 *
 * PLATE, comme la friche et le dallage : aucune `_lit`. La règle de `lit-structures` vaut ici
 * aussi — une normale en butte sur une pièce au ras du sol ferait un coussin par tuile.
 */
function dessinerTerre(variante: number): HTMLCanvasElement {
  const { c, ctx: g } = newCanvas(T, T)
  rect(g, '#6b5a42', 0, 0, T, T) //         la terre, tassée
  rect(g, '#75634a', 1, 1, T - 2, T - 2) // le passage clair, au centre
  for (let k = 0; k < 7; k++) {
    // Les cailloux et les touffes que le piétinement a laissés — décalés par variante, sinon
    // une cour de vingt tuiles devient un damier.
    const x = Math.floor(h(variante, k, 3) * T)
    const y = Math.floor(h(variante, k, 11) * T)
    rect(g, k % 3 === 0 ? '#5c6b3e' : '#5f5039', x, y, 1 + (k % 2), 1)
  }
  return c
}

/**
 * LE SOL D'UN BÂTI EN RUINE : DE LA TERRE BATTUE (décision d'Alexis, 2026-07-27).
 *
 * C'était un plancher défoncé — des lames dépareillées sur du noir. Dans une ferme abandonnée
 * depuis dix ans, ce n'est pas ce qu'on foule : on foule la TERRE, tassée par des années de
 * passage, reprise par la poussière. Le sol cesse ainsi de raconter un meuble et redevient ce
 * qu'il est : le fond de la pièce, sur lequel le mobilier se détache.
 *
 * Il reste DISTINCT de la cour (`dessinerTerre`), sans quoi le dedans et le dehors se
 * confondraient à travers une brèche : la terre du dedans est plus SOMBRE (elle n'a pas de
 * ciel), plus unie (on la balayait), et rien n'y repousse — pas un brin de vert. Dehors, la
 * cour garde ses touffes.
 */
function dessinerSolRuine(): HTMLCanvasElement {
  const { c, ctx: g } = newCanvas(T, T)
  rect(g, '#4a3f2e', 0, 0, T, T) //          la terre battue, tassée et sèche
  rect(g, '#524736', 1, 1, T - 2, T - 2) //  le centre, poli par le passage
  // Ce que le sol garde : de la poussière, un gravillon, une trace. Aucun vert : sous un toit
  // tombé il pousse des ronces au PIED des murs, pas au milieu d'une pièce qu'on traverse.
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(h(7, k, 3) * T)
    const y = Math.floor(h(7, k, 11) * T)
    rect(g, k % 2 === 0 ? '#3f3626' : '#5b503c', x, y, 1 + (k % 2), 1)
  }
  return c
}

function dessinerToitRuine(): HTMLCanvasElement {
  const { c, ctx: g } = newCanvas(T, T)
  // Les trous sont peints EN NE PEIGNANT PAS : des bandes qui ne couvrent pas toute la tuile,
  // et le vide reste transparent. C'est ce qui fait toute la différence à l'œil — un toit
  // ruiné laisse voir dessous.
  rect(g, '#807a52', 0, 0, 13, 5) //    le pan qui tient encore, au nord
  rect(g, '#6e6a48', 0, 5, 10, 4) //    le chaume affaissé
  rect(g, '#585438', 0, 4, 13, 1)
  rect(g, '#6e6a48', 4, 9, 12, 4) //    un dernier lambeau, décalé
  rect(g, '#585438', 4, 12, 12, 1)
  rect(g, '#6a7444', 1, 1, 2, 3) //     la mousse a pris le chaume
  rect(g, '#6a7444', 11, 9, 3, 2)
  return c
}

// ═══════════════════════════════════════════════════════════════════════════
//  L'ENREGISTREMENT
// ═══════════════════════════════════════════════════════════════════════════

/** Copie d'un canvas — Phaser prend la propriété de celui qu'on passe à `addCanvas`. */
function copier(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, ctx } = newCanvas(src.width, src.height)
  ctx.drawImage(src, 0, 0)
  return c
}

/** Pose `st-<cle>` (albédo) ET `st-<cle>_lit` (albédo + normale) du même dessin. */
function poser(
  scene: Phaser.Scene, cle: string, albedo: HTMLCanvasElement, normale: HTMLCanvasElement,
): void {
  if (scene.textures.exists(cle)) scene.textures.remove(cle)
  scene.textures.addCanvas(cle, copier(albedo))
  registerLit(scene, `${cle}_lit`, albedo, normale)
}

/** Les types qui ont leur `_lit` ici — la source du swap de `SnapshotView`, jamais recopiée. */
export const BATI_LIT_TYPES: ReadonlySet<string> = new Set([...PIECES.map((p) => p.type), 'cloture', 'encadrement'])

/** Toutes les clés produites — la surface testable. */
export const BATI_KEYS: readonly string[] = [
  ...PIECES.flatMap((p) => [`st-${p.type}`, `st-${p.type}_lit`]),
  ...Array.from({ length: 16 }, (_, m) => [`st-cloture-${m}`, `st-cloture-${m}_lit`]).flat(),
  ...Array.from({ length: 16 }, (_, m) => [`st-wall-ruine-${m}`, `st-wall-ruine-${m}_lit`]).flat(),
  // `st-cloture` sans masque : le repli, celui que demande tout code qui connaît le TYPE et pas
  // le voisinage (le fantôme de pose). Il a sa `_lit` comme les autres — l'oublier ici l'aurait
  // rendu invisible à la garde de couverture, alors qu'il existe bel et bien.
  'st-cloture', 'st-cloture_lit',
  // Les COUPÉS sont PLATS (aucune `_lit`) : un trait d'ombre au sol ne s'éclaire pas.
  ...Array.from({ length: 4 }, (_, m) => `st-encadrement-coupe-${m}`),
  ...Array.from({ length: 4 }, (_, m) => [`st-encadrement-${m}`, `st-encadrement-${m}_lit`]).flat(),
  'st-encadrement', 'st-encadrement_lit',
  'st-friche', 'st-friche-0', 'st-friche-1', 'st-friche-2', 'st-friche-3',
  'st-terre', 'st-terre-0', 'st-terre-1', 'st-terre-2', 'st-terre-3',
  'st-floor-ruine', 'st-roof-ruine',
]

/**
 * LA FRICHE — quatre variantes, tirées par position au rendu.
 *
 * Un champ fait vingt tuiles : une texture unique s'y répète en damier parfait et le champ
 * devient du papier peint (vu en jeu, c'est le premier défaut qui saute aux yeux). Les sillons
 * gardent le MÊME pas d'une variante à l'autre — ce qui change, c'est où l'herbe a repris. Un
 * champ garde donc ses rangs, et c'est ce qui le fait lire comme un champ.
 */
const FRICHE_TOUFFES: readonly (readonly [number, number, number, number, number][])[] = [
  [[1, 5, 2, 5, 0], [6, 1, 3, 6, 1], [12, 8, 3, 6, 0], [4, 11, 3, 4, 1]],
  [[0, 1, 3, 4, 1], [5, 7, 4, 5, 0], [11, 2, 3, 7, 1], [7, 13, 4, 3, 0]],
  [[2, 9, 3, 6, 1], [8, 4, 3, 8, 0], [13, 11, 3, 5, 1], [0, 12, 3, 4, 0]],
  [[3, 2, 4, 5, 0], [10, 6, 3, 5, 1], [1, 10, 2, 6, 1], [6, 12, 5, 4, 0]],
]

function dessinerFriche(variante: number): HTMLCanvasElement {
  const { c, ctx: g } = newCanvas(T, T)
  rect(g, '#4a4426', 0, 0, T, T)
  rect(g, '#5a4028', 2, 2, 3, 12) // ce qui reste des sillons
  rect(g, '#5a4028', 9, 4, 3, 10)
  for (const [x, y, w, hh, clair] of FRICHE_TOUFFES[variante]!) {
    rect(g, clair ? '#8a9a44' : '#7a8a3a', x, y, w, hh)
  }
  return c
}

/**
 * Tout l'art du monde bâti, en une passe. Appelée par `BootScene` après les chips ordinaires.
 *
 * `passes: 1` — et c'est le réglage qui décide de tout. Lisser davantage NOIE les sillons qu'on
 * vient de graver (ils font 1 à 2 px ; deux passes les ont déjà mangés, essayé). `k: 3,2` suit
 * le cadran « petit prop blocky » de `normal-map.ts`, adouci parce qu'ici le relief vient des
 * sillons et non de la seule silhouette. `cell: 2` garde une facette par paire de pixels : à
 * `3`, une pierre de 3 px n'a plus qu'une cellule et redevient plate.
 */
/** Les tons des trois familles de barrière. La pierre RUINÉE est plus sombre et délavée. */
const T_MUR = { top: '#8f8f99', face: '#5e5e68', pied: '#4a4a54', arete: '#3a3a43' }
const T_RUINE = { top: '#6d6d77', face: '#4a4a54', pied: '#3a3a43', arete: '#2e2e36' }
const T_CLOT = { top: '#8a6438', face: '#5a3f24', pied: '#3a2818', arete: '#2e2016' }

/**
 * LES MURS SONT UNIS (décision d'Alexis, 2026-07-27) — plus d'appareil de pierre.
 *
 * Le dessus portait des joints tous les 3 à 5 px : à 16 px de tuile, ce motif ne lisait pas
 * « maçonnerie », il lisait « bruit », et il se répétait le long d'un mur qui file. Un aplat par
 * SURFACE (le dessus, la face, le pied) : le mur tient alors sa lecture de sa silhouette et de
 * son volume — la coiffe claire sur la face sombre — et non d'une texture qu'on ne voit pas.
 *
 * Ce qui reste dans `dessinerBarriere` : `top`/`topH`/`face`/`pied` sont quatre APLATS, pas un
 * grain. Le paramètre `grain` reste offert par la fonction : c'est ce qui rend la décision
 * réversible en une ligne, et c'est déjà par là que passait la clôture (qui, elle, n'en a
 * jamais eu).
 */
type Bande = { x: number; y: number; w: number; h: number }

/**
 * LES BARRIÈRES SUR ARÊTE, pour les seize masques et les trois familles.
 *
 * Seize et non quarante-sept : la forme n'est plus DEVINÉE du voisinage, elle est PORTÉE par la
 * structure (`Structure.edges`). L'autotuilage cesse d'exister — et avec lui la question des
 * coins rentrants, qui s'expriment désormais directement.
 */
function generateEdgeBarrieres(scene: Phaser.Scene): void {
  for (let mask = 1; mask < 16; mask++) {
    for (const [nom, ht, tons, grain] of [
      ['wall', MUR_HT, T_MUR, undefined],
      ['wall-ruine', MUR_HT, T_RUINE, undefined],
      ['cloture', CLOT_HT, T_CLOT, undefined],
    ] as [string, number, typeof T_MUR, ((g: Ctx, b: Bande, bit: number) => void) | undefined][]) {
      const { albedo, joints } = dessinerBarriere(mask, ht, tons, grain)
      poser(scene, `st-${nom}-e${mask}`, albedo, normalFromCanvas(albedo, 1, 3.2, 2, false, joints))
    }
    // LES COUPÉS — une seule famille de mur pour le neuf comme pour la ruine (une empreinte au
    // sol n'a ni appareil ni usure), et une pour la clôture, qui garde son bois. PLATS (aucune
    // `_lit`) : un trait d'ombre ne s'éclaire pas.
    for (const [nom, ht, sol, fil] of [
      ['wall-coupe', MUR_HT, COUPE_SOL, COUPE_LISERE],
      ['cloture-coupe', CLOT_HT, BOIS.nuit, BOIS.sombre],
    ] as const) {
      const cle = `st-${nom}-e${mask}`
      if (scene.textures.exists(cle)) scene.textures.remove(cle)
      scene.textures.addCanvas(cle, dessinerBarriereCoupee(mask, ht, sol, fil))
    }
  }
}

/**
 * L'ORIGINE VERTICALE À DONNER AU SPRITE, par famille de barrière — le bas de sa TUILE, qui
 * n'est plus le bas de son image depuis que le mur est à cheval sur l'arête. `snapshot-view` la
 * lit ; personne ne la recalcule (deux formules pour un même ancrage finiraient par différer,
 * et le symptôme serait un bâti décalé d'un demi-mur, à peine visible et jamais expliqué).
 */
/**
 * L'EMPRISE D'UNE BARRIÈRE À L'ÉCRAN, par famille — ce qu'elle RECOUVRE au-dessus de sa tuile.
 * `snapshot-view` s'en sert pour savoir si elle avale le joueur (`barriereAvale`) : la hauteur
 * du mur ne se recopie pas là-bas, elle se lit ici, là où le sprite est dessiné.
 */
export const EDGE_SPRITE: Readonly<Record<string, { hauteurPx: number; largeurPx: number }>> = {
  wall: { hauteurPx: MUR_HT, largeurPx: T + 2 * M },
  'wall-ruine': { hauteurPx: MUR_HT, largeurPx: T + 2 * M },
  encadrement: { hauteurPx: MUR_HT, largeurPx: T + 2 * M },
  cloture: { hauteurPx: CLOT_HT, largeurPx: T + 2 * M },
}

export const EDGE_ORIGIN_Y: Readonly<Record<string, number>> = {
  wall: originY(MUR_HT),
  'wall-ruine': originY(MUR_HT),
  'wall-coupe': originY(MUR_HT),
  'cloture-coupe': originY(CLOT_HT),
  encadrement: originY(MUR_HT),
  cloture: originY(CLOT_HT),
}

/** Toutes les clés d'arête — la surface testable, jamais recopiée. */
export const EDGE_BARRIER_KEYS: readonly string[] = [
  ...['wall', 'wall-ruine', 'cloture'].flatMap((nom) =>
    Array.from({ length: 15 }, (_, i) => [`st-${nom}-e${i + 1}`, `st-${nom}-e${i + 1}_lit`]).flat()),
  ...Array.from({ length: 15 }, (_, i) => [`st-wall-coupe-e${i + 1}`, `st-cloture-coupe-e${i + 1}`]).flat(),
]

export function generateBatiArt(scene: Phaser.Scene): void {
  generateEdgeBarrieres(scene)
  for (const p of PIECES) {
    const { c, ctx } = newCanvas(p.largeur ?? T, p.hauteur ?? T)
    const joints = p.dessiner(ctx)
    poser(scene, `st-${p.type}`, c, normalFromCanvas(c, p.passes ?? 1, p.k ?? 3.2, p.cell ?? 2, p.plant ?? false, joints))
  }
  for (let mask = 0; mask < 16; mask++) {
    const cl = dessinerCloture(mask)
    poser(scene, `st-cloture-${mask}`, cl.albedo, normalFromCanvas(cl.albedo, 1, 3.2, 2, false, cl.joints))
    const mur = dessinerMurRuine(mask, mask * 13 + 5)
    poser(scene, `st-wall-ruine-${mask}`, mur.albedo, normalFromCanvas(mur.albedo, 1, 3.2, 2, false, mur.joints))
  }
  // `st-cloture` tout court : le poteau seul (masque 0) — le fantôme de pose et tout code qui
  // demanderait la texture par son nom de type. Le rendu, lui, passe par les masques.
  const seul = dessinerCloture(0)
  poser(scene, 'st-cloture', seul.albedo, normalFromCanvas(seul.albedo, 1, 3.2, 2, false, seul.joints))
  // `st-encadrement` tout court : le repli de qui connaît le TYPE et pas le voisinage.
  const seuil = dessinerEncadrement(0)
  poser(scene, 'st-encadrement', seuil.albedo, normalFromCanvas(seuil.albedo, 1, 3.2, 2, false, seuil.joints))

  // Les pièces AU RAS DU SOL restent PLATES (aucune `_lit`) — règle de `lit-structures`.
  for (let v = 0; v < 4; v++) {
    for (const [prefixe, dessin] of [['st-friche', dessinerFriche], ['st-terre', dessinerTerre]] as const) {
      const cle = `${prefixe}-${v}`
      if (scene.textures.exists(cle)) scene.textures.remove(cle)
      scene.textures.addCanvas(cle, dessin(v))
    }
  }
  // LE SEUIL, EN QUATRE : selon qu'il a un voisin à l'ouest, à l'est, les deux ou aucun.
  for (let m = 0; m < 4; m++) {
    const e = dessinerEncadrement(m)
    poser(scene, `st-encadrement-${m}`, e.albedo, normalFromCanvas(e.albedo, 1, 3.2, 2, false, e.joints))
    const cc = dessinerEncadrementCoupe(m)
    const cle = `st-encadrement-coupe-${m}`
    if (scene.textures.exists(cle)) scene.textures.remove(cle)
    scene.textures.addCanvas(cle, cc)
  }
  for (const [cle, canvas] of [
    ['st-friche', dessinerFriche(0)],
    ['st-terre', dessinerTerre(0)],
    ['st-floor-ruine', dessinerSolRuine()],
    ['st-roof-ruine', dessinerToitRuine()],
  ] as const) {
    if (scene.textures.exists(cle)) scene.textures.remove(cle)
    scene.textures.addCanvas(cle, canvas)
  }
}
