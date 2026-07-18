/**
 * Génération des textures placeholder (spec client R8, pattern Manif) :
 * tant que la direction artistique n'est pas posée, tout est dessiné par
 * code au boot — aucun asset binaire dans le repo.
 */
import Phaser from 'phaser'
import { generateItemIcons } from '../render/item-art'
import { generateVitalIcons } from '../render/vital-art'
import { makeCliffTextures } from '../render/cliff-art'
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
    generateItemIcons(this) // les 16 icônes d'items — voir render/item-art.ts
    generateVitalIcons(this) // les 4 icônes des jauges du HUD — voir render/vital-art.ts
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

    tile(0x3a2c1e, 0x6b4a2f) // mur (le FANTÔME) : bois sombre, un carré représentatif
    g.generateTexture('st-wall', 16, 16)
    g.clear()

    // LES 16 MURS D'AUTOTUILE (décision d'Alexis : murs CONTINUS). Base NEUTRE (le
    // rendu la teinte par matériau) : remplie plein cadre, avec un liseré clair en
    // HAUT et sombre sur les côtés EXPOSÉS (sans voisin) — deux murs voisins se
    // fondent sans couture. `mask` : N=1, E=2, S=4, O=8.
    const WALL_BASE = 0x8a8a92
    const WALL_HI = 0xb2b2ba
    const WALL_SH = 0x484850
    for (let mask = 0; mask < 16; mask++) {
      g.fillStyle(WALL_BASE).fillRect(0, 0, 16, 16)
      if (!(mask & 1)) g.fillStyle(WALL_HI).fillRect(0, 0, 16, 3) // pas de voisin N : arête éclairée
      if (!(mask & 8)) g.fillStyle(WALL_SH).fillRect(0, 0, 3, 16) // pas de voisin O : arête d'ombre
      if (!(mask & 2)) g.fillStyle(WALL_SH).fillRect(13, 0, 3, 16) // pas de voisin E
      if (!(mask & 4)) g.fillStyle(WALL_SH).fillRect(0, 13, 16, 3) // pas de voisin S : pied d'ombre
      g.generateTexture(`st-wall-${mask}`, 16, 16)
      g.clear()
    }

    tile(0x3a2c1e, 0x8a6234) // porte : bois clair + seuil
    g.fillStyle(0x2a1e12).fillRect(6, 2, 4, 12)
    g.generateTexture('st-door', 16, 16)
    g.clear()

    // Sol : pièce MOLLE POSÉE AU RAS DU SOL (décision d'Alexis) — un plancher plat.
    g.fillStyle(0x4a3a28).fillRect(0, 0, 16, 16)
    g.fillStyle(0x5a4632).fillRect(1, 1, 14, 6)
    g.fillStyle(0x5a4632).fillRect(1, 9, 14, 6)
    g.generateTexture('st-floor', 16, 16)
    g.clear()

    // TOIT DE PAILLE (décision d'Alexis) : un chaume doré, plein cadre (il couvre la
    // tuile), avec des brins. Il se RÉVÈLE de loin comme la cime des arbres (R24).
    g.fillStyle(0xa9852f).fillRect(0, 0, 16, 16)
    g.fillStyle(0xc7a24a).fillRect(0, 0, 16, 8)
    g.fillStyle(0x8a6a26).fillRect(0, 5, 16, 1)
    g.fillStyle(0x8a6a26).fillRect(0, 11, 16, 1)
    g.fillStyle(0xd8b866).fillRect(2, 1, 1, 6)
    g.fillStyle(0xd8b866).fillRect(9, 1, 1, 6)
    g.fillStyle(0x8a6a26).fillRect(5, 9, 1, 6)
    g.fillStyle(0x8a6a26).fillRect(12, 9, 1, 6)
    g.generateTexture('st-roof', 16, 16)
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

    // Enclume (composant Forge) : la table et la corne, fer sombre.
    tile(0x24242a, 0x3c3c44)
    g.fillStyle(0x54545e).fillRect(2, 5, 12, 2) // la table éclairée
    g.fillStyle(0x3c3c44).fillTriangle(11, 5, 16, 5, 11, 9) // la corne
    g.fillStyle(0x24242a).fillRect(6, 10, 4, 4) // le socle
    g.generateTexture('st-enclume', 16, 16)
    g.clear()

    // Four d'acier (composant Forge N3) : plus haut, flamme BLEUTÉE (l'acier).
    tile(0x2a3038, 0x4a5560)
    g.fillStyle(0x1c2228).fillRect(4, 5, 8, 8) // la gueule
    g.fillStyle(0x7ac0ff).fillRect(6, 8, 4, 4) // la flamme d'acier
    g.fillStyle(0xd8f0ff).fillRect(7, 9, 2, 2)
    g.generateTexture('st-four_acier', 16, 16)
    g.clear()

    // Tour méca (composant Atelier N2) : un bâti sombre, un volant clair.
    tile(0x2a2a30, 0x3c3c44)
    g.fillStyle(0x8a6234).fillCircle(8, 8, 4)
    g.fillStyle(0x2a2a30).fillCircle(8, 8, 2)
    g.generateTexture('st-tour_meca', 16, 16)
    g.clear()

    // Atelier lourd (composant Atelier N3) : la grosse machine, un voyant chaud.
    tile(0x1c1c22, 0x2e2e34)
    g.fillStyle(0x44444c).fillRect(2, 2, 12, 3)
    g.fillStyle(0xe8842c).fillRect(5, 8, 4, 3)
    g.generateTexture('st-atelier_lourd', 16, 16)
    g.clear()

    // Silo (composant Grenier N1) : une jarre à grain, panse claire.
    tile(0x4a3520, 0x8a6a3a)
    g.fillStyle(0xa8834a).fillRect(2, 2, 5, 12)
    g.fillStyle(0x6a4c2c).fillRect(6, 1, 4, 2)
    g.generateTexture('st-silo', 16, 16)
    g.clear()

    // Cave (composant Grenier N2) : la voûte de pierre, la trappe sombre (le froid).
    tile(0x2a2a30, 0x4a4a52)
    g.fillStyle(0x1c1c22).fillRect(5, 6, 6, 8)
    g.fillStyle(0x66666e).fillRect(1, 2, 14, 2)
    g.generateTexture('st-cave', 16, 16)
    g.clear()

    // Réserve stratégique (composant Grenier N3) : la jarre cerclée de fer.
    tile(0x3a2c1e, 0x7a5a34)
    g.fillStyle(0x9a9aa3).fillRect(1, 5, 14, 1)
    g.fillStyle(0x9a9aa3).fillRect(1, 10, 14, 1)
    g.generateTexture('st-reserve', 16, 16)
    g.clear()

    // Parcelle (composant Ferme N1) : la terre labourée, des sillons, une pousse.
    tile(0x3a2a18, 0x5a4028)
    g.fillStyle(0x3a2a18).fillRect(4, 2, 1, 12)
    g.fillStyle(0x3a2a18).fillRect(9, 2, 1, 12)
    g.fillStyle(0x5aa84a).fillRect(6, 5, 2, 4)
    g.generateTexture('st-parcelle', 16, 16)
    g.clear()

    // Serre (composant Ferme N2) : le vitrage clair (cultures d'hiver).
    tile(0x6a4c2c, 0xbfe0d8)
    g.fillStyle(0x8ab0a8).fillRect(7, 1, 1, 14)
    g.fillStyle(0x8ab0a8).fillRect(1, 7, 14, 1)
    g.generateTexture('st-serre', 16, 16)
    g.clear()

    // Terroir (composant Ferme N3) : la terre riche + une gerbe dorée (l'Ermitage).
    tile(0x2a1e12, 0x4a3420)
    g.fillStyle(0xd8b24a).fillTriangle(4, 14, 8, 2, 12, 14)
    g.generateTexture('st-terroir', 16, 16)
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
    makeCliffTextures(this) // les bandes de roche plate des frontières — voir render/cliff-art.ts
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
    g.clear()

    // ══ LES CINQ STRUCTURANTS — un par zone T1, et chacun n'existe QUE chez lui ═══════════════
    //
    // Ils étaient dans /sim depuis la veille, et le client n'en savait rien : Phaser peignait à
    // leur place son carré vert de texture manquante. Six par écran, dans la Vieille Sylve. C'est
    // la SEPTIÈME mécanique de ce projet trouvée en PILOTANT le jeu — et, comme les six autres,
    // aucune garde ne la voyait.
    //
    // RÈGLE : chacun doit se distinguer EN OMBRE CHINOISE de son cousin ordinaire. Un gros bois
    // n'est pas un arbre en plus foncé, c'est un FÛT. Une pierre de taille n'est pas un caillou,
    // c'est un BLOC. À seize pixels, la silhouette est tout ce qu'on a.

    // LE GROS BOIS (Vieille Sylve) — un fût ÉPAIS. Deux fois le tronc ordinaire, et ses cernes.
    g.fillStyle(0x3f2c19).fillRect(3, 0, 10, 24)
    g.fillStyle(0x543a22).fillRect(3, 0, 4, 24) // l'arête claire, comme l'arbre : même lumière
    g.fillStyle(0x2a1c0f).fillRect(11, 0, 2, 24)
    g.fillStyle(0xa8865c).fillRect(5, 3, 6, 2) // le cœur, en bout : on voit qu'il est VIEUX
    g.generateTexture('nd-old_tree_trunk', 16, 24)
    g.clear()
    // Son houppier : plus large et plus SOMBRE que celui de l'arbre — il ferme le ciel.
    g.fillStyle(0x12321a).fillCircle(20, 20, 19)
    g.fillStyle(0x1d4a26).fillCircle(15, 15, 11)
    g.fillStyle(0x0d2413).fillCircle(27, 28, 8)
    g.generateTexture('nd-old_tree_crown', 40, 40)
    g.clear()

    // LA TOURBE (Tourbière) — une entaille dans l'eau noire. Pas un objet : un TROU.
    g.fillStyle(0x2a2219).fillRect(2, 6, 12, 8)
    g.fillStyle(0x1a150f).fillRect(4, 8, 8, 4) // l'eau au fond de la coupe
    g.fillStyle(0x3d3226).fillRect(2, 6, 12, 1)
    g.fillStyle(0x4a3d2c).fillRect(2, 6, 2, 8)
    g.generateTexture('nd-peat_cut', 16, 16)
    g.clear()

    // LA CARRIÈRE (Hauts Alpages) — un BLOC taillé, avec des arêtes. Pas un galet.
    g.fillStyle(0x6a6a72).fillRect(2, 5, 12, 9)
    g.fillStyle(0x8e8e98).fillRect(2, 5, 12, 3) // le dessus, éclairé
    g.fillStyle(0xa4a4ae).fillRect(2, 5, 4, 9) // la face au NO
    g.fillStyle(0x45454c).fillRect(2, 13, 12, 1) // l'ombre au pied
    g.generateTexture('nd-quarry', 16, 16)
    g.clear()

    // LA CENDRE (Versant Brûlé) — un tas gris, et UNE braise qui couve. Le jeu porte son nom.
    g.fillStyle(0x6e6a66).fillCircle(8, 11, 5)
    g.fillStyle(0x8d8884).fillCircle(6, 10, 3)
    g.fillStyle(0xa8a29c).fillCircle(6, 9, 1)
    g.fillStyle(0xd9541f).fillRect(9, 11, 2, 2)
    g.generateTexture('nd-ash_heap', 16, 16)
    g.clear()

    // LES GRAVATS (Combe aux Ruines) — de la pierre TAILLÉE, cassée. On reconnaît le mur qu'elle fut.
    g.fillStyle(0x5e5a56).fillRect(2, 9, 6, 5)
    g.fillStyle(0x7a7570).fillRect(2, 9, 6, 1)
    g.fillStyle(0x6a6560).fillRect(8, 7, 6, 7)
    g.fillStyle(0x8a857f).fillRect(8, 7, 6, 1)
    g.fillStyle(0x4a4642).fillRect(5, 5, 4, 3) // un fragment, de travers
    g.generateTexture('nd-rubble', 16, 16)
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

    // Fougère : une ROSETTE de frondes arquées en éventail — reconnaissable, pas trois brins.
    g.fillStyle(0x2f4a24).fillRect(8, 13, 1, 3) // pied
    g.fillStyle(0x35562a) // rachis des frondes (vert sombre)
    g.fillRect(8, 4, 1, 9) // centrale
    g.fillRect(7, 11, 1, 2).fillRect(6, 9, 1, 2).fillRect(5, 7, 1, 2).fillRect(4, 5, 1, 2) // gauche
    g.fillRect(9, 11, 1, 2).fillRect(10, 9, 1, 2).fillRect(11, 7, 1, 2).fillRect(12, 5, 1, 2) // droite
    g.fillStyle(0x4c7636) // folioles (vert clair)
    g.fillRect(7, 6, 1, 1).fillRect(9, 6, 1, 1).fillRect(7, 9, 1, 1).fillRect(9, 9, 1, 1)
    g.fillRect(5, 6, 1, 1).fillRect(11, 6, 1, 1).fillRect(4, 8, 1, 1).fillRect(12, 8, 1, 1)
    g.fillRect(8, 3, 1, 1).fillRect(3, 5, 1, 1).fillRect(13, 5, 1, 1)
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

    // Buisson bien DODU : un dôme plein de folioles, rond et touffu (sous-bois de la racine).
    g.fillStyle(0x24401f).fillCircle(8, 11, 6) // ombre/contour bas
    g.fillStyle(0x2c4a24).fillCircle(8, 10, 5).fillCircle(4, 11, 3).fillCircle(12, 11, 3) // corps
    g.fillStyle(0x375b2c).fillCircle(7, 8, 3).fillCircle(10, 9, 2) // dessus éclairé
    g.fillStyle(0x427035).fillCircle(6, 7, 1).fillCircle(9, 7, 1) // touches de lumière
    tex('cl-bush')

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
    g.clear()

    // ── LES POSTURES (spec faune R9bis / chasse C19). L'ÉTAT d'une bête se lit à
    // sa SILHOUETTE avant sa teinte : tête au sol = elle broute (approchez), tête
    // dressée = elle a vu quelque chose (figez-vous), corps tendu = elle fuit.
    // Le sprite de base (tête haute) devient LA posture d'alerte et de sentinelle.

    // Cerf qui BROUTE : l'encolure plonge, le mufle au sol. La fenêtre du chasseur.
    g.fillStyle(0x4a3524).fillEllipse(10, 9, 16, 9) // corps
    g.fillStyle(0x9b7448).fillEllipse(10, 9, 13, 6) // robe fauve
    g.fillStyle(0x8a6640).fillTriangle(15, 8, 20, 15, 16, 16) // encolure plongeante
    g.fillStyle(0x9b7448).fillEllipse(19, 15, 5, 3) // le mufle, dans l'herbe
    g.fillStyle(0xcfc0a4).fillRect(16, 6, 1, 3).fillRect(19, 7, 1, 3) // bois couchés
    g.fillStyle(0x3a2a1c) // pattes
    g.fillRect(4, 12, 2, 6).fillRect(8, 12, 2, 6).fillRect(13, 12, 2, 6)
    g.generateTexture('spr-deer-graze', 22, 18)
    g.clear()

    // Cerf en FUITE : tout à l'horizontale — encolure tendue, bois couchés,
    // pattes en extension. On doit lire la vitesse dans l'arrêt sur image.
    g.fillStyle(0x4a3524).fillEllipse(12, 8, 20, 7) // corps étiré
    g.fillStyle(0x9b7448).fillEllipse(12, 8, 17, 5)
    g.fillStyle(0x8a6640).fillRect(18, 5, 6, 3) // encolure à plat
    g.fillStyle(0x9b7448).fillEllipse(24, 6, 5, 3) // tête portée en avant
    g.fillStyle(0xcfc0a4).fillRect(19, 2, 4, 1).fillRect(21, 3, 3, 1) // bois couchés en arrière
    g.fillStyle(0x3a2a1c) // pattes en extension, avant et arrière
    g.fillTriangle(3, 10, 0, 17, 5, 11).fillTriangle(8, 11, 6, 17, 10, 11)
    g.fillTriangle(17, 11, 21, 17, 19, 10).fillTriangle(13, 11, 15, 17, 15, 10)
    g.generateTexture('spr-deer-flee', 26, 18)
    g.clear()

    // Cerf COUCHÉ : la masse au sol, pattes pliées dessous, la tête encore levée
    // (il dort d'une oreille : R10, réveillable).
    g.fillStyle(0x4a3524).fillEllipse(10, 8, 18, 8) // corps posé
    g.fillStyle(0x9b7448).fillEllipse(10, 8, 15, 6)
    g.fillStyle(0x3a2a1c).fillRect(3, 10, 13, 2) // les pattes repliées, une ligne d'ombre
    g.fillStyle(0x8a6640).fillRect(15, 3, 3, 6) // encolure relevée
    g.fillStyle(0x9b7448).fillEllipse(17, 3, 5, 3) // tête
    g.fillStyle(0xcfc0a4).fillRect(15, 0, 1, 3).fillRect(19, 0, 1, 3) // bois
    g.generateTexture('spr-deer-bed', 22, 12)
    g.clear()

    // Lapin qui BROUTE : aplati, oreilles couchées en arrière, nez dans l'herbe.
    g.fillStyle(0x6b5a48).fillEllipse(6, 6, 11, 6) // corps tassé
    g.fillStyle(0xa8927a).fillEllipse(6, 6, 9, 4)
    g.fillStyle(0xa8927a).fillCircle(10, 7, 2) // tête au sol
    g.fillStyle(0x6b5a48).fillRect(6, 2, 3, 1).fillRect(5, 3, 3, 1) // oreilles couchées
    g.fillStyle(0xe6e0d4).fillCircle(1, 6, 1) // scut
    g.generateTexture('spr-rabbit-graze', 12, 9)
    g.clear()

    // Lapin en FUITE : une flèche — corps allongé, oreilles plaquées.
    g.fillStyle(0x6b5a48).fillEllipse(7, 5, 13, 5) // corps étiré
    g.fillStyle(0xa8927a).fillEllipse(7, 5, 11, 3)
    g.fillStyle(0xa8927a).fillCircle(12, 4, 2) // tête tendue
    g.fillStyle(0x6b5a48).fillRect(8, 2, 4, 1) // oreilles plaquées
    g.fillStyle(0x3a2a1c).fillTriangle(2, 6, 0, 9, 4, 6).fillTriangle(11, 6, 14, 9, 13, 5) // détente
    g.fillStyle(0xe6e0d4).fillCircle(1, 4, 1)
    g.generateTexture('spr-rabbit-flee', 14, 9)
    g.clear()

    // Sanglier qui FOUGE : la hure PIQUE dans la terre — c'est l'approche offerte
    // (R14). La terre retournée le dit mieux qu'une teinte.
    g.fillStyle(0x4a2e1a).fillEllipse(12, 6, 20, 11) // corps, cul relevé
    g.fillStyle(0x8a5a38).fillEllipse(12, 6, 17, 8)
    g.fillStyle(0x6b442a).fillTriangle(3, 13, 9, 4, 10, 10) // hure plantée au sol
    g.fillStyle(0xe8e0cc).fillRect(2, 11, 3, 1) // la défense, dans la terre
    g.fillStyle(0x3a2416).fillRect(7, 11, 2, 3).fillRect(11, 11, 2, 3).fillRect(16, 10, 2, 4) // pattes
    g.fillStyle(0x5a4630).fillCircle(3, 14, 1).fillCircle(6, 14, 1) // la terre fouie
    g.generateTexture('spr-boar-root', 22, 15)
    g.clear()

    // Sanglier qui CHARGE : bas, long, la hure en bélier. À l'écran une demi-seconde —
    // la silhouette doit HURLER la direction.
    g.fillStyle(0x4a2e1a).fillEllipse(13, 6, 22, 9) // corps couché sur l'élan
    g.fillStyle(0x8a5a38).fillEllipse(13, 6, 19, 6)
    g.fillStyle(0x6b442a).fillTriangle(0, 6, 6, 2, 6, 10) // la hure-bélier
    g.fillStyle(0xe8e0cc).fillRect(0, 7, 3, 1) // la défense en avant
    g.fillStyle(0x3a2416).fillTriangle(6, 9, 3, 13, 8, 9).fillTriangle(17, 9, 21, 13, 19, 8) // pattes en extension
    g.generateTexture('spr-boar-charge', 24, 13)
    g.clear()

    // Loup TAPI (la traque, R11) : ventre au sol, oreilles couchées, la ligne du
    // dos aplatie. La teinte le fond déjà dans le sous-bois ; la posture le dit.
    g.fillStyle(0x2e3238).fillEllipse(11, 8, 19, 6) // corps aplati
    g.fillStyle(0x6b7078).fillEllipse(11, 8, 16, 4)
    g.fillStyle(0x5c6168).fillTriangle(2, 7, 2, 10, 9, 9) // museau au ras
    g.fillStyle(0x3a3f46).fillRect(4, 5, 2, 2) // oreilles couchées
    g.fillStyle(0x2e3238).fillRect(5, 10, 2, 2).fillRect(9, 10, 2, 2).fillRect(15, 10, 2, 2) // pattes pliées
    g.fillStyle(0x6b7078).fillRect(19, 7, 3, 2) // queue droite, basse
    g.generateTexture('spr-wolf-stalk', 22, 12)
    g.clear()

    // LE TERRIER (spec chasse C16). Le lapin naît avec le sien, il y court quand
    // on le lève, et il y DISPARAÎT. Sans le trou dessiné, le lapin s'évapore —
    // et c'est le décor qui avoue. Avec lui, la règle devient une GÉOMÉTRIE : on
    // voit le trou, on voit le lapin, on sait qu'il faut couper la ligne.
    // Un tertre de terre retournée, et un trou noir dedans : ça se lit de loin.
    g.fillStyle(0x5a4630).fillEllipse(7, 7, 14, 9) // le tertre (terre fraîche)
    g.fillStyle(0x4a3826).fillEllipse(7, 7, 11, 7)
    g.fillStyle(0x1a1410).fillEllipse(7, 7, 7, 5) // LE TROU — noir, franc
    g.fillStyle(0x6b5540).fillCircle(2, 10, 1).fillCircle(12, 10, 1) // deux mottes
    g.generateTexture('fx-burrow', 15, 13)
    g.clear()

    // LA GOUTTE DE SANG (spec chasse C9). La piste que le chasseur suit — et que
    // les loups suivent aussi. Une éclaboussure, pas un rond : elle a un SENS, et
    // c'est ce qui permet de lire la direction de la course d'un coup d'œil.
    g.fillStyle(0x8e2318).fillEllipse(5, 5, 7, 5) // la flaque (contour sombre)
    g.fillStyle(0xc4372a).fillEllipse(5, 5, 5, 3) // le cœur, plus vif
    g.fillStyle(0x8e2318).fillCircle(9, 3, 1).fillCircle(1, 7, 1) // deux éclats
    g.generateTexture('fx-blood', 11, 10)
    g.clear()

    // Loup qui MANGE : tête dans la carcasse, garde baissée (R15) — la fenêtre
    // que la mise à mort propre (C6) rend précieuse.
    g.fillStyle(0x2e3238).fillEllipse(12, 7, 17, 8) // corps
    g.fillStyle(0x6b7078).fillEllipse(12, 7, 14, 5)
    g.fillStyle(0x5c6168).fillTriangle(3, 12, 8, 5, 9, 11) // encolure plongée
    g.fillStyle(0x3a3f46).fillCircle(4, 11, 2) // tête au sol
    g.fillStyle(0x2e3238).fillRect(8, 11, 2, 4).fillRect(12, 11, 2, 4).fillRect(16, 10, 2, 4) // pattes
    g.fillStyle(0x6b7078).fillTriangle(19, 5, 22, 2, 20, 8) // queue
    g.generateTexture('spr-wolf-eat', 22, 15)
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
