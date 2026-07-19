import { describe, expect, it } from 'vitest'
import { chronicleFromEvents, formatChronicleLine, type ChronicleWeight } from './chronicle'
import type { SimEvent } from './events'
import { TICKS_PER_SEASON_DAY } from './time'

// calendarScale = TICKS_PER_SEASON_DAY ⇒ day(tick) = tick + 1. Un jour = un tick,
// ce qui rend les assertions de date lisibles sans arithmétique de calendrier.
const SCALE = TICKS_PER_SEASON_DAY
const NAMES: Record<number, string> = { 1: 'le Foyer de la Rivière', 2: 'la Meute des Cendres' }

/** `Omit` DISTRIBUTIF : sur une union discriminée, préserve les clés de chaque membre
 *  (un `Omit<SimEvent,'tick'>` nu ne garderait que les clés communes). */
type NoTick<E> = E extends unknown ? Omit<E, 'tick'> : never
/** Le jour N tombe au tick N-1 sous SCALE. */
const at = (day: number, e: NoTick<SimEvent>): SimEvent => ({ ...e, tick: day - 1 }) as SimEvent

describe('chronicleFromEvents — entrées structurées {jour, texte, poids}', () => {
  it('sépare le jour du texte (pas de préfixe « Jour N — » dans le texte)', () => {
    const [entry] = chronicleFromEvents(
      [at(1, { type: 'village_founded', villageId: 1, chiefId: 9, tx: 0, ty: 0 })],
      SCALE,
      NAMES,
    )
    expect(entry).toEqual({ day: 1, text: "Un Feu s'est allumé : le Foyer de la Rivière.", weight: 'recit' })
    expect(formatChronicleLine(entry!)).toBe("Jour 1 — Un Feu s'est allumé : le Foyer de la Rivière.")
  })

  it('classe les poids : battement (Grand Froid, horde), récit (don), intime (mort)', () => {
    const entries = chronicleFromEvents(
      [
        at(22, { type: 'act_started', act: 2 }),
        at(26, { type: 'horde_spawned', hordeId: 1, size: 9, targetVillageId: 1 }),
        at(28, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'berries', count: 3 }),
        at(30, { type: 'entity_died', entityId: 7, byEntityId: 0, wasMonster: false }),
      ],
      SCALE,
      NAMES,
    )
    const byDay = Object.fromEntries(entries.map((e) => [e.day, e.weight])) as Record<number, ChronicleWeight>
    expect(byDay[22]).toBe('battement')
    expect(byDay[26]).toBe('battement')
    expect(byDay[28]).toBe('recit')
    expect(byDay[30]).toBe('intime')
    // L'Acte II est bien « le Grand Froid ».
    expect(entries.find((e) => e.day === 22)!.text).toBe('le Grand Froid a commencé.')
    // « Quelqu'un est tombé. » — l'intime, sobre.
    expect(entries.find((e) => e.day === 30)!.text).toBe("Quelqu'un est tombé.")
  })

  it("n'annonce pas l'Acte I, ni la mort d'un monstre", () => {
    const entries = chronicleFromEvents(
      [
        at(1, { type: 'act_started', act: 1 }),
        at(5, { type: 'entity_died', entityId: 3, byEntityId: 1, wasMonster: true }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(0)
  })

  it('déduplique les dons par paire (donneur, village)', () => {
    const entries = chronicleFromEvents(
      [
        at(10, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'berries', count: 3 }),
        at(11, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'wood', count: 1 }),
        at(12, { type: 'gift_given', byEntityId: 8, toVillageId: 1, item: 'wood', count: 1 }),
      ],
      SCALE,
      NAMES,
    )
    // Deux donneurs distincts → deux lignes ; le second don du même donneur est mangé.
    expect(entries.filter((e) => e.text.includes('offerts')).length).toBe(2)
  })

  it("ne garde que les POI de devise `recit` (sanctuaire oui, cairn non)", () => {
    const entries = chronicleFromEvents(
      [
        at(8, { type: 'poi_first_visit', poiId: 1, kind: 'sanctuaire', name: 'le Sanctuaire', byEntityId: 7 }),
        at(9, { type: 'poi_first_visit', poiId: 2, kind: 'cairn', name: 'un cairn', byEntityId: 7 }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.text).toBe('le Sanctuaire a été atteint pour la première fois.')
  })

  it('déplie la fin de saison : un battement puis les verdicts en récit', () => {
    const entries = chronicleFromEvents(
      [
        at(48, {
          type: 'season_ended',
          verdicts: [
            { villageId: 1, name: 'le Foyer de la Rivière', archetype: 'foyer', score: 3, outcome: 'a tenu jusqu’au bout' },
            { villageId: 2, name: 'la Meute des Cendres', archetype: 'meute', score: 2, outcome: 'est partie les bras pleins' },
          ],
        }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries.map((e) => e.weight)).toEqual(['battement', 'recit', 'recit'])
    expect(entries[0]!.text).toBe("Le monde s'est éteint. Ce qu'on retiendra :")
    expect(entries[1]!.text).toBe('le Foyer de la Rivière a tenu jusqu’au bout.')
    expect(entries.every((e) => e.day === 48)).toBe(true)
  })
})
