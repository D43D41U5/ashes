import { describe, expect, it } from 'vitest'
import { ambientTint, canopyDensity, canopyStrength, daylight, fireGlow, warmthColor, NIGHT_ALPHA_MAX } from './lighting'

const r = (c: number): number => (c >> 16) & 0xff
const b = (c: number): number => c & 0xff

describe('warmthColor (convention Feu existante)', () => {
  it('warmth positif → bleu (Foyer)', () => {
    const c = warmthColor(80)
    expect(b(c)).toBeGreaterThan(r(c))
  })
  it('warmth négatif → rouge (Meute)', () => {
    const c = warmthColor(-80)
    expect(r(c)).toBeGreaterThan(b(c))
  })
  it('warmth nul → blanc', () => {
    expect(warmthColor(0)).toBe(0xffffff)
  })
})

describe('daylight (facteur de lumière du jour)', () => {
  it('borné dans [0,1]', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = daylight(h)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
  it('≈ 0 à minuit, ≈ 1 à midi', () => {
    expect(daylight(0)).toBeCloseTo(0, 5)
    expect(daylight(12)).toBeCloseTo(1, 5)
  })
  it('croît (au sens large) de minuit vers midi', () => {
    let prev = -1
    for (const h of [0, 3, 6, 9, 12]) {
      const d = daylight(h)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})

describe('canopyDensity / canopyStrength', () => {
  it('forêt > marais > ciel ouvert', () => {
    expect(canopyDensity(3)).toBeGreaterThan(canopyDensity(8))
    expect(canopyDensity(8)).toBeGreaterThan(canopyDensity(1))
    expect(canopyDensity(1)).toBe(0)
  })
  it('la canopée est plus opaque de jour que de nuit', () => {
    expect(canopyStrength(1)).toBeGreaterThan(canopyStrength(0))
  })
})

describe('ambientTint (teinte selon l\'heure)', () => {
  it('midi : aucune teinte (alpha ≈ 0)', () => {
    expect(ambientTint(12).alpha).toBeCloseTo(0, 2)
  })
  it('nuit profonde : alpha au plafond, couleur bleue froide', () => {
    const t = ambientTint(0)
    expect(t.alpha).toBeCloseTo(NIGHT_ALPHA_MAX, 5)
    expect(t.color & 0xff).toBeGreaterThan((t.color >> 16) & 0xff) // bleu > rouge
  })
  it('alpha ne dépasse jamais le plafond de nuit', () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(ambientTint(h).alpha).toBeLessThanOrEqual(NIGHT_ALPHA_MAX + 1e-9)
    }
  })
  it('aube (6 h) et crépuscule (20 h) : teinte chaude, alpha intermédiaire', () => {
    for (const h of [6, 20]) {
      const t = ambientTint(h)
      expect((t.color >> 16) & 0xff).toBeGreaterThan(t.color & 0xff) // rouge > bleu (chaud)
      expect(t.alpha).toBeGreaterThan(0)
      expect(t.alpha).toBeLessThan(NIGHT_ALPHA_MAX)
    }
  })
})

describe('fireGlow (halo des Feux)', () => {
  it("brille la nuit, s'éteint à midi", () => {
    const night = fireGlow(0, daylight(0))
    const noon = fireGlow(0, daylight(12))
    expect(night.alpha).toBeGreaterThan(noon.alpha)
    expect(noon.alpha).toBeCloseTo(0, 5)
  })
  it('couleur = alignement (Foyer bleu, Meute rouge)', () => {
    const foyer = fireGlow(80, daylight(0)).color
    const meute = fireGlow(-80, daylight(0)).color
    expect(foyer & 0xff).toBeGreaterThan((foyer >> 16) & 0xff) // bleu > rouge
    expect((meute >> 16) & 0xff).toBeGreaterThan(meute & 0xff) // rouge > bleu
  })
  it('un Feu plus engagé rayonne plus loin', () => {
    expect(fireGlow(90, daylight(0)).radius).toBeGreaterThan(fireGlow(10, daylight(0)).radius)
  })
})
