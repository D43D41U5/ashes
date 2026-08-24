import { describe, expect, it } from 'vitest'
import { BALANCE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, seasonDayAtTick } from '@ashes/sim'
import { createVeillee, VEILLEE_CALENDAR_SCALE, VEILLEE_SEASON_CYCLES } from './veillee'

/**
 * L'HORLOGE DE LA VEILLÉE (décision d'Alexis 2026-08-23 : « un jour dure 45 minutes »).
 *
 * Ce que garde ce bloc, c'est la CONSTANTE EXPORTÉE — pas la formule qui la calcule. Le
 * défaut vivait très exactement là : `calendarScaleForSeasonCycles` était juste, et la
 * Veillée lui passait 6.
 */
describe('la Veillée compte ses jours sur le cycle', () => {
  it('un jour de saison = un cycle jour/nuit', () => {
    expect(VEILLEE_SEASON_CYCLES).toBe(BALANCE.SEASON_DAYS)
    expect(VEILLEE_CALENDAR_SCALE).toBe(TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE)
    // Dit autrement, et c'est la phrase du joueur : au bout d'un cycle, le compteur a
    // avancé de UN. À l'ancienne échelle (300), il avançait de dix. Le jour d'ouverture
    // (S2) n'entre pas dans l'affaire — c'est un ÉCART qu'on mesure, il s'annule — mais on
    // le passe tel que la Veillée le passe, pour que la mesure soit celle du vrai monde.
    const jour = (tick: number): number => seasonDayAtTick(tick, VEILLEE_CALENDAR_SCALE, BALANCE.JOUR_DE_DEPART)
    expect(jour(TICKS_PER_CYCLE) - jour(0)).toBe(1)
  })
})

/**
 * PEUPLER LA VEILLÉE (V1-10, racine R-A) — le geste qui allume le pilier n°1.
 * Sans un second village, `isOutsider()` renvoie toujours faux et le moteur
 * d'alignement tourne à vide en solo. On vérifie ici, HEADLESS (pas de navigateur),
 * que la Veillée naît avec deux voisins PNJ — un Foyer et une Meute.
 */
describe('createVeillee — peupler la Veillée (V1-10)', () => {
  it('fonde DEUX voisins PNJ (un Foyer, une Meute), loin du joueur', () => {
    const { sim, spawn } = createVeillee()

    // Deux villages voisins (le joueur n'a PAS encore de foyer — il naît survivant).
    expect(sim.villages.length).toBe(2)

    // LE MONDE OUVRE À LA FIN DE L'ARDEUR (spec `saisons.md` S2) : dix jours d'été pour
    // s'installer, les Pluies qui annoncent, le Grand Froid à h 30. C'est ICI que ça se
    // garde — `createVeillee` est la seule ligne du jeu qui pose ce jour d'ouverture, et un
    // monde reparti au jour 1 offrirait le printemps en tutoriel, l'exact contraire de S2.
    expect(sim.jourDeDepart).toBe(BALANCE.JOUR_DE_DEPART)

    // Un caractère ensemencé CHAUD (Foyer) et un FROID (Meute) : les villageois portent
    // la graine (warmth ±60), l'archétype ÉMERGE ensuite des actes.
    const villageWarmth = (villageId: number): number => {
      const w = sim.npcs
        .filter((n) => n.villageId === villageId)
        .map((n) => sim.entities.find((e) => e.id === n.entityId)?.warmth ?? 0)
      return w.reduce((a, b) => a + b, 0) / Math.max(1, w.length)
    }
    const warmths = sim.villages.map((v) => villageWarmth(v.id))
    expect(warmths.some((x) => x > 0)).toBe(true) // le Foyer
    expect(warmths.some((x) => x < 0)).toBe(true) // la Meute

    // CONFORME AU GDD (Ermitage tranquille) : les voisins naissent LOIN — pas de raid au
    // pas de la porte. Chaque Feu est à bonne distance du spawn du joueur.
    for (const v of sim.villages) {
      const dx = v.fireTx + 0.5 - spawn.x
      const dy = v.fireTy + 0.5 - spawn.y
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(40) // au moins ~40 tuiles
    }
  }, 30000) // `createVeillee` fait toute la worldgen alpine (~10 s) : timeout large
})
