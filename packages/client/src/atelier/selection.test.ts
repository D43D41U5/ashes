/**
 * LA SÉLECTION DE L'ATELIER — la garde des TRANSFORMATIONS (spec P-B).
 *
 * Ce qu'on affirme n'est pas « ça a l'air bon » : les involutions (miroir ∘ miroir = id,
 * quart ×4 = id) sur cases ET triplets, la correspondance concrète des directions, et le
 * bord (coller hors grille, rogner une tranche à triplets). Le patron de `rotate()` :
 * l'oubli des triplets est LE bug silencieux de ces opérations.
 */
import { describe, expect, it } from 'vitest'
import {
  bornerZone, coller, effacer, extraire, miroirH, miroirV, redimensionner, tournerFragment,
  type Fragment, type PlanMutable,
} from './selection'

const plan = (): PlanMutable => ({
  grille: ['·A··', '·LK·', '····', 'G···'],
  breches: ['1,1,E'],
  seuils: ['2,1,S'],
  passages: ['0,3,O'],
})

describe('extraire / effacer / coller', () => {
  it('extrait cases ET triplets en relatif, et le round-trip recolle à l’identique', () => {
    const p = plan()
    const f = extraire(p, { x0: 1, y0: 1, w: 2, h: 1 })
    expect(f.grille).toEqual(['LK'])
    expect(f.breches).toEqual(['0,0,E'])
    expect(f.seuils).toEqual(['1,0,S'])
    expect(f.passages).toEqual([]) //  hors zone : il ne voyage pas
    const q = plan()
    coller(q, f, 1, 1)
    expect(q).toEqual(plan()) //  recoller au même endroit ne change RIEN
  })

  it('effacer vide les cases et emporte les triplets de la zone — pas les autres', () => {
    const p = plan()
    effacer(p, { x0: 1, y0: 1, w: 2, h: 1 })
    expect(p.grille[1]).toBe('····')
    expect(p.breches).toEqual([])
    expect(p.seuils).toEqual([])
    expect(p.passages).toEqual(['0,3,O']) //  hors zone : intact
  })

  it('coller déborde sans erreur : cases et triplets hors grille sont abandonnés', () => {
    const p = plan()
    const f: Fragment = { w: 2, h: 2, grille: ['TT', 'oo'], breches: ['1,1,S'], seuils: [], passages: [] }
    coller(p, f, 3, 3)
    expect(p.grille[3]).toBe('G··T') //  seule la case (3,3) est tombée dedans
    expect(p.breches).toEqual(['1,1,E']) //  le triplet du fragment visait (4,4) : dehors
  })

  it('coller ENTIÈREMENT hors grille ne touche à RIEN (revue 2026-08-10 : le clamp effaçait le bord)', () => {
    const f: Fragment = { w: 2, h: 2, grille: ['TT', 'oo'], breches: [], seuils: [], passages: [] }
    for (const [x, y] of [[-5, 1], [20, 0], [1, -9], [0, 20]] as const) {
      const p = plan()
      coller(p, f, x, y)
      expect(p, `coller en (${x},${y})`).toEqual(plan())
    }
  })

  it('bornerZone rogne une sélection tirée hors de la grille', () => {
    expect(bornerZone({ x0: -2, y0: 3, w: 10, h: 4 }, 4)).toEqual({ x0: 0, y0: 3, w: 4, h: 1 })
  })
})

describe('les transformations — cases ET triplets, toujours ensemble', () => {
  const f: Fragment = {
    w: 3, h: 2,
    grille: ['AB·', '··C'],
    breches: ['0,0,N'],
    seuils: ['2,1,E'],
    passages: ['1,0,O'],
  }

  it('miroirH : colonnes retournées, E↔O, N/S immobiles', () => {
    const m = miroirH(f)
    expect(m.grille).toEqual(['·BA', 'C··'])
    expect(m.breches).toEqual(['2,0,N'])
    expect(m.seuils).toEqual(['0,1,O'])
    expect(m.passages).toEqual(['1,0,E'])
    expect(miroirH(m)).toEqual(f) //  involution
  })

  it('miroirV : rangées retournées, N↔S, E/O immobiles', () => {
    const m = miroirV(f)
    expect(m.grille).toEqual(['··C', 'AB·'])
    expect(m.breches).toEqual(['0,1,S'])
    expect(m.seuils).toEqual(['2,0,E'])
    expect(miroirV(m)).toEqual(f)
  })

  it('tourner : LA convention de poi-batis (N→E→S→O, (x,y)→(h−1−y,x)), et ×4 = identité', () => {
    const t = tournerFragment(f)
    expect(t.w).toBe(2)
    expect(t.h).toBe(3)
    // old(0,0)='A' → new(h-1-0, 0)=(1,0) ; old(2,1)='C' → new(0,2).
    expect(t.grille).toEqual(['·A', '·B', 'C·'])
    expect(t.breches).toEqual(['1,0,E']) //  (0,0,N) → (1,0,E)
    expect(t.seuils).toEqual(['0,2,S']) //   (2,1,E) → (0,2,S)
    expect(tournerFragment(tournerFragment(tournerFragment(t)))).toEqual(f)
  })
})

describe('redimensionner (P-E) — la grille bouge, les triplets suivent', () => {
  it('agrandir au NORD décale tout d’une rangée ; rétrécir au nord rogne et emporte', () => {
    const p = plan()
    redimensionner(p, 'N', 1)
    expect(p.grille.length).toBe(5)
    expect(p.grille[0]).toBe('····')
    expect(p.breches).toEqual(['1,2,E']) //  (1,1) a glissé d'une rangée
    redimensionner(p, 'N', -1)
    expect(plan()).toEqual(p) //  aller-retour = identité
    // Rétrécir ENCORE : la rangée 0 part, et rien n'y vivait — mais la tranche SUD, elle…
    redimensionner(p, 'S', -1)
    expect(p.passages).toEqual([]) //  (0,3,O) vivait dans la tranche rognée : parti avec elle
  })

  it('agrandir à l’OUEST décale x ; à l’EST rien ne bouge', () => {
    const p = plan()
    redimensionner(p, 'O', 1)
    expect(p.grille[1]).toBe('··LK·')
    expect(p.breches).toEqual(['2,1,E'])
    redimensionner(p, 'E', 1)
    expect(p.grille[0]).toBe('··A···')
    expect(p.breches).toEqual(['2,1,E'])
  })

  it('ne rétrécit jamais sous une case', () => {
    const p: PlanMutable = { grille: ['A'], breches: [], seuils: [], passages: [] }
    redimensionner(p, 'S', -1)
    redimensionner(p, 'E', -1)
    expect(p.grille).toEqual(['A'])
  })
})
