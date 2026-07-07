import { describe, expect, it } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { renderVignette } from './vignette'

describe('renderVignette', () => {
  it('produit un buffer RGB déterministe aux bonnes dimensions', () => {
    const map = generateAlpineTerrain(200, 300, 9)
    const a = renderVignette(map, 100)
    const b = renderVignette(map, 100)
    expect(a.w).toBeGreaterThan(0)
    expect(a.h).toBeGreaterThan(a.w) // 300 > 200 → plus haut que large
    expect(a.rgb.length).toBe(a.w * a.h * 3)
    expect(Array.from(a.rgb)).toEqual(Array.from(b.rgb))
    // pas un buffer uniforme (il se passe quelque chose)
    expect(a.rgb.some((v) => v !== a.rgb[0])).toBe(true)
  })
})
