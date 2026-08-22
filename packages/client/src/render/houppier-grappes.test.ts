/**
 * LA CIME EN GRAPPES — les gardes (décision d'Alexis, 2026-08-22).
 *
 * Sur les ONZE variantes × CINQ graines (les mêmes que `lit-trees.ts` : 11 + cime × 7919), ce qui
 * doit rester vrai : la cime tient dans sa boîte et s'assoit sur le fût (V3 du 07-29 ne flotte pas),
 * elle est d'UN SEUL tenant, elle porte au moins trois tons, elle est déterministe, et les cinq
 * graines donnent cinq cimes. Et pour les feuillus, LA CIME NUE EST DÉRIVÉE : chaque touffe a sa
 * branche — le centre de chaque grappe est du bois — et le bois part du sommet du fût.
 */
import { describe, expect, it } from 'vitest'
import { TOUTES_VARIANTES, VARIANTES_CADUQUES, CIMES_PAR_ARBRE, houppierLargeur } from './arbre-art'
import { FORME_PAR_VARIANTE, PORT_PAR_VARIANTE, centresDe, cimeEnGrappes, cimeNue, grappesDe, type GrainHouppier } from './houppier-grappes'

const GRAINES = Array.from({ length: CIMES_PAR_ARBRE }, (_, c) => 11 + c * 7919)

function composantes(g: GrainHouppier, W: number, H: number): number {
  const vu = new Uint8Array(W * H)
  let n = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!g.opaque(x, y) || vu[y * W + x]) continue
    n++
    const file = [y * W + x]
    vu[y * W + x] = 1
    while (file.length) {
      const i = file.pop()!
      const px = i % W, py = (i - px) / W
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = px + dx, ny = py + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (vu[j] || !g.opaque(nx, ny)) continue
        vu[j] = 1; file.push(j)
      }
    }
  }
  return n
}
const masse = (g: GrainHouppier, W: number, H: number): number => {
  let n = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.opaque(x, y)) n++
  return n / (W * H)
}

describe('la cime en grappes — onze variantes, cinq graines', () => {
  it('chaque variante a une forme et chaque feuillu un port', () => {
    for (const v of TOUTES_VARIANTES) expect(FORME_PAR_VARIANTE[v.slug], v.slug).toBeDefined()
    for (const slug of VARIANTES_CADUQUES) expect(PORT_PAR_VARIANTE[slug], slug).toBeDefined()
  })

  it('les grappes tiennent dans la boîte et la plus basse touche le bas (l’assise, V3)', () => {
    for (const v of TOUTES_VARIANTES) for (const graine of GRAINES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const et = grappesDe(W, H, FORME_PAR_VARIANTE[v.slug]!, graine)
      expect(et.length).toBeGreaterThanOrEqual(8)
      for (const g of et) {
        expect(g.x0).toBeGreaterThanOrEqual(0); expect(g.x1).toBeLessThanOrEqual(W)
        expect(g.y0).toBeGreaterThanOrEqual(0); expect(g.y1).toBeLessThanOrEqual(H)
        expect(g.x1 - g.x0).toBeGreaterThan(4); expect(g.y1 - g.y0).toBeGreaterThan(4)
      }
      expect(Math.max(...et.map((g) => g.y1)), `${v.slug} g${graine} : la cime flotte`).toBe(H)
      // l'assise : une grappe couvre le sommet du fût (la colonne, au centre)
      const cx = W / 2
      expect(et.some((g) => g.y1 === H && g.x0 <= cx - 3 && g.x1 >= cx + 3), `${v.slug} g${graine} : rien n'assoit la cime sur le fût`).toBe(true)
    }
  })

  it('la cime est d’un seul tenant, opaque dans sa boîte, et couvre au moins 40 % de la boîte', () => {
    for (const v of TOUTES_VARIANTES) for (const graine of GRAINES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const g = cimeEnGrappes(W, H, FORME_PAR_VARIANTE[v.slug]!, v.tons, graine)
      expect(composantes(g, W, H), `${v.slug} g${graine} : cime en morceaux`).toBe(1)
      expect(masse(g, W, H), `${v.slug} g${graine} : cime trop creuse`).toBeGreaterThan(0.38)
      expect(g.opaque(-1, 0)).toBe(false); expect(g.opaque(W, 0)).toBe(false)
      // la dernière rangée est occupée au centre : la cime s'assoit sur le fût
      expect(g.opaque(Math.floor(W / 2), H - 1), `${v.slug} g${graine} : la cime ne touche pas le fût`).toBe(true)
    }
  })

  it('au moins trois tons, un relief qui varie, et le ton est toujours un rgb()', () => {
    for (const v of TOUTES_VARIANTES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const g = cimeEnGrappes(W, H, FORME_PAR_VARIANTE[v.slug]!, v.tons, GRAINES[0]!)
      const tons = new Set<string>()
      let rMin = 1, rMax = 0
      for (let i = 0; i < W * H; i++) {
        const t = g.ton[i]
        if (t === null || t === undefined) { expect(g.relief[i]).toBe(0); continue }
        expect(t).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
        tons.add(t)
        rMin = Math.min(rMin, g.relief[i]!); rMax = Math.max(rMax, g.relief[i]!)
      }
      expect(tons.size, v.slug).toBeGreaterThanOrEqual(3)
      expect(rMax - rMin, `${v.slug} : relief plat`).toBeGreaterThan(0.1)
    }
  })

  it('déterministe, et cinq graines donnent cinq cimes', () => {
    for (const v of TOUTES_VARIANTES) {
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const forme = FORME_PAR_VARIANTE[v.slug]!
      const a = cimeEnGrappes(W, H, forme, v.tons, GRAINES[0]!), b = cimeEnGrappes(W, H, forme, v.tons, GRAINES[0]!)
      expect(a.ton).toEqual(b.ton)
      const empreintes = new Set(GRAINES.map((gr) => cimeEnGrappes(W, H, forme, v.tons, gr).ton.join('|')))
      expect(empreintes.size, `${v.slug} : des graines donnent la même cime`).toBe(CIMES_PAR_ARBRE)
    }
  })
})

describe('la cime nue — dérivée de la feuillue, une branche par touffe', () => {
  it('chaque centre de grappe est du bois, et le bois part du sommet du fût', () => {
    for (const slug of VARIANTES_CADUQUES) for (const graine of GRAINES) {
      const v = TOUTES_VARIANTES.find((x) => x.slug === slug)!
      const W = houppierLargeur(v.mesures), H = v.mesures.houppierS
      const forme = FORME_PAR_VARIANTE[slug]!
      const nue = cimeNue(W, H, forme, v.fut, PORT_PAR_VARIANTE[slug]!, v.mesures.recouvrementPx, v.mesures.colonneW, graine)
      const bois = (x: number, y: number): boolean => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (nue.opaque(x + dx, y + dy)) return true
        return false
      }
      for (const [cx, cy] of centresDe(W, H, forme, graine)) expect(bois(cx, cy), `${slug} g${graine} : la touffe (${cx}, ${cy}) n'a pas sa branche`).toBe(true)
      expect(bois(Math.floor(W / 2), H - v.mesures.recouvrementPx + 1), `${slug} g${graine} : le bois ne part pas du fût`).toBe(true)
      // nue : bien moins de matière que la feuillue, mais jamais rien
      const m = masse(nue, W, H)
      expect(m).toBeGreaterThan(0.04); expect(m).toBeLessThan(0.5)
      expect(composantes(nue, W, H), `${slug} g${graine} : des branches en l'air`).toBe(1)
    }
  })
})
