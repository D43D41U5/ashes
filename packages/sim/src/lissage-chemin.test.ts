/**
 * LE LISSAGE D'UN CHEMIN (`lisserLeChemin`) — la diagonale se gagne APRÈS l'A*.
 *
 * Le défaut mesuré (Alexis, 2026-08-25 : « les cendreux se déplacent quasi exclusivement en X et
 * Y toujours ») ne vient pas du PAS — `moveToward` sait faire huit directions — mais de la FORME
 * des chemins : l'A* est 4-connexe et son départage rend des **L**, `EEEEEEEEEEESSSSSSSSS`. Ces
 * gardes tiennent les deux moitiés de la promesse : le L s'efface là où l'on voit, et rien n'est
 * inventé là où l'on ne voit pas.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { createEmptyMap } from './map'
import { findPath, lisserLeChemin } from './pathfinding'

const N = 24
function monde(roche: [number, number][] = []): { map: ReturnType<typeof createEmptyMap> } {
  const map = createEmptyMap(N, N, TERRAIN_GRASS)
  for (const [tx, ty] of roche) map.terrain[ty * N + tx] = TERRAIN_ROCK
  return { map }
}

/** Le cap de chaque segment du trajet réellement suivi, depuis la position de départ. */
function caps(x: number, y: number, chemin: readonly { tx: number; ty: number }[]): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = []
  let cx = x
  let cy = y
  for (const w of chemin) {
    out.push({ dx: w.tx + 0.5 - cx, dy: w.ty + 0.5 - cy })
    cx = w.tx + 0.5
    cy = w.ty + 0.5
  }
  return out
}

describe('le lissage de chemin — la diagonale est un cap, pas une tuile', () => {
  it('① en terrain libre, le L de l’A* devient UN cap oblique', () => {
    const world = monde()
    const brut = findPath(world, { tx: 3, ty: 3 }, { tx: 13, ty: 13 })!
    // La prémisse, affirmée : sans elle, ce test vérifierait le lissage d'un chemin déjà droit.
    expect(brut.length).toBe(20) // 4-connexe : dix pas en X plus dix en Y
    const virages = caps(3.5, 3.5, brut).filter((c) => c.dx !== 0 && c.dy !== 0).length
    expect(virages, 'l’A* brut ne propose AUCUN segment oblique').toBe(0)

    const lisse = lisserLeChemin(world, 3.5, 3.5, brut)
    expect(lisse).toEqual([{ tx: 13, ty: 13 }]) // un seul jalon : la ligne droite suffit
    const c = caps(3.5, 3.5, lisse)[0]!
    expect(Math.abs(c.dx)).toBeGreaterThan(0.5)
    expect(Math.abs(c.dy)).toBeGreaterThan(0.5) // les DEUX axes bougent : c'est ça, une diagonale
  })

  it('② le lissé est un SOUS-ENSEMBLE ORDONNÉ du brut — aucune tuile inventée', () => {
    // Un mur percé d'une porte : le chemin doit rester dans le corridor que l'A* a trouvé.
    const mur: [number, number][] = []
    for (let ty = 0; ty < N; ty++) if (ty !== 8) mur.push([11, ty])
    const world = monde(mur)
    const brut = findPath(world, { tx: 4, ty: 16 }, { tx: 18, ty: 16 })!
    const lisse = lisserLeChemin(world, 4.5, 16.5, brut)
    let i = 0
    for (const w of lisse) {
      while (i < brut.length && (brut[i]!.tx !== w.tx || brut[i]!.ty !== w.ty)) i++
      expect(i, `le jalon (${w.tx},${w.ty}) n’est pas dans le chemin brut, ou pas dans l’ordre`).toBeLessThan(brut.length)
      i++
    }
    expect(lisse.length).toBeLessThanOrEqual(brut.length)
    expect(lisse[lisse.length - 1]).toEqual(brut[brut.length - 1]) // l'arrivée ne se perd jamais
    expect(lisse.length).toBeGreaterThan(1) // le mur force au moins un jalon intermédiaire
  })

  it('③ aucun segment lissé ne traverse la roche', () => {
    const mur: [number, number][] = []
    for (let ty = 0; ty < N; ty++) if (ty !== 8) mur.push([11, ty])
    const world = monde(mur)
    const brut = findPath(world, { tx: 4, ty: 16 }, { tx: 18, ty: 16 })!
    const lisse = lisserLeChemin(world, 4.5, 16.5, brut)
    // On échantillonne DENSÉMENT chaque segment : c'est la propriété qui compte pour un corps
    // (le lissage promet de VOIR l'arrivée), et elle ne se déduit pas de la liste des jalons.
    let cx = 4.5
    let cy = 16.5
    for (const w of lisse) {
      const gx = w.tx + 0.5
      const gy = w.ty + 0.5
      const n = 64
      for (let k = 0; k <= n; k++) {
        const x = cx + ((gx - cx) * k) / n
        const y = cy + ((gy - cy) * k) / n
        const t = world.map.terrain[Math.floor(y) * N + Math.floor(x)]
        expect(t, `le segment vers (${w.tx},${w.ty}) passe par la roche en (${x.toFixed(2)},${y.toFixed(2)})`).not.toBe(TERRAIN_ROCK)
      }
      cx = gx
      cy = gy
    }
  })

  it('④ la règle du coin : deux blocs en diagonale ne se franchissent pas', () => {
    // Le passage (5,5)→(6,6) est ouvert au sens des TUILES, mais un corps n'y passe pas :
    // (6,5) et (5,6) sont pleins. Le lissage doit refuser cette ligne.
    const world = monde([[6, 5], [5, 6]])
    const chemin = [{ tx: 6, ty: 6 }]
    const lisse = lisserLeChemin(world, 5.5, 5.5, chemin)
    expect(lisse).toEqual(chemin) // rien à lisser, et surtout rien à sauter
    // Et la vue est bien REFUSÉE : depuis (5,5), un but DERRIÈRE ce coin ne se joint pas d'un trait.
    const loin = lisserLeChemin(world, 5.5, 5.5, [{ tx: 6, ty: 6 }, { tx: 7, ty: 7 }])
    expect(loin[0]).toEqual({ tx: 6, ty: 6 }) // le premier jalon TIENT : on n'a pas vu par-dessus le coin
  })

  it('⑤ il ne touche ni au chemin d’entrée ni à un chemin d’un seul jalon', () => {
    const world = monde()
    const brut = findPath(world, { tx: 3, ty: 3 }, { tx: 13, ty: 13 })!
    const copie = brut.map((w) => ({ ...w }))
    lisserLeChemin(world, 3.5, 3.5, brut)
    expect(brut).toEqual(copie) // pure : l'entrée sort intacte
    expect(lisserLeChemin(world, 3.5, 3.5, [{ tx: 4, ty: 3 }])).toEqual([{ tx: 4, ty: 3 }])
    expect(lisserLeChemin(world, 3.5, 3.5, [])).toEqual([])
  })
})
