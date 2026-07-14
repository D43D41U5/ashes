import { describe, expect, it } from 'vitest'
import { gridMesh } from './ground-mesh'

const TILE = 16

describe('gridMesh — le sol en MARCHES', () => {
  it('une tuile = un QUAD À ELLE : 4 sommets (x,y,u,v), 2 triangles', () => {
    const m = gridMesh(0, 0, 0, 0, () => 0, TILE, 10, 10)
    expect(m.vertices).toHaveLength(16) // 4 sommets × (x, y, u, v)
    expect(m.indices).toHaveLength(8) // 2 triangles × (a, b, c, page)
    // Les quatre coins de la tuile (0,0), dans l'ordre : NO, NE, SE, SO.
    expect(m.vertices.slice(0, 4)).toEqual([0, 0, 0, 0])
    expect(m.vertices.slice(4, 8)).toEqual([TILE, 0, 0.1, 0])
    expect(m.vertices.slice(8, 12)).toEqual([TILE, TILE, 0.1, 0.1])
    expect(m.vertices.slice(12, 16)).toEqual([0, TILE, 0, 0.1])
  })

  it('les sommets remontent du lift de LEUR tuile', () => {
    const m = gridMesh(1, 2, 1, 2, () => 24, TILE, 10, 10)
    const ys = [m.vertices[1], m.vertices[5], m.vertices[9], m.vertices[13]]
    // La tuile (1,2) s'étend de y=32 à y=48, soulevée de 24 px → de 8 à 24.
    expect(ys).toEqual([8, 8, 24, 24])
  })

  it("LA MARCHE NE SE BISEAUTE PAS — c'est toute la raison d'être des quads indépendants", () => {
    // Deux tuiles voisines, l'une soulevée de deux marches. Un maillage à coins PARTAGÉS (l'ancien)
    // aurait donné à leur coin commun une hauteur unique : la falaise serait devenue une rampe d'une
    // tuile de large, tout le long de la carte. Ici, chacune garde SA hauteur — le décollement des
    // deux bords EST la marche.
    const lift = (x: number): number => (x === 0 ? 0 : 24)
    const m = gridMesh(0, 0, 1, 0, (x) => lift(x), TILE, 10, 10)
    expect(m.vertices).toHaveLength(32) // deux tuiles, quatre sommets chacune : rien n'est partagé

    const coinNEdeGauche = { x: m.vertices[4], y: m.vertices[5] }
    const coinNOdeDroite = { x: m.vertices[16], y: m.vertices[17] }
    expect(coinNEdeGauche.x).toBe(coinNOdeDroite.x) // même abscisse : les tuiles se touchent
    expect(coinNEdeGauche.y).toBe(0)
    expect(coinNOdeDroite.y).toBe(-24) // ...et pourtant elles se décollent de deux marches
  })

  it("dessine du NORD vers le SUD : l'occlusion des terrasses est juste, sans tri", () => {
    // Une tuile méridionale est émise APRÈS ce qu'elle recouvre — c'est ce qui permet à une terrasse
    // basse et proche de passer devant une terrasse haute et lointaine, sans depth-buffer.
    const m = gridMesh(0, 0, 0, 1, () => 0, TILE, 10, 10)
    const yPremiereTuile = m.vertices[1]!
    const ySecondeTuile = m.vertices[17]!
    expect(ySecondeTuile).toBeGreaterThan(yPremiereTuile)
  })
})
