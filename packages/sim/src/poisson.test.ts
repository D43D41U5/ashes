import { describe, it, expect } from 'vitest'
import { poissonPoints } from './poisson'

const minPairDist = (pts: {x:number,y:number}[]): number => {
  let m = Infinity
  for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) {
    const dx=pts[i]!.x-pts[j]!.x, dy=pts[i]!.y-pts[j]!.y
    m = Math.min(m, Math.sqrt(dx*dx+dy*dy))
  }
  return m
}

describe('poissonPoints (bruit bleu)', () => {
  it('aucun couple à moins de radius (invariant blue-noise)', () => {
    const pts = poissonPoints(400, 600, 7, 40)
    expect(pts.length).toBeGreaterThan(10)
    expect(minPairDist(pts)).toBeGreaterThanOrEqual(40 - 1e-6)
  })
  it('déterministe : même seed → mêmes points', () => {
    const a = poissonPoints(400, 600, 7, 40)
    const b = poissonPoints(400, 600, 7, 40)
    expect(a).toEqual(b)
    const c = poissonPoints(400, 600, 8, 40)
    expect(c).not.toEqual(a)
  })
  it('densité ∝ surface : ~4× plus de points pour 2× chaque dimension', () => {
    const small = poissonPoints(200, 300, 5, 30).length
    const big = poissonPoints(400, 600, 5, 30).length
    expect(big).toBeGreaterThan(small * 3)
    expect(big).toBeLessThan(small * 5)
  })
  it('tous les points dans les bornes', () => {
    for (const p of poissonPoints(400, 600, 7, 40)) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThan(400)
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThan(600)
    }
  })
})
