/**
 * LE CONTEXTE DES BUTTES (t0-exploration §2sexies) — pur, donc gardé en headless : les rôles
 * (cœur / sommet / frange), la pente continue vers le sommet, et le sol moucheté déterministe.
 * Le piège épinglé : un sommet posé au CENTRE GÉOMÉTRIQUE d'un rect en L tombe hors rocaille —
 * le chicot flotterait sur l'herbe. Le sommet est la tuile de PIERRIER la plus proche du centre.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_SCREE, type WorldMap } from '@ashes/sim'
import { butteAt, contexteDesButtes, FRANGE_TUILES, solDeButte } from './buttes'

/** Une carte minuscule : herbe partout, une butte 8×8 en (8,8) dont le quart NO est resté herbeux
 *  (le rect en L du vrai générateur), déclarée ferreuse. */
function carte(ressource: 'fer' | 'charbon'): WorldMap {
  const width = 32
  const height = 32
  const terrain = new Array<number>(width * height).fill(TERRAIN_GRASS)
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 16; x++) {
      if (x < 12 && y < 12) continue // le coin manquant du L
      terrain[y * width + x] = TERRAIN_SCREE
    }
  }
  return { width, height, terrain, zones: [], affleurements: [{ x: 8, y: 8, w: 8, h: 8, ressource }] } as unknown as WorldMap
}

describe('le contexte des buttes', () => {
  it('cœur dedans, frange en couronne, rien au-delà — et une carte sans buttes ne coûte rien', () => {
    const ctx = contexteDesButtes(carte('charbon'))
    expect(ctx.get(9 * 32 + 9)?.role).toBe('coeur') // même le coin herbeux du L : le rect fait foi
    expect(ctx.get((8 - 1) * 32 + 10)?.role).toBe('frange')
    expect(ctx.get((8 - FRANGE_TUILES) * 32 + 10)?.role).toBe('frange')
    expect(ctx.get((8 - FRANGE_TUILES - 1) * 32 + 10)).toBeUndefined()
    expect(contexteDesButtes({ width: 4, height: 4, terrain: [0, 0, 0, 0], zones: [] } as unknown as WorldMap).size).toBe(0)
  })

  it('la pente monte vers le centre, CONTINUE — 1 au centre, 0 au bord', () => {
    const ctx = contexteDesButtes(carte('charbon'))
    const au = (x: number, y: number): number => ctx.get(y * 32 + x)!.grad
    expect(au(12, 12)).toBeGreaterThan(0.8) // le centre (11.5,11.5 entre quatre tuiles)
    expect(au(8, 12)).toBeLessThan(0.2) // le bord ouest
    expect(au(12, 12)).toBeGreaterThan(au(10, 12)) // et elle MONTE, strictement
    expect(au(10, 12)).toBeGreaterThan(au(8, 12))
  })

  it('le sommet ferreux est SUR la rocaille, au plus près du centre — jamais sur l\'herbe du L', () => {
    const ctx = contexteDesButtes(carte('fer'))
    const sommets = [...ctx.entries()].filter(([, c]) => c.role === 'sommet')
    expect(sommets).toHaveLength(1)
    const [i] = sommets[0]!
    const tx = i % 32
    const ty = (i - tx) / 32
    expect(carte('fer').terrain[i]).toBe(TERRAIN_SCREE)
    // Le centre (11.5, 11.5) est dans le coin herbeux : le sommet s'est décalé sur le pierrier voisin.
    expect(Math.abs(tx - 11.5) + Math.abs(ty - 11.5)).toBeLessThanOrEqual(2)
    // Le charbon reste bas — pas de chicot, c'est SA silhouette.
    expect([...contexteDesButtes(carte('charbon')).values()].some((c) => c.role === 'sommet')).toBe(false)
  })

  it('butteAt lit le rect, solDeButte mouchette en déterministe dans sa paire de tons', () => {
    const affs = [{ x: 8, y: 8, w: 8, h: 8, ressource: 'fer' as const }]
    expect(butteAt(affs, 9, 9)?.ressource).toBe('fer')
    expect(butteAt(affs, 7, 9)).toBeNull()
    const tons = new Set<number>()
    for (let x = 0; x < 20; x++) tons.add(solDeButte('fer', x, 5))
    expect(tons.size).toBe(2) // fond + tache, rien d'autre — quantifié, jamais un dégradé
    expect(solDeButte('charbon', 3, 3)).toBe(solDeButte('charbon', 3, 3)) // pur et stable
  })
})
