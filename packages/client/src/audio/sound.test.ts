import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@braises/sim'
import { soundForEvent } from './sound'

/** Fabrique un événement synthétique (les champs superflus sont ignorés par le routage). */
const ev = (type: string, extra: Record<string, unknown> = {}): SimEvent =>
  ({ type, tick: 0, ...extra }) as unknown as SimEvent

const SONORES = [
  'resource_harvested',
  'entity_damaged',
  'monster_slain',
  'wolf_howl',
  'night_started',
  'entity_died',
  'entity_bandaged',
  'refugees_arrived',
  'alarm_raised',
  'evacuation_opened',
]

describe('la table de routage audio (soundForEvent)', () => {
  it('sonne les faits qui comptent (récolte, coup, mort, hurlement, nuit)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('monster_slain'), false)).not.toBeNull()
    expect(soundForEvent(ev('wolf_howl', { targetEntityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('night_started'), false)).not.toBeNull()
    expect(soundForEvent(ev('entity_died', { entityId: 1 }), true)).not.toBeNull()
  })

  it('reste MUET sur les faits non sonores (haute fréquence ou hors registre)', () => {
    expect(soundForEvent(ev('action_rejected', { entityId: 1 }), true)).toBeNull()
    expect(soundForEvent(ev('gift_given'), false)).toBeNull()
    expect(soundForEvent(ev('season_day_started', { day: 3 }), false)).toBeNull()
  })

  it('« sur moi » vs « sur un autre » : encaisser diffère de toucher', () => {
    const onMe = soundForEvent(ev('entity_damaged', { entityId: 1 }), true)!
    const onOther = soundForEvent(ev('entity_damaged', { entityId: 2 }), false)!
    expect(onMe.wave).not.toBe(onOther.wave) // choc mat (bruit filtré) ≠ « tac » clair
  })

  it('la récolte ne sonne QUE pour moi (pas les PNJ, sinon un vacarme de fond)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), false)).toBeNull()
  })

  it('tous les gains restent BAS et les durées positives (décor sonore, pas arcade)', () => {
    for (const type of SONORES) {
      const s = soundForEvent(ev(type, { entityId: 1 }), true)
      expect(s).not.toBeNull()
      expect(s!.gain).toBeGreaterThan(0)
      expect(s!.gain).toBeLessThanOrEqual(0.15)
      expect(s!.dur).toBeGreaterThan(0)
    }
  })
})
