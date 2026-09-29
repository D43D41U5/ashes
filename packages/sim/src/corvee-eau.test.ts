/**
 * LA CORVÉE D'EAU — « temps de trajet » (reprise de l'eau D2, décision d'Alexis).
 *
 * L'eau n'est ni un stock ni un item : la corvée EST le coût du trajet, bras occupés ∝ distance
 * à l'eau.
 *
 * ⚠ **LA CORVÉE ELLE-MÊME EST PARTIE LE 2026-09-29** avec l'IA villageoise (pivot de la braise) :
 * plus personne ne va puiser. Les deux gardes qui la déroulaient — « le villageois va PUISER au
 * loin et revient au Feu » et « le COÛT croît avec la distance » — n'ont plus de sujet et sont
 * retirées, avec le dérouleur `derouleCourse` qui les servait.
 *
 * **CE QUI RESTE EST LA MOITIÉ QUI SURVIT : `eauLaPlusProcheMarchable`.** Ce chercheur de berge
 * n'est pas une pièce d'IA — c'est une requête de CARTE, pure, et la braise en aura besoin
 * (une balise se plante près d'une eau, un gué se cherche). Ses deux gardes tiennent mot pour
 * mot : il trouve la berge de l'eau qu'on a posée, au loin, et il sait rendre −1.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { createEmptyMap, eauLaPlusProcheMarchable, isWater, setTile, terrainAt } from './map'

const FEU_TX = 12
const FEU_TY = 12
const cheb = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

describe('la corvée d’eau — temps de trajet (D2)', () => {
  it('le chercheur de berge trouve l’eau AU LOIN, bordée de la tuile qu’on a posée', () => {
    const map = createEmptyMap(48, 48, TERRAIN_GRASS)
    setTile(map, 40, 12, TERRAIN_SHALLOW_WATER) // une seule eau, à 28 tuiles du Feu
    const packed = eauLaPlusProcheMarchable(map, FEU_TX, FEU_TY, 20000)
    expect(packed).toBeGreaterThanOrEqual(0)
    const tx = packed % map.width
    const ty = (packed - tx) / map.width
    // La berge rendue est marchable, et EFFECTIVEMENT au bord de NOTRE eau (pas d'une autre).
    expect(terrainAt(map, tx, ty)).toBe(TERRAIN_GRASS)
    let bordeNotreEau = false
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++)
        if (isWater(terrainAt(map, tx + ox, ty + oy)) && tx + ox === 40 && ty + oy === 12) bordeNotreEau = true
    expect(bordeNotreEau, 'la berge borde la tuile d’eau posée').toBe(true)
    // Et elle est LOIN : la distance de trajet est le sujet même du mécanisme.
    expect(cheb(tx, ty, FEU_TX, FEU_TY)).toBe(27)
  })

  it('sans eau atteignable, le chercheur rend -1 (course inerte, pas de plantage)', () => {
    const map = createEmptyMap(48, 48, TERRAIN_GRASS) // aucune eau
    expect(eauLaPlusProcheMarchable(map, FEU_TX, FEU_TY, 20000)).toBe(-1)
  })
})
