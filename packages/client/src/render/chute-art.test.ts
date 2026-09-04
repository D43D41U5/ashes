import { describe, expect, it } from 'vitest'
import {
  BLANC,
  CELLULE_PX,
  CHUTE_FRAMES,
  CHUTE_PHASES,
  CHUTE_RANGEES,
  dessinDeChute,
  dessinDEcume,
  ECUME_FRAMES,
  ECUME_RANGEES,
  PAS_CELLULES,
  TONS_CHUTE,
} from './chute-art'
import { CLIFF_TILE_PX, type RectArt } from './cliff-art'

const T = CLIFF_TILE_PX

/** On PEINT et on relit les pixels — la sortie, jamais la liste (cf. `cliff-art.test`). */
function peindre(rects: readonly RectArt[]): Int32Array {
  const px = new Int32Array(T * T).fill(-1)
  for (const r of rects) {
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= T && r.y + r.h <= T, `rect hors tuile : ${JSON.stringify(r)}`).toBe(true)
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px[y * T + x] = r.c
  }
  return px
}

/** La nappe entière (toutes les rangées empilées), en pixels : `nappe[y * T + x]`, y sur
 *  `CHUTE_RANGEES × T` lignes. C'est sur elle que se lit la CHUTE, d'une rangée à l'autre. */
function nappe(frame: number, phase: number): Int32Array {
  const out = new Int32Array(T * T * CHUTE_RANGEES)
  for (let k = 0; k < CHUTE_RANGEES; k++) out.set(peindre(dessinDeChute(k, frame, phase)), k * T * T)
  return out
}

describe('dessinDeChute — la nappe qui remplace la paroi', () => {
  it('est opaque et ne parle que les tons de l’eau', () => {
    for (let k = 0; k < CHUTE_RANGEES; k++) {
      for (let p = 0; p < CHUTE_PHASES; p++) {
        for (let f = 0; f < CHUTE_FRAMES; f++) {
          const px = peindre(dessinDeChute(k, f, p))
          for (let i = 0; i < px.length; i++) {
            expect(px[i], `pixel nu k=${k} f=${f} p=${p} i=${i}`).not.toBe(-1)
            expect(TONS_CHUTE.includes(px[i]!), `ton étranger ${px[i]!.toString(16)}`).toBe(true)
          }
        }
      }
    }
  })

  it('a une lèvre blanche en haut et une écume blanche au pied, à tout pas', () => {
    for (let p = 0; p < CHUTE_PHASES; p++) {
      for (let f = 0; f < CHUTE_FRAMES; f++) {
        const haut = peindre(dessinDeChute(0, f, p))
        const pied = peindre(dessinDeChute(CHUTE_RANGEES - 1, f, p))
        for (let x = 0; x < T; x++) {
          for (let y = 0; y < CELLULE_PX; y++) {
            expect(haut[y * T + x]).toBe(BLANC)
            expect(pied[(T - 1 - y) * T + x]).toBe(BLANC)
          }
        }
      }
    }
  })

  it('TOMBE : d’un pas au suivant, chaque filet descend de PAS_CELLULES cellules', () => {
    const zoneHaut = 2 * CELLULE_PX // sous la lèvre
    const zoneBas = CHUTE_RANGEES * T - 2 * CELLULE_PX // au-dessus de l’écume
    for (let p = 0; p < CHUTE_PHASES; p++) {
      for (let f = 0; f < CHUTE_FRAMES; f++) {
        const a = nappe(f, p)
        const b = nappe((f + 1) % CHUTE_FRAMES, p)
        let compares = 0
        for (let y = zoneHaut + PAS_CELLULES * CELLULE_PX; y < zoneBas; y++) {
          for (let x = 0; x < T; x++) {
            expect(b[y * T + x], `f=${f} p=${p} (${x},${y})`).toBe(a[(y - PAS_CELLULES * CELLULE_PX) * T + x])
            compares++
          }
        }
        expect(compares).toBeGreaterThan(0)
      }
    }
  })

  it('bouge : deux pas consécutifs ne sont jamais la même image', () => {
    for (let p = 0; p < CHUTE_PHASES; p++) {
      for (let f = 0; f < CHUTE_FRAMES; f++) {
        const a = nappe(f, p)
        const b = nappe((f + 1) % CHUTE_FRAMES, p)
        let diff = 0
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
        expect(diff, `f=${f} p=${p}`).toBeGreaterThan(0)
      }
    }
  })

  it('les colonnes traversent les tuiles : quatre phases, quatre dessins', () => {
    const vues = new Set<string>()
    for (let p = 0; p < CHUTE_PHASES; p++) vues.add(Array.from(nappe(0, p)).join(','))
    expect(vues.size).toBe(CHUTE_PHASES)
  })
})

describe('dessinDEcume — l’écume posée sur l’eau du bas', () => {
  it('est blanche, translucide par crans, et laisse l’eau nue au-delà de ECUME_RANGEES', () => {
    for (let p = 0; p < CHUTE_PHASES; p++) {
      for (let f = 0; f < ECUME_FRAMES; f++) {
        const rects = dessinDEcume(f, p)
        expect(rects.length).toBeGreaterThan(0)
        for (const r of rects) {
          expect(r.c).toBe(BLANC)
          expect(r.a).toBeDefined()
          expect(r.a!).toBeGreaterThan(0)
          expect(r.a!).toBeLessThanOrEqual(0.85)
          expect(r.y + r.h).toBeLessThanOrEqual(ECUME_RANGEES * CELLULE_PX)
        }
      }
    }
  })

  it('la première cellule est pleine aux trois quarts au moins, la seconde à moitié environ', () => {
    let pleines0 = 0
    let pleines1 = 0
    const total = CHUTE_PHASES * ECUME_FRAMES * (T / CELLULE_PX)
    for (let p = 0; p < CHUTE_PHASES; p++) {
      for (let f = 0; f < ECUME_FRAMES; f++) {
        for (const r of dessinDEcume(f, p)) {
          if (r.y === 0) pleines0++
          if (r.y === CELLULE_PX) pleines1++
        }
      }
    }
    expect(pleines0 / total).toBeGreaterThan(0.6)
    expect(pleines1 / total).toBeGreaterThan(0.3)
    expect(pleines1 / total).toBeLessThan(0.7)
  })

  it('les bulles dérivent : deux pas consécutifs diffèrent', () => {
    for (let f = 0; f < ECUME_FRAMES; f++) {
      const a = JSON.stringify(dessinDEcume(f, 0))
      const b = JSON.stringify(dessinDEcume((f + 1) % ECUME_FRAMES, 0))
      expect(a).not.toBe(b)
    }
  })
})
