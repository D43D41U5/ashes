import { describe, expect, it } from 'vitest'
import { createWarp } from './warp'
import { TILE_PX } from './framing'
import type { WorldMap } from '@braises/sim'

const STEP = 12

/** Une carte jouet : `paliers` en row-major, un entier par tuile. */
function carte(paliers: number[][], palierMax = 5): WorldMap {
  const height = paliers.length
  const width = paliers[0]!.length
  return {
    width,
    height,
    terrain: new Array<number>(width * height).fill(1),
    zones: [],
    palier: paliers.flat(),
    palierMax,
  }
}

describe('les marches — le lift', () => {
  it('vaut palier × STEP, et il est CONSTANT sur la tuile : la marche est FRANCHE', () => {
    const w = createWarp(carte([[0, 2]]), STEP, TILE_PX)
    expect(w.lift(0, 0)).toBe(0)
    expect(w.lift(1, 0)).toBe(2 * STEP)
    // Le point est FRACTIONNAIRE, et pourtant rien ne s'interpole : c'est là que l'ancien relief
    // continu (bilinéaire) fabriquait un biseau d'une tuile de large tout le long de chaque falaise.
    expect(w.lift(0.99, 0)).toBe(0)
    expect(w.lift(1.01, 0)).toBe(2 * STEP)
  })

  it("hors carte, il ne lève rien — le vide n'a pas d'altitude", () => {
    const w = createWarp(carte([[3]]), STEP, TILE_PX)
    expect(w.lift(-5, 0)).toBe(0)
    expect(w.lift(0, 99)).toBe(0)
  })
})

describe('les marches — le picking', () => {
  it('rend la tuile sous le curseur, sur un sol plat', () => {
    const w = createWarp(carte([[0, 0], [0, 0]]), STEP, TILE_PX)
    const p = w.unproject(TILE_PX * 1.5, TILE_PX * 1.5)
    expect(Math.floor(p.y / TILE_PX)).toBe(1)
  })

  it('suit la tuile SOULEVÉE : viser une terrasse haute désigne bien la terrasse', () => {
    // Colonne unique : rangée 0 au palier 0, rangée 1 au palier 2 (soulevée de 24 px).
    // La rangée 1 s'affiche de `1·16 − 24 = −8` à `+8`. Le pixel écran 0 est donc DANS la rangée 1,
    // alors qu'un sol plat y aurait vu la rangée 0.
    const w = createWarp(carte([[0], [2]]), STEP, TILE_PX)
    const p = w.unproject(TILE_PX * 0.5, 0)
    expect(Math.floor(p.y / TILE_PX)).toBe(1)
  })

  it("LA RÈGLE D'OCCLUSION : quand deux tuiles se superposent, la plus AU SUD gagne", () => {
    // Rangée 0 au palier 0 → s'affiche [0, 16[. Rangée 1 au palier 1 → s'affiche [4, 20[.
    // Le pixel 8 est couvert par les DEUX. Le sol se dessinant du nord vers le sud, c'est la
    // rangée 1 qu'on VOIT — et c'est donc elle que le curseur doit désigner.
    const w = createWarp(carte([[0], [1]]), STEP, TILE_PX)
    const p = w.unproject(TILE_PX * 0.5, 8)
    expect(Math.floor(p.y / TILE_PX)).toBe(1)
  })

  it("LE CONTRAT : le picking est l'inverse EXACT du rendu, sur toute la carte", () => {
    // Rendu et picking ne peuvent pas diverger — c'est la raison d'être de ce module. On le prouve
    // en refaisant le chemin dans les deux sens : pour chaque tuile, on calcule où le rendu la
    // pose, on interroge le picking à ce pixel, et il doit retomber sur une tuile qui couvre
    // VRAIMENT ce pixel — la sienne, ou celle qui la recouvre par le sud.
    const paliers = [[0, 1, 3], [1, 1, 2], [0, 2, 5]]
    const w = createWarp(carte(paliers), STEP, TILE_PX)
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        const centreEcranY = (ty + 0.5) * TILE_PX - paliers[ty]![tx]! * STEP
        const p = w.unproject((tx + 0.5) * TILE_PX, centreEcranY)
        const trouve = Math.floor(p.y / TILE_PX)
        expect(trouve).toBeGreaterThanOrEqual(ty) // jamais AU NORD de la vraie : ce serait caché
        const haut = trouve * TILE_PX - (paliers[trouve]?.[tx] ?? 0) * STEP
        expect(centreEcranY).toBeGreaterThanOrEqual(haut)
        expect(centreEcranY).toBeLessThan(haut + TILE_PX)
      }
    }
  })

  it("LE REPLI EST IMPOSSIBLE : une rampe qui monte vers le nord avance toujours à l'écran", () => {
    // C'est la seule contrainte du système (STEP < TILE), et c'est ce qui tue `assertNoFold` — la
    // garde qui refusait de démarrer le jeu, et que quatre seeds sur seize faisaient lever.
    expect(STEP).toBeLessThan(TILE_PX)
    const paliers = [[5], [4], [3], [2], [1], [0]] // une rampe qui DESCEND vers le sud, au pire cas
    const w = createWarp(carte(paliers), STEP, TILE_PX)
    let precedent = -Infinity
    for (let ty = 0; ty < 6; ty++) {
      const y = ty * TILE_PX - w.lift(0, ty)
      expect(y).toBeGreaterThan(precedent) // strictement croissant : rien ne passe derrière
      precedent = y
    }
  })
})
