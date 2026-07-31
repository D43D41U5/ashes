import { describe, expect, it } from 'vitest'
import { deathLine } from './death-veil'

describe('deathLine — nommer la chute, du vrai flux (P1)', () => {
  it('le froid', () => {
    expect(deathLine('cold', 0, null)).toBe('Le froid vous a pris.')
  })
  it('la faim', () => {
    expect(deathLine('hunger', 0, null)).toBe('La faim vous a emporté.')
  })
  it('le saignement — pas de cause, pas de tueur (byEntityId 0) : la mort la plus opaque, nommée', () => {
    expect(deathLine(null, 0, null)).toBe('Vous vous êtes vidé de votre sang.')
  })
  it('le loup', () => {
    expect(deathLine(null, 42, 'wolf')).toBe('Un loup vous a abattu.')
  })
  it('le sanglier', () => {
    expect(deathLine(null, 42, 'boar')).toBe('Un sanglier vous a encorné.')
  })
  it('le Cendreux', () => {
    expect(deathLine(null, 42, 'cendreux')).toBe('Un Cendreux vous a repris.')
  })
  it('une bête sans réplique à elle (cerf, lapin…) → abattu', () => {
    expect(deathLine(null, 42, 'deer')).toBe('Vous avez été abattu.')
  })
  it('un tueur non résoluble (disparu du snapshot) → sans témoin', () => {
    // byEntityId non nul (donc pas un saignement) mais aucun type connu.
    expect(deathLine(null, 42, null)).toBe('Vous êtes tombé, sans témoin.')
  })
})
