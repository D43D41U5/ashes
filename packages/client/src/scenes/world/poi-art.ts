/**
 * Les 26 LIEUX — placeholders dessinés par code (comme tout l'art du projet).
 *
 * TROIS RÈGLES, et elles ne sont pas décoratives :
 *
 * 1. L'ÉCHELLE fait autorité, et c'est l'ARBRE qui la porte. Une tuile = 16 px ;
 *    un avatar = 16 px ; un arbre de forêt = 44 px (tronc 22 + houppier). Un
 *    lieu qui ne DÉPASSE PAS la canopée n'est pas un repère : on ne le voit pas
 *    venir de loin, et la grappe qu'un Belvédère révèle ne promet rien qu'on
 *    puisse apercevoir. Les MONUMENTS montent donc au-dessus de 44 px ; le sol
 *    (bivouac, source, tarn) reste bas ; entre les deux, on module.
 *
 * 2. LA SILHOUETTE avant le détail. À 16 px la tuile, on lit une FORME, jamais
 *    une texture. Chaque lieu doit être reconnaissable en ombre chinoise.
 *
 * 3. LA LUMIÈRE VIENT DU NORD-OUEST, comme le hillshade du terrain (hillshade.ts).
 *    Chaque volume a sa face claire en haut-à-gauche et son ombre en bas-à-droite,
 *    plus une ombre portée au sol qui l'ancre. Sans ça, un sprite flotte.
 *
 * L'EMPREINTE (`footprint × 16`) est ce qu'on FOULE — c'est elle que `poisAt`
 * teste. Le SPRITE peut la déborder, exactement comme le houppier d'un arbre
 * ordinaire (2 tuiles) déborde son tronc (0,25 tuile) : ce qu'on voit n'est pas
 * ce qu'on touche, et c'est très bien ainsi. On ne ment que dans un sens.
 */
import type Phaser from 'phaser'

export const TILE = 16
/** La règle de tout : un arbre de forêt monte à 44 px. Un monument doit le dépasser. */
export const TREE_PX = 44

export interface PoiArt {
  slug: string
  /**
   * Largeur du SPRITE, en px. Par défaut l'empreinte réelle (`footprint × 16`),
   * mais un lieu peut DÉBORDER — comme un arbre ordinaire, dont le houppier
   * (2 tuiles) déborde largement son tronc (0,25 tuile). L'empreinte reste ce
   * qu'on FOULE ; le sprite est ce qu'on VOIT. Sans ce découplage, l'Arbre
   * remarquable (116 px de haut pour 32 de large) était un poteau.
   */
  w: number
  /** Hauteur totale du sprite, en px. */
  h: number
  /**
   * Hauteur de la COURONNE, en px : la part supérieure qui se dessine dans la
   * bande des houppiers, au-dessus des acteurs. Sans ça, un lieu très haut planté
   * en forêt se fait recouvrir par les houppiers voisins — l'Arbre remarquable
   * était littéralement invisible. Seuls les lieux qui percent la canopée en ont.
   */
  crown?: number
}

/**
 * fp = empreinte (tuiles, ce qu'on FOULE) · h = hauteur (px) · crown = part
 * dessinée au-dessus des acteurs · w = largeur du sprite SI elle déborde
 * l'empreinte (ce qu'on VOIT).
 */
const ART: Record<string, { fp: number; h: number; crown?: number; w?: number }> = {
  // ── ÉCONOMIE ──
  gisement: { fp: 4, h: 40 },
  carriere: { fp: 4, h: 54 },
  saline: { fp: 3, h: 16 },
  verger: { fp: 3, h: 52 },
  // ── ABRIS ──
  ruines: { fp: 4, h: 74, crown: 34 }, //  un pan de mur qui dépasse les arbres
  cabane: { fp: 2, h: 54, crown: 14 },
  abri: { fp: 2, h: 32 },
  mine: { fp: 3, h: 62, crown: 22 }, //    le chevalement se voit de loin
  oratoire: { fp: 2, h: 52, crown: 12 },
  bivouac: { fp: 2, h: 24 }, //            au sol : un foyer froid, pas un volume
  // ── DANGER ──
  taniere: { fp: 3, h: 28 },
  repaire: { fp: 3, h: 50, crown: 10 },
  epave: { fp: 2, h: 34 },
  fondriere: { fp: 3, h: 14 },
  crevasses: { fp: 4, h: 18 },
  // ── LES ONZE LIEUX CHARGÉS ──
  belvedere: { fp: 2, h: 76, crown: 36 }, //  IL fait grimper : il doit se voir du fond de la vallée
  grotte: { fp: 2, h: 50, crown: 10 },
  cascade: { fp: 2, h: 92, crown: 52 }, //    une chute d'eau se voit de très loin
  erratique: { fp: 2, h: 40 },
  // Il DÉBORDE : 2 tuiles d'empreinte (ce qu'on foule), 5 tuiles de houppier
  // (ce qu'on voit). Un arbre majestueux est LARGE — sans ça, c'était un poteau.
  arbre: { fp: 2, w: 80, h: 100, crown: 62 },
  cairn: { fp: 1, h: 28 }, //                 le plus petit, et le plus fréquent
  sanctuaire: { fp: 2, h: 72, crown: 32 },
  source_chaude: { fp: 2, h: 30 },
  arche: { fp: 2, h: 78, crown: 38 }, //      une porte de pierre : on passe dessous
  tarn: { fp: 3, h: 24 },
  petroglyphes: { fp: 2, h: 46, crown: 6 },
}

export const POI_ART: PoiArt[] = Object.entries(ART).map(([slug, a]) => ({
  slug,
  w: a.w ?? a.fp * TILE, // par défaut l'empreinte ; `w` la déborde quand le lieu l'exige
  h: a.h,
  ...(a.crown !== undefined ? { crown: a.crown } : {}),
}))

export const poiTextureKey = (slug: string): string => `poi-${slug}`
export const poiCrownKey = (slug: string): string => `poi-${slug}-crown`

// ── Palettes : la famille se lit à la couleur, la forme au contour ──
const STONE = { lit: 0xb4ada1, mid: 0x8d867b, dark: 0x605a51, deep: 0x3e3a34 }
const WOOD = { lit: 0x8a5c33, mid: 0x6b4525, dark: 0x4a2f18, deep: 0x2a1a0e }
const OCHRE = { lit: 0x9a8352, mid: 0x76633c, dark: 0x51452a, deep: 0x33291a }
const RUST = { lit: 0x6e5344, mid: 0x503c30, dark: 0x35271f, deep: 0x1d1512 }
const WATER = { lit: 0x7fc4dc, mid: 0x3d8fae, dark: 0x255c76, deep: 0x143848 }
const LEAF = { lit: 0x3f8a3a, mid: 0x2a6129, dark: 0x1a4019, deep: 0x0e2610 }
const VOID = 0x0a0908
const SHADOW = 0x000000

export function makePoiTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()

  /** L'ombre portée : ce qui ancre un sprite au sol. Sans elle, tout flotte. */
  const ground = (w: number, h: number, spread = 0.9): void => {
    g.fillStyle(SHADOW, 0.28).fillEllipse(w / 2 + 1, h - 2, w * spread, 7)
  }

  /**
   * Dessine un lieu, et le découpe éventuellement en DEUX textures : le corps
   * (trié avec les acteurs) et la couronne (au-dessus, avec les houppiers).
   * Le découpage se fait en dessinant deux fois, décalé — `generateTexture` ne
   * sait pas recadrer.
   */
  const tex = (slug: string, draw: (w: number, h: number, dy: number) => void): void => {
    const a = POI_ART.find((p) => p.slug === slug)!
    g.clear()
    draw(a.w, a.h, 0)
    g.generateTexture(poiTextureKey(slug), a.w, a.h)
    // La COURONNE : le MÊME dessin, capturé sur une hauteur plus courte —
    // `generateTexture` cadre depuis l'origine, donc demander `crown` px ne
    // garde que le haut du sprite. Il se redessine par-dessus le corps, dans la
    // bande des houppiers : identique au pixel près là où ils se recouvrent, et
    // enfin VISIBLE au-dessus des arbres voisins.
    if (a.crown !== undefined) g.generateTexture(poiCrownKey(slug), a.w, a.crown)
  }

  // ══════════ ÉCONOMIE — ocre, minéral, ouvert ══════════
  tex('gisement', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    g.fillStyle(OCHRE.dark).fillRect(0, b - 22, w, 20) // le tas
    g.fillStyle(OCHRE.mid).fillRect(0, b - 26, w - 16, 8)
    g.fillStyle(OCHRE.lit).fillRect(2, b - 30, w - 30, 6) // crête éclairée au NO
    g.fillStyle(0xd9b23a).fillRect(12, b - 24, 7, 5) // la veine qui affleure
    g.fillStyle(0xd9b23a).fillRect(38, b - 17, 5, 4)
    g.fillStyle(OCHRE.deep).fillRect(w - 18, b - 14, 16, 12) // ombre SE
  })
  tex('carriere', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    g.fillStyle(STONE.dark).fillRect(0, b - 34, w, 32) // le front de taille
    g.fillStyle(STONE.mid).fillRect(0, b - 44, w - 12, 12)
    g.fillStyle(STONE.lit).fillRect(0, b - 50, w - 26, 8) // la lèvre éclairée
    g.fillStyle(STONE.deep).fillRect(6, b - 30, w - 10, 5) // les gradins, en creux
    g.fillStyle(STONE.deep).fillRect(14, b - 18, w - 18, 5)
    g.fillStyle(STONE.mid).fillRect(4, b - 10, 13, 8) // blocs débités au pied
    g.fillStyle(STONE.mid).fillRect(42, b - 8, 10, 6)
  })
  tex('saline', (w, h, d) => {
    const b = h + d
    g.fillStyle(OCHRE.deep, 0.35).fillEllipse(w / 2, b - 4, w - 2, 9)
    g.fillStyle(0xcfc9b4).fillEllipse(w / 2, b - 6, w - 6, 10) // la croûte
    g.fillStyle(0xeee9d8).fillEllipse(w / 2 - 6, b - 8, 18, 6) // le sel, éclatant au NO
    g.fillStyle(0xffffff).fillEllipse(w / 2 - 9, b - 9, 7, 3)
  })
  tex('verger', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    // trois arbres fruitiers — BAS et ronds, l'inverse d'un conifère de forêt
    for (const [ox, s] of [[7, 0], [25, 3], [39, 1]] as const) {
      g.fillStyle(WOOD.dark).fillRect(ox + 3, b - 16 - s, 4, 16)
      g.fillStyle(LEAF.mid).fillCircle(ox + 5, b - 26 - s, 11)
      g.fillStyle(LEAF.lit).fillCircle(ox + 1, b - 30 - s, 6) // lumière NO
      g.fillStyle(LEAF.dark).fillCircle(ox + 9, b - 21 - s, 5) // ombre SE
      g.fillStyle(0xc0392b).fillCircle(ox - 1, b - 28 - s, 2) // un fruit
      g.fillStyle(0xc0392b).fillCircle(ox + 9, b - 30 - s, 2)
    }
  })

  // ══════════ ABRIS — bois et pierre chaude ══════════
  tex('ruines', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    // UN PAN DE MUR DEBOUT, haut de 72 px : il dépasse les arbres. C'est ce qui
    // fait qu'on voit les Ruines de loin — et qu'on a envie d'aller voir.
    g.fillStyle(STONE.mid).fillRect(2, b - 72, 18, 72)
    g.fillStyle(STONE.lit).fillRect(2, b - 72, 6, 72) // arête NO éclairée
    g.fillStyle(STONE.deep).fillRect(16, b - 72, 4, 72) // arête SE dans l'ombre
    g.fillStyle(VOID).fillRect(7, b - 56, 7, 12) // une fenêtre béante
    g.fillStyle(STONE.dark).fillRect(2, b - 74, 18, 4) // le sommet ébréché
    // un second pan, cassé à mi-hauteur
    g.fillStyle(STONE.mid).fillRect(30, b - 40, 15, 40)
    g.fillStyle(STONE.lit).fillRect(30, b - 40, 5, 40)
    g.fillStyle(STONE.deep).fillRect(42, b - 40, 3, 40)
    g.fillStyle(STONE.dark).fillRect(48, b - 22, 12, 22) // un moignon
    g.fillStyle(STONE.deep).fillRect(20, b - 7, 30, 7) // les gravats entre les deux
    g.fillStyle(STONE.dark).fillRect(24, b - 11, 9, 5)
  })
  tex('cabane', (w, h, d) => {
    ground(w, h + d, 0.8)
    const b = h + d
    g.fillStyle(WOOD.mid).fillRect(3, b - 24, w - 6, 24) // le corps
    g.fillStyle(WOOD.lit).fillRect(3, b - 24, 5, 24) // planche éclairée
    g.fillStyle(WOOD.deep).fillRect(w - 7, b - 24, 4, 24)
    g.fillStyle(WOOD.dark).fillTriangle(-1, b - 22, w / 2, b - 50, w + 1, b - 22) // le toit, pentu
    g.fillStyle(WOOD.lit).fillTriangle(-1, b - 22, w / 2, b - 50, w / 2 - 2, b - 22) // versant NO
    g.fillStyle(VOID).fillRect(w / 2 - 4, b - 16, 8, 16) // la porte
    g.fillStyle(WOOD.lit).fillRect(w / 2 - 1, b - 46, 3, 8) // le faîtage
  })
  tex('abri', (w, h, d) => {
    ground(w, h + d, 0.85)
    const b = h + d
    g.fillStyle(STONE.mid).fillRect(0, b - 30, w, 16) // la dalle qui surplombe
    g.fillStyle(STONE.lit).fillRect(0, b - 32, w - 6, 6)
    g.fillStyle(STONE.deep).fillRect(0, b - 16, w, 4) // sa sous-face, sombre
    g.fillStyle(VOID).fillRect(4, b - 14, w - 8, 14) // l'ombre où l'on se met
    g.fillStyle(STONE.dark).fillRect(0, b - 14, 4, 14) // les jambages
    g.fillStyle(STONE.dark).fillRect(w - 4, b - 14, 4, 14)
  })
  tex('mine', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    g.fillStyle(STONE.dark).fillRect(0, b - 34, w, 34) // le flanc entaillé
    g.fillStyle(STONE.mid).fillRect(0, b - 40, w - 10, 8)
    g.fillStyle(VOID).fillRect(14, b - 26, 20, 26) // la gueule noire
    // LE CHEVALEMENT : c'est lui qui dépasse les arbres et signale la mine.
    g.fillStyle(WOOD.dark).fillRect(13, b - 60, 4, 34)
    g.fillStyle(WOOD.dark).fillRect(31, b - 60, 4, 34)
    g.fillStyle(WOOD.lit).fillRect(13, b - 60, 2, 34)
    g.fillStyle(WOOD.mid).fillRect(11, b - 62, 26, 4) // la traverse
    g.fillStyle(WOOD.dark).fillRect(22, b - 58, 4, 10) // l'étai central
    g.fillStyle(WOOD.mid).fillRect(11, b - 30, 26, 4) // le linteau de la gueule
  })
  tex('oratoire', (w, h, d) => {
    ground(w, h + d, 0.7)
    const b = h + d
    g.fillStyle(STONE.dark).fillRect(6, b - 14, 20, 14) // le socle
    g.fillStyle(STONE.mid).fillRect(6, b - 16, 20, 4)
    g.fillStyle(STONE.mid).fillRect(13, b - 44, 6, 30) // la stèle
    g.fillStyle(STONE.lit).fillRect(13, b - 44, 2, 30)
    g.fillStyle(STONE.mid).fillRect(8, b - 40, 16, 5) // les bras de la croix
    g.fillStyle(STONE.lit).fillRect(8, b - 40, 16, 2)
    g.fillStyle(STONE.deep).fillRect(19, b - 40, 5, 5)
  })
  tex('bivouac', (w, h, d) => {
    // AU SOL : un foyer FROID. Pas un volume — une trace. On doit lire un
    // cercle de pierres vu de dessus, pas une tache sombre.
    const b = h + d
    g.fillStyle(SHADOW, 0.2).fillEllipse(w / 2, b - 4, w - 4, 9)
    g.fillStyle(0x2a2622).fillEllipse(w / 2, b - 6, w - 12, 8) // les cendres, au centre
    // le cercle de pierres, une par une (c'est ça qui le rend lisible)
    for (const [px, py, r] of [
      [4, 8, 3], [11, 5, 3], [20, 5, 3], [27, 8, 3],
      [28, 12, 3], [21, 15, 3], [11, 15, 3], [4, 12, 3],
    ] as const) {
      g.fillStyle(STONE.mid).fillCircle(px, b - 16 + py, r)
      g.fillStyle(STONE.lit).fillCircle(px - 1, b - 17 + py, 1.5) // chaque pierre a sa lumière NO
    }
    g.fillStyle(WOOD.dark).fillRect(w / 2 - 7, b - 10, 13, 2) // deux bûches en croix
    g.fillStyle(WOOD.dark).fillRect(w / 2 - 1, b - 13, 2, 8)
  })

  // ══════════ DANGER — rouille sombre, formes basses et hostiles ══════════
  tex('taniere', (w, h, d) => {
    const b = h + d
    g.fillStyle(SHADOW, 0.22).fillEllipse(w / 2, b - 3, w - 2, 8)
    g.fillStyle(RUST.mid).fillEllipse(w / 2, b - 10, w - 6, 20) // le tertre de terre remuée
    g.fillStyle(RUST.lit).fillEllipse(w / 2 - 8, b - 14, 16, 8) // lumière NO
    g.fillStyle(VOID).fillEllipse(w / 2 + 2, b - 7, 16, 11) // LE TROU — la seule chose qui compte
    g.fillStyle(RUST.deep).fillEllipse(w / 2 + 2, b - 10, 17, 5) // sa lèvre supérieure
  })
  tex('repaire', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    g.fillStyle(0x2e2a26).fillEllipse(w / 2, b - 5, w - 2, 11) // le sol brûlé
    g.fillStyle(RUST.dark).fillTriangle(4, b - 8, 16, b - 40, 28, b - 8) // un abri de peaux
    g.fillStyle(RUST.mid).fillTriangle(4, b - 8, 16, b - 40, 16, b - 8) // versant NO
    g.fillStyle(VOID).fillTriangle(12, b - 8, 16, b - 22, 20, b - 8) // son ouverture
    g.fillStyle(WOOD.dark).fillRect(34, b - 42, 3, 34) // un pieu planté
    g.fillStyle(0xcfc9b4).fillCircle(35, b - 44, 3) // ce qu'il y a dessus — un crâne
    g.fillStyle(0x8a2a1a).fillCircle(w - 8, b - 7, 4) // une braise qui couve
    g.fillStyle(0xe07a2a).fillCircle(w - 9, b - 8, 2)
  })
  tex('epave', (w, h, d) => {
    const b = h + d
    g.fillStyle(SHADOW, 0.2).fillEllipse(w / 2, b - 3, w - 2, 7)
    g.fillStyle(0xd6dae0).fillEllipse(w / 2, b - 6, w, 12) // le névé qui l'a recrachée
    g.fillStyle(RUST.dark).fillRect(3, b - 24, 20, 16) // la carcasse tordue
    g.fillStyle(RUST.lit).fillRect(3, b - 24, 5, 16)
    g.fillStyle(RUST.deep).fillRect(18, b - 20, 12, 10)
    g.fillStyle(0x7a3a2a).fillRect(7, b - 32, 3, 9) // de la ferraille qui dépasse
    g.fillStyle(0x7a3a2a).fillRect(24, b - 28, 2, 8)
    g.fillStyle(VOID).fillRect(9, b - 19, 6, 5) // un hublot crevé
  })
  tex('fondriere', (w, h, d) => {
    const b = h + d
    g.fillStyle(0x232a1c).fillEllipse(w / 2, b - 6, w - 2, 12) // la fange
    g.fillStyle(0x36402c).fillEllipse(w / 2 - 8, b - 7, 16, 6)
    g.fillStyle(0x4e5a3c).fillEllipse(w / 2 + 9, b - 5, 9, 4) // un remous
    g.fillStyle(0x6a7852).fillEllipse(w / 2 - 3, b - 8, 5, 2) // une bulle
  })
  tex('crevasses', (w, h, d) => {
    const b = h + d
    g.fillStyle(0xe4eef4).fillRect(0, b - 14, w, 14) // la glace
    g.fillStyle(0xc4d6e2).fillRect(0, b - 16, w - 8, 4)
    // LES FENTES : irrégulières, c'est ce qui les rend menaçantes
    g.fillStyle(0x1a3048).fillTriangle(5, b - 14, 9, b - 14, 7, b)
    g.fillStyle(0x1a3048).fillTriangle(21, b - 14, 28, b - 14, 24, b)
    g.fillStyle(0x1a3048).fillTriangle(41, b - 14, 46, b - 14, 44, b)
    g.fillStyle(0x1a3048).fillTriangle(55, b - 14, 59, b - 14, 57, b)
    g.fillStyle(0x2e5878).fillRect(22, b - 13, 2, 6) // un peu de bleu au fond
  })

  // ══════════ LES ONZE LIEUX CHARGÉS — pierre claire, monumentale ══════════
  tex('belvedere', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    // UN PROMONTOIRE : une pile de dalles en gradins, avec une VIRE PLATE au
    // sommet — la marche où l'on se tient pour regarder la vallée (celle que le
    // générateur creuse dans la roche). Ce qui doit se lire, c'est qu'on peut
    // MONTER dessus, et qu'une fois là-haut on domine.
    g.fillStyle(STONE.dark).fillRect(0, b - 26, w, 26) // le socle
    g.fillStyle(STONE.deep).fillRect(w - 9, b - 26, 9, 26) // son flanc SE
    g.fillStyle(STONE.mid).fillRect(1, b - 44, w - 6, 20) // la dalle du milieu, en retrait
    g.fillStyle(STONE.lit).fillRect(1, b - 44, 5, 20) // arête NO éclairée
    g.fillStyle(STONE.deep).fillRect(w - 11, b - 44, 6, 20)
    g.fillStyle(STONE.dark).fillRect(3, b - 58, w - 12, 16) // la dalle du haut
    g.fillStyle(STONE.mid).fillRect(3, b - 58, 4, 16)
    // LA VIRE : plate, claire, largement débordante — on voit qu'on peut s'y tenir
    g.fillStyle(STONE.lit).fillRect(0, b - 63, w - 4, 6)
    g.fillStyle(STONE.deep).fillRect(0, b - 57, w - 4, 2) // l'ombre sous la vire
    // le cairn du sommet : quelqu'un est monté avant toi
    g.fillStyle(STONE.mid).fillEllipse(11, b - 67, 9, 6)
    g.fillStyle(STONE.dark).fillEllipse(11, b - 72, 7, 5)
    g.fillStyle(STONE.lit).fillEllipse(11, b - 76, 5, 4)
  })
  tex('grotte', (w, h, d) => {
    ground(w, h + d, 0.95)
    const b = h + d
    g.fillStyle(STONE.dark).fillRect(0, b - 40, w, 40) // le rocher
    g.fillStyle(STONE.mid).fillRect(0, b - 46, w - 8, 8)
    g.fillStyle(STONE.lit).fillRect(0, b - 50, w - 18, 6) // la crête éclairée
    g.fillStyle(STONE.deep).fillRect(w - 8, b - 40, 8, 40) // le flanc SE
    // LA GUEULE : une arche, pas une ellipse — on doit lire une ENTRÉE
    g.fillStyle(VOID).fillRect(8, b - 20, 16, 20)
    g.fillStyle(VOID).fillEllipse(16, b - 20, 16, 14)
    g.fillStyle(STONE.deep).fillEllipse(16, b - 26, 20, 8) // le linteau, en surplomb
  })
  tex('cascade', (w, h, d) => {
    const b = h + d
    // 92 px : une chute d'eau se voit de TRÈS loin. C'est le lieu le plus haut
    // après l'Arbre remarquable, et c'est normal.
    g.fillStyle(STONE.dark).fillRect(0, b - 88, w, 80) // la paroi
    g.fillStyle(STONE.mid).fillRect(0, b - 88, 8, 80) // arête NO
    g.fillStyle(STONE.deep).fillRect(w - 7, b - 88, 7, 80)
    g.fillStyle(STONE.lit).fillRect(0, b - 92, w - 10, 5) // la lèvre d'où l'eau bascule
    g.fillStyle(WATER.mid).fillRect(11, b - 88, 11, 80) // LE JET
    g.fillStyle(0xffffff).fillRect(13, b - 88, 5, 78)
    g.fillStyle(WATER.lit).fillRect(12, b - 88, 2, 74)
    g.fillStyle(WATER.dark, 0.5).fillEllipse(w / 2, b - 8, w - 4, 12) // la vasque
    g.fillStyle(WATER.mid).fillEllipse(w / 2, b - 8, w - 12, 8)
    g.fillStyle(0xffffff, 0.7).fillEllipse(16, b - 10, 12, 5) // l'écume au pied
  })
  tex('erratique', (w, h, d) => {
    ground(w, h + d, 0.95)
    const b = h + d
    // UN BLOC : une masse arrondie, lourde, posée là par un glacier disparu et
    // qui n'a rien à faire là. Sa MASSE est le sujet — pas une arête, un poids.
    g.fillStyle(STONE.dark).fillEllipse(w / 2, b - 16, w - 3, 30) // le corps
    g.fillStyle(STONE.dark).fillRect(2, b - 16, w - 4, 13) // il porte à plat sur le sol
    g.fillStyle(STONE.mid).fillEllipse(w / 2 - 4, b - 21, 20, 20) // la facette NO
    g.fillStyle(STONE.lit).fillEllipse(w / 2 - 7, b - 25, 11, 9) // la lumière y prend
    g.fillStyle(STONE.deep).fillEllipse(w / 2 + 8, b - 10, 14, 12) // l'ombre SE
    g.fillStyle(STONE.deep).fillRect(3, b - 5, w - 6, 4) // le pied, écrasé
    g.fillStyle(STONE.mid).fillRect(9, b - 24, 8, 2) // une veine de quartz
  })
  tex('arbre', (w, h, d) => {
    ground(w, h + d, 0.55)
    const b = h + d
    const cx = w / 2
    // 100 px de haut, 80 de large, contre 44×32 pour un arbre de forêt. Ce qui
    // le rend REMARQUABLE, ce n'est pas la hauteur seule — c'est l'ENVERGURE :
    // un vieil arbre s'étale, ses branches basses pendent, ses racines affleurent.
    // Un tronc fin sous une boule haute, c'est une sucette. Il fallait l'étaler.

    // les contreforts des racines, qui débordent au sol
    g.fillStyle(WOOD.deep).fillEllipse(cx, b - 4, 34, 10)
    g.fillStyle(WOOD.dark).fillEllipse(cx - 9, b - 6, 12, 6)
    g.fillStyle(WOOD.dark).fillEllipse(cx + 10, b - 5, 11, 5)

    // le tronc : massif, et qui s'évase vers le bas
    g.fillStyle(WOOD.dark).fillTriangle(cx - 13, b - 4, cx - 6, b - 44, cx + 6, b - 44)
    g.fillStyle(WOOD.dark).fillTriangle(cx + 13, b - 4, cx + 6, b - 44, cx - 6, b - 44)
    g.fillStyle(WOOD.dark).fillRect(cx - 7, b - 46, 14, 44)
    g.fillStyle(WOOD.mid).fillRect(cx - 7, b - 46, 5, 44) // arête NO éclairée
    g.fillStyle(WOOD.deep).fillRect(cx + 3, b - 46, 4, 44) // ombre SE

    // deux branches maîtresses qui s'écartent — c'est elles qui donnent l'envergure
    g.fillStyle(WOOD.dark).fillTriangle(cx - 5, b - 40, cx - 26, b - 56, cx - 5, b - 50)
    g.fillStyle(WOOD.dark).fillTriangle(cx + 5, b - 42, cx + 27, b - 54, cx + 5, b - 52)

    // LA COURONNE : large, basse, en plusieurs masses — un dôme, pas une boule.
    g.fillStyle(LEAF.dark).fillEllipse(cx, b - 66, 76, 46) // la masse d'ensemble
    g.fillStyle(LEAF.dark).fillEllipse(cx - 28, b - 56, 26, 22) // les branches basses, qui pendent
    g.fillStyle(LEAF.dark).fillEllipse(cx + 29, b - 54, 24, 20)
    g.fillStyle(LEAF.mid).fillEllipse(cx - 8, b - 74, 50, 34) // le volume éclairé
    g.fillStyle(LEAF.mid).fillEllipse(cx - 26, b - 62, 22, 18)
    g.fillStyle(LEAF.lit).fillEllipse(cx - 16, b - 82, 28, 18) // la lumière prend au NO
    g.fillStyle(LEAF.lit).fillEllipse(cx - 4, b - 88, 16, 10)
    g.fillStyle(LEAF.deep).fillEllipse(cx + 22, b - 62, 26, 20) // l'ombre au SE
    g.fillStyle(LEAF.deep).fillEllipse(cx + 10, b - 50, 22, 12) // et sous le feuillage
  })
  tex('cairn', (w, h, d) => {
    const b = h + d
    g.fillStyle(SHADOW, 0.25).fillEllipse(w / 2, b - 2, w - 2, 5)
    // Une tuile de large. Ce qui le rend lisible, c'est l'EMPILEMENT : des
    // pierres distinctes, de plus en plus petites. Pas un cône.
    g.fillStyle(STONE.mid).fillEllipse(8, b - 4, 13, 7)
    g.fillStyle(STONE.lit).fillEllipse(6, b - 5, 6, 3)
    g.fillStyle(STONE.mid).fillEllipse(8, b - 10, 11, 6)
    g.fillStyle(STONE.lit).fillEllipse(6, b - 11, 5, 3)
    g.fillStyle(STONE.dark).fillEllipse(8, b - 15, 8, 5)
    g.fillStyle(STONE.lit).fillEllipse(7, b - 16, 4, 2)
    g.fillStyle(STONE.mid).fillEllipse(8, b - 20, 6, 4)
    g.fillStyle(STONE.lit).fillEllipse(8, b - 24, 4, 3) // la dernière, posée en équilibre
  })
  tex('sanctuaire', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    // UN TRILITHE de 72 px : deux montants et un linteau. La forme la plus
    // ancienne qu'on connaisse — on sait, en la voyant, que des mains l'ont posée.
    g.fillStyle(0x4a463f, 0.5).fillEllipse(w / 2, b - 4, w - 2, 9) // le sol foulé
    g.fillStyle(STONE.mid).fillRect(2, b - 60, 9, 58) // montant ouest
    g.fillStyle(STONE.lit).fillRect(2, b - 60, 3, 58)
    g.fillStyle(STONE.mid).fillRect(21, b - 60, 9, 58) // montant est
    g.fillStyle(STONE.deep).fillRect(27, b - 60, 3, 58)
    g.fillStyle(STONE.dark).fillRect(0, b - 72, w, 13) // LE LINTEAU
    g.fillStyle(STONE.lit).fillRect(0, b - 72, w - 6, 5)
    g.fillStyle(STONE.deep).fillRect(0, b - 61, w, 3) // sa sous-face
    g.fillStyle(STONE.dark).fillRect(14, b - 30, 4, 28) // une troisième pierre, au centre
    g.fillStyle(STONE.mid).fillRect(14, b - 30, 2, 28)
  })
  tex('source_chaude', (w, h, d) => {
    const b = h + d
    g.fillStyle(SHADOW, 0.2).fillEllipse(w / 2, b - 3, w - 2, 7)
    g.fillStyle(STONE.dark).fillEllipse(w / 2, b - 8, w - 2, 15) // la margelle (celle qu'on creuse)
    g.fillStyle(STONE.lit).fillEllipse(w / 2 - 8, b - 11, 12, 5)
    g.fillStyle(WATER.dark).fillEllipse(w / 2, b - 8, w - 12, 10) // l'eau, sombre et profonde
    g.fillStyle(0x4aa8a0).fillEllipse(w / 2, b - 9, w - 18, 6) // sa couleur minérale
    g.fillStyle(0xa8dce0, 0.9).fillEllipse(w / 2 - 4, b - 10, 7, 3)
    // LA VAPEUR : c'est elle qu'on voit de loin, et qui dit « il fait chaud ici »
    g.fillStyle(0xe8f4f6, 0.55).fillCircle(w / 2 - 5, b - 18, 4)
    g.fillStyle(0xe8f4f6, 0.4).fillCircle(w / 2 + 2, b - 23, 3)
    g.fillStyle(0xe8f4f6, 0.25).fillCircle(w / 2 - 2, b - 28, 2)
  })
  tex('arche', (w, h, d) => {
    ground(w, h + d)
    const b = h + d
    // UNE PORTE DE PIERRE. Le sujet, c'est LE VIDE : on doit voir à travers, et
    // comprendre qu'on passe dessous vers l'autre versant. Donc l'ouverture est
    // haute et large, et le linteau MINCE — un linteau massif ferait une table.
    g.fillStyle(STONE.dark).fillRect(0, b - 62, 8, 62) // pied ouest
    g.fillStyle(STONE.lit).fillRect(0, b - 62, 3, 62) // son arête éclairée
    g.fillStyle(STONE.dark).fillRect(w - 8, b - 62, 8, 62) // pied est
    g.fillStyle(STONE.deep).fillRect(w - 4, b - 62, 4, 62)
    // La voûte se construit par ses PLEINS — on ne perce pas un trou, on laisse
    // le vide vide (Phaser ne sait pas effacer dans un Graphics).
    g.fillStyle(STONE.mid).fillRect(0, b - 78, w, 16) // le linteau, mince
    g.fillStyle(STONE.lit).fillRect(0, b - 78, w - 8, 5) // sa crête, éclairée
    g.fillStyle(STONE.deep).fillRect(0, b - 64, w, 2) // sa sous-face, à l'ombre
    // les écoinçons : ils arrondissent le haut de l'ouverture sans la boucher
    g.fillStyle(STONE.dark).fillTriangle(8, b - 62, 8, b - 50, 15, b - 62)
    g.fillStyle(STONE.dark).fillTriangle(w - 8, b - 62, w - 8, b - 50, w - 15, b - 62)
  })
  tex('tarn', (w, h, d) => {
    const b = h + d
    g.fillStyle(SHADOW, 0.18).fillEllipse(w / 2, b - 4, w - 2, 8)
    g.fillStyle(STONE.dark).fillEllipse(w / 2, b - 10, w - 2, 19) // la rive de pierre
    g.fillStyle(STONE.lit).fillEllipse(w / 2 - 12, b - 13, 16, 6)
    g.fillStyle(WATER.deep).fillEllipse(w / 2, b - 10, w - 14, 13) // le lac d'altitude
    g.fillStyle(WATER.dark).fillEllipse(w / 2, b - 11, w - 18, 10)
    g.fillStyle(WATER.mid).fillEllipse(w / 2 - 6, b - 12, 16, 5) // le ciel dedans
    g.fillStyle(WATER.lit, 0.8).fillEllipse(w / 2 - 9, b - 13, 8, 2)
  })
  tex('petroglyphes', (w, h, d) => {
    ground(w, h + d, 0.9)
    const b = h + d
    g.fillStyle(STONE.dark).fillRect(0, b - 36, w, 36) // la dalle dressée
    g.fillStyle(STONE.mid).fillRect(0, b - 40, w - 6, 8)
    g.fillStyle(STONE.lit).fillRect(0, b - 44, w - 14, 6) // sa crête
    g.fillStyle(STONE.deep).fillRect(w - 6, b - 36, 6, 36)
    // LES GRAVURES : des figures, pas des barres. On doit reconnaître un GESTE.
    const carve = 0x2e2820
    g.fillStyle(carve).fillCircle(9, b - 28, 2) // un bonhomme
    g.fillStyle(carve).fillRect(8, b - 26, 2, 7)
    g.fillStyle(carve).fillRect(5, b - 24, 8, 2)
    g.fillStyle(carve).fillRect(7, b - 19, 2, 5)
    g.fillStyle(carve).fillRect(10, b - 19, 2, 5)
    g.fillStyle(carve).fillRect(17, b - 27, 9, 2) // une bête à quatre pattes
    g.fillStyle(carve).fillRect(17, b - 25, 2, 5)
    g.fillStyle(carve).fillRect(24, b - 25, 2, 5)
    g.fillStyle(carve).fillRect(25, b - 30, 2, 4) // ses cornes
    g.fillStyle(carve).fillRect(5, b - 12, 20, 2) // et une flèche, qui montre la direction
    g.fillStyle(carve).fillRect(21, b - 15, 2, 3)
    g.fillStyle(carve).fillRect(21, b - 9, 2, 3)
  })

  g.destroy()
}
