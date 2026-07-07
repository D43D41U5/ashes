import { describe, expect, it } from 'vitest'
import { createEmptyMap } from '@braises/sim'
import {
  ambientTint,
  canopyDensity,
  canopyStrength,
  canopyVignette,
  daylight,
  fireGlow,
  sampleCanopyCoverage,
  warmthColor,
  NIGHT_ALPHA_MAX,
} from './lighting'

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

describe('sampleCanopyCoverage (couverture continue au point joueur)', () => {
  // Codes terrain : 1 = herbe (ciel ouvert), 3 = forêt.
  it('ciel ouvert partout → 0', () => {
    const map = createEmptyMap(10, 10, 1)
    expect(sampleCanopyCoverage(map, 5.5, 5.5)).toBe(0)
  })
  it('forêt partout → densité de la forêt au centre d\'une tuile', () => {
    const map = createEmptyMap(10, 10, 3)
    expect(sampleCanopyCoverage(map, 5.5, 5.5)).toBeCloseTo(canopyDensity(3), 5)
  })
  it('bordure herbe→forêt : transition continue, pas de saut', () => {
    // Colonnes x < 5 en herbe (1), x ≥ 5 en forêt (3).
    const map = createEmptyMap(10, 10, 1)
    for (let ty = 0; ty < 10; ty++) for (let tx = 5; tx < 10; tx++) map.terrain[ty * 10 + tx] = 3
    const cov = (x: number): number => sampleCanopyCoverage(map, x, 5.5)
    expect(cov(4.5)).toBe(0) // centre d'une tuile d'herbe
    expect(cov(5.5)).toBeCloseTo(canopyDensity(3), 5) // centre d'une tuile de forêt
    const mid = cov(5.0) // pile sur la bordure
    expect(mid).toBeGreaterThan(cov(4.5))
    expect(mid).toBeLessThan(cov(5.5)) // valeur intermédiaire ⇒ interpolée, pas en marche d'escalier
  })
})

describe('canopyVignette (voile écran de sous-bois)', () => {
  it('aucune couverture → aucun voile, de jour comme de nuit', () => {
    expect(canopyVignette(0, 1).alpha).toBe(0)
    expect(canopyVignette(0, 0).alpha).toBe(0)
  })
  it('plus de couverture → voile plus opaque et halo plus resserré', () => {
    const light = canopyVignette(0.2, 1)
    const dense = canopyVignette(0.9, 1)
    expect(dense.alpha).toBeGreaterThan(light.alpha)
    expect(dense.tightness).toBeGreaterThan(light.tightness)
  })
  it('présent de nuit (enfermement ressenti), un peu plus fort de jour', () => {
    const day = canopyVignette(1, 1)
    const night = canopyVignette(1, 0)
    expect(day.alpha).toBeGreaterThan(night.alpha) // souffle diurne conservé
    expect(night.alpha).toBeGreaterThan(0.3) // plancher HAUT : le sous-bois reste nettement sombre la nuit
  })
  it('alpha et tightness bornés dans [0,1]', () => {
    for (const cov of [-1, 0, 0.3, 1, 2]) {
      for (const d of [0, 0.5, 1]) {
        const v = canopyVignette(cov, d)
        expect(v.alpha).toBeGreaterThanOrEqual(0)
        expect(v.alpha).toBeLessThanOrEqual(1)
        expect(v.tightness).toBeGreaterThanOrEqual(0)
        expect(v.tightness).toBeLessThanOrEqual(1)
      }
    }
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
