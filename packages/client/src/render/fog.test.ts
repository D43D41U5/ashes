/**
 * LES GARDES DU BROUILLARD — module pur, donc testable sans navigateur ni carte réelle.
 */
import { describe, expect, it } from 'vitest'
import { creerBrouillard, depackBrouillard, estVu, FOG_PAS, packBrouillard, partDecouverte, revele } from './fog'

describe('le brouillard de guerre', () => {
  it('naît entièrement FERMÉ — au tick 0 on ne connaît rien', () => {
    const b = creerBrouillard(160, 160)
    expect(partDecouverte(b)).toBe(0)
    expect(estVu(b, 80, 80)).toBe(false)
  })

  it('marcher DÉVOILE autour de soi, et seulement autour', () => {
    const b = creerBrouillard(800, 800)
    revele(b, 400, 400, 24)
    expect(estVu(b, 400, 400)).toBe(true)
    // Juste à côté : vu. Très loin : toujours fermé.
    expect(estVu(b, 400 + 16, 400)).toBe(true)
    expect(estVu(b, 700, 700)).toBe(false)
  })

  it('dévoile un DISQUE, pas un carré : le coin lointain reste fermé', () => {
    const b = creerBrouillard(800, 800)
    const r = 40
    revele(b, 400, 400, r)
    // Sur l'axe, à la portée : vu.
    expect(estVu(b, 400 + r - FOG_PAS, 400)).toBe(true)
    // En diagonale à la même distance sur CHAQUE axe : hors du disque (r√2 > r).
    expect(estVu(b, 400 + r, 400 + r)).toBe(false)
  })

  it('signale ce qui est NEUF — de quoi ne repeindre que si la carte a changé', () => {
    const b = creerBrouillard(400, 400)
    expect(revele(b, 200, 200, 16)).toBe(true) // première fois : du neuf
    expect(revele(b, 200, 200, 16)).toBe(false) // au même endroit : plus rien
    expect(revele(b, 320, 200, 16)).toBe(true) // ailleurs : du neuf
  })

  it('on n’OUBLIE jamais un pays traversé', () => {
    const b = creerBrouillard(400, 400)
    revele(b, 100, 100, 16)
    revele(b, 300, 300, 16) // on s'en va très loin
    expect(estVu(b, 100, 100)).toBe(true) // …et l'ancien reste acquis
  })

  it('hors carte n’est jamais « vu » — on ne dévoile pas le néant', () => {
    const b = creerBrouillard(160, 160)
    revele(b, 80, 80, 999) // une portée absurde ne déborde pas
    expect(estVu(b, -40, 80)).toBe(false)
    expect(estVu(b, 80, 4000)).toBe(false)
  })

  it('se TASSE et se relit à l’identique (un bit par cellule, base64)', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 100, 120, 40)
    revele(b, 400, 300, 24)
    const relu = depackBrouillard(packBrouillard(b), 600, 500)
    expect([...relu.vu]).toEqual([...b.vu])
    expect(partDecouverte(relu)).toBeCloseTo(partDecouverte(b))
  })

  it('le format tassé est BEAUCOUP plus léger qu’un tableau de chiffres', () => {
    const b = creerBrouillard(1291, 1937) // taille de production
    revele(b, 600, 900, 60)
    const tasse = packBrouillard(b).length
    const naif = JSON.stringify([...b.vu]).length
    expect(tasse).toBeLessThan(naif / 8)
  })

  it('une carte de TAILLE DIFFÉRENTE rend un brouillard NEUF, jamais un savoir décalé', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 300, 250, 80)
    // On relit avec d'autres dimensions : refuser vaut mieux que mentir.
    const autre = depackBrouillard(packBrouillard(b), 900, 700)
    expect(partDecouverte(autre)).toBe(0)
  })
})
