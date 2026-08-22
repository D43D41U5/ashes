/** LA FLORE QUI GÈLE — gardes du geste et de la mémoire des bascules (flore-froid.md F8). */
import { describe, expect, it } from 'vitest'
import { FLORE_GEL, TransitionsFlore, poseDuGeste, retardDe } from './flore-gel'

describe('le geste', () => {
  it('geler : part du repos, s’étire puis s’écrase à zéro, et finit invisible', () => {
    expect(poseDuGeste(true, 0)).toEqual({ sx: 1, sy: 1, visible: true })
    expect(poseDuGeste(true, 1).visible).toBe(false)
    const anticipe = poseDuGeste(true, FLORE_GEL.ANTICIPATION * 0.999)
    expect(anticipe.sy).toBeGreaterThan(1)
    expect(anticipe.sx).toBeLessThan(1)
    let syAvant = poseDuGeste(true, FLORE_GEL.ANTICIPATION).sy
    for (let p = FLORE_GEL.ANTICIPATION; p < 1; p += 0.02) {
      const g = poseDuGeste(true, p)
      expect(g.visible).toBe(true)
      expect(g.sy).toBeLessThanOrEqual(syAvant + 1e-9) // l'effondrement est monotone
      syAvant = g.sy
    }
    expect(poseDuGeste(true, 0.999).sy).toBeLessThan(0.01)
    expect(poseDuGeste(true, 0.999).sx).toBeGreaterThan(1) // écrasé : plus large
  })

  it('dégeler : jaillit du sol, dépasse sa taille, revient au repos', () => {
    expect(poseDuGeste(false, 0).visible).toBe(false)
    expect(poseDuGeste(false, 1)).toEqual({ sx: 1, sy: 1, visible: true })
    expect(poseDuGeste(false, 0.001).sy).toBeLessThan(0.05)
    const sommet = poseDuGeste(false, FLORE_GEL.SOMMET)
    expect(sommet.sy).toBeCloseTo(1 + FLORE_GEL.SURSAUT, 5)
    expect(poseDuGeste(false, 0.9).sy).toBeLessThan(sommet.sy)
    expect(poseDuGeste(false, 0.9).sy).toBeGreaterThan(1)
  })

  it('le retard est borné et positionnel', () => {
    for (let i = 0; i < 50; i++) {
      const r = retardDe(i, i * 3)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(FLORE_GEL.ETALEMENT_MS)
      expect(retardDe(i, i * 3)).toBe(r)
    }
  })
})

describe('la mémoire des bascules', () => {
  it('une clé vue gelée pour la première fois est absente sans geste ; vue libre, au repos', () => {
    const t = new TransitionsFlore()
    expect(t.pose(1, true, 1000, 0)).toEqual({ sx: 1, sy: 1, visible: false, eclat: false })
    expect(t.pose(2, false, 1000, 0)).toEqual({ sx: 1, sy: 1, visible: true, eclat: false })
    // Et ça tient : pas de geste tant que rien ne bascule.
    expect(t.pose(1, true, 5000, 0).visible).toBe(false)
    expect(t.pose(2, false, 5000, 0)).toEqual({ sx: 1, sy: 1, visible: true, eclat: false })
  })

  it('une bascule joue le geste après son retard, donne UNE gerbe, puis se pose', () => {
    const t = new TransitionsFlore()
    t.pose(7, false, 0, 0)
    const retard = 300
    // Avant le retard : encore au repos, pas de gerbe.
    const p0 = t.pose(7, true, 100, retard)
    expect(p0.visible).toBe(true)
    expect(p0.sy).toBe(1)
    expect(p0.eclat).toBe(false)
    // Le départ : la gerbe, une fois.
    const p1 = t.pose(7, true, 100 + retard, retard)
    expect(p1.eclat).toBe(true)
    expect(t.pose(7, true, 100 + retard + 16, retard).eclat).toBe(false)
    // À mi-geste : en train de s'effondrer.
    const mi = t.pose(7, true, 100 + retard + FLORE_GEL.DUREE_MS * 0.8, retard)
    expect(mi.visible).toBe(true)
    expect(mi.sy).toBeLessThan(1)
    // Après : parti.
    expect(t.pose(7, true, 100 + retard + FLORE_GEL.DUREE_MS + 1, retard).visible).toBe(false)
    // Le dégel : repart, gerbe, repos.
    const d = t.pose(7, false, 10_000, 0)
    expect(d.eclat).toBe(true)
    expect(t.pose(7, false, 10_001, 0).visible).toBe(true)
    expect(t.pose(7, false, 10_000 + FLORE_GEL.DUREE_MS * 2, 0)).toEqual({ sx: 1, sy: 1, visible: true, eclat: false })
  })

  it('un geste renversé à mi-course ne saute pas et ne redonne pas de gerbe', () => {
    const t = new TransitionsFlore()
    t.pose(3, false, 0, 0)
    t.pose(3, true, 1000, 0)
    const avant = t.pose(3, true, 1000 + FLORE_GEL.DUREE_MS * 0.6, 0)
    const apres = t.pose(3, false, 1000 + FLORE_GEL.DUREE_MS * 0.6, 0)
    expect(apres.eclat).toBe(false)
    expect(apres.visible).toBe(true)
    expect(Math.abs(apres.sy - avant.sy)).toBeLessThan(0.6)
  })

  it('oublie les clés qu’on ne voit plus', () => {
    const t = new TransitionsFlore()
    t.pose(1, false, 0, 0)
    for (let i = 0; i < 1300; i++) t.image()
    expect(t.taille).toBe(0)
  })
})
