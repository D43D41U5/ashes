/**
 * Les 26 LIEUX — placeholders dessinés par code (comme tout l'art du projet).
 *
 * QUATRE RÈGLES, et aucune n'est décorative :
 *
 * 1. L'ÉCHELLE fait autorité, et c'est l'ARBRE qui la porte. Une tuile = 16 px ;
 *    un avatar = 16 px ; un arbre de forêt = 44 px de haut sur 32 de large. Un
 *    lieu qui ne DÉPASSE PAS la canopée n'est pas un repère : on ne le voit pas
 *    venir, et la grappe qu'un Belvédère révèle ne promet rien qu'on puisse
 *    apercevoir. Les monuments montent au-dessus de 44 px ; ce qui est une TRACE
 *    (bivouac, source, fondrière) reste au sol.
 *
 * 2. LE SPRITE DÉBORDE L'EMPREINTE. L'empreinte (`fp × 16`) est ce qu'on FOULE —
 *    c'est elle que `poisAt` teste. Le sprite est ce qu'on VOIT. Le jeu le fait
 *    déjà pour les arbres : houppier de 2 tuiles sur un tronc d'un quart. Vouloir
 *    les égaler produit des poteaux (l'Arbre remarquable en fut un). Un toit
 *    déborde ses murs, un surplomb déborde son pied, une vapeur déborde sa
 *    vasque : c'est ce débord qui donne le volume.
 *
 * 3. LA SILHOUETTE avant le détail. À 16 px la tuile, on lit une FORME, jamais
 *    une texture. Chaque lieu doit être reconnaissable en ombre chinoise.
 *
 * 4. LA LUMIÈRE VIENT DU NORD-OUEST, comme le hillshade du terrain. Face claire
 *    en haut-à-gauche, ombre en bas-à-droite, ombre portée au sol qui ancre —
 *    sans elle, un sprite flotte.
 */
import type Phaser from 'phaser'

export const TILE = 16
/** La règle de tout : un arbre de forêt fait 44 px de haut sur 32 de large. */
export const TREE_H = 44
export const TREE_W = 32

export interface PoiArt {
  slug: string
  /** Empreinte, en tuiles — ce qu'on FOULE (`poisAt`). */
  fp: number
  /** Largeur du SPRITE, en px — ce qu'on VOIT. Déborde l'empreinte quand le lieu l'exige. */
  w: number
  /** Hauteur du sprite, en px. */
  h: number
  /**
   * Hauteur de la COURONNE : la part supérieure redessinée dans la bande des
   * houppiers, au-dessus des acteurs. Sans elle, un lieu qui perce la canopée se
   * fait recouvrir par les arbres voisins. Seuls les lieux assez hauts en ont.
   */
  crown?: number
}

/** fp = ce qu'on foule · w×h = ce qu'on voit · crown = ce qui perce la canopée. */
const ART: Record<string, { fp: number; w: number; h: number; crown?: number }> = {
  // ── ÉCONOMIE — ouvert, minéral, exploitable ──
  gisement: { fp: 4, w: 72, h: 42 }, //             un tas de déblais s'étale
  carriere: { fp: 4, w: 68, h: 56, crown: 14 },
  saline: { fp: 3, w: 52, h: 16 }, //               une croûte au sol
  verger: { fp: 3, w: 72, h: 50 }, //               les houppiers se touchent et débordent
  // ── ABRIS — bois, pierre chaude ──
  ruines: { fp: 4, w: 80, h: 78, crown: 38 }, //    un pan debout ; les gravats vont plus loin que le socle
  cabane: { fp: 2, w: 44, h: 56, crown: 16 }, //    LE TOIT DÉBORDE : c'est ce qui fait un toit
  abri: { fp: 2, w: 48, h: 34 }, //                 LE SURPLOMB DÉBORDE : c'est ce qui fait un abri
  mine: { fp: 3, w: 52, h: 66, crown: 26 }, //      le chevalement la signale de loin
  oratoire: { fp: 2, w: 34, h: 54, crown: 14 },
  bivouac: { fp: 2, w: 36, h: 24 }, //              une trace, pas un volume
  // ── DANGER — bas, sourd, hostile ──
  taniere: { fp: 3, w: 56, h: 30 }, //              le tertre de terre remuée s'étale
  repaire: { fp: 3, w: 58, h: 54, crown: 12 },
  epave: { fp: 2, w: 44, h: 36 },
  fondriere: { fp: 3, w: 58, h: 16 },
  crevasses: { fp: 4, w: 68, h: 20 },
  // ── LES ONZE LIEUX CHARGÉS ──
  belvedere: { fp: 2, w: 46, h: 80, crown: 40 }, // il fait grimper : il se voit du fond de la vallée
  grotte: { fp: 2, w: 48, h: 52, crown: 12 }, //    la masse rocheuse déborde sa gueule
  cascade: { fp: 2, w: 52, h: 96, crown: 56 }, //   une chute se voit de très loin ; l'écume s'étale
  erratique: { fp: 2, w: 42, h: 42 }, //            un bloc est TRAPU, pas élancé
  arbre: { fp: 2, w: 80, h: 100, crown: 62 }, //    5 tuiles d'envergure : un vieil arbre S'ÉTALE
  cairn: { fp: 1, w: 20, h: 30 }, //                le plus petit, et le plus fréquent
  sanctuaire: { fp: 2, w: 46, h: 74, crown: 34 },
  source_chaude: { fp: 2, w: 40, h: 34 }, //        la vapeur déborde la vasque
  arche: { fp: 2, w: 44, h: 82, crown: 42 },
  tarn: { fp: 3, w: 56, h: 26 },
  petroglyphes: { fp: 2, w: 40, h: 48, crown: 8 },
}

export const POI_ART: PoiArt[] = Object.entries(ART).map(([slug, a]) => ({
  slug,
  fp: a.fp,
  w: a.w,
  h: a.h,
  ...(a.crown !== undefined ? { crown: a.crown } : {}),
}))

export const poiTextureKey = (slug: string): string => `poi-${slug}`
export const poiCrownKey = (slug: string): string => `poi-${slug}-crown`

// ── Palettes : la famille se lit à la couleur, le lieu à la forme ──
const STONE = { lit: 0xb4ada1, mid: 0x8d867b, dark: 0x605a51, deep: 0x3e3a34 }
const WOOD = { lit: 0x8a5c33, mid: 0x6b4525, dark: 0x4a2f18, deep: 0x2a1a0e }
const OCHRE = { lit: 0x9a8352, mid: 0x76633c, dark: 0x51452a, deep: 0x33291a }
const RUST = { lit: 0x6e5344, mid: 0x503c30, dark: 0x35271f, deep: 0x1d1512 }
const WATER = { lit: 0x7fc4dc, mid: 0x3d8fae, dark: 0x255c76, deep: 0x143848 }
const LEAF = { lit: 0x3f8a3a, mid: 0x2a6129, dark: 0x1a4019, deep: 0x0e2610 }
const ICE = { lit: 0xeef6fa, mid: 0xc8dce8, dark: 0x8fa8bc, deep: 0x1a3048 }
const VOID = 0x0a0908
const SHADOW = 0x000000

export function makePoiTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()

  /** L'ombre portée — ce qui ancre un sprite au sol. Sans elle, tout flotte. */
  const ground = (w: number, b: number, spread = 0.8): void => {
    g.fillStyle(SHADOW, 0.26).fillEllipse(w / 2 + 1, b - 2, w * spread, 8)
  }

  const tex = (slug: string, draw: (w: number, b: number) => void): void => {
    const a = POI_ART.find((p) => p.slug === slug)!
    g.clear()
    draw(a.w, a.h)
    g.generateTexture(poiTextureKey(slug), a.w, a.h)
    // La COURONNE : le MÊME dessin, capturé sur une hauteur plus courte.
    // `generateTexture` cadre depuis l'origine, donc demander `crown` px ne garde
    // que le haut du sprite. Il se redessine dans la bande des houppiers —
    // identique au pixel près là où ils se recouvrent, et enfin VISIBLE.
    if (a.crown !== undefined) g.generateTexture(poiCrownKey(slug), a.w, a.crown)
  }

  // ══════════════ ÉCONOMIE ══════════════
  tex('gisement', (w, b) => {
    ground(w, b, 0.95)
    const c = w / 2
    // Un tas de déblais, largement étalé, où le métal affleure.
    g.fillStyle(OCHRE.dark).fillEllipse(c, b - 10, w - 2, 22)
    g.fillStyle(OCHRE.dark).fillTriangle(6, b - 8, c - 4, b - 34, w - 10, b - 8)
    g.fillStyle(OCHRE.mid).fillTriangle(6, b - 8, c - 4, b - 34, c - 2, b - 8) // versant NO
    g.fillStyle(OCHRE.lit).fillTriangle(c - 14, b - 16, c - 4, b - 34, c - 6, b - 14)
    g.fillStyle(OCHRE.deep).fillEllipse(c + 16, b - 8, 26, 12) // ombre SE
    g.fillStyle(0xd9b23a).fillRect(c - 12, b - 24, 6, 5) // LA VEINE : ce qu'on vient chercher
    g.fillStyle(0xd9b23a).fillRect(c + 8, b - 15, 5, 4)
    g.fillStyle(0x2a2622).fillRect(c - 2, b - 19, 5, 4) // et le charbon
  })
  tex('carriere', (w, b) => {
    ground(w, b, 0.95)
    // Un front de taille en gradins — on a MANGÉ la montagne.
    g.fillStyle(STONE.dark).fillRect(0, b - 34, w, 32)
    g.fillStyle(STONE.mid).fillRect(0, b - 46, w - 14, 14)
    g.fillStyle(STONE.dark).fillRect(0, b - 56, w - 30, 12)
    g.fillStyle(STONE.lit).fillRect(0, b - 56, w - 40, 5) // la lèvre, en pleine lumière
    g.fillStyle(STONE.lit).fillRect(0, b - 46, 6, 14)
    g.fillStyle(STONE.deep).fillRect(8, b - 32, w - 12, 4) // l'ombre de chaque gradin
    g.fillStyle(STONE.deep).fillRect(20, b - 44, w - 34, 3)
    g.fillStyle(STONE.deep).fillRect(w - 12, b - 34, 12, 32) // le flanc SE
    g.fillStyle(STONE.mid).fillRect(5, b - 11, 14, 9) // les blocs débités, au pied
    g.fillStyle(STONE.lit).fillRect(5, b - 11, 5, 3)
    g.fillStyle(STONE.mid).fillRect(46, b - 9, 12, 7)
  })
  tex('saline', (w, b) => {
    const c = w / 2
    g.fillStyle(OCHRE.deep, 0.3).fillEllipse(c, b - 4, w - 2, 10)
    g.fillStyle(0xcfc9b4).fillEllipse(c, b - 7, w - 6, 12) // la croûte
    g.fillStyle(0xe8e2d0).fillEllipse(c - 4, b - 8, w - 20, 8)
    g.fillStyle(0xfdfbf4).fillEllipse(c - 10, b - 9, 14, 4) // le sel, éclatant au NO
    g.fillStyle(0xb8b2a0).fillEllipse(c + 14, b - 6, 12, 4) // la boue au SE
  })
  tex('verger', (w, b) => {
    ground(w, b, 0.9)
    // Trois arbres fruitiers dont les houppiers SE TOUCHENT et débordent le
    // verger : c'est ça, un verger. Bas et ronds — l'inverse d'un conifère.
    for (const [ox, s] of [[13, 0], [36, 4], [58, 1]] as const) {
      g.fillStyle(WOOD.dark).fillRect(ox - 2, b - 18 - s, 5, 18)
      g.fillStyle(WOOD.mid).fillRect(ox - 2, b - 18 - s, 2, 18)
    }
    for (const [ox, s] of [[13, 0], [36, 4], [58, 1]] as const) {
      g.fillStyle(LEAF.dark).fillEllipse(ox, b - 30 - s, 26, 24)
      g.fillStyle(LEAF.mid).fillEllipse(ox - 3, b - 33 - s, 18, 16)
      g.fillStyle(LEAF.lit).fillEllipse(ox - 6, b - 36 - s, 10, 8) // lumière NO
      g.fillStyle(LEAF.deep).fillEllipse(ox + 7, b - 26 - s, 9, 8) // ombre SE
      g.fillStyle(0xc0392b).fillCircle(ox - 8, b - 30 - s, 2) // les fruits
      g.fillStyle(0xc0392b).fillCircle(ox + 5, b - 36 - s, 2)
      g.fillStyle(0xd05040).fillCircle(ox + 2, b - 25 - s, 2)
    }
  })

  // ══════════════ ABRIS ══════════════
  tex('ruines', (w, b) => {
    ground(w, b, 0.9)
    // UN PAN DEBOUT de 76 px, qui dépasse les arbres et se voit de loin. C'est
    // lui qui donne envie d'aller voir. Les gravats débordent le socle.
    g.fillStyle(STONE.deep).fillEllipse(w / 2, b - 5, w - 6, 12) // le tas de gravats
    g.fillStyle(STONE.dark).fillEllipse(w / 2 - 12, b - 7, 22, 8)
    g.fillStyle(STONE.dark).fillEllipse(w / 2 + 16, b - 6, 18, 7)
    g.fillStyle(STONE.mid).fillRect(9, b - 76, 20, 74) // le pan principal
    g.fillStyle(STONE.lit).fillRect(9, b - 76, 6, 74) // son arête NO
    g.fillStyle(STONE.deep).fillRect(24, b - 76, 5, 74) // son arête SE
    g.fillStyle(VOID).fillRect(14, b - 58, 8, 13) // une fenêtre béante
    g.fillStyle(STONE.dark).fillRect(9, b - 78, 20, 4) // le sommet ébréché
    g.fillStyle(STONE.dark).fillRect(11, b - 82, 8, 5)
    g.fillStyle(STONE.mid).fillRect(38, b - 42, 17, 40) // un second pan, cassé
    g.fillStyle(STONE.lit).fillRect(38, b - 42, 5, 40)
    g.fillStyle(STONE.deep).fillRect(51, b - 42, 4, 40)
    g.fillStyle(STONE.dark).fillRect(38, b - 45, 17, 4)
    g.fillStyle(STONE.dark).fillRect(62, b - 20, 13, 18) // un moignon, plus loin
    g.fillStyle(STONE.mid).fillRect(62, b - 20, 4, 18)
  })
  tex('cabane', (w, b) => {
    ground(w, b, 0.75)
    const c = w / 2
    // LE TOIT DÉBORDE LES MURS — c'est exactement ce qui fait qu'un toit est un
    // toit, et ce qu'on ne pouvait pas dessiner tant que sprite = empreinte.
    g.fillStyle(WOOD.mid).fillRect(c - 13, b - 26, 26, 26) // le corps
    g.fillStyle(WOOD.lit).fillRect(c - 13, b - 26, 5, 26) // planche éclairée
    g.fillStyle(WOOD.deep).fillRect(c + 8, b - 26, 5, 26)
    g.fillStyle(VOID).fillRect(c - 5, b - 18, 10, 18) // la porte
    g.fillStyle(WOOD.dark).fillTriangle(0, b - 24, c, b - 52, w, b - 24) // LE TOIT, débordant
    g.fillStyle(WOOD.mid).fillTriangle(0, b - 24, c, b - 52, c - 1, b - 24) // versant NO éclairé
    g.fillStyle(WOOD.deep).fillRect(0, b - 26, w, 3) // l'avant-toit, à l'ombre
    g.fillStyle(WOOD.lit).fillRect(c - 2, b - 52, 4, 10) // le faîtage
    g.fillStyle(0x9a9186, 0.45).fillCircle(c + 6, b - 56, 3) // un filet de fumée
    g.fillStyle(0x9a9186, 0.25).fillCircle(c + 9, b - 62, 2)
  })
  tex('abri', (w, b) => {
    ground(w, b, 0.9)
    // LE SURPLOMB DÉBORDE SON PIED — c'est ce qui fait un abri sous roche, et
    // c'est précisément ce qu'une empreinte carrée interdisait de dessiner.
    g.fillStyle(STONE.dark).fillRect(8, b - 16, w - 16, 15) // le pied, en retrait
    g.fillStyle(VOID).fillRect(11, b - 15, w - 22, 14) // l'ombre où l'on se glisse
    g.fillStyle(STONE.mid).fillRect(0, b - 30, w, 15) // LA DALLE, qui déborde
    g.fillStyle(STONE.lit).fillRect(0, b - 32, w - 10, 6) // sa face éclairée
    g.fillStyle(STONE.deep).fillRect(0, b - 17, w, 3) // sa sous-face, sombre
    g.fillStyle(STONE.deep).fillRect(w - 10, b - 30, 10, 15)
  })
  tex('mine', (w, b) => {
    ground(w, b, 0.85)
    const c = w / 2
    g.fillStyle(STONE.dark).fillRect(0, b - 36, w, 34) // le flanc entaillé
    g.fillStyle(STONE.mid).fillRect(0, b - 44, w - 14, 10)
    g.fillStyle(STONE.deep).fillRect(w - 12, b - 36, 12, 34)
    g.fillStyle(VOID).fillRect(c - 11, b - 28, 22, 27) // la gueule noire
    g.fillStyle(VOID).fillEllipse(c, b - 28, 22, 12)
    // LE CHEVALEMENT : c'est lui qu'on voit de loin, et qui dit « on a creusé ici »
    g.fillStyle(WOOD.dark).fillRect(c - 13, b - 64, 5, 36)
    g.fillStyle(WOOD.dark).fillRect(c + 8, b - 64, 5, 36)
    g.fillStyle(WOOD.mid).fillRect(c - 13, b - 64, 2, 36) // arête NO
    g.fillStyle(WOOD.dark).fillRect(c - 17, b - 66, 34, 5) // la traverse
    g.fillStyle(WOOD.lit).fillRect(c - 17, b - 66, 34, 2)
    g.fillStyle(WOOD.dark).fillTriangle(c - 8, b - 61, c, b - 52, c + 8, b - 61) // le contreventement
    g.fillStyle(WOOD.mid).fillRect(c - 15, b - 32, 30, 5) // le linteau de la gueule
    g.fillStyle(WOOD.deep).fillRect(c - 15, b - 27, 30, 2)
  })
  tex('oratoire', (w, b) => {
    ground(w, b, 0.6)
    const c = w / 2
    g.fillStyle(STONE.dark).fillRect(c - 11, b - 16, 22, 15) // le socle
    g.fillStyle(STONE.mid).fillRect(c - 11, b - 18, 22, 4)
    g.fillStyle(STONE.lit).fillRect(c - 11, b - 18, 7, 4)
    g.fillStyle(STONE.mid).fillRect(c - 4, b - 46, 8, 30) // la stèle
    g.fillStyle(STONE.lit).fillRect(c - 4, b - 46, 3, 30)
    g.fillStyle(STONE.deep).fillRect(c + 2, b - 46, 2, 30)
    g.fillStyle(STONE.mid).fillRect(c - 11, b - 42, 22, 6) // les bras de la croix
    g.fillStyle(STONE.lit).fillRect(c - 11, b - 42, 22, 2)
    g.fillStyle(STONE.deep).fillRect(c + 4, b - 42, 7, 6)
    g.fillStyle(STONE.dark).fillRect(c - 5, b - 52, 10, 7) // le chapiteau
    g.fillStyle(STONE.lit).fillRect(c - 5, b - 52, 4, 3)
  })
  tex('bivouac', (w, b) => {
    // UNE TRACE, pas un volume : un foyer FROID, vu de dessus. Un cercle de
    // pierres, dessinées une par une — c'est ça qui le rend lisible, et pas une
    // tache sombre qu'on prendrait pour un houppier recadré.
    const c = w / 2
    g.fillStyle(SHADOW, 0.18).fillEllipse(c, b - 4, w - 4, 10)
    g.fillStyle(0x241f1a).fillEllipse(c, b - 8, w - 16, 9) // les cendres
    g.fillStyle(0x3a332c).fillEllipse(c - 3, b - 9, 10, 4)
    for (const [px, py] of [
      [c - 14, 0], [c - 8, -4], [c, -6], [c + 8, -4], [c + 14, 0],
      [c + 12, 5], [c + 5, 8], [c - 5, 8], [c - 12, 5],
    ] as const) {
      g.fillStyle(STONE.mid).fillCircle(px, b - 8 + py, 3.5)
      g.fillStyle(STONE.lit).fillCircle(px - 1, b - 9 + py, 1.6) // chaque pierre a sa lumière NO
      g.fillStyle(STONE.deep).fillCircle(px + 1.5, b - 7 + py, 1.2)
    }
    g.fillStyle(WOOD.deep).fillRect(c - 8, b - 10, 16, 2) // deux bûches en croix, éteintes
    g.fillStyle(WOOD.deep).fillRect(c - 1, b - 15, 2, 11)
  })

  // ══════════════ DANGER ══════════════
  tex('taniere', (w, b) => {
    const c = w / 2
    g.fillStyle(SHADOW, 0.2).fillEllipse(c, b - 3, w - 2, 8)
    // Le tertre de terre remuée s'étale largement — on voit qu'on a CREUSÉ ici.
    g.fillStyle(RUST.mid).fillEllipse(c, b - 11, w - 4, 24)
    g.fillStyle(RUST.lit).fillEllipse(c - 12, b - 16, 20, 10) // lumière NO
    g.fillStyle(RUST.deep).fillEllipse(c + 15, b - 8, 20, 10) // ombre SE
    g.fillStyle(VOID).fillEllipse(c + 2, b - 8, 20, 14) // LE TROU — la seule chose qui compte
    g.fillStyle(RUST.deep).fillEllipse(c + 2, b - 12, 21, 6) // sa lèvre supérieure
    g.fillStyle(0x6a5a48).fillCircle(c - 18, b - 6, 2) // des os, autour
    g.fillStyle(0x6a5a48).fillRect(c + 19, b - 5, 5, 2)
  })
  tex('repaire', (w, b) => {
    ground(w, b, 0.9)
    const c = w / 2
    g.fillStyle(0x2a2622).fillEllipse(c, b - 6, w - 4, 12) // le sol brûlé
    g.fillStyle(RUST.dark).fillTriangle(4, b - 8, 18, b - 44, 32, b - 8) // un abri de peaux
    g.fillStyle(RUST.mid).fillTriangle(4, b - 8, 18, b - 44, 18, b - 8) // versant NO
    g.fillStyle(RUST.lit).fillTriangle(9, b - 20, 18, b - 44, 18, b - 20)
    g.fillStyle(VOID).fillTriangle(13, b - 8, 18, b - 26, 24, b - 8) // son ouverture
    g.fillStyle(WOOD.deep).fillRect(40, b - 48, 4, 40) // un pieu planté
    g.fillStyle(0xd8d2c4).fillCircle(42, b - 50, 4) // ce qu'il y a dessus : un crâne
    g.fillStyle(0x2a2622).fillCircle(41, b - 51, 1.2)
    g.fillStyle(0x2a2622).fillCircle(44, b - 51, 1.2)
    g.fillStyle(0x8a2a1a).fillEllipse(c + 6, b - 7, 10, 5) // une braise qui couve encore
    g.fillStyle(0xe07a2a).fillEllipse(c + 5, b - 8, 5, 2)
    g.fillStyle(0x9a9186, 0.3).fillCircle(c + 8, b - 16, 3) // son filet de fumée
    g.fillStyle(0x9a9186, 0.18).fillCircle(c + 11, b - 23, 2)
  })
  tex('epave', (w, b) => {
    const c = w / 2
    g.fillStyle(SHADOW, 0.18).fillEllipse(c, b - 3, w - 4, 7)
    g.fillStyle(ICE.mid).fillEllipse(c, b - 7, w, 14) // le névé qui l'a recrachée
    g.fillStyle(ICE.lit).fillEllipse(c - 10, b - 9, 18, 6)
    g.fillStyle(RUST.dark).fillRect(6, b - 28, 24, 20) // la carcasse, tordue
    g.fillStyle(RUST.mid).fillRect(6, b - 28, 6, 20) // sa face NO
    g.fillStyle(RUST.deep).fillRect(24, b - 24, 14, 14)
    g.fillStyle(VOID).fillRect(12, b - 22, 8, 6) // un hublot crevé
    g.fillStyle(0x8a3a2a).fillRect(10, b - 36, 3, 9) // de la ferraille qui dépasse
    g.fillStyle(0x8a3a2a).fillRect(28, b - 32, 3, 9)
    g.fillStyle(0x8a3a2a).fillRect(10, b - 36, 8, 2)
  })
  tex('fondriere', (w, b) => {
    const c = w / 2
    g.fillStyle(0x1c2216).fillEllipse(c, b - 7, w - 2, 14) // la fange
    g.fillStyle(0x2e3a24).fillEllipse(c - 8, b - 8, 24, 9)
    g.fillStyle(0x46543a).fillEllipse(c + 14, b - 6, 14, 6) // un remous
    g.fillStyle(0x6a7852).fillEllipse(c - 4, b - 9, 7, 3) // une bulle qui crève
    g.fillStyle(0x6a7852).fillCircle(c + 6, b - 10, 2)
    g.fillStyle(0x5a4a32).fillRect(c - 20, b - 12, 3, 8) // des joncs morts
    g.fillStyle(0x5a4a32).fillRect(c + 20, b - 11, 2, 7)
  })
  tex('crevasses', (w, b) => {
    g.fillStyle(ICE.mid).fillRect(0, b - 15, w, 14) // la glace
    g.fillStyle(ICE.lit).fillRect(0, b - 18, w - 10, 5) // sa surface, éclatante
    g.fillStyle(ICE.dark).fillRect(0, b - 3, w, 3) // et son épaisseur, en dessous
    // LES FENTES : irrégulières, béantes — c'est ça qui menace
    for (const [x0, x1, x2] of [[5, 11, 8], [20, 29, 24], [40, 46, 43], [55, 62, 58]] as const) {
      g.fillStyle(ICE.deep).fillTriangle(x0, b - 16, x1, b - 16, x2, b - 1)
      g.fillStyle(0x2e5878).fillTriangle(x0 + 1, b - 15, x0 + 3, b - 15, x2, b - 5)
    }
  })

  // ══════════════ LES ONZE LIEUX CHARGÉS ══════════════
  tex('belvedere', (w, b) => {
    ground(w, b, 0.9)
    // Une pile de dalles en gradins, avec UNE VIRE PLATE au sommet — la marche
    // que le générateur creuse dans la roche, celle où l'on se tient pour
    // regarder la vallée. Il faut LIRE qu'on peut monter, et qu'en haut on domine.
    g.fillStyle(STONE.dark).fillRect(0, b - 28, w, 27) // le socle
    g.fillStyle(STONE.mid).fillRect(0, b - 28, 8, 27)
    g.fillStyle(STONE.deep).fillRect(w - 13, b - 28, 13, 27) // son flanc SE
    g.fillStyle(STONE.mid).fillRect(2, b - 48, w - 10, 21) // la dalle du milieu
    g.fillStyle(STONE.lit).fillRect(2, b - 48, 6, 21) // arête NO éclairée
    g.fillStyle(STONE.deep).fillRect(w - 14, b - 48, 6, 21)
    g.fillStyle(STONE.dark).fillRect(5, b - 62, w - 20, 15) // la dalle du haut
    g.fillStyle(STONE.mid).fillRect(5, b - 62, 5, 15)
    // LA VIRE : plate, claire, largement débordante — on voit qu'on peut s'y tenir
    g.fillStyle(STONE.lit).fillRect(0, b - 68, w - 8, 7)
    g.fillStyle(STONE.deep).fillRect(0, b - 61, w - 8, 2) // l'ombre sous la vire
    // le cairn du sommet : quelqu'un est monté avant toi
    g.fillStyle(STONE.mid).fillEllipse(13, b - 72, 10, 6)
    g.fillStyle(STONE.dark).fillEllipse(13, b - 77, 8, 5)
    g.fillStyle(STONE.lit).fillEllipse(13, b - 81, 5, 4)
  })
  tex('grotte', (w, b) => {
    ground(w, b, 0.95)
    const c = w / 2
    // La masse rocheuse DÉBORDE sa gueule : sans ce débord, une grotte n'est
    // qu'un trou dans un mur. Avec, c'est un rocher qu'on a percé.
    g.fillStyle(STONE.dark).fillEllipse(c, b - 22, w, 46)
    g.fillStyle(STONE.dark).fillRect(2, b - 22, w - 4, 21)
    g.fillStyle(STONE.mid).fillEllipse(c - 10, b - 30, 26, 24) // le volume NO
    g.fillStyle(STONE.lit).fillEllipse(c - 14, b - 36, 15, 10) // la lumière y prend
    g.fillStyle(STONE.deep).fillEllipse(c + 16, b - 16, 20, 20) // l'ombre SE
    // LA GUEULE : une arche, pas une ellipse — on doit lire une ENTRÉE
    g.fillStyle(VOID).fillRect(c - 9, b - 22, 18, 21)
    g.fillStyle(VOID).fillEllipse(c, b - 22, 18, 16)
    g.fillStyle(STONE.deep).fillEllipse(c, b - 29, 23, 9) // le linteau, en surplomb
  })
  tex('cascade', (w, b) => {
    const c = w / 2
    // 96 px : une chute d'eau se voit de TRÈS loin. L'écume déborde la vasque.
    g.fillStyle(STONE.dark).fillRect(6, b - 92, w - 12, 84) // la paroi
    g.fillStyle(STONE.mid).fillRect(6, b - 92, 9, 84) // son arête NO
    g.fillStyle(STONE.deep).fillRect(w - 14, b - 92, 8, 84)
    g.fillStyle(STONE.lit).fillRect(4, b - 96, w - 18, 6) // la lèvre d'où l'eau bascule
    g.fillStyle(WATER.dark).fillRect(c - 8, b - 92, 16, 84) // LE JET
    g.fillStyle(WATER.mid).fillRect(c - 6, b - 92, 11, 82)
    g.fillStyle(0xffffff).fillRect(c - 4, b - 92, 5, 78)
    g.fillStyle(WATER.lit).fillRect(c + 2, b - 90, 2, 74)
    g.fillStyle(WATER.dark, 0.6).fillEllipse(c, b - 8, w - 2, 15) // la vasque
    g.fillStyle(WATER.mid).fillEllipse(c, b - 9, w - 16, 10)
    g.fillStyle(0xffffff, 0.85).fillEllipse(c - 1, b - 12, 16, 7) // l'écume au pied du jet
    g.fillStyle(0xffffff, 0.3).fillCircle(c - 15, b - 18, 4) // les embruns, qui débordent
    g.fillStyle(0xffffff, 0.22).fillCircle(c + 15, b - 22, 3)
  })
  tex('erratique', (w, b) => {
    ground(w, b, 0.95)
    const c = w / 2
    // UN BLOC : trapu, lourd, posé là par un glacier disparu et qui n'a rien à
    // faire là. C'est sa MASSE le sujet — pas une arête, un POIDS.
    g.fillStyle(STONE.dark).fillEllipse(c, b - 18, w - 3, 34)
    g.fillStyle(STONE.dark).fillRect(3, b - 18, w - 6, 15)
    g.fillStyle(STONE.mid).fillEllipse(c - 5, b - 24, 24, 24) // la facette NO
    g.fillStyle(STONE.lit).fillEllipse(c - 9, b - 29, 13, 11) // la lumière y prend
    g.fillStyle(STONE.deep).fillEllipse(c + 10, b - 12, 18, 15) // l'ombre SE
    g.fillStyle(STONE.deep).fillRect(4, b - 5, w - 8, 4) // le pied, écrasé par le poids
    g.fillStyle(STONE.lit, 0.5).fillRect(c - 8, b - 27, 11, 2) // une veine de quartz
    g.fillStyle(LEAF.dark, 0.4).fillEllipse(c + 12, b - 30, 8, 4) // un peu de mousse, au nord
  })
  tex('arbre', (w, b) => {
    ground(w, b, 0.5)
    const c = w / 2
    // 100 px de haut, 80 de large, contre 44×32 pour un arbre de forêt. Ce qui
    // le rend REMARQUABLE, ce n'est pas la hauteur seule — c'est l'ENVERGURE.
    // Un vieil arbre s'étale ; il ne monte pas droit. (Un tronc fin sous une
    // boule haute, c'est une sucette : voir l'historique de ce fichier.)
    g.fillStyle(WOOD.deep).fillEllipse(c, b - 4, 34, 10) // les contreforts des racines
    g.fillStyle(WOOD.dark).fillEllipse(c - 9, b - 6, 12, 6)
    g.fillStyle(WOOD.dark).fillEllipse(c + 10, b - 5, 11, 5)
    g.fillStyle(WOOD.dark).fillTriangle(c - 13, b - 4, c - 6, b - 44, c + 6, b - 44) // le tronc, évasé
    g.fillStyle(WOOD.dark).fillTriangle(c + 13, b - 4, c + 6, b - 44, c - 6, b - 44)
    g.fillStyle(WOOD.dark).fillRect(c - 7, b - 46, 14, 44)
    g.fillStyle(WOOD.mid).fillRect(c - 7, b - 46, 5, 44) // arête NO
    g.fillStyle(WOOD.deep).fillRect(c + 3, b - 46, 4, 44) // ombre SE
    g.fillStyle(WOOD.dark).fillTriangle(c - 5, b - 40, c - 26, b - 56, c - 5, b - 50) // deux maîtresses
    g.fillStyle(WOOD.dark).fillTriangle(c + 5, b - 42, c + 27, b - 54, c + 5, b - 52)
    g.fillStyle(LEAF.dark).fillEllipse(c, b - 66, 76, 46) // LA COURONNE : large, basse
    g.fillStyle(LEAF.dark).fillEllipse(c - 28, b - 56, 26, 22) // les branches basses, qui pendent
    g.fillStyle(LEAF.dark).fillEllipse(c + 29, b - 54, 24, 20)
    g.fillStyle(LEAF.mid).fillEllipse(c - 8, b - 74, 50, 34)
    g.fillStyle(LEAF.mid).fillEllipse(c - 26, b - 62, 22, 18)
    g.fillStyle(LEAF.lit).fillEllipse(c - 16, b - 82, 28, 18) // la lumière prend au NO
    g.fillStyle(LEAF.lit).fillEllipse(c - 4, b - 88, 16, 10)
    g.fillStyle(LEAF.deep).fillEllipse(c + 22, b - 62, 26, 20) // l'ombre au SE
    g.fillStyle(LEAF.deep).fillEllipse(c + 10, b - 50, 22, 12) // et sous le feuillage
  })
  tex('cairn', (w, b) => {
    const c = w / 2
    g.fillStyle(SHADOW, 0.24).fillEllipse(c, b - 2, w - 2, 5)
    // Une tuile d'empreinte. Ce qui le rend lisible, c'est l'EMPILEMENT : des
    // pierres distinctes, de moins en moins grosses. Pas un cône.
    g.fillStyle(STONE.mid).fillEllipse(c, b - 5, 17, 8)
    g.fillStyle(STONE.lit).fillEllipse(c - 3, b - 6, 8, 3)
    g.fillStyle(STONE.deep).fillEllipse(c + 5, b - 4, 6, 3)
    g.fillStyle(STONE.dark).fillEllipse(c, b - 11, 14, 7)
    g.fillStyle(STONE.lit).fillEllipse(c - 3, b - 12, 6, 3)
    g.fillStyle(STONE.mid).fillEllipse(c, b - 17, 11, 6)
    g.fillStyle(STONE.lit).fillEllipse(c - 2, b - 18, 5, 2)
    g.fillStyle(STONE.dark).fillEllipse(c, b - 22, 8, 5)
    g.fillStyle(STONE.lit).fillEllipse(c, b - 26, 5, 4) // la dernière, en équilibre
  })
  tex('sanctuaire', (w, b) => {
    ground(w, b, 0.85)
    const c = w / 2
    // UN TRILITHE : deux montants et un linteau. La forme la plus ancienne qu'on
    // connaisse — en la voyant, on SAIT que des mains l'ont dressée.
    g.fillStyle(0x4a463f, 0.45).fillEllipse(c, b - 5, w - 4, 11) // le sol foulé, usé
    g.fillStyle(STONE.mid).fillRect(4, b - 62, 12, 60) // montant ouest
    g.fillStyle(STONE.lit).fillRect(4, b - 62, 4, 60)
    g.fillStyle(STONE.deep).fillRect(13, b - 62, 3, 60)
    g.fillStyle(STONE.mid).fillRect(30, b - 62, 12, 60) // montant est
    g.fillStyle(STONE.lit).fillRect(30, b - 62, 3, 60)
    g.fillStyle(STONE.deep).fillRect(38, b - 62, 4, 60)
    g.fillStyle(STONE.dark).fillRect(0, b - 74, w, 14) // LE LINTEAU, qui déborde les montants
    g.fillStyle(STONE.lit).fillRect(0, b - 74, w - 8, 5)
    g.fillStyle(STONE.deep).fillRect(0, b - 61, w, 3) // sa sous-face
    g.fillStyle(STONE.dark).fillRect(20, b - 34, 6, 32) // une troisième pierre, plus petite
    g.fillStyle(STONE.mid).fillRect(20, b - 34, 2, 32)
  })
  tex('source_chaude', (w, b) => {
    const c = w / 2
    g.fillStyle(SHADOW, 0.18).fillEllipse(c, b - 3, w - 4, 7)
    g.fillStyle(STONE.dark).fillEllipse(c, b - 9, w - 2, 17) // la margelle (celle qu'on creuse)
    g.fillStyle(STONE.lit).fillEllipse(c - 11, b - 12, 14, 6)
    g.fillStyle(STONE.deep).fillEllipse(c + 12, b - 7, 12, 5)
    g.fillStyle(WATER.deep).fillEllipse(c, b - 9, w - 14, 11) // l'eau, sombre
    g.fillStyle(0x3f9a92).fillEllipse(c, b - 10, w - 20, 7) // sa couleur minérale
    g.fillStyle(0x8fd4cc, 0.9).fillEllipse(c - 5, b - 11, 8, 3)
    // LA VAPEUR : c'est elle qu'on voit de loin, et qui dit « il fait chaud ici ».
    // Elle déborde la vasque — comme toute vapeur.
    g.fillStyle(0xe8f4f6, 0.45).fillCircle(c - 7, b - 19, 5)
    g.fillStyle(0xe8f4f6, 0.34).fillCircle(c + 2, b - 24, 4)
    g.fillStyle(0xe8f4f6, 0.22).fillCircle(c - 4, b - 29, 3)
    g.fillStyle(0xe8f4f6, 0.12).fillCircle(c + 5, b - 32, 2)
  })
  tex('arche', (w, b) => {
    ground(w, b, 0.85)
    // UNE PORTE DE PIERRE. Le sujet, c'est LE VIDE : on doit voir à travers, et
    // comprendre qu'on passe dessous vers l'autre versant. Donc l'ouverture est
    // haute, et le linteau MINCE — un linteau massif ferait une table.
    // (Phaser ne sait pas effacer : la voûte se construit par ses PLEINS.)
    g.fillStyle(STONE.dark).fillRect(2, b - 64, 11, 62) // pied ouest
    g.fillStyle(STONE.lit).fillRect(2, b - 64, 4, 62)
    g.fillStyle(STONE.dark).fillRect(w - 13, b - 64, 11, 62) // pied est
    g.fillStyle(STONE.deep).fillRect(w - 7, b - 64, 5, 62)
    g.fillStyle(STONE.mid).fillRect(0, b - 80, w, 17) // le linteau, mince
    g.fillStyle(STONE.lit).fillRect(0, b - 80, w - 10, 5) // sa crête
    g.fillStyle(STONE.deep).fillRect(0, b - 65, w, 2) // sa sous-face, à l'ombre
    // les écoinçons : ils arrondissent le haut du passage sans le boucher
    g.fillStyle(STONE.dark).fillTriangle(13, b - 63, 13, b - 48, 22, b - 63)
    g.fillStyle(STONE.dark).fillTriangle(w - 13, b - 63, w - 13, b - 48, w - 22, b - 63)
    g.fillStyle(STONE.deep).fillRect(13, b - 3, w - 26, 2) // le seuil, poli par les pas
  })
  tex('tarn', (w, b) => {
    const c = w / 2
    g.fillStyle(SHADOW, 0.16).fillEllipse(c, b - 4, w - 2, 8)
    g.fillStyle(STONE.dark).fillEllipse(c, b - 11, w - 2, 21) // la rive de pierre
    g.fillStyle(STONE.lit).fillEllipse(c - 15, b - 15, 18, 7)
    g.fillStyle(STONE.deep).fillEllipse(c + 16, b - 8, 16, 6)
    g.fillStyle(WATER.deep).fillEllipse(c, b - 11, w - 16, 14) // le lac d'altitude
    g.fillStyle(WATER.dark).fillEllipse(c, b - 12, w - 22, 11)
    g.fillStyle(WATER.mid).fillEllipse(c - 7, b - 13, 18, 6) // le ciel dedans
    g.fillStyle(WATER.lit, 0.85).fillEllipse(c - 11, b - 14, 9, 3)
  })
  tex('petroglyphes', (w, b) => {
    ground(w, b, 0.9)
    // LES GRAVURES sont le sujet. On doit reconnaître un GESTE — un bonhomme,
    // une bête, une flèche —, pas trois barres qui pourraient être n'importe quoi.
    g.fillStyle(STONE.dark).fillRect(0, b - 38, w, 37) // la dalle dressée
    g.fillStyle(STONE.mid).fillRect(0, b - 44, w - 8, 8)
    g.fillStyle(STONE.lit).fillRect(0, b - 48, w - 18, 6) // sa crête
    g.fillStyle(STONE.lit).fillRect(0, b - 38, 5, 37) // son arête NO
    g.fillStyle(STONE.deep).fillRect(w - 7, b - 38, 7, 37)
    const carve = 0x2a241d
    g.fillStyle(carve).fillCircle(11, b - 31, 2.2) // le bonhomme
    g.fillStyle(carve).fillRect(10, b - 29, 2, 8)
    g.fillStyle(carve).fillRect(6, b - 27, 10, 2)
    g.fillStyle(carve).fillRect(9, b - 21, 2, 6)
    g.fillStyle(carve).fillRect(12, b - 21, 2, 6)
    g.fillStyle(carve).fillRect(21, b - 30, 11, 3) // la bête, à quatre pattes
    g.fillStyle(carve).fillRect(21, b - 27, 2, 6)
    g.fillStyle(carve).fillRect(29, b - 27, 2, 6)
    g.fillStyle(carve).fillRect(31, b - 34, 2, 5) // ses cornes
    g.fillStyle(carve).fillRect(28, b - 34, 2, 5)
    g.fillStyle(carve).fillRect(7, b - 13, 22, 2) // et LA FLÈCHE : « c'est par là »
    g.fillStyle(carve).fillRect(24, b - 17, 3, 4)
    g.fillStyle(carve).fillRect(24, b - 10, 3, 4)
  })

  g.destroy()
}
