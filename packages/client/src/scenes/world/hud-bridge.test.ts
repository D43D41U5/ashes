/**
 * La seule logique PURE du pont HUD : « le conteneur ouvert est-il encore à
 * portée ? ». Le reste du fichier n'est que du câblage registry, vérifié à l'œil.
 * La portée vient de /sim (`BALANCE.INTERACT_RANGE`) — jamais recopiée.
 */
import { BALANCE } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { containerInRange } from './hud-bridge'

describe('containerInRange', () => {
  const R = BALANCE.INTERACT_RANGE

  it('le conteneur sous le joueur est à portée', () => {
    expect(containerInRange(5, 5, { x: 5, y: 5 })).toBe(true)
  })

  it('pile au bord (distance = INTERACT_RANGE) : encore à portée', () => {
    expect(containerInRange(0, 0, { x: R, y: 0 })).toBe(true)
  })

  it('un cheveu au-delà de INTERACT_RANGE : hors de portée (le loot se referme)', () => {
    expect(containerInRange(0, 0, { x: R + 0.01, y: 0 })).toBe(false)
  })

  it('mesure en 2D (diagonale) : au-delà du rayon → hors de portée', () => {
    // (R, R) est à distance R·√2 > R du conteneur en (0,0).
    expect(containerInRange(0, 0, { x: R, y: R })).toBe(false)
  })
})
