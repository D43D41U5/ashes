/**
 * PLACEHOLDERS des 26 POI — dessinés par code, comme tout l'art du projet pour
 * l'instant (BootScene). Le but n'est pas la beauté : c'est de pouvoir JUGER LES
 * TAILLES en jeu, contre l'échelle qui fait autorité — l'arbre.
 *
 * L'ÉCHELLE, la seule chose qui compte ici :
 *   - une tuile = 16 px (`TILE_PX`) ;
 *   - un arbre = tronc 16×22 + houppier 32×32 → il monte à ~44 px, soit ~2,7 tuiles ;
 *   - un avatar = 16×16, une tuile.
 * Chaque POI est donc large de `footprint × 16` px (son empreinte RÉELLE, celle
 * que `poisAt` teste) et haut de ce que le lieu est — un Cairn est bas, un
 * Sanctuaire se dresse, l'Arbre remarquable domine la forêt.
 *
 * Les couleurs codent la FAMILLE, pour qu'on lise la carte d'un coup d'œil :
 *   eco = ocre · shelter = bois/pierre chaude · danger = rouille sombre · reward = pierre claire
 */
import type Phaser from 'phaser'

export const TILE = 16

/** Un POI dessiné : sa clé de texture, sa taille en px, et son ancre (les pieds). */
export interface PoiArt {
  slug: string
  w: number
  h: number
}

/** Largeur = empreinte réelle. Hauteur = ce que le lieu EST. */
const ART: Record<string, { fp: number; h: number }> = {
  // ── Économie (ocre) ──
  gisement: { fp: 4, h: 30 },
  carriere: { fp: 4, h: 34 },
  saline: { fp: 3, h: 14 },
  verger: { fp: 3, h: 46 },
  // ── Abris (bois, pierre chaude) ──
  ruines: { fp: 4, h: 46 },
  cabane: { fp: 2, h: 34 },
  abri: { fp: 2, h: 26 },
  mine: { fp: 3, h: 38 },
  oratoire: { fp: 2, h: 34 },
  bivouac: { fp: 2, h: 18 },
  // ── Danger (rouille sombre) ──
  taniere: { fp: 3, h: 24 },
  repaire: { fp: 3, h: 34 },
  epave: { fp: 2, h: 26 },
  fondriere: { fp: 3, h: 12 },
  crevasses: { fp: 4, h: 16 },
  // ── Récompense (pierre claire) — les onze lieux chargés ──
  belvedere: { fp: 2, h: 40 },
  grotte: { fp: 2, h: 34 },
  cascade: { fp: 2, h: 46 },
  erratique: { fp: 2, h: 30 },
  arbre: { fp: 2, h: 72 }, // l'Arbre remarquable DOMINE la forêt (un arbre normal : ~44 px)
  cairn: { fp: 1, h: 20 },
  sanctuaire: { fp: 2, h: 42 },
  source_chaude: { fp: 2, h: 20 },
  arche: { fp: 2, h: 44 },
  tarn: { fp: 3, h: 20 },
  petroglyphes: { fp: 2, h: 30 },
}

export const POI_ART: PoiArt[] = Object.entries(ART).map(([slug, a]) => ({
  slug,
  w: a.fp * TILE,
  h: a.h,
}))

export const poiTextureKey = (slug: string): string => `poi-${slug}`

/**
 * Dessine les 26 placeholders dans le gestionnaire de textures de la scène.
 * Appelé une fois, au boot.
 */
export function makePoiTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()

  const tex = (slug: string, draw: (w: number, h: number) => void): void => {
    const a = POI_ART.find((p) => p.slug === slug)!
    g.clear()
    draw(a.w, a.h)
    g.generateTexture(poiTextureKey(slug), a.w, a.h)
  }

  // ─────────── Économie : ocre, minéral ───────────
  tex('gisement', (w, h) => {
    g.fillStyle(0x6b5a3e).fillRect(0, h - 18, w, 18) // le tas
    g.fillStyle(0x8a7450).fillRect(4, h - 26, w - 20, 12)
    g.fillStyle(0xc9a227).fillRect(10, h - 22, 6, 5) // la veine qui affleure
    g.fillStyle(0xc9a227).fillRect(34, h - 15, 5, 4)
  })
  tex('carriere', (w, h) => {
    g.fillStyle(0x7a7670).fillRect(0, h - 22, w, 22) // le front de taille
    g.fillStyle(0x9a968e).fillRect(0, h - 30, w - 14, 10)
    g.fillStyle(0x5c5852).fillRect(6, h - 12, 12, 8) // blocs débités
    g.fillStyle(0x5c5852).fillRect(40, h - 10, 10, 6)
  })
  tex('saline', (w, h) => {
    g.fillStyle(0xd8d4c4).fillEllipse(w / 2, h - 5, w - 4, 10) // croûte blanche
    g.fillStyle(0xf0ece0).fillEllipse(w / 2 - 6, h - 6, 14, 5)
  })
  tex('verger', (w, h) => {
    // trois arbres fruitiers, plus BAS qu'un arbre de forêt (44 px) : ~30 px
    for (const [ox, oy] of [[8, 0], [24, 4], [38, 1]] as const) {
      g.fillStyle(0x4a3620).fillRect(ox + 3, h - 14 - oy, 3, 14)
      g.fillStyle(0x3f7a34).fillCircle(ox + 4, h - 20 - oy, 9)
      g.fillStyle(0xc0392b).fillCircle(ox + 1, h - 22 - oy, 2) // un fruit
    }
  })

  // ─────────── Abris : bois, pierre chaude ───────────
  tex('ruines', (w, h) => {
    g.fillStyle(0x8a8278).fillRect(2, h - 30, 14, 30) // pan de mur debout
    g.fillStyle(0x6e675e).fillRect(2, h - 30, 14, 4)
    g.fillStyle(0x8a8278).fillRect(24, h - 18, 12, 18) // pan écroulé
    g.fillStyle(0x8a8278).fillRect(46, h - 24, 10, 24)
    g.fillStyle(0x5c5852).fillRect(18, h - 6, 30, 6) // gravats
  })
  tex('cabane', (w, h) => {
    g.fillStyle(0x7a4a2a).fillRect(4, h - 16, w - 8, 16) // corps
    g.fillStyle(0x5a3a22).fillTriangle(1, h - 16, w / 2, h - 30, w - 1, h - 16) // toit
    g.fillStyle(0x2a1e12).fillRect(w / 2 - 3, h - 12, 6, 12) // porte
  })
  tex('abri', (w, h) => {
    g.fillStyle(0x7a7670).fillRect(0, h - 20, w, 12) // la dalle qui surplombe
    g.fillStyle(0x2a2622).fillRect(6, h - 10, w - 12, 10) // l'ombre en dessous
    g.fillStyle(0x9a968e).fillRect(0, h - 22, w, 4)
  })
  tex('mine', (w, h) => {
    g.fillStyle(0x6e675e).fillRect(0, h - 26, w, 26) // le flanc
    g.fillStyle(0x14100c).fillRect(14, h - 20, 20, 20) // la gueule noire
    g.fillStyle(0x7a4a2a).fillRect(12, h - 22, 4, 22) // étais
    g.fillStyle(0x7a4a2a).fillRect(32, h - 22, 4, 22)
    g.fillStyle(0x7a4a2a).fillRect(12, h - 24, 24, 4)
  })
  tex('oratoire', (w, h) => {
    g.fillStyle(0x8a8278).fillRect(8, h - 12, 16, 12) // socle
    g.fillStyle(0xa9a196).fillRect(13, h - 30, 6, 20) // stèle
    g.fillStyle(0xa9a196).fillRect(9, h - 26, 14, 5) // la croix
  })
  tex('bivouac', (w, h) => {
    g.fillStyle(0x6e675e).fillEllipse(w / 2, h - 5, w - 6, 9) // cercle de pierres
    g.fillStyle(0x2a2622).fillEllipse(w / 2, h - 5, w - 16, 5) // cendres froides
    g.fillStyle(0x4a3620).fillRect(w / 2 - 6, h - 10, 12, 2) // deux bûches
  })

  // ─────────── Danger : rouille sombre ───────────
  tex('taniere', (w, h) => {
    g.fillStyle(0x4a3f30).fillEllipse(w / 2, h - 6, w - 4, 14) // le tertre
    g.fillStyle(0x14100c).fillEllipse(w / 2, h - 4, 14, 9) // le trou
  })
  tex('repaire', (w, h) => {
    g.fillStyle(0x3a3430).fillRect(0, h - 12, w, 12) // sol brûlé
    g.fillStyle(0x5c3a2a).fillTriangle(6, h - 12, 16, h - 30, 26, h - 12) // un abri de fortune
    g.fillStyle(0x8a2a1a).fillCircle(38, h - 8, 4) // braise
    g.fillStyle(0x2a2622).fillRect(30, h - 20, 3, 12) // pieu
  })
  tex('epave', (w, h) => {
    g.fillStyle(0x8a8278).fillRect(0, h - 8, w, 8) // névé
    g.fillStyle(0x5a5048).fillRect(4, h - 20, 18, 12) // carcasse
    g.fillStyle(0x3a342e).fillRect(20, h - 14, 10, 6)
    g.fillStyle(0x7a3a2a).fillRect(8, h - 24, 3, 6) // ferraille
  })
  tex('fondriere', (w, h) => {
    g.fillStyle(0x3a4030).fillEllipse(w / 2, h - 5, w - 2, 10) // la fange
    g.fillStyle(0x2a3020).fillEllipse(w / 2 - 8, h - 5, 12, 5)
    g.fillStyle(0x5a6048).fillEllipse(w / 2 + 10, h - 6, 8, 3) // remous
  })
  tex('crevasses', (w, h) => {
    g.fillStyle(0xd6e4ec).fillRect(0, h - 12, w, 12) // glace
    g.fillStyle(0x2a3a52).fillRect(6, h - 12, 4, 12) // les fentes
    g.fillStyle(0x2a3a52).fillRect(24, h - 12, 5, 12)
    g.fillStyle(0x2a3a52).fillRect(46, h - 12, 4, 12)
  })

  // ─────────── Récompense : pierre claire — LES ONZE LIEUX CHARGÉS ───────────
  tex('belvedere', (w, h) => {
    g.fillStyle(0x8a8278).fillRect(0, h - 20, w, 20) // l'éperon
    g.fillStyle(0xa9a196).fillRect(2, h - 26, w - 6, 8) // la vire (celle qu'on creuse)
    g.fillStyle(0x6e675e).fillRect(10, h - 38, 5, 13) // le cairn du sommet
    g.fillStyle(0x8a8278).fillRect(11, h - 40, 3, 4)
  })
  tex('grotte', (w, h) => {
    g.fillStyle(0x7a7670).fillRect(0, h - 30, w, 30) // le rocher
    g.fillStyle(0x9a968e).fillRect(0, h - 34, w - 6, 6)
    g.fillStyle(0x0e0c0a).fillEllipse(w / 2, h - 6, 18, 20) // la gueule noire
  })
  tex('cascade', (w, h) => {
    g.fillStyle(0x6e675e).fillRect(0, 0, w, h - 8) // la paroi
    g.fillStyle(0xdff0f6).fillRect(11, 2, 10, h - 12) // le jet
    g.fillStyle(0xffffff).fillRect(13, 4, 4, h - 16)
    g.fillStyle(0xa8cfe0).fillEllipse(w / 2, h - 5, w - 4, 10) // la vasque
  })
  tex('erratique', (w, h) => {
    g.fillStyle(0x6e675e).fillEllipse(w / 2, h - 12, w - 4, 26) // le bloc, seul
    g.fillStyle(0x8a8278).fillEllipse(w / 2 - 5, h - 18, 14, 12) // la lumière au nord-ouest
    g.fillStyle(0x4a463f).fillEllipse(w / 2 + 7, h - 6, 10, 6) // l'ombre au sud-est
  })
  tex('arbre', (w, h) => {
    // 72 px : un arbre de forêt en fait 44. Il DOIT écraser ses voisins.
    g.fillStyle(0x3a2a18).fillRect(w / 2 - 4, h - 34, 8, 34) // un tronc épais
    g.fillStyle(0x4a3620).fillRect(w / 2 - 4, h - 34, 3, 34)
    g.fillStyle(0x143d18).fillCircle(w / 2, h - 48, 20) // la couronne, immense
    g.fillStyle(0x1e5c26).fillCircle(w / 2 - 7, h - 55, 12)
    g.fillStyle(0x0e2c12).fillCircle(w / 2 + 9, h - 42, 9)
  })
  tex('cairn', (w, h) => {
    // Une tuile de large : le plus petit des lieux, et le plus fréquent.
    g.fillStyle(0x8a8278).fillRect(3, h - 5, 10, 5)
    g.fillStyle(0x9a968e).fillRect(4, h - 10, 8, 5)
    g.fillStyle(0x7a7670).fillRect(5, h - 14, 6, 4)
    g.fillStyle(0xa9a196).fillRect(6, h - 17, 4, 3)
  })
  tex('sanctuaire', (w, h) => {
    g.fillStyle(0x4a463f).fillEllipse(w / 2, h - 4, w - 2, 8) // le sol foulé
    g.fillStyle(0xa9a196).fillRect(3, h - 34, 6, 30) // les pierres levées
    g.fillStyle(0xa9a196).fillRect(23, h - 34, 6, 30)
    g.fillStyle(0x8a8278).fillRect(13, h - 26, 6, 22) // la plus petite, au centre
    g.fillStyle(0xc4bcae).fillRect(1, h - 38, 30, 5) // le linteau
  })
  tex('source_chaude', (w, h) => {
    g.fillStyle(0x6e675e).fillEllipse(w / 2, h - 6, w - 2, 12) // la margelle (celle qu'on creuse)
    g.fillStyle(0x3a7a86).fillEllipse(w / 2, h - 6, w - 12, 7) // l'eau
    g.fillStyle(0xa8dce0).fillEllipse(w / 2 - 3, h - 7, 8, 3)
    g.fillStyle(0xd8ecee).fillCircle(w / 2 - 4, h - 15, 3) // la vapeur
    g.fillStyle(0xd8ecee).fillCircle(w / 2 + 3, h - 19, 2)
  })
  tex('arche', (w, h) => {
    g.fillStyle(0x8a8278).fillRect(0, h - 30, 9, 30) // les deux pieds
    g.fillStyle(0x8a8278).fillRect(w - 9, h - 30, 9, 30)
    g.fillStyle(0x9a968e).fillRect(0, h - 42, w, 14) // le linteau
    g.fillStyle(0x6e675e).fillRect(0, h - 34, w, 4) // l'ombre sous la voûte
  })
  tex('tarn', (w, h) => {
    g.fillStyle(0x6e675e).fillEllipse(w / 2, h - 8, w - 2, 16) // la rive de pierre
    g.fillStyle(0x2a5a72).fillEllipse(w / 2, h - 8, w - 12, 11) // le lac d'altitude
    g.fillStyle(0x4a90ac).fillEllipse(w / 2 - 6, h - 10, 12, 4) // le ciel dedans
  })
  tex('petroglyphes', (w, h) => {
    g.fillStyle(0x7a7670).fillRect(0, h - 26, w, 26) // la dalle
    g.fillStyle(0x9a968e).fillRect(0, h - 30, w - 4, 6)
    g.fillStyle(0x3a3128).fillRect(7, h - 20, 2, 8) // les gravures
    g.fillStyle(0x3a3128).fillRect(12, h - 22, 2, 5)
    g.fillStyle(0x3a3128).fillRect(17, h - 20, 2, 8)
    g.fillStyle(0x3a3128).fillRect(9, h - 14, 9, 2)
    g.fillStyle(0x3a3128).fillRect(21, h - 18, 4, 2)
  })

  g.destroy()
}
