/**
 * La seule logique PURE du pont HUD : « le conteneur ouvert est-il encore à
 * portée ? ». Le reste du fichier n'est que du câblage registry, vérifié à l'œil.
 * La portée vient de /sim (`BALANCE.INTERACT_RANGE`) — jamais recopiée.
 */
import { BALANCE, type Structure, type Village } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { containerInRange, foundableFireAt } from './hud-bridge'

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

describe('foundableFireAt — quel feu libre puis-je promouvoir en foyer ?', () => {
  const ME = 1
  const fire = (over: Partial<Structure> = {}): Structure =>
    ({ id: 7, type: 'fire', tx: 5, ty: 5, villageId: 0, ownerId: ME, access: 'village', hp: 999999, ...over }) as Structure
  const player = { x: 5.5, y: 5.5 } // pile sur le centre de la tuile du feu

  it('un feu libre à moi, à portée, sans village encore → promouvable', () => {
    expect(foundableFireAt(player, [fire()], [], ME)).toBe(7)
  })

  it('déjà membre d’un village → aucune promotion (un foyer par partie)', () => {
    const v = { id: 1, memberIds: [ME] } as Village
    expect(foundableFireAt(player, [fire()], [v], ME)).toBeNull()
  })

  it('un feu DÉJÀ promu (villageId ≠ 0) n’est pas promouvable', () => {
    expect(foundableFireAt(player, [fire({ villageId: 1 })], [], ME)).toBeNull()
  })

  it('le feu d’un AUTRE (ownerId différent) n’est pas le mien', () => {
    expect(foundableFireAt(player, [fire({ ownerId: 2 })], [], ME)).toBeNull()
  })

  it('un feu hors de portée ne compte pas', () => {
    expect(foundableFireAt({ x: 50, y: 50 }, [fire()], [], ME)).toBeNull()
  })

  it('une structure qui n’est pas un feu ne compte pas', () => {
    expect(foundableFireAt(player, [fire({ type: 'chest' })], [], ME)).toBeNull()
  })
})
