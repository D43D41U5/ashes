/**
 * LA TROUÉE — le découvert appliqué aux SOLS CUITS PAR CHUNK (pavés, manteau de gel), spec
 * `terrasses.md` T-R9 ; Alexis, 2026-09-05 : « fais la même chose pour les falaises des
 * terrasses ».
 *
 * Le chapeau d'une mesa se pose tuile par tuile (`etage-layer`), et chaque tuile porte son alpha
 * de découvert. Le sol d'une TERRASSE, lui, est une seule image de 258 px par palier et par chunk
 * (`pave-layer`, `gel-layer`) : on ne peut pas lui donner un alpha par tuile — et lui donner un
 * alpha global fondrait seize tuiles de côté pour un corps d'une tuile et demie. Le disque de
 * découvert est donc CREUSÉ DANS L'IMAGE : pour chaque tuile du palier haut à portée du corps, un
 * carré de 16 px effacé de `1 − alpha` (`destination-out`, sur le canvas de la texture), puis la
 * texture est renvoyée au GPU. MESURÉ (smoke `terrasse-nord`, graine 2026, avant) : le corps à
 * palier 0 sous la rangée nord d'une terrasse de palier 1 disparaissait en entier derrière
 * `pave-…-p1`, alpha 1 — la promesse T-R9 n'était tenue que par les nœuds et le décor.
 *
 * L'ORIGINAL SE RELÈVE ET SE REND. Au premier coup de trouée sur une texture, on lit ses pixels
 * (`getImageData`) et on les garde ; chaque image suivante repart de cet original (rien ne
 * s'accumule), et quand la trouée quitte la texture on le repose et on l'oublie. Une texture que
 * la couche détruit ou recuit doit d'abord passer par `oublier` — l'original d'hier n'est plus
 * celui de la nouvelle cuisson. Rien n'est recomposé quand le regard n'a pas bougé (`signature`).
 *
 * ⚠ `refresh()` REMET LINEAR (vu sur le champ d'eau) : on repose NEAREST après chaque envoi.
 *
 * AUCUNE logique de jeu — rendu pur d'un état reçu.
 */
import Phaser from 'phaser'
import { LIFT_TUILES, PLATEAU_R_OUT, alphaDeDecouvert, type Decouvert } from '../../render/framing'
import { PAVE, PAVE_PX } from '../../render/paves'
import type { Relief } from '../../render/relief'

/** Ce que la trouée retient d'une texture qu'elle a touchée. */
interface Touchee {
  original: ImageData
  /** Le découvert qui a composé l'image en place — pour ne pas recomposer à l'identique. */
  signature: string
}

export class Trouee {
  private readonly touchees = new Map<string, Touchee>()

  constructor(private readonly scene: Phaser.Scene, private readonly relief: Relief) {}

  /**
   * Applique (ou retire) la trouée à la texture `cle`, qui est la part du palier `palier` du chunk
   * `(cx, cy)`. Rend `true` si la texture est trouée à la sortie. À appeler à chaque image pour
   * chaque part vivante d'un palier plus haut que le regard — la fonction décide elle-même si
   * le disque la touche.
   */
  appliquer(cle: string, cx: number, cy: number, palier: number, decouvert: Decouvert | null): boolean {
    const touchee = this.touchees.get(cle)
    if (decouvert === null || decouvert.ouverture <= 0 || palier <= decouvert.niveau || !this.aPortee(cx, cy, palier, decouvert)) {
      if (touchee) this.reposer(cle, touchee)
      return false
    }
    const signature = `${decouvert.x}|${decouvert.y}|${decouvert.niveau}|${decouvert.ouverture}`
    if (touchee && touchee.signature === signature) return true
    const tex = this.scene.textures.get(cle)
    if (!(tex instanceof Phaser.Textures.CanvasTexture)) return false
    const ctx = tex.getContext()
    const S = tex.width
    let original = touchee?.original
    if (!original) original = ctx.getImageData(0, 0, S, S)
    else ctx.putImageData(original, 0, 0)
    this.creuser(ctx, cx, cy, palier, decouvert)
    this.envoyer(tex)
    this.touchees.set(cle, { original, signature })
    return true
  }

  /** La texture va être détruite ou recuite : son original ne vaut plus rien. */
  oublier(cle: string): void {
    this.touchees.delete(cle)
  }

  /** Combien de textures sont trouées à cet instant — la sonde du smoke. */
  get actives(): number {
    return this.touchees.size
  }

  /**
   * Le disque, en tuiles LOGIQUES de ce palier, touche-t-il le chunk ? Une tuile `(tx, ty)` du
   * palier `p` se dessine en `ty − p × LIFT` : le centre du disque, exprimé dans les rangées
   * logiques du palier, est donc `LIFT × p` rangées plus au SUD que le centre dessiné.
   */
  private aPortee(cx: number, cy: number, palier: number, d: Decouvert): boolean {
    const N = PAVE.CHUNK
    const r = PLATEAU_R_OUT + 1
    const yl = d.y + palier * LIFT_TUILES
    return d.x + r > cx * N && d.x - r < (cx + 1) * N && yl + r > cy * N && yl - r < (cy + 1) * N
  }

  private creuser(ctx: CanvasRenderingContext2D, cx: number, cy: number, palier: number, d: Decouvert): void {
    const N = PAVE.CHUNK
    const P = PAVE_PX
    const B = PAVE.BAVE
    const L = LIFT_TUILES
    const r = Math.ceil(PLATEAU_R_OUT + 1)
    const yl = d.y + palier * L
    const tx0 = Math.max(cx * N, Math.floor(d.x - r))
    const tx1 = Math.min((cx + 1) * N - 1, Math.ceil(d.x + r))
    const ty0 = Math.max(cy * N, Math.floor(yl - r))
    const ty1 = Math.min((cy + 1) * N - 1, Math.ceil(yl + r))
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        // Les tuiles de CE palier, et sans chapeau : sous une mesa, c'est le chapeau qui cède et
        // son socle qui bouche (`etage-layer`) — le pavé du dessous n'a rien à faire.
        if (this.relief.palier(tx, ty) !== palier || this.relief.chapeau(tx, ty)) continue
        const a = alphaDeDecouvert(d, tx + 0.5, ty - palier * L + 0.5, palier)
        if (a >= 1) continue
        // Le carré de la tuile dans l'image, débord compris : une tuile au bord du chunk emporte
        // le pixel de bave (il est à elle, recopié pour la couture).
        const lx = tx - cx * N
        const ly = ty - cy * N
        const x0 = lx * P + B - (lx === 0 ? B : 0)
        const y0 = ly * P + B - (ly === 0 ? B : 0)
        const x1 = (lx + 1) * P + B + (lx === N - 1 ? B : 0)
        const y1 = (ly + 1) * P + B + (ly === N - 1 ? B : 0)
        ctx.globalAlpha = 1 - a
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      }
    }
    ctx.restore()
  }

  private reposer(cle: string, t: Touchee): void {
    this.touchees.delete(cle)
    const tex = this.scene.textures.get(cle)
    if (!(tex instanceof Phaser.Textures.CanvasTexture)) return
    tex.getContext().putImageData(t.original, 0, 0)
    this.envoyer(tex)
  }

  private envoyer(tex: Phaser.Textures.CanvasTexture): void {
    tex.refresh()
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
  }

  destroy(): void {
    this.touchees.clear()
  }
}
