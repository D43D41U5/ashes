/**
 * ═══ UN CORPS SOUS LA ROCHE NE SE VOIT QUE DE SON ÉTAGE (spec `grottes.md` §4) ═══
 *
 * *(Alexis, 2026-09-20 : « en étant dans une grotte, je peux voir les animaux qui sont à l'étage
 * au-dessus, ou l'inverse — tout est mélangé ».)* MESURÉ : le sanglier de tanière à −2 peint sur
 * la prairie depuis la surface, et un sanglier d'une salle à −1 peint depuis la salle à −2.
 *
 * ⚠ CE QUI FERAIT ROUGIR, énoncé avant d'accepter le vert : rendre `true` sans condition — les
 * deux cas mesurés repassent ; rendre `sousRoche` seul — la salle voisine repasse.
 */
import { describe, expect, it } from 'vitest'
import { corpsVu } from './corps-vu'

describe('corpsVu — le regard décide de ce qui se peint', () => {
  it('depuis dehors, aucun corps souterrain ne se voit — le cas de la prairie à l’aplomb', () => {
    expect(corpsVu(-2, false, 0)).toBe(false)
    expect(corpsVu(-1, false, 0)).toBe(false)
  })

  it('sous la roche, seul l’étage du regard se voit — la salle voisine à −1 reste dans la roche', () => {
    expect(corpsVu(-2, true, -2)).toBe(true)
    expect(corpsVu(-1, true, -2)).toBe(false)
    expect(corpsVu(-2, true, -1)).toBe(false)
  })

  it('un corps au sol se voit toujours : la roche le couvre par la profondeur, le ciel nu le montre', () => {
    for (const sousRoche of [false, true]) {
      expect(corpsVu(undefined, sousRoche, -2)).toBe(true)
      expect(corpsVu(0, sousRoche, -2)).toBe(true)
      expect(corpsVu(2, sousRoche, -2)).toBe(true)
    }
  })
})
