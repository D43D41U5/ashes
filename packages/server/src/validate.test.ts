import { describe, expect, it } from 'vitest'
import { CHAT_MAX_LEN } from '@braises/sim'
import { isJoinMessage, sanitizeAction, sanitizeChat, sanitizeInput } from './validate'

describe('validate — vraisemblance des inputs (L1)', () => {
  const wellFormed = { type: 'input', seq: 5, dx: 1, dy: -1, sprint: true, sneak: false, block: false }

  it('accepte un input bien formé au seq croissant, et coerce les booléens', () => {
    const out = sanitizeInput({ ...wellFormed, sprint: 1, block: undefined }, 4)
    expect(out).toEqual({ seq: 5, dx: 1, dy: -1, sprint: true, sneak: false, block: false })
  })

  it('rejette les axes hors {-1,0,1}', () => {
    expect(sanitizeInput({ ...wellFormed, dx: 2 }, 0)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, dy: 0.5 }, 0)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, dx: 'left' }, 0)).toBeNull()
  })

  it('rejette un seq non strictement croissant (rejeu, doublon réseau)', () => {
    expect(sanitizeInput({ ...wellFormed, seq: 5 }, 5)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, seq: 4 }, 5)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, seq: 6 }, 5)).not.toBeNull()
  })

  it('rejette une mauvaise forme (pas un input, seq non fini)', () => {
    expect(sanitizeInput(null, 0)).toBeNull()
    expect(sanitizeInput('input', 0)).toBeNull()
    expect(sanitizeInput({ type: 'action' }, 0)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, seq: Number.NaN }, 0)).toBeNull()
  })

  it("valide l'ENVELOPPE d'une action, pas son fond", () => {
    expect(sanitizeAction({ type: 'action', action: { type: 'harvest', nodeId: 3 } })).toEqual({
      type: 'harvest',
      nodeId: 3,
    })
    // Enveloppe malformée → null. (La légalité du fond, elle, est tranchée par /sim.)
    expect(sanitizeAction({ type: 'action' })).toBeNull()
    expect(sanitizeAction({ type: 'action', action: { noType: true } })).toBeNull()
    expect(sanitizeAction({ type: 'input', seq: 1 })).toBeNull()
    expect(sanitizeAction(null)).toBeNull()
  })

  it('reconnaît le message join', () => {
    expect(isJoinMessage({ type: 'join', protocolVersion: 1 })).toBe(true)
    expect(isJoinMessage({ type: 'input' })).toBe(false)
    expect(isJoinMessage(null)).toBe(false)
  })

  it('assainit un message de chat : rogne, borne, rejette le vide', () => {
    expect(sanitizeChat({ type: 'chat', text: '  salut voisin  ' })).toBe('salut voisin')
    expect(sanitizeChat({ type: 'chat', text: '   ' })).toBeNull() // vide après rognage
    expect(sanitizeChat({ type: 'chat', text: 42 })).toBeNull()
    expect(sanitizeChat({ type: 'input', text: 'x' })).toBeNull()
    expect(sanitizeChat(null)).toBeNull()
    // Borné à CHAT_MAX_LEN.
    const long = 'a'.repeat(CHAT_MAX_LEN + 50)
    expect(sanitizeChat({ type: 'chat', text: long })?.length).toBe(CHAT_MAX_LEN)
  })
})
