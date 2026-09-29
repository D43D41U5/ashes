import { describe, expect, it } from 'vitest'
import { BALANCE, FEATURES, MONDE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, seasonDayAtTick } from '@ashes/sim'
import { createVeillee, VEILLEE_CALENDAR_SCALE, VEILLEE_SEASON_CYCLES } from './veillee'

/**
 * L'HORLOGE DE LA VEILLÉE (décision d'Alexis 2026-08-23, cycle porté à 30 min le 2026-08-24).
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
 * PEUPLER LA VEILLÉE (V1-10, racine R-A). On vérifie ici, HEADLESS (pas de navigateur), que la
 * Veillée naît avec ses voisins PNJ, à portée du joueur. *(Le mobile d'origine — allumer le
 * moteur d'alignement, qui exigeait un second village — est mort avec lui le 2026-09-29 ; la
 * garde tient désormais le PEUPLEMENT seul.)*
 */
describe('createVeillee — peupler la Veillée (V1-10)', () => {
  // ⛔ GELÉE AVEC LES VILLAGES (`FEATURES.VILLAGES_PNJ`, décision d'Alexis du 2026-09-26 : finir
  // le worldgen d'abord). C'est la garde V-A2 de `ascension.md` — « on rencontre un village » —
  // et son sujet a disparu du monde joué, pas sa loi : `createVeillee` élit toujours les sites et
  // trace toujours les sentes, il ne fonde plus. Elle repart telle quelle au rallumage.
  it.skipIf(!FEATURES.VILLAGES_PNJ)('fonde ses voisins PNJ — à portée du joueur, pas au pas de sa porte', () => {
    const { sim, spawn } = createVeillee()

    // Les villages voisins (le joueur n'a PAS encore de foyer — il naît survivant). Le compte
    // vit dans `balance.ts` : c'est un levier de peuplement ET de coût de tick, pas un littéral.
    expect(sim.villages.length).toBe(BALANCE.VILLAGES_VEILLEE)

    // LE MONDE OUVRE À L'OUVERTURE DES PLUIES (spec `saisons.md` S2, jour 61 depuis le
    // 2026-08-24) : une saison entière pour s'installer, qui annonce toute seule ce qui vient,
    // et le Grand Froid à h 15 de jeu réel (à 30 min par jour). C'est ICI que ça se
    // garde — `createVeillee` est la seule ligne du jeu qui pose ce jour d'ouverture, et un
    // monde reparti au jour 1 offrirait le printemps en tutoriel, l'exact contraire de S2.
    expect(sim.jourDeDepart).toBe(BALANCE.JOUR_DE_DEPART)

    // ═══ LES DEUX BORNES, parce qu'une seule POURRIT (spec `ascension.md` V-A2) ═══
    //
    // ⚠ **LA GARDE D'ORIGINE (`> 40`) ÉTAIT VERTE SUR 1930 TUILES.** Le tri des villages
    // demandait l'antipode de la carte, Alexis n'a jamais vu un village de tout le jeu, et
    // aucune borne d'un seul côté ne pouvait le dire. Une borne HAUTE est donc obligatoire.
    //
    // Et elle s'écrit comme une LOI relative à la carte — un multiple de l'écart entre villages
    // — jamais en tuiles en dur : c'est exactement ainsi que le `40` a pourri, en survivant à un
    // doublement de la carte qui l'a rendu vide de sens.
    const dists = sim.villages.map((v) => {
      const dx = v.fireTx + 0.5 - spawn.x
      const dy = v.fireTy + 0.5 - spawn.y
      return Math.sqrt(dx * dx + dy * dy)
    })
    // LE PLANCHER — l'Ermitage (GDD, décision 2026-07-22) : pas de raid au pas de la porte.
    expect(Math.min(...dists), 'un village au pas de la porte').toBeGreaterThan(40)
    // LE PLAFOND — on RENCONTRE ses voisins. Deux écarts de village : au-delà, le joueur peut
    // jouer une saison entière sans en croiser un, ce qui est très exactement ce qui se passait.
    expect(Math.min(...dists), 'aucun village à portée du joueur').toBeLessThan(2 * MONDE.ESPACEMENT_VILLAGES)
  }, 120000) // `createVeillee` fait toute la worldgen du monde joué : ~10 s avant, ~18 s depuis la carte doublée (2026-09-20) — 30 s expiraient
})
