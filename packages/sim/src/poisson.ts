/**
 * Semis en bruit bleu (Bridson) — PUR et déterministe : l'aléa vient de hash2,
 * le candidat dans l'anneau [r,2r] est tiré par reject-sampling dans un carré
 * (aucune trigonométrie). Garantit : aucun couple de points à moins de `radius`.
 */
import { hash2 } from './noise'

export function poissonPoints(width: number, height: number, seed: number, radius: number, k = 30): { x: number; y: number }[] {
  const cell = radius * Math.sqrt(0.5) // r/√2 : au plus un point par cellule
  const gw = Math.ceil(width / cell)
  const gh = Math.ceil(height / cell)
  const grid = new Int32Array(gw * gh).fill(-1)
  const pts: { x: number; y: number }[] = []
  const active: number[] = []
  let draws = 0
  const rand = (): number => hash2(draws++, seed, 0x504f49) // salt 'POI'

  const gset = (i: number): void => {
    const gx = Math.floor(pts[i]!.x / cell)
    const gy = Math.floor(pts[i]!.y / cell)
    grid[gy * gw + gx] = i
  }
  const farEnough = (x: number, y: number): boolean => {
    const gx = Math.floor(x / cell)
    const gy = Math.floor(y / cell)
    for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
      for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
        const i = grid[yy * gw + xx]!
        if (i < 0) continue
        const dx = pts[i]!.x - x
        const dy = pts[i]!.y - y
        if (dx * dx + dy * dy < radius * radius) return false
      }
    }
    return true
  }

  pts.push({ x: rand() * width, y: rand() * height })
  active.push(0)
  gset(0)

  while (active.length > 0) {
    const ai = Math.floor(rand() * active.length)
    const p = pts[active[ai]!]!
    let found = false
    for (let i = 0; i < k; i++) {
      let cx = 0, cy = 0, d2 = 0
      let guard = 0
      do {
        cx = (rand() * 4 - 2) * radius
        cy = (rand() * 4 - 2) * radius
        d2 = cx * cx + cy * cy
        guard++
      } while ((d2 < radius * radius || d2 > 4 * radius * radius) && guard < 16)
      const nx = p.x + cx
      const ny = p.y + cy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if (farEnough(nx, ny)) {
        pts.push({ x: nx, y: ny })
        active.push(pts.length - 1)
        gset(pts.length - 1)
        found = true
        break
      }
    }
    if (!found) active.splice(ai, 1)
  }
  return pts
}
