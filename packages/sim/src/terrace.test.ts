import { describe, expect, it } from 'vitest'
import { TERRACE } from './balance'
import { computeLevel, smoothField } from './terrace'

/** Champ d'altitude en rampe : croît strictement d'ouest en est, de 0 à 1. */
function rampField(w: number, h: number): number[] {
  const f = new Array<number>(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = x / (w - 1)
  return f
}

describe("smoothField", () => {
  it("laisse un champ constant inchangé (aux erreurs d'arrondi près)", () => {
    const w = 16, h = 16
    const flat = new Array<number>(w * h).fill(0.42)
    const out = smoothField(flat, w, h, 3, 2)
    for (const v of out) expect(v).toBeCloseTo(0.42, 10)
  })

  it("ne mute pas son entrée et conserve la longueur", () => {
    const w = 8, h = 8
    const src = rampField(w, h)
    const copy = src.slice()
    const out = smoothField(src, w, h, 2, 1)
    expect(src).toEqual(copy)
    expect(out).toHaveLength(w * h)
  })

  it("atténue un pic isolé", () => {
    const w = 9, h = 9
    const src = new Array<number>(w * h).fill(0)
    src[4 * w + 4] = 1
    const out = smoothField(src, w, h, 2, 1)
    expect(out[4 * w + 4]!).toBeLessThan(0.2)
    expect(out[4 * w + 3]!).toBeGreaterThan(0)
  })
})

describe("computeLevel", () => {
  it("est déterministe : même entrée → même sortie", () => {
    const w = 24, h = 24
    const src = rampField(w, h)
    expect(computeLevel(src, w, h)).toEqual(computeLevel(src, w, h))
  })

  it("borne les paliers dans [0, LEVELS-1]", () => {
    const w = 24, h = 24
    // hors bornes volontaires : le clamp doit tenir
    const src = rampField(w, h).map((v) => v * 1.5 - 0.2)
    for (const l of computeLevel(src, w, h)) {
      expect(l).toBeGreaterThanOrEqual(0)
      expect(l).toBeLessThanOrEqual(TERRACE.LEVELS - 1)
      expect(Number.isInteger(l)).toBe(true)
    }
  })

  it("est monotone : sur une rampe, le palier ne redescend jamais vers l'est", () => {
    const w = 64, h = 8
    const level = computeLevel(rampField(w, h), w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        expect(level[y * w + x]!).toBeGreaterThanOrEqual(level[y * w + x - 1]!)
      }
    }
  })

  it("produit plus d'un palier sur une rampe pleine amplitude", () => {
    const w = 64, h = 4
    const level = computeLevel(rampField(w, h), w, h)
    expect(new Set(level).size).toBeGreaterThan(2)
  })
})
