import { describe, expect, it } from 'vitest'
import { createEmptyMap, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE, type WorldMap } from '@ashes/sim'
import { deplierLeLift } from './deplier-etage'
import { creerRelief } from './relief'
import { LIFT_TUILES, TILE_PX } from './framing'

/**
 * Une mesa fabriquée à la main : un chapeau de roche 4×4 aux rangées 10..13, colonnes 4..7,
 * porté par un étage +1 sur la même empreinte, et une rampe (5, 14) juste au sud. Tout le
 * reste est de l'herbe au sol.
 */
function mesa(): WorldMap {
  const m = createEmptyMap(16, 24, TERRAIN_GRASS)
  const idx: number[] = []
  for (let y = 10; y <= 13; y++) for (let x = 4; x <= 7; x++) {
    m.terrain[y * m.width + x] = TERRAIN_ROCK
    idx.push(y * m.width + x)
  }
  idx.push(14 * m.width + 5)
  idx.sort((a, b) => a - b)
  m.etages = [{ niveau: 1, idx, terrain: idx.map(() => TERRAIN_SCREE), x0: 4, y0: 10, x1: 8, y1: 15 }]
  m.connecteurs = [{ x: 5, y: 14, de: 0, vers: 1, type: 'rampe' }]
  return m
}
const P = TILE_PX
const tuile = (m: WorldMap, tx: number, ty: number, souterrain = false) => {
  const p = deplierLeLift(creerRelief(m), (tx + 0.5) * P, (ty + 0.5) * P, souterrain)
  return { tx: Math.floor(p.x / P), ty: Math.floor(p.y / P) }
}

describe('deplierLeLift — le curseur vise ce qu’on VOIT, à travers le lift de l’étage', () => {
  it('le lift vaut deux tuiles : c’est la prémisse du défaut', () => {
    expect(LIFT_TUILES).toBe(2)
  })

  it('sur le plateau, la rangée d’écran ty désigne la tuile ty + LIFT du plateau', () => {
    const m = mesa()
    // La pierre de la tuile (5, 12) se dessine à la rangée 10 : c’est là qu’on la vise.
    expect(tuile(m, 5, 10)).toEqual({ tx: 5, ty: 12 })
    // Le haut du plateau (rangée 10) se dessine à la rangée 8, sur le vrai sol du nord.
    expect(tuile(m, 5, 8)).toEqual({ tx: 5, ty: 10 })
    // Et X ne bouge pas.
    expect(deplierLeLift(creerRelief(m), 5 * P + 3, 10 * P + 7).x).toBe(5 * P + 3)
  })

  it('hors de la mesa, le sol plat reste le sol plat', () => {
    const m = mesa()
    expect(tuile(m, 1, 10)).toEqual({ tx: 1, ty: 10 })
    expect(tuile(m, 5, 20)).toEqual({ tx: 5, ty: 20 })
    // Deux rangées au sud du plateau : ty + LIFT sort de l’empreinte → sol.
    expect(tuile(m, 6, 16)).toEqual({ tx: 6, ty: 16 })
  })

  it('la rampe : ses trois rangées d’écran sont la rampe', () => {
    const m = mesa()
    expect(tuile(m, 5, 12)).toEqual({ tx: 5, ty: 14 }) // le haut de l’entaille (règle 1)
    expect(tuile(m, 5, 13)).toEqual({ tx: 5, ty: 14 }) // la rangée du milieu (règle 2)
    expect(tuile(m, 5, 14)).toEqual({ tx: 5, ty: 14 }) // le tablier, au sol
  })

  it('la paroi sud (rangées 12-13 à l’écran, hors colonne de rampe) retombe sur la roche du sol', () => {
    const m = mesa()
    expect(tuile(m, 6, 13)).toEqual({ tx: 6, ty: 13 })
  })

  it('sous terre, rien ne se déplie ; sans étages non plus', () => {
    const m = mesa()
    expect(tuile(m, 5, 10, true)).toEqual({ tx: 5, ty: 10 })
    expect(tuile(createEmptyMap(16, 24, TERRAIN_GRASS), 5, 10)).toEqual({ tx: 5, ty: 10 })
  })
})

/**
 * Une terrasse fabriquée à la main (spec `terrasses.md`) : les rangées 0..9 au palier 1, le
 * reste au palier 0, et une rampe (5, 10) — la tuile BASSE du connecteur, au pied de la paroi.
 */
function terrasse(): WorldMap {
  const m = createEmptyMap(16, 24, TERRAIN_GRASS)
  m.palier = Array.from({ length: m.width * m.height }, (_, i) => (Math.floor(i / m.width) < 10 ? 1 : 0))
  m.connecteurs = [{ x: 5, y: 10, de: 0, vers: 1, type: 'rampe' }]
  return m
}

describe('deplierLeLift — les terrasses lèvent le sol lui-même', () => {
  it('le palier 1 se dessine LIFT rangées plus haut : la rangée d’écran vise ty + LIFT', () => {
    const m = terrasse()
    expect(tuile(m, 5, 3)).toEqual({ tx: 5, ty: 5 })
    expect(tuile(m, 5, 7)).toEqual({ tx: 5, ty: 9 }) // la dernière rangée haute
  })

  it('le palier 0 ne bouge pas', () => {
    const m = terrasse()
    expect(tuile(m, 5, 12)).toEqual({ tx: 5, ty: 12 })
    expect(tuile(m, 1, 20)).toEqual({ tx: 1, ty: 20 })
  })

  it('la rampe : ses rangées d’écran (8, 9, 10) sont la rampe, au palier bas', () => {
    const m = terrasse()
    expect(tuile(m, 5, 8)).toEqual({ tx: 5, ty: 10 })
    expect(tuile(m, 5, 9)).toEqual({ tx: 5, ty: 10 })
    expect(tuile(m, 5, 10)).toEqual({ tx: 5, ty: 10 })
  })

  it('la paroi (rangées d’écran 8-9 hors rampe) désigne la tuile du sol qu’elle cache', () => {
    // Le coût des terrasses (T-R8) : les deux rangées du haut palier sous la paroi sont
    // invisibles — un clic sur la paroi tombe sur elles, le dépliage ne les invente pas.
    const m = terrasse()
    expect(tuile(m, 6, 8)).toEqual({ tx: 6, ty: 8 })
  })
})
