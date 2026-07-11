import { describe, expect, it } from 'vitest'
import { gridMesh } from './ground-mesh'

describe('gridMesh', () => {
  it('fenêtre 1×1 plate : 4 sommets (x,y,u,v), 2 triangles', () => {
    // carte 10×10, tuile 16, lift nul. Fenêtre = la seule tuile (2,3).
    const m = gridMesh(2, 3, 2, 3, () => 0, 16, 10, 10)
    // 4 sommets × 4 composantes = 16 nombres.
    expect(m.vertices).toHaveLength(16)
    // coin haut-gauche (gx=2,gy=3) : x=32, y=48, u=0.2, v=0.3
    expect(m.vertices.slice(0, 4)).toEqual([32, 48, 0.2, 0.3])
    // coin bas-droite (gx=3,gy=4) est le 4e sommet : x=48, y=64, u=0.3, v=0.4
    expect(m.vertices.slice(12, 16)).toEqual([48, 64, 0.3, 0.4])
    // 2 triangles × (a,b,c,page) = 8 indices.
    expect(m.indices).toHaveLength(8)
  })

  it('les sommets remontent de lift', () => {
    const lift = (x: number, y: number) => (x === 2 && y === 3 ? 10 : 0)
    const m = gridMesh(2, 3, 2, 3, lift, 16, 10, 10)
    expect(m.vertices[1]).toBe(38) // y du coin (2,3) = 48 − 10
    expect(m.vertices[5]).toBe(48) // y du coin (3,3) = 48 − 0
  })
})
