import { describe, it, expect } from 'vitest'
import { createPromptGate } from './prompt-gate'

describe('promptGate — le garde anti-double-envoi des fenêtres du bas', () => {
  it('avant tout clic, ne tait rien (la fenêtre s’affiche normalement)', () => {
    const g = createPromptGate()
    expect(g.suppresses(1)).toBe(false)
    expect(g.suppresses(null)).toBe(false)
  })

  it('après un clic, TAIT tant que le registre rejoue la MÊME identité', () => {
    const g = createPromptGate()
    g.acted(1) // on a cliqué « monter au palier 1 »
    // Les frames suivantes rejouent le même palier (le snapshot n’est pas arrivé) : muet.
    expect(g.suppresses(1)).toBe(true)
    expect(g.suppresses(1)).toBe(true)
  })

  it('rend la main dès que l’identité CHANGE (snapshot confirmé)', () => {
    const g = createPromptGate()
    g.acted(1)
    expect(g.suppresses(1)).toBe(true)
    // Le snapshot a monté le palier : nouvelle identité → on affiche le nouvel état.
    expect(g.suppresses(2)).toBe(false)
    // Et on ne re-tait plus le palier 2 tant qu’on n’a pas re-cliqué.
    expect(g.suppresses(2)).toBe(false)
  })

  it('rend la main dès que le registre passe à null (plus rien à portée)', () => {
    const g = createPromptGate()
    g.acted(7) // on a fondé le feu 7
    expect(g.suppresses(7)).toBe(true)
    // Fondé → foundableFire null → on lève l’attente.
    expect(g.suppresses(null)).toBe(false)
    // Revenir sur le même feu (déjà village) ne le rendrait pas fondable ; mais si une
    // autre identité revient, elle s’affiche normalement.
    expect(g.suppresses(7)).toBe(false)
  })

  it('gère l’identité 0 (un id de structure/groupe peut valoir 0)', () => {
    const g = createPromptGate()
    g.acted(0)
    expect(g.suppresses(0)).toBe(true) // 0, ce n’est pas « rien »
    expect(g.suppresses(null)).toBe(false)
  })

  it('un second clic pendant l’attente re-arme sur la nouvelle identité', () => {
    const g = createPromptGate()
    g.acted(1)
    expect(g.suppresses(1)).toBe(true)
    g.acted(1) // re-cliqué (le garde extérieur empêche l’envoi, mais l’automate reste cohérent)
    expect(g.suppresses(1)).toBe(true)
    expect(g.suppresses(2)).toBe(false)
  })
})
