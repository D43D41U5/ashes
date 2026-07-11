/**
 * Génération des textures placeholder (spec client R8, pattern Manif) :
 * tant que la direction artistique n'est pas posée, tout est dessiné par
 * code au boot — aucun asset binaire dans le repo.
 */
import Phaser from 'phaser'
import { makePoiTextures } from './world/poi-art'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  create(): void {
    this.makeSprite('spr-player', 0xf0e6c8, 0x8a6f3c)
    this.makeSprite('spr-npc', 0x9aa4b5, 0x4a5364)
    this.makeSprite('spr-zombie', 0x7fa05a, 0x3d5230)
    // Le Cendreux : cendre et braise. Il était rendu comme un SANGLIER (tout ce
    // qui n'était pas zombie tombait sur spr-boar) — une bête à 34 dégâts
    // déguisée en gibier. Il a désormais son propre visage.
    this.makeSprite('spr-cendreux', 0xb8b0a4, 0x6b3a20)
    this.makeFauna()

    const g = this.add.graphics()
    g.fillStyle(0xcac2b2) // cadavre : ossements
    g.fillRect(3, 7, 10, 2)
    g.fillRect(5, 4, 2, 8)
    g.fillRect(9, 4, 2, 8)
    g.generateTexture('spr-corpse', 16, 16)
    g.destroy()

    // L'oiseau vu de dessus : un chevron. À cette échelle, c'est tout ce que
    // l'œil retient d'un vol — et ça suffit à savoir que quelque chose vit.
    const b = this.add.graphics()
    b.fillStyle(0x2e2a26)
    b.fillTriangle(0, 0, 5, 3, 0, 2)
    b.fillTriangle(10, 0, 5, 3, 10, 2)
    b.generateTexture('fx-bird', 10, 4)
    b.destroy()

    this.makeStructures()
    this.makeGlowTexture()
    this.scene.start('world')
  }

  /** Halo radial doux (blanc centre → transparent) pour l'éclairage additif des Feux. */
  private makeGlowTexture(): void {
    const size = 256
    const tex = this.textures.createCanvas('glow', size, size)
    if (!tex) return
    const ctx = tex.getContext()
    const c = size / 2
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    tex.refresh()
  }

  /** Textures 16×16 des structures — placeholders générés (spec client R8). */
  private makeStructures(): void {
    const g = this.add.graphics()
    const tile = (border: number, fill: number) => {
      g.fillStyle(border).fillRect(0, 0, 16, 16)
      g.fillStyle(fill).fillRect(1, 1, 14, 14)
    }

    tile(0x3a2c1e, 0x6b4a2f) // mur : bois sombre
    g.generateTexture('st-wall', 16, 16)
    g.clear()

    tile(0x3a2c1e, 0x8a6234) // porte : bois clair + seuil
    g.fillStyle(0x2a1e12).fillRect(6, 2, 4, 12)
    g.generateTexture('st-door', 16, 16)
    g.clear()

    tile(0x4a3520, 0x7a5a30) // coffre : couvercle doré
    g.fillStyle(0xc9a227).fillRect(3, 6, 10, 4)
    g.generateTexture('st-chest', 16, 16)
    g.clear()

    tile(0x3c3c40, 0x5c5c62) // atelier : enclume
    g.fillStyle(0x2a2a2e).fillRect(4, 7, 8, 5)
    g.generateTexture('st-workshop', 16, 16)
    g.clear()

    tile(0x4a3220, 0x9c7448) // four : bouche ardente
    g.fillStyle(0x2a2a2e).fillRect(4, 4, 8, 8)
    g.fillStyle(0xe8842c).fillRect(6, 8, 4, 3)
    g.generateTexture('st-furnace', 16, 16)
    g.clear()

    // Maison : toit pignon + porte.
    g.fillStyle(0x7a4a2a).fillRect(1, 6, 14, 9)
    g.fillStyle(0x9c3f2e)
    g.fillTriangle(0, 7, 8, 0, 16, 7)
    g.fillStyle(0x2a1e12).fillRect(6, 10, 4, 5)
    g.generateTexture('st-house', 16, 16)
    g.clear()

    // Le Feu : foyer de pierre + flamme (la couleur d'alignement viendra en V8).
    g.fillStyle(0x55504a).fillCircle(8, 8, 7)
    g.fillStyle(0x2b2723).fillCircle(8, 8, 5)
    g.fillStyle(0xe8842c).fillCircle(8, 8, 4)
    g.fillStyle(0xf7c256).fillCircle(8, 7, 2)
    g.generateTexture('st-fire', 16, 16)
    g.destroy()

    this.makeNodes()
    this.makeClutter()
    makePoiTextures(this) // les 26 lieux — voir world/poi-art.ts
  }

  /** Textures des nœuds de ressources. */
  private makeNodes(): void {
    const g = this.add.graphics()

    // Un arbre est HAUT (3 tuiles) et FIN (un tronc) — spec arbres hauts. Deux
    // sprites : le tronc, opaque et trié avec les acteurs ; le houppier, qui
    // coiffe le monde et s'efface autour du joueur.
    g.fillStyle(0x4a3620).fillRect(6, 0, 4, 22) // tronc : 4 px de large, 22 de haut
    g.fillStyle(0x5c4429).fillRect(6, 0, 2, 22) // une arête claire, pour le volume
    g.generateTexture('nd-tree_trunk', 16, 22)
    g.clear()

    g.fillStyle(0x1e4d22).fillCircle(16, 16, 15) // houppier : deux tuiles de large
    g.fillStyle(0x2d6b32).fillCircle(12, 12, 8) // lumière au nord-ouest (cf. hillshade)
    g.fillStyle(0x18401d).fillCircle(21, 22, 6) // ombre au sud-est
    g.generateTexture('nd-tree_crown', 32, 32)
    g.clear()

    g.fillStyle(0x5a5a5e).fillCircle(8, 10, 6) // affleurement
    g.fillStyle(0x7c7c82).fillCircle(6, 8, 3)
    g.generateTexture('nd-rock', 16, 16)
    g.clear()

    g.fillStyle(0x6f9c3a) // fibres : touffe
    g.fillRect(4, 8, 2, 7)
    g.fillRect(7, 6, 2, 9)
    g.fillRect(10, 9, 2, 6)
    g.generateTexture('nd-fiber_plant', 16, 16)
    g.clear()

    g.fillStyle(0x2f5e33).fillCircle(8, 9, 6) // buisson à baies
    g.fillStyle(0xc0392b)
    g.fillCircle(5, 8, 1.5)
    g.fillCircle(10, 7, 1.5)
    g.fillCircle(8, 11, 1.5)
    g.generateTexture('nd-berry_bush', 16, 16)
    g.clear()

    g.fillStyle(0x5a5a5e).fillCircle(8, 10, 6) // filon de fer : veinules rouille
    g.fillStyle(0xb0632e)
    g.fillRect(5, 8, 3, 2)
    g.fillRect(9, 11, 3, 2)
    g.generateTexture('nd-iron_vein', 16, 16)
    g.clear()

    g.fillStyle(0x5a5a5e).fillCircle(8, 10, 6) // veine de charbon
    g.fillStyle(0x1c1c20)
    g.fillRect(5, 8, 3, 2)
    g.fillRect(9, 11, 3, 2)
    g.generateTexture('nd-coal_seam', 16, 16)
    g.destroy()
  }

  /** Textures placeholder du décor cosmétique (cl-*). Ternies pour ne jamais
   * être confondues avec les nœuds récoltables (INV-2). */
  private makeClutter(): void {
    const g = this.add.graphics()
    const tex = (key: string): void => {
      g.generateTexture(key, 16, 16)
      g.clear()
    }

    g.fillStyle(0x24401f).fillTriangle(8, 1, 2, 13, 14, 13) // conifère (sombre, terne)
    tex('cl-conifer')

    g.fillStyle(0x3a2c1a).fillRect(6, 4, 4, 11) // gros tronc
    g.fillStyle(0x24401f).fillCircle(8, 4, 5)
    tex('cl-big_trunk')

    g.fillStyle(0x4a3826).fillRect(6, 9, 4, 5) // souche
    tex('cl-stump')

    g.fillStyle(0x3f6238) // fougère (touffe basse)
    g.fillRect(5, 10, 2, 5).fillRect(8, 9, 2, 6).fillRect(11, 11, 2, 4)
    tex('cl-fern')

    g.fillStyle(0x2f5030).fillTriangle(8, 3, 4, 13, 12, 13) // pin clair
    tex('cl-pine')

    g.fillStyle(0x6f7a3a).fillTriangle(8, 3, 5, 12, 11, 12) // mélèze doré terne
    tex('cl-larch')

    g.fillStyle(0x2b2b2f).fillRect(7, 4, 2, 10) // tronc calciné
    tex('cl-burnt_trunk')

    g.fillStyle(0x5a6e33) // touffe d'herbe
    g.fillRect(5, 9, 2, 5).fillRect(8, 8, 2, 6).fillRect(11, 10, 2, 4)
    tex('cl-grass_tuft')

    g.fillStyle(0x50662f).fillCircle(8, 11, 3) // fleur (tige + corolle discrète)
    g.fillStyle(0x9a7bb0).fillCircle(8, 6, 2)
    tex('cl-flower')

    g.fillStyle(0x6a6a6e).fillCircle(6, 11, 2).fillCircle(10, 12, 2).fillCircle(8, 10, 1.5) // cailloux
    tex('cl-pebbles')

    g.fillStyle(0x5f5f64).fillCircle(8, 10, 5) // gros bloc
    g.fillStyle(0x6f6f75).fillCircle(6, 9, 2)
    tex('cl-boulder')

    g.fillStyle(0x4b4a2e).fillCircle(7, 11, 3).fillCircle(10, 11, 2) // buisson bas (lande)
    tex('cl-low_bush')

    g.fillStyle(0x6d7a40) // roseau
    g.fillRect(6, 4, 1, 11).fillRect(9, 3, 1, 12).fillRect(11, 6, 1, 9)
    tex('cl-reed')

    g.fillStyle(0x6a6a3a).fillCircle(8, 11, 4) // sphaigne (coussin)
    tex('cl-sphagnum')

    g.fillStyle(0x777c50).fillCircle(6, 10, 2).fillCircle(9, 11, 2) // lichen
    tex('cl-lichen')

    g.fillStyle(0xd8dde6).fillCircle(8, 12, 4) // congère
    tex('cl-snowdrift')

    g.destroy()
  }

  /**
   * Les trois gibiers (spec faune R8). Un carré marron ne dit pas « sanglier » :
   * ce qui rend une bête lisible à 20 tuiles, c'est sa SILHOUETTE. Le sanglier
   * est bas et massif, le cerf haut et sur pattes, le lapin minuscule et dressé —
   * on doit savoir ce qui détale avant d'avoir lu la couleur.
   */
  private makeFauna(): void {
    const g = this.add.graphics()

    // Sanglier : une masse basse, une hure qui pique vers l'avant, une défense.
    g.fillStyle(0x4a2e1a).fillEllipse(11, 7, 20, 11) // corps (contour sombre)
    g.fillStyle(0x8a5a38).fillEllipse(11, 7, 17, 8) // robe
    g.fillStyle(0x6b442a).fillTriangle(2, 5, 2, 10, 9, 8) // hure, tendue vers l'avant
    g.fillStyle(0xe8e0cc).fillRect(1, 6, 3, 1) // la défense — le détail qui prévient
    g.fillStyle(0x3a2416).fillRect(5, 11, 2, 3).fillRect(9, 11, 2, 3).fillRect(15, 11, 2, 3) // pattes
    g.generateTexture('spr-boar', 22, 15)
    g.clear()

    // Cerf : haut sur pattes, encolure dressée, bois. On le voit de loin, et il
    // vous voit de plus loin encore.
    g.fillStyle(0x4a3524).fillEllipse(11, 13, 16, 9) // corps
    g.fillStyle(0x9b7448).fillEllipse(11, 13, 13, 6) // robe fauve
    g.fillStyle(0x8a6640).fillRect(14, 5, 3, 7) // encolure
    g.fillStyle(0x9b7448).fillEllipse(16, 5, 6, 4) // tête
    g.fillStyle(0xcfc0a4) // les bois
    g.fillRect(14, 0, 1, 4).fillRect(18, 0, 1, 4)
    g.fillRect(13, 1, 1, 1).fillRect(19, 1, 1, 1)
    g.fillStyle(0x3a2a1c) // pattes fines
    g.fillRect(5, 16, 2, 6).fillRect(9, 16, 2, 6).fillRect(14, 16, 2, 6)
    g.generateTexture('spr-deer', 22, 22)
    g.clear()

    // Loup : bas, tendu, la tête portée dans l'axe du dos. Là où le cerf est
    // vertical et le sanglier massif, le loup est une LIGNE — il est fait pour
    // couvrir du terrain, et sa silhouette doit le dire avant qu'il n'arrive.
    g.fillStyle(0x2e3238).fillEllipse(11, 9, 19, 8) // corps (contour)
    g.fillStyle(0x6b7078).fillEllipse(11, 9, 16, 5) // robe grise
    g.fillStyle(0x5c6168).fillTriangle(2, 6, 2, 11, 10, 9) // museau dans l'axe
    g.fillStyle(0x3a3f46).fillTriangle(4, 3, 6, 6, 2, 6) // oreille dressée
    g.fillStyle(0xe8e4dc).fillRect(1, 8, 2, 1) // le croc
    g.fillStyle(0x2e3238) // pattes hautes : il court
    g.fillRect(5, 12, 2, 5).fillRect(9, 12, 2, 5).fillRect(15, 12, 2, 5)
    g.fillStyle(0x6b7078).fillTriangle(19, 6, 22, 3, 20, 10) // la queue basse
    g.generateTexture('spr-wolf', 22, 17)
    g.clear()

    // L'ALPHA. Il faut le RECONNAÎTRE d'un coup d'œil, au milieu des siens et dans
    // le noir : c'est toute la règle (le tuer disperse la meute). Donc trois
    // signaux qui ne se ressemblent pas — il est plus GRAND (voir snapshot-view),
    // plus SOMBRE, et il porte une échine claire que personne d'autre n'a.
    g.fillStyle(0x1c1f24).fillEllipse(13, 10, 24, 10) // corps, plus lourd
    g.fillStyle(0x4a4f57).fillEllipse(13, 10, 21, 7) // robe noire
    g.fillStyle(0x8e949c).fillRect(6, 7, 13, 2) // l'échine argentée : sa marque
    g.fillStyle(0x3a3f46).fillTriangle(2, 7, 2, 13, 11, 10) // museau
    g.fillStyle(0x1c1f24).fillTriangle(4, 3, 7, 7, 2, 7) // oreille
    g.fillStyle(0xf2eee6).fillRect(1, 9, 3, 1) // le croc, plus long
    g.fillStyle(0x1c1f24)
    g.fillRect(6, 14, 3, 6).fillRect(11, 14, 3, 6).fillRect(17, 14, 3, 6) // pattes épaisses
    g.fillStyle(0x4a4f57).fillTriangle(22, 7, 26, 3, 23, 12) // queue
    g.generateTexture('spr-wolf-alpha', 26, 20)
    g.clear()

    // Lapin : une boule, deux oreilles. La silhouette la plus lisible du lot.
    g.fillStyle(0x6b5a48).fillEllipse(6, 8, 10, 8) // corps
    g.fillStyle(0xa8927a).fillEllipse(6, 8, 8, 6) // robe
    g.fillStyle(0xa8927a).fillCircle(9, 5, 2) // tête
    g.fillStyle(0x6b5a48).fillRect(8, 0, 1, 4).fillRect(10, 0, 1, 4) // les oreilles
    g.fillStyle(0xe6e0d4).fillCircle(1, 9, 1) // scut : le point blanc qui détale
    g.generateTexture('spr-rabbit', 12, 12)
    g.destroy()
  }

  private makeSprite(key: string, fill: number, border: number): void {
    const g = this.add.graphics()
    g.fillStyle(border).fillRect(0, 0, 12, 12)
    g.fillStyle(fill).fillRect(1, 1, 10, 10)
    g.generateTexture(key, 12, 12)
    g.destroy()
  }
}
