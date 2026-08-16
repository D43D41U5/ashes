import { describe, expect, it } from 'vitest'
import { axeOppose, GICLEE, GOUTTE, nombreGiclee, pireContact, SANG_TONS } from './sang-fx'

describe('les lois du sang — ça se pose avant de s’effacer', () => {
  // La promesse des familles cassantes de la récolte, reprise mot pour mot : une
  // goutte qui s'éteint encore en l'air lit comme une disparition, posée elle lit
  // comme une tache. Vérifiée sur le PIRE cas (naissance la plus haute, envol max).
  it('la giclée touche le sol bien avant la fin de sa vie', () => {
    expect(pireContact(GICLEE)).toBeLessThan(GICLEE.vie * 0.6)
  })
  it('la goutte de plaie aussi — et il lui reste au moins la moitié de sa vie en tache', () => {
    expect(pireContact(GOUTTE)).toBeLessThan(GOUTTE.vie * 0.5)
  })
})

describe('nombreGiclee — la giclée dit le poids du coup', () => {
  it('un petit coup gicle peu, un coup lourd gicle fort, bornés', () => {
    expect(nombreGiclee(1)).toBe(4)
    expect(nombreGiclee(6)).toBeGreaterThanOrEqual(4)
    expect(nombreGiclee(32)).toBe(10)
    expect(nombreGiclee(500)).toBe(10) // jamais un feu d'artifice
  })
  it('croît avec le dégât', () => {
    expect(nombreGiclee(20)).toBeGreaterThan(nombreGiclee(4))
  })
})

describe('axeOppose — la giclée part à l’opposé du frappeur', () => {
  it('frappé à l’ouest du frappeur → gicle vers l’ouest', () => {
    const axe = axeOppose(10, 50, 26, 50)
    expect(axe).not.toBeNull()
    expect(axe!.dx).toBeCloseTo(-1, 5)
    expect(axe!.dy).toBeCloseTo(0, 5)
  })
  it('à bout touchant (confondus), pas d’axe — on ne projette pas au hasard', () => {
    expect(axeOppose(10, 50, 10, 50)).toBeNull()
  })
  it('l’axe est unitaire', () => {
    const axe = axeOppose(3, 4, 0, 0)!
    expect(Math.sqrt(axe.dx * axe.dx + axe.dy * axe.dy)).toBeCloseTo(1, 5)
  })
})

describe('la palette', () => {
  it('trois valeurs du même sang que la piste au sol (BootScene)', () => {
    expect(SANG_TONS).toContain(0xc4372a)
    expect(SANG_TONS).toContain(0x8e2318)
    expect(SANG_TONS).toHaveLength(3)
  })
})
