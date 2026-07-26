/**
 * LES FX DE L'EAU — textures bakées une fois au boot (spec eau-vivante R5, R7).
 *
 * Trois familles, toutes dans la grammaire FX maison (cellules de 4 px, NEAREST,
 * paliers d'alpha francs — jamais un dégradé) :
 *   • fx-flottaison-0..2 — l'ANNEAU d'ondulation qui ceint un acteur immergé (3 phases
 *     de rayon, ellipse pointillée écrasée comme les remous du shader — YSQUASH) ;
 *   • fx-plouf-0..4 — la GERBE d'entrée dans l'eau : colonne centrale exagérée +
 *     gouttes discrètes de 1-2 cellules retombant en arc, SURJOUÉE (la grammaire de
 *     Medeiros : un splash timide ne se lit pas) ;
 *   • fx-empreinte — le pas MOUILLÉ : une semelle sombre, l'alpha vit sur l'Image.
 */
import Phaser from 'phaser'

const G = 4

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

function nearest(scene: Phaser.Scene, key: string, cv: HTMLCanvasElement): void {
  scene.textures.addCanvas(key, cv)
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

export function ensureEauFxTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-flottaison-0')) return

  // ── L'ANNEAU DE FLOTTAISON : ellipse pointillée, 3 phases de rayon ──
  for (let k = 0; k < 3; k++) {
    const W = 36
    const H = 16
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const rx = 14 * (0.82 + 0.16 * k)
    const ry = rx * 0.42
    for (let cy = 0; cy < H / G; cy++) {
      for (let cx = 0; cx < W / G; cx++) {
        const dx = cx * G + G / 2 - W / 2
        const dy = cy * G + G / 2 - H / 2
        const rr = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
        if (Math.abs(rr - 1) > 0.34) continue
        if (hache(cx, cy, 7 + k) < 0.2) continue // pointillée : l'anneau respire
        const clair = rr < 1 // le bord intérieur (l'eau soulevée) est le plus clair
        ctx.fillStyle = clair ? 'rgba(226,238,246,0.9)' : 'rgba(198,216,230,0.55)'
        ctx.fillRect(cx * G, cy * G, G, G)
      }
    }
    nearest(scene, `fx-flottaison-${k}`, cv)
  }

  // ── LA GERBE : 5 frames — la colonne monte puis s'effondre, les gouttes s'évasent ──
  const COLONNE = [8, 14, 12, 7, 3] // hauteur px de la colonne par frame
  for (let f = 0; f < 5; f++) {
    const W = 28
    const H = 24
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const base = H - 2 // le pied de la gerbe (posé à la ligne de flottaison)
    // la colonne centrale : 2 cellules de large, blanche au cœur
    const hCol = COLONNE[f]!
    ctx.fillStyle = 'rgba(232,244,252,0.95)'
    ctx.fillRect(W / 2 - G, base - hCol, G * 2, hCol)
    if (hCol > 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.fillRect(W / 2 - G / 2 - 1, base - hCol, G, Math.max(2, hCol - 4))
    }
    // les gouttes : elles partent du sommet et retombent en arc en s'écartant
    const n = 3 + f
    for (let g = 0; g < n; g++) {
      const cote = g % 2 === 0 ? 1 : -1
      const evase = (2 + f * 2.6) * (0.6 + 0.5 * hache(g, f, 21))
      const gx = W / 2 + cote * evase
      const montee = hCol + 3 - (f >= 2 ? (f - 1) * 3 : 0) - hache(g, f, 22) * 4
      const gy = base - Math.max(1, montee)
      ctx.fillStyle = g % 3 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(214,232,244,0.8)'
      const taille = f < 3 ? 2 : 1
      ctx.fillRect(Math.round(gx), Math.round(gy), taille, taille)
    }
    nearest(scene, `fx-plouf-${f}`, cv)
  }

  // ── L'EMPREINTE MOUILLÉE : une semelle sombre 4×6 (2 tons) — l'alpha vit sur l'Image ──
  {
    const cv = document.createElement('canvas')
    cv.width = 4
    cv.height = 6
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = 'rgba(20,16,10,0.85)'
    ctx.fillRect(0, 0, 4, 4)
    ctx.fillStyle = 'rgba(20,16,10,0.6)'
    ctx.fillRect(0, 4, 4, 2)
    nearest(scene, 'fx-empreinte', cv)
  }
}
