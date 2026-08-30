/**
 * LE PEINTRE — l'API de dessin COMMUNE aux deux backends d'art du projet.
 *
 * L'art « en code » du jeu se peint via `Phaser.GameObjects.Graphics` (puis `generateTexture`),
 * mais la recette `_lit` (normal-map.ts) exige un CANVAS LISIBLE (`getImageData`) — la relecture
 * d'une texture Phaser générée est incertaine en WebGL. Jusqu'ici, chaque sprite basculé devait
 * donc être REDESSINÉ en Canvas2D (les silhouettes partagées de `lit-props` : CHAMPIGNON_RECTS…),
 * ce qui plafonnait la bascule aux sprites qu'on acceptait de dupliquer.
 *
 * Ce module retourne le problème : au lieu de partager les DONNÉES du dessin, on partage son
 * ÉCRITURE. `Peintre` est le sous-ensemble structurel de l'API Graphics que l'art du projet
 * utilise réellement (fillStyle/fillRect/fillCircle/fillEllipse/fillTriangle/lineStyle/
 * strokeCircle) ; un dessin écrit contre lui se rejoue tel quel sur un vrai `Graphics` (qui le
 * satisfait par structure) ET sur `PeintreCanvas` — le même code, donc flat et `_lit` NE PEUVENT
 * PAS diverger, par construction et non par discipline.
 *
 * Sémantique Phaser, à l'identique : `fillEllipse(x, y, w, h)` prend le CENTRE et les DIAMÈTRES ;
 * `fillCircle(x, y, r)` le centre et le rayon ; les couleurs sont des 0xRRGGBB, l'alpha à part.
 */

export interface Peintre {
  fillStyle(color: number, alpha?: number): this
  fillRect(x: number, y: number, width: number, height: number): this
  fillCircle(x: number, y: number, radius: number): this
  /** ⚠ `width`/`height` sont les DIAMÈTRES (convention Phaser), pas les rayons. */
  fillEllipse(x: number, y: number, width: number, height: number): this
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this
  lineStyle(width: number, color: number, alpha?: number): this
  strokeCircle(x: number, y: number, radius: number): this
}

const css = (color: number, alpha: number): string =>
  `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`

/** Le backend Canvas2D : rejoue un dessin `Peintre` sur un contexte lisible — la matière
 *  première d'un `registerLitPaire`. */
export class PeintreCanvas implements Peintre {
  private largeurDeTrait = 1

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  fillStyle(color: number, alpha = 1): this {
    this.ctx.fillStyle = css(color, alpha)
    return this
  }

  fillRect(x: number, y: number, width: number, height: number): this {
    this.ctx.fillRect(x, y, width, height)
    return this
  }

  fillCircle(x: number, y: number, radius: number): this {
    this.ctx.beginPath()
    this.ctx.arc(x, y, radius, 0, Math.PI * 2)
    this.ctx.fill()
    return this
  }

  fillEllipse(x: number, y: number, width: number, height: number): this {
    this.ctx.beginPath()
    this.ctx.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2)
    this.ctx.fill()
    return this
  }

  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this {
    this.ctx.beginPath()
    this.ctx.moveTo(x0, y0)
    this.ctx.lineTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.closePath()
    this.ctx.fill()
    return this
  }

  lineStyle(width: number, color: number, alpha = 1): this {
    this.largeurDeTrait = width
    this.ctx.strokeStyle = css(color, alpha)
    return this
  }

  strokeCircle(x: number, y: number, radius: number): this {
    this.ctx.lineWidth = this.largeurDeTrait
    this.ctx.beginPath()
    this.ctx.arc(x, y, radius, 0, Math.PI * 2)
    this.ctx.stroke()
    return this
  }
}
