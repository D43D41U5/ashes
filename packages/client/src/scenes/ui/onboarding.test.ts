import { describe, it, expect } from 'vitest'
import {
  nextOnboardingHint,
  BASICS_DELAY_MS,
  MAKE_FIRE_DELAY_MS,
  type OnboardingHintId,
  type OnboardingState,
} from './onboarding'

/** Un état neutre : rien de spécial, au tout début. Chaque test n'en change que ce qu'il teste. */
const base = (o: Partial<OnboardingState> = {}): OnboardingState => ({
  msAlive: 0,
  hasFire: false,
  fireLow: false,
  hasWeapon: false,
  neighborNear: false,
  ...o,
})

const none = new Set<OnboardingHintId>()
const shown = (...ids: OnboardingHintId[]) => new Set<OnboardingHintId>(ids)

describe('onboarding — piloté par l’état', () => {
  it('ne dit RIEN dans le tout premier souffle (avant le délai des bases)', () => {
    expect(nextOnboardingHint(base({ msAlive: BASICS_DELAY_MS - 1 }), none)).toBeNull()
  })

  it('dit LES BASES une fois le souffle passé', () => {
    const h = nextOnboardingHint(base({ msAlive: BASICS_DELAY_MS }), none)
    expect(h?.id).toBe('basics')
    expect(h?.text).toMatch(/récolter/i)
  })

  it('ne répète JAMAIS un conseil déjà montré', () => {
    // Les bases montrées, rien d'autre à dire pour l'instant → null (pas de re-basics).
    expect(nextOnboardingHint(base({ msAlive: BASICS_DELAY_MS }), shown('basics'))).toBeNull()
  })

  it('RAPPELLE le feu après le délai, tant qu’on n’en a pas', () => {
    const h = nextOnboardingHint(base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: false }), shown('basics'))
    expect(h?.id).toBe('make-fire')
  })

  it('NE rappelle PAS le feu si l’on en a déjà un (le bug de l’horloge)', () => {
    // C'est tout le sens du pilotage par état : un joueur qui a fait son feu
    // ne doit plus s'entendre dire d'en faire un.
    const h = nextOnboardingHint(base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: true }), shown('basics'))
    expect(h?.id).not.toBe('make-fire')
  })

  it('enseigne la VALEUR du feu à l’instant où il naît', () => {
    const h = nextOnboardingHint(base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: true }), shown('basics'))
    expect(h?.id).toBe('fire-purpose')
  })

  it('enseigne le COMBAT dès qu’une arme est en main — et ça prime sur tout', () => {
    // Arme en main ET feu qui vient de naître : le combat (mortel, fugace) passe devant.
    const h = nextOnboardingHint(
      base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: true, hasWeapon: true }),
      shown('basics'),
    )
    expect(h?.id).toBe('weapon')
    expect(h?.text).toMatch(/parez/i)
  })

  it('enseigne le DON quand un voisin approche', () => {
    const h = nextOnboardingHint(base({ msAlive: 3000, neighborNear: true }), shown('basics', 'make-fire'))
    expect(h?.id).toBe('give-neighbor')
    expect(h?.text).toMatch(/donner/i)
  })

  it('enseigne à NOURRIR le Feu quand il faiblit (geste câblé le 2026-07-23)', () => {
    const h = nextOnboardingHint(
      base({ msAlive: 1e6, hasFire: true, fireLow: true }),
      shown('basics', 'fire-purpose'),
    )
    expect(h?.id).toBe('feed-fire')
    expect(h?.text).toMatch(/nourrir/i)
  })

  it('ne parle PAS de nourrir le Feu tant qu’il ne faiblit pas (au moment utile, pas avant)', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasFire: true, fireLow: false }), shown('basics', 'fire-purpose'))
    expect(h?.id).not.toBe('feed-fire')
  })

  it('une fois TOUT montré, ne dit plus rien', () => {
    const all = shown('basics', 'make-fire', 'fire-purpose', 'feed-fire', 'give-neighbor', 'weapon')
    const state = base({ msAlive: 1e6, hasFire: true, fireLow: true, hasWeapon: true, neighborNear: true })
    expect(nextOnboardingHint(state, all)).toBeNull()
  })
})
