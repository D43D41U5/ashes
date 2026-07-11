/**
 * PROTOTYPE JETABLE — falaise de berge par OCCLUSION, à la frontière TERRE↔EAU.
 * But : juger le RENDU de l'occlusion (une chute franche qui se dessine par-dessus
 * l'eau → la masse d'eau paraît creusée sous une berge) avant de décider si on
 * ré-introduit les falaises discrètes. Pas testé, pas définitif.
 *
 * Frontière = terre (haut) contre EAU (shallow OU profonde = bas) : pas de mur
 * parasite entre peu-profond et profond. On dessine, comme les vraies falaises,
 * la FACE nord (regarde la caméra) et les TRANCHES est/ouest (continuité sur les
 * contours diagonaux) ; les berges sud ne montrent pas leur face (elle regarde
 * ailleurs). Face mieux faussée : arête d'herbe éclairée, corps dégradé, ombre à
 * la ligne d'eau — approche un art peint sans vrai art.
 *
 * La berge PORTE LE WARP : chaque bord est un quadrilatère dont l'arête haute
 * suit le sol déformé (`warp.lift` aux coins entiers, comme `GroundLayer`). Sans
 * ça il faudrait aplatir l'eau, ce qui creuse une marche sous chaque rivière de
 * flanc et replie sa berge sud par-dessus le lit.
 */
import Phaser from 'phaser'
import { hash2, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, TERRAIN_VOID, type WorldMap } from '@braises/sim'
import { TILE_PX } from '../../render/framing'
import type { Warp } from '../../render/warp'

const DROP = 18 // px : hauteur du décrochement de berge (démo, fixe)
const SIDE = 6 // px : largeur d'une tranche est/ouest
const MASS_FOR_FACE = 12 // tuiles d'eau (sur 25) sous lesquelles on ne creuse pas de face
const ROCK = 0x5b5349
const SHADOW = 0x0a1826 // ombre portée du bord sur l'eau (semi-transparente)

// Couleurs de biome (copie du placeholder de WorldScene, démo) — le LISERÉ prend
// la couleur du biome de la terre adjacente, pas un vert fixe.
const TERRAIN_COLORS: Record<number, number> = {
  1: 0x3e7d3a, 2: 0xb2996a, 3: 0x2c5a2e, 5: 0x6d6d70, 7: 0x4a4038, 8: 0x556b4a,
  9: 0x96928a, 10: 0xeef2f8, 11: 0x8a7078, 12: 0xb2c278, 13: 0x507438, 14: 0x9c964e,
  15: 0xcee2ee, 16: 0x7c7468, 17: 0x9cb25c, 18: 0x484c3a, 19: 0x707a50, 20: 0xbebe94,
  21: 0x4a3e38, 22: 0x1c3a28,
}

const shade = (c: number, f: number): number => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f))
  const b = Math.min(255, Math.round((c & 255) * f))
  return (r << 16) | (g << 8) | b
}

export class ShoreCliff {
  private g: Phaser.GameObjects.Graphics

  constructor(
    scene: Phaser.Scene,
    private map: WorldMap,
    private warp: Warp,
  ) {
    this.g = scene.add.graphics().setDepth(1) // au-dessus sol/ombre, sous les acteurs (démo)
  }

  private isWater(tx: number, ty: number): boolean {
    const { width, height } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false
    const t = this.map.terrain[ty * width + tx]
    return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
  }

  private isLand(tx: number, ty: number): boolean {
    const { width, height } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false
    const t = this.map.terrain[ty * width + tx]
    return t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER && t !== TERRAIN_VOID
  }

  /** Couleur du LISERÉ d'un bord = biome de la terre adjacente, éclairci (arête
   *  qui accroche le jour). Vert de prairie par défaut. */
  private landRim(tx: number, ty: number): number {
    const { width } = this.map
    const t = this.map.terrain[ty * width + tx] ?? 1
    return shade(TERRAIN_COLORS[t] ?? 0x3e7d3a, 1.2)
  }

  /** Y écran d'un coin de la grille — le sol déformé, exactement comme GroundLayer. */
  private sy(txf: number, tyf: number): number {
    return tyf * TILE_PX - this.warp.lift(txf, tyf)
  }

  /** Quad réutilisé : `fillPoints` par bord × chaque frame — on ne veut pas
   *  allouer 4 Vector2 par quad. */
  private quad = [
    new Phaser.Math.Vector2(),
    new Phaser.Math.Vector2(),
    new Phaser.Math.Vector2(),
    new Phaser.Math.Vector2(),
  ]

  private fillQuad(
    x0: number, y0: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number,
    color: number, alpha: number,
  ): void {
    const q = this.quad
    q[0]!.set(x0, y0)
    q[1]!.set(x1, y1)
    q[2]!.set(x2, y2)
    q[3]!.set(x3, y3)
    this.g.fillStyle(color, alpha)
    this.g.fillPoints(q, true)
  }

  /** Bande horizontale suivant l'arête haute warpée [txf0,txf1] à la ligne tyf,
   *  épaisse de `from`→`to` px sous cette arête. */
  private band(txf0: number, txf1: number, tyf: number, from: number, to: number, color: number, alpha = 1): void {
    const xL = txf0 * TILE_PX
    const xR = txf1 * TILE_PX
    const yL = this.sy(txf0, tyf)
    const yR = this.sy(txf1, tyf)
    this.fillQuad(xL, yL + from, xR, yR + from, xR, yR + to, xL, yL + to, color, alpha)
  }

  /** Bande VERTICALE (tranche est/ouest) : colonne [txf0,txf1] sur toute la tuile ty. */
  private column(txf0: number, txf1: number, ty: number, color: number, alpha = 1): void {
    const xL = txf0 * TILE_PX
    const xR = txf1 * TILE_PX
    this.fillQuad(
      xL, this.sy(txf0, ty),
      xR, this.sy(txf1, ty),
      xR, this.sy(txf1, ty + 1),
      xL, this.sy(txf0, ty + 1),
      color, alpha,
    )
  }

  /** Combien de tuiles d'eau d'affilée vers le SUD, à partir de (tx,ty) — la
   *  hauteur d'eau que la face a le droit de manger. */
  private waterRunSouth(tx: number, ty: number, cap: number): number {
    let n = 0
    while (n < cap && this.isWater(tx, ty + n)) n++
    return n
  }

  /** Masse d'eau locale : tuiles d'eau dans le 5×5 centré (0-25). Un lac sature,
   *  un ruisseau d'une tuile plafonne vers 5-8 — et un coude de ruisseau aussi,
   *  là où compter la portée sur la LIGNE se faisait piéger. */
  private waterMass(tx: number, ty: number): number {
    let n = 0
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (this.isWater(tx + dx, ty + dy)) n++
      }
    }
    return n
  }

  /** Une face rocheuse dégradée, arête au biome en haut, ombre en bas.
   *
   *  La face MANGE de l'eau (elle se dessine par-dessus, c'est le principe de
   *  l'occlusion) : elle n'a donc de sens que sur une vraie MASSE d'eau. Sur un
   *  ruisseau d'une ou deux tuiles, elle recouvre le lit — et comme un cours
   *  d'eau qui descend en diagonale a de la terre au nord de presque chaque
   *  tuile, elle le pointille de rocher. Ruisseau (masse d'eau locale faible) →
   *  pas de face, le liseré tient le bord. Lac / large rivière → chute pleine,
   *  plafonnée par l'eau disponible au sud pour laisser une tuile d'eau nue. */
  private drawFace(tx: number, ty: number, rim: number): void {
    // L'arête au biome, elle, se pose TOUJOURS : c'est le bord de la berge, il
    // tient le trait même là où la face est refusée (ruisseau).
    this.band(tx, tx + 1, ty, -2, 1, rim)
    if (this.waterMass(tx, ty) < MASS_FOR_FACE) return
    const run = this.waterRunSouth(tx, ty, 3)
    const drop = Math.min(DROP, (run - 1) * TILE_PX)
    if (drop < 3) return
    const j = 0.94 + 0.12 * hash2(tx, ty) // légère variation par tuile → pas une bande uniforme
    // Corps en 3 bandes : plus clair en haut (lumière rasante), sombre en bas.
    this.band(tx, tx + 1, ty, 0, drop, shade(ROCK, 0.95 * j))
    this.band(tx, tx + 1, ty, drop * 0.45, drop, shade(ROCK, 0.72 * j))
    this.band(tx, tx + 1, ty, drop - 2, drop, shade(ROCK, 0.5)) // ombre à la ligne d'eau
    this.band(tx, tx + 1, ty, -2, 1, rim) // arête redessinée : la face l'a recouverte
  }

  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    const { width } = this.map
    const v = camera.worldView
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    // Marge basse : une berge basse mais très soulevée monte dans la vue.
    const ty1 = Math.min(this.map.height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 64)
    const g = this.g
    g.clear()
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.isWater(tx, ty)) continue // on dessine sur la tuile BASSE (eau)
        // Largeur du cours d'eau ici : elle plafonne les tranches est/ouest. Deux
        // ombres de 12 px sur un ruisseau de 16 px, c'est un ruisseau noir.
        let wr = 1
        while (wr < 8 && (this.isWater(tx - wr, ty) || this.isWater(tx + wr, ty))) wr++
        const s = Math.min(SIDE, (wr * TILE_PX) / 4) / TILE_PX // largeur d'une tranche, en tuiles
        const landW = this.isLand(tx - 1, ty)
        const landE = this.isLand(tx + 1, ty)
        // CHENAL d'une tuile (berge des DEUX côtés) : les deux ombres se
        // rejoignent au milieu — 16 px d'ombre sur une tuile de 16 px, le
        // ruisseau devient un filet noir. On n'ombre pas : les liserés suffisent.
        const narrow = landW && landE
        const rim = 2 / TILE_PX
        // FACE nord : terre plus haute au nord → on voit sa face rocheuse (caméra).
        if (this.isLand(tx, ty - 1)) {
          this.drawFace(tx, ty, this.landRim(tx, ty - 1))
        }
        // Côtés est/ouest : PAS de face (vue de profil = pas de belle paroi en
        // top-down). À la place, le bord OMBRE l'eau qu'il surplombe — dégradé
        // doux sur l'eau, avec un mince liseré d'herbe sur la terre. Bien plus
        // propre qu'un bâton rocheux.
        if (landE) {
          if (!narrow) {
            this.column(tx + 1 - s, tx + 1, ty, SHADOW, 0.45)
            this.column(tx + 1 - 2 * s, tx + 1 - s, ty, SHADOW, 0.25)
          }
          this.column(tx + 1 - rim, tx + 1, ty, this.landRim(tx + 1, ty), 0.95)
        }
        if (landW) {
          if (!narrow) {
            this.column(tx, tx + s, ty, SHADOW, 0.45)
            this.column(tx + s, tx + 2 * s, ty, SHADOW, 0.25)
          }
          this.column(tx, tx + rim, ty, this.landRim(tx - 1, ty), 0.95)
        }
        // Berge SUD (near bank : terre au sud de l'eau) : pas de face visible (le
        // décrochement regarde ailleurs), mais un liseré au biome au ras de l'eau.
        if (this.isLand(tx, ty + 1)) {
          this.band(tx, tx + 1, ty + 1, -3, 0, this.landRim(tx, ty + 1))
        }
      }
    }
  }

  destroy(): void {
    this.g.destroy()
  }
}
