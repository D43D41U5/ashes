/**
 * ═══ CE QUI BOUGE DANS UNE CAVE VIDE — gouttes, poussière dans le jour, souffle à la gueule ═══
 *
 * *« Ce n'est pas un souci s'il n'y a pas de nœuds ou d'animaux : le rendu vide doit être
 * époustouflant. »* Un lieu vide n'est pas un lieu immobile. Trois mouvements, tous minuscules,
 * tous sans logique de jeu — de la pure Veillée d'écran, comme la fumée des fumerolles
 * (`fumerolle-fx.ts`, dont ce fichier reprend le patron : un pool d'images `__WHITE`, une
 * enveloppe d'alpha, un `dt` borné) :
 *
 *  • **LES GOUTTES** — dedans. Un trait pâle tombe du plafond (hors cadre : le plafond n'existe
 *    pas à l'écran, c'est le point du dessin) et fait un rond d'un pixel en touchant le sol. Sous
 *    le voile : on ne les voit que dans la lumière. C'est le battement d'horloge d'une cave.
 *  • **LA POUSSIÈRE** — dans la nappe de jour à la gueule, des grains qui dérivent. Ils rendent
 *    le jour VISIBLE comme un volume — un rayon de lumière ne se voit que par ce qu'il traverse.
 *  • **LE SOUFFLE** — dehors, à la gueule : quelques grains bleu pâle sortent du trou et tombent
 *    vers le sud. L'air d'une cave est plus froid que le jour ; on doit le voir avant d'entrer.
 *    C'est le signe qui fait d'un trou noir une CHOSE QUI RESPIRE — l'inquiétude, à trois
 *    tuiles de distance.
 *
 * Aucun de ces quads ne dépasse 2 px monde : à l'échelle du jeu ce sont des points, pas des
 * objets. Ils ne portent aucune lecture, ils font vivre ce qui la porte.
 */
import Phaser from 'phaser'
import { CLIFF_DEPTH, strateDEtage, TILE_PX, ySortDepth } from '../../render/framing'

const GOUTTES_MAX = 4
const POUSSIERE_MAX = 12
const SOUFFLE_MAX = 8
const CHUTE_PX_S = 110
const GOUTTE_HAUTEUR_PX = 26
const GOUTTE = 0xc9d3e6
const POUSSIERE = 0xe8e2d0
const SOUFFLE = 0xdfe6f2
const SOUFFLE_ALPHA = 0.5
const DT_MAX_S = 0.1

interface Goutte { vive: boolean; x: number; y: number; solY: number; ty: number; eclat: number }
interface Grain { vive: boolean; x: number; y: number; vx: number; vy: number; age: number; vie: number; phase: number; ty: number }

/** Une tuile de cave, et son LIFT (en tuiles) : sous une mesa posée au palier `p`, la salle se
 *  dessine `p × LIFT_TUILES` rangées plus haut que sa position logique (spec `terrasses.md`,
 *  T-R7). La position s'en décale ; la profondeur, elle, trie sur la rangée LOGIQUE `ty`. */
export interface TuileDeCave { tx: number; ty: number; lift: number }

function quad(scene: Phaser.Scene, c: number, depth: number): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.5).setTint(c).setDepth(depth).setVisible(false)
}

export class CaveFx {
  private gouttes: Goutte[] = []
  private gouttesImg: Phaser.GameObjects.Image[] = []
  private prochaineGoutte = 0.4
  private poussiere: Grain[] = []
  private poussiereImg: Phaser.GameObjects.Image[] = []
  private souffle: Grain[] = []
  private souffleImg: Phaser.GameObjects.Image[] = []
  private prochainSouffle = 0
  private t = 0

  constructor(private scene: Phaser.Scene) {
    for (let i = 0; i < GOUTTES_MAX; i++) {
      this.gouttes.push({ vive: false, x: 0, y: 0, solY: 0, ty: 0, eclat: 0 })
      this.gouttesImg.push(quad(scene, GOUTTE, 0))
    }
    for (let i = 0; i < POUSSIERE_MAX; i++) {
      this.poussiere.push({ vive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, vie: 1, phase: 0, ty: 0 })
      this.poussiereImg.push(quad(scene, POUSSIERE, 0))
    }
    for (let i = 0; i < SOUFFLE_MAX; i++) {
      this.souffle.push({ vive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, vie: 1, phase: 0, ty: 0 })
      this.souffleImg.push(quad(scene, SOUFFLE, CLIFF_DEPTH + 0.02))
    }
  }

  /** Tout s'éteint : on ne laisse pas une goutte tomber dans le pré quand on ressort. */
  private eteindre(grains: Grain[], imgs: Phaser.GameObjects.Image[]): void {
    for (let i = 0; i < grains.length; i++) { grains[i]!.vive = false; imgs[i]!.setVisible(false) }
  }

  /**
   * `dedans` : le regard est sous la roche. `tuiles` : les tuiles de sol VISIBLES (les gouttes y
   * tombent) ; `gueules` : les gueules visibles, en tuiles — dedans elles portent la poussière du
   * jour, dehors le souffle. `ciel` : la force du jour (pas de poussière dans le noir).
   */
  update(dtMs: number, dedans: boolean, tuiles: readonly TuileDeCave[], gueules: readonly TuileDeCave[], ciel: number): void {
    const dt = Math.min(DT_MAX_S, Math.max(0, dtMs) / 1000)
    this.t += dt
    if (dedans) {
      this.eteindre(this.souffle, this.souffleImg)
      this.gouttesUpdate(dt, tuiles)
      this.poussiereUpdate(dt, gueules, ciel)
    } else {
      for (let i = 0; i < GOUTTES_MAX; i++) { this.gouttes[i]!.vive = false; this.gouttesImg[i]!.setVisible(false) }
      this.eteindre(this.poussiere, this.poussiereImg)
      this.souffleUpdate(dt, gueules)
    }
  }

  private gouttesUpdate(dt: number, tuiles: readonly TuileDeCave[]): void {
    this.prochaineGoutte -= dt
    if (this.prochaineGoutte <= 0 && tuiles.length > 0) {
      this.prochaineGoutte = 0.7 + Math.random() * 2.2
      const g = this.gouttes.find((q) => !q.vive)
      if (g) {
        const t = tuiles[Math.floor(Math.random() * tuiles.length)]!
        g.vive = true
        g.ty = t.ty
        g.x = t.tx * TILE_PX + 3 + Math.floor(Math.random() * 10)
        g.solY = (t.ty - t.lift) * TILE_PX + 3 + Math.floor(Math.random() * 10)
        g.y = g.solY - GOUTTE_HAUTEUR_PX
        g.eclat = 0
      }
    }
    for (let i = 0; i < GOUTTES_MAX; i++) {
      const g = this.gouttes[i]!
      const q = this.gouttesImg[i]!
      if (!g.vive) { q.setVisible(false); continue }
      const depth = strateDEtage(-1) + ySortDepth(g.ty + 1, TILE_PX, 0.5)
      if (g.eclat > 0) {
        // L'éclat : un rond d'un pixel de haut qui s'élargit deux fois, puis rien.
        g.eclat -= dt
        const w = g.eclat > 0.12 ? 3 : 5
        q.setPosition(Math.round(g.x), g.solY).setDisplaySize(w, 1).setAlpha(g.eclat > 0.12 ? 0.55 : 0.3).setDepth(depth).setVisible(true)
        if (g.eclat <= 0) g.vive = false
        continue
      }
      g.y += CHUTE_PX_S * dt
      if (g.y >= g.solY) { g.eclat = 0.24; g.y = g.solY; continue }
      q.setPosition(Math.round(g.x), Math.round(g.y)).setDisplaySize(1, 3).setAlpha(0.6).setDepth(depth).setVisible(true)
    }
  }

  private poussiereUpdate(dt: number, gueules: readonly TuileDeCave[], ciel: number): void {
    if (gueules.length > 0 && ciel > 0.15) {
      for (const p of this.poussiere) {
        if (p.vive) continue
        if (Math.random() > dt * 1.6) continue // ~1,6 naissance par seconde
        const g = gueules[Math.floor(Math.random() * gueules.length)]!
        p.vive = true
        p.age = 0
        p.vie = 3 + Math.random() * 3
        p.phase = Math.random() * 6.28
        p.ty = g.ty
        // La nappe de jour part du seuil et remonte vers le nord : la poussière naît dedans.
        p.x = (g.tx + Math.random()) * TILE_PX
        p.y = (g.ty - g.lift + 0.9 - Math.random() * 2.2) * TILE_PX
        p.vx = (Math.random() - 0.5) * 5
        p.vy = -2 - Math.random() * 3
      }
    }
    for (let i = 0; i < POUSSIERE_MAX; i++) {
      const p = this.poussiere[i]!
      const q = this.poussiereImg[i]!
      if (!p.vive) { q.setVisible(false); continue }
      p.age += dt
      if (p.age >= p.vie) { p.vive = false; q.setVisible(false); continue }
      p.x += (p.vx + Math.sin(this.t * 1.3 + p.phase) * 3) * dt
      p.y += p.vy * dt
      const env = Math.min(1, p.age / 0.6, (p.vie - p.age) / 0.8)
      const sc = 0.5 + 0.5 * Math.sin(this.t * 2.7 + p.phase)
      q.setPosition(Math.round(p.x), Math.round(p.y)).setDisplaySize(1, 1).setAlpha(env * (0.22 + 0.2 * sc) * ciel)
        .setDepth(strateDEtage(-1) + ySortDepth(p.ty + 1, TILE_PX, 0.55)).setVisible(true)
    }
  }

  private souffleUpdate(dt: number, gueules: readonly TuileDeCave[]): void {
    this.prochainSouffle -= dt
    if (this.prochainSouffle <= 0 && gueules.length > 0) {
      this.prochainSouffle = 0.18 + Math.random() * 0.3
      const p = this.souffle.find((s) => !s.vive)
      if (p) {
        const g = gueules[Math.floor(Math.random() * gueules.length)]!
        p.vive = true
        p.age = 0
        p.vie = 1.8 + Math.random() * 1.2
        p.phase = Math.random() * 6.28
        p.ty = g.ty
        // Né dans le bas de la fente, il tombe : l'air froid est plus lourd que le jour.
        p.x = g.tx * TILE_PX + 3 + Math.random() * 10
        p.y = (g.ty - g.lift - 1) * TILE_PX + 10 + Math.random() * 5
        p.vx = (Math.random() - 0.5) * 6
        p.vy = 7 + Math.random() * 6
      }
    }
    for (let i = 0; i < SOUFFLE_MAX; i++) {
      const p = this.souffle[i]!
      const q = this.souffleImg[i]!
      if (!p.vive) { q.setVisible(false); continue }
      p.age += dt
      if (p.age >= p.vie) { p.vive = false; q.setVisible(false); continue }
      p.x += (p.vx + Math.sin(this.t * 2.1 + p.phase) * 4) * dt
      p.y += p.vy * dt
      const env = Math.min(1, p.age / 0.3, (p.vie - p.age) / 0.9)
      // Un grain qui GROSSIT en tombant (l'haleine se déploie) — deux à trois pixels, et un alpha
      // franc : à un pixel et 0,32, il n'existait pas à la capture (une lueur sur du noir).
      const taille = p.age < 0.5 ? 2 : 3
      q.setPosition(Math.round(p.x), Math.round(p.y)).setDisplaySize(taille, taille)
        .setAlpha(env * SOUFFLE_ALPHA).setVisible(true)
    }
  }

  destroy(): void {
    for (const q of this.gouttesImg) q.destroy()
    for (const q of this.poussiereImg) q.destroy()
    for (const q of this.souffleImg) q.destroy()
  }
}
