/**
 * ═══ LES SILHOUETTES DES CARTES (LG-R8 : « sa silhouette est la vraie : alpha ≥ 128 ») ═══
 *
 * Pour projeter l'ombre d'un arbre, l'oracle lit la silhouette de son fût et de sa cime — LA VRAIE, celle
 * de la texture que la vue vient de poser, au seuil de la spec : opaque où alpha ≥ 128, transparent
 * ailleurs. Elle se dérive une fois par clé, en relisant l'image source de la texture par un canvas, et
 * reste en cache pour la session : les textures d'arbres sont cuites une fois (`arbre-art.ts`), elles ne
 * bougent plus.
 *
 * Il n'y a PAS de texture dérivée : la chaîne GPU ne dessine pas les cartes, elle lit le masque que
 * l'oracle rastérise depuis ces octets (`ChampGpu.ecrireLesCartes`, qui dit pourquoi).
 */
import type Phaser from 'phaser'
import type { Silhouette } from './champ-ref'

export class Silhouettes {
  private readonly parCle = new Map<string, Silhouette | null>()

  constructor(private readonly scene: Phaser.Scene) {}

  /** La silhouette de la texture `cle`, dérivée à la première demande ; `null` si la texture ne se lit pas. */
  prendre(cle: string): Silhouette | null {
    const memo = this.parCle.get(cle)
    if (memo !== undefined) return memo
    const d = this.deriver(cle)
    this.parCle.set(cle, d)
    return d
  }

  private deriver(cle: string): Silhouette | null {
    const tm = this.scene.textures
    if (!tm.exists(cle)) return null
    const source = tm.get(cle).source[0]
    if (!source) return null
    const w = source.width
    const h = source.height
    if (!(w > 0 && h > 0)) return null
    let lu: Uint8ClampedArray
    try {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(source.image as CanvasImageSource, 0, 0)
      lu = ctx.getImageData(0, 0, w, h).data
    } catch {
      return null
    }
    const opaque = new Uint8Array(w * h)
    for (let k = 0; k < w * h; k++) opaque[k] = lu[k * 4 + 3]! >= 128 ? 1 : 0
    return { w, h, opaque }
  }

  /** Le cache repart de zéro. */
  destroy(): void {
    this.parCle.clear()
  }
}
